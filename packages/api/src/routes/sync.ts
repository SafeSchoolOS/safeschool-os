import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Cloud-side sync endpoints for edge devices.
 * Only registered when OPERATING_MODE=cloud.
 */

/** Max age for signed requests (5 minutes) */
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;
// Allowed entity types for sync push
const ALLOWED_ENTITY_TYPES = new Set([
  'alert', 'visitor', 'door', 'audit_log', 'lockdown_command',
]);
const ALLOWED_ACTIONS = new Set(['create', 'update', 'delete']);
const MAX_BATCH_SIZE = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const syncRoutes: FastifyPluginAsync = async (fastify) => {
  // Verify sync key + HMAC signature middleware
  const verifySyncKey = async (request: any, reply: any) => {
    const syncKey = request.headers['x-sync-key'];
    const expectedKey = process.env.CLOUD_SYNC_KEY;
    if (!expectedKey || syncKey !== expectedKey) {
      return reply.code(401).send({ error: 'Invalid sync key' });
    }

    // Verify HMAC signature if present (required for production, optional during migration)
    const timestamp = request.headers['x-sync-timestamp'] as string | undefined;
    const signature = request.headers['x-sync-signature'] as string | undefined;

    // HMAC signature is mandatory in production
    if (process.env.NODE_ENV === 'production' && (!timestamp || !signature)) {
      return reply.code(401).send({ error: 'HMAC signature required in production', code: 'HMAC_REQUIRED' });
    }

    if (timestamp && signature) {
      // Reject stale requests (replay protection)
      const requestAge = Date.now() - new Date(timestamp).getTime();
      if (isNaN(requestAge) || Math.abs(requestAge) > MAX_REQUEST_AGE_MS) {
        return reply.code(401).send({
          error: 'Request timestamp expired or invalid',
          code: 'REPLAY_REJECTED',
        });
      }

      // Reconstruct the signing payload
      const method = request.method;
      const path = request.url;
      const bodyStr = request.method === 'POST'
        ? JSON.stringify(request.body)
        : '';

      const expectedSig = crypto
        .createHmac('sha256', expectedKey)
        .update(`${timestamp}.${method}.${path}.${bodyStr}`)
        .digest('hex');

      // Timing-safe comparison to prevent timing attacks
      const sigBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSig, 'hex');
      if (sigBuffer.length !== expectedBuffer.length ||
          !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        return reply.code(401).send({
          error: 'Invalid request signature',
          code: 'SIGNATURE_INVALID',
        });
      }
    }
  };

  // POST /api/v1/sync/push — Edge pushes changes to cloud
  fastify.post<{
    Body: {
      siteId: string;
      entities: {
        type: string;
        action: 'create' | 'update' | 'delete';
        data: any;
        timestamp: string;
      }[];
    };
  }>('/push', { preHandler: [verifySyncKey] }, async (request, reply) => {
    const { siteId, entities } = request.body;

    // Validate top-level fields
    if (!siteId || typeof siteId !== 'string') {
      return reply.code(400).send({ error: 'siteId is required and must be a string' });
    }
    if (!Array.isArray(entities)) {
      return reply.code(400).send({ error: 'entities must be an array' });
    }
    if (entities.length > MAX_BATCH_SIZE) {
      return reply.code(400).send({
        error: `Batch too large: ${entities.length} entities exceeds max of ${MAX_BATCH_SIZE}`,
      });
    }

    let synced = 0;
    let errors = 0;

    for (const entity of entities) {
      // Validate each entity
      if (!ALLOWED_ENTITY_TYPES.has(entity.type)) {
        fastify.log.warn({ type: entity.type }, 'Sync push: unknown entity type, skipping');
        errors++;
        continue;
      }
      if (!ALLOWED_ACTIONS.has(entity.action)) {
        fastify.log.warn({ action: entity.action }, 'Sync push: invalid action, skipping');
        errors++;
        continue;
      }
      if (!entity.data || typeof entity.data !== 'object' || !entity.data.id) {
        fastify.log.warn({ entity }, 'Sync push: entity.data missing or has no id, skipping');
        errors++;
        continue;
      }
      if (typeof entity.data.id !== 'string' || !UUID_RE.test(entity.data.id)) {
        fastify.log.warn({ id: entity.data.id }, 'Sync push: entity.data.id is not a valid UUID, skipping');
        errors++;
        continue;
      }

      try {
        // Whitelist fields for each entity type to prevent arbitrary data injection
        const d = entity.data;
        switch (entity.type) {
          case 'alert': {
            if (entity.action === 'create') {
              const safeCreate = {
                id: d.id, siteId, level: d.level, status: d.status,
                source: d.source, triggeredById: d.triggeredById,
                buildingId: d.buildingId, buildingName: d.buildingName || '',
                floor: d.floor, roomId: d.roomId,
                message: d.message ? sanitizeText(d.message) : null,
                triggeredAt: d.triggeredAt ? new Date(d.triggeredAt) : new Date(),
              };
              const safeUpdate = { ...safeCreate };
              await fastify.prisma.alert.upsert({
                where: { id: d.id },
                update: safeUpdate,
                create: safeCreate,
              });
            }
            break;
          }
          case 'visitor': {
            if (entity.action === 'create' || entity.action === 'update') {
              const safeCreate = {
                id: d.id, siteId,
                firstName: d.firstName ? sanitizeText(d.firstName) : '',
                lastName: d.lastName ? sanitizeText(d.lastName) : '',
                company: d.company ? sanitizeText(d.company) : undefined,
                hostName: d.hostName ? sanitizeText(d.hostName) : undefined,
                purpose: d.purpose ? sanitizeText(d.purpose) : '',
                destination: d.destination ? sanitizeText(d.destination) : '',
                status: d.status, checkedInAt: d.checkedInAt,
                checkedOutAt: d.checkedOutAt,
              };
              const safeUpdate = {
                firstName: safeCreate.firstName,
                lastName: safeCreate.lastName,
                status: safeCreate.status,
                checkedOutAt: safeCreate.checkedOutAt,
              };
              await fastify.prisma.visitor.upsert({
                where: { id: d.id },
                update: safeUpdate,
                create: safeCreate,
              });
            }
            break;
          }
          case 'door':
            if (entity.action === 'update') {
              await fastify.prisma.door.update({
                where: { id: d.id },
                data: { status: d.status },
              });
            }
            break;
          case 'audit_log': {
            const safeAudit = {
              id: d.id, siteId, userId: d.userId,
              action: d.action, entity: d.entity, entityId: d.entityId,
              details: d.details, ipAddress: d.ipAddress,
              createdAt: d.createdAt ? new Date(d.createdAt) : new Date(),
            };
            await fastify.prisma.auditLog.create({ data: safeAudit });
            break;
          }
          case 'lockdown_command':
            await fastify.prisma.lockdownCommand.upsert({
              where: { id: d.id },
              update: {
                releasedAt: d.releasedAt,
                doorsLocked: d.doorsLocked,
                updatedAt: d.updatedAt,
              },
              create: {
                id: d.id, siteId, scope: d.scope, targetId: d.targetId,
                initiatedById: d.initiatedById, alertId: d.alertId,
                doorsLocked: d.doorsLocked, metadata: d.metadata,
                initiatedAt: d.initiatedAt ? new Date(d.initiatedAt) : new Date(),
              },
            });
            break;
        }
        synced++;
      } catch (err) {
        errors++;
        fastify.log.error({ entity, err }, 'Sync push entity failed');
      }
    }

    return { synced, errors, timestamp: new Date().toISOString() };
  });

  // GET /api/v1/sync/pull — Edge pulls changes from cloud
  fastify.get<{
    Querystring: { since: string; entities?: string; siteId: string };
  }>('/pull', { preHandler: [verifySyncKey] }, async (request) => {
    const { since, entities: entityFilter, siteId } = request.query;
    const sinceDate = new Date(since);
    const entityTypes = entityFilter ? entityFilter.split(',') : ['user', 'site', 'building', 'room'];
    const result: Record<string, any[]> = {};

    if (entityTypes.includes('user')) {
      result.users = await fastify.prisma.user.findMany({
        where: {
          updatedAt: { gte: sinceDate },
          sites: { some: { siteId } },
        },
        select: {
          id: true, email: true, name: true, role: true, phone: true,
          isActive: true, createdAt: true, updatedAt: true,
          sites: { select: { siteId: true } },
          // passwordHash intentionally excluded from sync
        },
      });
    }

    if (entityTypes.includes('site')) {
      result.sites = await fastify.prisma.site.findMany({
        where: { id: siteId, updatedAt: { gte: sinceDate } },
      });
    }

    if (entityTypes.includes('building')) {
      result.buildings = await fastify.prisma.building.findMany({
        where: { siteId, updatedAt: { gte: sinceDate } },
      });
    }

    if (entityTypes.includes('room')) {
      result.rooms = await fastify.prisma.room.findMany({
        where: {
          building: { siteId },
          updatedAt: { gte: sinceDate },
        },
      });
    }

    return { data: result, timestamp: new Date().toISOString() };
  });

  // POST /api/v1/sync/heartbeat — Edge heartbeat (extended for fleet management)
  fastify.post<{
    Body: {
      siteId: string;
      mode: string;
      pendingChanges: number;
      version?: string;
      hostname?: string;
      nodeVersion?: string;
      diskUsagePercent?: number;
      memoryUsageMb?: number;
      ipAddress?: string;
      upgradeStatus?: string;
      upgradeError?: string;
    };
  }>('/heartbeat', { preHandler: [verifySyncKey] }, async (request) => {
    const {
      siteId, mode, pendingChanges,
      version, hostname, nodeVersion,
      diskUsagePercent, memoryUsageMb, ipAddress,
      upgradeStatus, upgradeError,
    } = request.body;

    fastify.log.info({ siteId, mode, pendingChanges, version }, 'Edge heartbeat received');

    // Upsert EdgeDevice record
    const upsertData: any = {
      operatingMode: mode,
      pendingChanges: pendingChanges ?? 0,
      lastHeartbeatAt: new Date(),
      ...(version && { currentVersion: version }),
      ...(hostname && { hostname }),
      ...(nodeVersion && { nodeVersion }),
      ...(ipAddress && { ipAddress }),
      ...(diskUsagePercent !== undefined && { diskUsagePercent }),
      ...(memoryUsageMb !== undefined && { memoryUsageMb }),
    };

    // Handle upgrade status reports from edge
    if (upgradeStatus === 'SUCCESS') {
      upsertData.upgradeStatus = 'IDLE';
      upsertData.targetVersion = null;
      upsertData.upgradeError = null;
    } else if (upgradeStatus === 'FAILED') {
      upsertData.upgradeStatus = 'IDLE';
      upsertData.upgradeError = upgradeError || 'Unknown error';
    } else if (upgradeStatus === 'IN_PROGRESS') {
      upsertData.upgradeStatus = 'IN_PROGRESS';
    }

    const device = await fastify.prisma.edgeDevice.upsert({
      where: { siteId },
      update: upsertData,
      create: {
        siteId,
        ...upsertData,
        upgradeStatus: upsertData.upgradeStatus || 'IDLE',
      },
    });

    // Check if an upgrade should be pushed to this edge device
    let upgrade: { targetVersion: string; action: string } | undefined;
    if (
      device.targetVersion &&
      device.currentVersion !== device.targetVersion &&
      device.upgradeStatus === 'IDLE' &&
      upgradeStatus !== 'IN_PROGRESS'
    ) {
      // Mark as PENDING so we only send the command once
      await fastify.prisma.edgeDevice.update({
        where: { siteId },
        data: { upgradeStatus: 'PENDING' },
      });
      upgrade = { targetVersion: device.targetVersion, action: 'update' };
    }

    return {
      ack: true,
      timestamp: new Date().toISOString(),
      ...(upgrade && { upgrade }),
    };
  });
};

export default syncRoutes;
