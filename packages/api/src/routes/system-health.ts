import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const systemHealthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /system-health — Overall system health
  fastify.get('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return { status: 'unknown' };

    // Edge device status
    const edgeDevice = await fastify.prisma.edgeDevice.findUnique({ where: { siteId } });
    const edgeStale = edgeDevice
      ? (Date.now() - new Date(edgeDevice.lastHeartbeatAt).getTime()) > 5 * 60 * 1000
      : null;

    // Gateway status
    const gateways = await fastify.prisma.gateway.findMany({
      where: { siteId },
      select: { id: true, name: true, status: true, lastHeartbeatAt: true },
    });

    // Recent failed jobs count (check Redis)
    let failedJobCount = 0;
    try {
      failedJobCount = await fastify.redis.llen('bull:alert-processing:failed');
    } catch { /* ignore */ }

    // Pending action confirmations
    const pendingConfirmations = await fastify.prisma.actionConfirmation.count({
      where: { siteId, status: 'PENDING_CONFIRMATION' },
    });

    const failedConfirmations = await fastify.prisma.actionConfirmation.count({
      where: { siteId, status: { in: ['FAILED_CONFIRMATION', 'TIMED_OUT_CONFIRMATION'] } },
    });

    return {
      status: failedConfirmations > 0 || edgeStale ? 'degraded' : 'healthy',
      edge: edgeDevice
        ? { version: edgeDevice.currentVersion, mode: edgeDevice.operatingMode, stale: edgeStale, lastHeartbeat: edgeDevice.lastHeartbeatAt }
        : null,
      gateways: gateways.map((g) => ({
        ...g,
        stale: g.lastHeartbeatAt
          ? (Date.now() - new Date(g.lastHeartbeatAt).getTime()) > 2 * 60 * 1000
          : true,
      })),
      queue: { failedJobs: failedJobCount },
      confirmations: { pending: pendingConfirmations, failed: failedConfirmations },
    };
  });

  // GET /system-health/confirmations — Action confirmations list
  fastify.get<{
    Querystring: { status?: string; limit?: string };
  }>('/confirmations', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];

    const where: any = { siteId };
    if (request.query.status) where.status = request.query.status;

    return fastify.prisma.actionConfirmation.findMany({
      where,
      orderBy: { initiatedAt: 'desc' },
      take: Math.min(parseInt(request.query.limit || '50'), 200),
    });
  });

  // GET /system-health/confirmations/:id
  fastify.get<{ Params: { id: string } }>(
    '/confirmations/:id',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const confirmation = await fastify.prisma.actionConfirmation.findUnique({
        where: { id: request.params.id },
      });
      if (!confirmation) return reply.code(404).send({ error: 'Confirmation not found' });
      if (!request.jwtUser.siteIds.includes(confirmation.siteId)) {
        return reply.code(404).send({ error: 'Confirmation not found' });
      }
      return confirmation;
    },
  );

  // GET /system-health/heartbeats — Edge device + gateway heartbeat history
  fastify.get('/heartbeats', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return { edge: null, gateways: [] };

    const edgeDevice = await fastify.prisma.edgeDevice.findUnique({ where: { siteId } });

    const gateways = await fastify.prisma.gateway.findMany({
      where: { siteId },
      include: {
        heartbeats: {
          orderBy: { timestamp: 'desc' },
          take: 20,
        },
      },
    });

    return { edge: edgeDevice, gateways };
  });
};

export default systemHealthRoutes;
