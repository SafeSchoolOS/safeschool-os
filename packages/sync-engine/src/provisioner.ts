/**
 * Device Provisioner — Orchestrates the full provisioning flow
 *
 * After a device pairs with the cloud (via pairing code), the Provisioner:
 *   1. Writes activation key + cloud sync key to .env
 *   2. Writes site config to config.yaml
 *   3. Downloads required adapter bundles via AdapterLoader
 *   4. Configures each adapter with recipe-provided settings
 *   5. Writes adapter configs to config.yaml
 *   6. Signals EdgeRuntime to restart with new config
 *
 * On re-provision (recipe changes pushed from cloud):
 *   1. Diffs current adapters vs new recipe
 *   2. Downloads new adapters, removes unused ones
 *   3. Updates config.yaml
 *   4. Hot-reloads config changes, restarts for adapter swaps
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createLogger } from '@edgeruntime/core';
import { AdapterLoader } from './adapter-loader.js';
import type { AdapterLoaderConfig } from './adapter-loader.js';

const log = createLogger('provisioner');

// ─── Types ──────────────────────────────────────────────────────────

export interface ProvisionerConfig {
  /** Cloud base URL */
  cloudUrl: string;
  /** Local adapter cache directory */
  adapterDir: string;
  /** Path to .env file for storing keys */
  envPath: string;
  /** Path to config.yaml for site/adapter config */
  configPath: string;
  /** Optional auth token for cloud API */
  authToken?: string;
}

export interface ClaimResponse {
  activationKey: string;
  cloudSyncKey: string;
  siteId: string;
  siteName: string;
  orgId?: string;
  orgName?: string;
  products: string[];
  tier: string;
  proxyUrl?: string;
  recipe?: Recipe;
}

export interface Recipe {
  /** Recipe name (e.g. 'safeschool', 'safeschool-enterprise') */
  name: string;
  /** Adapter integration IDs to install (e.g. ['access-control/lenel', 'cameras/milestone']) */
  integrations: string[];
  /** Per-adapter configuration provided by the cloud/admin */
  adapterConfigs: Record<string, Record<string, unknown>>;
}

