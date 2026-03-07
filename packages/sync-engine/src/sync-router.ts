/**
 * SyncRouter
 *
 * Routes entities to the correct SyncClient based on entity type.
 * Each product's entities are synced to that product's cloud backend.
 * Supports live URL swapping for geo-failover without dropping queued changes.
 */

import type { ProductFlag } from '@edgeruntime/core';
import { createLogger } from '@edgeruntime/core';
import { SyncClient, type SyncEntity, type PullResponse } from './sync-client.js';

const log = createLogger('sync-router');

export interface SyncRouteConfig {
  product: ProductFlag;
  cloudSyncUrl: string;
  entityTypes: string[];
}

export class SyncRouter {
  private readonly syncKey: string;
  private readonly tlsFingerprint?: string;

  /** One SyncClient per unique cloudSyncUrl */
  private clients = new Map<string, SyncClient>();

  /** Maps entityType -> cloudSyncUrl */
  private entityRoutes = new Map<string, string>();

  /** Maps cloudSyncUrl -> SyncRouteConfig */
  private routeConfigs = new Map<string, SyncRouteConfig>();

  constructor(
    routes: SyncRouteConfig[],
    syncKey: string,
    tlsFingerprint?: string,
  ) {
    this.syncKey = syncKey;
    this.tlsFingerprint = tlsFingerprint;

    for (const route of routes) {
      this.addRoute(route);
    }
  }

  private addRoute(route: SyncRouteConfig): void {
    // Create client if we don't have one for this URL
    if (!this.clients.has(route.cloudSyncUrl)) {
      this.clients.set(
        route.cloudSyncUrl,
        new SyncClient({
          baseUrl: route.cloudSyncUrl,
          syncKey: this.syncKey,
          tlsFingerprint: this.tlsFingerprint,
        }),
      );
    }

    this.routeConfigs.set(route.cloudSyncUrl, route);

    // Map each entity type to this URL
    for (const entityType of route.entityTypes) {
      this.entityRoutes.set(entityType, route.cloudSyncUrl);
    }

    log.info(
      { product: route.product, url: route.cloudSyncUrl, entityTypes: route.entityTypes },
      'Route added',
    );
  }

  /**
   * Get the target URL for an entity type.
   * Returns undefined if no route is configured (falls back to primary).
   */
  getTargetUrl(entityType: string): string | undefined {
    return this.entityRoutes.get(entityType);
  }

  /**
   * Get all configured cloud sync URLs.
   */
  getAllUrls(): string[] {
    return [...this.clients.keys()];
  }

  /**
   * Get a SyncClient by URL.
   */
  getClient(url: string): SyncClient | undefined {
    return this.clients.get(url);
  }

  /**
   * Get all SyncClients.
   */
  getAllClients(): Map<string, SyncClient> {
    return new Map(this.clients);
  }

  /**
   * Push entities to the correct backend(s), grouped by target URL.
   */
  async push(siteId: string, entities: SyncEntity[]): Promise<{ synced: number; errors: number }> {
    // Group entities by target URL
    const grouped = new Map<string, SyncEntity[]>();

    for (const entity of entities) {
      const targetUrl = this.entityRoutes.get(entity.type);
      if (!targetUrl) {
        log.warn({ entityType: entity.type }, 'No route for entity type, skipping');
        continue;
      }
      const batch = grouped.get(targetUrl) ?? [];
      batch.push(entity);
      grouped.set(targetUrl, batch);
    }

    let totalSynced = 0;
    let totalErrors = 0;

    // Push to each backend in parallel
    const pushPromises = [...grouped.entries()].map(async ([url, batch]) => {
      const client = this.clients.get(url);
      if (!client) {
        log.error({ url }, 'No client for URL');
        totalErrors += batch.length;
        return;
      }

      try {
        const result = await client.push(siteId, batch);
        totalSynced += result.synced;
        totalErrors += result.errors;
      } catch (err) {
        log.error({ url, err }, 'Push to backend failed');
        totalErrors += batch.length;
        throw err;
      }
    });

    await Promise.allSettled(pushPromises);

    return { synced: totalSynced, errors: totalErrors };
  }

  /**
   * Pull from ALL backends, merge results.
   */
  async pull(siteId: string, since: Date): Promise<PullResponse> {
    const mergedData: Record<string, unknown[]> = {};
    let latestTimestamp = since.toISOString();

    const pullPromises = [...this.clients.entries()].map(async ([url, client]) => {
      try {
        const response = await client.pull(siteId, since);

        // Merge data from this backend
        for (const [entityType, records] of Object.entries(response.data)) {
          if (!Array.isArray(records)) continue;
          if (!mergedData[entityType]) {
            mergedData[entityType] = [];
          }
          mergedData[entityType].push(...records);
        }

        if (response.timestamp > latestTimestamp) {
          latestTimestamp = response.timestamp;
        }
      } catch (err) {
        log.error({ url, err }, 'Pull from backend failed');
      }
    });

    await Promise.allSettled(pullPromises);

    return { data: mergedData, timestamp: latestTimestamp };
  }

  /**
   * Check health of all backends.
   */
  async checkAllHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    const checks = [...this.clients.entries()].map(async ([url, client]) => {
      try {
        const healthy = await client.checkHealth();
        results.set(url, healthy);
      } catch {
        results.set(url, false);
      }
    });

    await Promise.allSettled(checks);
    return results;
  }

  /**
   * Live URL swap for geo-failover.
   * Moves all entity routes from oldUrl to newUrl, creates new client.
   * Does not drop queued changes — they'll be sent to the new URL.
   */
  updateRoute(oldUrl: string, newUrl: string): void {
    if (oldUrl === newUrl) return;

    const oldConfig = this.routeConfigs.get(oldUrl);
    if (!oldConfig) {
      log.warn({ oldUrl }, 'No route config found for URL to update');
      return;
    }

    log.info({ oldUrl, newUrl, product: oldConfig.product }, 'Updating route (failover)');

    // Create new client for the new URL
    if (!this.clients.has(newUrl)) {
      this.clients.set(
        newUrl,
        new SyncClient({
          baseUrl: newUrl,
          syncKey: this.syncKey,
          tlsFingerprint: this.tlsFingerprint,
        }),
      );
    }

    // Update entity routes to point to new URL
    for (const entityType of oldConfig.entityTypes) {
      this.entityRoutes.set(entityType, newUrl);
    }

    // Move route config
    const newConfig: SyncRouteConfig = { ...oldConfig, cloudSyncUrl: newUrl };
    this.routeConfigs.set(newUrl, newConfig);
    this.routeConfigs.delete(oldUrl);

    // Remove old client
    this.clients.delete(oldUrl);
  }
}
