/**
 * EdgeRuntime Sync Engine
 *
 * Core sync orchestrator. Maintains bidirectional sync with cloud.
 * Supports EDGE, STANDALONE, and CLOUD operating modes.
 * Ported from SafeSchool edge sync engine.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OperatingMode, SyncState } from '@edgeruntime/core';
import { createLogger } from '@edgeruntime/core';
import { SyncClient, type SyncEntity, type HeartbeatRequest, type DeviceConfigPayload } from './sync-client.js';
import { OfflineQueue } from './offline-queue.js';
import { ConflictResolver, type SyncRecord } from './conflict-resolver.js';
import { HealthMonitor } from './health-monitor.js';
import { RealtimeClient, type CommandHandler } from './realtime-client.js';
import { SyncRouter, type SyncRouteConfig } from './sync-router.js';
import { UserAccountStore, type UserAccount } from './user-account-store.js';
import { PeerManager } from './peer-manager.js';

const execFileAsync = promisify(execFile);
const log = createLogger('sync-engine');

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'standalone';
export type SyncEventCallback = (status: SyncStatus, detail?: string) => void;

export interface SyncEngineConfig {
  siteId: string;
  cloudSyncUrl: string;
  cloudSyncKey: string;
  syncIntervalMs?: number;
  healthCheckIntervalMs?: number;
  pushBatchSize?: number;
  queueDbPath?: string;
  /** Data directory for persistent storage (user accounts DB, etc.) */
  dataDir?: string;
  checkDatabaseFn?: () => Promise<boolean>;
  checkRedisFn?: () => Promise<boolean>;
  localLookupFn?: (entityType: string, id: string) => Promise<SyncRecord | null>;
  cloudTlsFingerprint?: string;
  /** Force a specific operating mode */
  operatingMode?: OperatingMode;
  /** Enable WebSocket realtime channel for sub-second command delivery (default: true) */
  enableRealtime?: boolean;
  /** Optional routes for multi-backend sync (one route per product) */
  routes?: SyncRouteConfig[];
  /** Organization ID for multi-org support and peer discovery */
  orgId?: string;
  /** Enable peer-to-peer sync between edge devices in same org (default: false) */
  enablePeerSync?: boolean;
  /** Port this device listens on for peer sync requests (sent in heartbeat) */
  peerSyncPort?: number;
}

export class SyncEngine {
  private readonly siteId: string;
  private readonly syncClient: SyncClient;
  private readonly offlineQueue: OfflineQueue;
  private readonly healthMonitor: HealthMonitor;
  private readonly conflictResolver: ConflictResolver;
  private readonly syncIntervalMs: number;
  private readonly pushBatchSize: number;
  private readonly localLookupFn?: (entityType: string, id: string) => Promise<SyncRecord | null>;
  private readonly cloudSyncKey: string;
  private readonly cloudTlsFingerprint?: string;
  private syncRouter: SyncRouter | null = null;

  private syncIntervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentStatus: SyncStatus = 'idle';
  private lastSyncAt: Date | null = null;
  private lastError: string | undefined;
  private eventCallbacks: SyncEventCallback[] = [];
  private localChanges: SyncEntity[] = [];

  private realtimeClient: RealtimeClient | null = null;
  private peerManager: PeerManager | null = null;
  private readonly orgId?: string;
  private readonly peerSyncPort?: number;
  readonly userAccountStore: UserAccountStore;

  private upgrading = false;
  private upgradeStatus: string | undefined;
  private upgradeError: string | undefined;
  private currentVersion: string | undefined;
  private appliedConfigVersion: number | undefined;
  private configCallbacks: Array<(config: DeviceConfigPayload) => void> = [];

