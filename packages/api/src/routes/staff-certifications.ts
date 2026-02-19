import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const staffCertificationRoutes: FastifyPluginAsync = async (fastify) => {
  // ── List certifications ───────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId?: string; userId?: string; type?: string; status?: string; expiringSoon?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, userId, type, status, expiringSoon } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (userId) where.userId = userId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (expiringSoon === 'true') {
      const sixtyDays = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      where.expiresAt = { lte: sixtyDays, gt: new Date() };
      where.status = { not: 'EXPIRED' };
    }

    return fastify.prisma.staffCertification.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: [{ expiresAt: 'asc' }],
    });
  });

  // ── Create certification ──────────────────────────────────────────────
  fastify.post<{
    Body: {
      siteId: string;
      userId: string;
      type: string;
      certName: string;
      issuedBy?: string;
      certNumber?: string;
      issuedAt?: string;
      expiresAt?: string;
      certificateUrl?: string;
      renewalUrl?: string;
      notes?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, userId, certName, issuedAt, expiresAt, notes, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const cert = await fastify.prisma.staffCertification.create({
      data: {
        siteId,
        userId,
        certName: sanitizeText(certName),
        issuedAt: issuedAt ? new Date(issuedAt) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        notes: notes ? sanitizeText(notes) : null,
        type: rest.type as any,
        issuedBy: rest.issuedBy || null,
        certNumber: rest.certNumber || null,
        certificateUrl: rest.certificateUrl || null,
        renewalUrl: rest.renewalUrl || null,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'STAFF_CERT_CREATED',
        entity: 'StaffCertification',
        entityId: cert.id,
        details: { certUserId: userId, type: rest.type, certName },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(cert);
  });

  // ── Update certification ──────────────────────────────────────────────
  fastify.patch<{
    Params: { certId: string };
    Body: {
      status?: string;
      expiresAt?: string;
      certificateUrl?: string;
      verified?: boolean;
      notes?: string;
    };
  }>('/:certId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const cert = await fastify.prisma.staffCertification.findFirst({
      where: { id: request.params.certId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!cert) return reply.code(404).send({ error: 'Certification not found' });

    const { expiresAt, notes, status, verified, ...data } = request.body;
    const updateData: any = { ...data };
    if (status) updateData.status = status as any;
    if (expiresAt) updateData.expiresAt = new Date(expiresAt);
    if (notes) updateData.notes = sanitizeText(notes);
    if (verified !== undefined) {
      updateData.verified = verified;
      if (verified) {
        updateData.verifiedById = request.jwtUser.id;
        updateData.verifiedAt = new Date();
      }
    }

    return fastify.prisma.staffCertification.update({
      where: { id: cert.id },
      data: updateData,
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  });

  // ── Verify certification ──────────────────────────────────────────────
  fastify.post<{
    Params: { certId: string };
  }>('/:certId/verify', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const cert = await fastify.prisma.staffCertification.findFirst({
      where: { id: request.params.certId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!cert) return reply.code(404).send({ error: 'Certification not found' });

    return fastify.prisma.staffCertification.update({
      where: { id: cert.id },
      data: {
        verified: true,
        verifiedById: request.jwtUser.id,
        verifiedAt: new Date(),
        status: 'ACTIVE',
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  });

  // ── Staff certification profile (all certs for one user) ──────────────
  fastify.get<{
    Params: { userId: string };
  }>('/user/:userId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const certs = await fastify.prisma.staffCertification.findMany({
      where: { userId: request.params.userId, siteId: { in: request.jwtUser.siteIds } },
      orderBy: [{ type: 'asc' }, { expiresAt: 'asc' }],
    });

    const now = new Date();
    return {
      certifications: certs,
      summary: {
        total: certs.length,
        active: certs.filter((c) => c.status === 'ACTIVE').length,
        expiringSoon: certs.filter((c) => c.status === 'EXPIRING_SOON').length,
        expired: certs.filter((c) => c.status === 'EXPIRED' || (c.expiresAt && c.expiresAt < now)).length,
        pending: certs.filter((c) => c.status === 'PENDING_VERIFICATION').length,
      },
    };
  });

  // ── Requirements CRUD ─────────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/requirements', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    return fastify.prisma.certRequirement.findMany({
      where: { siteId },
      orderBy: { type: 'asc' },
    });
  });

  fastify.put<{
    Body: {
      siteId: string;
      type: string;
      requiredForRoles: string[];
      renewalMonths?: number;
      reminderDaysBefore?: number;
      isRequired?: boolean;
      description?: string;
    };
  }>('/requirements', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, type, description, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const req = await fastify.prisma.certRequirement.upsert({
      where: { siteId_type: { siteId, type: type as any } },
      create: {
        siteId,
        type: type as any,
        description: description ? sanitizeText(description) : null,
        ...rest,
      },
      update: {
        description: description ? sanitizeText(description) : undefined,
        ...rest,
      },
    });

    return req;
  });

  // ── Compliance dashboard ──────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/dashboard', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const now = new Date();
    const sixtyDays = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    // Get all requirements for this site
    const requirements = await fastify.prisma.certRequirement.findMany({ where: { siteId, isRequired: true } });

    // Get all staff at this site
    const siteUsers = await fastify.prisma.userSite.findMany({
      where: { siteId },
      include: { user: { select: { id: true, name: true, role: true } } },
    });

    // Get all certs at this site
    const allCerts = await fastify.prisma.staffCertification.findMany({ where: { siteId } });

    // Calculate compliance per requirement
    const complianceByType = requirements.map((req) => {
      const eligibleStaff = siteUsers.filter((su) =>
        req.requiredForRoles.length === 0 || req.requiredForRoles.includes(su.user.role)
      );
      const certsOfType = allCerts.filter((c) => c.type === req.type && c.status === 'ACTIVE');
      const compliantUserIds = new Set(certsOfType.map((c) => c.userId));
      const compliant = eligibleStaff.filter((su) => compliantUserIds.has(su.user.id)).length;

      return {
        type: req.type,
        required: eligibleStaff.length,
        compliant,
        nonCompliant: eligibleStaff.length - compliant,
        complianceRate: eligibleStaff.length > 0 ? Math.round((compliant / eligibleStaff.length) * 100) : 100,
      };
    });

    const [expiringSoon, expired, pendingVerification] = await Promise.all([
      fastify.prisma.staffCertification.count({ where: { siteId, expiresAt: { lte: sixtyDays, gt: now } } }),
      fastify.prisma.staffCertification.count({ where: { siteId, OR: [{ status: 'EXPIRED' }, { expiresAt: { lte: now } }] } }),
      fastify.prisma.staffCertification.count({ where: { siteId, status: 'PENDING_VERIFICATION' } }),
    ]);

    return {
      complianceByType,
      expiringSoon,
      expired,
      pendingVerification,
      overallRate: complianceByType.length > 0
        ? Math.round(complianceByType.reduce((sum, c) => sum + c.complianceRate, 0) / complianceByType.length)
        : 100,
    };
  });

  // ── Check expirations & send reminders (scheduler endpoint) ───────────
  fastify.post<{
    Body: { siteId: string };
  }>('/check-expirations', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const now = new Date();
    const requirements = await fastify.prisma.certRequirement.findMany({ where: { siteId, isRequired: true } });
    let updated = 0;

    for (const req of requirements) {
      const reminderDate = new Date(now.getTime() + req.reminderDaysBefore * 24 * 60 * 60 * 1000);

      // Mark certs as EXPIRING_SOON
      const expiringSoon = await fastify.prisma.staffCertification.updateMany({
        where: {
          siteId,
          type: req.type,
          status: 'ACTIVE',
          expiresAt: { lte: reminderDate, gt: now },
          reminderSentAt: null,
        },
        data: { status: 'EXPIRING_SOON', reminderSentAt: now },
      });
      updated += expiringSoon.count;

      // Mark certs as EXPIRED
      const expired = await fastify.prisma.staffCertification.updateMany({
        where: {
          siteId,
          type: req.type,
          status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
          expiresAt: { lte: now },
        },
        data: { status: 'EXPIRED' },
      });
      updated += expired.count;
    }

    return { processed: true, updatedCertifications: updated };
  });
};

export default staffCertificationRoutes;
