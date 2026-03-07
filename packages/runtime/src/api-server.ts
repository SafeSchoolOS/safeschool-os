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

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  onPush(listener: ConnectorEventListener): void {
    this.listeners.push(listener);
  }

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

  getAll(): Record<string, unknown>[] {
    return this.events;
  }

  getSince(since: string): Record<string, unknown>[] {
    return this.events.filter(e => (e._receivedAt as string) >= since);
  }

  get count(): number {
    return this.events.length;
  }
}

export interface ApiServerResult {
  app: FastifyInstance;
  realtimeChannel?: RealtimeChannel;
}

// ─── Simple JWT (HMAC-SHA256) ──────────────────────────────────────────────

const JWT_SECRET = process.env.EDGERUNTIME_JWT_SECRET || randomBytes(32).toString('hex');
const JWT_EXPIRY_S = 86400; // 24 hours

function signJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_S })).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');

  if (!timingSafeEqual(Buffer.from(signature!), Buffer.from(expected))) return null;

  const payload = JSON.parse(Buffer.from(body!, 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

export async function createApiServer(deps: ApiServerDeps): Promise<ApiServerResult> {
  const app = Fastify({ logger: false });
  let realtimeChannel: RealtimeChannel | undefined;

  // CORS — allow product frontends to call cloud API
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['https://safeschoolos.org', 'https://edge.safeschool.org'];
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin) return cb(null, true);
      // Allow localhost in development
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Org-Id', 'X-Sync-Key', 'X-Sync-Timestamp', 'X-Sync-Signature'],
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

    // Auth middleware for protected routes — mount on /api/* except /api/auth/*
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
        url.startsWith('/api/v1/kiosk/')
      ) {
        return;
      }

      // Only protect /api/* routes
      if (!url.startsWith('/api/')) return;

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

    // Return federated analytics (from peers like BadgeGuard)
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

  // ─── CLOUD mode: mount cloud-sync routes ────────────────────────
  if (deps.operatingMode === 'CLOUD' && deps.cloudOptions) {
    const { syncRoutes, fleetRoutes, entityRoutes, userRoutes, licenseRoutes, dashboardRoutes, deviceConfigRoutes, RealtimeChannel: RealtimeChannelClass } = await import('@edgeruntime/cloud-sync');
    const opts = deps.cloudOptions;

    // Register WebSocket plugin (required for RealtimeChannel)
    await app.register(fastifyWebsocket);

    // JWT auth middleware for fleet API (dashboard calls these)
    const fleetAuthHook = async (request: FastifyRequest, reply: FastifyReply) => {
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

    // Edge device sync endpoints (push/pull/heartbeat) — HMAC-authed, no JWT
    await app.register(syncRoutes, {
      prefix: '/api/v1/sync',
      syncKey: opts.syncKey,
      adapter: opts.syncAdapter,
    });

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
    });

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
      unwrapProxy('visitors');

    });

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

        if (password !== adminPass) {
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

    // Customer-facing license/subscription endpoints
    await app.register(licenseRoutes, {
      prefix: '/api/v1/license',
      adapter: opts.licenseAdapter,
      getOrgId: opts.getOrgId ?? ((request: any) => request.headers['x-org-id'] as string),
    });

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

    await app.register(dashboardRoutes, {
      prefix: '/dashboard',
      signJwt,
      verifyJwt,
      productName: process.env.DASHBOARD_PRODUCT,
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
        scope.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
          return reply.redirect('/dashboard');
        });
      }

      scope.get('/login', async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.redirect('/dashboard');
      });

      // /demo — redirect to /dashboard/demo (no-login demo mode)
      scope.get('/demo', async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.redirect('/dashboard/demo');
      });
    });

    // Real-time WebSocket channel for edge device commands
    realtimeChannel = new RealtimeChannelClass({ syncKey: opts.syncKey });
    realtimeChannel.register(app, '/api/v1/sync/ws');

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
    log.info('Wall and kiosk routes registered');

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

    log.info('Cloud-sync routes mounted (sync, fleet, license, dashboard, wall, kiosk, realtime-ws)');

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
