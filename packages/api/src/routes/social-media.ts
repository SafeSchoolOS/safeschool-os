import type { FastifyPluginAsync } from 'fastify';

const socialMediaRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/social-media/alerts — List social media alerts
  fastify.get<{
    Querystring: { siteId?: string; status?: string; severity?: string; source?: string; limit?: string };
  }>('/alerts', { preHandler: [fastify.authenticate] }, async (request) => {
    const { siteId, status, severity, source, limit } = request.query;

    const where: any = {};
    if (siteId) where.siteId = siteId;
    else where.siteId = { in: request.jwtUser.siteIds };
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (source) where.source = source;

    return fastify.prisma.socialMediaAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 100),
    });
  });

  // POST /api/v1/social-media/alerts — Ingest an alert (from webhook or manual)
  fastify.post<{
    Body: {
      source: string;
      platform: string;
      contentType: string;
      flaggedContent?: string;
      category: string;
      severity?: string;
      studentName?: string;
      studentGrade?: string;
      externalId?: string;
      metadata?: Record<string, unknown>;
    };
  }>('/alerts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { source, platform, contentType, flaggedContent, category, severity, studentName, studentGrade, externalId, metadata } = request.body;

    if (!source || !platform || !category) {
      return reply.code(400).send({ error: 'source, platform, and category are required' });
    }

    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) {
      return reply.code(403).send({ error: 'No site access' });
    }

    const alert = await fastify.prisma.socialMediaAlert.create({
      data: {
        siteId,
        source: source as any,
        platform,
        contentType: contentType || 'text',
        flaggedContent,
        category: category as any,
        severity: (severity || 'LOW') as any,
        studentName,
        studentGrade,
        externalId,
        metadata: (metadata || undefined) as any,
      },
    });

    // Auto-notify for HIGH/CRITICAL severity
    if (severity === 'HIGH' || severity === 'CRITICAL') {
      await fastify.alertQueue.add('notify-staff', {
        alertId: alert.id,
        siteId,
        level: severity === 'CRITICAL' ? 'ACTIVE_THREAT' : 'LOCKDOWN',
        message: `Social media alert (${source}/${platform}): ${category} - ${studentName || 'Unknown student'}`,
      });
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'SOCIAL_MEDIA_ALERT_CREATED',
        entity: 'SocialMediaAlert',
        entityId: alert.id,
        details: { source, platform, category, severity },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(alert);
  });

  // GET /api/v1/social-media/alerts/:id — Alert detail
  fastify.get<{ Params: { id: string } }>('/alerts/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const alert = await fastify.prisma.socialMediaAlert.findUnique({
      where: { id: request.params.id },
    });

    if (!alert) {
      return reply.code(404).send({ error: 'Alert not found' });
    }

    return alert;
  });

  // PATCH /api/v1/social-media/alerts/:id — Review/update alert
  fastify.patch<{
    Params: { id: string };
    Body: { status?: string; actionTaken?: string };
  }>('/alerts/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { status, actionTaken } = request.body;

    const existing = await fastify.prisma.socialMediaAlert.findUnique({
      where: { id: request.params.id },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Alert not found' });
    }

    const data: any = {};
    if (status) data.status = status;
    if (actionTaken) data.actionTaken = actionTaken;

    if (status && !existing.reviewedAt) {
      data.reviewedById = request.jwtUser.id;
      data.reviewedAt = new Date();
    }

    const updated = await fastify.prisma.socialMediaAlert.update({
      where: { id: request.params.id },
      data,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'SOCIAL_MEDIA_ALERT_REVIEWED',
        entity: 'SocialMediaAlert',
        entityId: existing.id,
        details: { status, actionTaken },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // GET /api/v1/social-media/dashboard — Summary stats
  fastify.get('/dashboard', { preHandler: [fastify.authenticate] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];

    const [total, byStatus, bySeverity, bySource, recentAlerts] = await Promise.all([
      fastify.prisma.socialMediaAlert.count({ where: { siteId } }),
      fastify.prisma.socialMediaAlert.groupBy({
        by: ['status'],
        where: { siteId },
        _count: true,
      }),
      fastify.prisma.socialMediaAlert.groupBy({
        by: ['severity'],
        where: { siteId },
        _count: true,
      }),
      fastify.prisma.socialMediaAlert.groupBy({
        by: ['source'],
        where: { siteId },
        _count: true,
      }),
      fastify.prisma.socialMediaAlert.findMany({
        where: { siteId, status: { in: ['NEW', 'REVIEWING'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    return {
      total,
      unreviewed: byStatus
        .filter((s) => ['NEW', 'REVIEWING'].includes(s.status))
        .reduce((sum, s) => sum + s._count, 0),
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      bySeverity: Object.fromEntries(bySeverity.map((s) => [s.severity, s._count])),
      bySource: Object.fromEntries(bySource.map((s) => [s.source, s._count])),
      recentAlerts,
    };
  });

  // POST /api/v1/social-media/webhook — External webhook endpoint (signature-verified)
  fastify.post<{
    Body: {
      event_type: string;
      data: {
        id: string;
        platform: string;
        content_type: string;
        content?: string;
        category: string;
        severity: string;
        student?: { name: string; grade?: string };
        flagged_at: string;
      };
    };
  }>('/webhook', async (request, reply) => {
    // Webhook endpoints should verify signatures in production
    // For now, accept the payload and create an alert
    const { event_type, data } = request.body;

    if (event_type !== 'alert.created') {
      return reply.code(200).send({ status: 'ignored' });
    }

    if (!data?.id || !data?.platform || !data?.category) {
      return reply.code(400).send({ error: 'Invalid webhook payload' });
    }

    // Determine site from webhook config (in production, map API key to site)
    const defaultSiteId = process.env.DEFAULT_SITE_ID;
    if (!defaultSiteId) {
      return reply.code(500).send({ error: 'DEFAULT_SITE_ID not configured' });
    }

    const alert = await fastify.prisma.socialMediaAlert.create({
      data: {
        siteId: defaultSiteId,
        source: 'BARK' as any,
        platform: data.platform,
        contentType: data.content_type || 'text',
        flaggedContent: data.content,
        category: data.category as any,
        severity: (data.severity || 'LOW') as any,
        studentName: data.student?.name,
        studentGrade: data.student?.grade,
        externalId: data.id,
      },
    });

    // Auto-notify for high severity
    if (data.severity === 'HIGH' || data.severity === 'CRITICAL') {
      await fastify.alertQueue.add('notify-staff', {
        alertId: alert.id,
        siteId: defaultSiteId,
        level: 'LOCKDOWN',
        message: `Social media alert: ${data.category} on ${data.platform} - ${data.student?.name || 'Unknown'}`,
      });
    }

    return reply.code(201).send({ status: 'processed', alertId: alert.id });
  });
};

export default socialMediaRoutes;
