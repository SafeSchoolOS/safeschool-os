/**
 * Dashboard Routes
 *
 * Fastify plugin that serves the fleet dashboard HTML and provides
 * authentication for the dashboard UI.
 *
 * Mount at /dashboard:
 *   app.register(dashboardRoutes, {
 *     prefix: '/dashboard',
 *     signJwt, verifyJwt,
 *     userAccountStore, // optional — for user-based auth
 *   });
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { oauthRoutes } from './oauth-routes.js';
import type { UserDatabaseAdapter } from './types.js';

const log = createLogger('cloud-sync:dashboard');

export interface DashboardRoutesOptions {
  /** Sign a JWT payload and return the token string */
  signJwt: (payload: Record<string, unknown>) => string;
  /** Verify a JWT token and return the payload, or null if invalid */
  verifyJwt: (token: string) => Record<string, unknown> | null;
  /** Verify credentials — returns { orgId, username, role } or null */
  verifyCredentials?: (username: string, password: string) => Promise<{
    orgId: string;
    username: string;
    role: string;
  } | null>;
  /** User database adapter for OAuth-based login */
  userAdapter?: UserDatabaseAdapter;
  /** Product name for dashboard branding (e.g. 'badgeguard', 'access-gsoc') */
  productName?: string;
  /** OAuth provider configuration */
  oauth?: {
    baseUrl: string;
    defaultOrgId?: string;
    defaultRole?: string;
    google?: { clientId: string; clientSecret: string };
    microsoft?: { clientId: string; clientSecret: string; tenantId?: string };
    apple?: { clientId: string; teamId: string; keyId: string; privateKey: string };
  };
}

let cachedHtml: string | null = null;

function loadDashboardHtml(): string {
  if (cachedHtml) return cachedHtml;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  // In dist: dist/dashboard-routes.js -> look for dist/ui/dashboard.html
  // In src: src/dashboard-routes.ts -> look for ui/dashboard.html
  const paths = [
    join(__dirname, 'ui', 'dashboard.html'),
    join(__dirname, '..', 'ui', 'dashboard.html'),
  ];

  for (const p of paths) {
    try {
      cachedHtml = readFileSync(p, 'utf-8');
      return cachedHtml;
    } catch {
      // try next path
    }
  }

  return '<html><body><h1>Dashboard HTML not found</h1></body></html>';
}

export async function dashboardRoutes(fastify: FastifyInstance, options: DashboardRoutesOptions) {
  const { signJwt, verifyJwt, verifyCredentials, userAdapter, oauth, productName } = options;
  if (productName) log.info({ productName }, 'Dashboard product branding active');

  const demoEnabled = process.env.DEMO_MODE === 'true' || process.env.DEMO_MODE === '1';
  const demoOrgId = process.env.DEMO_ORG_ID || process.env.DASHBOARD_ADMIN_ORG || 'demo';

  // GET / — serve dashboard HTML (unauthenticated, contains its own login form)
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    let html = loadDashboardHtml();
    if (options.productName) {
      html = html.replace('</head>',
        `<script>window.PRODUCT=${JSON.stringify(options.productName)}</script>\n</head>`);
    }
    return reply.type('text/html').send(html);
  });

  // GET /demo — no-login demo mode (read-only, auto-authenticated)
  if (demoEnabled) {
    fastify.get('/demo', async (_request: FastifyRequest, reply: FastifyReply) => {
      const demoToken = signJwt({
        sub: 'demo',
        username: 'demo',
        orgId: demoOrgId,
        role: 'viewer',
        demo: true,
      });

      let html = loadDashboardHtml();
      const demoScript = `<script>
window.DEMO_MODE=true;
sessionStorage.setItem('fleet_token',${JSON.stringify(demoToken)});
sessionStorage.setItem('fleet_org',${JSON.stringify(demoOrgId)});
</script>`;
      if (options.productName) {
        html = html.replace('</head>',
          `<script>window.PRODUCT=${JSON.stringify(options.productName)}</script>\n${demoScript}\n</head>`);
      } else {
        html = html.replace('</head>', `${demoScript}\n</head>`);
      }
      return reply.type('text/html').send(html);
    });
    log.info({ orgId: demoOrgId }, 'Demo mode enabled at /dashboard/demo');
  }

  // POST /auth/login — authenticate and return JWT
  fastify.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { username?: string; password?: string } | null;

    if (!body?.username || !body?.password) {
      return reply.code(400).send({ error: 'Missing username or password' });
    }

    // Try custom verifyCredentials first
    if (verifyCredentials) {
      const result = await verifyCredentials(body.username, body.password);
      if (result) {
        const token = signJwt({
          sub: result.username,
          username: result.username,
          orgId: result.orgId,
          role: result.role,
        });
        return reply.send({ token, orgId: result.orgId, username: result.username, role: result.role });
      }
    }

    // Fall back to env-var admin credentials
    const adminUser = process.env.DASHBOARD_ADMIN_USER ?? 'admin';
    const adminPass = process.env.DASHBOARD_ADMIN_PASSWORD;

    if (!adminPass) {
      log.warn('No DASHBOARD_ADMIN_PASSWORD set and no verifyCredentials provided');
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    if (body.username === adminUser && body.password === adminPass) {
      const orgId = process.env.DASHBOARD_ADMIN_ORG ?? 'default';
      const token = signJwt({
        sub: adminUser,
        username: adminUser,
        orgId,
        role: 'admin',
      });
      return reply.send({ token, orgId, username: adminUser, role: 'admin' });
    }

    return reply.code(401).send({ error: 'Invalid credentials' });
  });

  // Register OAuth sub-plugin if configured
  if (userAdapter && oauth) {
    await fastify.register(oauthRoutes, {
      prefix: '/auth',
      signJwt,
      userAdapter,
      baseUrl: oauth.baseUrl,
      defaultOrgId: oauth.defaultOrgId,
      defaultRole: oauth.defaultRole,
      google: oauth.google,
      microsoft: oauth.microsoft,
      apple: oauth.apple,
    });
    log.info('OAuth routes registered at /dashboard/auth');
  }
}
