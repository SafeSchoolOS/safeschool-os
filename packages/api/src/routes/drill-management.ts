import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Enhanced Drill Management routes — templates, observations, scoring,
 * after-action reports, recurring schedules, and automated notifications.
 */
export default async function drillManagementRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // ===========================================================================
  // Drill Templates
  // ===========================================================================

  // GET /api/v1/drill-management/templates — list templates
  app.get('/templates', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest) => {
    const user = request.user as { siteIds: string[] };
    const { type } = request.query as { type?: string };

    const where: any = { siteId: { in: user.siteIds }, isActive: true };
    if (type) where.type = type;

    return app.prisma.drillTemplate.findMany({
      where,
      include: { _count: { select: { drills: true } } },
      orderBy: { name: 'asc' },
    });
  });

  // POST /api/v1/drill-management/templates — create template
  app.post('/templates', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const body = request.body as {
      name: string;
      type: string;
      description?: string;
      objectives?: unknown[];
      procedures?: unknown[];
      requiredRoles?: string[];
      estimatedDurationMin?: number;
      scoringRubric?: Record<string, unknown>;
    };

    if (!body.name || !body.type) {
      return reply.status(400).send({ error: 'name and type are required' });
    }

    const template = await app.prisma.drillTemplate.create({
      data: {
        siteId: user.siteIds[0],
        name: sanitizeText(body.name),
        type: body.type as any,
        description: sanitizeText(body.description),
        objectives: (body.objectives || undefined) as any,
        procedures: (body.procedures || undefined) as any,
        requiredRoles: body.requiredRoles || [],
        estimatedDurationMin: body.estimatedDurationMin,
        scoringRubric: (body.scoringRubric || undefined) as any,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: user.siteIds[0],
        userId: user.id,
        action: 'DRILL_TEMPLATE_CREATED',
        entity: 'DrillTemplate',
        entityId: template.id,
        details: { name: body.name, type: body.type },
      },
    });

    return reply.status(201).send(template);
  });

  // GET /api/v1/drill-management/templates/:id — template detail
  app.get('/templates/:id', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { id } = request.params as { id: string };

    const template = await app.prisma.drillTemplate.findFirst({
      where: { id, siteId: { in: user.siteIds } },
      include: { drills: { select: { id: true, scheduledAt: true, status: true, complianceMet: true }, orderBy: { scheduledAt: 'desc' }, take: 10 } },
    });

    if (!template) return reply.status(404).send({ error: 'Template not found' });
    return template;
  });

  // PATCH /api/v1/drill-management/templates/:id — update template
  app.patch('/templates/:id', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      description?: string;
      objectives?: unknown[];
      procedures?: unknown[];
      requiredRoles?: string[];
      estimatedDurationMin?: number;
      scoringRubric?: Record<string, unknown>;
      isActive?: boolean;
    };

    const existing = await app.prisma.drillTemplate.findFirst({
      where: { id, siteId: { in: user.siteIds } },
    });

    if (!existing) return reply.status(404).send({ error: 'Template not found' });

    const data: any = {};
    if (body.name !== undefined) data.name = sanitizeText(body.name);
    if (body.description !== undefined) data.description = sanitizeText(body.description);
    if (body.objectives !== undefined) data.objectives = body.objectives;
    if (body.procedures !== undefined) data.procedures = body.procedures;
    if (body.requiredRoles !== undefined) data.requiredRoles = body.requiredRoles;
    if (body.estimatedDurationMin !== undefined) data.estimatedDurationMin = body.estimatedDurationMin;
    if (body.scoringRubric !== undefined) data.scoringRubric = body.scoringRubric;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    return app.prisma.drillTemplate.update({ where: { id }, data });
  });

  // POST /api/v1/drill-management/templates/:id/schedule — create drill from template
  app.post('/templates/:id/schedule', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { id } = request.params as { id: string };
    const body = request.body as { scheduledAt: string; buildingId?: string; notes?: string };

    if (!body.scheduledAt) {
      return reply.status(400).send({ error: 'scheduledAt is required' });
    }

    const template = await app.prisma.drillTemplate.findFirst({
      where: { id, siteId: { in: user.siteIds } },
    });

    if (!template) return reply.status(404).send({ error: 'Template not found' });

    const drill = await app.prisma.drill.create({
      data: {
        siteId: template.siteId,
        type: template.type,
        scheduledAt: new Date(body.scheduledAt),
        initiatedById: user.id,
        buildingId: body.buildingId,
        notes: sanitizeText(body.notes),
        templateId: template.id,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: template.siteId,
        userId: user.id,
        action: 'DRILL_SCHEDULED_FROM_TEMPLATE',
        entity: 'Drill',
        entityId: drill.id,
        details: { templateId: template.id, templateName: template.name },
      },
    });

    return reply.status(201).send(drill);
  });

  // ===========================================================================
  // Drill Observations
  // ===========================================================================

  // GET /api/v1/drill-management/drills/:drillId/observations — list observations
  app.get('/drills/:drillId/observations', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { drillId } = request.params as { drillId: string };

    const drill = await app.prisma.drill.findFirst({
      where: { id: drillId, siteId: { in: user.siteIds } },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });

    return app.prisma.drillObservation.findMany({
      where: { drillId },
      include: { observer: { select: { id: true, name: true, role: true } } },
      orderBy: { timestamp: 'asc' },
    });
  });

  // POST /api/v1/drill-management/drills/:drillId/observations — add observation
  app.post('/drills/:drillId/observations', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { drillId } = request.params as { drillId: string };
    const body = request.body as {
      category: string;
      finding: string;
      severity?: string;
      location?: string;
      photoUrls?: string[];
    };

    if (!body.category || !body.finding) {
      return reply.status(400).send({ error: 'category and finding are required' });
    }

    const drill = await app.prisma.drill.findFirst({
      where: { id: drillId, siteId: { in: user.siteIds } },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });

    const observation = await app.prisma.drillObservation.create({
      data: {
        siteId: drill.siteId,
        drillId,
        observerId: user.id,
        category: body.category as any,
        finding: sanitizeText(body.finding),
        severity: (body.severity as any) || 'INFO',
        location: sanitizeText(body.location),
        photoUrls: body.photoUrls || [],
      },
      include: { observer: { select: { id: true, name: true, role: true } } },
    });

    return reply.status(201).send(observation);
  });

  // ===========================================================================
  // Drill Scoring
  // ===========================================================================

  // GET /api/v1/drill-management/drills/:drillId/scores — list scores
  app.get('/drills/:drillId/scores', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { drillId } = request.params as { drillId: string };

    const drill = await app.prisma.drill.findFirst({
      where: { id: drillId, siteId: { in: user.siteIds } },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });

    const scores = await app.prisma.drillScore.findMany({
      where: { drillId },
      include: { scoredBy: { select: { id: true, name: true, role: true } } },
      orderBy: { category: 'asc' },
    });

    // Compute aggregate scores by category
    const categoryAggregates: Record<string, { total: number; count: number; avg: number }> = {};
    for (const score of scores) {
      if (!categoryAggregates[score.category]) {
        categoryAggregates[score.category] = { total: 0, count: 0, avg: 0 };
      }
      categoryAggregates[score.category].total += score.score;
      categoryAggregates[score.category].count += 1;
      categoryAggregates[score.category].avg =
        categoryAggregates[score.category].total / categoryAggregates[score.category].count;
    }

    return { scores, aggregates: categoryAggregates };
  });

  // POST /api/v1/drill-management/drills/:drillId/scores — submit score
  app.post('/drills/:drillId/scores', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { drillId } = request.params as { drillId: string };
    const body = request.body as {
      category: string;
      score: number;
      maxScore?: number;
      comments?: string;
    };

    if (!body.category || body.score === undefined) {
      return reply.status(400).send({ error: 'category and score are required' });
    }

    const drill = await app.prisma.drill.findFirst({
      where: { id: drillId, siteId: { in: user.siteIds } },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });

    const score = await app.prisma.drillScore.create({
      data: {
        siteId: drill.siteId,
        drillId,
        scoredById: user.id,
        category: sanitizeText(body.category),
        score: body.score,
        maxScore: body.maxScore || 5,
        comments: sanitizeText(body.comments),
      },
      include: { scoredBy: { select: { id: true, name: true, role: true } } },
    });

    return reply.status(201).send(score);
  });

  // ===========================================================================
  // After-Action Reports
  // ===========================================================================

  // GET /api/v1/drill-management/drills/:drillId/after-action — get after-action report
  app.get('/drills/:drillId/after-action', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { drillId } = request.params as { drillId: string };

    const drill = await app.prisma.drill.findFirst({
      where: { id: drillId, siteId: { in: user.siteIds } },
      include: {
        participants: true,
        observations: { include: { observer: { select: { id: true, name: true } } } },
        scores: { include: { scoredBy: { select: { id: true, name: true } } } },
        template: { select: { name: true, objectives: true, procedures: true, scoringRubric: true } },
      },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });

    // Auto-populate after-action report data from drill records
    const totalParticipants = drill.participants.length;
    const checkedInCount = drill.participants.filter((p) => p.checkedIn).length;
    const participationRate = totalParticipants > 0 ? Math.round((checkedInCount / totalParticipants) * 100) : 0;

    const durationS = drill.startedAt && drill.completedAt
      ? Math.round((drill.completedAt.getTime() - drill.startedAt.getTime()) / 1000)
      : null;

    const criticalFindings = drill.observations.filter((o) => o.severity === 'CRITICAL' || o.severity === 'MAJOR');

    // Aggregate scores
    const scoresByCategory: Record<string, number[]> = {};
    for (const score of drill.scores) {
      if (!scoresByCategory[score.category]) scoresByCategory[score.category] = [];
      scoresByCategory[score.category].push(score.score);
    }

    const avgScores = Object.entries(scoresByCategory).map(([cat, scores]) => ({
      category: cat,
      average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
      count: scores.length,
    }));

    const overallAvg = drill.scores.length > 0
      ? Math.round((drill.scores.reduce((sum, s) => sum + s.score, 0) / drill.scores.length) * 10) / 10
      : null;

    return {
      drill: {
        id: drill.id,
        type: drill.type,
        status: drill.status,
        scheduledAt: drill.scheduledAt,
        startedAt: drill.startedAt,
        completedAt: drill.completedAt,
        complianceMet: drill.complianceMet,
        evacuationTimeS: drill.evacuationTimeS,
        headCount: drill.headCount,
        notes: drill.notes,
        afterActionNotes: drill.afterActionNotes,
        afterActionJson: drill.afterActionJson,
        template: drill.template,
      },
      participation: {
        totalExpected: totalParticipants,
        checkedIn: checkedInCount,
        rate: participationRate,
        participants: drill.participants,
      },
      timing: {
        durationSeconds: durationS,
        evacuationTimeSeconds: drill.evacuationTimeS,
      },
      observations: {
        total: drill.observations.length,
        critical: criticalFindings.length,
        findings: drill.observations,
      },
      scoring: {
        overallAverage: overallAvg,
        byCategory: avgScores,
        details: drill.scores,
      },
    };
  });

  // PATCH /api/v1/drill-management/drills/:drillId/after-action — save after-action notes
  app.patch('/drills/:drillId/after-action', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { drillId } = request.params as { drillId: string };
    const body = request.body as {
      afterActionNotes?: string;
      afterActionJson?: Record<string, unknown>;
    };

    const drill = await app.prisma.drill.findFirst({
      where: { id: drillId, siteId: { in: user.siteIds } },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });

    const data: any = {};
    if (body.afterActionNotes !== undefined) data.afterActionNotes = sanitizeText(body.afterActionNotes);
    if (body.afterActionJson !== undefined) data.afterActionJson = body.afterActionJson;

    const updated = await app.prisma.drill.update({
      where: { id: drillId },
      data,
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: drill.siteId,
        userId: user.id,
        action: 'DRILL_AFTER_ACTION_SAVED',
        entity: 'Drill',
        entityId: drillId,
      },
    });

    return updated;
  });

  // ===========================================================================
  // Recurring Drill Schedules
  // ===========================================================================

  // GET /api/v1/drill-management/recurring — list recurring schedules
  app.get('/recurring', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest) => {
    const user = request.user as { siteIds: string[] };

    return app.prisma.recurringDrillSchedule.findMany({
      where: { siteId: { in: user.siteIds }, isActive: true },
      include: { _count: { select: { drills: true } } },
      orderBy: { nextScheduledAt: 'asc' },
    });
  });

  // POST /api/v1/drill-management/recurring — create recurring schedule
  app.post('/recurring', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const body = request.body as {
      type: string;
      frequency: string;
      templateId?: string;
      dayOfWeek?: number;
      dayOfMonth?: number;
      monthOfYear?: number;
      preferredTime?: string;
      buildingId?: string;
      autoNotifyDays?: number;
    };

    if (!body.type || !body.frequency) {
      return reply.status(400).send({ error: 'type and frequency are required' });
    }

    const nextScheduledAt = computeNextScheduledDate(
      body.frequency,
      body.dayOfWeek,
      body.dayOfMonth,
      body.monthOfYear,
      body.preferredTime,
    );

    const schedule = await app.prisma.recurringDrillSchedule.create({
      data: {
        siteId: user.siteIds[0],
        type: body.type as any,
        frequency: body.frequency as any,
        templateId: body.templateId,
        dayOfWeek: body.dayOfWeek,
        dayOfMonth: body.dayOfMonth,
        monthOfYear: body.monthOfYear,
        preferredTime: body.preferredTime,
        buildingId: body.buildingId,
        autoNotifyDays: body.autoNotifyDays ?? 7,
        nextScheduledAt,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: user.siteIds[0],
        userId: user.id,
        action: 'RECURRING_DRILL_CREATED',
        entity: 'RecurringDrillSchedule',
        entityId: schedule.id,
        details: { type: body.type, frequency: body.frequency },
      },
    });

    return reply.status(201).send(schedule);
  });

  // PATCH /api/v1/drill-management/recurring/:id — update recurring schedule
  app.patch('/recurring/:id', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { id } = request.params as { id: string };
    const body = request.body as {
      frequency?: string;
      dayOfWeek?: number;
      dayOfMonth?: number;
      monthOfYear?: number;
      preferredTime?: string;
      autoNotifyDays?: number;
      isActive?: boolean;
    };

    const existing = await app.prisma.recurringDrillSchedule.findFirst({
      where: { id, siteId: { in: user.siteIds } },
    });

    if (!existing) return reply.status(404).send({ error: 'Schedule not found' });

    const data: any = {};
    if (body.frequency !== undefined) data.frequency = body.frequency;
    if (body.dayOfWeek !== undefined) data.dayOfWeek = body.dayOfWeek;
    if (body.dayOfMonth !== undefined) data.dayOfMonth = body.dayOfMonth;
    if (body.monthOfYear !== undefined) data.monthOfYear = body.monthOfYear;
    if (body.preferredTime !== undefined) data.preferredTime = body.preferredTime;
    if (body.autoNotifyDays !== undefined) data.autoNotifyDays = body.autoNotifyDays;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    // Recalculate next scheduled date if scheduling parameters changed
    if (body.frequency || body.dayOfWeek !== undefined || body.dayOfMonth !== undefined || body.monthOfYear !== undefined) {
      data.nextScheduledAt = computeNextScheduledDate(
        body.frequency || existing.frequency,
        body.dayOfWeek ?? existing.dayOfWeek ?? undefined,
        body.dayOfMonth ?? existing.dayOfMonth ?? undefined,
        body.monthOfYear ?? existing.monthOfYear ?? undefined,
        body.preferredTime || existing.preferredTime || undefined,
      );
    }

    return app.prisma.recurringDrillSchedule.update({ where: { id }, data });
  });

  // DELETE /api/v1/drill-management/recurring/:id — deactivate recurring schedule
  app.delete('/recurring/:id', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { id } = request.params as { id: string };

    const existing = await app.prisma.recurringDrillSchedule.findFirst({
      where: { id, siteId: { in: user.siteIds } },
    });

    if (!existing) return reply.status(404).send({ error: 'Schedule not found' });

    await app.prisma.recurringDrillSchedule.update({
      where: { id },
      data: { isActive: false },
    });

    return reply.code(204).send();
  });

  // ===========================================================================
  // Drill Notifications
  // ===========================================================================

  // POST /api/v1/drill-management/drills/:drillId/notify — send drill reminder
  app.post('/drills/:drillId/notify', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { drillId } = request.params as { drillId: string };

    const drill = await app.prisma.drill.findFirst({
      where: { id: drillId, siteId: { in: user.siteIds } },
      include: { template: { select: { name: true, procedures: true } } },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });

    const scheduledDate = drill.scheduledAt.toLocaleDateString();
    const scheduledTime = drill.scheduledAt.toLocaleTimeString();
    const templateName = drill.template?.name || drill.type;

    await app.prisma.drill.update({
      where: { id: drillId },
      data: { notifiedAt: new Date() },
    });

    await (app as any).alertQueue.add('notify-staff', {
      alertId: drill.id,
      siteId: drill.siteId,
      level: 'INFO',
      message: `Upcoming ${templateName} drill scheduled for ${scheduledDate} at ${scheduledTime}. Please review procedures.`,
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: drill.siteId,
        userId: user.id,
        action: 'DRILL_NOTIFICATION_SENT',
        entity: 'Drill',
        entityId: drillId,
      },
    });

    return { sent: true, drillId, notifiedAt: new Date() };
  });

  // ===========================================================================
  // Drill Analytics Dashboard
  // ===========================================================================

  // GET /api/v1/drill-management/analytics — drill performance analytics
  app.get('/analytics', { preHandler: [requireMinRole('OPERATOR')] }, async (request: FastifyRequest) => {
    const user = request.user as { siteIds: string[] };
    const { year } = request.query as { year?: string };
    const targetYear = parseInt(year || new Date().getFullYear().toString());

    const dateFilter = {
      gte: new Date(`${targetYear}-01-01`),
      lt: new Date(`${targetYear + 1}-01-01`),
    };

    const [completedDrills, allScores, allObservations] = await Promise.all([
      app.prisma.drill.findMany({
        where: {
          siteId: { in: user.siteIds },
          status: 'COMPLETED',
          completedAt: dateFilter,
        },
        include: {
          participants: true,
          scores: true,
          observations: true,
        },
        orderBy: { completedAt: 'asc' },
      }),
      app.prisma.drillScore.findMany({
        where: { siteId: { in: user.siteIds }, createdAt: dateFilter },
      }),
      app.prisma.drillObservation.findMany({
        where: { siteId: { in: user.siteIds }, createdAt: dateFilter },
      }),
    ]);

    // By type
    const byType: Record<string, { count: number; avgEvacTime: number | null; avgScore: number | null }> = {};
    for (const drill of completedDrills) {
      if (!byType[drill.type]) {
        byType[drill.type] = { count: 0, avgEvacTime: null, avgScore: null };
      }
      byType[drill.type].count += 1;
    }

    // Evacuation time trend (for drills that tracked it)
    const evacTrend = completedDrills
      .filter((d) => d.evacuationTimeS !== null)
      .map((d) => ({
        drillId: d.id,
        type: d.type,
        date: d.completedAt,
        evacuationTimeS: d.evacuationTimeS,
      }));

    // Participation rates
    const participationRates = completedDrills.map((d) => {
      const total = d.participants.length;
      const checkedIn = d.participants.filter((p) => p.checkedIn).length;
      return {
        drillId: d.id,
        type: d.type,
        date: d.completedAt,
        totalParticipants: total,
        checkedIn,
        rate: total > 0 ? Math.round((checkedIn / total) * 100) : 0,
      };
    });

    // Findings by severity
    const findingsBySeverity: Record<string, number> = { INFO: 0, MINOR: 0, MAJOR: 0, CRITICAL: 0 };
    for (const obs of allObservations) {
      findingsBySeverity[obs.severity] = (findingsBySeverity[obs.severity] || 0) + 1;
    }

    // Overall score average
    const overallScoreAvg = allScores.length > 0
      ? Math.round((allScores.reduce((sum, s) => sum + s.score, 0) / allScores.length) * 10) / 10
      : null;

    return {
      year: targetYear,
      totalCompleted: completedDrills.length,
      byType,
      evacuationTimeTrend: evacTrend,
      participationRates,
      findingsBySeverity,
      overallScoreAverage: overallScoreAvg,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeNextScheduledDate(
  frequency: string,
  dayOfWeek?: number,
  dayOfMonth?: number,
  monthOfYear?: number,
  preferredTime?: string,
): Date {
  const now = new Date();
  const next = new Date(now);

  // Set preferred time if provided
  if (preferredTime) {
    const [h, m] = preferredTime.split(':').map(Number);
    next.setHours(h, m, 0, 0);
  } else {
    next.setHours(10, 0, 0, 0); // Default 10 AM
  }

  switch (frequency) {
    case 'WEEKLY':
      if (dayOfWeek !== undefined) {
        next.setDate(now.getDate() + ((7 + dayOfWeek - now.getDay()) % 7 || 7));
      } else {
        next.setDate(now.getDate() + 7);
      }
      break;
    case 'BIWEEKLY':
      if (dayOfWeek !== undefined) {
        next.setDate(now.getDate() + ((7 + dayOfWeek - now.getDay()) % 7 || 7) + 7);
      } else {
        next.setDate(now.getDate() + 14);
      }
      break;
    case 'MONTHLY':
      next.setMonth(now.getMonth() + 1);
      if (dayOfMonth !== undefined) next.setDate(dayOfMonth);
      break;
    case 'QUARTERLY':
      next.setMonth(now.getMonth() + 3);
      if (dayOfMonth !== undefined) next.setDate(dayOfMonth);
      break;
    case 'SEMI_ANNUALLY':
      next.setMonth(now.getMonth() + 6);
      if (dayOfMonth !== undefined) next.setDate(dayOfMonth);
      break;
    case 'ANNUALLY':
      next.setFullYear(now.getFullYear() + 1);
      if (monthOfYear !== undefined) next.setMonth(monthOfYear - 1);
      if (dayOfMonth !== undefined) next.setDate(dayOfMonth);
      break;
    default:
      next.setMonth(now.getMonth() + 1);
  }

  return next;
}

export { drillManagementRoutes };
