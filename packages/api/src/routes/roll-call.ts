import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const rollCallRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /roll-call — Initiate roll call for active incident
  fastify.post<{
    Body: { incidentId: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const { incidentId } = request.body;
    if (!incidentId) return reply.code(400).send({ error: 'incidentId is required' });

    // Verify incident exists and belongs to site
    const incident = await fastify.prisma.incident.findFirst({
      where: { id: incidentId, siteId },
    });
    if (!incident) return reply.code(404).send({ error: 'Incident not found' });

    // Check no active roll call already exists
    const existing = await fastify.prisma.rollCall.findFirst({
      where: { incidentId, status: 'ACTIVE_ROLLCALL' },
    });
    if (existing) return reply.code(409).send({ error: 'Active roll call already exists', rollCallId: existing.id });

    // Count classrooms and students for this site
    const totalClassrooms = await fastify.prisma.room.count({
      where: { building: { siteId }, type: 'CLASSROOM' },
    });
    const totalStudents = await fastify.prisma.student.count({
      where: { siteId, isActive: true },
    });

    const rollCall = await fastify.prisma.rollCall.create({
      data: {
        incidentId,
        siteId,
        initiatedById: request.jwtUser.id,
        totalClassrooms,
        totalStudents,
      },
      include: { reports: true },
    });

    // Broadcast to site
    fastify.wsManager.broadcastToSite(siteId, 'rollcall:initiated', {
      rollCallId: rollCall.id,
      incidentId,
      totalClassrooms,
      totalStudents,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'ROLLCALL_INITIATED',
        entity: 'RollCall',
        entityId: rollCall.id,
        details: { incidentId, totalClassrooms, totalStudents },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(rollCall);
  });

  // GET /roll-call/:id — Get roll call status + all reports
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request, reply) => {
      const rollCall = await fastify.prisma.rollCall.findUnique({
        where: { id: request.params.id },
        include: {
          reports: {
            include: {
              user: { select: { id: true, name: true, email: true } },
              room: { select: { id: true, name: true, number: true } },
            },
          },
        },
      });
      if (!rollCall) return reply.code(404).send({ error: 'Roll call not found' });

      // IDOR protection: verify user has access to this roll call's site
      if (!request.jwtUser.siteIds.includes(rollCall.siteId)) {
        return reply.code(404).send({ error: 'Roll call not found' });
      }

      return rollCall;
    },
  );

  // GET /roll-call/active — Get currently active roll call for user's site
  fastify.get('/active', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return null;

    const rollCall = await fastify.prisma.rollCall.findFirst({
      where: { siteId, status: 'ACTIVE_ROLLCALL' },
      include: {
        reports: {
          include: {
            user: { select: { id: true, name: true } },
            room: { select: { id: true, name: true, number: true } },
          },
        },
      },
      orderBy: { initiatedAt: 'desc' },
    });

    return rollCall;
  });

  // POST /roll-call/:id/report — Teacher submits classroom report
  fastify.post<{
    Params: { id: string };
    Body: {
      roomId: string;
      studentsPresent: number;
      studentsAbsent: number;
      studentsMissing?: string[];
      studentsInjured?: string[];
      notes?: string;
    };
  }>('/:id/report', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const rollCall = await fastify.prisma.rollCall.findUnique({ where: { id: request.params.id } });
    if (!rollCall) return reply.code(404).send({ error: 'Roll call not found' });
    if (!request.jwtUser.siteIds.includes(rollCall.siteId)) {
      return reply.code(404).send({ error: 'Roll call not found' });
    }
    if (rollCall.status !== 'ACTIVE_ROLLCALL') {
      return reply.code(400).send({ error: 'Roll call is not active' });
    }

    const { roomId, studentsPresent, studentsAbsent, studentsMissing, studentsInjured, notes } = request.body;
    if (!roomId || studentsPresent === undefined || studentsAbsent === undefined) {
      return reply.code(400).send({ error: 'roomId, studentsPresent, and studentsAbsent are required' });
    }

    // Upsert report (teacher can update their report)
    const report = await fastify.prisma.rollCallReport.upsert({
      where: { rollCallId_userId: { rollCallId: rollCall.id, userId: request.jwtUser.id } },
      create: {
        rollCallId: rollCall.id,
        userId: request.jwtUser.id,
        roomId,
        studentsPresent,
        studentsAbsent,
        studentsMissing: studentsMissing || [],
        studentsInjured: studentsInjured || [],
        notes: notes ? sanitizeText(notes) : null,
      },
      update: {
        roomId,
        studentsPresent,
        studentsAbsent,
        studentsMissing: studentsMissing || [],
        studentsInjured: studentsInjured || [],
        notes: notes ? sanitizeText(notes) : null,
      },
      include: {
        user: { select: { id: true, name: true } },
        room: { select: { id: true, name: true, number: true } },
      },
    });

    // Recalculate roll call totals
    const allReports = await fastify.prisma.rollCallReport.findMany({
      where: { rollCallId: rollCall.id },
    });

    const reportedClassrooms = allReports.length;
    const accountedStudents = allReports.reduce((sum, r) => sum + r.studentsPresent, 0);

    await fastify.prisma.rollCall.update({
      where: { id: rollCall.id },
      data: { reportedClassrooms, accountedStudents },
    });

    // Broadcast update
    fastify.wsManager.broadcastToSite(rollCall.siteId, 'rollcall:report-received', {
      rollCallId: rollCall.id,
      report,
      reportedClassrooms,
      accountedStudents,
      totalClassrooms: rollCall.totalClassrooms,
      totalStudents: rollCall.totalStudents,
    });

    return reply.code(201).send(report);
  });

  // PUT /roll-call/:id/report/:reportId — Update report
  fastify.put<{
    Params: { id: string; reportId: string };
    Body: {
      studentsPresent?: number;
      studentsAbsent?: number;
      studentsMissing?: string[];
      studentsInjured?: string[];
      notes?: string;
    };
  }>(
    '/:id/report/:reportId',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request, reply) => {
      const report = await fastify.prisma.rollCallReport.findUnique({
        where: { id: request.params.reportId },
      });
      if (!report || report.rollCallId !== request.params.id) {
        return reply.code(404).send({ error: 'Report not found' });
      }

      // Only the report author (or SITE_ADMIN+) can update
      if (report.userId !== request.jwtUser.id &&
          request.jwtUser.role !== 'SITE_ADMIN' &&
          request.jwtUser.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({ error: 'Cannot modify another user\'s report' });
      }

      const data: any = {};
      if (request.body.studentsPresent !== undefined) data.studentsPresent = request.body.studentsPresent;
      if (request.body.studentsAbsent !== undefined) data.studentsAbsent = request.body.studentsAbsent;
      if (request.body.studentsMissing) data.studentsMissing = request.body.studentsMissing;
      if (request.body.studentsInjured) data.studentsInjured = request.body.studentsInjured;
      if (request.body.notes !== undefined) data.notes = request.body.notes ? sanitizeText(request.body.notes) : null;

      const updated = await fastify.prisma.rollCallReport.update({
        where: { id: request.params.reportId },
        data,
        include: {
          user: { select: { id: true, name: true } },
          room: { select: { id: true, name: true, number: true } },
        },
      });

      // Recalculate totals
      const allReports = await fastify.prisma.rollCallReport.findMany({
        where: { rollCallId: request.params.id },
      });
      const accountedStudents = allReports.reduce((sum, r) => sum + r.studentsPresent, 0);

      await fastify.prisma.rollCall.update({
        where: { id: request.params.id },
        data: { accountedStudents },
      });

      fastify.wsManager.broadcastToSite(report.rollCallId, 'rollcall:report-received', {
        rollCallId: request.params.id,
        report: updated,
        accountedStudents,
      });

      return updated;
    },
  );

  // POST /roll-call/:id/complete — Mark roll call complete
  fastify.post<{ Params: { id: string } }>(
    '/:id/complete',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const rollCall = await fastify.prisma.rollCall.findUnique({ where: { id: request.params.id } });
      if (!rollCall) return reply.code(404).send({ error: 'Roll call not found' });
      if (!request.jwtUser.siteIds.includes(rollCall.siteId)) {
        return reply.code(404).send({ error: 'Roll call not found' });
      }

      const updated = await fastify.prisma.rollCall.update({
        where: { id: request.params.id },
        data: { status: 'COMPLETED_ROLLCALL', completedAt: new Date() },
        include: { reports: true },
      });

      fastify.wsManager.broadcastToSite(rollCall.siteId, 'rollcall:completed', {
        rollCallId: updated.id,
        reportedClassrooms: updated.reportedClassrooms,
        accountedStudents: updated.accountedStudents,
      });

      return updated;
    },
  );
};

export default rollCallRoutes;
