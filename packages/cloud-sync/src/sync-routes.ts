/**
 * Sync Routes - Push / Pull / Heartbeat
 *
 * Fastify plugin that registers the three core sync endpoints.
 * Mount this on your cloud server at any prefix (e.g., /api/v1/sync).
 *
 * Usage:
 *   import { syncRoutes } from '@edgeruntime/cloud-sync';
 *   app.register(syncRoutes, { prefix: '/api/v1/sync', ...options });
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { createHmacVerifyHook } from './hmac-verify.js';
import type {
  CloudSyncOptions,
  PushRequest,
  PushResponse,
  PullRequest,
  PullResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  LicenseInfo,
} from './types.js';
import { BILLING_EXEMPT_PRODUCTS } from './types.js';

const log = createLogger('cloud-sync:routes');

export async function syncRoutes(fastify: FastifyInstance, options: CloudSyncOptions) {
  const {
    adapter,
    syncKey,
    maxBatchSize = 100,
    maxRequestAgeMs = 5 * 60 * 1000,
    offlineThresholdMs = 5 * 60 * 1000,
    allowedEntityTypes = [],
    redactFields = [],
    licenseAdapter,
    gracePeriodMs: _gracePeriodMs,
  } = options;

  // Register HMAC verification on all routes in this plugin scope
  const hmacHook = createHmacVerifyHook({ syncKey, maxRequestAgeMs });
  fastify.addHook('preHandler', hmacHook);

  /**
   * Check billing status for an org. Returns true if sync is allowed.
   * Sends 402 and returns false if blocked.
   */
  async function checkLicenseForOrg(orgId: string | undefined, reply: FastifyReply): Promise<boolean> {
    if (!licenseAdapter) return true; // no adapter = no enforcement
    if (!orgId) return true; // no org = no enforcement

    const license = await licenseAdapter.getLicense(orgId);
    if (!license || !license.status) return true; // no license record or no status = legacy, skip

    // If ALL products are billing-exempt, skip enforcement
    const hasNonExempt = license.products.some(p => !BILLING_EXEMPT_PRODUCTS.has(p));
    if (!hasNonExempt) return true;

    const now = Date.now();

    switch (license.status) {
      case 'active':
        return true;
      case 'trial': {
        if (!license.expiresAt || new Date(license.expiresAt).getTime() > now) return true;
        // Trial expired — check grace period
        if (license.gracePeriodEndsAt && new Date(license.gracePeriodEndsAt).getTime() > now) return true;
        reply.code(402).send({
          error: 'Trial expired',
          status: license.status,
          expiresAt: license.expiresAt?.toISOString() ?? null,
          gracePeriodEndsAt: license.gracePeriodEndsAt?.toISOString() ?? null,
        });
        return false;
      }
      case 'past_due':
      case 'canceled': {
        if (license.gracePeriodEndsAt && new Date(license.gracePeriodEndsAt).getTime() > now) return true;
        reply.code(402).send({
          error: 'Payment required',
          status: license.status,
          expiresAt: license.expiresAt?.toISOString() ?? null,
          gracePeriodEndsAt: license.gracePeriodEndsAt?.toISOString() ?? null,
        });
        return false;
      }
      case 'expired': {
        reply.code(402).send({
          error: 'License expired',
          status: license.status,
          expiresAt: license.expiresAt?.toISOString() ?? null,
          gracePeriodEndsAt: license.gracePeriodEndsAt?.toISOString() ?? null,
        });
        return false;
      }
      default:
        return true;
    }
  }

  /** Build LicenseInfo for heartbeat response. */
  async function getLicenseInfo(orgId: string | undefined): Promise<LicenseInfo | undefined> {
    if (!licenseAdapter || !orgId) return undefined;
    const license = await licenseAdapter.getLicense(orgId);
    if (!license || !license.status) return undefined;
    return {
      status: license.status,
      expiresAt: license.expiresAt?.toISOString() ?? null,
      gracePeriodEndsAt: license.gracePeriodEndsAt?.toISOString() ?? null,
    };
  }

  // ─── POST /push ─────────────────────────────────────────────────

  fastify.post('/push', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as PushRequest;

    if (!body?.siteId || !Array.isArray(body.entities)) {
      return reply.code(400).send({ error: 'Missing siteId or entities array' });
    }

    if (body.entities.length > maxBatchSize) {
      return reply.code(400).send({
        error: `Batch too large: ${body.entities.length} entities (max ${maxBatchSize})`,
      });
    }

    // Validate entity types if whitelist is configured
    if (allowedEntityTypes.length > 0) {
      const invalid = body.entities.filter(e => !allowedEntityTypes.includes(e.type));
      if (invalid.length > 0) {
        const types = [...new Set(invalid.map(e => e.type))];
        return reply.code(400).send({ error: `Disallowed entity types: ${types.join(', ')}` });
      }
    }

    // Validate each entity has required fields
    for (const entity of body.entities) {
      if (!entity.type || !entity.action || !entity.data || !entity.timestamp) {
        return reply.code(400).send({ error: 'Each entity must have type, action, data, and timestamp' });
      }
      if (!['create', 'update', 'delete'].includes(entity.action)) {
        return reply.code(400).send({ error: `Invalid action: ${entity.action}` });
      }
    }

    try {
      // Look up device to enforce org isolation
      const device = await adapter.getDevice(body.siteId);
      if (!device) {
        return reply.code(403).send({ error: 'Device not registered — send a heartbeat first' });
      }

      // Check billing status
      const allowed = await checkLicenseForOrg(device.orgId, reply);
      if (!allowed) return;

      const result = await adapter.processPush(body.siteId, body.entities, device.orgId);
      const response: PushResponse = {
        synced: result.synced,
        errors: result.errors,
        timestamp: new Date().toISOString(),
      };

      log.info({ siteId: body.siteId, orgId: device.orgId, synced: result.synced, errors: result.errors }, 'Push processed');
      return reply.code(200).send(response);
    } catch (err) {
      log.error({ err, siteId: body.siteId }, 'Push failed');
      return reply.code(500).send({ error: 'Internal sync error' });
    }
  });

  // ─── GET /pull ──────────────────────────────────────────────────

  fastify.get('/pull', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as PullRequest;

    if (!query.siteId || !query.since) {
      return reply.code(400).send({ error: 'Missing siteId or since parameter' });
    }

    const since = new Date(query.since);
    if (isNaN(since.getTime())) {
      return reply.code(400).send({ error: 'Invalid since timestamp' });
    }

    const entityTypes = query.entities
      ? query.entities.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    try {
      // Look up device to enforce org isolation
      const device = await adapter.getDevice(query.siteId);
      if (!device) {
        return reply.code(403).send({ error: 'Device not registered — send a heartbeat first' });
      }

      // Check billing status
      const allowed = await checkLicenseForOrg(device.orgId, reply);
      if (!allowed) return;

      let data = await adapter.processPull(query.siteId, since, entityTypes, device.orgId);

      // Redact sensitive fields
      if (redactFields.length > 0) {
        data = redactFromPullResponse(data, redactFields);
      }

      const response: PullResponse = {
        data,
        timestamp: new Date().toISOString(),
      };

      log.info({ siteId: query.siteId, orgId: device.orgId, entityTypes: entityTypes.length || 'all' }, 'Pull served');
      return reply.code(200).send(response);
    } catch (err) {
      log.error({ err, siteId: query.siteId }, 'Pull failed');
      return reply.code(500).send({ error: 'Internal sync error' });
    }
  });

  // ─── POST /heartbeat ───────────────────────────────────────────

  fastify.post('/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as HeartbeatRequest;

    if (!body?.siteId || !body.mode) {
      return reply.code(400).send({ error: 'Missing siteId or mode' });
    }

    try {
      // Update or create device record
      const device = await adapter.upsertDevice({
        siteId: body.siteId,
        orgId: body.orgId,
        hostname: body.hostname,
        ipAddress: body.ipAddress ?? request.ip,
        apiPort: body.apiPort,
        version: body.version,
        nodeVersion: body.nodeVersion,
        mode: body.mode,
        pendingChanges: body.pendingChanges ?? 0,
        diskUsagePercent: body.diskUsagePercent,
        memoryUsageMb: body.memoryUsageMb,
        upgradeStatus: body.upgradeStatus,
        upgradeError: body.upgradeError,
      });

      // Ack config version if reported
      if (body.configVersion) {
        try {
          await adapter.ackDeviceConfig(body.siteId, body.configVersion);
        } catch (err) {
          log.warn({ err, siteId: body.siteId }, 'Failed to ack config version');
        }
      }

      // Build response
      const response: HeartbeatResponse = {
        ack: true,
        timestamp: new Date().toISOString(),
      };

      // If device has a pending upgrade and is idle, send upgrade command
      if (
        device.targetVersion &&
        device.upgradeStatus !== 'IN_PROGRESS' &&
        device.upgradeStatus !== 'SUCCESS' &&
        device.version !== device.targetVersion
      ) {
        response.upgrade = {
          targetVersion: device.targetVersion,
          action: 'update',
        };
        log.info({ siteId: body.siteId, targetVersion: device.targetVersion }, 'Sending upgrade command');
      }

      // Return peer list for devices in the same org
      if (device.orgId) {
        try {
          const orgDevices = await adapter.listDevices(device.orgId);
          const now = Date.now();
          response.peers = orgDevices
            .filter(d => d.siteId !== body.siteId && d.ipAddress && (now - d.lastHeartbeatAt.getTime()) < offlineThresholdMs)
            .map(d => ({
              siteId: d.siteId,
              ipAddress: d.ipAddress!,
              apiPort: d.apiPort ?? 3000,
              version: d.version ?? 'unknown',
              lastHeartbeatAt: d.lastHeartbeatAt.toISOString(),
            }));
        } catch (err) {
          log.warn({ err }, 'Failed to build peer list');
        }
      }

      // Include license info in heartbeat response
      const licenseInfo = await getLicenseInfo(device.orgId);
      if (licenseInfo) {
        response.license = licenseInfo;
      }

      // Include pending device config if version differs from what edge has applied
      try {
        const deviceConfig = await adapter.getDeviceConfig(body.siteId);
        if (deviceConfig && deviceConfig.config.version !== deviceConfig.appliedVersion) {
          response.config = deviceConfig.config;
        }
      } catch (err) {
        log.warn({ err, siteId: body.siteId }, 'Failed to load device config');
      }

      log.debug({
        siteId: body.siteId,
        mode: body.mode,
        version: body.version,
        pending: body.pendingChanges,
        peers: response.peers?.length ?? 0,
      }, 'Heartbeat received');

      return reply.code(200).send(response);
    } catch (err) {
      log.error({ err, siteId: body.siteId }, 'Heartbeat failed');
      return reply.code(500).send({ error: 'Internal error' });
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────

function redactFromPullResponse(
  data: Record<string, unknown[]>,
  fields: string[],
): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const [type, records] of Object.entries(data)) {
    result[type] = records.map(record => {
      if (typeof record !== 'object' || record === null) return record;
      const cleaned = { ...(record as Record<string, unknown>) };
      for (const field of fields) {
        delete cleaned[field];
      }
      return cleaned;
    });
  }
  return result;
}
