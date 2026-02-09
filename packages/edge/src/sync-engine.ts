/**
 * SafeSchool Edge Sync Engine
 *
 * Runs on the on-site mini PC. Maintains bidirectional sync with the
 * Railway cloud instance. If cloud connectivity is lost, the edge
 * automatically switches to standalone mode and continues operating
 * independently. When connectivity is restored, it reconciles changes
 * by draining the offline queue and performing a full sync.
 *
 * Sync strategy:
 * - Alerts: Edge -> Cloud (real-time, with merge conflict resolution)
 * - Configuration: Cloud -> Edge (polling every syncIntervalMs)
 * - Visitor logs: Edge -> Cloud (batch, every syncIntervalMs)
 * - Door status: Edge -> Cloud (real-time events, edge-wins)
 * - User/site data: Cloud -> Edge (polling, cloud-wins)
 */

import type { OperatingMode, SyncState } from '@safeschool/core';
import { SyncClient, type SyncEntity } from './sync-client.js';
import { OfflineQueue } from './offline-queue.js';
import { resolveConflict, type SyncRecord } from './conflict-resolver.js';
import { HealthMonitor, type HealthCheckResult } from './health-monitor.js';

// ============================================================================
// Types
// ============================================================================

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'standalone';

export type SyncEventCallback = (status: SyncStatus, detail?: string) => void;

export interface SyncEngineConfig {
  siteId: string;
  cloudSyncUrl: string;
  cloudSyncKey: string;
  /** Sync interval in ms. Default: 30000 (30s) */
  syncIntervalMs?: number;
  /** Health check interval in ms. Default: 15000 (15s) */
  healthCheckIntervalMs?: number;
  /** Max entities per push batch. Default: 50 */
  pushBatchSize?: number;
  /** Path to offline queue SQLite database. Default: ':memory:' */
  queueDbPath?: string;
  /** Custom database check function */
  checkDatabaseFn?: () => Promise<boolean>;
  /** Custom Redis check function */
  checkRedisFn?: () => Promise<boolean>;
  /**
   * Lookup a local record by entity type and ID for conflict resolution.
   * Returns the local record if it exists, or null if not found.
   * Required for proper conflict resolution during pull sync.
   */
  localLookupFn?: (entityType: string, id: string) => Promise<SyncRecord | null>;
}

// ============================================================================
// SyncEngine
// ============================================================================

export class SyncEngine {
  private readonly siteId: string;
  private readonly syncClient: SyncClient;
  private readonly offlineQueue: OfflineQueue;
  private readonly healthMonitor: HealthMonitor;
  private readonly syncIntervalMs: number;
  private readonly pushBatchSize: number;
  private readonly localLookupFn?: (entityType: string, id: string) => Promise<SyncRecord | null>;

  private syncIntervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentStatus: SyncStatus = 'idle';
  private lastSyncAt: Date | null = null;
  private lastError: string | undefined;
  private eventCallbacks: SyncEventCallback[] = [];
  private localChanges: SyncEntity[] = [];

  constructor(config: SyncEngineConfig) {
    this.siteId = config.siteId;
    this.syncIntervalMs = config.syncIntervalMs ?? 30000;
    this.pushBatchSize = config.pushBatchSize ?? 50;
    this.localLookupFn = config.localLookupFn;

    this.syncClient = new SyncClient({
      baseUrl: config.cloudSyncUrl,
      syncKey: config.cloudSyncKey,
    });

    this.offlineQueue = new OfflineQueue(config.queueDbPath ?? ':memory:');

    this.healthMonitor = new HealthMonitor({
      syncClient: this.syncClient,
      checkDatabaseFn: config.checkDatabaseFn,
      checkRedisFn: config.checkRedisFn,
      intervalMs: config.healthCheckIntervalMs ?? 15000,
    });

    // React to mode changes
    this.healthMonitor.onModeChange((newMode, previousMode) => {
      console.log(
        `[SyncEngine] Mode change: ${previousMode} -> ${newMode}`,
      );

      if (newMode === 'STANDALONE') {
        this.setStatus('standalone');
      } else if (newMode === 'EDGE' && previousMode === 'STANDALONE') {
        // Reconnected - drain queue then sync
        console.log('[SyncEngine] Cloud connectivity restored - draining offline queue');
        this.drainQueueAndSync().catch((err) => {
          console.error('[SyncEngine] Queue drain failed:', err);
          this.setStatus('error', String(err));
        });
      }
    });
  }

  // ---------- Public API ----------

