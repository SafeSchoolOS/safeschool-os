import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/notifications/send — Send mass notification
  fastify.post<{
    Body: {
      channels: ('SMS' | 'EMAIL' | 'PUSH' | 'PA')[];
      message: string;
      recipientScope: 'all-staff' | 'all-parents' | 'specific-users';
      recipientIds?: string[];
      alertId?: string;
    };
  }>('/send', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const { channels, message, recipientScope, recipientIds, alertId } = request.body;
    if (!channels?.length || !message) {
      return reply.code(400).send({ error: 'channels and message are required' });
    }

    // Resolve recipients
    let recipientCount: number;
    if (recipientScope === 'all-staff') {
      const count = await fastify.prisma.user.count({
        where: {
          sites: { some: { siteId } },
          role: { in: ['SITE_ADMIN', 'OPERATOR', 'TEACHER', 'FIRST_RESPONDER'] },
          isActive: true,
        },
      });
      recipientCount = count;
    } else if (recipientScope === 'all-parents') {
      const count = await fastify.prisma.parentContact.count({
        where: { studentCard: { siteId } },
      });
      recipientCount = count;
    } else {
      recipientCount = recipientIds?.length || 0;
    }

    // Enqueue mass notification job
    await fastify.alertQueue.add('mass-notify', {
      siteId,
      channels,
      message,
      recipientScope,
      recipientIds,
      alertId,
      initiatedBy: request.jwtUser.id,
    });

    // Create notification log
    const log = await fastify.prisma.notificationLog.create({
      data: {
        siteId,
        alertId,
        channel: channels.join(','),
        recipientCount,
        message,
        status: 'QUEUED',
        sentAt: new Date(),
        metadata: { recipientScope, initiatedBy: request.jwtUser.id },
      },
    });

    fastify.wsManager.broadcastToSite(siteId, 'notification:sent', {
      id: log.id,
      channels,
      recipientCount,
      message: message.substring(0, 100),
    });

    return reply.code(201).send(log);
  });

  // GET /api/v1/notifications/log — Notification history
  fastify.get<{
    Querystring: { siteId?: string; limit?: string };
  }>('/log', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request) => {
    const { siteId, limit } = request.query;

    const where: any = {};
    if (siteId) where.siteId = siteId;
    else where.siteId = { in: request.jwtUser.siteIds };

    return fastify.prisma.notificationLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 100),
    });
  });

  // GET /api/v1/notifications/log/:id — Specific notification detail
  fastify.get<{ Params: { id: string } }>(
    '/log/:id',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request, reply) => {
      const log = await fastify.prisma.notificationLog.findUnique({
        where: { id: request.params.id },
      });
      if (!log) return reply.code(404).send({ error: 'Notification not found' });
      return log;
    },
  );

  // POST /api/v1/notifications/test — Send test notification to self
  fastify.post('/test', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const user = await fastify.prisma.user.findUnique({ where: { id: request.jwtUser.id } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    await fastify.alertQueue.add('mass-notify', {
      siteId,
      channels: ['SMS', 'EMAIL'],
      message: 'SafeSchool test notification — if you received this, notifications are working.',
      recipientScope: 'specific-users',
      recipientIds: [user.phone, user.email].filter(Boolean),
      initiatedBy: request.jwtUser.id,
    });

    const log = await fastify.prisma.notificationLog.create({
      data: {
        siteId,
        channel: 'SMS,EMAIL',
        recipientCount: 1,
        message: 'Test notification',
        status: 'QUEUED',
        sentAt: new Date(),
        metadata: { test: true, initiatedBy: request.jwtUser.id },
      },
    });

    return reply.code(201).send(log);
  });
};

export default notificationRoutes;
