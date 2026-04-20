/**
 * Adapter Inventory
 *
 * Tracks which adapter versions are installed on this edge device.
 * Persists to a JSON file so it survives restarts.
 * Reports installed versions in heartbeat so cloud can push updates.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('runtime:adapter-inventory');

export interface InstalledAdapter {
  /** Adapter ID: 'access-control/lenel' */
  id: string;
  /** Installed semver version */
  version: string;
  /** Local path to the .mjs bundle */
  bundlePath: string;
  /** SHA-256 hash of the bundle */
  bundleHash: string;
  /** ISO timestamp of installation */
  installedAt: string;
  /** Previous version bundle path — kept for rollback */
  previousBundlePath?: string;
  /** Previous version string */
  previousVersion?: string;
  /** Current status */
  status: 'active' | 'failed' | 'rolling-back';
  /** Error message if status is 'failed' */
  lastError?: string;
}

export class AdapterInventory {
  private adapters: Map<string, InstalledAdapter> = new Map();
  private readonly filePath: string;
  private readonly adapterDir: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'adapter-inventory.json');
    this.adapterDir = join(dataDir, 'adapters');
    this.load();
  }

  /** Load inventory from disk */
  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const entries: InstalledAdapter[] = JSON.parse(raw);
        for (const entry of entries) {
          this.adapters.set(entry.id, entry);
        }
        log.info({ count: this.adapters.size }, 'Adapter inventory loaded');
      }
    } catch (err) {
      log.warn({ err }, 'Failed to load adapter inventory, starting fresh');
    }
  }

  /** Persist inventory to disk */
  private save(): void {
    try {
      const entries = Array.from(this.adapters.values());
      writeFileSync(this.filePath, JSON.stringify(entries, null, 2));
    } catch (err) {
      log.error({ err }, 'Failed to save adapter inventory');
    }
  }

  /** Get the local adapter storage directory */
  getAdapterDir(): string {
    if (!existsSync(this.adapterDir)) {
      mkdirSync(this.adapterDir, { recursive: true });
    }
    return this.adapterDir;
  }

  /** List all installed adapters */
  list(): InstalledAdapter[] {
    return Array.from(this.adapters.values());
  }

  /** Get a specific installed adapter */
  get(adapterId: string): InstalledAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  /** Get version map for heartbeat reporting: { 'access-control/lenel': '1.2.0', ... } */
  getVersionMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [id, adapter] of this.adapters) {
      if (adapter.status === 'active') {
        map[id] = adapter.version;
      }
    }
    return map;
  }

  /** Record a newly installed adapter */
  install(adapter: InstalledAdapter): void {
    const existing = this.adapters.get(adapter.id);
    if (existing && existing.status === 'active') {
      // Keep previous version for rollback
      adapter.previousBundlePath = existing.bundlePath;
      adapter.previousVersion = existing.version;
    }
    this.adapters.set(adapter.id, adapter);
    this.save();
    log.info({ id: adapter.id, version: adapter.version }, 'Adapter installed');
  }

  /** Mark an adapter as failed */
  markFailed(adapterId: string, error: string): void {
    const adapter = this.adapters.get(adapterId);
    if (adapter) {
      adapter.status = 'failed';
      adapter.lastError = error;
      this.save();
      log.warn({ id: adapterId, error }, 'Adapter marked as failed');
    }
  }

  /** Roll back to previous version. Returns the restored adapter or null. */
  rollback(adapterId: string): InstalledAdapter | null {
    const adapter = this.adapters.get(adapterId);
    if (!adapter || !adapter.previousBundlePath || !adapter.previousVersion) {
      log.warn({ id: adapterId }, 'No previous version to roll back to');
      return null;
    }

    const rolled: InstalledAdapter = {
      id: adapterId,
      version: adapter.previousVersion,
      bundlePath: adapter.previousBundlePath,
      bundleHash: '',  // Previous hash not tracked, but bundle was already verified
      installedAt: new Date().toISOString(),
      status: 'active',
    };
    this.adapters.set(adapterId, rolled);
    this.save();
    log.info({ id: adapterId, version: rolled.version }, 'Adapter rolled back');
    return rolled;
  }

  /** Remove an adapter entirely */
  remove(adapterId: string): void {
    this.adapters.delete(adapterId);
    this.save();
    log.info({ id: adapterId }, 'Adapter removed from inventory');
  }
}