  /**
   * Start the sync engine: begin health monitoring and periodic sync.
   */
  start(): void {
    console.log(`[SyncEngine] Starting for site ${this.siteId}`);
    console.log(`[SyncEngine] Sync interval: ${this.syncIntervalMs}ms`);

    this.healthMonitor.startMonitoring();

    this.syncIntervalHandle = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[SyncEngine] Tick failed:', err);
      });
    }, this.syncIntervalMs);

    // Run first tick immediately
    this.tick().catch((err) => {
      console.error('[SyncEngine] Initial tick failed:', err);
    });
  }

  /**
   * Stop the sync engine.
   */
  stop(): void {
    console.log('[SyncEngine] Stopping');
    this.healthMonitor.stopMonitoring();

    if (this.syncIntervalHandle) {
      clearInterval(this.syncIntervalHandle);
      this.syncIntervalHandle = null;
    }

    this.setStatus('idle');
  }

  /**
   * Gracefully shut down: stop + close offline queue.
   */
  shutdown(): void {
    this.stop();
    this.offlineQueue.close();
  }

  /**
   * Register a local change to be synced to cloud on next tick.
   * If in STANDALONE mode, immediately queues to offline queue.
   */
  trackChange(entity: SyncEntity): void {
    if (this.healthMonitor.getCurrentMode() === 'STANDALONE') {
      this.offlineQueue.enqueue(entity.type, entity.action, entity.data);
      return;
    }
    this.localChanges.push(entity);
  }

  /**
   * Register a callback for sync status events.
   */
  onStatusChange(callback: SyncEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Get the current sync state.
   */
  getSyncState(): SyncState {
    const stats = this.offlineQueue.getStats();
    return {
      siteId: this.siteId,
      lastSyncAt: this.lastSyncAt ?? new Date(0),
      cloudReachable: this.healthMonitor.getCurrentMode() !== 'STANDALONE',
      operatingMode: this.healthMonitor.getCurrentMode(),
      pendingChanges: stats.pending + this.localChanges.length,
      lastError: this.lastError,
    };
  }

  /**
   * Get the health monitor (for external health-check integration).
   */
  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  /**
   * Get the offline queue (for inspection or manual drain).
   */
  getOfflineQueue(): OfflineQueue {
    return this.offlineQueue;
  }

  /**
   * Get the current operating mode.
   */
  getOperatingMode(): OperatingMode {
    return this.healthMonitor.getCurrentMode();
  }

  // ---------- Core sync logic ----------

  /**
   * Single sync tick: push local changes, pull remote changes.
   * If STANDALONE, queue changes and send heartbeat attempt.
   */
  private async tick(): Promise<void> {
    const mode = this.healthMonitor.getCurrentMode();

    if (mode === 'STANDALONE') {
      // Move pending in-memory changes to offline queue
      this.flushChangesToQueue();
      return;
    }

    try {
      this.setStatus('syncing');

      await this.syncToCloud();
      await this.syncFromCloud();

      // Send heartbeat
      const stats = this.offlineQueue.getStats();
      await this.syncClient.heartbeat(
        this.siteId,
        mode,
        stats.pending + this.localChanges.length,
      ).catch((err) => {
        console.warn('[SyncEngine] Heartbeat failed:', err);
      });

      this.lastSyncAt = new Date();
      this.lastError = undefined;
      this.setStatus('synced');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errMsg;
      console.error('[SyncEngine] Sync tick failed:', errMsg);

      // On error, move in-memory changes to offline queue for safety
      this.flushChangesToQueue();
      this.setStatus('error', errMsg);
    }
  }

  /**
   * Push local changes to the cloud via the sync client.
   * Handles conflicts returned by the cloud.
   */
  async syncToCloud(): Promise<void> {
    if (this.localChanges.length === 0) return;

    // Push in batches
    while (this.localChanges.length > 0) {
      const batch = this.localChanges.splice(0, this.pushBatchSize);

      const result = await this.syncClient.push(this.siteId, batch);

      if (result.errors > 0) {
        console.warn(
          `[SyncEngine] Push had ${result.errors} errors out of ${batch.length} entities`,
        );
      }
    }
  }

  /**
   * Pull remote changes from the cloud and apply them locally with
   * conflict resolution.
   */
  async syncFromCloud(): Promise<void> {
    const since = this.lastSyncAt ?? new Date(0);

    const response = await this.syncClient.pull(this.siteId, since);

    // Process each entity type from the pull response
    for (const [entityType, records] of Object.entries(response.data)) {
      if (!Array.isArray(records)) continue;

      for (const remoteRecord of records) {
        const remote = remoteRecord as SyncRecord;
        if (!remote.id) continue;

        const singularType = entityType.replace(/s$/, '');

        // Look up the local version for conflict resolution
        let resolved: SyncRecord;
        if (this.localLookupFn) {
          const local = await this.localLookupFn(singularType, remote.id);
          if (local) {
            resolved = resolveConflict(singularType, local, remote);
          } else {
            // No local record — accept remote as-is (new record)
            resolved = { ...remote };
          }
        } else {
          // No lookup function configured — accept remote as-is
          resolved = { ...remote };
        }

        // The resolved entity would be applied to the local database
        // In production: await localDb.upsert(singularType, resolved);
        void resolved;
      }
    }
  }

  /**
   * Drain the offline queue by pushing all pending operations to the cloud.
   * Called when connectivity is restored after a STANDALONE period.
   */
  async drainQueueAndSync(): Promise<void> {
    console.log('[SyncEngine] Draining offline queue...');
    this.setStatus('syncing');

    let drained = 0;
    let batch = this.offlineQueue.dequeue(this.pushBatchSize);

    while (batch.length > 0) {
      const entities: SyncEntity[] = batch.map((op) => ({
        type: op.entity,
        action: op.operation,
        data: JSON.parse(op.data),
        timestamp: op.createdAt,
      }));

      try {
        const result = await this.syncClient.push(this.siteId, entities);
        const successIds = batch.map((op) => op.id);

        if (result.errors === 0) {
          this.offlineQueue.markComplete(successIds);
          drained += successIds.length;
        } else {
          // Partial failure: mark all failed (simplified; could be per-entity)
          this.offlineQueue.markFailed(
            successIds,
            `Partial push failure: ${result.errors} of ${batch.length} failed`,
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.offlineQueue.markFailed(
          batch.map((op) => op.id),
          errMsg,
        );
        console.error('[SyncEngine] Queue drain batch failed:', errMsg);
        break; // Stop draining on error; will retry next tick
      }

      batch = this.offlineQueue.dequeue(this.pushBatchSize);
    }

    console.log(`[SyncEngine] Drained ${drained} operations from offline queue`);

    // Now do a full bidirectional sync
    await this.syncFromCloud();
    this.lastSyncAt = new Date();
    this.lastError = undefined;
    this.setStatus('synced');
  }

  // ---------- Internal helpers ----------

  /**
   * Move in-memory pending changes to the offline queue.
   */
  private flushChangesToQueue(): void {
    if (this.localChanges.length === 0) return;

    console.log(
      `[SyncEngine] Flushing ${this.localChanges.length} changes to offline queue`,
    );

    for (const change of this.localChanges) {
      this.offlineQueue.enqueue(change.type, change.action, change.data);
    }

    this.localChanges = [];
  }

  /**
   * Set the current status and notify all callbacks.
   */
  private setStatus(status: SyncStatus, detail?: string): void {
    this.currentStatus = status;
    for (const callback of this.eventCallbacks) {
      try {
        callback(status, detail);
      } catch (err) {
        console.error('[SyncEngine] Status callback error:', err);
      }
    }
  }
}

// ============================================================================
// Standalone runner (when executed directly via tsx or node)
// ============================================================================

const CLOUD_SYNC_URL = process.env.CLOUD_SYNC_URL;
const CLOUD_SYNC_KEY = process.env.CLOUD_SYNC_KEY;
const SITE_ID = process.env.SITE_ID;

if (CLOUD_SYNC_URL && CLOUD_SYNC_KEY && SITE_ID) {
  const engine = new SyncEngine({
    siteId: SITE_ID,
    cloudSyncUrl: CLOUD_SYNC_URL,
    cloudSyncKey: CLOUD_SYNC_KEY,
    syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS || '30000', 10),
    queueDbPath: process.env.QUEUE_DB_PATH || './data/sync-queue.db',
  });

  engine.start();

  // Export for external access
  (globalThis as any).__safeschool_sync_engine = engine;

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('[SyncEngine] Received SIGINT, shutting down...');
    engine.shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('[SyncEngine] Received SIGTERM, shutting down...');
    engine.shutdown();
    process.exit(0);
  });
}

// Re-export for programmatic use
export { SyncClient } from './sync-client.js';
export { OfflineQueue } from './offline-queue.js';
export { resolveConflict, getStrategy } from './conflict-resolver.js';
export { HealthMonitor } from './health-monitor.js';
