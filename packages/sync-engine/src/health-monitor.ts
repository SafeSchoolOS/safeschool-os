/**
 * EdgeRuntime Health Monitor
 *
 * Monitors cloud connectivity, local database, and Redis health.
 * Determines operating mode (EDGE / STANDALONE / CLOUD) and emits events
 * on mode transitions.
 * Ported from SafeSchool with CLOUD mode addition.
 */

import type { OperatingMode } from '@edgeruntime/core';
import { createLogger } from '@edgeruntime/core';
import { SyncClient } from './sync-client.js';
import type { SyncRouter } from './sync-router.js';

const log = createLogger('health-monitor');

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  cloud: boolean;
  database: boolean;
  redis: boolean;
  overall: HealthStatus;
  operatingMode: OperatingMode;
  timestamp: Date;
}

export type ModeChangeCallback = (newMode: OperatingMode, previousMode: OperatingMode) => void;

export interface HealthMonitorConfig {
  syncClient: SyncClient;
  checkDatabaseFn?: () => Promise<boolean>;
  checkRedisFn?: () => Promise<boolean>;
  intervalMs?: number;
  /** Force a specific operating mode (e.g., 'CLOUD' for cloud deployments) */
  forcedMode?: OperatingMode;
  /** Optional SyncRouter for multi-backend health checks */
  syncRouter?: SyncRouter;
  /** Callback when a backend fails health check (for failover) */
  onBackendFailure?: (failedUrl: string) => void;
}

export class HealthMonitor {
  private syncClient: SyncClient;
  private syncRouter?: SyncRouter;
  private checkDatabaseFn: () => Promise<boolean>;
  private checkRedisFn: () => Promise<boolean>;
  private intervalMs: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentMode: OperatingMode;
  private forcedMode?: OperatingMode;
  private modeChangeCallbacks: ModeChangeCallback[] = [];
  private lastHealthCheck: HealthCheckResult | null = null;
  private cloudHealthy = false;
  private healthByUrl = new Map<string, boolean>();
  private onBackendFailure?: (failedUrl: string) => void;

  constructor(config: HealthMonitorConfig) {
    this.syncClient = config.syncClient;
    this.syncRouter = config.syncRouter;
    this.checkDatabaseFn = config.checkDatabaseFn ?? HealthMonitor.defaultDatabaseCheck;
    this.checkRedisFn = config.checkRedisFn ?? HealthMonitor.defaultRedisCheck;
    this.intervalMs = config.intervalMs ?? 15000;
    this.forcedMode = config.forcedMode;
    this.currentMode = config.forcedMode ?? 'EDGE';
    this.onBackendFailure = config.onBackendFailure;
  }

  /**
   * Set or update the SyncRouter (called when routing is activated after boot).
   */
  setSyncRouter(router: SyncRouter): void {
    this.syncRouter = router;
  }

  async checkCloudConnectivity(): Promise<boolean> {
    try {
      // If we have a SyncRouter, check all backends in parallel
      if (this.syncRouter) {
        const results = await this.syncRouter.checkAllHealth();
        let anyHealthy = false;

        for (const [url, healthy] of results) {
          const wasHealthy = this.healthByUrl.get(url);
          this.healthByUrl.set(url, healthy);

          if (healthy) {
            anyHealthy = true;
          } else if (wasHealthy !== false && this.onBackendFailure) {
            // Backend just went down — trigger failover callback
            this.onBackendFailure(url);
          }
        }

        // STANDALONE only if ALL backends are unreachable
        return anyHealthy;
      }

      // Single client fallback
      return await this.syncClient.checkHealth();
    } catch {
      return false;
    }
  }

  /**
   * Get per-backend health status. Only populated when using SyncRouter.
   */
  getHealthByUrl(): Map<string, boolean> {
    return new Map(this.healthByUrl);
  }

  async checkDatabase(): Promise<boolean> {
    try {
      return await this.checkDatabaseFn();
    } catch {
      return false;
    }
  }

  async checkRedis(): Promise<boolean> {
    try {
      return await this.checkRedisFn();
    } catch {
      return false;
    }
  }

  async performHealthCheck(): Promise<HealthCheckResult> {
    // In CLOUD mode, skip cloud connectivity check (we ARE the cloud)
    const isCloudMode = this.forcedMode === 'CLOUD';

    const [cloud, database, redis] = await Promise.all([
      isCloudMode ? Promise.resolve(true) : this.checkCloudConnectivity(),
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const previousMode = this.currentMode;
    this.cloudHealthy = cloud;

    const newMode = this.forcedMode ?? this.getOperatingMode();

    let overall: HealthStatus = 'healthy';
    if (!cloud && !database) {
      overall = 'unhealthy';
    } else if (!cloud || !database || !redis) {
      overall = 'degraded';
    }

    const result: HealthCheckResult = {
      cloud,
      database,
      redis,
      overall,
      operatingMode: newMode,
      timestamp: new Date(),
    };

    this.lastHealthCheck = result;

    if (newMode !== previousMode) {
      this.currentMode = newMode;
      for (const callback of this.modeChangeCallbacks) {
        try {
          callback(newMode, previousMode);
        } catch (err) {
          log.error({ err }, 'Mode change callback error');
        }
      }
    }

    return result;
  }

  getOperatingMode(): OperatingMode {
    if (this.forcedMode) return this.forcedMode;
    return this.cloudHealthy ? 'EDGE' : 'STANDALONE';
  }

  getCurrentMode(): OperatingMode {
    return this.currentMode;
  }

  getLastHealthCheck(): HealthCheckResult | null {
    return this.lastHealthCheck;
  }

  onModeChange(callback: ModeChangeCallback): void {
    this.modeChangeCallbacks.push(callback);
  }

  offModeChange(callback: ModeChangeCallback): void {
    this.modeChangeCallbacks = this.modeChangeCallbacks.filter((cb) => cb !== callback);
  }

  startMonitoring(intervalMs?: number): void {
    if (this.intervalHandle) this.stopMonitoring();

    const interval = intervalMs ?? this.intervalMs;
    log.info({ interval }, 'Starting health monitoring');

    this.performHealthCheck().catch((err) => {
      log.error({ err }, 'Initial health check failed');
    });

    this.intervalHandle = setInterval(() => {
      this.performHealthCheck().catch((err) => {
        log.error({ err }, 'Periodic health check failed');
      });
    }, interval);
  }

  stopMonitoring(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      log.info('Monitoring stopped');
    }
  }

  isMonitoring(): boolean {
    return this.intervalHandle !== null;
  }

  private static async defaultDatabaseCheck(): Promise<boolean> {
    return true;
  }

  private static async defaultRedisCheck(): Promise<boolean> {
    return true;
  }
}
