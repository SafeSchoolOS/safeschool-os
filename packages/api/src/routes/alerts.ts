import type { FastifyPluginAsync } from 'fastify';
import { AlertEngine } from '../services/alert-engine.js';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const alertRoutes: FastifyPluginAsync = async (fastify) => {
  const engine = new AlertEngine(fastify);

  // POST /api/v1/alerts — Create a panic alert
  // Route-specific rate limit: 5 alerts per minute per user to prevent 911 dispatch flooding
  fastify.post<{
    Body: {
      level: string;
      source?: string;
      buildingId: string;
      floor?: number;
      roomId?: string;
      message?: string;
    };
  }>('/', {
    preHandler: [fastify.authenticate],
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const { level, source, buildingId, floor, roomId } = request.body;
    const message = sanitizeText(request.body.message);

    if (!level || !buildingId) {
      return reply.code(400).send({ error: 'level and buildingId are required' });
    }

    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) {
      return reply.code(403).send({ error: 'No site access' });
    }

    const alert = await engine.createAlert({
      siteId,
      level,
      source: source || 'DASHBOARD',
      triggeredById: request.jwtUser.id,
      buildingId,
      floor,
      roomId,
      message,
      ipAddress: request.ip,
    });

    return reply.code(201).send(alert);
  });

  // GET /api/v1/alerts — List alerts with filters
  fastify.get<{
    Querystring: { siteId?: string; status?: string; level?: string; limit?: string };
  }>('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { siteId, status, level, limit } = request.query;

    const where: any = {};
    if (siteId) where.siteId = siteId;
    else where.siteId = { in: request.jwtUser.siteIds };
    if (status) where.status = status;
    if (level) where.level = level;

    const alerts = await fastify.prisma.alert.findMany({
      where,
      orderBy: { triggeredAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 100),
    });

    return alerts;
  });

  // GET /api/v1/alerts/:id — Single alert detail
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const alert = await fastify.prisma.alert.findUnique({
      where: { id: request.params.id },
      include: { dispatchRecords: true, lockdowns: true },
    });

    if (!alert) {
      return reply.code(404).send({ error: 'Alert not found' });
    }

    return alert;
  });

  // PATCH /api/v1/alerts/:id — Update alert status (FIRST_RESPONDER+)
  fastify.patch<{
    Params: { id: string };
    Body: { status: string };
  }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] }, async (request, reply) => {
    const { status } = request.body;
    const alertId = request.params.id;
    const userId = request.jwtUser.id;

    switch (status) {
      case 'ACKNOWLEDGED':
        return engine.acknowledgeAlert(alertId, userId, request.ip);
      case 'RESOLVED':
        return engine.resolveAlert(alertId, userId, request.ip);
      case 'CANCELLED':
        return engine.cancelAlert(alertId, userId, request.ip);
      default:
        return reply.code(400).send({ error: `Invalid status transition: ${status}` });
    }
  });
};

export default alertRoutes;
