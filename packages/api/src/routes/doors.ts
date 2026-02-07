import type { FastifyPluginAsync } from 'fastify';

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

  // POST /api/v1/doors/:id/lock
  fastify.post<{ Params: { id: string } }>('/:id/lock', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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

    return updated;
  });

  // POST /api/v1/doors/:id/unlock
  fastify.post<{ Params: { id: string } }>('/:id/unlock', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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

    return updated;
  });
};

export default doorRoutes;
