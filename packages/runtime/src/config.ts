/**
 * EdgeRuntime Configuration Loader
 *
 * Loads config from YAML file + environment variables + activation key.
 * Priority: env vars > YAML file > defaults
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { createLogger, type EdgeRuntimeConfig, type OperatingMode, type ConnectorDefinition, type FederationConfig } from '@edgeruntime/core';

const log = createLogger('config');

const DEFAULTS: EdgeRuntimeConfig = {
  activationKey: '',
  siteId: 'default-site',
  dataDir: './data',
  syncIntervalMs: 30000,
  healthCheckIntervalMs: 15000,
  apiPort: 8470,
};

/**
 * Load configuration from YAML + env vars.
 */
export function loadConfig(configPath?: string): EdgeRuntimeConfig {
  let fileConfig: Partial<EdgeRuntimeConfig> = {};

  // Try loading YAML config
  const yamlPath = configPath ?? process.env.EDGERUNTIME_CONFIG ?? resolve('config.yaml');
  if (existsSync(yamlPath)) {
    try {
      const raw = readFileSync(yamlPath, 'utf-8');
      fileConfig = (yaml.load(raw) as Partial<EdgeRuntimeConfig>) ?? {};
      log.info({ path: yamlPath }, 'Loaded config from YAML');
    } catch (err) {
      log.warn({ err, path: yamlPath }, 'Failed to parse config YAML');
    }
  } else {
    log.info({ path: yamlPath }, 'No config file found, using env vars and defaults');
  }

  // Merge: env vars > YAML > defaults
  const config: EdgeRuntimeConfig = {
    activationKey:
      process.env.EDGERUNTIME_ACTIVATION_KEY ??
      fileConfig.activationKey ??
      DEFAULTS.activationKey,
    siteId:
      process.env.EDGERUNTIME_SITE_ID ??
      fileConfig.siteId ??
      DEFAULTS.siteId,
    dataDir:
      process.env.EDGERUNTIME_DATA_DIR ??
      fileConfig.dataDir ??
      DEFAULTS.dataDir,
    syncIntervalMs:
      envInt('EDGERUNTIME_SYNC_INTERVAL_MS') ??
      fileConfig.syncIntervalMs ??
      DEFAULTS.syncIntervalMs,
    healthCheckIntervalMs:
      envInt('EDGERUNTIME_HEALTH_CHECK_INTERVAL_MS') ??
      fileConfig.healthCheckIntervalMs ??
      DEFAULTS.healthCheckIntervalMs,
    apiPort:
      envInt('EDGERUNTIME_API_PORT') ??
      envInt('PORT') ??
      fileConfig.apiPort ??
      DEFAULTS.apiPort,
    operatingMode:
      (process.env.OPERATING_MODE?.toUpperCase() as OperatingMode | undefined) ??
      fileConfig.operatingMode,
    cloudSyncKey:
      process.env.EDGERUNTIME_CLOUD_SYNC_KEY ??
      fileConfig.cloudSyncKey,
    cloudTlsFingerprint:
      process.env.EDGERUNTIME_CLOUD_TLS_FINGERPRINT ??
      fileConfig.cloudTlsFingerprint,
    moduleDirs:
      process.env.EDGERUNTIME_MODULE_DIRS?.split(',') ??
      fileConfig.moduleDirs ??
      ['./modules'],
    orgId:
      process.env.EDGERUNTIME_ORG_ID ??
      fileConfig.orgId,
    connectors: loadConnectorConfig(fileConfig),
    federation: (fileConfig as any).federation as FederationConfig | undefined,
  };

  return config;
}

/**
 * Load connector definitions from YAML config and/or env vars.
 * Supports both config.yaml `connectors:` section and env var shortcuts.
 */
function loadConnectorConfig(fileConfig: Partial<EdgeRuntimeConfig>): ConnectorDefinition[] {
  const connectors: ConnectorDefinition[] = [];

  // Load from YAML connectors section
  if (Array.isArray((fileConfig as any).connectors)) {
    for (const c of (fileConfig as any).connectors) {
      if (c.name && c.type) {
        connectors.push({
          ...c,
          enabled: c.enabled !== false,
          pollIntervalMs: c.pollIntervalMs ?? 5000,
        });
      }
    }
  }

  // Auto-create connector from ACCESS_CONTROL env vars if no connectors defined in YAML
  if (connectors.length === 0 && process.env.ACCESS_CONTROL_VENDOR && process.env.ACCESS_CONTROL_URL) {
    const vendor = process.env.ACCESS_CONTROL_VENDOR;
    const typeMap: Record<string, string> = {
      sicunet: 'lenel-onguard',
      lenel: 'lenel-onguard',
      genetec: 'lenel-onguard',
      milestone: 'milestone-xprotect',
    };
    const connectorType = typeMap[vendor] ?? 'lenel-onguard';

    connectors.push({
      name: `${vendor}-pacs`,
      type: connectorType,
      enabled: true,
      pollIntervalMs: 5000,
      apiUrl: process.env.ACCESS_CONTROL_URL,
      apiKey: process.env.ACCESS_CONTROL_API_KEY ?? '',
    });
    log.info({ vendor, type: connectorType }, 'Auto-configured PACS connector from env vars');
  }

  // Auto-create camera connector from CAMERA env vars
  if (process.env.CAMERA_VENDOR && process.env.CAMERA_HOST) {
    const port = process.env.CAMERA_PORT ?? '443';
    connectors.push({
      name: `${process.env.CAMERA_VENDOR}-vms`,
      type: 'milestone-xprotect',
      enabled: true,
      pollIntervalMs: 10000,
      serverUrl: `https://${process.env.CAMERA_HOST}:${port}`,
      username: process.env.CAMERA_USERNAME ?? '',
      password: process.env.CAMERA_PASSWORD ?? '',
    });
    log.info({ vendor: process.env.CAMERA_VENDOR }, 'Auto-configured camera connector from env vars');
  }

  return connectors;
}

function envInt(key: string): number | undefined {
  const val = process.env[key];
  if (val === undefined) return undefined;
  const num = parseInt(val, 10);
  return isNaN(num) ? undefined : num;
}
