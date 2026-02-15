import type { FastifyPluginAsync } from 'fastify';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';
import { createBadgePrinter } from '@safeschool/badge-printing';

const STUDENT_PHOTO_DIR = process.env.STUDENT_PHOTO_DIR || '/app/data/students';
mkdirSync(STUDENT_PHOTO_DIR, { recursive: true });

const ALLOWED_PHOTO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const studentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/students — list with search, filter by grade/building/room/isActive
  fastify.get('/', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request) => {
    const { search, grade, buildingId, roomId, isActive, siteId } = request.query as Record<string, string | undefined>;
    const userSiteId = siteId || request.jwtUser.siteIds[0];

    const where: any = { siteId: userSiteId };

    if (grade) where.grade = grade;
    if (buildingId) where.buildingId = buildingId;
    if (roomId) where.roomId = roomId;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { studentNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const students = await fastify.prisma.student.findMany({
      where,
      include: {
        building: { select: { id: true, name: true } },
        room: { select: { id: true, name: true, number: true } },
        _count: { select: { transportCards: true, parentContacts: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return students;
  });

  // GET /api/v1/students/:id — detail with transport cards and parent contacts
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const student = await fastify.prisma.student.findUnique({
      where: { id: request.params.id },
      include: {
        building: { select: { id: true, name: true } },
        room: { select: { id: true, name: true, number: true } },
        transportCards: true,
        parentContacts: true,
      },
    });

    if (!student) return reply.code(404).send({ error: 'Student not found' });
    return student;
  });

  // POST /api/v1/students — create
  fastify.post('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const body = request.body as any;
    const siteId = body.siteId || request.jwtUser.siteIds[0];

    const student = await fastify.prisma.student.create({
      data: {
        siteId,
        firstName: sanitizeText(body.firstName),
        lastName: sanitizeText(body.lastName),
        studentNumber: sanitizeText(body.studentNumber),
        grade: body.grade ? sanitizeText(body.grade) : null,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        buildingId: body.buildingId || null,
        roomId: body.roomId || null,
        enrollmentDate: body.enrollmentDate ? new Date(body.enrollmentDate) : null,
        medicalNotes: body.medicalNotes ? sanitizeText(body.medicalNotes) : null,
        allergies: body.allergies ? sanitizeText(body.allergies) : null,
        notes: body.notes ? sanitizeText(body.notes) : null,
        externalId: body.externalId || null,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'CREATE',
        entity: 'Student',
        entityId: student.id,
        details: { firstName: student.firstName, lastName: student.lastName, studentNumber: student.studentNumber },
      },
    });

    return reply.code(201).send(student);
  });

  // PUT /api/v1/students/:id — update
  fastify.put<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const existing = await fastify.prisma.student.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.code(404).send({ error: 'Student not found' });

    const body = request.body as any;
    const data: any = {};

    if (body.firstName !== undefined) data.firstName = sanitizeText(body.firstName);
    if (body.lastName !== undefined) data.lastName = sanitizeText(body.lastName);
    if (body.studentNumber !== undefined) data.studentNumber = sanitizeText(body.studentNumber);
    if (body.grade !== undefined) data.grade = body.grade ? sanitizeText(body.grade) : null;
    if (body.dateOfBirth !== undefined) data.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
    if (body.buildingId !== undefined) data.buildingId = body.buildingId || null;
    if (body.roomId !== undefined) data.roomId = body.roomId || null;
    if (body.enrollmentDate !== undefined) data.enrollmentDate = body.enrollmentDate ? new Date(body.enrollmentDate) : null;
    if (body.withdrawalDate !== undefined) data.withdrawalDate = body.withdrawalDate ? new Date(body.withdrawalDate) : null;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.medicalNotes !== undefined) data.medicalNotes = body.medicalNotes ? sanitizeText(body.medicalNotes) : null;
    if (body.allergies !== undefined) data.allergies = body.allergies ? sanitizeText(body.allergies) : null;
    if (body.notes !== undefined) data.notes = body.notes ? sanitizeText(body.notes) : null;
    if (body.externalId !== undefined) data.externalId = body.externalId || null;

    const student = await fastify.prisma.student.update({
      where: { id: request.params.id },
      data,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'UPDATE',
        entity: 'Student',
        entityId: student.id,
        details: data,
      },
    });

    return student;
  });

  // POST /api/v1/students/:id/photo — upload photo (multipart)
  fastify.post<{ Params: { id: string } }>(
    '/:id/photo',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const student = await fastify.prisma.student.findUnique({ where: { id: request.params.id } });
      if (!student) return reply.code(404).send({ error: 'Student not found' });

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'No file uploaded' });

      const ext = ALLOWED_PHOTO_TYPES[file.mimetype];
      if (!ext) {
        return reply.code(400).send({ error: 'Invalid file type. Allowed: PNG, JPEG, WebP' });
      }

      const buffer = await file.toBuffer();
      await mkdir(STUDENT_PHOTO_DIR, { recursive: true });
      const filename = `${request.params.id}.${ext}`;
      const filepath = path.join(STUDENT_PHOTO_DIR, filename);
      await writeFile(filepath, buffer);

      // Remove old photo if different extension
      if (student.photo && student.photo !== filename) {
        const oldPath = path.join(STUDENT_PHOTO_DIR, student.photo);
        if (existsSync(oldPath)) await unlink(oldPath);
      }

      await fastify.prisma.student.update({
        where: { id: request.params.id },
        data: { photo: filename },
      });

      await fastify.prisma.auditLog.create({
        data: {
          siteId: student.siteId,
          userId: request.jwtUser.id,
          action: 'UPLOAD_PHOTO',
          entity: 'Student',
          entityId: student.id,
        },
      });

      return { url: `/api/v1/students/${request.params.id}/photo` };
    }
  );

  // GET /api/v1/students/:id/photo — serve photo
  fastify.get<{ Params: { id: string } }>(
    '/:id/photo',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request, reply) => {
      const student = await fastify.prisma.student.findUnique({ where: { id: request.params.id } });
      if (!student || !student.photo) {
        return reply.code(404).send({ error: 'Photo not found' });
      }

      const filepath = path.join(STUDENT_PHOTO_DIR, student.photo);
      if (!existsSync(filepath)) {
        return reply.code(404).send({ error: 'Photo file not found' });
      }

      const fileBuffer = await readFile(filepath);
      const ext = path.extname(student.photo).slice(1);
      const contentTypeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
      };

      return reply
        .header('Content-Type', contentTypeMap[ext] || 'application/octet-stream')
        .header('Cache-Control', 'public, max-age=3600')
        .send(fileBuffer);
    }
  );

  // DELETE /api/v1/students/:id/photo — remove photo
  fastify.delete<{ Params: { id: string } }>(
    '/:id/photo',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const student = await fastify.prisma.student.findUnique({ where: { id: request.params.id } });
      if (!student) return reply.code(404).send({ error: 'Student not found' });

      if (student.photo) {
        const filepath = path.join(STUDENT_PHOTO_DIR, student.photo);
        if (existsSync(filepath)) await unlink(filepath);
        await fastify.prisma.student.update({
          where: { id: request.params.id },
          data: { photo: null },
        });
      }

      await fastify.prisma.auditLog.create({
        data: {
          siteId: student.siteId,
          userId: request.jwtUser.id,
          action: 'DELETE_PHOTO',
          entity: 'Student',
          entityId: student.id,
        },
      });

      return { message: 'Photo removed' };
    }
  );

  // POST /api/v1/students/:id/transport-card — create and link a StudentCard
  fastify.post<{ Params: { id: string } }>(
    '/:id/transport-card',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const student = await fastify.prisma.student.findUnique({ where: { id: request.params.id } });
      if (!student) return reply.code(404).send({ error: 'Student not found' });

      const body = request.body as any;
      const cardId = sanitizeText(body.cardId);
      if (!cardId) return reply.code(400).send({ error: 'cardId is required' });

      const card = await fastify.prisma.studentCard.create({
        data: {
          siteId: student.siteId,
          studentId: student.id,
          studentName: `${student.firstName} ${student.lastName}`,
          cardId,
          grade: student.grade,
          isActive: true,
        },
      });

      await fastify.prisma.auditLog.create({
        data: {
          siteId: student.siteId,
          userId: request.jwtUser.id,
          action: 'LINK_TRANSPORT_CARD',
          entity: 'Student',
          entityId: student.id,
          details: { cardId: card.cardId, studentCardId: card.id },
        },
      });

      return reply.code(201).send(card);
    }
  );

  // POST /api/v1/students/:id/print-id-card — print student ID card
  fastify.post<{ Params: { id: string } }>(
    '/:id/print-id-card',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const printer = createBadgePrinter();
      if (!printer) {
        return reply.code(501).send({
          error: 'Badge printing is not configured. Set BADGE_PRINTER_ENABLED=true to enable.',
        });
      }

      const student = await fastify.prisma.student.findUnique({
        where: { id: request.params.id },
        include: { site: { select: { name: true } } },
      });
      if (!student) return reply.code(404).send({ error: 'Student not found' });

      const photoUrl = student.photo ? `/api/v1/students/${student.id}/photo` : undefined;

      const result = await printer.print({
        studentName: `${student.firstName} ${student.lastName}`,
        studentNumber: student.studentNumber,
        grade: student.grade || undefined,
        photoUrl,
        schoolName: student.site.name,
      });

      await fastify.prisma.auditLog.create({
        data: {
          siteId: student.siteId,
          userId: request.jwtUser.id,
          action: 'PRINT_ID_CARD',
          entity: 'Student',
          entityId: student.id,
          details: { success: result.success, jobId: result.jobId },
        },
      });

      if (!result.success) {
        return reply.code(500).send({ error: result.error || 'Print failed' });
      }

      return { message: 'Print job submitted', jobId: result.jobId };
    }
  );
};

export default studentRoutes;