  constructor(config: SyncEngineConfig) {
    this.siteId = config.siteId;
    this.syncIntervalMs = config.syncIntervalMs ?? 30000;
    this.pushBatchSize = config.pushBatchSize ?? 50;
    this.localLookupFn = config.localLookupFn;
    this.conflictResolver = new ConflictResolver();
    this.cloudSyncKey = config.cloudSyncKey;
    this.cloudTlsFingerprint = config.cloudTlsFingerprint;

    this.syncClient = new SyncClient({
      baseUrl: config.cloudSyncUrl,
      syncKey: config.cloudSyncKey,
      tlsFingerprint: config.cloudTlsFingerprint,
    });

    this.offlineQueue = new OfflineQueue(config.queueDbPath ?? ':memory:');
    this.userAccountStore = new UserAccountStore(config.dataDir ? `${config.dataDir}/users.db` : ':memory:');

    // Initialize SyncRouter if routes are provided
    if (config.routes && config.routes.length > 0) {
      this.syncRouter = new SyncRouter(config.routes, config.cloudSyncKey, config.cloudTlsFingerprint);
    }

    this.healthMonitor = new HealthMonitor({
      syncClient: this.syncClient,
      checkDatabaseFn: config.checkDatabaseFn,
      checkRedisFn: config.checkRedisFn,
      intervalMs: config.healthCheckIntervalMs ?? 15000,
      forcedMode: config.operatingMode,
      syncRouter: this.syncRouter ?? undefined,
    });

    this.orgId = config.orgId;
    this.peerSyncPort = config.peerSyncPort;

    // Init peer manager for P2P sync between edge devices
    if (config.enablePeerSync && config.operatingMode !== 'CLOUD') {
      this.peerManager = new PeerManager({
        syncKey: config.cloudSyncKey,
        timeoutMs: 5000,
      });
      log.info('Peer sync enabled');
    }

    // Init realtime WebSocket channel for instant command delivery
    if (config.enableRealtime !== false && config.operatingMode !== 'CLOUD') {
      this.realtimeClient = new RealtimeClient({
        cloudSyncUrl: config.cloudSyncUrl,
        syncKey: config.cloudSyncKey,
        siteId: config.siteId,
      });
    }

    this.healthMonitor.onModeChange((newMode, previousMode) => {
      log.info({ newMode, previousMode }, 'Mode change');

      if (newMode === 'STANDALONE') {
        this.setStatus('standalone');
      } else if (newMode === 'EDGE' && previousMode === 'STANDALONE') {
        log.info('Cloud connectivity restored - draining offline queue');
        this.drainQueueAndSync().catch((err) => {
          log.error({ err }, 'Queue drain failed');
          this.setStatus('error', String(err));
        });
      }
    });
  }

  /**
   * Get the conflict resolver for module registration.
   */
  getConflictResolver(): ConflictResolver {
    return this.conflictResolver;
  }

  /**
   * Activate multi-backend routing after modules are loaded.
   * Called by the runtime once module manifests provide entity->product mapping.
   */
  setRoutes(routes: SyncRouteConfig[]): void {
    if (routes.length === 0) return;

    this.syncRouter = new SyncRouter(routes, this.cloudSyncKey, this.cloudTlsFingerprint);
    this.healthMonitor.setSyncRouter(this.syncRouter);
    log.info({ routeCount: routes.length }, 'Multi-backend routing activated');
  }

  /**
   * Get the SyncRouter (null if single-backend mode).
   */
  getSyncRouter(): SyncRouter | null {
    return this.syncRouter;
  }

  start(): void {
    log.info({ siteId: this.siteId, interval: this.syncIntervalMs }, 'Starting sync engine');

    this.healthMonitor.startMonitoring();

    // Start realtime WebSocket channel (sub-second command delivery)
    if (this.realtimeClient) {
      this.realtimeClient.start();
      log.info('Realtime command channel started');
    }

    this.syncIntervalHandle = setInterval(() => {
      this.tick().catch((err) => {
        log.error({ err }, 'Tick failed');
      });
    }, this.syncIntervalMs);

    this.tick().catch((err) => {
      log.error({ err }, 'Initial tick failed');
    });
  }

  stop(): void {
    log.info('Stopping sync engine');
    this.healthMonitor.stopMonitoring();

    if (this.syncIntervalHandle) {
      clearInterval(this.syncIntervalHandle);
      this.syncIntervalHandle = null;
    }

    this.setStatus('idle');
  }

  shutdown(): void {
    this.stop();
    if (this.realtimeClient) {
      this.realtimeClient.stop();
    }
    this.offlineQueue.close();
    this.userAccountStore.close();
  }

  trackChange(entity: SyncEntity): void {
    const targetUrl = this.syncRouter?.getTargetUrl(entity.type);

    if (this.healthMonitor.getCurrentMode() === 'STANDALONE') {
      this.offlineQueue.enqueue(entity.type, entity.action, entity.data, targetUrl);
      return;
    }
    this.localChanges.push(entity);
  }

