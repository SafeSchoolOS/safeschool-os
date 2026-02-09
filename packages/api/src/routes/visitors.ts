import type { FastifyPluginAsync } from 'fastify';
import { VisitorService, ConsoleScreeningAdapter } from '@safeschool/visitor-mgmt';
import { requireMinRole } from '../middleware/rbac.js';

const visitorRoutes: FastifyPluginAsync = async (fastify) => {
  const screeningAdapter = new ConsoleScreeningAdapter();
  const visitorService = new VisitorService(fastify.prisma, screeningAdapter);

  // POST /api/v1/visitors — Pre-register a visitor
  fastify.post<{
    Body: {
      firstName: string;
      lastName: string;
      purpose: string;
      destination: string;
      hostUserId?: string;
      idType?: string;
      idNumberHash?: string;
      photo?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const { firstName, lastName, purpose, destination, hostUserId, idType, idNumberHash, photo } = request.body;
    if (!firstName || !lastName || !purpose || !destination) {
      return reply.code(400).send({ error: 'firstName, lastName, purpose, and destination are required' });
    }

    const visitor = await visitorService.preRegister({
      siteId,
      firstName,
      lastName,
      purpose,
      destination,
      hostUserId,
      idType,
      idNumberHash,
      photo,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'VISITOR_PRE_REGISTERED',
        entity: 'Visitor',
        entityId: visitor.id,
        details: { firstName, lastName, purpose },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(visitor);
  });

  // POST /api/v1/visitors/:id/check-in
  fastify.post<{ Params: { id: string } }>(
    '/:id/check-in',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      try {
        const visitor = await visitorService.checkIn(request.params.id, request.ip);
        fastify.wsManager.broadcastToSite(visitor.siteId, 'visitor:checked-in', visitor);
        return visitor;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Check-in failed';
        return reply.code(400).send({ error: message });
      }
    },
  );

  // POST /api/v1/visitors/:id/check-out
  fastify.post<{ Params: { id: string } }>(
    '/:id/check-out',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      try {
        const visitor = await visitorService.checkOut(request.params.id, request.ip);
        fastify.wsManager.broadcastToSite(visitor.siteId, 'visitor:checked-out', visitor);
        return visitor;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Check-out failed';
        return reply.code(400).send({ error: message });
      }
    },
  );

  // GET /api/v1/visitors — List visitors with filters
  fastify.get<{
    Querystring: { siteId?: string; status?: string; date?: string; limit?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, status, date, limit } = request.query;

    const where: any = {};
    if (siteId) where.siteId = siteId;
    else where.siteId = { in: request.jwtUser.siteIds };
    if (status) where.status = status;
    if (date) {
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      where.createdAt = { gte: start, lt: end };
    }

    return fastify.prisma.visitor.findMany({
      where,
      include: { screening: true, host: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 100),
    });
  });

  // GET /api/v1/visitors/active — Currently checked-in visitors
  fastify.get('/active', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];
    return visitorService.getActiveVisitors(siteId);
  });

  // GET /api/v1/visitors/:id — Visitor detail + screening
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const visitor = await visitorService.getVisitor(request.params.id);
      if (!visitor) return reply.code(404).send({ error: 'Visitor not found' });
      return visitor;
    },
  );
};

export default visitorRoutes;
