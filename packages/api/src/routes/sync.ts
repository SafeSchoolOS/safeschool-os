import type { FastifyPluginAsync } from 'fastify';

/**
 * Cloud-side sync endpoints for edge devices.
 * Only registered when OPERATING_MODE=cloud.
 */
const syncRoutes: FastifyPluginAsync = async (fastify) => {
  // Verify sync key middleware
  const verifySyncKey = async (request: any, reply: any) => {
    const syncKey = request.headers['x-sync-key'];
    const expectedKey = process.env.CLOUD_SYNC_KEY;
    if (!expectedKey || syncKey !== expectedKey) {
      return reply.code(401).send({ error: 'Invalid sync key' });
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

    let synced = 0;
    let errors = 0;

    for (const entity of entities) {
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
