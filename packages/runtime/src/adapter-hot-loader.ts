/**
 * Adapter Hot-Loader
 *
 * Dynamically loads adapter bundles at runtime without restarting.
 * Handles version replacement, connector re-creation, and rollback on failure.
 *
 * Node.js caches import() by URL — the version-in-filename strategy
 * (lenel-1.0.0.mjs → lenel-1.1.0.mjs) naturally avoids the cache.
 */

import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { createLogger } from '@edgeruntime/core';
import type { ConnectorRegistry } from '@edgeruntime/connector-framework';
import type { AdapterInventory, InstalledAdapter } from './adapter-inventory.js';

const log = createLogger('runtime:adapter-hot-loader');

/** Grace period before checking if a new adapter version is healthy */
const HEALTH_CHECK_DELAY_MS = 60_000;

/** Error threshold — if connector errors exceed this after update, rollback */
const ERROR_THRESHOLD = 5;

export class AdapterHotLoader {
  constructor(
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly inventory: AdapterInventory,
  ) {}

  /**
   * Load an adapter bundle from a local file path and register its connector type.
   * The bundle should export a connector class as its default export.
   */
  async loadAdapter(localBundlePath: string, adapterId: string): Promise<void> {
    if (!existsSync(localBundlePath)) {
      throw new Error(`Adapter bundle not found: ${localBundlePath}`);
    }

    try {
      // Dynamic import — uses file:// URL to work cross-platform
      const moduleUrl = pathToFileURL(localBundlePath).href;
      const mod = await import(moduleUrl);

      // Extract connector class — try default export, then named exports
      const ConnectorClass = mod.default || mod.Connector || mod[Object.keys(mod).find(k => /Connector$|Adapter$/.test(k)) || ''];
      if (!ConnectorClass || typeof ConnectorClass !== 'function') {
        throw new Error(`Adapter bundle ${adapterId} has no exported connector class`);
      }

      // Extract adapter type name from ID: 'access-control/lenel' → 'lenel'
      const typeName = adapterId.split('/').pop()!;

      // Register the connector type
      this.connectorRegistry.registerType(typeName, ConnectorClass);
      log.info({ id: adapterId, type: typeName }, 'Adapter loaded and registered');
    } catch (err) {
      log.error({ id: adapterId, err: (err as Error).message }, 'Failed to load adapter bundle');
      throw err;
    }
  }

  /**
   * Replace a running adapter with a new version.
   * Stops existing instances, loads new version, re-creates instances.
   * On failure, triggers automatic rollback.
   */
  async replaceAdapter(adapterId: string, newBundlePath: string, newVersion: string, bundleHash: string): Promise<void> {
    const typeName = adapterId.split('/').pop()!;
    const existingInstances: Array<{ name: string; config: Record<string, unknown> }> = [];

    // Capture existing connector instances of this type
    for (const connector of this.connectorRegistry.getAllConnectors()) {
      const status = connector.getStatus();
      if (status.name.includes(typeName)) {
        existingInstances.push({ name: status.name, config: (connector as any).config || {} });
      }
    }

    // Stop existing instances
    for (const instance of existingInstances) {
      try {
        const connector = this.connectorRegistry.getConnector(instance.name);
        if (connector) await connector.disconnect();
      } catch (err) {
        log.warn({ name: instance.name, err: (err as Error).message }, 'Error stopping connector during replacement');
      }
    }

    try {
      // Load new version
      await this.loadAdapter(newBundlePath, adapterId);

      // Record in inventory
      this.inventory.install({
        id: adapterId,
        version: newVersion,
        bundlePath: newBundlePath,
        bundleHash,
        installedAt: new Date().toISOString(),
        status: 'active',
      });

      // Re-create connector instances with same configs
      for (const instance of existingInstances) {
        try {
          const connector = this.connectorRegistry.createConnector(
            instance.name,
            typeName,
            instance.config as any,
          );
          await connector.connect();
        } catch (err) {
          log.warn({ name: instance.name, err: (err as Error).message }, 'Failed to re-create connector instance');
        }
      }

      log.info({ id: adapterId, version: newVersion, instances: existingInstances.length }, 'Adapter replaced successfully');

      // Schedule health check
      this.scheduleHealthCheck(adapterId, typeName);
    } catch (err) {
      log.error({ id: adapterId, err: (err as Error).message }, 'Adapter replacement failed, rolling back');
      await this.rollbackAdapter(adapterId);
      throw err;
    }
  }

  /**
   * Roll back an adapter to its previous version.
   */
  async rollbackAdapter(adapterId: string): Promise<boolean> {
    const rolled = this.inventory.rollback(adapterId);
    if (!rolled) {
      log.warn({ id: adapterId }, 'Rollback failed — no previous version available');
      return false;
    }

    try {
      await this.loadAdapter(rolled.bundlePath, adapterId);
      log.info({ id: adapterId, version: rolled.version }, 'Adapter rolled back successfully');
      return true;
    } catch (err) {
      log.error({ id: adapterId, err: (err as Error).message }, 'Rollback also failed — adapter is now offline');
      this.inventory.markFailed(adapterId, `Rollback failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Load all adapters from inventory at boot time.
   * Only loads adapters with 'active' status.
   */
  async loadAllFromInventory(): Promise<void> {
    const adapters = this.inventory.list().filter(a => a.status === 'active');
    if (adapters.length === 0) return;

    log.info({ count: adapters.length }, 'Loading adapters from inventory');
    for (const adapter of adapters) {
      try {
        if (existsSync(adapter.bundlePath)) {
          await this.loadAdapter(adapter.bundlePath, adapter.id);
        } else {
          log.warn({ id: adapter.id, path: adapter.bundlePath }, 'Adapter bundle missing from disk');
          this.inventory.markFailed(adapter.id, 'Bundle file missing');
        }
      } catch (err) {
        log.error({ id: adapter.id, err: (err as Error).message }, 'Failed to load adapter from inventory');
        this.inventory.markFailed(adapter.id, (err as Error).message);
      }
    }
  }

  /**
   * Schedule a health check after an adapter update.
   * If the new version has too many errors, automatically roll back.
   */
  private scheduleHealthCheck(adapterId: string, typeName: string): void {
    setTimeout(async () => {
      let totalErrors = 0;
      for (const connector of this.connectorRegistry.getAllConnectors()) {
        const status = connector.getStatus();
        if (status.name.includes(typeName)) {
          totalErrors += status.errors;
        }
      }

      if (totalErrors > ERROR_THRESHOLD) {
        log.warn({ id: adapterId, errors: totalErrors, threshold: ERROR_THRESHOLD }, 'Adapter health check failed — rolling back');
        await this.rollbackAdapter(adapterId);
      } else {
        log.info({ id: adapterId, errors: totalErrors }, 'Adapter health check passed');
      }
    }, HEALTH_CHECK_DELAY_MS);
  }
}
