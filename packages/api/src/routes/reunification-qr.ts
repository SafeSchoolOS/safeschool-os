import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { randomBytes } from 'crypto';

const reunificationQRRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Generate QR codes for guardians ───────────────────────────────────
  fastify.post<{
    Params: { eventId: string };
    Body: {
      guardianName: string;
      guardianPhone?: string;
      guardianEmail?: string;
      requestedStudentIds?: string[];
      expiresInMinutes?: number;
    };
  }>('/:eventId/qr-codes', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: { id: request.params.eventId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!event) return reply.code(404).send({ error: 'Reunification event not found' });

    const { guardianName, guardianPhone, guardianEmail, requestedStudentIds, expiresInMinutes } = request.body;
    const qrToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (expiresInMinutes || 480) * 60 * 1000); // Default 8 hours

    const qrCode = await fastify.prisma.reunificationQRCode.create({
      data: {
        reunificationEventId: event.id,
        guardianName,
        guardianPhone: guardianPhone || null,
        guardianEmail: guardianEmail || null,
        requestedStudentIds: requestedStudentIds || [],
        qrToken,
        expiresAt,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: event.siteId,
        userId: request.jwtUser.id,
        action: 'REUNIFICATION_QR_GENERATED',
        entity: 'ReunificationQRCode',
        entityId: qrCode.id,
        details: { guardianName, reunificationEventId: event.id },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({
      ...qrCode,
      qrPayload: `safeschool://reunification/checkin?token=${qrToken}`,
    });
  });

  // ── Bulk generate QR codes from parent contacts ───────────────────────
  fastify.post<{
    Params: { eventId: string };
    Body: { expiresInMinutes?: number };
  }>('/:eventId/qr-codes/bulk-generate', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: { id: request.params.eventId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!event) return reply.code(404).send({ error: 'Reunification event not found' });

    // Get all active students at the site and their parent contacts
    const students = await fastify.prisma.student.findMany({
      where: { siteId: event.siteId, isActive: true },
      include: { parentContacts: true },
    });

    const expiresAt = new Date(Date.now() + (request.body.expiresInMinutes || 480) * 60 * 1000);
    const qrCodes: any[] = [];

    // Group students by parent contact to avoid duplicates
    const guardianMap = new Map<string, { name: string; phone: string | null; email: string | null; studentIds: string[] }>();

    for (const student of students) {
      for (const contact of student.parentContacts) {
        const key = `${contact.name}|${contact.phone || ''}|${contact.email || ''}`;
        if (!guardianMap.has(key)) {
          guardianMap.set(key, {
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            studentIds: [],
          });
        }
        guardianMap.get(key)!.studentIds.push(student.id);
      }
    }

    for (const [, guardian] of guardianMap) {
      const qrToken = randomBytes(32).toString('hex');
      const qrCode = await fastify.prisma.reunificationQRCode.create({
        data: {
          reunificationEventId: event.id,
          guardianName: guardian.name,
          guardianPhone: guardian.phone,
          guardianEmail: guardian.email,
          requestedStudentIds: guardian.studentIds,
          qrToken,
          expiresAt,
        },
      });
      qrCodes.push({
        ...qrCode,
        qrPayload: `safeschool://reunification/checkin?token=${qrToken}`,
      });
    }

    return reply.code(201).send({ generated: qrCodes.length, qrCodes });
  });

  // ── Validate/scan a QR code at check-in ───────────────────────────────
  fastify.post<{
    Body: { qrToken: string };
  }>('/qr-codes/validate', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { qrToken } = request.body;

    const qrCode = await fastify.prisma.reunificationQRCode.findUnique({
      where: { qrToken },
      include: {
        reunificationEvent: {
          select: { id: true, siteId: true, status: true },
        },
      },
    });

    if (!qrCode) return reply.code(404).send({ error: 'Invalid QR code' });
    if (qrCode.isUsed) return reply.code(410).send({ error: 'QR code already used', usedAt: qrCode.usedAt });
    if (qrCode.expiresAt < new Date()) return reply.code(410).send({ error: 'QR code expired' });

    // Look up the requested students
    const students = qrCode.requestedStudentIds.length > 0
      ? await fastify.prisma.student.findMany({
          where: { id: { in: qrCode.requestedStudentIds } },
          select: { id: true, firstName: true, lastName: true, grade: true, photo: true },
        })
      : [];

    // Mark as used
    await fastify.prisma.reunificationQRCode.update({
      where: { id: qrCode.id },
      data: { isUsed: true, usedAt: new Date() },
    });

    // Auto-create guardian check-in on the reunification event
    const checkIn = await fastify.prisma.guardianCheckIn.create({
      data: {
        reunificationEventId: qrCode.reunificationEvent.id,
        guardianName: qrCode.guardianName,
        guardianPhone: qrCode.guardianPhone,
        requestedStudentIds: qrCode.requestedStudentIds,
        checkedInAt: new Date(),
        checkedInById: request.jwtUser.id,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: qrCode.reunificationEvent.siteId,
        userId: request.jwtUser.id,
        action: 'REUNIFICATION_QR_SCANNED',
        entity: 'ReunificationQRCode',
        entityId: qrCode.id,
        details: { guardianName: qrCode.guardianName, checkInId: checkIn.id },
        ipAddress: request.ip,
      },
    });

    return {
      valid: true,
      guardian: {
        name: qrCode.guardianName,
        phone: qrCode.guardianPhone,
        email: qrCode.guardianEmail,
      },
      students,
      checkIn,
    };
  });

  // ── List QR codes for an event ────────────────────────────────────────
  fastify.get<{
    Params: { eventId: string };
    Querystring: { isUsed?: string };
  }>('/:eventId/qr-codes', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: { id: request.params.eventId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!event) return reply.code(404).send({ error: 'Reunification event not found' });

    const where: any = { reunificationEventId: event.id };
    if (request.query.isUsed !== undefined) where.isUsed = request.query.isUsed === 'true';

    return fastify.prisma.reunificationQRCode.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
    });
  });

  // ── Staging area assignments ──────────────────────────────────────────

  fastify.get<{
    Params: { eventId: string };
  }>('/:eventId/staging', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: { id: request.params.eventId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!event) return reply.code(404).send({ error: 'Reunification event not found' });

    return fastify.prisma.reunificationStagingAssignment.findMany({
      where: { reunificationEventId: event.id },
      include: {
        stagingArea: true,
      },
      orderBy: { gradeLevel: 'asc' },
    });
  });

  fastify.post<{
    Params: { eventId: string };
    Body: {
      stagingAreaId: string;
      gradeLevel?: string;
      buildingId?: string;
      staffAssignedIds?: string[];
    };
  }>('/:eventId/staging', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: { id: request.params.eventId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!event) return reply.code(404).send({ error: 'Reunification event not found' });

    const { stagingAreaId, gradeLevel, buildingId, staffAssignedIds } = request.body;

    // Count students for this grade/building assignment
    const studentWhere: any = { siteId: event.siteId, isActive: true };
    if (gradeLevel) studentWhere.grade = gradeLevel;
    if (buildingId) studentWhere.buildingId = buildingId;
    const studentCount = await fastify.prisma.student.count({ where: studentWhere });

    const assignment = await fastify.prisma.reunificationStagingAssignment.create({
      data: {
        reunificationEventId: event.id,
        stagingAreaId,
        gradeLevel: gradeLevel || null,
        buildingId: buildingId || null,
        staffAssignedIds: staffAssignedIds || [],
        studentCount,
      },
      include: { stagingArea: true },
    });

    return reply.code(201).send(assignment);
  });

  fastify.patch<{
    Params: { eventId: string; assignmentId: string };
    Body: { status?: string; staffAssignedIds?: string[]; studentCount?: number };
  }>('/:eventId/staging/:assignmentId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const assignment = await fastify.prisma.reunificationStagingAssignment.findFirst({
      where: { id: request.params.assignmentId },
      include: { reunificationEvent: true },
    });
    if (!assignment || !request.jwtUser.siteIds.includes(assignment.reunificationEvent.siteId)) {
      return reply.code(404).send({ error: 'Assignment not found' });
    }

    return fastify.prisma.reunificationStagingAssignment.update({
      where: { id: assignment.id },
      data: request.body,
      include: { stagingArea: true },
    });
  });
};

export default reunificationQRRoutes;
