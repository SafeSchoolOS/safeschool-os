import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const wellnessCheckInRoutes: FastifyPluginAsync = async (fastify) => {
  // ── List check-ins (with filters) ─────────────────────────────────────
  fastify.get<{
    Querystring: {
      siteId?: string;
      studentId?: string;
      counselorId?: string;
      mood?: string;
      followUpNeeded?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, studentId, counselorId, mood, followUpNeeded, from, to, limit } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (studentId) where.studentId = studentId;
    if (counselorId) where.counselorId = counselorId;
    if (mood) where.mood = mood;
    if (followUpNeeded === 'true') where.followUpNeeded = true;
    if (from || to) {
      where.checkedInAt = {};
      if (from) where.checkedInAt.gte = new Date(from);
      if (to) where.checkedInAt.lte = new Date(to);
    }

    return fastify.prisma.wellnessCheckIn.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, grade: true, photo: true } },
        counselor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { checkedInAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 200),
    });
  });

  // ── Record a check-in ─────────────────────────────────────────────────
  fastify.post<{
    Body: {
      siteId: string;
      studentId: string;
      scheduleId?: string;
      mood: string;
      riskFlags?: string[];
      academicConcern?: boolean;
      attendanceConcern?: boolean;
      notes?: string;
      isConfidential?: boolean;
      followUpNeeded?: boolean;
      followUpDate?: string;
      referralMade?: boolean;
      referralType?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, studentId, scheduleId, mood, riskFlags, notes, referralType, followUpDate, ...rest } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied to this site' });
    }

    const checkIn = await fastify.prisma.wellnessCheckIn.create({
      data: {
        siteId,
        studentId,
        counselorId: request.jwtUser.id,
        scheduleId: scheduleId || null,
        mood: mood as any,
        riskFlags: riskFlags || [],
        notes: notes ? sanitizeText(notes) : null,
        referralType: referralType || null,
        followUpDate: followUpDate ? new Date(followUpDate) : null,
        ...rest,
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, grade: true } },
      },
    });

    // Update the schedule's lastCheckInAt if linked
    if (scheduleId) {
      await fastify.prisma.wellnessSchedule.update({
        where: { id: scheduleId },
        data: { lastCheckInAt: new Date() },
      });
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'WELLNESS_CHECK_IN_RECORDED',
        entity: 'WellnessCheckIn',
        entityId: checkIn.id,
        details: { studentId, mood, riskFlags: riskFlags || [] },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(checkIn);
  });

  // ── Student wellness history (dashboard view) ─────────────────────────
  fastify.get<{
    Params: { studentId: string };
    Querystring: { limit?: string };
  }>('/student/:studentId/history', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { studentId } = request.params;
    const take = Math.min(parseInt(request.query.limit || '20'), 100);

    const [checkIns, interventions, schedules] = await Promise.all([
      fastify.prisma.wellnessCheckIn.findMany({
        where: { studentId, siteId: { in: request.jwtUser.siteIds } },
        include: { counselor: { select: { id: true, name: true } } },
        orderBy: { checkedInAt: 'desc' },
        take,
      }),
      fastify.prisma.wellnessIntervention.findMany({
        where: { studentId, siteId: { in: request.jwtUser.siteIds } },
        include: { counselor: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      fastify.prisma.wellnessSchedule.findMany({
        where: { studentId, siteId: { in: request.jwtUser.siteIds }, isActive: true },
        include: { counselor: { select: { id: true, name: true } } },
      }),
    ]);

    return { checkIns, interventions, activeSchedules: schedules };
  });

  // ── Schedules CRUD ────────────────────────────────────────────────────

  fastify.get<{
    Querystring: { siteId?: string; counselorId?: string; isActive?: string; priority?: string };
  }>('/schedules', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, counselorId, isActive, priority } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (counselorId) where.counselorId = counselorId;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (priority) where.priority = priority;

    return fastify.prisma.wellnessSchedule.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, grade: true, photo: true } },
        counselor: { select: { id: true, name: true, email: true } },
        _count: { select: { checkIns: true } },
      },
      orderBy: [{ priority: 'desc' }, { nextCheckInAt: 'asc' }],
    });
  });

  fastify.post<{
    Body: {
      siteId: string;
      studentId: string;
      frequency: string;
      dayOfWeek?: number;
      preferredTime?: string;
      reason?: string;
      priority?: string;
      startDate: string;
      endDate?: string;
    };
  }>('/schedules', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, studentId, reason, startDate, endDate, ...rest } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied to this site' });
    }

    const schedule = await fastify.prisma.wellnessSchedule.create({
      data: {
        siteId,
        studentId,
        counselorId: request.jwtUser.id,
        reason: reason ? sanitizeText(reason) : null,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        nextCheckInAt: new Date(startDate),
        ...rest,
        priority: (rest.priority || 'ROUTINE') as any,
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, grade: true } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'WELLNESS_SCHEDULE_CREATED',
        entity: 'WellnessSchedule',
        entityId: schedule.id,
        details: { studentId, frequency: rest.frequency, priority: rest.priority },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(schedule);
  });

  fastify.patch<{
    Params: { scheduleId: string };
    Body: {
      frequency?: string;
      dayOfWeek?: number;
      preferredTime?: string;
      priority?: string;
      isActive?: boolean;
      endDate?: string;
    };
  }>('/schedules/:scheduleId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const schedule = await fastify.prisma.wellnessSchedule.findFirst({
      where: { id: request.params.scheduleId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!schedule) return reply.code(404).send({ error: 'Schedule not found' });

    const { endDate, ...data } = request.body;
    const updateData: any = { ...data };
    if (endDate) updateData.endDate = new Date(endDate);
    if (data.priority) updateData.priority = data.priority as any;

    return fastify.prisma.wellnessSchedule.update({
      where: { id: schedule.id },
      data: updateData,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, grade: true } },
      },
    });
  });

  // ── Interventions CRUD ────────────────────────────────────────────────

  fastify.get<{
    Querystring: { siteId?: string; studentId?: string; status?: string; type?: string };
  }>('/interventions', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, studentId, status, type } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (studentId) where.studentId = studentId;
    if (status) where.status = status;
    if (type) where.type = type;

    return fastify.prisma.wellnessIntervention.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, grade: true } },
        counselor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  fastify.post<{
    Body: {
      siteId: string;
      studentId: string;
      type: string;
      description: string;
      parentNotified?: boolean;
      externalReferral?: boolean;
      externalAgency?: string;
      scheduledAt?: string;
    };
  }>('/interventions', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, studentId, description, externalAgency, scheduledAt, ...rest } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied to this site' });
    }

    const intervention = await fastify.prisma.wellnessIntervention.create({
      data: {
        siteId,
        studentId,
        counselorId: request.jwtUser.id,
        type: rest.type as any,
        description: sanitizeText(description),
        externalAgency: externalAgency || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        parentNotified: rest.parentNotified || false,
        externalReferral: rest.externalReferral || false,
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, grade: true } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'WELLNESS_INTERVENTION_CREATED',
        entity: 'WellnessIntervention',
        entityId: intervention.id,
        details: { studentId, type: rest.type },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(intervention);
  });

  fastify.patch<{
    Params: { interventionId: string };
    Body: {
      status?: string;
      outcome?: string;
      completedAt?: string;
      parentNotified?: boolean;
      parentNotifiedAt?: string;
    };
  }>('/interventions/:interventionId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const intervention = await fastify.prisma.wellnessIntervention.findFirst({
      where: { id: request.params.interventionId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!intervention) return reply.code(404).send({ error: 'Intervention not found' });

    const { outcome, completedAt, parentNotifiedAt, ...data } = request.body;
    const updateData: any = { ...data };
    if (outcome) updateData.outcome = sanitizeText(outcome);
    if (completedAt) updateData.completedAt = new Date(completedAt);
    if (parentNotifiedAt) updateData.parentNotifiedAt = new Date(parentNotifiedAt);
    if (data.status) updateData.status = data.status as any;

    return fastify.prisma.wellnessIntervention.update({
      where: { id: intervention.id },
      data: updateData,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, grade: true } },
        counselor: { select: { id: true, name: true } },
      },
    });
  });

  // ── Dashboard summary (at-risk overview) ──────────────────────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/dashboard', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!siteId || !request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [recentCheckIns, overdueSchedules, activeInterventions, moodDistribution] = await Promise.all([
      fastify.prisma.wellnessCheckIn.count({
        where: { siteId, checkedInAt: { gte: thirtyDaysAgo } },
      }),
      fastify.prisma.wellnessSchedule.count({
        where: { siteId, isActive: true, nextCheckInAt: { lt: now } },
      }),
      fastify.prisma.wellnessIntervention.count({
        where: { siteId, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
      }),
      fastify.prisma.wellnessCheckIn.groupBy({
        by: ['mood'],
        where: { siteId, checkedInAt: { gte: thirtyDaysAgo } },
        _count: true,
      }),
    ]);

    return {
      recentCheckIns,
      overdueSchedules,
      activeInterventions,
      moodDistribution: moodDistribution.map((m) => ({ mood: m.mood, count: m._count })),
    };
  });
};

export default wellnessCheckInRoutes;
