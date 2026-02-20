import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const attendanceRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Get attendance records for a date ─────────────────────────────────
  fastify.get<{
    Querystring: {
      siteId: string;
      date: string;
      status?: string;
      grade?: string;
      buildingId?: string;
      limit?: string;
      offset?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, date, status, grade, buildingId, limit, offset } = request.query;
    if (!siteId || !request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const where: any = { siteId, date: new Date(date) };
    if (status) where.status = status;

    const studentWhere: any = {};
    if (grade) studentWhere.grade = grade;
    if (buildingId) studentWhere.buildingId = buildingId;
    if (Object.keys(studentWhere).length > 0) where.student = studentWhere;

    return fastify.prisma.attendanceRecord.findMany({
      where,
      include: {
        student: {
          select: {
            id: true, firstName: true, lastName: true, grade: true,
            studentNumber: true, buildingId: true, roomId: true, photo: true,
          },
        },
      },
      orderBy: { student: { lastName: 'asc' } },
      take: Math.min(parseInt(limit || '100'), 500),
      skip: parseInt(offset || '0'),
    });
  });

  // ── Get attendance summary (counts by status) ─────────────────────────
  fastify.get<{
    Querystring: { siteId: string; date: string };
  }>('/summary', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, date } = request.query;
    if (!siteId || !request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const dateObj = new Date(date);
    const [statusCounts, totalStudents] = await Promise.all([
      fastify.prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: { siteId, date: dateObj },
        _count: true,
      }),
      fastify.prisma.student.count({ where: { siteId, isActive: true } }),
    ]);

    const counts: Record<string, number> = {};
    for (const row of statusCounts) {
      counts[row.status] = row._count;
    }

    return {
      date,
      totalStudents,
      present: counts['PRESENT'] || 0,
      tardy: counts['TARDY'] || 0,
      absent: counts['ABSENT'] || 0,
      excusedAbsent: counts['EXCUSED_ABSENT'] || 0,
      earlyDeparture: counts['EARLY_DEPARTURE'] || 0,
      scanned: (counts['PRESENT'] || 0) + (counts['TARDY'] || 0),
    };
  });

  // ── Process a badge scan into attendance ──────────────────────────────
  fastify.post<{
    Body: {
      siteId: string;
      cardNumber?: string;
      facilityCode?: string;
      studentId?: string;
      doorId?: string;
      scanDirection?: string;
      scannedAt?: string;
    };
  }>('/scan', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, cardNumber, studentId, doorId, scanDirection, scannedAt } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Record the raw scan
    const scan = await fastify.prisma.attendanceScan.create({
      data: {
        siteId,
        studentId: studentId || null,
        cardNumber: cardNumber || null,
        facilityCode: request.body.facilityCode || null,
        doorId: doorId || null,
        scanDirection: scanDirection || null,
        scannedAt: scannedAt ? new Date(scannedAt) : new Date(),
      },
    });

    // If we have a studentId, update/create attendance record for today
    let resolvedStudentId = studentId;

    // If no studentId but have cardNumber, look up via cardholder credential
    if (!resolvedStudentId && cardNumber) {
      const credential = await fastify.prisma.cardholderCredential.findFirst({
        where: { cardNumber, cardholder: { siteId, personType: 'STUDENT' } },
        include: { cardholder: true },
      });
      if (credential?.cardholder) {
        // Look up student by matching the cardholder
        const student = await fastify.prisma.student.findFirst({
          where: { siteId, externalId: credential.cardholder.externalId },
        });
        if (student) resolvedStudentId = student.id;
      }
    }

    if (!resolvedStudentId) {
      return reply.code(201).send({ scan, attendance: null, message: 'Scan recorded but no student match' });
    }

    // Get site attendance config
    const config = await fastify.prisma.attendanceConfig.findUnique({ where: { siteId } });
    const scanTime = scannedAt ? new Date(scannedAt) : new Date();
    const today = new Date(scanTime.getFullYear(), scanTime.getMonth(), scanTime.getDate());

    // Determine attendance status
    let status: 'PRESENT' | 'TARDY' = 'PRESENT';
    let tardyMinutes: number | null = null;

    if (config) {
      const [startH, startM] = config.schoolStartTime.split(':').map(Number);
      const schoolStart = new Date(today);
      schoolStart.setHours(startH, startM, 0, 0);

      const tardyThreshold = new Date(schoolStart.getTime() + config.tardyThresholdMin * 60 * 1000);

      if (scanTime > tardyThreshold) {
        status = 'TARDY';
        tardyMinutes = Math.round((scanTime.getTime() - schoolStart.getTime()) / 60000);
      }
    }

    // Upsert attendance record — only update if it improves status
    const existing = await fastify.prisma.attendanceRecord.findUnique({
      where: { siteId_studentId_date: { siteId, studentId: resolvedStudentId, date: today } },
    });

    let attendance;
    if (existing) {
      attendance = await fastify.prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          lastScanAt: scanTime,
          totalScans: { increment: 1 },
          // Only upgrade from ABSENT, never downgrade from PRESENT to TARDY
          ...(existing.status === 'ABSENT' ? { status, tardyMinutes } : {}),
        },
      });
    } else {
      attendance = await fastify.prisma.attendanceRecord.create({
        data: {
          siteId,
          studentId: resolvedStudentId,
          date: today,
          status,
          firstScanAt: scanTime,
          lastScanAt: scanTime,
          totalScans: 1,
          tardyMinutes,
        },
      });
    }

    return reply.code(201).send({ scan, attendance });
  });

  // ── Manual override (teacher/admin marks present/absent) ──────────────
  fastify.patch<{
    Params: { recordId: string };
    Body: {
      status?: string;
      excused?: boolean;
      excuseReason?: string;
      overrideReason?: string;
    };
  }>('/:recordId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const record = await fastify.prisma.attendanceRecord.findFirst({
      where: { id: request.params.recordId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!record) return reply.code(404).send({ error: 'Attendance record not found' });

    const data: any = { markedById: request.jwtUser.id };
    if (request.body.status) data.status = request.body.status as any;
    if (request.body.excused !== undefined) data.excused = request.body.excused;
    if (request.body.excuseReason) data.excuseReason = request.body.excuseReason;
    if (request.body.overrideReason) data.overrideReason = request.body.overrideReason;

    const updated = await fastify.prisma.attendanceRecord.update({
      where: { id: record.id },
      data,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, grade: true } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: record.siteId,
        userId: request.jwtUser.id,
        action: 'ATTENDANCE_MANUAL_OVERRIDE',
        entity: 'AttendanceRecord',
        entityId: record.id,
        details: { previousStatus: record.status, newStatus: data.status, overrideReason: data.overrideReason },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // ── Student attendance history ────────────────────────────────────────
  fastify.get<{
    Params: { studentId: string };
    Querystring: { from?: string; to?: string; limit?: string };
  }>('/student/:studentId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { studentId } = request.params;
    const { from, to, limit } = request.query;

    const where: any = { studentId, siteId: { in: request.jwtUser.siteIds } };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const records = await fastify.prisma.attendanceRecord.findMany({
      where,
      orderBy: { date: 'desc' },
      take: Math.min(parseInt(limit || '90'), 365),
    });

    const summary = {
      totalDays: records.length,
      present: records.filter((r) => r.status === 'PRESENT').length,
      tardy: records.filter((r) => r.status === 'TARDY').length,
      absent: records.filter((r) => r.status === 'ABSENT').length,
      excused: records.filter((r) => r.status === 'EXCUSED_ABSENT').length,
      attendanceRate: 0,
    };
    if (summary.totalDays > 0) {
      summary.attendanceRate = Math.round(((summary.present + summary.tardy) / summary.totalDays) * 100);
    }

    return { records, summary };
  });

  // ── Attendance config CRUD ────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/config', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const config = await fastify.prisma.attendanceConfig.findUnique({ where: { siteId } });
    return config || reply.code(404).send({ error: 'No config found. Create one first.' });
  });

  fastify.put<{
    Body: {
      siteId: string;
      schoolStartTime: string;
      schoolEndTime: string;
      tardyThresholdMin?: number;
      absentThresholdMin?: number;
      autoMarkAbsent?: boolean;
      scanDoorsOnly?: string[];
      excludeWeekends?: boolean;
      excludeDates?: string[];
    };
  }>('/config', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, excludeDates, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const config = await fastify.prisma.attendanceConfig.upsert({
      where: { siteId },
      create: {
        siteId,
        ...rest,
        excludeDates: excludeDates ? excludeDates.map((d) => new Date(d)) : [],
      },
      update: {
        ...rest,
        excludeDates: excludeDates ? excludeDates.map((d) => new Date(d)) : undefined,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'ATTENDANCE_CONFIG_UPDATED',
        entity: 'AttendanceConfig',
        entityId: config.id,
        details: rest,
        ipAddress: request.ip,
      },
    });

    return config;
  });

  // ── Recent scans (live feed) ──────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string; limit?: string };
  }>('/scans', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, limit } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    return fastify.prisma.attendanceScan.findMany({
      where: { siteId },
      orderBy: { scannedAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 200),
    });
  });
};

export default attendanceRoutes;
