/**
 * EdgeRuntime API Server
 *
 * Fastify HTTP health endpoint + WebSocket broadcast.
 * In CLOUD mode, also mounts cloud-sync routes (sync, fleet, license).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { createLogger, type OperatingMode } from '@edgeruntime/core';
import type { SyncEngine, UserAccountStore, FederationManager } from '@edgeruntime/sync-engine';
import type { ModuleRegistry } from '@edgeruntime/module-loader';
import type { ConnectorRegistry } from '@edgeruntime/connector-framework';
import type { SyncDatabaseAdapter, LicenseDatabaseAdapter, UserDatabaseAdapter, RealtimeChannel } from '@edgeruntime/cloud-sync';

const log = createLogger('api-server');

export interface CloudModeOptions {
  /** Shared HMAC key for edge device request verification */
  syncKey: string;
  /** Database adapter for sync/fleet operations */
  syncAdapter: SyncDatabaseAdapter;
  /** Database adapter for license/subscription operations */
  licenseAdapter: LicenseDatabaseAdapter;
  /** Extract org ID from request (for license routes). Default: reads x-org-id header */
  getOrgId?: (request: any) => string;
  /** User database adapter for OAuth-based dashboard login */
  userAdapter?: UserDatabaseAdapter;
  /** Optional HTML string to serve at "/" as the product homepage/landing page */
  homepageHtml?: string;
}

export interface ApiServerDeps {
  syncEngine: SyncEngine;
  moduleRegistry: ModuleRegistry;
  connectorRegistry: ConnectorRegistry;
  port: number;
  operatingMode?: OperatingMode;
  cloudOptions?: CloudModeOptions;
  /** User account store for edge auth (synced from cloud) */
  userAccountStore?: UserAccountStore;
  /** Recent connector events buffer (ring buffer) */
  connectorEvents?: ConnectorEventBuffer;
  /** Federation manager for cross-product event sharing */
  federationManager?: FederationManager;
}

/**
 * Ring buffer for recent connector events.
 * Stores the last N events in memory for API access.
 */
export type ConnectorEventListener = (connectorName: string, events: Record<string, unknown>[]) => void;

export class ConnectorEventBuffer {
  private events: Record<string, unknown>[] = [];
  private readonly maxSize: number;
  private listeners: ConnectorEventListener[] = [];

  /**
   * @param maxSize - Maximum number of events to retain in the ring buffer.
   *                  Oldest events are evicted when this limit is exceeded.
   */
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Register a listener that fires whenever new events are pushed.
   * Used by FederationManager to forward connector events to peer VMs.
   * @param listener - Callback receiving the connector name and new events.
   */
  onPush(listener: ConnectorEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Append events from a connector into the ring buffer.
   * Each event is tagged with `_connector` (source name) and `_receivedAt` (ISO timestamp).
   * If the buffer exceeds `maxSize`, the oldest event is evicted (FIFO).
   * All registered listeners are notified after insertion.
   * @param connectorName - Identifier of the connector that produced the events.
   * @param events - Array of raw event objects from the connector.
   */
  push(connectorName: string, events: Record<string, unknown>[]): void {
    for (const event of events) {
      this.events.push({ ...event, _connector: connectorName, _receivedAt: new Date().toISOString() });
      if (this.events.length > this.maxSize) {
        this.events.shift();
      }
    }
    for (const listener of this.listeners) {
      try { listener(connectorName, events); } catch { /* ignore listener errors */ }
    }
  }

  /** Return all events currently in the buffer (oldest first). */
  getAll(): Record<string, unknown>[] {
    return this.events;
  }

  /**
   * Return events received at or after the given ISO timestamp.
   * Comparison is lexicographic on the `_receivedAt` field.
   * @param since - ISO 8601 timestamp lower bound (inclusive).
   */
  getSince(since: string): Record<string, unknown>[] {
    return this.events.filter(e => (e._receivedAt as string) >= since);
  }

  /** Current number of events stored in the buffer. */
  get count(): number {
    return this.events.length;
  }
}

export interface ApiServerResult {
  app: FastifyInstance;
  realtimeChannel?: RealtimeChannel;
}

// ─── Simple JWT (HMAC-SHA256) ──────────────────────────────────────────────
// Lightweight JWT implementation for dashboard auth. Uses a server-side secret
// (EDGERUNTIME_JWT_SECRET env var) or generates a random one per process start.
// This avoids pulling in a full JWT library for the minimal claims we need.

/** HMAC secret used for signing/verifying JWTs.
 * In production, EDGERUNTIME_JWT_SECRET MUST be set — otherwise multiple pods
 * each generate their own random secret and tokens fail to verify across pods.
 * Dev/test fall back to a random per-process secret.
 */
const JWT_SECRET: string = (() => {
  if (process.env.EDGERUNTIME_JWT_SECRET) return process.env.EDGERUNTIME_JWT_SECRET;
  const env = (process.env.NODE_ENV || '').toLowerCase();
  const isProd = env === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  if (isProd) {
    throw new Error(
      'EDGERUNTIME_JWT_SECRET is required in production (horizontal scaling breaks otherwise).'
    );
  }
  return randomBytes(32).toString('hex');
})();
/** JWT token lifetime in seconds (24 hours). */
const JWT_EXPIRY_S = 86400; // 24 hours

/**
 * Sign a JWT token with HMAC-SHA256.
 *
 * Creates a compact JWS (header.payload.signature) with `iat` and `exp` claims
 * automatically injected. Used for dashboard login tokens and inter-service auth.
 *
 * @param payload - Arbitrary claims to include (e.g. `sub`, `username`, `role`, `orgId`).
 * @returns Compact JWT string (base64url-encoded header.payload.signature).
 */
function signJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_S })).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode a JWT token signed with HMAC-SHA256.
 *
 * Performs timing-safe signature comparison to prevent timing attacks,
 * then checks the `exp` claim for expiry. Returns null on any failure
 * (bad format, invalid signature, expired) rather than throwing.
 *
 * @param token - Compact JWT string to verify.
 * @returns Decoded payload object, or null if verification fails.
 */
function verifyJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');

  // Timing-safe comparison prevents side-channel attacks on signature
  if (!timingSafeEqual(Buffer.from(signature!), Buffer.from(expected))) return null;

  const payload = JSON.parse(Buffer.from(body!, 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

export async function createApiServer(deps: ApiServerDeps): Promise<ApiServerResult> {
  const app = Fastify({ logger: false });
  let realtimeChannel: RealtimeChannel | undefined;

  // ─── CORS Configuration ──────────────────────────────────────────────
  // CORS must be permissive enough for three access patterns:
  //   1. Product frontends on custom domains (safeschoolos.org, safeschoolos.org, etc.)
  //   2. Railway staging/preview deployments (*.up.railway.app)
  //   3. Edge appliance dashboards accessed by LAN IP (192.168.x.x, 10.x.x.x)
  // Override the default allowlist via CORS_ALLOWED_ORIGINS env var (comma-separated).
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['https://safeschoolos.org', 'https://edge.safeschool.org',
       'https://safeschoolos.org', 'https://safeschoolos.org', 'https://safeschoolos.org'];
  // Trusted Railway subdomains for first-party deploys. Anything else under
  // *.up.railway.app is another Railway tenant and must NOT be trusted with
  // credentials. Override via env when a new deploy is added.
  const trustedRailwaySubs = new Set(
    (process.env.CORS_RAILWAY_ALLOW ||
      'api-production-5f06.up.railway.app,safeschool.up.railway.app,jubilant-alignment-production-d240.up.railway.app'
    ).split(',').map(s => s.trim()).filter(Boolean)
  );
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // No origin = server-to-server call, curl, or same-origin — always allow
      if (!origin) return cb(null, true);
      // Localhost = local development (Vite dev server, etc.)
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return cb(null, true);
      // Trusted Railway subdomains only — do NOT blanket-allow *.up.railway.app,
      // since every other Railway tenant would then be trusted with credentials.
      try {
        const u = new URL(origin);
        if (u.hostname.endsWith('.up.railway.app') && trustedRailwaySubs.has(u.hostname)) {
          return cb(null, true);
        }
        // Raw IP address = edge appliance on LAN (Mini PC accessed via 192.168.x.x).
        // Only accept RFC1918 ranges; block public IPs to prevent open-origin credential riding.
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)) {
          if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(u.hostname)) {
            return cb(null, true);
          }
        }
      } catch { /* fall through */ }
      // Explicit allowlist (production domains or env override)
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'), false);
    },
    credentials: true,  // Required for JWT cookie-based auth flows
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // X-Sync-* headers are used by edge device HMAC authentication
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Org-Id', 'X-Sync-Key', 'X-Sync-Timestamp', 'X-Sync-Signature'],
  });

  // ─── Security Headers ──────────────────────────────────────────────
  // Conservative CSP: dashboard HTML pages use inline script/style tags and load
  // some CDN assets, so we allow 'unsafe-inline' for scripts/styles but restrict
  // framing, object/base URIs, and default-src. Opt out of CSP entirely for the
  // video-wall/kiosk routes that embed third-party iframes by setting
  // NO_CSP_PATHS env var (comma-separated path prefixes).
  const noCspPrefixes = (process.env.NO_CSP_PATHS || '/wall,/kiosk').split(',').map(s => s.trim()).filter(Boolean);
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https: wss: ws:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(self), payment=()');
    const url = request.url;
    if (!noCspPrefixes.some(p => url.startsWith(p))) {
      reply.header('Content-Security-Policy', csp);
    }
    if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  // Health endpoint
  app.get('/health', async () => {
    const syncState = deps.syncEngine.getSyncState();
    const healthCheck = deps.syncEngine.getHealthMonitor().getLastHealthCheck();
    const moduleHealth = await deps.moduleRegistry.healthCheckAll();
    const connectorStatus = deps.connectorRegistry.getStatusAll();

    return {
      status: 'ok',
      version: process.env.EDGERUNTIME_VERSION || 'dev',
      timestamp: new Date().toISOString(),
      sync: {
        siteId: syncState.siteId,
        operatingMode: syncState.operatingMode,
        cloudReachable: syncState.cloudReachable,
        lastSyncAt: syncState.lastSyncAt?.toISOString(),
        pendingChanges: syncState.pendingChanges,
        lastError: syncState.lastError,
      },
      health: healthCheck
        ? {
            cloud: healthCheck.cloud,
            database: healthCheck.database,
            redis: healthCheck.redis,
            overall: healthCheck.overall,
          }
        : null,
      modules: moduleHealth,
      connectors: connectorStatus,
    };
  });

  // Connector events endpoint — returns recent access events from connectors
  app.get('/api/v1/connector-events', async (request: FastifyRequest) => {
    if (!deps.connectorEvents) {
      return { events: [], total: 0 };
    }
    const query = request.query as { since?: string; limit?: string };
    let events = query.since
      ? deps.connectorEvents.getSince(query.since)
      : deps.connectorEvents.getAll();
    const limit = query.limit ? parseInt(query.limit, 10) : 200;
    if (limit > 0 && events.length > limit) {
      events = events.slice(-limit);
    }
    return { events, total: deps.connectorEvents.count };
  });

  // Ready endpoint (for k8s readiness probes)
  app.get('/ready', async () => {
    const mode = deps.syncEngine.getOperatingMode();
    return { ready: true, mode };
  });

  // Module listing
  app.get('/modules', async () => {
    const modules: Record<string, unknown>[] = [];
    for (const [name, module] of deps.moduleRegistry.getAll()) {
      const manifest = module.getManifest();
      modules.push({
        name,
        version: manifest.version,
        product: manifest.product,
        entityTypes: manifest.entityTypes,
      });
    }
    return { modules };
  });

  // ─── Auth endpoints (edge mode, when user accounts are synced from cloud) ──
  // On edge devices, user accounts are synced from the cloud via SyncEngine.
  // The UserAccountStore holds local copies (SQLite) so login works offline.
  if (deps.userAccountStore) {
    const uaStore = deps.userAccountStore;

    app.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { username?: string; password?: string } | null;
      if (!body?.username || !body?.password) {
        return reply.code(400).send({ error: 'Missing username or password' });
      }

      const valid = await uaStore.verifyPassword(body.username, body.password);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const account = await uaStore.getByUsername(body.username);
      if (!account) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const token = signJwt({
        sub: account.id,
        username: account.username,
        role: account.role,
        siteId: account.siteId,
      });

      return reply.send({
        token,
        user: {
          id: account.id,
          username: account.username,
          email: account.email,
          role: account.role,
        },
      });
    });

    // ─── Auth Middleware ─────────────────────────────────────────────────
    // Global preHandler hook that gates /api/* routes behind JWT auth.
    // Certain paths are exempted: health probes, login, HMAC-authed sync routes,
    // public kiosk/panic endpoints, and device-key-authed ingest endpoints.
    //
    // Demo mode handling: when DEMO_MODE env var is set and the request includes
    // the X-Demo-Mode header, a synthetic read-only "demo" user is injected.
    // This lets the public /demo page browse dashboard data without credentials
    // while blocking all write operations (POST/PUT/PATCH/DELETE → 403).
    // Demo mode is for public sandbox deploys only. In production it effectively
    // removes auth on GET endpoints, so we refuse the combination unless the
    // operator has explicitly opted in via ALLOW_DEMO_IN_PROD=1.
    const demoModeRequested = process.env.DEMO_MODE === 'true' || process.env.DEMO_MODE === '1';
    const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
    const allowDemoInProd = process.env.ALLOW_DEMO_IN_PROD === '1' || process.env.ALLOW_DEMO_IN_PROD === 'true';
    if (demoModeRequested && isProd && !allowDemoInProd) {
      throw new Error('DEMO_MODE is enabled in a production/Railway environment without ALLOW_DEMO_IN_PROD=1. Refusing to start.');
    }
    const demoModeEnabled = demoModeRequested;
    const demoOrgId = process.env.DEMO_ORG_ID || process.env.DASHBOARD_ADMIN_ORG || 'demo';

    app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      const url = request.url;

      // Skip auth for health, ready, modules, login, and cloud-sync routes
      if (
        url === '/health' ||
        url === '/ready' ||
        url === '/modules' ||
        url.startsWith('/api/auth/') ||
        url.startsWith('/api/v1/auth/') ||
        url.startsWith('/api/v1/sync') ||
        url.startsWith('/api/v1/connector-events') ||
        url.startsWith('/api/v1/federation') ||
        url.startsWith('/api/v1/kiosk/') ||
        url.startsWith('/api/v1/public/panic/') ||
        url.startsWith('/api/v1/alarms/ingest') ||
        url.startsWith('/api/v1/vms/') ||
        url.startsWith('/api/v1/widget/') ||
        url.startsWith('/api/v1/pairing/') ||
        url.startsWith('/api/v1/adapters') ||
        url.startsWith('/api/v1/telephony/voice/')
      ) {
        return;
      }

      // Only protect /api/* routes
      if (!url.startsWith('/api/')) return;

      // Demo mode: accept X-Demo-Mode header when DEMO_MODE is enabled on server
      if (demoModeEnabled && request.headers['x-demo-mode'] === 'true') {
        (request as any).user = {
          sub: 'demo',
          username: 'demo',
          orgId: demoOrgId,
          role: 'viewer',
          demo: true,
        };
        // Demo users are read-only
        if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
          return reply.code(403).send({ error: 'Demo mode is read-only' });
        }
        return;
      }

      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Missing or invalid authorization header' });
      }

      const token = authHeader.slice(7);
      const payload = verifyJwt(token);
      if (!payload) {
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }

      // Attach user info to request for downstream handlers
      (request as any).user = payload;

      // Demo users are read-only — block all write operations
      if (payload.demo && request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
        return reply.code(403).send({ error: 'Demo mode is read-only' });
      }
    });

    log.info('Auth middleware and login endpoint registered');
  }

  // ─── Federation endpoints (HMAC-authenticated, cross-product event sharing) ──
  if (deps.federationManager) {
    const fm = deps.federationManager;

    // Inbound: receive federated events from peer VMs
    app.post('/api/v1/federation/push', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { fromProduct?: string; events?: Record<string, unknown>[] } | null;
      if (!body?.fromProduct || !Array.isArray(body?.events)) {
        return reply.code(400).send({ error: 'Missing fromProduct or events' });
      }

      const nonAnalytics = fm.handleInboundEvents(body.fromProduct, body.events);
      // Add non-analytics events to ConnectorEventBuffer so they appear in connector-events API
      if (deps.connectorEvents && nonAnalytics && (nonAnalytics as any[]).length > 0) {
        deps.connectorEvents.push(`federation:${body.fromProduct}`, nonAnalytics as any);
      }

      return { accepted: body.events.length, timestamp: new Date().toISOString() };
    });

    // Return federated analytics (from peers like SafeSchool)
    app.get('/api/v1/federation/analytics', async (request: FastifyRequest) => {
      const query = request.query as { since?: string };
      const events = fm.getAnalytics(query.since);
      return { events, total: events.length };
    });

    // Federation peer status
    app.get('/api/v1/federation/status', async () => {
      return fm.getStatus();
    });

    log.info('Federation endpoints registered');
  }

  // ─── CLOUD/MIRROR mode: mount cloud-sync routes ────────────────────────
  // CLOUD = full cloud backend (Railway-deployed, serves product dashboards)
  // MIRROR = edge device with local dashboard (runs EDGE sync + CLOUD routes backed by local SQLite/Postgres)
  // Both modes mount the full set of cloud-sync route modules (~44 route files).
  if ((deps.operatingMode === 'CLOUD' || deps.operatingMode === 'MIRROR') && deps.cloudOptions) {
    const { syncRoutes, fleetRoutes, entityRoutes, userRoutes, licenseRoutes, dashboardRoutes, deviceConfigRoutes, backupRoutes, visitorRoutes, panicRoutes, incidentRoutes, alarmRoutes, alarmIngestRoute, drillRoutes, guardRoutes, notificationRoutes, tipRoutes, contractorRoutes, caseRoutes, channelRoutes, reunificationRoutes, threatRoutes, sensorRoutes, sensorIngestRoute, riskRoutes, hallpassRoutes, grantRoutes, tenantRoutes, passRoutes, buildingRoutes, agencyRoutes, webhookRoutes, apiDocsRoute, startDemoResetCron, startPacEmulator, generateDemoSeed, RealtimeChannel: RealtimeChannelClass, healthRoutes, healthIngestRoute, analyticsRoutes, analyticsIngestRoute, uebaRoutes, nlqueryRoutes, postureRoutes, siemRoutes, briefingRoutes, multisiteRoutes, widgetRoutes, ticketRoutes, auditRoutes, floorplanRoutes, signinFlowRoutes, vmsRoutes, accountRoutes, gsocEnterpriseRoutes, pairingRoutes, recipeRoutes, adapterRegistryRoutes, telephonyVoiceRoutes, telephonyRoutes, badgeRoutes, packageRoutes, cardholderSyncRoutes, aiInsightsRoutes, configuratorRoutes } = await import('@edgeruntime/cloud-sync');
    const opts = deps.cloudOptions;

    // Register WebSocket plugin (required for RealtimeChannel)
    await app.register(fastifyWebsocket);

    // JWT auth middleware for fleet API (dashboard calls these)
    const fleetAuthHook = async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip if already authenticated (e.g., demo mode set by global preHandler)
      if ((request as any).user) return;

      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Missing or invalid authorization header' });
      }
      const payload = verifyJwt(authHeader.slice(7));
      if (!payload) {
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }
      (request as any).user = payload;
    };

    // Extract orgId from JWT for org-scoped queries
    const getOrgIdFromJwt = (request: FastifyRequest): string | undefined => {
      return (request as any).user?.orgId as string | undefined;
    };

    // ── Sync & Pairing Routes (HMAC-authenticated, edge device communication) ──

    // Edge device sync endpoints (push/pull/heartbeat) — HMAC-authed, no JWT
    await app.register(syncRoutes, {
      prefix: '/api/v1/sync',
      syncKey: opts.syncKey,
      adapter: opts.syncAdapter,
    });

    // Device pairing endpoints — mixed auth: /request and /status are unauthenticated,
    // /claim and /unclaim use dashboard session (JWT)
    await app.register(pairingRoutes, {
      prefix: '/api/v1/pairing',
      adapter: opts.syncAdapter,
      getOrgId: getOrgIdFromJwt,
      authHook: fleetAuthHook,
    });

    // Adapter registry — edge devices discover & download adapter bundles (no JWT)
    await app.register(adapterRegistryRoutes, {
      prefix: '/api/v1/adapters',
    });

    // ── JWT-Protected Dashboard Routes (org-scoped, ~40 route modules) ──

    // Admin fleet management endpoints (JWT-protected, org-scoped)
    await app.register(async (scope) => {
      scope.addHook('preHandler', fleetAuthHook);
      await scope.register(fleetRoutes, {
        prefix: '/api/v1/fleet',
        adapter: opts.syncAdapter,
        getOrgId: getOrgIdFromJwt,
      });
      // Entity query endpoints (dashboard data — events, cameras, connectors, alerts)
      await scope.register(entityRoutes, {
        prefix: '/api/v1/data',
        adapter: opts.syncAdapter,
        getOrgId: getOrgIdFromJwt,
        getRealtimeChannel: () => realtimeChannel,
      });
      // User management endpoints
      await scope.register(userRoutes, {
        prefix: '/api/v1/users',
        adapter: opts.userAdapter ?? opts.syncAdapter as any,
        getOrgId: getOrgIdFromJwt,
      });
      // Device config management (remote settings for edge devices)
      await scope.register(deviceConfigRoutes, {
        prefix: '/api/v1',
        adapter: opts.syncAdapter,
      });
      // Backup & restore management
      await scope.register(backupRoutes, {
        prefix: '/api/v1/admin',
      });
      // Visitor management (pre-registration, check-in/out, watchlist)
      await scope.register(visitorRoutes, {
        prefix: '/api/v1',
      });
      // Incident management (GSOC incident lifecycle + SOPs)
      await scope.register(incidentRoutes, {
        prefix: '/api/v1',
      });
      // Panic alert management (JWT-protected dashboard routes — Alyssa's Law)
      // Wrapped in try/catch so a table-migration failure here cannot take down
      // the 40+ sibling routes registered in this scope.
      try {
        await scope.register(panicRoutes, {
          prefix: '/api/v1/panic',
        });
        log.info('Panic routes registered at /api/v1/panic');
      } catch (err) {
        log.error({ err }, 'Failed to register panic routes — /api/v1/panic will 404 until fixed');
      }
      // Alarm queue management (GSOC alarm triage — priority-based)
      await scope.register(alarmRoutes, {
        prefix: '/api/v1/alarms',
      });
      // Drill management (SafeSchool — federal/state compliance tracking)
      await scope.register(drillRoutes, {
        prefix: '/api/v1',
      });
      // Guard tour management (SafeSchool/GSOC — NFC/QR checkpoint patrols)
      await scope.register(guardRoutes, {
        prefix: '/api/v1/guards',
      });
      // Notification system (SafeSchool/GSOC — emergency notifications)
      await scope.register(notificationRoutes, {
        prefix: '/api/v1',
      });
      // Notification channels (mass notification integration — Twilio, SendGrid, Slack, Teams, PA)
      await scope.register(channelRoutes, {
        prefix: '/api/v1',
      });
      // Anonymous tip line (SafeSchool — student/staff safety tip submission)
      await scope.register(tipRoutes, {
        prefix: '/api/v1',
      });
      // Contractor management (SafeSchool — contractor access & credential tracking)
      await scope.register(contractorRoutes, {
        prefix: '/api/v1',
      });
      // Case management (GSOC — investigation case tracking with evidence)
      await scope.register(caseRoutes, {
        prefix: '/api/v1',
      });
      // Reunification system (SafeSchool — emergency parent-student reunification)
      await scope.register(reunificationRoutes, {
        prefix: '/api/v1',
      });
      // Behavioral threat assessment (SafeSchool — CSTAG/NTAC models)
      await scope.register(threatRoutes, {
        prefix: '/api/v1',
      });
      // Environmental sensor integration (SafeSchool/SafeSchool — vape, gunshot, noise, etc.)
      await scope.register(sensorRoutes, {
        prefix: '/api/v1',
      });
      // Risk scoring (SafeSchool/SafeSchool — predictive threat scoring)
      await scope.register(riskRoutes, {
        prefix: '/api/v1',
      });
      // Digital hall passes (SafeSchool — student movement tracking)
      await scope.register(hallpassRoutes, {
        prefix: '/api/v1',
      });
      // Grant application helper (SafeSchool — grant tracking & compliance)
      await scope.register(grantRoutes, {
        prefix: '/api/v1',
      });
      // Tenant experience platform (SafeSchool — multi-tenant building management)
      await scope.register(tenantRoutes, {
        prefix: '/api/v1',
      });
      // PASS Guidelines compliance checker (SafeSchool — Partner Alliance for Safer Schools)
      await scope.register(passRoutes, {
        prefix: '/api/v1/pass',
      });
      // Building systems management (SafeSchool — energy/building management)
      await scope.register(buildingRoutes, {
        prefix: '/api/v1/building-systems',
      });
      // Inter-agency coordination (SafeSchool — police, fire, EMS coordination)
      await scope.register(agencyRoutes, {
        prefix: '/api/v1/agencies',
      });
      // Webhook management (all products — outbound event delivery)
      await scope.register(webhookRoutes, {
        prefix: '/api/v1/webhooks',
      });
      // System health monitoring (SafeSchool/SafeSchool — ADRM Defender-style)
      await scope.register(healthRoutes, {
        prefix: '/api/v1',
      });
      // PACS Analytics Engine (SafeSchool — Splunk for physical access control)
      await scope.register(analyticsRoutes, {
        prefix: '/api/v1',
      });
      // Physical Security UEBA (SafeSchool — behavior analytics)
      await scope.register(uebaRoutes, {
        prefix: '/api/v1',
      });
      // Natural Language Log Query (SafeSchool — plain English search)
      await scope.register(nlqueryRoutes, {
        prefix: '/api/v1',
      });
      // Physical Security Posture Score (all products — A-F security grade)
      await scope.register(postureRoutes, {
        prefix: '/api/v1',
      });
      // SIEM/SOC Export (SafeSchool — push events to Splunk/Sentinel)
      await scope.register(siemRoutes, {
        prefix: '/api/v1',
      });
      // Executive & Shift Handoff Briefings (SafeSchool — auto-generated reports)
      await scope.register(briefingRoutes, {
        prefix: '/api/v1',
      });
      // Multi-Site Command View (SafeSchool — cross-site management)
      await scope.register(multisiteRoutes, {
        prefix: '/api/v1',
      });
      // Ticket Auto-Creation (all products — ServiceNow/Jira integration)
      await scope.register(ticketRoutes, {
        prefix: '/api/v1',
      });
      // Audit trail & compliance reports (all products)
      await scope.register(auditRoutes, {
        prefix: '/api/v1',
      });
      // Interactive floor plans (SafeSchool/GSOC — device/zone mapping)
      await scope.register(floorplanRoutes, {
        prefix: '/api/v1',
      });
      // Sign-in flows (SafeSchool — visitor/contractor sign-in workflows)
      await scope.register(signinFlowRoutes, {
        prefix: '/api/v1',
      });
      // Automation recipes (all products — trigger/action automation workflows)
      await scope.register(recipeRoutes, {
        prefix: '/api/v1/recipes',
        adapter: opts.syncAdapter as any,
      });
      // Badge printing (all products — badge designer print queue)
      await scope.register(badgeRoutes, {
        prefix: '/api/v1/badges',
      });
      // Telephony call log & config (JWT-protected — IVR management)
      await scope.register(telephonyRoutes, {
        prefix: '/api/v1/telephony',
      });
      // Package room management (SafeSchool — package tracking & tenant notification)
      try {
        await scope.register(packageRoutes, {
          prefix: '/api/v1/packages',
        });
        log.info('Package routes registered at /api/v1/packages');
      } catch (err) {
        log.error({ err }, 'Failed to register package routes');
      }
      // Cardholder bidirectional PAC sync (all products — cardholder dedup + conflict resolution)
      try {
        await scope.register(cardholderSyncRoutes, {
          prefix: '/api/v1/sync/cardholders',
        });
        log.info('Cardholder sync routes registered at /api/v1/sync/cardholders');
      } catch (err) {
        log.error({ err }, 'Failed to register cardholder sync routes');
      }
      // AI Insights routes (customer-facing — anomalies, visitor risk, NL commands, compliance)
      try {
        await scope.register(aiInsightsRoutes, {
          prefix: '/api/v1',
        });
        log.info('AI insights routes registered at /api/v1/ai/* and /api/v1/compliance/*');
      } catch (err) {
        log.error({ err }, 'Failed to register AI insights routes');
      }
      // System Configurator routes (admin-only — system builder, pricing, compliance docs)
      try {
        await scope.register(configuratorRoutes, {
          prefix: '/api/v1',
        });
        log.info('Configurator routes registered at /api/v1/configurator/*');
      } catch (err) {
        log.error({ err }, 'Failed to register configurator routes');
      }
    });

    // ── Public Routes (no JWT — device-key or open access) ──

    // Public API docs endpoint (no JWT)
    await app.register(apiDocsRoute, {});

    // Public sensor ingest endpoint (no JWT — device-key auth)
    await app.register(sensorIngestRoute, {});

    // Public tip submission endpoint (no JWT — anonymous tips)
    await app.register(async (scope) => {
      scope.post('/api/v1/public/tips/submit', async (request: FastifyRequest, reply: FastifyReply) => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/tips/submit',
          headers: { 'content-type': 'application/json' },
          payload: request.body as any,
        });
        reply.code(res.statusCode).send(JSON.parse(res.body));
      });
    });

    // Public alarm ingest endpoint (device key auth, no JWT)
    await app.register(alarmIngestRoute, {});

    // Public health heartbeat ingest endpoint (device key auth, no JWT)
    await app.register(healthIngestRoute, {});

    // Public access event ingest endpoint (device key auth, no JWT)
    await app.register(analyticsIngestRoute, {});

    // Public Twilio voice webhook endpoints (no JWT — Twilio calls these directly)
    await app.register(telephonyVoiceRoutes, { prefix: '/api/v1/telephony' });

    // Public panic trigger endpoint (no JWT — uses PANIC_TOKEN env var for auth)
    // Allows panic buttons/devices to trigger alerts without dashboard login.
    // Rate-limited per-IP to prevent flooding the DB even if PANIC_TOKEN leaks.
    const panicRateBuckets = new Map<string, { count: number; resetAt: number }>();
    const PANIC_WINDOW_MS = 60_000;
    const PANIC_MAX_PER_WINDOW = Number(process.env.PANIC_RATE_LIMIT || 30);
    const panicRateCleanup = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of panicRateBuckets) {
        if (v.resetAt < now) panicRateBuckets.delete(k);
      }
    }, PANIC_WINDOW_MS);
    panicRateCleanup.unref?.();
    await app.register(async (scope) => {
      scope.post('/api/v1/public/panic/trigger', async (request: FastifyRequest, reply: FastifyReply) => {
        // Rate-limit by client IP
        const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || 'unknown';
        const now = Date.now();
        const bucket = panicRateBuckets.get(ip);
        if (!bucket || bucket.resetAt < now) {
          panicRateBuckets.set(ip, { count: 1, resetAt: now + PANIC_WINDOW_MS });
        } else {
          bucket.count += 1;
          if (bucket.count > PANIC_MAX_PER_WINDOW) {
            return reply.code(429).send({ error: 'Rate limit exceeded. Slow down.' });
          }
        }

        const panicToken = process.env.PANIC_TOKEN;
        const panicHeader = request.headers['x-panic-token'] as string | undefined;
        const authHeader = request.headers.authorization;
        const provided = panicHeader || (authHeader?.startsWith('PanicToken ') ? authHeader.slice(11) : null);

        if (!panicToken) {
          // In production, refuse rather than expose an unauthenticated panic
          // trigger. In dev this is a warning so local testing still works.
          const runningInProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
          if (runningInProd) {
            return reply.code(503).send({
              error: 'Public panic endpoint disabled: PANIC_TOKEN is not configured on this deployment.',
            });
          }
          log.warn('PANIC_TOKEN not set — public panic endpoint is unauthenticated (dev only)');
        } else {
          let ok = false;
          if (provided) {
            try {
              const a = Buffer.from(panicToken);
              const b = Buffer.from(provided);
              ok = a.length === b.length && timingSafeEqual(a, b);
            } catch { ok = false; }
          }
          if (!ok) {
            return reply.code(401).send({ error: 'Invalid or missing panic token. Set X-Panic-Token header.' });
          }
        }

        // Proxy to the registered panic routes via internal inject. The
        // downstream handler does its own token compare against PANIC_TOKEN,
        // so we forward the verified token verbatim (never a 'open' sentinel).
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/panic/trigger',
          headers: {
            'content-type': 'application/json',
            ...(panicToken ? { 'x-panic-token': panicToken } : {}),
          },
          payload: request.body as any,
        });
        reply.code(res.statusCode).send(JSON.parse(res.body));
      });
    });

    // ── Entity Unwrap Proxies & Account Routes (frontend compatibility) ──

    // Entity routes also at /api/v1 (without /data/ prefix) for product frontend compatibility
    // SafeSchoolOS dashboard expects raw arrays (Camera[], Event[], Door[]) not wrapped objects
    // Proxy each endpoint to /api/v1/data/* and unwrap the response
    await app.register(async (scope) => {
      scope.addHook('preHandler', fleetAuthHook);

      const unwrapProxy = (entityPath: string, transform?: (items: any[]) => any[]) => {
        scope.get(`/api/v1/${entityPath}`, async (request: FastifyRequest, reply: FastifyReply) => {
          const q = request.query as Record<string, string>;
          const qs = new URLSearchParams(q).toString();
          const dataUrl = `/api/v1/data/${entityPath}${qs ? '?' + qs : ''}`;
          const res = await app.inject({
            method: 'GET',
            url: dataUrl,
            headers: request.headers as any,
          });
          const body = JSON.parse(res.body);
          // Unwrap: { cameras: [...], total } → [...]
          const keys = Object.keys(body);
          const arrayKey = keys.find((k: string) => Array.isArray(body[k]));
          if (arrayKey) {
            const items = transform ? transform(body[arrayKey]) : body[arrayKey];
            return reply.send(items);
          }
          return reply.send(body);
        });
      };

      // Transform flat PAC camera data into nested structure dashboards expect
      const cameraTransform = (cams: any[]) => cams.map((c: any) => ({
        ...c,
        location: typeof c.location === 'string'
          ? { description: c.location }
          : c.location || {},
        capabilities: c.capabilities || {
          ptz: c.ptzCapable || false,
          audio: false,
          analytics: false,
          ir: false,
        },
      }));

      unwrapProxy('events');
      unwrapProxy('cameras', cameraTransform);
      unwrapProxy('doors');
      unwrapProxy('cardholders');
      unwrapProxy('connectors');
      unwrapProxy('alerts');
      // visitors handled by visitorRoutes — don't duplicate here

      // Account management (multi-tenancy: account CRUD, sites, user-site roles)
      if ('pool' in opts.syncAdapter) {
        await scope.register(accountRoutes, {
          prefix: '/api/v1/accounts',
          pool: (opts.syncAdapter as unknown as { pool: unknown }).pool as any,
          getAccountId: getOrgIdFromJwt,
        });
      }

      // GSOC Enterprise (regions, video walls, escalation chains, operator roles)
      await scope.register(gsocEnterpriseRoutes, {
        prefix: '/api/v1/gsoc',
        getOrgId: getOrgIdFromJwt,
        getUserId: (req: any) => req.user?.sub || req.user?.userId,
      });
    });

    // VMS emulator — synthetic camera snapshot/stream endpoints (no auth for img/iframe compat)
    await app.register(vmsRoutes, { prefix: '/api/v1' });

    // Widget (embeddable dashboard — no auth for iframe compat)
    await app.register(widgetRoutes, { prefix: '/api/v1' });

    // Camera snapshot/stream proxy — requires JWT auth (via header or ?token= query param)
    // URL validation: only allow proxying to private/local network addresses
    const ALLOWED_CAMERA_HOSTS = process.env.CAMERA_ALLOWED_HOSTS
      ? process.env.CAMERA_ALLOWED_HOSTS.split(',').map(s => s.trim())
      : [];

    function isAllowedCameraUrl(urlStr: string): boolean {
      let parsed: URL;
      try {
        parsed = new URL(urlStr);
      } catch {
        return false;
      }
      // Must be http or https
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      const hostname = parsed.hostname;
      // Allow explicit allowlist
      if (ALLOWED_CAMERA_HOSTS.includes(hostname)) return true;
      // Allow private/local network ranges (RFC 1918 + link-local)
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
      if (hostname.startsWith('192.168.') || hostname.startsWith('10.')) return true;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
      // Block everything else (cloud metadata, public internet, etc.)
      return false;
    }

    function verifyCameraAuth(request: FastifyRequest, reply: FastifyReply): boolean {
      // Accept JWT from Authorization header or ?token= query param (for <img src> usage)
      const authHeader = request.headers.authorization;
      const queryToken = (request.query as Record<string, string>)?.token;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
      if (!token || !verifyJwt(token)) {
        reply.code(401).send({ error: 'Camera access requires authentication. Pass JWT via Authorization header or ?token= query param.' });
        return false;
      }
      return true;
    }

    // Helper: resolve camera URL — relative paths route internally via inject()
    const resolveCameraUrl = (url: string): { internal: boolean; url: string } => {
      if (url.startsWith('/')) return { internal: true, url };
      return { internal: false, url };
    };

    await app.register(async (scope) => {
      scope.get('/api/v1/cameras/:cameraId/snapshot', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!verifyCameraAuth(request, reply)) return;
        const { cameraId } = request.params as { cameraId: string };
        const result = await opts.syncAdapter.queryEntities({
          entityType: ['camera_status', 'camera'],
          filters: { id: cameraId },
          limit: 1,
          offset: 0,
        });
        const cam = result.entities[0];
        const snapshotUrl = cam?.snapshotUrl as string | undefined;
        if (!snapshotUrl) {
          return reply.code(404).send({ error: 'No snapshot URL for camera' });
        }
        const resolved = resolveCameraUrl(snapshotUrl);
        if (resolved.internal) {
          // Internal VMS route — use inject()
          const res = await app.inject({ method: 'GET', url: resolved.url });
          reply.header('Cache-Control', 'no-cache');
          return reply.type(res.headers['content-type'] as string || 'image/svg+xml').send(res.rawPayload);
        }
        if (!isAllowedCameraUrl(snapshotUrl)) {
          log.warn({ snapshotUrl, cameraId }, 'Blocked camera snapshot proxy to disallowed URL');
          return reply.code(403).send({ error: 'Camera URL not in allowed network range' });
        }
        try {
          const imgResp = await fetch(snapshotUrl, { signal: AbortSignal.timeout(10000) });
          if (!imgResp.ok) return reply.code(502).send({ error: 'Snapshot fetch failed' });
          const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
          const buffer = Buffer.from(await imgResp.arrayBuffer());
          reply.header('Cache-Control', 'no-cache');
          return reply.type(contentType).send(buffer);
        } catch {
          return reply.code(502).send({ error: 'Snapshot fetch failed' });
        }
      });

      // Camera MJPEG stream proxy — requires auth, validates URL
      scope.get('/api/v1/cameras/:cameraId/stream', async (request: FastifyRequest, reply: FastifyReply) => {
        if (!verifyCameraAuth(request, reply)) return;
        const { cameraId } = request.params as { cameraId: string };
        const result = await opts.syncAdapter.queryEntities({
          entityType: ['camera_status', 'camera'],
          filters: { id: cameraId },
          limit: 1,
          offset: 0,
        });
        const cam = result.entities[0];
        const streamUrl = cam?.streamUrl as string | undefined;
        if (!streamUrl) {
          return reply.code(404).send({ error: 'No stream URL for camera' });
        }
        // Internal VMS route — redirect to the VMS stream endpoint directly
        const resolved = resolveCameraUrl(streamUrl);
        if (resolved.internal) {
          const port = deps.port || 8470;
          const internalUrl = `http://127.0.0.1:${port}${resolved.url}`;
          try {
            const streamResp = await fetch(internalUrl, { signal: AbortSignal.timeout(30000) });
            if (!streamResp.ok || !streamResp.body) {
              return reply.code(502).send({ error: 'VMS stream failed' });
            }
            const contentType = streamResp.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=---cameraboundary';
            reply.raw.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'Connection': 'close' });
            const reader = streamResp.body.getReader();
            const pump = async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done || reply.raw.destroyed) break;
                  reply.raw.write(value);
                }
              } catch { /* stream closed */ }
              reply.raw.end();
            };
            pump();
            request.raw.on('close', () => { reader.cancel().catch(() => {}); });
            return;
          } catch {
            return reply.code(502).send({ error: 'VMS stream failed' });
          }
        }
        if (!isAllowedCameraUrl(streamUrl)) {
          log.warn({ streamUrl, cameraId }, 'Blocked camera stream proxy to disallowed URL');
          return reply.code(403).send({ error: 'Camera URL not in allowed network range' });
        }
        try {
          const streamResp = await fetch(streamUrl, { signal: AbortSignal.timeout(30000) });
          if (!streamResp.ok || !streamResp.body) {
            return reply.code(502).send({ error: 'Stream fetch failed' });
          }
          const contentType = streamResp.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=--myboundary';
          reply.raw.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store',
            'Connection': 'close',
          });
          const reader = streamResp.body.getReader();
          const pump = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done || reply.raw.destroyed) break;
                reply.raw.write(value);
              }
            } catch {
              // Client disconnected or upstream closed
            } finally {
              reply.raw.end();
              reader.cancel().catch(() => {});
            }
          };
          request.raw.on('close', () => reader.cancel().catch(() => {}));
          pump();
          // Return reply to prevent Fastify from sending another response
          return reply;
        } catch {
          return reply.code(502).send({ error: 'Stream fetch failed' });
        }
      });
    });

    // ── Product Frontend Auth (cloud dashboard login/me) ──

    // Product frontend auth endpoints (/api/v1/auth/login + /api/v1/auth/me)
    // SafeSchoolOS dashboard posts { email, password } and expects { token, user }
    await app.register(async (scope) => {
      scope.post('/api/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { email?: string; username?: string; password?: string } | null;
        const username = body?.email || body?.username;
        const password = body?.password;

        if (!username || !password) {
          return reply.code(400).send({ error: 'Missing email/username or password' });
        }

        const adminUser = process.env.DASHBOARD_ADMIN_USER ?? 'admin';
        const adminPass = process.env.DASHBOARD_ADMIN_PASSWORD;
        const orgId = process.env.DASHBOARD_ADMIN_ORG ?? 'default';

        if (!adminPass || (username !== adminUser && username !== `${adminUser}@${orgId}.edu`)) {
          return reply.code(401).send({ error: 'Invalid credentials' });
        }

        // Constant-time password comparison prevents timing-based credential guessing.
        const expected = Buffer.from(adminPass);
        const provided = Buffer.from(password);
        const ok = expected.length === provided.length && timingSafeEqual(expected, provided);
        if (!ok) {
          return reply.code(401).send({ error: 'Invalid credentials' });
        }

        const token = signJwt({
          sub: adminUser,
          username: adminUser,
          orgId,
          role: 'admin',
        });

        return reply.send({
          token,
          user: {
            id: adminUser,
            email: username,
            name: adminUser,
            role: 'ADMIN',
            siteIds: [orgId],
          },
        });
      });

      scope.get('/api/v1/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          return reply.code(401).send({ error: 'Missing authorization header' });
        }
        const payload = verifyJwt(authHeader.slice(7));
        if (!payload) {
          return reply.code(401).send({ error: 'Invalid or expired token' });
        }
        return reply.send({
          id: payload.sub || payload.username,
          email: `${payload.username}@${payload.orgId || 'local'}.edu`,
          name: payload.username as string,
          role: (payload.role as string || 'admin').toUpperCase(),
          siteIds: [payload.orgId || 'default'],
        });
      });
    });

    // ── License & Subscription Routes ──

    // Customer-facing license/subscription endpoints (JWT-protected)
    await app.register(async (scope) => {
      scope.addHook('preHandler', fleetAuthHook);
      await scope.register(licenseRoutes, {
        prefix: '/api/v1/license',
        adapter: opts.licenseAdapter,
        getOrgId: opts.getOrgId ?? ((request: any) => getOrgIdFromJwt(request) || ''),
      });
    });

    // ── Fleet Dashboard (HTML UI + OAuth + homepage) ──

    // Fleet dashboard (HTML + login endpoint + optional OAuth)
    const oauthBaseUrl = process.env.DASHBOARD_BASE_URL;
    const googleConfig = process.env.OAUTH_GOOGLE_CLIENT_ID && process.env.OAUTH_GOOGLE_CLIENT_SECRET
      ? { clientId: process.env.OAUTH_GOOGLE_CLIENT_ID, clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET }
      : undefined;
    const microsoftConfig = process.env.OAUTH_MICROSOFT_CLIENT_ID && process.env.OAUTH_MICROSOFT_CLIENT_SECRET
      ? { clientId: process.env.OAUTH_MICROSOFT_CLIENT_ID, clientSecret: process.env.OAUTH_MICROSOFT_CLIENT_SECRET, tenantId: process.env.OAUTH_MICROSOFT_TENANT_ID || 'common' }
      : undefined;
    const appleConfig = process.env.OAUTH_APPLE_CLIENT_ID && process.env.OAUTH_APPLE_TEAM_ID && process.env.OAUTH_APPLE_KEY_ID && process.env.OAUTH_APPLE_PRIVATE_KEY
      ? { clientId: process.env.OAUTH_APPLE_CLIENT_ID, teamId: process.env.OAUTH_APPLE_TEAM_ID, keyId: process.env.OAUTH_APPLE_KEY_ID, privateKey: process.env.OAUTH_APPLE_PRIVATE_KEY }
      : undefined;
    const hasOAuth = oauthBaseUrl && (googleConfig || microsoftConfig || appleConfig);

    // Wire up user account verification for dashboard login
    // Edge/MIRROR mode: check local SQLite user account store (synced from cloud)
    // CLOUD mode: check Postgres sync_users table directly
    let verifyCredentials: ((username: string, password: string) => Promise<{ orgId: string; username: string; role: string } | null>) | undefined;

    if (deps.userAccountStore) {
      verifyCredentials = async (username: string, password: string) => {
        // Try username first, then email (cloud creates users with email as primary identifier)
        let valid = await deps.userAccountStore!.verifyPassword(username, password);
        let account = valid ? await deps.userAccountStore!.getByUsername(username) : null;
        if (!account) {
          // Fallback: try looking up by email
          const byEmail = await deps.userAccountStore!.getByEmail(username);
          if (byEmail) {
            const { compare } = await import('bcryptjs');
            valid = await compare(password, byEmail.passwordHash);
            account = valid ? byEmail : null;
          }
        }
        if (!account) return null;
        return { orgId: account.siteId || process.env.DASHBOARD_ADMIN_ORG || 'default', username: account.username, role: account.role };
      };
    } else if (opts.syncAdapter && 'pool' in opts.syncAdapter) {
      // CLOUD mode with Postgres — verify against sync_users table
      // Accept either username or email
      verifyCredentials = async (username: string, password: string) => {
        try {
          const adapter = opts.syncAdapter as unknown as { pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> } };
          const { rows } = await adapter.pool.query(
            'SELECT id, email, name, username, password_hash, role, org_id FROM sync_users WHERE email = $1 OR username = $1 LIMIT 1',
            [username],
          );
          if (rows.length === 0 || !rows[0].password_hash) return null;
          const { compare } = await import('bcryptjs');
          const valid = await compare(password, String(rows[0].password_hash));
          if (!valid) return null;
          return {
            orgId: String(rows[0].org_id || process.env.DASHBOARD_ADMIN_ORG || 'default'),
            username: String(rows[0].username || rows[0].email),
            role: String(rows[0].role || 'viewer'),
          };
        } catch (err) {
          log.warn({ err }, 'Postgres user verification failed');
          return null;
        }
      };
    }

    await app.register(dashboardRoutes, {
      prefix: '/dashboard',
      signJwt,
      verifyJwt,
      verifyCredentials,
      productName: process.env.DASHBOARD_PRODUCT || [...deps.moduleRegistry.getAll().keys()][0],
      userAdapter: hasOAuth ? opts.userAdapter : undefined,
      oauth: hasOAuth ? {
        baseUrl: oauthBaseUrl,
        defaultOrgId: process.env.DASHBOARD_ADMIN_ORG,
        google: googleConfig,
        microsoft: microsoftConfig,
        apple: appleConfig,
      } : undefined,
    });

    // Product homepage at "/" and /login alias
    // Wrapped in register() to ensure routes are added after plugin queue flush
    await app.register(async (scope) => {
      if (opts.homepageHtml) {
        scope.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
          return reply.type('text/html').send(opts.homepageHtml);
        });
      } else {
        // If multiple products active, show a picker; otherwise redirect to dashboard
        const activeProducts = [...deps.moduleRegistry.getAll().keys()];
        if (activeProducts.length > 1) {
          scope.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
            const cards = activeProducts.map((p: string) => {
              const labels: Record<string, { name: string; color: string; desc: string }> = {
                'safeschool': { name: 'SafeSchool', color: '#f59e0b', desc: 'School safety & visitor management' },
                'safeschool': { name: 'SafeSchool', color: '#3b82f6', desc: 'Badge printing & access control' },
                'safeschool': { name: 'SafeSchool', color: '#10b981', desc: 'Global security operations center' },
              };
              const info = labels[p] || { name: p, color: '#6366f1', desc: '' };
              return `<a href="/dashboard?product=${p}" style="display:block;background:#1e2030;border:2px solid ${info.color};border-radius:12px;padding:2rem;text-decoration:none;color:#e2e8f0;transition:transform 0.2s,box-shadow 0.2s" onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.3)'" onmouseout="this.style.transform='';this.style.boxShadow=''"><div style="font-size:1.5rem;font-weight:700;color:${info.color}">${info.name}</div><div style="margin-top:0.5rem;color:#94a3b8;font-size:0.9rem">${info.desc}</div></a>`;
            }).join('');
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EdgeRuntime</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#141625;font-family:-apple-system,BlinkMacSystemFont,sans-serif"><div style="max-width:480px;width:100%;padding:2rem"><h1 style="color:#e2e8f0;text-align:center;margin-bottom:2rem">EdgeRuntime</h1><div style="display:grid;gap:1rem">${cards}</div></div></body></html>`;
            return reply.type('text/html').send(html);
          });
        } else {
          scope.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
            return reply.redirect('/dashboard');
          });
        }
      }

      scope.get('/login', async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.redirect('/dashboard');
      });

      // /demo — redirect to /dashboard/demo (no-login demo mode)
      scope.get('/demo', async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.redirect('/dashboard/demo');
      });

      // /pricing — product pricing page
      scope.get('/pricing', async (_request: FastifyRequest, reply: FastifyReply) => {
        const productName = process.env.HOMEPAGE_NAME;
        if (productName) {
          try {
            const { loadHomepageHtml: loadHtml } = await import('@edgeruntime/cloud-sync');
            const html = loadHtml('pricing-' + productName);
            if (html) return reply.type('text/html').send(html);
          } catch { /* fallback below */ }
        }
        return reply.redirect('/dashboard');
      });
    });

    // Real-time WebSocket channel for edge device commands
    realtimeChannel = new RealtimeChannelClass({ syncKey: opts.syncKey });
    realtimeChannel.register(app, '/api/v1/sync/ws');

    // ─── Demo Admin API (status + runtime toggle) ────────────────
    // Provides endpoints to query and toggle demo mode at runtime.
    // When enabled, starts the PAC emulator (synthetic access events),
    // recipe-driven demo emulator, and the demo-seed auto-reset cron.
    let demoModeActive = process.env.DEMO_MODE === 'true' || process.env.DEMO_MODE === '1';
    let pacEmulatorHandle: ReturnType<typeof startPacEmulator> | null = null;
    let demoResetCronHandle: ReturnType<typeof startDemoResetCron> | null = null;

    await app.register(async (scope) => {
      scope.addHook('preHandler', fleetAuthHook);

      // GET /api/v1/admin/demo-status — check demo mode state
      scope.get('/api/v1/admin/demo-status', async () => {
        const { existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        const seedPath = join(process.cwd(), 'data', 'backups', 'demo-seed.json');
        return {
          demoMode: demoModeActive,
          seedExists: existsSync(seedPath),
          demoProduct: process.env.DEMO_PRODUCT || 'all',
          pacEmulatorRunning: pacEmulatorHandle !== null,
          demoResetCronRunning: demoResetCronHandle !== null,
          demoResetIntervalMs: parseInt(process.env.DEMO_RESET_INTERVAL_MS || '1800000', 10),
        };
      });

      // POST /api/v1/admin/demo-toggle — enable/disable demo mode at runtime
      scope.post('/api/v1/admin/demo-toggle', async (request: FastifyRequest) => {
        const body = request.body as { enabled?: boolean; regenerateSeed?: boolean; product?: string } || {};
        const enable = body.enabled !== undefined ? body.enabled : !demoModeActive;
        const product = body.product || process.env.DEMO_PRODUCT || 'all';

        if (enable && !demoModeActive) {
          // Enable demo mode
          demoModeActive = true;
          process.env.DEMO_MODE = 'true';

          if (process.env.DATABASE_URL) {
            // Generate seed if needed
            const { existsSync: exists2, writeFileSync: write2, mkdirSync: mkdir2 } = await import('node:fs');
            const { join: join2 } = await import('node:path');
            const bDir = join2(process.cwd(), 'data', 'backups');
            const sPath = join2(bDir, 'demo-seed.json');
            if (!exists2(sPath) || body.regenerateSeed) {
              mkdir2(bDir, { recursive: true });
              const seed = generateDemoSeed(product) as any;
              seed._createdAt = new Date().toISOString();
              seed._name = 'demo-seed';
              seed._description = 'Admin-generated demo seed — ' + product;
              write2(sPath, JSON.stringify(seed, null, 2), 'utf-8');
            }

            // Start cron + emulator
            const interval = parseInt(process.env.DEMO_RESET_INTERVAL_MS || '1800000', 10);
            demoResetCronHandle = startDemoResetCron(interval);
            startPacEmulator({ connectionString: process.env.DATABASE_URL, product, intervalMs: 15000 });
            pacEmulatorHandle = {} as any; // flag as running
          }

          log.info({ product }, 'Demo mode ENABLED via admin API');
          return { success: true, demoMode: true, product };

        } else if (!enable && demoModeActive) {
          // Disable demo mode
          demoModeActive = false;
          process.env.DEMO_MODE = '';

          if (demoResetCronHandle) {
            clearInterval(demoResetCronHandle);
            demoResetCronHandle = null;
          }
          const { stopPacEmulator: stopPac, stopDemoEmulator } = await import('@edgeruntime/cloud-sync');
          stopPac();
          stopDemoEmulator();
          pacEmulatorHandle = null;

          log.info('Demo mode DISABLED via admin API');
          return { success: true, demoMode: false };
        }

        return { success: true, demoMode: demoModeActive, message: 'No change' };
      });
    });

    // Demo data auto-reset cron (restores demo-seed.json every 30 min)
    const demoResetInterval = parseInt(process.env.DEMO_RESET_INTERVAL_MS || '1800000', 10); // default 30 min
    if (demoModeActive && process.env.DATABASE_URL) {
      // Auto-generate demo seed if it doesn't exist
      const { existsSync, writeFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const backupDir = join(process.cwd(), 'data', 'backups');
      const seedPath = join(backupDir, 'demo-seed.json');
      {
        // Always regenerate seed on boot to pick up schema/data changes
        const demoProduct = process.env.DEMO_PRODUCT || 'all';
        log.info({ demoProduct }, 'Generating demo seed...');
        mkdirSync(backupDir, { recursive: true });
        const seed = generateDemoSeed(demoProduct) as any;
        seed._createdAt = new Date().toISOString();
        seed._name = 'demo-seed';
        seed._description = 'Auto-generated demo seed — ' + demoProduct;
        writeFileSync(seedPath, JSON.stringify(seed, null, 2), 'utf-8');
        log.info({ demoProduct, events: (seed.access_events || []).length }, 'Demo seed generated');
      }

      demoResetCronHandle = startDemoResetCron(demoResetInterval);

      // Start PAC emulator for continuous event generation (all products by default)
      const emulatorProduct = process.env.DEMO_PRODUCT || 'all';
      const emulatorInterval = parseInt(process.env.PAC_EMULATOR_INTERVAL_MS || '15000', 10);
      startPacEmulator({
        connectionString: process.env.DATABASE_URL,
        product: emulatorProduct,
        intervalMs: emulatorInterval,
      });
      pacEmulatorHandle = {} as any; // flag as running

      // Start recipe-driven demo emulator (generates events from recipe definitions)
      try {
        const { startDemoEmulator } = await import('@edgeruntime/cloud-sync');
        await startDemoEmulator({
          connectionString: process.env.DATABASE_URL!,
          product: emulatorProduct,
        });
        log.info({ product: emulatorProduct }, 'Recipe demo emulator started');
      } catch (err) {
        log.warn({ err }, 'Recipe demo emulator failed to start (non-fatal)');
      }
    }

    // ─── Video Wall & Kiosk pages ────────────────────────────────
    const __uiDirname = dirname(fileURLToPath(import.meta.url));
    const loadUiHtml = (name: string): string => {
      // In Docker: __uiDirname = /app/packages/runtime/dist
      // cloud-sync UI at /app/packages/cloud-sync/dist/ui/
      for (const base of [
        join(__uiDirname, 'ui'),
        join(__uiDirname, '..', 'ui'),
        join(__uiDirname, '..', '..', 'cloud-sync', 'ui'),
        join(__uiDirname, '..', '..', 'cloud-sync', 'dist', 'ui'),
        join(__uiDirname, '..', '..', '..', 'packages', 'cloud-sync', 'ui'),
        join(__uiDirname, '..', '..', '..', 'packages', 'cloud-sync', 'dist', 'ui'),
      ]) {
        try { return readFileSync(join(base, name), 'utf-8'); } catch { /* next */ }
      }
      return '<html><body><h1>' + name + ' not found</h1></body></html>';
    };

    log.info('Registering wall and kiosk routes...');
    app.get('/wall', async (_req: FastifyRequest, reply: FastifyReply) => reply.redirect('/wall/1'));
    app.get('/wall/:screenId', async (_req: FastifyRequest, reply: FastifyReply) => {
      log.info({ screenId: (_req.params as any).screenId }, 'Wall page requested');
      return reply.type('text/html').send(loadUiHtml('wall.html'));
    });
    app.get('/kiosk', async (_req: FastifyRequest, reply: FastifyReply) => {
      log.info('Kiosk page requested');
      return reply.type('text/html').send(loadUiHtml('kiosk.html'));
    });
    app.get('/badge-designer', async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.type('text/html').send(loadUiHtml('badge-designer.html'));
    });
    // Adapter UI pages — standalone components embedded via iframe in dashboard
    const adapterPages = ['guard-tours', 'door-camera', 'asset-tracker', 'patient-flow', 'compliance', 'tenant-portal', 'package-room', 'ivr-doorrelease', 'property-analytics', 'amenity-booking', 'elevator-control', 'work-orders', 'move-inout', 'intercom', 'credentials', 'door-schedules', 'mobile-credentials', 'visitors', 'incidents', 'alerts', 'reports', 'floor-map', 'audit-trail', 'cameras', 'doors', 'events', 'cardholders', 'settings', 'connectors', 'travel-risk',
      // Kiosk modes for Sicunet Android wall unit
      'kiosk-visitor', 'kiosk-package', 'kiosk-directory', 'kiosk-amenity', 'kiosk-conference', 'kiosk-tardy',
      'kiosk-guard', 'kiosk-contractor', 'kiosk-muster', 'kiosk-datacenter', 'kiosk-hotdesk', 'kiosk-timeclock',
      'kiosk-patient-checkin', 'kiosk-hand-hygiene', 'kiosk-staff-id', 'kiosk-emergency-info',
      'cardholder-sync', 'pac-explorer'];
    for (const page of adapterPages) {
      app.get(`/${page}`, async (_req: FastifyRequest, reply: FastifyReply) => {
        return reply.type('text/html').send(loadUiHtml(`${page}.html`));
      });
    }
    log.info('Adapter UI pages registered: badge-designer, %s', adapterPages.join(', '));

    // ─── SiteSentrix landing page ─────────────────────────────────
    app.get('/sitesentrix', async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.type('text/html').send(loadUiHtml('sitesentrix.html'));
    });

    // ─── System Configurator (admin-only sales portal) ────────────
    app.get('/configurator', async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.type('text/html').send(loadUiHtml('configurator.html'));
    });

    // ─── Convenience proxy routes ─────────────────────────────────────────
    // Dashboard recipes reference simplified paths. Proxy to actual routes.
    app.get('/api/v1/lockdown/status', async (req: FastifyRequest, reply: FastifyReply) => {
      const resp = await app.inject({ method: 'GET', url: '/api/v1/data/lockdown/status', headers: req.headers as any });
      return reply.code(resp.statusCode).type(resp.headers['content-type'] as string || 'application/json').send(resp.body);
    });
    app.post('/api/v1/lockdown', async (req: FastifyRequest, reply: FastifyReply) => {
      const resp = await app.inject({ method: 'POST', url: '/api/v1/data/lockdown', headers: req.headers as any, payload: req.body as any });
      return reply.code(resp.statusCode).type(resp.headers['content-type'] as string || 'application/json').send(resp.body);
    });
    app.get('/api/v1/connectors/status', async (req: FastifyRequest, reply: FastifyReply) => {
      const resp = await app.inject({ method: 'GET', url: '/api/v1/data/connectors', headers: req.headers as any });
      return reply.code(resp.statusCode).type(resp.headers['content-type'] as string || 'application/json').send(resp.body);
    });
    app.get('/api/v1/dispatch/status', async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ status: 'standby', activeDispatches: 0, lastDispatch: null, provider: 'RapidSOS' });
    });
    log.info('Convenience proxy routes registered (lockdown, connectors, dispatch, panic)');

    // ─── Static assets route (/assets/*) ────────────────────────────────
    app.get('/assets/*', async (req: FastifyRequest, reply: FastifyReply) => {
      const assetPath = (req.params as any)['*'];
      if (!assetPath || assetPath.includes('..')) return reply.code(400).send('Invalid path');
      const mimeTypes: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', ico: 'image/x-icon', css: 'text/css', js: 'application/javascript', json: 'application/json' };
      const ext = assetPath.split('.').pop()?.toLowerCase() || '';
      for (const base of [
        join(__uiDirname, 'ui', 'assets'),
        join(__uiDirname, '..', 'ui', 'assets'),
        join(__uiDirname, '..', '..', 'cloud-sync', 'ui', 'assets'),
        join(__uiDirname, '..', '..', 'cloud-sync', 'dist', 'ui', 'assets'),
        join(__uiDirname, '..', '..', '..', 'packages', 'cloud-sync', 'ui', 'assets'),
        join(__uiDirname, '..', '..', '..', 'packages', 'cloud-sync', 'dist', 'ui', 'assets'),
      ]) {
        try {
          const data = readFileSync(join(base, assetPath));
          return reply.type(mimeTypes[ext] || 'application/octet-stream').header('Cache-Control', 'public, max-age=86400').send(data);
        } catch { /* next */ }
      }
      return reply.code(404).send('Asset not found');
    });

    // ─── Demo index routes (/:proxyIndex → demo by proxy table slot) ───
    // Maps proxy table indices to product identifiers so that visiting
    // e.g. /0 → SafeSchool demo, /3 → SafeSchool demo.
    // These indices mirror the proxy table in packages/activation (PROXY_TABLE).
    // Each slot injects DEMO_MODE + PRODUCT globals into the dashboard HTML,
    // allowing a single cloud instance to serve demo dashboards for all products
    // on the SiteSentrix landing page.
    const DEMO_INDEX_MAP: Record<number, { product: string; name: string }> = {
      0: { product: 'safeschool', name: 'SafeSchool' },
      1: { product: 'safeschool', name: 'SafeSchool' },
      2: { product: 'safeschool', name: 'SafeSchool' },
      3: { product: 'safeschool', name: 'SafeSchool' },
      4: { product: 'safeschool', name: 'SafeSchool' },
      5: { product: 'healthcare', name: 'Healthcare' },
      6: { product: 'property-guard', name: 'PropertyGuard' },
      7: { product: 'datacenter', name: 'Nexus DataCenter' },
      8: { product: 'lds-church', name: 'LDS Church MTC' },
    };

    app.get('/:proxyIndex', async (request: FastifyRequest, reply: FastifyReply) => {
      const idx = parseInt((request.params as any).proxyIndex, 10);
      if (isNaN(idx) || !(idx in DEMO_INDEX_MAP)) {
        return reply.code(404).type('text/html').send(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title></head>' +
          '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#141625;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif">' +
          '<div style="text-align:center"><h1 style="font-size:4rem;margin:0;color:#f43f5e">404</h1>' +
          '<p style="color:#94a3b8;margin-top:1rem">Demo slot not found</p>' +
          '<a href="/" style="color:#818cf8;text-decoration:none;margin-top:1rem;display:inline-block">Back to SiteSentrix</a></div></body></html>'
        );
      }
      const entry = DEMO_INDEX_MAP[idx];
      let html = loadUiHtml('dashboard.html');
      const inject = [
        `window.DEMO_MODE=true;`,
        `window.DEMO_ORG="demo";`,
        `window.PRODUCT=${JSON.stringify(entry.product)};`,
      ];
      html = html.replace('// Early product branding', inject.join('\n') + '\n// Early product branding');
      return reply.header('Cache-Control', 'no-store').type('text/html').send(html);
    });
    log.info('Demo index routes registered for slots 0-%d', Object.keys(DEMO_INDEX_MAP).length - 1);

    // ─── Wall WebSocket (dashboard push-to-wall) ─────────────────
    const wallClients = new Map<number, Set<import('ws').WebSocket>>();

    await app.register(async (scope) => {
      scope.get('/ws/wall', { websocket: true }, (socket: import('ws').WebSocket, _req: FastifyRequest) => {
        let screenId = 0;

        socket.on('message', (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString());

            // Wall screen registering itself
            if (msg.action === 'wall:register') {
              screenId = parseInt(msg.screen, 10) || 1;
              if (!wallClients.has(screenId)) wallClients.set(screenId, new Set());
              wallClients.get(screenId)!.add(socket);
              socket.send(JSON.stringify({ action: 'wall:registered', screen: screenId }));
              return;
            }

            // Operator pushing content to a wall screen
            if (msg.action?.startsWith('wall:')) {
              const target = parseInt(msg.screen, 10) || 0;
              if (target > 0) {
                const clients = wallClients.get(target);
                if (clients) {
                  const payload = JSON.stringify(msg);
                  for (const c of clients) {
                    if (c.readyState === 1) c.send(payload);
                  }
                }
              } else {
                // Broadcast to all wall screens
                for (const [, clients] of wallClients) {
                  const payload = JSON.stringify(msg);
                  for (const c of clients) {
                    if (c.readyState === 1) c.send(payload);
                  }
                }
              }
            }
          } catch { /* ignore bad messages */ }
        });

        socket.on('close', () => {
          if (screenId > 0) {
            wallClients.get(screenId)?.delete(socket);
          }
        });
      });
    });

    // ─── Visitor & Guard API endpoints ───────────────────────────
    await app.register(async (scope) => {
      // In-memory visitor store (replace with DB adapter later)
      const visitors: Record<string, any> = {};
      let visitorSeq = 1000;

      scope.post('/api/v1/kiosk/visitors/checkin', async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any;
        const id = `VIS-${++visitorSeq}`;
        const visitor = {
          id,
          name: body.name || 'Visitor',
          company: body.company || '',
          host: body.host || '',
          reason: body.reason || 'Meeting',
          phone: body.phone || '',
          photo: body.photo || null,
          badgeNumber: id,
          status: 'checked_in',
          checkInTime: new Date().toISOString(),
          checkOutTime: null,
        };
        visitors[id] = visitor;

        // Also push to sync engine as entity
        try {
          await opts.syncAdapter.processPush(`kiosk-local`, [{
            type: 'visitor', action: 'create', data: visitor, timestamp: visitor.checkInTime,
          }]);
        } catch { /* sync optional */ }

        // Queue badge print job
        try {
          await opts.syncAdapter.processPush(`kiosk-local`, [{
            type: 'print_job', action: 'create',
            data: { id: `PJ-${visitorSeq}`, visitorId: id, template: 'visitor-badge', status: 'queued', data: visitor },
            timestamp: visitor.checkInTime,
          }]);
        } catch { /* print optional */ }

        return reply.send({ success: true, visitor });
      });

      scope.get('/api/v1/kiosk/visitors', async (request: FastifyRequest) => {
        const query = request.query as { status?: string };
        let list = Object.values(visitors);
        if (query.status) {
          list = list.filter((v: any) => v.status === query.status);
        }
        return { visitors: list, total: list.length };
      });

      scope.post('/api/v1/kiosk/visitors/:id/checkout', async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const visitor = visitors[id];
        if (!visitor) return reply.code(404).send({ error: 'Visitor not found' });
        visitor.status = 'checked_out';
        visitor.checkOutTime = new Date().toISOString();

        try {
          await opts.syncAdapter.processPush(`kiosk-local`, [{
            type: 'visitor', action: 'update', data: visitor, timestamp: visitor.checkOutTime,
          }]);
        } catch { /* sync optional */ }

        return reply.send({ success: true, visitor });
      });

      scope.post('/api/v1/kiosk/guards/signin', async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any;
        const badgeNumber = body.badgeNumber || body.badge;
        const pin = body.pin;
        if (!badgeNumber || !pin) return reply.code(400).send({ error: 'Badge number and PIN required' });

        const guardId = `GUARD-${badgeNumber}`;
        const shift = {
          id: `SHIFT-${Date.now()}`,
          guardId,
          badgeNumber,
          guardName: body.name || `Guard ${badgeNumber}`,
          status: 'active',
          startTime: new Date().toISOString(),
          endTime: null,
        };

        try {
          await opts.syncAdapter.processPush(`kiosk-local`, [{
            type: 'guard_shift', action: 'create', data: shift, timestamp: shift.startTime,
          }]);
        } catch { /* sync optional */ }

        return reply.send({ success: true, shift });
      });
    });

    // Kiosk visitor routes already registered manually above (lines ~994-1050)

    log.info('Cloud-sync routes mounted (sync, fleet, license, dashboard, wall, kiosk, visitors, realtime-ws)');

    // ─── Cloud self-registration + PAC emulator poller ──────────────
    // Register this cloud instance as a "device" so it appears in the
    // Settings section.  Then poll PAC emulator URL from device config
    // to ingest doors, cameras, cardholders, and events.
    const CLOUD_SITE_ID = `cloud-${(process.env.DASHBOARD_PRODUCT || 'default').toLowerCase()}`;
    const CLOUD_ORG_ID = process.env.DASHBOARD_ADMIN_ORG ?? 'default';

    // Self-register on startup
    try {
      await opts.syncAdapter.upsertDevice({
        siteId: CLOUD_SITE_ID,
        orgId: CLOUD_ORG_ID,
        hostname: `cloud-${process.env.DASHBOARD_PRODUCT || 'edgeruntime'}`,
        ipAddress: '127.0.0.1',
        apiPort: deps.port,
        version: '1.0.0',
        mode: 'CLOUD',
        pendingChanges: 0,
      });
      log.info({ siteId: CLOUD_SITE_ID, orgId: CLOUD_ORG_ID }, 'Cloud instance self-registered as device');
    } catch (err) {
      log.warn({ err }, 'Failed to self-register cloud instance as device');
    }

    // PAC emulator poller — checks device config for connector URLs and polls them
    let pacPollerTimer: ReturnType<typeof setInterval> | null = null;
    let lastPacUrl: string | null = null;

    const pollPacEmulator = async () => {
      try {
        const deviceConfig = await opts.syncAdapter.getDeviceConfig(CLOUD_SITE_ID);
        if (!deviceConfig?.config?.connectors) return;

        const connectors = deviceConfig.config.connectors as Array<{
          name: string; type: string; apiUrl?: string; apiKey?: string; enabled?: boolean;
        }>;

        for (const conn of connectors) {
          if (conn.enabled === false || !conn.apiUrl) continue;

          const baseUrl = conn.apiUrl.replace(/\/+$/, '');

          // Fetch full state from PAC emulator
          let state: any;
          try {
            const resp = await fetch(`${baseUrl}/admin/state`, { signal: AbortSignal.timeout(10000) });
            if (!resp.ok) continue;
            state = await resp.json();
          } catch { continue; }

          const entities: Array<{ type: string; action: 'create' | 'update' | 'delete'; data: any; timestamp: string }> = [];
          const now = new Date().toISOString();

          // Doors
          if (state.doors?.length) {
            for (const door of state.doors) {
              entities.push({
                type: 'door', action: 'create',
                data: {
                  id: door.id, name: door.name, status: door.status, mode: door.mode,
                  location: door.location || '', panelId: door.panelId, readerId: door.readerId,
                  _sourceConnector: conn.name,
                },
                timestamp: now,
              });
            }
          }

          // Cameras
          if (state.cameras?.length) {
            for (const cam of state.cameras) {
              // Build snapshot/stream URLs pointing through our proxy or directly to emulator
              const snapshotUrl = cam.snapshotUrl || `${baseUrl}/vms/cameras/${cam.id}/snapshot`;
              const streamUrl = cam.streamUrl || `${baseUrl}/vms/cameras/${cam.id}/stream`;
              entities.push({
                type: 'camera', action: 'create',
                data: {
                  id: cam.id, name: cam.name, status: cam.status || 'online',
                  location: cam.location || cam.group || '',
                  type: cam.type || 'fixed', ptzCapable: cam.ptzCapable || false,
                  snapshotUrl, streamUrl,
                  _sourceConnector: conn.name,
                },
                timestamp: now,
              });
            }
          }

          // Cardholders
          if (state.cardholders?.length) {
            for (const ch of state.cardholders) {
              entities.push({
                type: 'cardholder', action: 'create',
                data: {
                  id: ch.id, firstName: ch.firstName, lastName: ch.lastName,
                  badgeNumber: ch.badgeNumber, accessLevels: ch.accessLevels || [],
                  isActive: ch.active !== false, personType: ch.personType || 'employee',
                  _sourceConnector: conn.name,
                },
                timestamp: now,
              });
            }
          }

          // Recent events
          if (state.recentEvents?.length) {
            for (const evt of state.recentEvents) {
              entities.push({
                type: 'event', action: 'create',
                data: {
                  id: evt.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
                  eventType: evt.type || evt.eventType || 'access',
                  severity: evt.severity || 'info',
                  timestamp: evt.timestamp || now,
                  doorId: evt.doorId, doorName: evt.doorName,
                  cardholderName: evt.cardholderName, badgeNumber: evt.badgeNumber,
                  granted: evt.granted, direction: evt.direction,
                  description: evt.description || evt.message,
                  _sourceConnector: conn.name,
                },
                timestamp: evt.timestamp || now,
              });
            }
          }

          // Also push connector status
          entities.push({
            type: 'connector', action: 'create',
            data: {
              id: conn.name, name: conn.name, type: conn.type,
              connected: true, status: 'connected',
              eventsReceived: state.eventCount || 0, errors: 0,
              lastSeen: now, siteId: CLOUD_SITE_ID,
            },
            timestamp: now,
          });

          if (entities.length > 0) {
            try {
              await opts.syncAdapter.processPush(CLOUD_SITE_ID, entities, CLOUD_ORG_ID);
              if (baseUrl !== lastPacUrl) {
                log.info({ connector: conn.name, baseUrl, entities: entities.length }, 'PAC emulator data synced');
                lastPacUrl = baseUrl;
              }
            } catch (err) {
              log.warn({ err, connector: conn.name }, 'Failed to push PAC emulator data');
            }
          }
        }
      } catch (err) {
        log.warn({ err }, 'PAC emulator poll error');
      }
    };

    // Poll every 15 seconds
    pacPollerTimer = setInterval(pollPacEmulator, 15000);
    // Run first poll after 5 seconds (give server time to start)
    setTimeout(pollPacEmulator, 5000);
    log.info({ siteId: CLOUD_SITE_ID }, 'PAC emulator poller started (configure connectors in Settings)');
  }

  await app.listen({ port: deps.port, host: '0.0.0.0' });
  log.info({ port: deps.port }, 'API server listening');

  return { app, realtimeChannel };
}
