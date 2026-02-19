import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const afterActionReportRoutes: FastifyPluginAsync = async (fastify) => {
  // ── List AARs ─────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId?: string; status?: string; limit?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, status, limit } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (status) where.status = status;

    return fastify.prisma.afterActionReport.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, email: true } },
        incident: { select: { id: true, type: true, status: true, triggeredAt: true, resolvedAt: true } },
        _count: { select: { correctiveActions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit || '25'), 100),
    });
  });

  // ── Get single AAR with full detail ───────────────────────────────────
  fastify.get<{
    Params: { reportId: string };
  }>('/:reportId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.afterActionReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
      include: {
        author: { select: { id: true, name: true, email: true } },
        incident: {
          include: {
            timeline: { orderBy: { createdAt: 'asc' } },
            respondingAgencies: true,
            doorCommands: true,
          },
        },
        correctiveActions: { orderBy: { priority: 'desc' } },
      },
    });
    if (!report) return reply.code(404).send({ error: 'After-action report not found' });
    return report;
  });

  // ── Auto-generate AAR from incident data ──────────────────────────────
  fastify.post<{
    Body: {
      siteId: string;
      incidentId: string;
      title?: string;
    };
  }>('/generate', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, incidentId, title } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Check if AAR already exists for this incident
    const existing = await fastify.prisma.afterActionReport.findUnique({ where: { incidentId } });
    if (existing) {
      return reply.code(409).send({ error: 'AAR already exists for this incident', reportId: existing.id });
    }

    // Fetch incident with all related data
    const incident = await fastify.prisma.incident.findFirst({
      where: { id: incidentId, siteId },
      include: {
        timeline: { orderBy: { createdAt: 'asc' } },
        respondingAgencies: true,
        doorCommands: true,
        messages: true,
      },
    });
    if (!incident) return reply.code(404).send({ error: 'Incident not found' });

    // Auto-populate fields from incident data
    const durationMs = incident.resolvedAt
      ? incident.resolvedAt.getTime() - incident.triggeredAt.getTime()
      : null;
    const durationMin = durationMs ? Math.round(durationMs / 60000) : null;

    const doorActions = incident.doorCommands.map((dc: any) => ({
      doorId: dc.doorId,
      action: dc.action,
      timestamp: dc.createdAt,
    }));

    const agencySummary = incident.respondingAgencies.map((a: any) => ({
      agencyId: a.agencyId,
      status: a.status,
      respondedAt: a.respondedAt,
      arrivedAt: a.arrivedAt,
    }));

    const timelineSummary = incident.timeline.map((t: any) =>
      `[${t.createdAt.toISOString()}] ${t.action}: ${t.details || ''}`
    ).join('\n');

    const report = await fastify.prisma.afterActionReport.create({
      data: {
        siteId,
        incidentId,
        authorId: request.jwtUser.id,
        title: title || `After-Action Report: ${incident.type} - ${incident.triggeredAt.toLocaleDateString()}`,
        executiveSummary: `${incident.type} incident triggered at ${incident.triggeredAt.toISOString()}. ${incident.respondingAgencies.length} agencies responded. ${durationMin ? `Duration: ${durationMin} minutes.` : 'Incident ongoing.'} ${incident.messages.length} secure messages exchanged.`,
        timelineSummary,
        doorPerformance: { totalCommands: doorActions.length, actions: doorActions },
        commPerformance: {
          totalMessages: incident.messages.length,
          agencies: agencySummary,
        },
        whatWorked: [],
        whatFailed: [],
        lessonsLearned: [],
        recommendations: [],
      },
      include: {
        author: { select: { id: true, name: true } },
        incident: { select: { id: true, type: true, triggeredAt: true } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'AAR_GENERATED',
        entity: 'AfterActionReport',
        entityId: report.id,
        details: { incidentId },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(report);
  });

  // ── Update AAR ────────────────────────────────────────────────────────
  fastify.patch<{
    Params: { reportId: string };
    Body: {
      title?: string;
      executiveSummary?: string;
      whatWorked?: unknown[];
      whatFailed?: unknown[];
      lessonsLearned?: unknown[];
      recommendations?: unknown[];
      participantCount?: number;
      injuryCount?: number;
      evacuationTimeS?: number;
      status?: string;
    };
  }>('/:reportId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const report = await fastify.prisma.afterActionReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!report) return reply.code(404).send({ error: 'Report not found' });

    const { executiveSummary, title, status, ...data } = request.body;
    const updateData: any = { ...data };
    if (title) updateData.title = sanitizeText(title);
    if (executiveSummary) updateData.executiveSummary = sanitizeText(executiveSummary);
    if (status) {
      updateData.status = status as any;
      if (status === 'APPROVED') {
        updateData.approvedById = request.jwtUser.id;
        updateData.approvedAt = new Date();
      }
      if (status === 'IN_REVIEW') {
        updateData.reviewedById = request.jwtUser.id;
        updateData.reviewedAt = new Date();
      }
      if (status === 'PUBLISHED') {
        updateData.publishedAt = new Date();
      }
    }

    return fastify.prisma.afterActionReport.update({
      where: { id: report.id },
      data: updateData,
      include: {
        author: { select: { id: true, name: true } },
        correctiveActions: true,
      },
    });
  });

  // ── Corrective Actions CRUD ───────────────────────────────────────────

  fastify.get<{
    Params: { reportId: string };
  }>('/:reportId/corrective-actions', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.afterActionReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!report) return reply.code(404).send({ error: 'Report not found' });

    return fastify.prisma.correctiveAction.findMany({
      where: { afterActionReportId: report.id },
      orderBy: [{ status: 'asc' }, { priority: 'desc' }],
    });
  });

  fastify.post<{
    Params: { reportId: string };
    Body: {
      title: string;
      description: string;
      assigneeId?: string;
      priority?: string;
      category?: string;
      dueDate?: string;
    };
  }>('/:reportId/corrective-actions', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const report = await fastify.prisma.afterActionReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!report) return reply.code(404).send({ error: 'Report not found' });

    const { title, description, assigneeId, priority, category, dueDate } = request.body;

    const action = await fastify.prisma.correctiveAction.create({
      data: {
        siteId: report.siteId,
        afterActionReportId: report.id,
        title: sanitizeText(title),
        description: sanitizeText(description),
        assigneeId: assigneeId || null,
        priority: (priority || 'MEDIUM') as any,
        category: category || null,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: report.siteId,
        userId: request.jwtUser.id,
        action: 'CORRECTIVE_ACTION_CREATED',
        entity: 'CorrectiveAction',
        entityId: action.id,
        details: { afterActionReportId: report.id, title },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(action);
  });

  fastify.patch<{
    Params: { reportId: string; actionId: string };
    Body: {
      status?: string;
      completionNotes?: string;
      priority?: string;
      dueDate?: string;
    };
  }>('/:reportId/corrective-actions/:actionId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const action = await fastify.prisma.correctiveAction.findFirst({
      where: { id: request.params.actionId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!action) return reply.code(404).send({ error: 'Corrective action not found' });

    const { status, completionNotes, priority, dueDate } = request.body;
    const updateData: any = {};
    if (status) {
      updateData.status = status as any;
      if (status === 'COMPLETED') updateData.completedAt = new Date();
      if (status === 'VERIFIED') {
        updateData.verifiedById = request.jwtUser.id;
        updateData.verifiedAt = new Date();
      }
    }
    if (completionNotes) updateData.completionNotes = sanitizeText(completionNotes);
    if (priority) updateData.priority = priority as any;
    if (dueDate) updateData.dueDate = new Date(dueDate);

    return fastify.prisma.correctiveAction.update({
      where: { id: action.id },
      data: updateData,
    });
  });

  // ── Corrective actions dashboard (site-wide open items) ───────────────
  fastify.get<{
    Querystring: { siteId: string; status?: string };
  }>('/corrective-actions/open', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, status } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const where: any = { siteId };
    if (status) {
      where.status = status;
    } else {
      where.status = { in: ['OPEN', 'IN_PROGRESS'] };
    }

    return fastify.prisma.correctiveAction.findMany({
      where,
      include: {
        afterActionReport: {
          select: { id: true, title: true, incidentId: true },
        },
      },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
    });
  });
};

export default afterActionReportRoutes;
