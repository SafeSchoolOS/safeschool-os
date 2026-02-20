import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Substitute & Contractor Tracking routes — daily access passes,
 * training verification, auto-expiring credentials, and reporting.
 */
const substituteTrackingRoutes: FastifyPluginAsync = async (fastify) => {
  // ===========================================================================
  // Daily Access Passes
  // ===========================================================================

  // GET /api/v1/substitute-tracking/passes — list access passes
  fastify.get<{
    Querystring: {
      status?: string;
      passType?: string;
      date?: string;
    };
  }>('/passes', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { status, passType, date } = request.query;

    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (status) where.status = status;
    if (passType) where.passType = passType;

    // Filter by specific date (show passes valid on that date)
    if (date) {
      const targetDate = new Date(date);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);
      where.validFrom = { lte: nextDay };
      where.validUntil = { gte: targetDate };
    }

    return fastify.prisma.dailyAccessPass.findMany({
      where,
      include: {
        trainingRecords: true,
      },
      orderBy: { validFrom: 'desc' },
      take: 100,
    });
  });

  // GET /api/v1/substitute-tracking/passes/today — today's active passes
  fastify.get('/passes/today', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    return fastify.prisma.dailyAccessPass.findMany({
      where: {
        siteId: { in: request.jwtUser.siteIds },
        validFrom: { lte: endOfDay },
        validUntil: { gte: startOfDay },
        status: { in: ['APPROVED', 'ACTIVE'] },
      },
      include: {
        trainingRecords: { where: { verified: true } },
      },
      orderBy: { checkedInAt: 'desc' },
    });
  });

  // POST /api/v1/substitute-tracking/passes — create access pass
  fastify.post<{
    Body: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      companyName?: string;
      passType: string;
      purpose: string;
      hostUserId?: string;
      assignedZoneIds?: string[];
      assignedRoomIds?: string[];
      validFrom: string;
      validUntil: string;
      notes?: string;
      emergencyContact?: string;
      emergencyPhone?: string;
    };
  }>('/passes', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const body = request.body;

    if (!body.firstName || !body.lastName || !body.passType || !body.purpose || !body.validFrom || !body.validUntil) {
      return reply.code(400).send({ error: 'firstName, lastName, passType, purpose, validFrom, and validUntil are required' });
    }

    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) {
      return reply.code(403).send({ error: 'No site access' });
    }

    const pass = await fastify.prisma.dailyAccessPass.create({
      data: {
        siteId,
        firstName: sanitizeText(body.firstName),
        lastName: sanitizeText(body.lastName),
        email: body.email,
        phone: body.phone,
        companyName: sanitizeText(body.companyName),
        passType: body.passType as any,
        purpose: sanitizeText(body.purpose),
        hostUserId: body.hostUserId,
        assignedZoneIds: body.assignedZoneIds || [],
        assignedRoomIds: body.assignedRoomIds || [],
        validFrom: new Date(body.validFrom),
        validUntil: new Date(body.validUntil),
        notes: sanitizeText(body.notes),
        emergencyContact: sanitizeText(body.emergencyContact),
        emergencyPhone: body.emergencyPhone,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'ACCESS_PASS_CREATED',
        entity: 'DailyAccessPass',
        entityId: pass.id,
        details: { passType: body.passType, name: `${body.firstName} ${body.lastName}` },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(pass);
  });

  // GET /api/v1/substitute-tracking/passes/:id — pass detail
  fastify.get<{
    Params: { id: string };
  }>('/passes/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const pass = await fastify.prisma.dailyAccessPass.findFirst({
      where: { id: request.params.id, siteId: { in: request.jwtUser.siteIds } },
      include: { trainingRecords: true },
    });

    if (!pass) {
      return reply.code(404).send({ error: 'Access pass not found' });
    }

    return pass;
  });

  // PATCH /api/v1/substitute-tracking/passes/:id — update access pass
  fastify.patch<{
    Params: { id: string };
    Body: {
      status?: string;
      assignedZoneIds?: string[];
      assignedRoomIds?: string[];
      validUntil?: string;
      idVerified?: boolean;
      backgroundCheck?: string;
      trainingVerified?: boolean;
      notes?: string;
    };
  }>('/passes/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const body = request.body;

    const existing = await fastify.prisma.dailyAccessPass.findFirst({
      where: { id: request.params.id, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Access pass not found' });
    }

    const data: any = {};
    if (body.status) data.status = body.status;
    if (body.assignedZoneIds) data.assignedZoneIds = body.assignedZoneIds;
    if (body.assignedRoomIds) data.assignedRoomIds = body.assignedRoomIds;
    if (body.validUntil) data.validUntil = new Date(body.validUntil);
    if (body.idVerified !== undefined) data.idVerified = body.idVerified;
    if (body.backgroundCheck) data.backgroundCheck = body.backgroundCheck;
    if (body.trainingVerified !== undefined) data.trainingVerified = body.trainingVerified;
    if (body.notes !== undefined) data.notes = sanitizeText(body.notes);

    const updated = await fastify.prisma.dailyAccessPass.update({
      where: { id: request.params.id },
      data,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'ACCESS_PASS_UPDATED',
        entity: 'DailyAccessPass',
        entityId: existing.id,
        details: { status: body.status },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // POST /api/v1/substitute-tracking/passes/:id/checkin — check in
  fastify.post<{
    Params: { id: string };
  }>('/passes/:id/checkin', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const existing = await fastify.prisma.dailyAccessPass.findFirst({
      where: { id: request.params.id, siteId: { in: request.jwtUser.siteIds } },
      include: { trainingRecords: true },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Access pass not found' });
    }

    if (existing.status !== 'APPROVED' && existing.status !== 'PENDING') {
      return reply.code(400).send({ error: `Cannot check in pass with status: ${existing.status}` });
    }

    // Check if pass is within valid date range
    const now = new Date();
    if (now < existing.validFrom || now > existing.validUntil) {
      return reply.code(400).send({ error: 'Access pass is outside its valid date range' });
    }

    // Check for required training
    const requiredTrainings = existing.trainingRecords.filter((t) => !t.verified);
    if (requiredTrainings.length > 0 && !existing.trainingVerified) {
      return reply.code(400).send({
        error: 'Required training has not been verified',
        unverifiedTrainings: requiredTrainings.map((t) => t.trainingType),
      });
    }

    // Check for flagged background check
    if (existing.backgroundCheck === 'FLAGGED') {
      return reply.code(400).send({ error: 'Background check flagged — contact administration' });
    }

    const updated = await fastify.prisma.dailyAccessPass.update({
      where: { id: request.params.id },
      data: {
        status: 'ACTIVE',
        checkedInAt: now,
      },
    });

    // Auto-provision temporary credential via access control system
    // (This would integrate with the existing cardholder/credential system)
    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'ACCESS_PASS_CHECKIN',
        entity: 'DailyAccessPass',
        entityId: existing.id,
        details: { passType: existing.passType, name: `${existing.firstName} ${existing.lastName}` },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // POST /api/v1/substitute-tracking/passes/:id/checkout — check out
  fastify.post<{
    Params: { id: string };
  }>('/passes/:id/checkout', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const existing = await fastify.prisma.dailyAccessPass.findFirst({
      where: { id: request.params.id, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Access pass not found' });
    }

    if (existing.status !== 'ACTIVE') {
      return reply.code(400).send({ error: `Cannot check out pass with status: ${existing.status}` });
    }

    const updated = await fastify.prisma.dailyAccessPass.update({
      where: { id: request.params.id },
      data: {
        status: 'EXPIRED',
        checkedOutAt: new Date(),
      },
    });

    // If a credential was provisioned, revoke it
    if (existing.credentialId) {
      await fastify.prisma.cardholderCredential.update({
        where: { id: existing.credentialId },
        data: { status: 'REVOKED' },
      });
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'ACCESS_PASS_CHECKOUT',
        entity: 'DailyAccessPass',
        entityId: existing.id,
        details: { passType: existing.passType, name: `${existing.firstName} ${existing.lastName}` },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // POST /api/v1/substitute-tracking/passes/:id/revoke — revoke access
  fastify.post<{
    Params: { id: string };
    Body: { reason?: string };
  }>('/passes/:id/revoke', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const existing = await fastify.prisma.dailyAccessPass.findFirst({
      where: { id: request.params.id, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Access pass not found' });
    }

    const updated = await fastify.prisma.dailyAccessPass.update({
      where: { id: request.params.id },
      data: {
        status: 'REVOKED',
        checkedOutAt: new Date(),
        notes: request.body.reason
          ? `${existing.notes || ''}\n[REVOKED] ${sanitizeText(request.body.reason)}`.trim()
          : existing.notes,
      },
    });

    // Revoke any active credential
    if (existing.credentialId) {
      await fastify.prisma.cardholderCredential.update({
        where: { id: existing.credentialId },
        data: { status: 'REVOKED' },
      });
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'ACCESS_PASS_REVOKED',
        entity: 'DailyAccessPass',
        entityId: existing.id,
        details: { reason: request.body.reason, passType: existing.passType },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // POST /api/v1/substitute-tracking/expire-stale — expire stale passes (cron endpoint)
  fastify.post('/expire-stale', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request) => {
    const now = new Date();

    // Find all passes that are APPROVED or ACTIVE but past their validUntil
    const stalePasses = await fastify.prisma.dailyAccessPass.findMany({
      where: {
        siteId: { in: request.jwtUser.siteIds },
        status: { in: ['APPROVED', 'ACTIVE'] },
        validUntil: { lt: now },
      },
    });

    let expired = 0;
    let credentialsRevoked = 0;

    for (const pass of stalePasses) {
      await fastify.prisma.dailyAccessPass.update({
        where: { id: pass.id },
        data: {
          status: 'EXPIRED',
          checkedOutAt: pass.status === 'ACTIVE' ? now : undefined,
        },
      });

      // Revoke any active credential
      if (pass.credentialId) {
        await fastify.prisma.cardholderCredential.update({
          where: { id: pass.credentialId },
          data: { status: 'REVOKED' },
        });
        credentialsRevoked += 1;
      }

      expired += 1;
    }

    return { expired, credentialsRevoked, processedAt: now };
  });

  // ===========================================================================
  // Training Records
  // ===========================================================================

  // GET /api/v1/substitute-tracking/passes/:id/training — list training records
  fastify.get<{
    Params: { id: string };
  }>('/passes/:id/training', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const pass = await fastify.prisma.dailyAccessPass.findFirst({
      where: { id: request.params.id, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!pass) {
      return reply.code(404).send({ error: 'Access pass not found' });
    }

    return fastify.prisma.staffTrainingRecord.findMany({
      where: { accessPassId: pass.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  // POST /api/v1/substitute-tracking/passes/:id/training — add training record
  fastify.post<{
    Params: { id: string };
    Body: {
      trainingType: string;
      completedAt?: string;
      expiresAt?: string;
      certificateUrl?: string;
    };
  }>('/passes/:id/training', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const body = request.body;

    if (!body.trainingType) {
      return reply.code(400).send({ error: 'trainingType is required' });
    }

    const pass = await fastify.prisma.dailyAccessPass.findFirst({
      where: { id: request.params.id, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!pass) {
      return reply.code(404).send({ error: 'Access pass not found' });
    }

    const record = await fastify.prisma.staffTrainingRecord.create({
      data: {
        siteId: pass.siteId,
        accessPassId: pass.id,
        personName: `${pass.firstName} ${pass.lastName}`,
        personEmail: pass.email,
        trainingType: body.trainingType as any,
        completedAt: body.completedAt ? new Date(body.completedAt) : undefined,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        certificateUrl: body.certificateUrl,
      },
    });

    return reply.code(201).send(record);
  });

  // PATCH /api/v1/substitute-tracking/training/:recordId/verify — verify training
  fastify.patch<{
    Params: { recordId: string };
  }>('/training/:recordId/verify', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const record = await fastify.prisma.staffTrainingRecord.findUnique({
      where: { id: request.params.recordId },
    });

    if (!record) {
      return reply.code(404).send({ error: 'Training record not found' });
    }

    const updated = await fastify.prisma.staffTrainingRecord.update({
      where: { id: request.params.recordId },
      data: {
        verified: true,
        verifiedById: request.jwtUser.id,
        verifiedAt: new Date(),
      },
    });

    // Check if all training for this pass is now verified
    if (record.accessPassId) {
      const allRecords = await fastify.prisma.staffTrainingRecord.findMany({
        where: { accessPassId: record.accessPassId },
      });

      const allVerified = allRecords.every((r) => r.id === record.id ? true : r.verified);
      if (allVerified) {
        await fastify.prisma.dailyAccessPass.update({
          where: { id: record.accessPassId },
          data: { trainingVerified: true },
        });
      }
    }

    return updated;
  });

  // ===========================================================================
  // Reporting & Analytics
  // ===========================================================================

  // GET /api/v1/substitute-tracking/analytics — substitute/contractor analytics
  fastify.get<{
    Querystring: { startDate?: string; endDate?: string };
  }>('/analytics', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { startDate, endDate } = request.query;
    const siteIds = request.jwtUser.siteIds;

    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const where: any = { siteId: { in: siteIds } };
    if (startDate || endDate) where.createdAt = dateFilter;

    const [passes, byType, byStatus] = await Promise.all([
      fastify.prisma.dailyAccessPass.findMany({ where, select: { passType: true, status: true, checkedInAt: true, checkedOutAt: true, trainingVerified: true, backgroundCheck: true } }),
      fastify.prisma.dailyAccessPass.groupBy({ by: ['passType'], where, _count: true }),
      fastify.prisma.dailyAccessPass.groupBy({ by: ['status'], where, _count: true }),
    ]);

    // Training compliance
    const withTraining = passes.filter((p) => p.trainingVerified).length;
    const trainingComplianceRate = passes.length > 0
      ? Math.round((withTraining / passes.length) * 100)
      : 0;

    // Average visit duration for checked-out passes
    const completedVisits = passes.filter((p) => p.checkedInAt && p.checkedOutAt);
    const avgDurationMin = completedVisits.length > 0
      ? Math.round(completedVisits.reduce((sum, p) => {
          return sum + (p.checkedOutAt!.getTime() - p.checkedInAt!.getTime()) / 60000;
        }, 0) / completedVisits.length)
      : null;

    // Background check stats
    const bgChecks = {
      clear: passes.filter((p) => p.backgroundCheck === 'CLEAR').length,
      pending: passes.filter((p) => p.backgroundCheck === 'PENDING').length,
      flagged: passes.filter((p) => p.backgroundCheck === 'FLAGGED').length,
      notChecked: passes.filter((p) => !p.backgroundCheck).length,
    };

    return {
      totalPasses: passes.length,
      byType: Object.fromEntries(byType.map((t) => [t.passType, t._count])),
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      trainingCompliance: {
        verified: withTraining,
        total: passes.length,
        rate: trainingComplianceRate,
      },
      averageVisitDurationMin: avgDurationMin,
      backgroundChecks: bgChecks,
    };
  });

  // GET /api/v1/substitute-tracking/required-trainings — list required trainings by pass type
  fastify.get('/required-trainings', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async () => {
    // Default required trainings by pass type — configurable per site
    return {
      SUBSTITUTE_TEACHER: [
        'SAFETY_ORIENTATION',
        'EMERGENCY_PROCEDURES',
        'MANDATED_REPORTER',
        'STUDENT_SUPERVISION',
      ],
      CONTRACTOR: [
        'SAFETY_ORIENTATION',
        'BUILDING_SPECIFIC',
      ],
      MAINTENANCE: [
        'SAFETY_ORIENTATION',
        'BUILDING_SPECIFIC',
        'HAZMAT',
      ],
      VOLUNTEER: [
        'SAFETY_ORIENTATION',
        'MANDATED_REPORTER',
      ],
      DELIVERY: [
        'SAFETY_ORIENTATION',
      ],
      TEMPORARY_STAFF: [
        'SAFETY_ORIENTATION',
        'EMERGENCY_PROCEDURES',
      ],
    };
  });
};

export default substituteTrackingRoutes;