  onStatusChange(callback: SyncEventCallback): void {
    this.eventCallbacks.push(callback);
  }

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

  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  getOfflineQueue(): OfflineQueue {
    return this.offlineQueue;
  }

  getPeerManager(): PeerManager | null {
    return this.peerManager;
  }

  getOperatingMode(): OperatingMode {
    return this.healthMonitor.getCurrentMode();
  }

  /**
   * Register a callback for when remote device config is received via heartbeat.
   * The runtime uses this to apply connector changes, sync settings, etc.
   */
  onConfigChange(callback: (config: DeviceConfigPayload) => void): void {
    this.configCallbacks.push(callback);
  }

  /**
   * Get the currently applied config version (reported back to cloud in heartbeat).
   */
  getAppliedConfigVersion(): number | undefined {
    return this.appliedConfigVersion;
  }

  /**
   * Register a handler for a specific realtime command (e.g., 'lockdown', 'door_unlock', 'print_job').
   * Commands arrive via WebSocket with sub-second latency.
   */
  onRealtimeCommand(commandName: string, handler: CommandHandler): void {
    if (this.realtimeClient) {
      this.realtimeClient.onCommand(commandName, handler);
    } else {
      log.warn({ commandName }, 'Cannot register realtime handler: realtime client not initialized');
    }
  }

  /**
   * Register a default handler for any unrecognized realtime commands.
   */
  onAnyRealtimeCommand(handler: CommandHandler): void {
    if (this.realtimeClient) {
      this.realtimeClient.onAnyCommand(handler);
    }
  }

  /**
   * Send a real-time event to the cloud (edge -> cloud instant push).
   * For access denied events, alarm triggers, etc.
   */
  sendRealtimeEvent(eventType: string, data: Record<string, unknown>): boolean {
    if (this.realtimeClient) {
      return this.realtimeClient.sendEvent(eventType, data);
    }
    return false;
  }

  /**
   * Check if the realtime WebSocket channel is connected.
   */
  isRealtimeConnected(): boolean {
    return this.realtimeClient?.isConnected() ?? false;
  }

  /**
   * Get the realtime client for advanced usage.
   */
  getRealtimeClient(): RealtimeClient | null {
    return this.realtimeClient;
  }

  private async tick(): Promise<void> {
    const mode = this.healthMonitor.getCurrentMode();

    // In CLOUD mode, the sync engine runs as server - no outbound sync
    if (mode === 'CLOUD') {
      return;
    }

    if (mode === 'STANDALONE') {
      this.flushChangesToQueue();
      return;
    }

    try {
      this.setStatus('syncing');

      await this.syncToCloud();
      await this.syncFromCloud();

      const stats = this.offlineQueue.getStats();
      const heartbeatReq: HeartbeatRequest = {
        siteId: this.siteId,
        mode,
        pendingChanges: stats.pending + this.localChanges.length,
        orgId: this.orgId,
        version: await this.getVersion(),
        hostname: (await import('node:os')).hostname(),
        nodeVersion: process.version,
        apiPort: this.peerSyncPort,
        ...(this.upgradeStatus && { upgradeStatus: this.upgradeStatus }),
        ...(this.upgradeError && { upgradeError: this.upgradeError }),
        ...(this.appliedConfigVersion && { configVersion: this.appliedConfigVersion }),
      };

      try {
        const osModule = await import('node:os');
        heartbeatReq.memoryUsageMb = Math.round((osModule.totalmem() - osModule.freemem()) / 1024 / 1024);
      } catch { /* ignore */ }

      try {
        const heartbeatResp = await this.syncClient.heartbeat(heartbeatReq);

        // Update peer list from heartbeat response
        if (this.peerManager && heartbeatResp.peers) {
          this.peerManager.updatePeers(heartbeatResp.peers);
        }

        if (this.upgradeStatus === 'SUCCESS' || this.upgradeStatus === 'FAILED') {
          this.upgradeStatus = undefined;
          this.upgradeError = undefined;
        }

        if (heartbeatResp.upgrade && !this.upgrading) {
          log.info({ targetVersion: heartbeatResp.upgrade.targetVersion }, 'Upgrade command received');
          this.executeUpgrade(heartbeatResp.upgrade.targetVersion).catch((err) => {
            log.error({ err }, 'Upgrade execution failed');
          });
        }

        // Apply remote device config if received
        if (heartbeatResp.config && heartbeatResp.config.version !== this.appliedConfigVersion) {
          log.info({ version: heartbeatResp.config.version }, 'Remote config received from cloud');
          this.appliedConfigVersion = heartbeatResp.config.version;
          for (const cb of this.configCallbacks) {
            try {
              cb(heartbeatResp.config);
            } catch (err) {
              log.error({ err }, 'Config change callback failed');
            }
          }
        }
      } catch (err) {
        log.warn({ err }, 'Heartbeat failed');
      }

      this.lastSyncAt = new Date();
      this.lastError = undefined;
      this.setStatus('synced');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errMsg;
      log.error({ error: errMsg }, 'Sync tick failed');

      // Attempt peer sync as fallback when cloud is unreachable
      if (this.peerManager && this.peerManager.getPeers().length > 0) {
        try {
          log.info('Cloud unreachable, attempting peer sync');
          const since = this.lastSyncAt ?? new Date(0);
          const pullResult = await this.peerManager.syncFromBestPeer(this.siteId, since);
          if (pullResult) {
            log.info('Peer pull succeeded');
            // Push pending changes to peers
            if (this.localChanges.length > 0) {
              await this.peerManager.pushToPeers(this.siteId, this.localChanges);
              this.localChanges = [];
            }
            this.lastSyncAt = new Date();
            this.setStatus('synced', 'peer');
            return;
          }
        } catch (peerErr) {
          log.warn({ err: peerErr }, 'Peer sync also failed');
        }
      }

      this.flushChangesToQueue();
      this.setStatus('error', errMsg);
    }
  }

