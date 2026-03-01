/**
 * Federation Manager
 *
 * Copied from EdgeRuntime packages/sync-engine/src/federation-manager.ts
 * Orchestrates cross-product event federation between edge VMs on the same LAN.
 * Uses HMAC-authenticated HTTP over plain HTTP for LAN communication.
 *
 * - Push: forward connector events matching route entityTypes to peer VMs
 * - Pull: fetch analytics results back from peers (e.g., BadgeGuard → SafeSchool)
 * - Subscription-gated: only federates if target product is in activation key
 */

import crypto from 'node:crypto';
import { createLogger } from './edge-logger.js';

const log = createLogger('federation');

// Federation-specific types (mirrored from @edgeruntime/core)
export type ProductFlag = 'badgekiosk' | 'buildkiosk' | 'badgeguard' | 'safeschool' | 'access-gsoc' | 'mechanickiosk';

export interface FederationPeer {
  product: ProductFlag;
  host: string;
  apiPort: number;
  syncKey?: string;
}

export interface FederationRoute {
  targetProduct: ProductFlag;
  entityTypes: string[];
  direction: 'push' | 'pull' | 'both';
}

export interface FederationConfig {
  enabled: boolean;
  peers: FederationPeer[];
  routes: FederationRoute[];
}

export interface FederationManagerConfig {
  federation: FederationConfig;
  enabledProducts: ProductFlag[];
  siteId: string;
  syncKey: string;
}

export interface FederationStatus {
  peers: Array<{
    product: string;
    host: string;
    apiPort: number;
    reachable: boolean;
    lastPushAt: string | null;
    lastPullAt: string | null;
    subscriptionGated: boolean;
  }>;
}

export type FederationEventHandler = (fromProduct: string, events: Record<string, unknown>[]) => Record<string, unknown>[];

interface PeerState {
  peer: FederationPeer;
  reachable: boolean;
  lastPushAt: Date | null;
  lastPullAt: Date | null;
}

