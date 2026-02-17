import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const eventRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /events — List events
  fastify.get<{
    Querystring: { status?: string; from?: string; to?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];

    const where: any = { siteId };
    if (request.query.status) where.status = request.query.status;
    if (request.query.from || request.query.to) {
      where.startTime = {};
      if (request.query.from) where.startTime.gte = new Date(request.query.from);
      if (request.query.to) where.startTime.lte = new Date(request.query.to);
    }

    return fastify.prisma.event.findMany({
      where,
      include: { doorGrants: true, createdBy: { select: { id: true, name: true } } },
      orderBy: { startTime: 'asc' },
      take: 100,
    });
  });

  // GET /events/:id
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const event = await fastify.prisma.event.findUnique({
        where: { id: request.params.id },
        include: { doorGrants: { include: { door: true } }, createdBy: { select: { id: true, name: true } } },
      });
      if (!event) return reply.code(404).send({ error: 'Event not found' });
      if (!request.jwtUser.siteIds.includes(event.siteId)) {
        return reply.code(404).send({ error: 'Event not found' });
      }
      return event;
    },
  );

  // POST /events — Create event
  fastify.post<{
    Body: {
      name: string;
      description?: string;
      type: string;
      startTime: string;
      endTime: string;
      recurrence?: any;
      schoolHoursOverride?: boolean;
      doorGrants?: { doorId: string; unlockAt: string; lockAt: string }[];
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const { type, startTime, endTime, recurrence, doorGrants } = request.body;
    const name = sanitizeText(request.body.name);
    const description = request.body.description ? sanitizeText(request.body.description) : null;

    if (!name || !type || !startTime || !endTime) {
      return reply.code(400).send({ error: 'name, type, startTime, endTime are required' });
    }

    // Only SUPER_ADMIN can override school hours
    const schoolHoursOverride = request.body.schoolHoursOverride === true && request.jwtUser.role === 'SUPER_ADMIN';

    const event = await fastify.prisma.event.create({
      data: {
        siteId,
        name,
        description,
        type: type as any,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        recurrence: recurrence || undefined,
        schoolHoursOverride,
        createdById: request.jwtUser.id,
        doorGrants: doorGrants?.length
          ? {
              create: doorGrants.map((g) => ({
                doorId: g.doorId,
                unlockAt: new Date(g.unlockAt),
                lockAt: new Date(g.lockAt),
              })),
            }
          : undefined,
      },
      include: { doorGrants: true },
    });

    // Schedule BullMQ jobs for door grants
    if (doorGrants?.length) {
      try {
        const { Queue } = await import('bullmq');
        const ioredis = await import('ioredis');
        const Redis = (ioredis as any).default ?? ioredis;
        const conn = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
        const queue = new Queue('alert-processing', { connection: conn as any });

        for (const grant of event.doorGrants) {
          const unlockDelay = Math.max(0, new Date(grant.unlockAt).getTime() - Date.now());
          const lockDelay = Math.max(0, new Date(grant.lockAt).getTime() - Date.now());

          await queue.add('event-unlock-doors', { grantId: grant.id, eventId: event.id, siteId }, { delay: unlockDelay });
          await queue.add('event-lock-doors', { grantId: grant.id, eventId: event.id, siteId }, { delay: lockDelay });
        }

        await queue.close();
        conn.disconnect();
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to schedule event door jobs');
      }
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'EVENT_CREATED',
        entity: 'Event',
        entityId: event.id,
        details: { name, type, startTime, endTime, doorGrantCount: doorGrants?.length || 0 },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(event);
  });

  // PUT /events/:id — Update event
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      type?: string;
      startTime?: string;
      endTime?: string;
      status?: string;
      schoolHoursOverride?: boolean;
    };
  }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const event = await fastify.prisma.event.findUnique({ where: { id: request.params.id } });
    if (!event) return reply.code(404).send({ error: 'Event not found' });
    if (!request.jwtUser.siteIds.includes(event.siteId)) {
      return reply.code(404).send({ error: 'Event not found' });
    }

    const data: any = {};
    if (request.body.name) data.name = sanitizeText(request.body.name);
    if (request.body.description !== undefined) data.description = request.body.description ? sanitizeText(request.body.description) : null;
    if (request.body.type) data.type = request.body.type;
    if (request.body.startTime) data.startTime = new Date(request.body.startTime);
    if (request.body.endTime) data.endTime = new Date(request.body.endTime);
    if (request.body.status) data.status = request.body.status;
    if (request.body.schoolHoursOverride !== undefined && request.jwtUser.role === 'SUPER_ADMIN') {
      data.schoolHoursOverride = request.body.schoolHoursOverride;
    }

    const updated = await fastify.prisma.event.update({
      where: { id: request.params.id },
      data,
      include: { doorGrants: true },
    });

    return updated;
  });

  // DELETE /events/:id — Cancel event
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const event = await fastify.prisma.event.findUnique({ where: { id: request.params.id } });
      if (!event) return reply.code(404).send({ error: 'Event not found' });
      if (!request.jwtUser.siteIds.includes(event.siteId)) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      await fastify.prisma.event.update({
        where: { id: request.params.id },
        data: { status: 'CANCELLED_EVENT' },
      });

      return { success: true };
    },
  );

  // POST /events/:id/activate — Mark event as active
  fastify.post<{ Params: { id: string } }>(
    '/:id/activate',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const event = await fastify.prisma.event.findUnique({ where: { id: request.params.id } });
      if (!event) return reply.code(404).send({ error: 'Event not found' });
      if (!request.jwtUser.siteIds.includes(event.siteId)) {
        return reply.code(404).send({ error: 'Event not found' });
      }

      const updated = await fastify.prisma.event.update({
        where: { id: request.params.id },
        data: { status: 'ACTIVE_EVENT' },
        include: { doorGrants: true },
      });

      return updated;
    },
  );
};

export default eventRoutes;
