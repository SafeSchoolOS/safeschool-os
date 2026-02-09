import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';

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
        switch (entity.type) {
          case 'alert':
            if (entity.action === 'create') {
              await fastify.prisma.alert.upsert({
                where: { id: entity.data.id },
                update: entity.data,
                create: entity.data,
              });
            }
            break;
          case 'visitor':
            if (entity.action === 'create' || entity.action === 'update') {
              await fastify.prisma.visitor.upsert({
                where: { id: entity.data.id },
                update: entity.data,
                create: entity.data,
              });
            }
            break;
          case 'door':
            if (entity.action === 'update') {
              await fastify.prisma.door.update({
                where: { id: entity.data.id },
                data: { status: entity.data.status },
              });
            }
            break;
          case 'audit_log':
            await fastify.prisma.auditLog.create({ data: entity.data });
            break;
          case 'lockdown_command':
            await fastify.prisma.lockdownCommand.upsert({
              where: { id: entity.data.id },
              update: {
                releasedAt: entity.data.releasedAt,
                doorsLocked: entity.data.doorsLocked,
                updatedAt: entity.data.updatedAt,
              },
              create: entity.data,
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
        include: { sites: true },
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

  // POST /api/v1/sync/heartbeat — Edge heartbeat
  fastify.post<{
    Body: { siteId: string; mode: string; pendingChanges: number };
  }>('/heartbeat', { preHandler: [verifySyncKey] }, async (request) => {
    const { siteId, mode, pendingChanges } = request.body;

    fastify.log.info({ siteId, mode, pendingChanges }, 'Edge heartbeat received');

    return { ack: true, timestamp: new Date().toISOString() };
  });
};

export default syncRoutes;
