/**
 * Pairing Routes — TV-style device pairing code flow
 *
 * Fastify plugin mounted at /api/v1/pairing.
 * Allows edge devices to request a 5-char pairing code,
 * admins to claim devices by entering the code in the dashboard,
 * and admins to unclaim devices.
 *
 * Endpoints:
 *   POST /request  — Device requests a pairing code (no auth)
 *   GET  /status/:code — Device polls for claim status (no auth)
 *   POST /claim    — Admin claims device with code (dashboard session)
 *   POST /unclaim  — Admin removes device from site (dashboard session)
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import type { ProductFlag, LicenseTier } from '@edgeruntime/core';
import { generateKey, validateKey, PRODUCT_PROXY_INDEX } from '@edgeruntime/activation';
import type { SyncDatabaseAdapter } from './types.js';

const log = createLogger('cloud-sync:pairing');

// ─── Default provisioning recipes per product ───────────────────────
// When a device pairs and no custom recipe is stored, use these defaults.
// Each maps product → adapter bundle IDs that the device should download.
const DEFAULT_PRODUCT_RECIPES: Record<string, { name: string; integrations: string[] }> = {
  safeschool: {
    name: 'safeschool',
    integrations: [
      'access-control/verkada',
      'cameras/onvif',
      'weapons-detection/evolv',
      'gunshot-detection/soundthinking',
      'panic-devices/centegix',
      'dispatch/rapidsos',
      'notifications/twilio-sms',
      'notifications/fcm-push',
      'visitor-mgmt/informdata-sor',
      'background-screening/watchlist',
      'badge-printing/http',
      'weather/open-meteo',
      'environmental/iot-sensors',
      'transportation/zonar',
      'auth/saml',
    ],
  },
  safeschool: {
    name: 'safeschool',
    integrations: [
      'access-control/genetec',
      'cameras/genetec-vms',
      'badge-design/canvas-renderer',
      'badge-printing/http',
      'visitor-mgmt/informdata-sor',
      'background-screening/watchlist',
      'notifications/sendgrid-email',
      'notifications/twilio-sms',
      'hr-sync/blackboard',
      'reporting/docusign',
      'auth/oidc',
      'weather/open-meteo',
    ],
  },
  'safeschool': {
    name: 'safeschool',
    integrations: [
      'access-control/genetec',
      'access-control/vendor',
      'cameras/milestone',
      'cameras/avigilon',
      'dispatch/rapidsos',
      'dispatch/sip-direct',
      'guard-tour/sqlite',
      'notifications/twilio-sms',
      'notifications/pa-intercom',
      'panic-devices/rave-panic',
      'weapons-detection/ceia',
      'threat-intel/zeroeyes',
      'environmental/iot-sensors',
      'auth/ldap-auth',
      'weather/open-meteo',
    ],
  },
};

// Unambiguous 26-char alphabet: no 0/O, 1/I/L, B/8, S/5, Z/2
const PAIRING_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';
const CODE_LENGTH = 5;
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Rate limiting: track requests per IP
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

export interface PairingRoutesOptions {
  adapter: SyncDatabaseAdapter;
  /** Extract org ID from request (for claim/unclaim — dashboard session). */
  getOrgId?: (request: FastifyRequest) => string | undefined;
  /** Auth hook for claim/unclaim endpoints. */
  authHook?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

function generatePairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += PAIRING_ALPHABET[bytes[i]! % PAIRING_ALPHABET.length];
  }
  return code;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRequestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