  async syncToCloud(): Promise<void> {
    if (this.localChanges.length === 0) return;

    if (this.syncRouter) {
      // Multi-backend: route entities to correct backends
      while (this.localChanges.length > 0) {
        const batch = this.localChanges.splice(0, this.pushBatchSize);
        const result = await this.syncRouter.push(this.siteId, batch);

        if (result.errors > 0) {
          log.warn({ errors: result.errors, total: batch.length }, 'Routed push had errors');
        }
      }
    } else {
      // Single backend (backward compat)
      while (this.localChanges.length > 0) {
        const batch = this.localChanges.splice(0, this.pushBatchSize);
        const result = await this.syncClient.push(this.siteId, batch);

        if (result.errors > 0) {
          log.warn({ errors: result.errors, total: batch.length }, 'Push had errors');
        }
      }
    }
  }

  async syncFromCloud(): Promise<void> {
    const since = this.lastSyncAt ?? new Date(0);
    const response = this.syncRouter
      ? await this.syncRouter.pull(this.siteId, since)
      : await this.syncClient.pull(this.siteId, since);

    for (const [entityType, records] of Object.entries(response.data)) {
      if (!Array.isArray(records)) continue;

      // Handle user_account entities: full-replace local credentials from cloud
      if (entityType === 'user_account' || entityType === 'user_accounts') {
        const accounts: UserAccount[] = records
          .filter((r: any) => r.id)
          .map((r: any) => ({
            id: String(r.id),
            username: String(r.username),
            email: r.email ? String(r.email) : undefined,
            passwordHash: String(r.passwordHash ?? r.password_hash),
            role: String(r.role ?? 'viewer'),
            siteId: r.siteId ? String(r.siteId) : undefined,
            enabled: r.enabled !== false,
            syncedAt: new Date().toISOString(),
          }));

        if (accounts.length > 0) {
          await this.userAccountStore.replaceAll(accounts);
          log.info({ count: accounts.length }, 'User accounts synced from cloud');
        }
        continue;
      }

      for (const remoteRecord of records) {
        const remote = remoteRecord as SyncRecord;
        if (!remote.id) continue;

        const singularType = entityType.replace(/s$/, '');

        let resolved: SyncRecord;
        if (this.localLookupFn) {
          const local = await this.localLookupFn(singularType, remote.id);
          if (local) {
            resolved = this.conflictResolver.resolve(singularType, local, remote);
          } else {
            resolved = { ...remote };
          }
        } else {
          resolved = { ...remote };
        }

        void resolved;
      }
    }
  }

