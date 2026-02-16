import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';
import bcrypt from 'bcryptjs';

const agencyRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Verify that the requesting user has access to the given siteId.
   * Returns true if valid, sends a 403 and returns false otherwise.
   */
  function userHasSiteAccess(siteIds: string[], siteId: string): boolean {
    return siteIds.includes(siteId);
  }

  // GET /api/v1/agencies — List linked agencies for a site
  fastify.get<{
    Querystring: { siteId: string };
  }>('/', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { siteId } = request.query;

    if (!siteId) {
      return reply.code(400).send({ error: 'siteId is required' });
    }

    if (!userHasSiteAccess(request.jwtUser.siteIds, siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const links = await fastify.prisma.schoolAgencyLink.findMany({
      where: { siteId },
      include: {
        agency: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return links;
  });

  // POST /api/v1/agencies — Create an agency and link it to a site
  fastify.post<{
    Body: {
      name: string;
      type: string;
      jurisdiction?: string;
      primaryContact?: string;
      primaryPhone?: string;
      primaryEmail?: string;
      dispatchPhone?: string;
      psapId?: string;
      rapidSosOrgId?: string;
      accessLevel: string;
      siteId: string;
    };
  }>('/', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const {
      type,
      accessLevel,
      siteId,
      psapId,
      rapidSosOrgId,
    } = request.body;

    const name = sanitizeText(request.body.name);
    const jurisdiction = sanitizeText(request.body.jurisdiction);
    const primaryContact = sanitizeText(request.body.primaryContact);
    const primaryPhone = sanitizeText(request.body.primaryPhone);
    const primaryEmail = sanitizeText(request.body.primaryEmail);
    const dispatchPhone = sanitizeText(request.body.dispatchPhone);

    if (!name || !type || !accessLevel || !siteId) {
      return reply.code(400).send({ error: 'name, type, accessLevel, and siteId are required' });
    }

    if (!userHasSiteAccess(request.jwtUser.siteIds, siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const result = await fastify.prisma.$transaction(async (tx) => {
      const agency = await tx.agency.create({
        data: {
          name,
          type: type as any,
          jurisdiction: jurisdiction || null,
          primaryContact: primaryContact || null,
          primaryPhone: primaryPhone || null,
          primaryEmail: primaryEmail || null,
          dispatchPhone: dispatchPhone || null,
          psapId: psapId || null,
          rapidSosOrgId: rapidSosOrgId || null,
          status: 'ACTIVE_AGENCY',
        },
      });

      const link = await tx.schoolAgencyLink.create({
        data: {
          siteId,
          agencyId: agency.id,
          accessLevel: accessLevel as any,
          approvedBy: request.jwtUser.id,
          approvedAt: new Date(),
          status: 'ACTIVE_LINK',
        },
      });

      return { agency, link };
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'AGENCY_CREATED',
        entity: 'Agency',
        entityId: result.agency.id,
        details: { name, type, accessLevel },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(result);
  });

  // GET /api/v1/agencies/:agencyId — Agency details
  fastify.get<{
    Params: { agencyId: string };
  }>('/:agencyId', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { agencyId } = request.params;

    const agency = await fastify.prisma.agency.findUnique({
      where: { id: agencyId },
      include: {
        users: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            badgeNumber: true,
            role: true,
            permissions: true,
            status: true,
            lastLogin: true,
            createdAt: true,
          },
        },
        schoolLinks: {
          include: {
            site: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!agency) {
      return reply.code(404).send({ error: 'Agency not found' });
    }

    // Verify the user has access to at least one linked site
    const userSiteIds = request.jwtUser.siteIds;
    const linkedSiteIds = agency.schoolLinks.map((l) => l.siteId);
    const hasAccess = linkedSiteIds.some((sid) => userSiteIds.includes(sid));

    if (!hasAccess && request.jwtUser.role !== 'SUPER_ADMIN') {
      return reply.code(403).send({ error: 'No access to this agency' });
    }

    return agency;
  });

  // PUT /api/v1/agencies/:agencyId — Update the SchoolAgencyLink
  fastify.put<{
    Params: { agencyId: string };
    Body: {
      accessLevel?: string;
      status?: string;
      mouSigned?: boolean;
      expiresAt?: string;
      siteId: string;
    };
  }>('/:agencyId', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { agencyId } = request.params;
    const { accessLevel, status, mouSigned, expiresAt, siteId } = request.body;

    if (!siteId) {
      return reply.code(400).send({ error: 'siteId is required' });
    }

    if (!userHasSiteAccess(request.jwtUser.siteIds, siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const existingLink = await fastify.prisma.schoolAgencyLink.findUnique({
      where: {
        siteId_agencyId: { siteId, agencyId },
      },
    });

    if (!existingLink) {
      return reply.code(404).send({ error: 'Agency link not found for this site' });
    }

    const updateData: any = {};
    if (accessLevel !== undefined) updateData.accessLevel = accessLevel;
    if (status !== undefined) updateData.status = status;
    if (mouSigned !== undefined) updateData.mouSigned = mouSigned;
    if (expiresAt !== undefined) updateData.expiresAt = new Date(expiresAt);

    const updatedLink = await fastify.prisma.schoolAgencyLink.update({
      where: {
        siteId_agencyId: { siteId, agencyId },
      },
      data: updateData,
      include: {
        agency: true,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'AGENCY_LINK_UPDATED',
        entity: 'SchoolAgencyLink',
        entityId: existingLink.id,
        details: { agencyId, ...updateData },
        ipAddress: request.ip,
      },
    });

    return updatedLink;
  });

  // DELETE /api/v1/agencies/:agencyId — Revoke agency access (sets status to REVOKED_LINK)
  fastify.delete<{
    Params: { agencyId: string };
    Querystring: { siteId: string };
  }>('/:agencyId', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { agencyId } = request.params;
    const { siteId } = request.query;

    if (!siteId) {
      return reply.code(400).send({ error: 'siteId is required' });
    }

    if (!userHasSiteAccess(request.jwtUser.siteIds, siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const existingLink = await fastify.prisma.schoolAgencyLink.findUnique({
      where: {
        siteId_agencyId: { siteId, agencyId },
      },
    });

    if (!existingLink) {
      return reply.code(404).send({ error: 'Agency link not found for this site' });
    }

    const revokedLink = await fastify.prisma.schoolAgencyLink.update({
      where: {
        siteId_agencyId: { siteId, agencyId },
      },
      data: {
        status: 'REVOKED_LINK',
      },
      include: {
        agency: true,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'AGENCY_ACCESS_REVOKED',
        entity: 'SchoolAgencyLink',
        entityId: existingLink.id,
        details: { agencyId, agencyName: revokedLink.agency.name },
        ipAddress: request.ip,
      },
    });

    return revokedLink;
  });

  // GET /api/v1/agencies/:agencyId/users — List agency responder users
  fastify.get<{
    Params: { agencyId: string };
  }>('/:agencyId/users', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { agencyId } = request.params;

    const agency = await fastify.prisma.agency.findUnique({
      where: { id: agencyId },
      include: { schoolLinks: true },
    });

    if (!agency) {
      return reply.code(404).send({ error: 'Agency not found' });
    }

    // Verify the user has access to at least one linked site
    const linkedSiteIds = agency.schoolLinks.map((l) => l.siteId);
    const hasAccess = linkedSiteIds.some((sid) => request.jwtUser.siteIds.includes(sid));

    if (!hasAccess && request.jwtUser.role !== 'SUPER_ADMIN') {
      return reply.code(403).send({ error: 'No access to this agency' });
    }

    const users = await fastify.prisma.responderUser.findMany({
      where: { agencyId },
      select: {
        id: true,
        agencyId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        badgeNumber: true,
        role: true,
        permissions: true,
        mfaEnabled: true,
        lastLogin: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { lastName: 'asc' },
    });

    return users;
  });

  // POST /api/v1/agencies/:agencyId/users — Create a responder user
  fastify.post<{
    Params: { agencyId: string };
    Body: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      badgeNumber?: string;
      role: string;
      permissions: string[];
      password: string;
    };
  }>('/:agencyId/users', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { agencyId } = request.params;
    const {
      email,
      role,
      permissions,
      password,
    } = request.body;

    const firstName = sanitizeText(request.body.firstName);
    const lastName = sanitizeText(request.body.lastName);
    const phone = sanitizeText(request.body.phone);
    const badgeNumber = sanitizeText(request.body.badgeNumber);

    if (!firstName || !lastName || !email || !role || !password) {
      return reply.code(400).send({ error: 'firstName, lastName, email, role, and password are required' });
    }

    const agency = await fastify.prisma.agency.findUnique({
      where: { id: agencyId },
      include: { schoolLinks: true },
    });

    if (!agency) {
      return reply.code(404).send({ error: 'Agency not found' });
    }

    // Verify the user has access to at least one linked site
    const linkedSiteIds = agency.schoolLinks.map((l) => l.siteId);
    const hasAccess = linkedSiteIds.some((sid) => request.jwtUser.siteIds.includes(sid));

    if (!hasAccess && request.jwtUser.role !== 'SUPER_ADMIN') {
      return reply.code(403).send({ error: 'No access to this agency' });
    }

    // Check for duplicate email
    const existingUser = await fastify.prisma.responderUser.findUnique({
      where: { email },
    });

    if (existingUser) {
      return reply.code(409).send({ error: 'A responder user with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await fastify.prisma.responderUser.create({
      data: {
        agencyId,
        firstName,
        lastName,
        email,
        phone: phone || null,
        badgeNumber: badgeNumber || null,
        role: role as any,
        permissions: permissions as any[],
        passwordHash,
      },
      select: {
        id: true,
        agencyId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        badgeNumber: true,
        role: true,
        permissions: true,
        mfaEnabled: true,
        lastLogin: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Audit log on the first linked site
    const siteId = linkedSiteIds.find((sid) => request.jwtUser.siteIds.includes(sid)) || linkedSiteIds[0];
    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'RESPONDER_USER_CREATED',
        entity: 'ResponderUser',
        entityId: user.id,
        details: { agencyId, firstName, lastName, email, role },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(user);
  });

  // PUT /api/v1/agencies/:agencyId/users/:userId — Update user permissions
  fastify.put<{
    Params: { agencyId: string; userId: string };
    Body: {
      role?: string;
      permissions?: string[];
      status?: string;
    };
  }>('/:agencyId/users/:userId', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { agencyId, userId } = request.params;
    const { role, permissions, status } = request.body;

    const existingUser = await fastify.prisma.responderUser.findFirst({
      where: { id: userId, agencyId },
      include: { agency: { include: { schoolLinks: true } } },
    });

    if (!existingUser) {
      return reply.code(404).send({ error: 'Responder user not found in this agency' });
    }

    // Verify the user has access to at least one linked site
    const linkedSiteIds = existingUser.agency.schoolLinks.map((l) => l.siteId);
    const hasAccess = linkedSiteIds.some((sid) => request.jwtUser.siteIds.includes(sid));

    if (!hasAccess && request.jwtUser.role !== 'SUPER_ADMIN') {
      return reply.code(403).send({ error: 'No access to this agency' });
    }

    const updateData: any = {};
    if (role !== undefined) updateData.role = role;
    if (permissions !== undefined) updateData.permissions = permissions;
    if (status !== undefined) updateData.status = status;

    const updatedUser = await fastify.prisma.responderUser.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        agencyId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        badgeNumber: true,
        role: true,
        permissions: true,
        mfaEnabled: true,
        lastLogin: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const siteId = linkedSiteIds.find((sid) => request.jwtUser.siteIds.includes(sid)) || linkedSiteIds[0];
    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'RESPONDER_USER_UPDATED',
        entity: 'ResponderUser',
        entityId: userId,
        details: { agencyId, ...updateData },
        ipAddress: request.ip,
      },
    });

    return updatedUser;
  });

  // DELETE /api/v1/agencies/:agencyId/users/:userId — Disable a responder user
  fastify.delete<{
    Params: { agencyId: string; userId: string };
  }>('/:agencyId/users/:userId', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { agencyId, userId } = request.params;

    const existingUser = await fastify.prisma.responderUser.findFirst({
      where: { id: userId, agencyId },
      include: { agency: { include: { schoolLinks: true } } },
    });

    if (!existingUser) {
      return reply.code(404).send({ error: 'Responder user not found in this agency' });
    }

    // Verify the user has access to at least one linked site
    const linkedSiteIds = existingUser.agency.schoolLinks.map((l) => l.siteId);
    const hasAccess = linkedSiteIds.some((sid) => request.jwtUser.siteIds.includes(sid));

    if (!hasAccess && request.jwtUser.role !== 'SUPER_ADMIN') {
      return reply.code(403).send({ error: 'No access to this agency' });
    }

    const disabledUser = await fastify.prisma.responderUser.update({
      where: { id: userId },
      data: { status: 'DISABLED_RESPONDER' },
      select: {
        id: true,
        agencyId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        badgeNumber: true,
        role: true,
        permissions: true,
        mfaEnabled: true,
        lastLogin: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const siteId = linkedSiteIds.find((sid) => request.jwtUser.siteIds.includes(sid)) || linkedSiteIds[0];
    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'RESPONDER_USER_DISABLED',
        entity: 'ResponderUser',
        entityId: userId,
        details: {
          agencyId,
          firstName: existingUser.firstName,
          lastName: existingUser.lastName,
          email: existingUser.email,
        },
        ipAddress: request.ip,
      },
    });

    return disabledUser;
  });

  // GET /api/v1/agencies/:agencyId/audit — Access audit log for this agency's users
  fastify.get<{
    Params: { agencyId: string };
    Querystring: { siteId: string; limit?: string; offset?: string };
  }>('/:agencyId/audit', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { agencyId } = request.params;
    const { siteId, limit, offset } = request.query;

    if (!siteId) {
      return reply.code(400).send({ error: 'siteId is required' });
    }

    if (!userHasSiteAccess(request.jwtUser.siteIds, siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    // Get all responder user IDs for this agency
    const agencyUsers = await fastify.prisma.responderUser.findMany({
      where: { agencyId },
      select: { id: true },
    });

    if (agencyUsers.length === 0) {
      return { entries: [], total: 0 };
    }

    const responderUserIds = agencyUsers.map((u) => u.id);

    const take = Math.min(parseInt(limit || '50'), 100);
    const skip = parseInt(offset || '0');

    const [entries, total] = await Promise.all([
      fastify.prisma.responderAuditLog.findMany({
        where: {
          responderUserId: { in: responderUserIds },
          siteId,
        },
        include: {
          responderUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              badgeNumber: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      fastify.prisma.responderAuditLog.count({
        where: {
          responderUserId: { in: responderUserIds },
          siteId,
        },
      }),
    ]);

    return { entries, total };
  });
};

export default agencyRoutes;
