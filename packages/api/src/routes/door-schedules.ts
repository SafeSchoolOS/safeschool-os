import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const doorScheduleRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════
  // Class Schedules — Teacher/admin enters their class schedule
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId?: string; teacherId?: string; roomId?: string; isActive?: string; dayOfWeek?: string };
  }>('/class-schedules', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request) => {
    const { siteId, teacherId, roomId, isActive, dayOfWeek } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (teacherId) where.teacherId = teacherId;
    if (roomId) where.roomId = roomId;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (dayOfWeek) where.dayOfWeek = { has: parseInt(dayOfWeek) };

    return fastify.prisma.classSchedule.findMany({
      where,
      include: {
        doorLockSchedules: {
          include: { door: { select: { id: true, name: true, floor: true } } },
        },
      },
      orderBy: [{ startTime: 'asc' }],
    });
  });

  fastify.post<{
    Body: {
      siteId: string;
      name: string;
      teacherId?: string;
      roomId?: string;
      dayOfWeek: number[];
      startTime: string;
      endTime: string;
      semester?: string;
      effectiveFrom: string;
      effectiveUntil?: string;
    };
  }>('/class-schedules', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const { siteId, name, effectiveFrom, effectiveUntil, ...rest } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const schedule = await fastify.prisma.classSchedule.create({
      data: {
        siteId,
        name: sanitizeText(name),
        effectiveFrom: new Date(effectiveFrom),
        effectiveUntil: effectiveUntil ? new Date(effectiveUntil) : null,
        ...rest,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'CLASS_SCHEDULE_CREATED',
        entity: 'ClassSchedule',
        entityId: schedule.id,
        details: { name, dayOfWeek: rest.dayOfWeek, startTime: rest.startTime, endTime: rest.endTime },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(schedule);
  });

  fastify.patch<{
    Params: { scheduleId: string };
    Body: {
      name?: string;
      teacherId?: string;
      roomId?: string;
      dayOfWeek?: number[];
      startTime?: string;
      endTime?: string;
      semester?: string;
      effectiveFrom?: string;
      effectiveUntil?: string;
      isActive?: boolean;
    };
  }>('/class-schedules/:scheduleId', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const schedule = await fastify.prisma.classSchedule.findFirst({
      where: { id: request.params.scheduleId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!schedule) return reply.code(404).send({ error: 'Class schedule not found' });

    const { name, effectiveFrom, effectiveUntil, ...data } = request.body;
    const updateData: any = { ...data };
    if (name) updateData.name = sanitizeText(name);
    if (effectiveFrom) updateData.effectiveFrom = new Date(effectiveFrom);
    if (effectiveUntil) updateData.effectiveUntil = new Date(effectiveUntil);

    return fastify.prisma.classSchedule.update({
      where: { id: schedule.id },
      data: updateData,
      include: {
        doorLockSchedules: {
          include: { door: { select: { id: true, name: true } } },
        },
      },
    });
  });

  fastify.delete<{
    Params: { scheduleId: string };
  }>('/class-schedules/:scheduleId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const schedule = await fastify.prisma.classSchedule.findFirst({
      where: { id: request.params.scheduleId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!schedule) return reply.code(404).send({ error: 'Class schedule not found' });

    await fastify.prisma.classSchedule.delete({ where: { id: schedule.id } });
    return reply.code(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════
  // Door Lock Schedules — Link doors to class schedules for auto-lock
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId?: string; doorId?: string; isActive?: string };
  }>('/lock-schedules', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, doorId, isActive } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (doorId) where.doorId = doorId;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    return fastify.prisma.doorLockSchedule.findMany({
      where,
      include: {
        door: { select: { id: true, name: true, floor: true, buildingId: true, status: true } },
        classSchedule: { select: { id: true, name: true, startTime: true, endTime: true, dayOfWeek: true } },
      },
      orderBy: [{ door: { name: 'asc' } }],
    });
  });

  fastify.post<{
    Body: {
      siteId: string;
      doorId: string;
      classScheduleId?: string;
      lockAction?: string;
      offsetMinutes?: number;
      unlockBeforeEndMin?: number;
      dayOfWeek?: number[];
      lockTime?: string;
      unlockTime?: string;
    };
  }>('/lock-schedules', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, doorId, classScheduleId, lockAction, ...rest } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Verify door belongs to site
    const door = await fastify.prisma.door.findFirst({ where: { id: doorId, siteId } });
    if (!door) return reply.code(404).send({ error: 'Door not found at this site' });

    // If linking to a class schedule, verify it exists
    if (classScheduleId) {
      const cls = await fastify.prisma.classSchedule.findFirst({ where: { id: classScheduleId, siteId } });
      if (!cls) return reply.code(404).send({ error: 'Class schedule not found' });
    }

    const schedule = await fastify.prisma.doorLockSchedule.create({
      data: {
        siteId,
        doorId,
        classScheduleId: classScheduleId || null,
        lockAction: (lockAction || 'LOCK_UNLOCK') as any,
        dayOfWeek: rest.dayOfWeek || [],
        ...rest,
      },
      include: {
        door: { select: { id: true, name: true } },
        classSchedule: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'DOOR_LOCK_SCHEDULE_CREATED',
        entity: 'DoorLockSchedule',
        entityId: schedule.id,
        details: { doorId, classScheduleId, lockAction: lockAction || 'LOCK_UNLOCK' },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(schedule);
  });

  fastify.patch<{
    Params: { scheduleId: string };
    Body: {
      lockAction?: string;
      offsetMinutes?: number;
      unlockBeforeEndMin?: number;
      dayOfWeek?: number[];
      lockTime?: string;
      unlockTime?: string;
      isActive?: boolean;
    };
  }>('/lock-schedules/:scheduleId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const schedule = await fastify.prisma.doorLockSchedule.findFirst({
      where: { id: request.params.scheduleId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!schedule) return reply.code(404).send({ error: 'Door lock schedule not found' });

    const { lockAction, ...data } = request.body;
    const updateData: any = { ...data };
    if (lockAction) updateData.lockAction = lockAction as any;

    return fastify.prisma.doorLockSchedule.update({
      where: { id: schedule.id },
      data: updateData,
      include: {
        door: { select: { id: true, name: true } },
        classSchedule: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
    });
  });

  fastify.delete<{
    Params: { scheduleId: string };
  }>('/lock-schedules/:scheduleId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const schedule = await fastify.prisma.doorLockSchedule.findFirst({
      where: { id: request.params.scheduleId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!schedule) return reply.code(404).send({ error: 'Door lock schedule not found' });

    await fastify.prisma.doorLockSchedule.delete({ where: { id: schedule.id } });
    return reply.code(204).send();
  });

  // ── Bulk-create lock schedules for a class ────────────────────────────
  fastify.post<{
    Params: { classScheduleId: string };
    Body: {
      doorIds: string[];
      lockAction?: string;
      offsetMinutes?: number;
      unlockBeforeEndMin?: number;
    };
  }>('/class-schedules/:classScheduleId/assign-doors', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const cls = await fastify.prisma.classSchedule.findFirst({
      where: { id: request.params.classScheduleId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!cls) return reply.code(404).send({ error: 'Class schedule not found' });

    const { doorIds, lockAction, offsetMinutes, unlockBeforeEndMin } = request.body;
    const created = [];

    for (const doorId of doorIds) {
      const door = await fastify.prisma.door.findFirst({ where: { id: doorId, siteId: cls.siteId } });
      if (!door) continue;

      // Skip if already linked
      const existing = await fastify.prisma.doorLockSchedule.findUnique({
        where: { doorId_classScheduleId: { doorId, classScheduleId: cls.id } },
      });
      if (existing) continue;

      const schedule = await fastify.prisma.doorLockSchedule.create({
        data: {
          siteId: cls.siteId,
          doorId,
          classScheduleId: cls.id,
          lockAction: (lockAction || 'LOCK_UNLOCK') as any,
          offsetMinutes: offsetMinutes ?? 10,
          unlockBeforeEndMin: unlockBeforeEndMin ?? 2,
          dayOfWeek: cls.dayOfWeek,
        },
        include: { door: { select: { id: true, name: true } } },
      });
      created.push(schedule);
    }

    return reply.code(201).send({ created: created.length, schedules: created });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Schedule Overrides — Holidays, early dismissals, etc.
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId: string; from?: string; to?: string };
  }>('/overrides', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, from, to } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const where: any = { siteId };
    if (from || to) {
      where.overrideDate = {};
      if (from) where.overrideDate.gte = new Date(from);
      if (to) where.overrideDate.lte = new Date(to);
    }

    return fastify.prisma.doorScheduleOverride.findMany({
      where,
      orderBy: { overrideDate: 'asc' },
    });
  });

  fastify.post<{
    Body: {
      siteId: string;
      doorId?: string;
      overrideDate: string;
      reason: string;
      skipAllSchedules?: boolean;
      overrideLockTime?: string;
      overrideUnlockTime?: string;
    };
  }>('/overrides', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, overrideDate, reason, ...rest } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const override = await fastify.prisma.doorScheduleOverride.create({
      data: {
        siteId,
        overrideDate: new Date(overrideDate),
        reason: sanitizeText(reason),
        createdById: request.jwtUser.id,
        ...rest,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'DOOR_SCHEDULE_OVERRIDE_CREATED',
        entity: 'DoorScheduleOverride',
        entityId: override.id,
        details: { overrideDate, reason, skipAllSchedules: rest.skipAllSchedules },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(override);
  });

  fastify.delete<{
    Params: { overrideId: string };
  }>('/overrides/:overrideId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const override = await fastify.prisma.doorScheduleOverride.findFirst({
      where: { id: request.params.overrideId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!override) return reply.code(404).send({ error: 'Override not found' });

    await fastify.prisma.doorScheduleOverride.delete({ where: { id: override.id } });
    return reply.code(204).send();
  });

  // ── Check what actions are scheduled today (for cron/scheduler) ───────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/today', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = now.getDay();

    // Check for overrides
    const override = await fastify.prisma.doorScheduleOverride.findFirst({
      where: { siteId, overrideDate: today, doorId: null, skipAllSchedules: true },
    });

    if (override) {
      return { overrideActive: true, reason: override.reason, schedules: [] };
    }

    // Get all active schedules for today's day of week
    const doorSchedules = await fastify.prisma.doorLockSchedule.findMany({
      where: {
        siteId,
        isActive: true,
        OR: [
          { dayOfWeek: { has: dayOfWeek } },
          { classSchedule: { dayOfWeek: { has: dayOfWeek }, isActive: true } },
        ],
      },
      include: {
        door: { select: { id: true, name: true, status: true, buildingId: true } },
        classSchedule: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
    });

    // Compute actual lock/unlock times considering offsets
    const actions = doorSchedules.map((ds) => {
      let lockAt: string | null = null;
      let unlockAt: string | null = null;

      if (ds.classSchedule) {
        // Calculate from class schedule + offsets
        const [startH, startM] = ds.classSchedule.startTime.split(':').map(Number);
        const [endH, endM] = ds.classSchedule.endTime.split(':').map(Number);

        const lockMinutes = startH * 60 + startM + ds.offsetMinutes;
        lockAt = `${String(Math.floor(lockMinutes / 60)).padStart(2, '0')}:${String(lockMinutes % 60).padStart(2, '0')}`;

        const unlockMinutes = endH * 60 + endM - ds.unlockBeforeEndMin;
        unlockAt = `${String(Math.floor(unlockMinutes / 60)).padStart(2, '0')}:${String(unlockMinutes % 60).padStart(2, '0')}`;
      } else {
        lockAt = ds.lockTime;
        unlockAt = ds.unlockTime;
      }

      return {
        scheduleId: ds.id,
        door: ds.door,
        classSchedule: ds.classSchedule,
        lockAction: ds.lockAction,
        lockAt,
        unlockAt,
        lastExecutedAt: ds.lastExecutedAt,
        lastAction: ds.lastAction,
      };
    });

    return { overrideActive: false, dayOfWeek, schedules: actions };
  });

  // ── Execute a scheduled lock/unlock (called by scheduler/cron) ────────
  fastify.post<{
    Params: { scheduleId: string };
    Body: { action: 'LOCK' | 'UNLOCK' };
  }>('/lock-schedules/:scheduleId/execute', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const schedule = await fastify.prisma.doorLockSchedule.findFirst({
      where: { id: request.params.scheduleId, siteId: { in: request.jwtUser.siteIds } },
      include: { door: true },
    });
    if (!schedule) return reply.code(404).send({ error: 'Schedule not found' });

    const { action } = request.body;
    const newStatus = action === 'LOCK' ? 'LOCKED' : 'UNLOCKED';

    // Update door status
    await fastify.prisma.door.update({
      where: { id: schedule.doorId },
      data: { status: newStatus as any },
    });

    // Record execution
    await fastify.prisma.doorLockSchedule.update({
      where: { id: schedule.id },
      data: { lastExecutedAt: new Date(), lastAction: action },
    });

    // Broadcast via WebSocket
    fastify.wsManager?.broadcastToSite(schedule.siteId, 'door.scheduled_action', {
      doorId: schedule.doorId,
      doorName: schedule.door.name,
      action,
      scheduleId: schedule.id,
      executedAt: new Date().toISOString(),
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: schedule.siteId,
        userId: request.jwtUser.id,
        action: `DOOR_SCHEDULED_${action}`,
        entity: 'DoorLockSchedule',
        entityId: schedule.id,
        details: { doorId: schedule.doorId, doorName: schedule.door.name, action },
        ipAddress: request.ip,
      },
    });

    return { success: true, doorId: schedule.doorId, action, executedAt: new Date() };
  });
};

export default doorScheduleRoutes;
