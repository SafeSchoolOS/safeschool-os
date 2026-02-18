import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

interface TimelineEntry {
  timestamp: string;
  action: string;
  userId?: string;
  isPublic: boolean;
}

const frTipsAdminRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Helper: build the site-scope WHERE clause.
   * Tips with siteId in user's sites OR siteId IS NULL (visible to all admins).
   */
  function siteScope(siteIds: string[], extraSiteId?: string) {
    if (extraSiteId) {
      if (!siteIds.includes(extraSiteId)) {
        return null; // user has no access to requested site
      }
      return { siteId: extraSiteId };
    }
    return {
      OR: [
        { siteId: { in: siteIds } },
        { siteId: null },
      ],
    };
  }

  // -----------------------------------------------------------------------
  // GET / — List tips for user's sites
  // -----------------------------------------------------------------------
  fastify.get<{
    Querystring: {
      siteId?: string;
      status?: string;
      category?: string;
      severity?: string;
      assignedTo?: string;
      limit?: string;
      offset?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, status, category, severity, assignedTo, limit, offset } = request.query;
    const userSiteIds = request.jwtUser.siteIds;

    const scope = siteScope(userSiteIds, siteId);
    if (scope === null) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const where: any = {
      ...scope,
      ...(status && { status: status as any }),
      ...(category && { category: category as any }),
      ...(severity && { severity: severity as any }),
      ...(assignedTo && { assignedTo }),
    };

    const take = Math.min(parseInt(limit || '50', 10) || 50, 200);
    const skip = parseInt(offset || '0', 10) || 0;

    const [tips, total] = await Promise.all([
      fastify.prisma.fRTip.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          _count: { select: { followUps: true } },
        },
      }),
      fastify.prisma.fRTip.count({ where }),
    ]);

    return { tips, total };
  });

  // -----------------------------------------------------------------------
  // GET /analytics — Tip analytics
  // -----------------------------------------------------------------------
  fastify.get<{
    Querystring: { siteId?: string; startDate?: string; endDate?: string };
  }>('/analytics', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, startDate, endDate } = request.query;
    const userSiteIds = request.jwtUser.siteIds;

    const scope = siteScope(userSiteIds, siteId);
    if (scope === null) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const where: any = {
      ...scope,
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
    };

    const [bySource, byCategory, bySeverity, byStatus, total, resolvedTips] = await Promise.all([
      fastify.prisma.fRTip.groupBy({
        by: ['source'],
        where,
        _count: true,
      }),
      fastify.prisma.fRTip.groupBy({
        by: ['category'],
        where,
        _count: true,
      }),
      fastify.prisma.fRTip.groupBy({
        by: ['severity'],
        where,
        _count: true,
      }),
      fastify.prisma.fRTip.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      fastify.prisma.fRTip.count({ where }),
      // For avg response time: resolved tips with both createdAt and updatedAt
      fastify.prisma.fRTip.findMany({
        where: { ...where, status: 'RESOLVED_TIP' as any },
        select: { createdAt: true, updatedAt: true },
      }),
    ]);

    // Calculate average response time in minutes (createdAt -> updatedAt for resolved tips)
    let avgResponseTimeMinutes: number | null = null;
    if (resolvedTips.length > 0) {
      const totalMinutes = resolvedTips.reduce((sum, tip) => {
        const diffMs = new Date(tip.updatedAt).getTime() - new Date(tip.createdAt).getTime();
        return sum + diffMs / 60000;
      }, 0);
      avgResponseTimeMinutes = Math.round((totalMinutes / resolvedTips.length) * 100) / 100;
    }

    return {
      bySource: Object.fromEntries(bySource.map((s) => [s.source, s._count])),
      byCategory: Object.fromEntries(byCategory.map((c) => [c.category, c._count])),
      bySeverity: Object.fromEntries(bySeverity.map((s) => [s.severity, s._count])),
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      total,
      avgResponseTimeMinutes,
    };
  });

  // -----------------------------------------------------------------------
  // GET /:tipId — Tip detail with followUps and timeline
  // -----------------------------------------------------------------------
  fastify.get<{
    Params: { tipId: string };
  }>('/:tipId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { tipId } = request.params;
    const userSiteIds = request.jwtUser.siteIds;

    const tip = await fastify.prisma.fRTip.findUnique({
      where: { id: tipId },
      include: {
        followUps: { orderBy: { createdAt: 'asc' } },
        escalatedToAgency: true,
      },
    });

    if (!tip) {
      return reply.code(404).send({ error: 'Tip not found' });
    }

    // Verify site access: tip's siteId must be in user's sites, or siteId is null
    if (tip.siteId && !userSiteIds.includes(tip.siteId)) {
      return reply.code(403).send({ error: 'No access to this tip' });
    }

    return tip;
  });

  // -----------------------------------------------------------------------
  // PUT /:tipId — Update tip fields
  // -----------------------------------------------------------------------
  fastify.put<{
    Params: { tipId: string };
    Body: {
      status?: string;
      assignedTo?: string;
      severity?: string;
      category?: string;
      resolution?: string;
      publicStatusMessage?: string;
      notes?: string;
    };
  }>('/:tipId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { tipId } = request.params;
    const body = request.body;
    const user = request.jwtUser;

    const tip = await fastify.prisma.fRTip.findUnique({ where: { id: tipId } });
    if (!tip) {
      return reply.code(404).send({ error: 'Tip not found' });
    }

    if (tip.siteId && !user.siteIds.includes(tip.siteId)) {
      return reply.code(403).send({ error: 'No access to this tip' });
    }

    // Build update data, sanitizing text fields
    const data: any = {};
    const timelineEntries: TimelineEntry[] = [];
    const existingTimeline = (Array.isArray(tip.timeline) ? tip.timeline : []) as unknown as TimelineEntry[];
    const now = new Date().toISOString();

    if (body.status) {
      data.status = body.status;
      timelineEntries.push({
        timestamp: now,
        action: `Status updated to ${body.status}`,
        userId: user.id,
        isPublic: false,
      });
      if (body.status === 'RESOLVED_TIP') {
        data.resolvedAt = new Date();
        data.resolvedBy = user.id;
      }
    }

    if (body.assignedTo !== undefined) {
      data.assignedTo = body.assignedTo;
      timelineEntries.push({
        timestamp: now,
        action: `Assigned to ${body.assignedTo}`,
        userId: user.id,
        isPublic: false,
      });
    }

    if (body.severity) {
      data.severity = body.severity;
      timelineEntries.push({
        timestamp: now,
        action: `Severity changed to ${body.severity}`,
        userId: user.id,
        isPublic: false,
      });
    }

    if (body.category) {
      data.category = body.category;
      timelineEntries.push({
        timestamp: now,
        action: `Category changed to ${body.category}`,
        userId: user.id,
        isPublic: false,
      });
    }

    if (body.resolution !== undefined) {
      data.resolution = sanitizeText(body.resolution);
      timelineEntries.push({
        timestamp: now,
        action: 'Resolution updated',
        userId: user.id,
        isPublic: false,
      });
    }

    if (body.publicStatusMessage !== undefined) {
      data.publicStatusMessage = sanitizeText(body.publicStatusMessage);
      timelineEntries.push({
        timestamp: now,
        action: sanitizeText(body.publicStatusMessage),
        userId: user.id,
        isPublic: true,
      });
    }

    if (body.notes) {
      timelineEntries.push({
        timestamp: now,
        action: `Note: ${sanitizeText(body.notes)}`,
        userId: user.id,
        isPublic: false,
      });
    }

    // Append new entries to the existing timeline
    if (timelineEntries.length > 0) {
      data.timeline = [...existingTimeline, ...timelineEntries] as any;
    }

    const updated = await fastify.prisma.fRTip.update({
      where: { id: tipId },
      data,
    });

    if (tip.siteId) {
      await fastify.prisma.auditLog.create({
        data: {
          siteId: tip.siteId,
          userId: user.id,
          action: 'FR_TIP_UPDATED',
          entity: 'FRTip',
          entityId: tipId,
          details: {
            status: body.status,
            assignedTo: body.assignedTo,
            severity: body.severity,
            category: body.category,
          },
          ipAddress: request.ip,
        },
      });
    }

    return updated;
  });

  // -----------------------------------------------------------------------
  // POST /:tipId/escalate — Escalate to law enforcement
  // -----------------------------------------------------------------------
  fastify.post<{
    Params: { tipId: string };
    Body: { agencyId: string; notes?: string };
  }>('/:tipId/escalate', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { tipId } = request.params;
    const { agencyId, notes } = request.body;
    const user = request.jwtUser;

    if (!agencyId) {
      return reply.code(400).send({ error: 'agencyId is required' });
    }

    const tip = await fastify.prisma.fRTip.findUnique({ where: { id: tipId } });
    if (!tip) {
      return reply.code(404).send({ error: 'Tip not found' });
    }

    if (tip.siteId && !user.siteIds.includes(tip.siteId)) {
      return reply.code(403).send({ error: 'No access to this tip' });
    }

    // Verify agency exists
    const agency = await fastify.prisma.agency.findUnique({ where: { id: agencyId } });
    if (!agency) {
      return reply.code(404).send({ error: 'Agency not found' });
    }

    const now = new Date();
    const existingTimeline = (Array.isArray(tip.timeline) ? tip.timeline : []) as unknown as TimelineEntry[];

    const timelineEntry: TimelineEntry = {
      timestamp: now.toISOString(),
      action: `Escalated to ${agency.name}${notes ? `: ${sanitizeText(notes)}` : ''}`,
      userId: user.id,
      isPublic: false,
    };

    const updated = await fastify.prisma.fRTip.update({
      where: { id: tipId },
      data: {
        status: 'ESCALATED_TIP' as any,
        escalatedToAgencyId: agencyId,
        escalatedAt: now,
        timeline: [...existingTimeline, timelineEntry] as any,
      },
    });

    if (tip.siteId) {
      await fastify.prisma.auditLog.create({
        data: {
          siteId: tip.siteId,
          userId: user.id,
          action: 'FR_TIP_ESCALATED',
          entity: 'FRTip',
          entityId: tipId,
          details: { agencyId, agencyName: agency.name, notes },
          ipAddress: request.ip,
        },
      });
    }

    // Broadcast escalation via WebSocket
    if (tip.siteId) {
      fastify.wsManager.broadcastToSite(tip.siteId, 'tip:escalated', {
        tipId,
        agencyId,
        agencyName: agency.name,
        escalatedAt: now.toISOString(),
        escalatedBy: user.id,
      });
    }

    return updated;
  });

  // -----------------------------------------------------------------------
  // POST /:tipId/public-update — Post message visible to tipster
  // -----------------------------------------------------------------------
  fastify.post<{
    Params: { tipId: string };
    Body: { message: string };
  }>('/:tipId/public-update', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { tipId } = request.params;
    const { message } = request.body;
    const user = request.jwtUser;

    if (!message || !message.trim()) {
      return reply.code(400).send({ error: 'message is required' });
    }

    const tip = await fastify.prisma.fRTip.findUnique({ where: { id: tipId } });
    if (!tip) {
      return reply.code(404).send({ error: 'Tip not found' });
    }

    if (tip.siteId && !user.siteIds.includes(tip.siteId)) {
      return reply.code(403).send({ error: 'No access to this tip' });
    }

    const sanitizedMessage = sanitizeText(message);
    const existingTimeline = (Array.isArray(tip.timeline) ? tip.timeline : []) as unknown as TimelineEntry[];

    const timelineEntry: TimelineEntry = {
      timestamp: new Date().toISOString(),
      action: sanitizedMessage,
      userId: user.id,
      isPublic: true,
    };

    const updated = await fastify.prisma.fRTip.update({
      where: { id: tipId },
      data: {
        publicStatusMessage: sanitizedMessage,
        timeline: [...existingTimeline, timelineEntry] as any,
      },
    });

    return updated;
  });
};

export default frTipsAdminRoutes;
