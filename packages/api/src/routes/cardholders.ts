import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const cardholderRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /cardholders — List cardholders (OPERATOR+)
  fastify.get<{
    Querystring: { siteId?: string; personType?: string; isActive?: string; search?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { personType, isActive, search } = request.query;
    const siteId = request.query.siteId || request.jwtUser.siteIds[0];

    const where: any = { siteId };
    if (personType) where.personType = personType;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    const cardholders = await fastify.prisma.cardholder.findMany({
      where,
      include: {
        credentials: {
          where: { status: { not: 'REVOKED' } },
          include: { zones: { include: { zone: true } } },
        },
      },
      orderBy: { lastName: 'asc' },
    });
    return cardholders;
  });

  // GET /cardholders/:id — Detail with credentials (OPERATOR+)
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const cardholder = await fastify.prisma.cardholder.findUnique({
      where: { id: request.params.id },
      include: {
        credentials: {
          include: { zones: { include: { zone: true } } },
          orderBy: { issuedAt: 'desc' },
        },
        user: { select: { id: true, name: true, email: true, role: true } },
        visitor: { select: { id: true, firstName: true, lastName: true, status: true } },
      },
    });

    if (!cardholder) {
      return reply.code(404).send({ error: 'Cardholder not found' });
    }
    return cardholder;
  });

  // POST /cardholders — Create cardholder (OPERATOR+)
  fastify.post<{
    Body: {
      siteId?: string;
      personType: string;
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      company?: string;
      title?: string;
      userId?: string;
      visitorId?: string;
      notes?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.body.siteId || request.jwtUser.siteIds[0];
    const { personType, firstName, lastName, email, phone, company, title, userId, visitorId, notes } = request.body;

    if (!personType || !firstName || !lastName) {
      return reply.code(400).send({ error: 'personType, firstName, and lastName are required' });
    }

    const cardholder = await fastify.prisma.cardholder.create({
      data: {
        siteId,
        personType: personType as any,
        firstName: sanitizeText(firstName),
        lastName: sanitizeText(lastName),
        email: email ? sanitizeText(email) : undefined,
        phone: phone ? sanitizeText(phone) : undefined,
        company: company ? sanitizeText(company) : undefined,
        title: title ? sanitizeText(title) : undefined,
        userId,
        visitorId,
        notes: notes ? sanitizeText(notes) : undefined,
      },
      include: { credentials: true },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'CARDHOLDER_CREATED',
        entity: 'Cardholder',
        entityId: cardholder.id,
        details: { personType, name: `${firstName} ${lastName}` },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(cardholder);
  });

  // PUT /cardholders/:id — Update cardholder (OPERATOR+)
  fastify.put<{
    Params: { id: string };
    Body: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      company?: string;
      title?: string;
      isActive?: boolean;
      notes?: string;
    };
  }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const existing = await fastify.prisma.cardholder.findUnique({ where: { id: request.params.id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Cardholder not found' });
    }

    const data: any = {};
    if (request.body.firstName !== undefined) data.firstName = sanitizeText(request.body.firstName);
    if (request.body.lastName !== undefined) data.lastName = sanitizeText(request.body.lastName);
    if (request.body.email !== undefined) data.email = sanitizeText(request.body.email);
    if (request.body.phone !== undefined) data.phone = sanitizeText(request.body.phone);
    if (request.body.company !== undefined) data.company = sanitizeText(request.body.company);
    if (request.body.title !== undefined) data.title = sanitizeText(request.body.title);
    if (request.body.isActive !== undefined) data.isActive = request.body.isActive;
    if (request.body.notes !== undefined) data.notes = sanitizeText(request.body.notes);

    const updated = await fastify.prisma.cardholder.update({
      where: { id: request.params.id },
      data,
      include: { credentials: true },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'CARDHOLDER_UPDATED',
        entity: 'Cardholder',
        entityId: existing.id,
        details: data,
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // POST /cardholders/:id/credentials — Provision credential (OPERATOR+)
  fastify.post<{
    Params: { id: string };
    Body: {
      credentialType: string;
      cardNumber?: string;
      facilityCode?: string;
      zoneIds?: string[];
      expiresAt?: string;
    };
  }>('/:id/credentials', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const cardholder = await fastify.prisma.cardholder.findUnique({ where: { id: request.params.id } });
    if (!cardholder) {
      return reply.code(404).send({ error: 'Cardholder not found' });
    }

    const { credentialType, cardNumber, facilityCode, zoneIds, expiresAt } = request.body;
    if (!credentialType) {
      return reply.code(400).send({ error: 'credentialType is required' });
    }

    const credential = await fastify.prisma.cardholderCredential.create({
      data: {
        cardholderId: cardholder.id,
        credentialType: credentialType as any,
        cardNumber: cardNumber ? sanitizeText(cardNumber) : undefined,
        facilityCode: facilityCode ? sanitizeText(facilityCode) : undefined,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        zones: zoneIds && zoneIds.length > 0
          ? { create: zoneIds.map((zoneId) => ({ zoneId })) }
          : undefined,
      },
      include: { zones: { include: { zone: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: cardholder.siteId,
        userId: request.jwtUser.id,
        action: 'CREDENTIAL_PROVISIONED',
        entity: 'CardholderCredential',
        entityId: credential.id,
        details: { cardholderId: cardholder.id, credentialType, cardNumber },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(credential);
  });

  // DELETE /cardholders/:id/credentials/:credId — Revoke credential (OPERATOR+)
  fastify.delete<{
    Params: { id: string; credId: string };
    Body: { reason?: string };
  }>('/:id/credentials/:credId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const credential = await fastify.prisma.cardholderCredential.findUnique({
      where: { id: request.params.credId },
    });

    if (!credential || credential.cardholderId !== request.params.id) {
      return reply.code(404).send({ error: 'Credential not found' });
    }

    if (credential.status === 'REVOKED') {
      return reply.code(400).send({ error: 'Credential already revoked' });
    }

    const reason = request.body?.reason ? sanitizeText(request.body.reason) : 'Manual revocation';

    const updated = await fastify.prisma.cardholderCredential.update({
      where: { id: credential.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });

    const cardholder = await fastify.prisma.cardholder.findUnique({ where: { id: request.params.id } });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: cardholder?.siteId || request.jwtUser.siteIds[0],
        userId: request.jwtUser.id,
        action: 'CREDENTIAL_REVOKED',
        entity: 'CardholderCredential',
        entityId: credential.id,
        details: { cardholderId: request.params.id, reason },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // GET /cardholders/zones — List access zones for site (OPERATOR+)
  fastify.get<{
    Querystring: { siteId?: string };
  }>('/zones', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.query.siteId || request.jwtUser.siteIds[0];

    const zones = await fastify.prisma.accessZone.findMany({
      where: { siteId },
      include: {
        doorAssignments: { include: { door: { select: { id: true, name: true } } } },
        _count: { select: { doorAssignments: true, credentials: true } },
      },
      orderBy: { name: 'asc' },
    });
    return zones;
  });

  // POST /cardholders/zones — Create access zone (SITE_ADMIN+)
  fastify.post<{
    Body: {
      siteId?: string;
      name: string;
      description?: string;
      doorIds?: string[];
    };
  }>('/zones', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const siteId = request.body.siteId || request.jwtUser.siteIds[0];
    const { name, description, doorIds } = request.body;

    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }

    const zone = await fastify.prisma.accessZone.create({
      data: {
        siteId,
        name: sanitizeText(name),
        description: description ? sanitizeText(description) : undefined,
        doorAssignments: doorIds && doorIds.length > 0
          ? { create: doorIds.map((doorId) => ({ doorId })) }
          : undefined,
      },
      include: {
        doorAssignments: { include: { door: { select: { id: true, name: true } } } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'ACCESS_ZONE_CREATED',
        entity: 'AccessZone',
        entityId: zone.id,
        details: { name, doorCount: doorIds?.length || 0 },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(zone);
  });

  // POST /cardholders/import — Import cardholders from AC system (SITE_ADMIN+)
  fastify.post<{
    Body: { siteId?: string };
  }>('/import', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    return reply.code(501).send({
      error: 'Cardholder import not yet implemented for the current access control adapter',
      message: 'This feature requires a connected access control system that supports credential management (e.g., Sicunet).',
    });
  });
};

export default cardholderRoutes;
