import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const visitorBanRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /visitor-bans — List bans (search by name)
  fastify.get<{
    Querystring: { q?: string; active?: string; limit?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];

    const where: any = { siteId };
    if (request.query.active !== 'all') where.isActive = true;
    if (request.query.q) {
      const query = request.query.q.trim();
      where.OR = [
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
      ];
    }

    return fastify.prisma.visitorBan.findMany({
      where,
      include: { bannedBy: { select: { id: true, name: true } } },
      orderBy: { bannedAt: 'desc' },
      take: Math.min(parseInt(request.query.limit || '50'), 200),
    });
  });

  // POST /visitor-bans — Add to ban list
  fastify.post<{
    Body: {
      firstName: string;
      lastName: string;
      reason: string;
      dateOfBirth?: string;
      idNumber?: string;
      expiresAt?: string;
      photoUrl?: string;
      notes?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const firstName = sanitizeText(request.body.firstName);
    const lastName = sanitizeText(request.body.lastName);
    const reason = sanitizeText(request.body.reason);

    if (!firstName || !lastName || !reason) {
      return reply.code(400).send({ error: 'firstName, lastName, and reason are required' });
    }

    const ban = await fastify.prisma.visitorBan.create({
      data: {
        siteId,
        firstName,
        lastName,
        reason,
        bannedById: request.jwtUser.id,
        dateOfBirth: request.body.dateOfBirth ? new Date(request.body.dateOfBirth) : null,
        idNumber: request.body.idNumber || null,
        expiresAt: request.body.expiresAt ? new Date(request.body.expiresAt) : null,
        photoUrl: request.body.photoUrl || null,
        notes: request.body.notes ? sanitizeText(request.body.notes) : null,
      },
      include: { bannedBy: { select: { id: true, name: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'VISITOR_BAN_CREATED',
        entity: 'VisitorBan',
        entityId: ban.id,
        details: { firstName, lastName, reason },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(ban);
  });

  // PUT /visitor-bans/:id — Update/deactivate
  fastify.put<{
    Params: { id: string };
    Body: {
      reason?: string;
      expiresAt?: string;
      isActive?: boolean;
      notes?: string;
      photoUrl?: string;
    };
  }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const ban = await fastify.prisma.visitorBan.findUnique({ where: { id: request.params.id } });
    if (!ban) return reply.code(404).send({ error: 'Ban not found' });

    const data: any = {};
    if (request.body.reason) data.reason = sanitizeText(request.body.reason);
    if (request.body.expiresAt !== undefined) data.expiresAt = request.body.expiresAt ? new Date(request.body.expiresAt) : null;
    if (request.body.isActive !== undefined) data.isActive = request.body.isActive;
    if (request.body.notes !== undefined) data.notes = request.body.notes ? sanitizeText(request.body.notes) : null;
    if (request.body.photoUrl !== undefined) data.photoUrl = request.body.photoUrl;

    const updated = await fastify.prisma.visitorBan.update({
      where: { id: request.params.id },
      data,
      include: { bannedBy: { select: { id: true, name: true } } },
    });

    return updated;
  });

  // DELETE /visitor-bans/:id — Remove ban
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const ban = await fastify.prisma.visitorBan.findUnique({ where: { id: request.params.id } });
      if (!ban) return reply.code(404).send({ error: 'Ban not found' });

      await fastify.prisma.visitorBan.delete({ where: { id: request.params.id } });

      await fastify.prisma.auditLog.create({
        data: {
          siteId: ban.siteId,
          userId: request.jwtUser.id,
          action: 'VISITOR_BAN_REMOVED',
          entity: 'VisitorBan',
          entityId: ban.id,
          details: { firstName: ban.firstName, lastName: ban.lastName },
          ipAddress: request.ip,
        },
      });

      return { success: true };
    },
  );

  // POST /visitor-bans/check — Check name against ban list
  fastify.post<{
    Body: { firstName: string; lastName: string; siteId?: string };
  }>('/check', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.body.siteId || request.jwtUser.siteIds[0];
    if (!siteId) return { banned: false, matches: [] };

    const firstName = request.body.firstName?.trim();
    const lastName = request.body.lastName?.trim();
    if (!firstName || !lastName) return { banned: false, matches: [] };

    const matches = await fastify.prisma.visitorBan.findMany({
      where: {
        siteId,
        isActive: true,
        firstName: { equals: firstName, mode: 'insensitive' },
        lastName: { equals: lastName, mode: 'insensitive' },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, reason: true, bannedAt: true, photoUrl: true },
    });

    return { banned: matches.length > 0, matches };
  });
};

export default visitorBanRoutes;