export interface ProvisionResult {
  /** Whether provisioning succeeded */
  success: boolean;
  /** Adapters that were downloaded */
  downloadedAdapters: string[];
  /** Adapters that were loaded */
  loadedAdapters: string[];
  /** Adapters that failed to load */
  failedAdapters: string[];
  /** Whether a restart is required */
  requiresRestart: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Read a .env file into a key-value map.
 * Handles KEY=VALUE and KEY="VALUE" formats.
 */
async function readEnvFile(path: string): Promise<Map<string, string>> {
  const vars = new Map<string, string>();
  try {
    const content = await readFile(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars.set(key, value);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    // File doesn't exist yet — return empty map
  }
  return vars;
}

/**
 * Write a key-value map back to a .env file.
 * Preserves comments from the original file if possible.
 */
async function writeEnvFile(path: string, vars: Map<string, string>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const lines: string[] = [];

  // Read existing file to preserve comments and ordering
  let existingLines: string[] = [];
  try {
    const content = await readFile(path, 'utf-8');
    existingLines = content.split('\n');
  } catch {
    // File doesn't exist yet
  }

  const written = new Set<string>();

  for (const line of existingLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      lines.push(line);
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      lines.push(line);
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    if (vars.has(key)) {
      lines.push(`${key}=${vars.get(key)}`);
      written.add(key);
    } else {
      lines.push(line);
    }
  }

  // Append new vars not in original file
  for (const [key, value] of vars) {
    if (!written.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  await writeFile(path, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Simple YAML-like config writer. Produces flat key: value pairs and
 * nested objects as indented blocks. Good enough for EdgeRuntime config
 * without pulling in a full YAML library.
 */
function serializeConfig(config: Record<string, unknown>, indent = 0): string {
  const prefix = '  '.repeat(indent);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(config)) {
    if (value === null || value === undefined) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      lines.push(serializeConfig(value as Record<string, unknown>, indent + 1));
    } else if (Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      for (const item of value) {
        if (typeof item === 'object') {
          lines.push(`${prefix}  -`);
          lines.push(serializeConfig(item as Record<string, unknown>, indent + 2));
        } else {
          lines.push(`${prefix}  - ${item}`);
        }
      }
    } else if (typeof value === 'string' && (value.includes(':') || value.includes('#') || value.includes('"'))) {
      lines.push(`${prefix}${key}: "${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${prefix}${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse a simple YAML-like config file into an object.
 */
async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, 'utf-8');
    // For real YAML, you'd use js-yaml. This handles the simple format
    // EdgeRuntime uses. For production, consider importing js-yaml.
    const result: Record<string, unknown> = {};
    const lines = content.split('\n');
    const stack: { obj: Record<string, unknown>; indent: number }[] = [{ obj: result, indent: -1 }];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const lineIndent = line.search(/\S/);
      const match = trimmed.match(/^([^:]+):\s*(.*)/);
      if (!match) continue;

      const key = match[1]!.trim();
      const value = match[2]!.trim();

      // Pop stack to find parent
      while (stack.length > 1 && stack[stack.length - 1]!.indent >= lineIndent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1]!.obj;

      if (value === '' || value === undefined) {
        // Nested object
        const child: Record<string, unknown> = {};
        parent[key] = child;
        stack.push({ obj: child, indent: lineIndent });
      } else {
        // Scalar value
        let parsed: unknown = value;
        if (value === 'true') parsed = true;
        else if (value === 'false') parsed = false;
        else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);
        else if (/^\d+\.\d+$/.test(value)) parsed = parseFloat(value);
        else if (value.startsWith('"') && value.endsWith('"')) parsed = value.slice(1, -1);
        parent[key] = parsed;
      }
    }

    return result;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

// ─── DeviceProvisioner ──────────────────────────────────────────────

export class DeviceProvisioner {
  private readonly config: ProvisionerConfig;
  private readonly adapterLoader: AdapterLoader;
  private currentRecipe: Recipe | null = null;

  constructor(config: ProvisionerConfig) {
    this.config = config;

    const loaderConfig: AdapterLoaderConfig = {
      cloudUrl: config.cloudUrl,
      adapterDir: config.adapterDir,
      authToken: config.authToken,
    };
    this.adapterLoader = new AdapterLoader(loaderConfig);
  }

  /**
   * Get the underlying AdapterLoader for direct adapter access.
   */
  getAdapterLoader(): AdapterLoader {
    return this.adapterLoader;
  }

  /**
   * Full provisioning flow after the device has been claimed via pairing.
   *
   * @param claimResponse  The response from POST /api/v1/pairing/claim
   * @returns Provisioning result
   */
  async provision(claimResponse: ClaimResponse): Promise<ProvisionResult> {
    log.info(
      { siteId: claimResponse.siteId, products: claimResponse.products },
      'Starting device provisioning',
    );

    const result: ProvisionResult = {
      success: false,
      downloadedAdapters: [],
      loadedAdapters: [],
      failedAdapters: [],
      requiresRestart: true,
    };

    try {
      // 1. Write activation key + cloud sync key to .env
      await this.writeKeys(claimResponse);

      // 2. Write site config to config.yaml
      await this.writeSiteConfig(claimResponse);

      // 3. Load and provision recipe adapters
      if (claimResponse.recipe && claimResponse.recipe.integrations.length > 0) {
        this.currentRecipe = claimResponse.recipe;

        const downloaded = await this.adapterLoader.provision({
          integrations: claimResponse.recipe.integrations,
        });
        result.downloadedAdapters = downloaded;

        // 4. Configure each adapter with recipe-provided settings
        await this.writeAdapterConfigs(claimResponse.recipe);

        // Collect loaded/failed adapters
        const loaded = this.adapterLoader.getLoaded();
        for (const [id] of loaded) {
          result.loadedAdapters.push(id);
        }

        // Check for any integrations that weren't loaded
        for (const integrationId of claimResponse.recipe.integrations) {
          if (!loaded.has(integrationId)) {
            result.failedAdapters.push(integrationId);
          }
        }
      } else {
        log.info('No recipe integrations — skipping adapter provisioning');
      }

      result.success = true;
      result.requiresRestart = true; // Always restart after initial provisioning

      log.info(
        {
          downloaded: result.downloadedAdapters.length,
          loaded: result.loadedAdapters.length,
          failed: result.failedAdapters.length,
        },
        'Provisioning complete',
      );
    } catch (err) {
      log.error({ err }, 'Provisioning failed');
      result.success = false;
    }

    return result;
  }

  /**
   * Re-provision when the recipe changes (pushed from cloud).
   * Performs a diff: downloads new adapters, removes unused ones,
   * and updates configuration.
   *
   * @param newRecipe  The updated recipe from the cloud
   * @returns Provisioning result
   */
  async reprovision(newRecipe: Recipe): Promise<ProvisionResult> {
    log.info(
      { recipe: newRecipe.name, integrations: newRecipe.integrations },
      'Starting re-provisioning',
    );

    const result: ProvisionResult = {
      success: false,
      downloadedAdapters: [],
      loadedAdapters: [],
      failedAdapters: [],
      requiresRestart: false,
    };

    try {
      const oldIntegrations = new Set(this.currentRecipe?.integrations || []);
      const newIntegrations = new Set(newRecipe.integrations);

      // Determine what changed
      const toAdd = newRecipe.integrations.filter((id) => !oldIntegrations.has(id));
      const toRemove = [...oldIntegrations].filter((id) => !newIntegrations.has(id));
      const unchanged = newRecipe.integrations.filter((id) => oldIntegrations.has(id));

      log.info(
        { toAdd, toRemove, unchanged: unchanged.length },
        'Re-provision diff computed',
      );

      // Adding/removing adapters requires a restart (different vendor DLLs/modules)
      if (toAdd.length > 0 || toRemove.length > 0) {
        result.requiresRestart = true;
      }

      // 1. Remove unused adapters
      for (const id of toRemove) {
        try {
          await this.adapterLoader.remove(id);
          log.info('Removed adapter: %s', id);
        } catch (err) {
          log.warn({ err, id }, 'Failed to remove adapter');
        }
      }

      // 2. Download new adapters
      if (toAdd.length > 0) {
        const downloaded = await this.adapterLoader.provision({
          integrations: toAdd,
        });
        result.downloadedAdapters = downloaded;
      }

      // 3. Check for config-only changes on unchanged adapters
      for (const id of unchanged) {
        const oldConfig = this.currentRecipe?.adapterConfigs[id];
        const newConfig = newRecipe.adapterConfigs[id];

        if (JSON.stringify(oldConfig) !== JSON.stringify(newConfig)) {
          log.info('Config changed for adapter: %s', id);
          // Config-only changes can be hot-reloaded without restart
          // (requiresRestart stays false if this is the only change)
        }
      }

      // 4. Update adapter configs in config.yaml
      await this.writeAdapterConfigs(newRecipe);

      // 5. Update current recipe
      this.currentRecipe = newRecipe;

      // Collect status
      const loaded = this.adapterLoader.getLoaded();
      for (const id of newRecipe.integrations) {
        if (loaded.has(id)) {
          result.loadedAdapters.push(id);
        } else {
          result.failedAdapters.push(id);
        }
      }

      result.success = true;

      log.info(
        {
          added: toAdd.length,
          removed: toRemove.length,
          downloaded: result.downloadedAdapters.length,
          requiresRestart: result.requiresRestart,
        },
        'Re-provisioning complete',
      );
    } catch (err) {
      log.error({ err }, 'Re-provisioning failed');
      result.success = false;
    }

    return result;
  }

  /**
   * Get the current recipe (if provisioned).
   */
  getCurrentRecipe(): Recipe | null {
    return this.currentRecipe;
  }

  // ─── Private methods ────────────────────────────────────────────

  /**
   * Write activation key and cloud sync key to .env file.
   */
  private async writeKeys(claim: ClaimResponse): Promise<void> {
    log.info('Writing keys to %s', this.config.envPath);

    const envVars = await readEnvFile(this.config.envPath);

    envVars.set('EDGERUNTIME_ACTIVATION_KEY', claim.activationKey);
    envVars.set('CLOUD_SYNC_KEY', claim.cloudSyncKey);
    envVars.set('EDGERUNTIME_SITE_ID', claim.siteId);

    if (claim.proxyUrl) {
      envVars.set('CLOUD_PROXY_URL', claim.proxyUrl);
    }

    await writeEnvFile(this.config.envPath, envVars);
    log.info('Keys written successfully');
  }

  /**
   * Write site configuration to config.yaml.
   */
  private async writeSiteConfig(claim: ClaimResponse): Promise<void> {
    log.info('Writing site config to %s', this.config.configPath);

    const config = await readConfigFile(this.config.configPath);

    // Site identity
    config['site'] = {
      id: claim.siteId,
      name: claim.siteName,
      orgId: claim.orgId,
      orgName: claim.orgName,
    };

    // Product flags
    config['products'] = claim.products;
    config['tier'] = claim.tier;

    // Cloud connectivity
    config['cloud'] = {
      proxyUrl: claim.proxyUrl || this.config.cloudUrl,
      syncEnabled: true,
    };

    // Recipe reference
    if (claim.recipe) {
      config['recipe'] = {
        name: claim.recipe.name,
        integrations: claim.recipe.integrations,
      };
    }

    await mkdir(dirname(this.config.configPath), { recursive: true });
    const yaml = serializeConfig(config);
    await writeFile(this.config.configPath, yaml + '\n', 'utf-8');

    log.info('Site config written');
  }

  /**
   * Write per-adapter configuration to config.yaml.
   */
  private async writeAdapterConfigs(recipe: Recipe): Promise<void> {
    if (!recipe.adapterConfigs || Object.keys(recipe.adapterConfigs).length === 0) {
      log.info('No adapter configs in recipe');
      return;
    }

    log.info('Writing adapter configs for %d adapter(s)', Object.keys(recipe.adapterConfigs).length);

    const config = await readConfigFile(this.config.configPath);

    // Write adapter configs under the 'adapters' key
    const adaptersConfig: Record<string, unknown> = {};

    for (const [adapterId, adapterConfig] of Object.entries(recipe.adapterConfigs)) {
      // Use the adapter ID as key, replacing '/' with '.' for YAML compat
      const key = adapterId.replace('/', '.');
      adaptersConfig[key] = {
        enabled: true,
        ...adapterConfig,
      };
    }

    config['adapters'] = adaptersConfig;

    await mkdir(dirname(this.config.configPath), { recursive: true });
    const yaml = serializeConfig(config);
    await writeFile(this.config.configPath, yaml + '\n', 'utf-8');

    log.info('Adapter configs written');
  }
}