export async function pairingRoutes(fastify: FastifyInstance, options: PairingRoutesOptions) {
  const { adapter, getOrgId, authHook } = options;

  // ─── POST /request — Device requests a pairing code ───────────
  fastify.post('/request', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip;
    if (!checkRateLimit(ip)) {
      return reply.code(429).send({ error: 'Too many requests. Try again in a minute.' });
    }

    const body = request.body as {
      product?: string;
      fingerprint?: string;
      hostname?: string;
      version?: string;
    };

    if (!body?.product || !body?.fingerprint) {
      return reply.code(400).send({ error: 'Missing required fields: product, fingerprint' });
    }

    try {
      // Check if there's already an active (unexpired, unclaimed) code for this fingerprint
      const existing = adapter.getPairingCodeByFingerprint ? await adapter.getPairingCodeByFingerprint(body.fingerprint) : null;
      if (existing && !existing.claimedAt && new Date(existing.expiresAt).getTime() > Date.now()) {
        return reply.send({
          code: existing.code,
          expiresAt: existing.expiresAt,
        });
      }

      // Generate a unique code (retry on collision)
      let code: string;
      let attempts = 0;
      do {
        code = generatePairingCode();
        attempts++;
        if (attempts > 10) {
          return reply.code(503).send({ error: 'Could not generate unique code. Try again.' });
        }
        const existingCode = adapter.getPairingCode ? await adapter.getPairingCode(code) : null;
        if (!existingCode || new Date(existingCode.expiresAt).getTime() < Date.now()) {
          break;
        }
      } while (true);

      const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

      if (!adapter.createPairingCode) {
        log.error('adapter.createPairingCode is not defined — pairing codes will not be stored');
      } else {
        await adapter.createPairingCode({
          code,
          deviceFingerprint: body.fingerprint,
          product: body.product,
          hostname: body.hostname,
          ipAddress: ip,
          version: body.version,
          expiresAt,
        });
      }

      log.info({ code, product: body.product, fingerprint: body.fingerprint.slice(0, 8), hasCreate: !!adapter.createPairingCode }, 'Pairing code generated');

      return reply.send({ code, expiresAt });
    } catch (err) {
      log.error({ err }, 'Failed to create pairing code');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // ─── GET /status/:code — Device polls for claim status ────────
  fastify.get('/status/:code', async (request: FastifyRequest, reply: FastifyReply) => {
    const { code } = request.params as { code: string };

    if (!code || code.length !== CODE_LENGTH) {
      return reply.code(400).send({ error: 'Invalid code' });
    }

    try {
      const record = adapter.getPairingCode ? await adapter.getPairingCode(code.toUpperCase()) : null;

      if (!record) {
        return reply.code(404).send({ error: 'Code not found' });
      }

      if (new Date(record.expiresAt).getTime() < Date.now() && !record.claimedAt) {
        return reply.send({ status: 'expired' });
      }

      if (record.claimedAt && record.claimResponse) {
        return reply.send({
          status: 'claimed',
          ...record.claimResponse,
        });
      }

      return reply.send({ status: 'pending' });
    } catch (err) {
      log.error({ err }, 'Failed to check pairing status');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // ─── POST /claim — Admin claims device with code ──────────────
  fastify.post('/claim', {
    ...(authHook ? { preHandler: authHook } : {}),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      code?: string;
      siteId?: string;
      siteName?: string;
      products?: string[];
      tier?: string;
    };

    if (!body?.code || !body?.siteName) {
      return reply.code(400).send({ error: 'Missing required fields: code, siteName' });
    }

    const code = body.code.toUpperCase().replace(/\s/g, '');
    if (code.length !== CODE_LENGTH) {
      return reply.code(400).send({ error: 'Invalid code format' });
    }

    try {
      const record = adapter.getPairingCode ? await adapter.getPairingCode(code) : null;

      if (!record) {
        return reply.code(404).send({ error: 'Code not found' });
      }

      if (record.claimedAt) {
        return reply.code(409).send({ error: 'Code already claimed' });
      }

      if (new Date(record.expiresAt).getTime() < Date.now()) {
        return reply.code(410).send({ error: 'Code expired' });
      }

      // Get org ID from session
      const orgId = getOrgId?.(request);

      // Determine products — use request body or fallback to device's product
      const products = body.products && body.products.length > 0
        ? body.products
        : [record.product];

      const tier = (body.tier || 'starter') as LicenseTier;

      // Generate activation key
      const firstProduct = products[0] as keyof typeof PRODUCT_PROXY_INDEX;
      const proxyIndex = PRODUCT_PROXY_INDEX[firstProduct] ?? 0;
      const activationKey = generateKey({
        products: products as ProductFlag[],
        tier,
        proxyIndex,
      });

      // Generate cloud sync key
      const cloudSyncKey = randomBytes(32).toString('hex');

      // Generate site ID
      const siteId = body.siteId || (await import('node:crypto')).randomUUID();

      // Link activation key to account if multi-tenancy is available
      if (orgId && adapter.linkKeyToAccount) {
        await adapter.linkKeyToAccount(activationKey, orgId);
      }

      // Create site if adapter supports it
      if (orgId && adapter.createAccountSite) {
        try {
          await adapter.createAccountSite(orgId, { siteName: body.siteName });
        } catch {
          // Site may already exist
        }
      }

      // Resolve recipe + required adapters for provisioning
      let recipe: any = undefined;
      let requiredAdapters: string[] = [];
      try {
        // First check for a custom stored recipe for this org
        const adapterAny = adapter as any;
        if (orgId && adapterAny.getItem) {
          const recipeKey = `recipe:${products[0]}`;
          const storedRecipe = await adapterAny.getItem(recipeKey);
          if (storedRecipe) {
            recipe = JSON.parse(storedRecipe);
          }
        }

        // Fall back to default product recipe if no custom one found
        if (!recipe && products[0]) {
          recipe = DEFAULT_PRODUCT_RECIPES[products[0]] || undefined;
        }

        // Extract adapter IDs from recipe integrations
        if (recipe?.integrations && Array.isArray(recipe.integrations)) {
          requiredAdapters = recipe.integrations.map((i: any) =>
            typeof i === 'string' ? i : i.adapterId
          );
        }
      } catch {
        // Non-fatal — device will work without recipe pre-provisioning
      }

      // Build claim response that device will receive
      const keyValidation = validateKey(activationKey);
      const claimResponse = {
        activationKey,
        cloudSyncKey,
        siteId,
        siteName: body.siteName,
        orgId: orgId || undefined,
        products,
        tier,
        proxyUrl: keyValidation.proxyUrl || undefined,
        // On-demand provisioning: recipe + adapter list for device to download
        recipe: recipe || undefined,
        requiredAdapters: requiredAdapters.length > 0 ? requiredAdapters : undefined,
        adapterRegistryUrl: keyValidation.proxyUrl
          ? `${keyValidation.proxyUrl}/api/v1/adapters`
          : undefined,
      };

      // Store claim in database
      if (adapter.claimPairingCode) await adapter.claimPairingCode(code, {
        claimedByAccountId: orgId,
        claimResponse,
      });

      log.info({ code, siteId, products, orgId }, 'Device paired');

      return reply.send({ success: true, ...claimResponse });
    } catch (err) {
      log.error({ err }, 'Failed to claim pairing code');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });

  // ─── POST /unclaim — Admin removes device from site ───────────
  fastify.post('/unclaim', {
    ...(authHook ? { preHandler: authHook } : {}),
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { siteId?: string; fingerprint?: string };

    if (!body?.siteId && !body?.fingerprint) {
      return reply.code(400).send({ error: 'Missing siteId or fingerprint' });
    }

    try {
      // Clear the device's org association so heartbeat returns unclaimed
      if (body.siteId) {
        const device = await adapter.getDevice(body.siteId);
        if (device) {
          // Update device record to remove org association
          await adapter.upsertDevice({
            siteId: body.siteId,
            orgId: undefined,
            hostname: device.hostname,
            mode: device.mode,
            pendingChanges: device.pendingChanges,
          });
          log.info({ siteId: body.siteId }, 'Device unclaimed');
        }
      }

      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to unclaim device');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
}
