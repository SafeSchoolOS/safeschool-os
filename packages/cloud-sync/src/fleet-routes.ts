/**
 * Fleet Management Routes
 *
 * Fastify plugin for managing edge device fleet from the cloud dashboard.
 * These routes are intended for authenticated admin users (RBAC is the
 * caller's responsibility — just mount behind your existing auth middleware).
 *
 * Usage:
 *   import { fleetRoutes } from '@edgeruntime/cloud-sync';
 *   app.register(fleetRoutes, {
 *     prefix: '/api/v1/fleet',
 *     adapter,
 *     offlineThresholdMs: 5 * 60 * 1000,
 *   });
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import type { ProductFlag, LicenseTier } from '@edgeruntime/core';
import { generateKey, validateKey, PRODUCT_PROXY_INDEX } from '@edgeruntime/activation';
import type { SyncDatabaseAdapter } from './types.js';

const log = createLogger('cloud-sync:fleet');

export interface FleetRoutesOptions {
  adapter: SyncDatabaseAdapter;
  offlineThresholdMs?: number;
  /** Extract org ID from request for org-scoped queries. If not set, shows all devices. */
  getOrgId?: (request: FastifyRequest) => string | undefined;
}

export async function fleetRoutes(fastify: FastifyInstance, options: FleetRoutesOptions) {
  const { adapter, offlineThresholdMs = 5 * 60 * 1000, getOrgId } = options;

  // ─── GET /devices ───────────────────────────────────────────────

  fastify.get('/devices', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const devices = await adapter.listDevices(orgId);
      const now = Date.now();

      const enriched = devices.map(d => ({
        ...d,
        online: (now - d.lastHeartbeatAt.getTime()) < offlineThresholdMs,
      }));

      return reply.send({ devices: enriched });
    } catch (err) {
      log.error({ err }, 'Failed to list devices');
      return reply.code(500).send({ error: 'Failed to list devices' });
    }
  });

  // ─── GET /devices/:siteId ──────────────────────────────────────

  fastify.get('/devices/:siteId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { siteId } = request.params as { siteId: string };
    try {
      const device = await adapter.getDevice(siteId);
      if (!device) {
        return reply.code(404).send({ error: 'Device not found' });
      }

      // Org isolation: don't leak devices from other orgs
      const orgId = getOrgId?.(request);
      if (orgId && device.orgId && device.orgId !== orgId) {
        return reply.code(404).send({ error: 'Device not found' });
      }

      const online = (Date.now() - device.lastHeartbeatAt.getTime()) < offlineThresholdMs;
      return reply.send({ ...device, online });
    } catch (err) {
      log.error({ err, siteId }, 'Failed to get device');
      return reply.code(500).send({ error: 'Failed to get device' });
    }
  });

  // ─── POST /devices/:siteId/upgrade ─────────────────────────────

  fastify.post('/devices/:siteId/upgrade', async (request: FastifyRequest, reply: FastifyReply) => {
    const { siteId } = request.params as { siteId: string };
    const { targetVersion } = request.body as { targetVersion: string };

    if (!targetVersion) {
      return reply.code(400).send({ error: 'Missing targetVersion' });
    }

    try {
      const device = await adapter.getDevice(siteId);
      if (!device) {
        return reply.code(404).send({ error: 'Device not found' });
      }

      // Org isolation: don't allow cross-org upgrades
      const orgId = getOrgId?.(request);
      if (orgId && device.orgId && device.orgId !== orgId) {
        return reply.code(404).send({ error: 'Device not found' });
      }

      await adapter.setDeviceTargetVersion(siteId, targetVersion);
      log.info({ siteId, targetVersion }, 'Upgrade queued for device');
      return reply.send({ ok: true, siteId, targetVersion });
    } catch (err) {
      log.error({ err, siteId }, 'Failed to queue upgrade');
      return reply.code(500).send({ error: 'Failed to queue upgrade' });
    }
  });

  // ─── POST /upgrade-all ─────────────────────────────────────────

  fastify.post('/upgrade-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const { targetVersion } = request.body as { targetVersion: string };

    if (!targetVersion) {
      return reply.code(400).send({ error: 'Missing targetVersion' });
    }

    try {
      const orgId = getOrgId?.(request);
      const count = await adapter.setAllDevicesTargetVersion(targetVersion, orgId);
      log.info({ targetVersion, deviceCount: count }, 'Batch upgrade queued');
      return reply.send({ ok: true, targetVersion, devicesQueued: count });
    } catch (err) {
      log.error({ err }, 'Failed to queue batch upgrade');
      return reply.code(500).send({ error: 'Failed to queue batch upgrade' });
    }
  });

  // ─── POST /upgrade-selected ────────────────────────────────────

  fastify.post('/upgrade-selected', async (request: FastifyRequest, reply: FastifyReply) => {
    const { targetVersion, siteIds } = request.body as { targetVersion: string; siteIds: string[] };

    if (!targetVersion || !Array.isArray(siteIds) || siteIds.length === 0) {
      return reply.code(400).send({ error: 'Missing targetVersion or siteIds' });
    }

    try {
      const orgId = getOrgId?.(request);
      let upgraded = 0;
      for (const siteId of siteIds) {
        const device = await adapter.getDevice(siteId);
        if (!device) continue;
        // Org isolation: skip devices from other orgs
        if (orgId && device.orgId && device.orgId !== orgId) continue;
        await adapter.setDeviceTargetVersion(siteId, targetVersion);
        upgraded++;
      }

      log.info({ targetVersion, requested: siteIds.length, upgraded }, 'Selected upgrade queued');
      return reply.send({ ok: true, targetVersion, devicesQueued: upgraded });
    } catch (err) {
      log.error({ err }, 'Failed to queue selected upgrade');
      return reply.code(500).send({ error: 'Failed to queue selected upgrade' });
    }
  });

  // ─── GET /summary ──────────────────────────────────────────────

  fastify.get('/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const summary = await adapter.getFleetSummary(offlineThresholdMs, orgId);
      return reply.send(summary);
    } catch (err) {
      log.error({ err }, 'Failed to get fleet summary');
      return reply.code(500).send({ error: 'Failed to get fleet summary' });
    }
  });

  // ─── GET /devices/:siteId/proxy/* ─────────────────────────────────
  // Proxy API requests to a specific edge device, avoiding CORS/network issues.

  fastify.get('/devices/:siteId/proxy/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const { siteId } = request.params as { siteId: string };
    try {
      const device = await adapter.getDevice(siteId);
      if (!device?.ipAddress) {
        return reply.code(404).send({ error: 'Device not found or no IP address' });
      }

      // Org isolation: don't proxy to devices from other orgs
      const orgId = getOrgId?.(request);
      if (orgId && device.orgId && device.orgId !== orgId) {
        return reply.code(404).send({ error: 'Device not found or no IP address' });
      }

      const wildcard = (request.params as Record<string, string>)['*'];
      const url = new URL(request.url, 'http://localhost');
      const queryString = url.search;
      const target = `http://${device.ipAddress}:${(device as any).apiPort || 8470}/${wildcard}${queryString}`;

      const res = await fetch(target, { signal: AbortSignal.timeout(10_000) });
      const data = await res.json();
      return reply.send(data);
    } catch (err) {
      log.error({ err, siteId }, 'Edge device proxy failed');
      return reply.code(502).send({ error: 'Edge device unreachable' });
    }
  });

  // ─── POST /licenses/generate ────────────────────────────────────
  // Generate a multi-product activation key from any product's admin dashboard.

  const VALID_PRODUCTS: ProductFlag[] = [
    'safeschool', 'safeschool', 'safeschool', 'safeschool', 'safeschool', 'safeschool',
  ];
  const VALID_TIERS: LicenseTier[] = ['trial', 'starter', 'pro', 'enterprise'];

  fastify.post('/licenses/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { products, tier, proxy } = request.body as {
      products: string[];
      tier: string;
      proxy?: string;
    };

    if (!Array.isArray(products) || products.length === 0) {
      return reply.code(400).send({ error: 'products is required (array of product names)' });
    }

    for (const p of products) {
      if (!VALID_PRODUCTS.includes(p as ProductFlag)) {
        return reply.code(400).send({
          error: `Unknown product "${p}". Valid: ${VALID_PRODUCTS.join(', ')}`,
        });
      }
    }

    if (!tier || !VALID_TIERS.includes(tier as LicenseTier)) {
      return reply.code(400).send({
        error: `Invalid tier "${tier}". Valid: ${VALID_TIERS.join(', ')}`,
      });
    }

    // Resolve proxy index: product name, numeric index, or default to first product
    let proxyIndex: number;
    if (proxy !== undefined) {
      const namedIndex = PRODUCT_PROXY_INDEX[proxy as keyof typeof PRODUCT_PROXY_INDEX];
      if (namedIndex !== undefined) {
        proxyIndex = namedIndex;
      } else {
        const num = parseInt(proxy, 10);
        if (isNaN(num) || num < 0 || num > 1023) {
          return reply.code(400).send({
            error: `Invalid proxy "${proxy}". Use a product name or 0-1023.`,
          });
        }
        proxyIndex = num;
      }
    } else {
      // Default: use the first product's proxy index as primary
      const firstProduct = products[0] as keyof typeof PRODUCT_PROXY_INDEX;
      proxyIndex = PRODUCT_PROXY_INDEX[firstProduct] ?? 0;
    }

    try {
      const key = generateKey({
        products: products as ProductFlag[],
        tier: tier as LicenseTier,
        proxyIndex,
      });

      const validation = validateKey(key);

      log.info({ products, tier, proxyIndex }, 'Activation key generated');

      return reply.send({
        key,
        products: validation.products,
        tier: validation.tier,
        proxyIndex: validation.proxyIndex,
        proxyUrl: validation.proxyUrl ?? null,
        issuedAt: validation.issuedAt?.toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to generate key');
      return reply.code(500).send({ error: 'Key generation failed' });
    }
  });

  // ─── POST /licenses/validate ────────────────────────────────────
  // Validate an activation key and return its decoded fields.

  fastify.post('/licenses/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { key } = request.body as { key: string };

    if (!key) {
      return reply.code(400).send({ error: 'key is required' });
    }

    const result = validateKey(key);

    if (!result.valid) {
      return reply.send({ valid: false, error: result.error });
    }

    return reply.send({
      valid: true,
      products: result.products,
      tier: result.tier,
      proxyIndex: result.proxyIndex,
      proxyUrl: result.proxyUrl ?? null,
      issuedAt: result.issuedAt?.toISOString(),
    });
  });
}