  async drainQueueAndSync(): Promise<void> {
    log.info('Draining offline queue');
    this.setStatus('syncing');

    let drained = 0;

    if (this.syncRouter) {
      // Multi-backend: dequeue grouped by target URL
      let grouped = this.offlineQueue.dequeueGrouped(this.pushBatchSize);

      while (grouped.size > 0) {
        for (const [targetUrl, batch] of grouped) {
          const entities: SyncEntity[] = batch.map((op) => ({
            type: op.entity,
            action: op.operation,
            data: JSON.parse(op.data),
            timestamp: op.createdAt,
          }));

          const client = targetUrl
            ? this.syncRouter.getClient(targetUrl)
            : null;

          try {
            const result = client
              ? await client.push(this.siteId, entities)
              : await this.syncClient.push(this.siteId, entities);
            const successIds = batch.map((op) => op.id);

            if (result.errors === 0) {
              this.offlineQueue.markComplete(successIds);
              drained += successIds.length;
            } else {
              this.offlineQueue.markFailed(successIds, `Partial push failure: ${result.errors} of ${batch.length} failed`);
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.offlineQueue.markFailed(batch.map((op) => op.id), errMsg);
            log.error({ error: errMsg, targetUrl }, 'Queue drain batch failed');
          }
        }

        grouped = this.offlineQueue.dequeueGrouped(this.pushBatchSize);
      }
    } else {
      // Single backend (backward compat)
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
            this.offlineQueue.markFailed(successIds, `Partial push failure: ${result.errors} of ${batch.length} failed`);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.offlineQueue.markFailed(batch.map((op) => op.id), errMsg);
          log.error({ error: errMsg }, 'Queue drain batch failed');
          break;
        }

        batch = this.offlineQueue.dequeue(this.pushBatchSize);
      }
    }

    log.info({ drained }, 'Queue drain complete');
    await this.syncFromCloud();
    this.lastSyncAt = new Date();
    this.lastError = undefined;
    this.setStatus('synced');
  }

  private async getVersion(): Promise<string> {
    if (this.currentVersion) return this.currentVersion;
    if (process.env.EDGERUNTIME_VERSION && process.env.EDGERUNTIME_VERSION !== 'dev') {
      this.currentVersion = process.env.EDGERUNTIME_VERSION;
      return this.currentVersion;
    }
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD']);
      this.currentVersion = stdout.trim();
    } catch {
      this.currentVersion = 'unknown';
    }
    return this.currentVersion;
  }

  private async executeUpgrade(targetVersion: string): Promise<void> {
    if (this.upgrading) return;
    this.upgrading = true;
    this.upgradeStatus = 'IN_PROGRESS';
    log.info({ targetVersion }, 'Starting upgrade');

    try {
      const updateScript = process.env.EDGE_UPDATE_SCRIPT || './deploy/edge/update.sh';
      await execFileAsync('bash', [updateScript], {
        timeout: 300000,
        env: { ...process.env, TARGET_VERSION: targetVersion },
      });

      this.currentVersion = undefined;
      const newVersion = await this.getVersion();
      log.info({ newVersion }, 'Upgrade succeeded');
      this.upgradeStatus = 'SUCCESS';
    } catch (err: any) {
      const errMsg = err.stderr || err.message || String(err);
      log.error({ error: errMsg }, 'Upgrade failed');
      this.upgradeStatus = 'FAILED';
      this.upgradeError = errMsg.slice(0, 500);
    } finally {
      this.upgrading = false;
    }
  }

  private flushChangesToQueue(): void {
    if (this.localChanges.length === 0) return;

    log.info({ count: this.localChanges.length }, 'Flushing changes to offline queue');
    for (const change of this.localChanges) {
      const targetUrl = this.syncRouter?.getTargetUrl(change.type);
      this.offlineQueue.enqueue(change.type, change.action, change.data, targetUrl);
    }
    this.localChanges = [];
  }

  private setStatus(status: SyncStatus, detail?: string): void {
    this.currentStatus = status;
    for (const callback of this.eventCallbacks) {
      try {
        callback(status, detail);
      } catch (err) {
        log.error({ err }, 'Status callback error');
      }
    }
  }
}
