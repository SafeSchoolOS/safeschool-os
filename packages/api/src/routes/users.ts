import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';
import bcrypt from 'bcryptjs';

export default async function userRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/users — list users scoped to requesting admin's sites
  app.get('/', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest) => {
    const users = await app.prisma.user.findMany({
      where: {
        sites: { some: { siteId: { in: (request as any).jwtUser.siteIds } } },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        sites: {
          select: { site: { select: { id: true, name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    return users.map((u) => ({
      ...u,
      sites: u.sites.map((s) => s.site),
    }));
  });

  // GET /api/v1/users/:id — single user detail (must share a site with requester)
  app.get('/:id', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const requesterSiteIds = (request as any).jwtUser.siteIds as string[];
    const user = await app.prisma.user.findFirst({
      where: {
        id,
        sites: { some: { siteId: { in: requesterSiteIds } } },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        wearableDeviceId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        sites: {
          select: { site: { select: { id: true, name: true } } },
        },
      },
    });
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return { ...user, sites: user.sites.map((s) => s.site) };
  });

  // POST /api/v1/users — create a new user
  app.post('/', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { email, name, role, phone, password, siteIds } = request.body as {
      email: string;
      name: string;
      role: string;
      phone?: string;
      password: string;
      siteIds?: string[];
    };

    if (!email || !name || !role || !password) {
      return reply.code(400).send({ error: 'email, name, role, and password are required' });
    }

    if (password.length < 12) {
      return reply.code(400).send({ error: 'Password must be at least 12 characters' });
    }

    const existing = await app.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: 'A user with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await app.prisma.user.create({
      data: {
        email: sanitizeText(email).toLowerCase(),
        name: sanitizeText(name),
        role: role as any,
        phone: phone ? sanitizeText(phone) : null,
        passwordHash,
        sites: siteIds?.length
          ? { create: siteIds.map((siteId) => ({ siteId })) }
          : undefined,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
    });

    reply.code(201);
    return user;
  });

  // PUT /api/v1/users/:id — update a user
  app.put('/:id', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { name, email, role, phone, isActive, siteIds, wearableDeviceId } = request.body as {
      name?: string;
      email?: string;
      role?: string;
      phone?: string;
      isActive?: boolean;
      siteIds?: string[];
      wearableDeviceId?: string | null;
    };

    const requesterSiteIds = (request as any).jwtUser.siteIds as string[];
    const existing = await app.prisma.user.findFirst({
      where: { id, sites: { some: { siteId: { in: requesterSiteIds } } } },
    });
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    // If changing email, check for conflicts
    if (email && email !== existing.email) {
      const conflict = await app.prisma.user.findUnique({ where: { email } });
      if (conflict) return reply.code(409).send({ error: 'Email already in use' });
    }

    // If setting wearableDeviceId, check uniqueness
    if (wearableDeviceId !== undefined && wearableDeviceId !== null) {
      const cleanBadgeId = sanitizeText(wearableDeviceId);
      const badgeConflict = await app.prisma.user.findFirst({
        where: {
          wearableDeviceId: { equals: cleanBadgeId, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (badgeConflict) {
        return reply.code(409).send({ error: 'This badge ID is already assigned to another user' });
      }
    }

    // Update site assignments if provided
    if (siteIds !== undefined) {
      await app.prisma.userSite.deleteMany({ where: { userId: id } });
      if (siteIds.length > 0) {
        await app.prisma.userSite.createMany({
          data: siteIds.map((siteId) => ({ userId: id, siteId })),
        });
      }
    }

    const user = await app.prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: sanitizeText(name) }),
        ...(email !== undefined && { email: sanitizeText(email).toLowerCase() }),
        ...(role !== undefined && { role: role as any }),
        ...(phone !== undefined && { phone: phone ? sanitizeText(phone) : null }),
        ...(isActive !== undefined && { isActive }),
        ...(wearableDeviceId !== undefined && { wearableDeviceId: wearableDeviceId ? sanitizeText(wearableDeviceId) : null }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        wearableDeviceId: true,
        isActive: true,
        updatedAt: true,
        sites: {
          select: { site: { select: { id: true, name: true } } },
        },
      },
    });

    return { ...user, sites: user.sites.map((s) => s.site) };
  });

  // POST /api/v1/users/:id/reset-password — reset user password (must share a site)
  app.post('/:id/reset-password', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { password } = request.body as { password: string };

    if (!password || password.length < 12) {
      return reply.code(400).send({ error: 'Password must be at least 12 characters' });
    }

    const requesterSiteIds = (request as any).jwtUser.siteIds as string[];
    const existing = await app.prisma.user.findFirst({
      where: { id, sites: { some: { siteId: { in: requesterSiteIds } } } },
    });
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    const passwordHash = await bcrypt.hash(password, 12);
    await app.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    return { message: 'Password updated' };
  });

  // DELETE /api/v1/users/:id — deactivate (soft delete, must share a site)
  app.delete('/:id', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const requesterSiteIds = (request as any).jwtUser.siteIds as string[];
    const existing = await app.prisma.user.findFirst({
      where: { id, sites: { some: { siteId: { in: requesterSiteIds } } } },
    });
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    // Prevent self-deactivation
    const requester = (request as any).jwtUser;
    if (requester.id === id) {
      return reply.code(400).send({ error: 'Cannot deactivate your own account' });
    }

    await app.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    return { message: 'User deactivated' };
  });
}
