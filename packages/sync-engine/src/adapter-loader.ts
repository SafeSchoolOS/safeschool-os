/**
 * Adapter Loader — Edge-side dynamic adapter plugin system
 *
 * Downloads adapter bundles from the cloud registry, caches them
 * locally on disk, and loads them via dynamic import() at runtime.
 *
 * Used by DeviceProvisioner after pairing to fetch the adapters
 * specified in the device's recipe.
 *
 * Bundle lifecycle:
 *   1. Cloud assigns recipe with integration list
 *   2. AdapterLoader.provision() resolves integrations via cloud API
 *   3. Missing bundles are downloaded and cached at <adapterDir>/<category>/<name>.mjs
 *   4. Each bundle is dynamically imported
 *   5. On re-provision, only deltas are downloaded
 */

import { mkdir, writeFile, readdir, rm, stat, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('adapter-loader');

// ─── Types ──────────────────────────────────────────────────────────

export interface AdapterLoaderConfig {
  /** Cloud base URL — e.g. https://safeschoolos.org */
  cloudUrl: string;
  /** Local directory to cache adapter bundles — e.g. /opt/edgeruntime/adapters/ */
  adapterDir: string;
  /** Optional auth token for bundle downloads */
  authToken?: string;
  /** Download timeout in ms (default: 30000) */
  downloadTimeoutMs?: number;
  /** Maximum retries per bundle download (default: 3) */
  maxRetries?: number;
}

export interface ResolvedAdapter {
  id: string;
  category: string;
  vendor: string;
  displayName: string;
  summary: string;
  status: string;
  version: string;
  bundleSize?: number;
  bundlePath?: string;
  bundleHash?: string;
  dependencies?: string[];
}

export interface ResolveResponse {
  adapters: ResolvedAdapter[];
  bundles: string[];
  missing?: string[];
  recipe?: string;
}

export interface LoadedAdapter {
  id: string;
  module: any;
  version: string;
  localPath: string;
  loadedAt: Date;
}

// ─── Helpers ────────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

// ─── AdapterLoader ──────────────────────────────────────────────────

export class AdapterLoader {
  private readonly cloudUrl: string;
  private readonly adapterDir: string;
  private readonly authToken?: string;
  private readonly downloadTimeoutMs: number;
  private readonly maxRetries: number;
  private loadedAdapters = new Map<string, LoadedAdapter>();

  constructor(config: AdapterLoaderConfig) {
    this.cloudUrl = config.cloudUrl.replace(/\/$/, '');
    this.adapterDir = config.adapterDir;
    this.authToken = config.authToken;
    this.downloadTimeoutMs = config.downloadTimeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Provision adapters for a recipe. Downloads any missing bundles
   * from the cloud, writes them to disk, and dynamically imports them.
   *
   * @param recipe  Object containing the list of integration IDs
   * @returns IDs of adapters that were newly downloaded
   */
  async provision(recipe: { integrations: string[] }): Promise<string[]> {
    if (!recipe.integrations || recipe.integrations.length === 0) {
      log.info('No integrations in recipe — nothing to provision');
      return [];
    }

    log.info('Provisioning %d adapter(s): %s', recipe.integrations.length, recipe.integrations.join(', '));

    // 1. Resolve integrations via cloud API
    const resolved = await this.resolveFromCloud(recipe.integrations);

    if (resolved.missing && resolved.missing.length > 0) {
      log.warn('Cloud registry does not have adapters: %s', resolved.missing.join(', '));
    }

    // 2. Ensure adapter directory exists
    await mkdir(this.adapterDir, { recursive: true });

    // 3. Download missing bundles
    const downloaded: string[] = [];
    for (const adapter of resolved.adapters) {
      const localPath = this.getLocalPath(adapter.id);
      const needsDownload = await this.needsUpdate(adapter, localPath);

      if (needsDownload) {
        await this.downloadBundle(adapter.id, localPath);
        downloaded.push(adapter.id);
      }
    }

    // 4. Load all adapters
    for (const adapter of resolved.adapters) {
      if (!this.loadedAdapters.has(adapter.id)) {
        await this.load(adapter.id);
      }
    }

    log.info(
      'Provisioning complete: %d resolved, %d downloaded, %d loaded',
      resolved.adapters.length,
      downloaded.length,
      this.loadedAdapters.size,
    );

    return downloaded;
  }

  /**
   * Load a specific adapter by its ID (e.g. 'access-control/lenel').
   * The adapter must already be cached locally.
   *
   * @returns The loaded module's exports
   * @throws If the adapter is not cached locally
   */
  async load(adapterId: string): Promise<any> {
    // Return cached if already loaded
    const existing = this.loadedAdapters.get(adapterId);
    if (existing) {
      return existing.module;
    }

    const localPath = this.getLocalPath(adapterId);

    if (!(await fileExists(localPath))) {
      throw new Error(`Adapter "${adapterId}" not found locally at ${localPath}. Call provision() first.`);
    }

    log.info('Loading adapter: %s from %s', adapterId, localPath);

    try {
      // Use file:// URL for cross-platform dynamic import compatibility
      const fileUrl = new URL(`file://${localPath.replace(/\\/g, '/')}`).href;
      const module = await import(/* webpackIgnore: true */ fileUrl);

      const loaded: LoadedAdapter = {
        id: adapterId,
        module,
        version: module.meta?.version || module.VERSION || 'unknown',
        localPath,
        loadedAt: new Date(),
      };

      this.loadedAdapters.set(adapterId, loaded);
      log.info('Adapter loaded: %s (v%s)', adapterId, loaded.version);
      return module;
    } catch (err) {
      log.error({ err, adapterId }, 'Failed to load adapter');
      throw new Error(`Failed to load adapter "${adapterId}": ${(err as Error).message}`);
    }
  }

  /**
   * Get all currently loaded adapters.
   */
  getLoaded(): Map<string, LoadedAdapter> {
    return new Map(this.loadedAdapters);
  }

  /**
   * Check if an adapter is cached locally (not necessarily loaded).
   */
  has(adapterId: string): boolean {
    return this.loadedAdapters.has(adapterId);
  }

  /**
   * Check if an adapter bundle is cached locally on disk.
   */
  async hasCached(adapterId: string): Promise<boolean> {
    return fileExists(this.getLocalPath(adapterId));
  }

  /**
   * Clear all cached adapter bundles and unload everything.
   * Used when re-provisioning with a completely different recipe.
   */
  async clear(): Promise<void> {
    log.info('Clearing all cached adapters from %s', this.adapterDir);

    this.loadedAdapters.clear();

    try {
      const entries = await readdir(this.adapterDir);
      for (const entry of entries) {
        const entryPath = join(this.adapterDir, entry);
        const entryStat = await stat(entryPath);
        if (entryStat.isDirectory()) {
          await rm(entryPath, { recursive: true, force: true });
        } else if (entry.endsWith('.mjs') || entry.endsWith('.js')) {
          await rm(entryPath, { force: true });
        }
      }
    } catch (err) {
      // Directory might not exist yet
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error({ err }, 'Failed to clear adapter cache');
        throw err;
      }
    }
  }

  /**
   * Remove a specific adapter's cached bundle and unload it.
   */
  async remove(adapterId: string): Promise<void> {
    this.loadedAdapters.delete(adapterId);

    const localPath = this.getLocalPath(adapterId);
    try {
      await rm(localPath, { force: true });
      log.info('Removed adapter: %s', adapterId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  /**
   * List all adapter IDs that are cached locally on disk.
   */
  async listCached(): Promise<string[]> {
    const result: string[] = [];

    try {
      const categories = await readdir(this.adapterDir);
      for (const category of categories) {
        const categoryPath = join(this.adapterDir, category);
        const categoryStat = await stat(categoryPath);
        if (!categoryStat.isDirectory()) continue;

        const files = await readdir(categoryPath);
        for (const file of files) {
          if (file.endsWith('.mjs')) {
            result.push(`${category}/${file.replace('.mjs', '')}`);
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    return result.sort();
  }

  // ─── Private methods ────────────────────────────────────────────

  /**
   * Resolve integrations to adapter metadata via the cloud registry API.
   */
  private async resolveFromCloud(integrations: string[]): Promise<ResolveResponse> {
    const url = `${this.cloudUrl}/api/v1/adapters/resolve`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.downloadTimeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ integrations }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Adapter resolve failed (${res.status}): ${body}`);
      }

      return (await res.json()) as ResolveResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Download a single adapter bundle from the cloud and write to disk.
   * Retries on failure. Verifies integrity via SHA-256 hash header.
   */
  private async downloadBundle(adapterId: string, localPath: string): Promise<void> {
    const parts = adapterId.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid adapter ID format: "${adapterId}". Expected "category/name".`);
    }
    const [category, name] = parts;

    const url = `${this.cloudUrl}/api/v1/adapters/${category}/${name}/bundle`;
    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.downloadTimeoutMs);

      try {
        log.info('Downloading adapter bundle: %s (attempt %d/%d)', adapterId, attempt, this.maxRetries);

        const res = await fetch(url, {
          headers,
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Bundle download failed (${res.status}): ${body}`);
        }

        const buffer = Buffer.from(await res.arrayBuffer());

        // Verify integrity if server provides hash
        const serverHash = res.headers.get('x-bundle-hash');
        if (serverHash) {
          const localHash = createHash('sha256').update(buffer).digest('hex');
          if (localHash !== serverHash) {
            throw new Error(
              `Bundle integrity check failed for ${adapterId}: ` +
              `expected ${serverHash}, got ${localHash}`,
            );
          }
        }

        // Ensure directory exists
        const dir = join(this.adapterDir, category!);
        await mkdir(dir, { recursive: true });

        // Write atomically: write to temp file then rename
        const tmpPath = `${localPath}.tmp.${Date.now()}`;
        await writeFile(tmpPath, buffer);

        // Rename into place (atomic on most filesystems)
        const { rename } = await import('node:fs/promises');
        await rename(tmpPath, localPath);

        log.info(
          'Downloaded adapter bundle: %s (%d bytes)',
          adapterId,
          buffer.byteLength,
        );
        return;
      } catch (err) {
        lastError = err as Error;
        log.warn(
          { err, attempt, maxRetries: this.maxRetries },
          'Bundle download attempt failed for %s',
          adapterId,
        );

        if (attempt < this.maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = 1000 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(
      `Failed to download adapter "${adapterId}" after ${this.maxRetries} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Check whether a local bundle needs to be updated.
   * Returns true if the file doesn't exist or its hash differs from the server's.
   */
  private async needsUpdate(adapter: ResolvedAdapter, localPath: string): Promise<boolean> {
    if (!(await fileExists(localPath))) {
      return true;
    }

    // If the server provided a hash, compare it
    if (adapter.bundleHash) {
      try {
        const localHash = await computeFileHash(localPath);
        return localHash !== adapter.bundleHash;
      } catch {
        return true;
      }
    }

    // No hash to compare — assume local copy is fine
    return false;
  }

  /**
   * Get the local filesystem path for an adapter bundle.
   */
  private getLocalPath(adapterId: string): string {
    const parts = adapterId.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid adapter ID: "${adapterId}"`);
    }
    return join(this.adapterDir, parts[0]!, `${parts[1]}.mjs`);
  }
}
