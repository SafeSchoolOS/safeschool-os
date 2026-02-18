import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const doorHealthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /door-health — List door health events
  fastify.get<{
    Querystring: { doorId?: string; severity?: string; limit?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];

    const where: any = { siteId };
    if (request.query.doorId) where.doorId = request.query.doorId;
    if (request.query.severity) where.severity = request.query.severity;

    return fastify.prisma.doorHealthEvent.findMany({
      where,
      include: { door: { select: { id: true, name: true, buildingId: true } }, workOrder: true },
      orderBy: { detectedAt: 'desc' },
      take: Math.min(parseInt(request.query.limit || '50'), 200),
    });
  });

  // GET /door-health/summary — Health summary per door
  fastify.get('/summary', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return {};

    const doors = await fastify.prisma.door.findMany({
      where: { siteId },
      select: { id: true, name: true, status: true, buildingId: true },
    });

    const recentEvents = await fastify.prisma.doorHealthEvent.findMany({
      where: { siteId, resolvedAt: null },
      orderBy: { detectedAt: 'desc' },
    });

    const openWorkOrders = await fastify.prisma.workOrder.count({
      where: { siteId, status: { in: ['OPEN', 'IN_PROGRESS_WO'] } },
    });

    const eventsByDoor: Record<string, any[]> = {};
    for (const e of recentEvents) {
      if (!eventsByDoor[e.doorId]) eventsByDoor[e.doorId] = [];
      eventsByDoor[e.doorId].push(e);
    }

    return {
      totalDoors: doors.length,
      doorsWithIssues: Object.keys(eventsByDoor).length,
      openWorkOrders,
      doors: doors.map((d) => ({
        ...d,
        activeEvents: eventsByDoor[d.id] || [],
        health: eventsByDoor[d.id]?.some((e: any) => e.severity === 'CRITICAL')
          ? 'CRITICAL'
          : eventsByDoor[d.id]?.length
            ? 'WARNING'
            : 'HEALTHY',
      })),
    };
  });

  // GET /work-orders — List work orders
  fastify.get<{
    Querystring: { status?: string; priority?: string; limit?: string };
  }>('/work-orders', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];

    const where: any = { siteId };
    if (request.query.status) where.status = request.query.status;
    if (request.query.priority) where.priority = request.query.priority;

    return fastify.prisma.workOrder.findMany({
      where,
      include: { door: { select: { id: true, name: true } }, healthEvent: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(request.query.limit || '50'), 200),
    });
  });

  // GET /work-orders/:id
  fastify.get<{ Params: { id: string } }>(
    '/work-orders/:id',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const wo = await fastify.prisma.workOrder.findUnique({
        where: { id: request.params.id },
        include: { door: true, healthEvent: true },
      });
      if (!wo) return reply.code(404).send({ error: 'Work order not found' });
      if (!request.jwtUser.siteIds.includes(wo.siteId)) {
        return reply.code(404).send({ error: 'Work order not found' });
      }
      return wo;
    },
  );

  // POST /work-orders — Create work order
  fastify.post<{
    Body: {
      title: string;
      description?: string;
      priority: string;
      doorId?: string;
      assignedTo?: string;
      dueDate?: string;
    };
  }>('/work-orders', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const title = sanitizeText(request.body.title);
    if (!title || !request.body.priority) {
      return reply.code(400).send({ error: 'title and priority are required' });
    }

    const wo = await fastify.prisma.workOrder.create({
      data: {
        siteId,
        title,
        description: request.body.description ? sanitizeText(request.body.description) : null,
        priority: request.body.priority as any,
        doorId: request.body.doorId || null,
        assignedTo: request.body.assignedTo || null,
        createdById: request.jwtUser.id,
        dueDate: request.body.dueDate ? new Date(request.body.dueDate) : null,
      },
    });

    return reply.code(201).send(wo);
  });

  // PUT /work-orders/:id — Update work order
  fastify.put<{
    Params: { id: string };
    Body: { status?: string; assignedTo?: string; notes?: any; priority?: string; dueDate?: string };
  }>('/work-orders/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const wo = await fastify.prisma.workOrder.findUnique({ where: { id: request.params.id } });
    if (!wo) return reply.code(404).send({ error: 'Work order not found' });
    if (!request.jwtUser.siteIds.includes(wo.siteId)) {
      return reply.code(404).send({ error: 'Work order not found' });
    }

    const data: any = {};
    if (request.body.status) data.status = request.body.status;
    if (request.body.assignedTo !== undefined) data.assignedTo = request.body.assignedTo;
    if (request.body.notes !== undefined) data.notes = request.body.notes ? sanitizeText(request.body.notes) : null;
    if (request.body.priority) data.priority = request.body.priority;
    if (request.body.dueDate) data.dueDate = new Date(request.body.dueDate);

    return fastify.prisma.workOrder.update({ where: { id: request.params.id }, data });
  });

  // POST /work-orders/:id/complete — Complete work order
  fastify.post<{ Params: { id: string } }>(
    '/work-orders/:id/complete',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const wo = await fastify.prisma.workOrder.findUnique({ where: { id: request.params.id } });
      if (!wo) return reply.code(404).send({ error: 'Work order not found' });
      if (!request.jwtUser.siteIds.includes(wo.siteId)) {
        return reply.code(404).send({ error: 'Work order not found' });
      }

      const updated = await fastify.prisma.workOrder.update({
        where: { id: request.params.id },
        data: { status: 'COMPLETED_WO', completedAt: new Date() },
      });

      // Resolve linked health event
      if (wo.healthEventId) {
        await fastify.prisma.doorHealthEvent.update({
          where: { id: wo.healthEventId },
          data: { resolvedAt: new Date() },
        });
      }

      return updated;
    },
  );
};

export default doorHealthRoutes;
