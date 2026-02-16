import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const doorRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/doors — All door statuses
  fastify.get<{
    Querystring: { siteId?: string; buildingId?: string };
  }>('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { siteId, buildingId } = request.query;
    const where: any = {};

    if (buildingId) where.buildingId = buildingId;
    else if (siteId) where.siteId = siteId;
    else where.siteId = { in: request.jwtUser.siteIds };

    const doors = await fastify.prisma.door.findMany({
      where,
      orderBy: [{ buildingId: 'asc' }, { name: 'asc' }],
    });

    return doors;
  });

  // POST /api/v1/doors/:id/lock — requires FIRST_RESPONDER or higher
  fastify.post<{ Params: { id: string } }>('/:id/lock', { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] }, async (request, reply) => {
    const door = await fastify.prisma.door.findUnique({ where: { id: request.params.id } });
    if (!door) return reply.code(404).send({ error: 'Door not found' });

    const updated = await fastify.prisma.door.update({
      where: { id: door.id },
      data: { status: 'LOCKED' },
    });

    fastify.wsManager.broadcastToSite(door.siteId, 'door:updated', updated);

    await fastify.prisma.auditLog.create({
      data: {
        siteId: door.siteId,
        userId: request.jwtUser.id,
        action: 'DOOR_LOCKED',
        entity: 'Door',
        entityId: door.id,
        ipAddress: request.ip,
      },
    });

    // Queue event for BadgeGuard analytics (non-blocking)
    queueBadgeGuardEvent(fastify, door, 'LOCK', request.jwtUser).catch(() => {});

    return updated;
  });

  // POST /api/v1/doors/:id/unlock — requires FIRST_RESPONDER or higher
  fastify.post<{ Params: { id: string } }>('/:id/unlock', { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] }, async (request, reply) => {
    const door = await fastify.prisma.door.findUnique({ where: { id: request.params.id } });
    if (!door) return reply.code(404).send({ error: 'Door not found' });

    const updated = await fastify.prisma.door.update({
      where: { id: door.id },
      data: { status: 'UNLOCKED' },
    });

    fastify.wsManager.broadcastToSite(door.siteId, 'door:updated', updated);

    await fastify.prisma.auditLog.create({
      data: {
        siteId: door.siteId,
        userId: request.jwtUser.id,
        action: 'DOOR_UNLOCKED',
        entity: 'Door',
        entityId: door.id,
        ipAddress: request.ip,
      },
    });

    // Queue event for BadgeGuard analytics (non-blocking)
    queueBadgeGuardEvent(fastify, door, 'UNLOCK', request.jwtUser).catch(() => {});

    return updated;
  });
};

/**
 * Queue a door event for BadgeGuard analytics if integration is enabled.
 * Stores events in a Redis list for periodic batch push.
 */
async function queueBadgeGuardEvent(
  fastify: any,
  door: any,
  eventType: string,
  user: any,
) {
  const integration = await fastify.prisma.badgeGuardIntegration.findUnique({
    where: { siteId: door.siteId },
  });
  if (!integration || !integration.enabled) return;

  const building = await fastify.prisma.building.findUnique({
    where: { id: door.buildingId },
    select: { name: true },
  });

  const event = {
    doorId: door.id,
    doorName: door.name,
    eventType,
    timestamp: new Date().toISOString(),
    userId: user.id,
    userName: user.name,
    buildingName: building?.name,
    floor: door.floor,
    zone: door.zone,
  };

  await fastify.redis.rpush(
    `badgeguard:events:${door.siteId}`,
    JSON.stringify(event),
  );
}

export default doorRoutes;
