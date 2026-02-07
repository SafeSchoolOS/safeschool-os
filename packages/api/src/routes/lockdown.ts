import type { FastifyPluginAsync } from 'fastify';

const lockdownRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/lockdown — Initiate lockdown
  fastify.post<{
    Body: {
      scope: string;
      targetId: string;
      alertId?: string;
    };
  }>('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { scope, targetId, alertId } = request.body;
    const siteId = request.jwtUser.siteIds[0];

    if (!scope || !targetId) {
      return reply.code(400).send({ error: 'scope and targetId are required' });
    }

    // Update doors based on scope
    const doorFilter: any = { siteId, isEmergencyExit: false };
    if (scope === 'BUILDING') doorFilter.buildingId = targetId;
    if (scope === 'FLOOR') {
      doorFilter.buildingId = targetId;
      // Floor-based lockdown would need floor field
    }

    const result = await fastify.prisma.door.updateMany({
      where: doorFilter,
      data: { status: 'LOCKED' },
    });

    const lockdown = await fastify.prisma.lockdownCommand.create({
      data: {
        siteId,
        scope: scope as any,
        targetId,
        initiatedById: request.jwtUser.id,
        alertId,
        doorsLocked: result.count,
      },
    });

    fastify.wsManager.broadcastToSite(siteId, 'lockdown:initiated', lockdown);

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'LOCKDOWN_INITIATED',
        entity: 'LockdownCommand',
        entityId: lockdown.id,
        details: { scope, targetId, doorsLocked: result.count },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(lockdown);
  });

  // DELETE /api/v1/lockdown/:id — Release lockdown
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const lockdown = await fastify.prisma.lockdownCommand.findUnique({
      where: { id: request.params.id },
    });

    if (!lockdown) {
      return reply.code(404).send({ error: 'Lockdown not found' });
    }

    if (lockdown.releasedAt) {
      return reply.code(400).send({ error: 'Lockdown already released' });
    }

    // Unlock doors based on scope
    const doorFilter: any = { siteId: lockdown.siteId };
    if (lockdown.scope === 'BUILDING') doorFilter.buildingId = lockdown.targetId;

    await fastify.prisma.door.updateMany({
      where: doorFilter,
      data: { status: 'UNLOCKED' },
    });

    const updated = await fastify.prisma.lockdownCommand.update({
      where: { id: lockdown.id },
      data: { releasedAt: new Date() },
    });

    fastify.wsManager.broadcastToSite(lockdown.siteId, 'lockdown:released', updated);

    await fastify.prisma.auditLog.create({
      data: {
        siteId: lockdown.siteId,
        userId: request.jwtUser.id,
        action: 'LOCKDOWN_RELEASED',
        entity: 'LockdownCommand',
        entityId: lockdown.id,
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // GET /api/v1/lockdown/active — Active lockdowns for site
  fastify.get('/active', { preHandler: [fastify.authenticate] }, async (request) => {
    const lockdowns = await fastify.prisma.lockdownCommand.findMany({
      where: {
        siteId: { in: request.jwtUser.siteIds },
        releasedAt: null,
      },
      orderBy: { initiatedAt: 'desc' },
    });
    return lockdowns;
  });
};

export default lockdownRoutes;
