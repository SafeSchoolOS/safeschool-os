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
    if (!request.jwtUser.siteIds.includes(door.siteId)) {
      return reply.code(404).send({ error: 'Door not found' });
    }

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

  // POST /api/v1/doors/:id/unlock — requires FIRST_RESPONDER or higher
  fastify.post<{ Params: { id: string } }>('/:id/unlock', { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] }, async (request, reply) => {
    const door = await fastify.prisma.door.findUnique({ where: { id: request.params.id } });
    if (!door) return reply.code(404).send({ error: 'Door not found' });
    if (!request.jwtUser.siteIds.includes(door.siteId)) {
      return reply.code(404).send({ error: 'Door not found' });
    }

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
  // POST /api/v1/doors/:id/report-status — AC adapter or webhook reports a door status change
  // Handles FORCED, HELD (propped), OFFLINE etc. and auto-creates health events + work orders
  fastify.post<{
    Params: { id: string };
    Body: { status: string; metadata?: any };
  }>('/:id/report-status', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const door = await fastify.prisma.door.findUnique({ where: { id: request.params.id } });
    if (!door) return reply.code(404).send({ error: 'Door not found' });
    if (!request.jwtUser.siteIds.includes(door.siteId)) {
      return reply.code(404).send({ error: 'Door not found' });
    }

    const newStatus = request.body.status as any;
    const validStatuses = ['LOCKED', 'UNLOCKED', 'OPEN', 'FORCED', 'HELD', 'UNKNOWN'];
    if (!validStatuses.includes(newStatus)) {
      return reply.code(400).send({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    // Update door status
    const updated = await fastify.prisma.door.update({
      where: { id: door.id },
      data: { status: newStatus },
    });

    fastify.wsManager.broadcastToSite(door.siteId, 'door:updated', updated);

    // For HELD (propped) or FORCED doors, create a health event + auto work order
    if (newStatus === 'HELD' || newStatus === 'FORCED') {
      const eventType = newStatus === 'HELD' ? 'HELD_OPEN' : 'FORCED_OPEN';
      const severity = newStatus === 'FORCED' ? 'CRITICAL' : 'WARNING';

      // Check if there's already an unresolved event for this door + type
      const existing = await fastify.prisma.doorHealthEvent.findFirst({
        where: { doorId: door.id, eventType: eventType as any, resolvedAt: null },
      });

      if (!existing) {
        const healthEvent = await fastify.prisma.doorHealthEvent.create({
          data: {
            doorId: door.id,
            siteId: door.siteId,
            eventType: eventType as any,
            severity,
            detectedAt: new Date(),
            autoWorkOrder: true,
            metadata: request.body.metadata || null,
          },
        });

        // Auto-create work order for maintenance
        const title = newStatus === 'HELD'
          ? `Propped door: ${door.name} — needs maintenance check`
          : `Forced entry: ${door.name} — immediate inspection required`;

        const workOrder = await fastify.prisma.workOrder.create({
          data: {
            siteId: door.siteId,
            doorId: door.id,
            healthEventId: healthEvent.id,
            title,
            description: newStatus === 'HELD'
              ? `Door "${door.name}" has been held/propped open. This may indicate a faulty closer, wedged door, or policy violation. Please inspect and repair.`
              : `Door "${door.name}" was forced open without authorization. Inspect for damage and verify security.`,
            priority: newStatus === 'FORCED' ? 'URGENT_WO' as any : 'HIGH_WO' as any,
            createdById: request.jwtUser.id,
          },
        });

        // Broadcast health alert
        fastify.wsManager.broadcastToSite(door.siteId, 'door:health-alert', {
          door: { id: door.id, name: door.name },
          eventType,
          severity,
          workOrderId: workOrder.id,
        });

        await fastify.prisma.auditLog.create({
          data: {
            siteId: door.siteId,
            userId: request.jwtUser.id,
            action: newStatus === 'HELD' ? 'DOOR_PROPPED_OPEN' : 'DOOR_FORCED_OPEN',
            entity: 'Door',
            entityId: door.id,
            details: { eventType, severity, workOrderId: workOrder.id, healthEventId: healthEvent.id },
            ipAddress: request.ip,
          },
        });

        return { ...updated, healthEvent, workOrder };
      }
    }

    // If door goes back to LOCKED/UNLOCKED, auto-resolve any open health events
    if (newStatus === 'LOCKED' || newStatus === 'UNLOCKED') {
      await fastify.prisma.doorHealthEvent.updateMany({
        where: { doorId: door.id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId: door.siteId,
        userId: request.jwtUser.id,
        action: `DOOR_STATUS_REPORTED`,
        entity: 'Door',
        entityId: door.id,
        details: { newStatus },
        ipAddress: request.ip,
      },
    });

    return updated;
  });
};

export default doorRoutes;