export class FederationManager {
  private readonly config: FederationConfig;
  private readonly enabledProducts: ProductFlag[];
  private readonly siteId: string;
  private readonly syncKey: string;
  private readonly peerStates = new Map<string, PeerState>();
  private readonly analyticsBuffer: Record<string, unknown>[] = [];
  private readonly maxAnalytics = 500;
  private pendingEvents: Record<string, unknown>[] = [];
  private eventHandlers: FederationEventHandler[] = [];
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private pullInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: FederationManagerConfig) {
    this.config = config.federation;
    this.enabledProducts = config.enabledProducts;
    this.siteId = config.siteId;
    this.syncKey = config.syncKey;

    for (const peer of this.config.peers) {
      this.peerStates.set(peer.product, {
        peer,
        reachable: false,
        lastPushAt: null,
        lastPullAt: null,
      });
    }
  }

  /** Start federation ticks (push every 5s, pull every 10s). */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.tickInterval = setInterval(() => this.pushTick(), 5000);
    this.pullInterval = setInterval(() => this.pullTick(), 10000);

    log.info({
      peers: this.config.peers.map(p => p.product),
      routes: this.config.routes.length,
    }, 'Federation started');
  }

  /** Register a handler for inbound federated events. */
  registerHandler(handler: FederationEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /** Called by ConnectorEventBuffer.onPush listener — queues events for federation. */
  onConnectorEvents(_connectorName: string, events: Record<string, unknown>[]): void {
    const local = events.filter(e => !e._federatedFrom);
    if (local.length > 0) {
      this.pendingEvents.push(...local);
    }
  }

  /** Handle inbound federated events from a peer. */
  handleInboundEvents(fromProduct: string, events: Record<string, unknown>[]): Record<string, unknown>[] {
    log.info({ from: fromProduct, count: events.length }, 'Inbound federated events');

    const tagged: Record<string, unknown>[] = events.map(e => ({
      ...e,
      _federatedFrom: fromProduct,
      _federatedAt: new Date().toISOString(),
    }));

    const analytics = tagged.filter(e => e.type === 'analytics');
    const nonAnalytics = tagged.filter(e => e.type !== 'analytics');

    for (const a of analytics) {
      this.analyticsBuffer.push(a);
      if (this.analyticsBuffer.length > this.maxAnalytics) {
        this.analyticsBuffer.shift();
      }
    }

    for (const handler of this.eventHandlers) {
      try {
        const results = handler(fromProduct, tagged);
        if (results.length > 0) {
          this.pendingEvents.push(...results);
          for (const r of results) {
            this.analyticsBuffer.push({ ...r, _federatedAt: new Date().toISOString() });
            if (this.analyticsBuffer.length > this.maxAnalytics) {
              this.analyticsBuffer.shift();
            }
          }
        }
      } catch (err) {
        log.warn({ fromProduct, err }, 'Federation event handler failed');
      }
    }

    return nonAnalytics;
  }

  /** Get federated analytics (for GET /api/v1/federation/analytics). */
  getAnalytics(since?: string): Record<string, unknown>[] {
    if (since) {
      return this.analyticsBuffer.filter(a => (a._federatedAt as string) >= since);
    }
    return [...this.analyticsBuffer];
  }

  /** Get federation status for all peers. */
  getStatus(): FederationStatus {
    const peers = [];
    for (const [product, state] of this.peerStates) {
      peers.push({
        product,
        host: state.peer.host,
        apiPort: state.peer.apiPort,
        reachable: state.reachable,
        lastPushAt: state.lastPushAt?.toISOString() ?? null,
        lastPullAt: state.lastPullAt?.toISOString() ?? null,
        subscriptionGated: !this.isSubscribed(product as ProductFlag),
      });
    }
    return { peers };
  }

  shutdown(): void {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.pullInterval) {
      clearInterval(this.pullInterval);
      this.pullInterval = null;
    }
    log.info('Federation shut down');
  }

  // ─── Private ───────────────────────────────────────────────────

  private isSubscribed(product: ProductFlag): boolean {
    return this.enabledProducts.includes(product);
  }

  private getRoutesForPeer(product: ProductFlag): FederationRoute[] {
    return this.config.routes.filter(
      r => r.targetProduct === product && (r.direction === 'push' || r.direction === 'both'),
    );
  }

  private getPullRoutes(): FederationRoute[] {
    return this.config.routes.filter(
      r => r.direction === 'pull' || r.direction === 'both',
    );
  }

  private async pushTick(): Promise<void> {
    if (this.pendingEvents.length === 0) return;

    const events = this.pendingEvents.splice(0);

    for (const [product, state] of this.peerStates) {
      if (!this.isSubscribed(product as ProductFlag)) continue;

      const routes = this.getRoutesForPeer(product as ProductFlag);
      if (routes.length === 0) continue;

      const allowedTypes = new Set(routes.flatMap(r => r.entityTypes));

      const matching = events.filter(e => {
        const eventType = (e.type ?? e.eventType ?? '') as string;
        return allowedTypes.has(eventType);
      });

      if (matching.length === 0) continue;

      try {
        await this.federationPush(state.peer, matching);
        state.reachable = true;
        state.lastPushAt = new Date();
        log.debug({ product, count: matching.length }, 'Pushed federated events');
      } catch (err) {
        state.reachable = false;
        log.warn({ product, err }, 'Federation push failed');
      }
    }
  }

  private async pullTick(): Promise<void> {
    const pullRoutes = this.getPullRoutes();
    if (pullRoutes.length === 0) return;

    for (const route of pullRoutes) {
      const state = this.peerStates.get(route.targetProduct);
      if (!state) continue;
      if (!this.isSubscribed(route.targetProduct)) continue;

      try {
        const since = state.lastPullAt?.toISOString() ?? new Date(Date.now() - 60_000).toISOString();
        const result = await this.federationPull(state.peer, since);
        if (result.events && result.events.length > 0) {
          this.handleInboundEvents(route.targetProduct, result.events);
          log.debug({ product: route.targetProduct, count: result.events.length }, 'Pulled federated analytics');
        }
        state.reachable = true;
        state.lastPullAt = new Date();
      } catch (err) {
        state.reachable = false;
        log.debug({ product: route.targetProduct, err }, 'Federation pull failed');
      }
    }
  }

  // ─── HTTP helpers (HMAC-signed, plain HTTP for LAN) ───────────

  private async federationPush(
    peer: FederationPeer,
    events: Record<string, unknown>[],
  ): Promise<void> {
    const url = `http://${peer.host}:${peer.apiPort}/api/v1/federation/push`;
    const body = JSON.stringify({ fromProduct: this.siteId, events });
    const key = peer.syncKey ?? this.syncKey;

    await this.signedRequest('POST', url, body, key);
  }

  private async federationPull(
    peer: FederationPeer,
    since: string,
  ): Promise<{ events: Record<string, unknown>[] }> {
    const url = `http://${peer.host}:${peer.apiPort}/api/v1/federation/analytics?since=${encodeURIComponent(since)}`;
    const key = peer.syncKey ?? this.syncKey;

    const res = await this.signedRequest('GET', url, '', key);
    return (await res.json()) as { events: Record<string, unknown>[] };
  }

  private async signedRequest(
    method: 'GET' | 'POST',
    url: string,
    body: string,
    syncKey: string,
  ): Promise<Response> {
    const timestamp = new Date().toISOString();
    const path = new URL(url).pathname + new URL(url).search;
    const payload = `${timestamp}.${method}.${path}.${body}`;
    const signature = crypto.createHmac('sha256', syncKey).update(payload).digest('hex');

    const headers: Record<string, string> = {
      'X-Sync-Key': syncKey,
      'X-Sync-Timestamp': timestamp,
      'X-Sync-Signature': signature,
      'Content-Type': 'application/json',
    };

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(5000) };
    if (body && method === 'POST') init.body = body;

    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`Federation ${method} ${path} failed: HTTP ${response.status}`);
    }
    return response;
  }
}
