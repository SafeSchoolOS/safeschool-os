/**
 * SafeSchool Health Monitor
 *
 * Monitors cloud connectivity, local database, and Redis health.
 * Determines operating mode (EDGE vs STANDALONE) and emits events
 * on mode transitions.
 */

import type { OperatingMode } from '@safeschool/core';
import { SyncClient } from './sync-client.js';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  cloud: boolean;
  database: boolean;
  redis: boolean;
  overall: HealthStatus;
  operatingMode: OperatingMode;
  timestamp: Date;
}

export type ModeChangeCallback = (
  newMode: OperatingMode,
  previousMode: OperatingMode,
) => void;

export interface HealthMonitorConfig {
  syncClient: SyncClient;
  /** Function to check database connectivity (e.g., SELECT 1) */
  checkDatabaseFn?: () => Promise<boolean>;
  /** Function to check Redis connectivity (e.g., PING) */
  checkRedisFn?: () => Promise<boolean>;
  /** Health check interval in milliseconds. Default: 15000 (15s) */
  intervalMs?: number;
  /** Cloud health check timeout in milliseconds. Default: 5000 */
  cloudTimeoutMs?: number;
}

export class HealthMonitor {
  private syncClient: SyncClient;
  private checkDatabaseFn: () => Promise<boolean>;
  private checkRedisFn: () => Promise<boolean>;
  private intervalMs: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentMode: OperatingMode = 'EDGE';
  private modeChangeCallbacks: ModeChangeCallback[] = [];
  private lastHealthCheck: HealthCheckResult | null = null;
  private cloudHealthy = false;

  constructor(config: HealthMonitorConfig) {
    this.syncClient = config.syncClient;
    this.checkDatabaseFn = config.checkDatabaseFn ?? HealthMonitor.defaultDatabaseCheck;
    this.checkRedisFn = config.checkRedisFn ?? HealthMonitor.defaultRedisCheck;
    this.intervalMs = config.intervalMs ?? 15000;
  }

  /**
   * Check if the cloud API is reachable.
   */
  async checkCloudConnectivity(): Promise<boolean> {
    try {
      return await this.syncClient.checkHealth();
    } catch {
      return false;
    }
  }

  /**
   * Check if the local database is accessible.
   */
  async checkDatabase(): Promise<boolean> {
    try {
      return await this.checkDatabaseFn();
    } catch {
      return false;
    }
  }

  /**
   * Check if Redis is accessible.
   */
  async checkRedis(): Promise<boolean> {
    try {
      return await this.checkRedisFn();
    } catch {
      return false;
    }
  }

  /**
   * Perform a full health check and return the result.
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const [cloud, database, redis] = await Promise.all([
      this.checkCloudConnectivity(),
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const previousMode = this.currentMode;
    this.cloudHealthy = cloud;

    // Determine operating mode
    const newMode = this.getOperatingMode();

    // Determine overall health
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

    // Emit mode change if it changed
    if (newMode !== previousMode) {
      this.currentMode = newMode;
      for (const callback of this.modeChangeCallbacks) {
        try {
          callback(newMode, previousMode);
        } catch (err) {
          console.error('[HealthMonitor] Mode change callback error:', err);
        }
      }
    }

    return result;
  }

  /**
   * Get the current operating mode based on cloud connectivity.
   * EDGE = cloud reachable, STANDALONE = cloud unreachable.
   */
  getOperatingMode(): OperatingMode {
    if (this.cloudHealthy) {
      return 'EDGE';
    }
    return 'STANDALONE';
  }

  /**
   * Get the current mode without performing a health check.
   */
  getCurrentMode(): OperatingMode {
    return this.currentMode;
  }

  /**
   * Get the last health check result, or null if none has been performed.
   */
  getLastHealthCheck(): HealthCheckResult | null {
    return this.lastHealthCheck;
  }

  /**
   * Register a callback to be invoked when the operating mode changes.
   */
  onModeChange(callback: ModeChangeCallback): void {
    this.modeChangeCallbacks.push(callback);
  }

  /**
   * Remove a previously registered mode change callback.
   */
  offModeChange(callback: ModeChangeCallback): void {
    this.modeChangeCallbacks = this.modeChangeCallbacks.filter(
      (cb) => cb !== callback,
    );
  }

  /**
   * Start periodic health monitoring.
   */
  startMonitoring(intervalMs?: number): void {
    if (this.intervalHandle) {
      this.stopMonitoring();
    }

    const interval = intervalMs ?? this.intervalMs;
    console.log(`[HealthMonitor] Starting monitoring every ${interval}ms`);

    // Run an immediate check
    this.performHealthCheck().catch((err) => {
      console.error('[HealthMonitor] Initial health check failed:', err);
    });

    this.intervalHandle = setInterval(() => {
      this.performHealthCheck().catch((err) => {
        console.error('[HealthMonitor] Periodic health check failed:', err);
      });
    }, interval);
  }

  /**
   * Stop periodic health monitoring.
   */
  stopMonitoring(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[HealthMonitor] Monitoring stopped');
    }
  }

  /**
   * Check if monitoring is currently active.
   */
  isMonitoring(): boolean {
    return this.intervalHandle !== null;
  }

  // ---- Default check functions (stubs that can be replaced via config) ----

  private static async defaultDatabaseCheck(): Promise<boolean> {
    // In a real deployment, this would do: SELECT 1 from the local PostgreSQL
    console.warn('[HealthMonitor] Using default database check stub (always true)');
    return true;
  }

  private static async defaultRedisCheck(): Promise<boolean> {
    // In a real deployment, this would do: redis.ping()
    console.warn('[HealthMonitor] Using default Redis check stub (always true)');
    return true;
  }
}
