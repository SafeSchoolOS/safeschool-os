import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';
import { parseCsv } from '../utils/csv.js';
import bcrypt from 'bcryptjs';

const VALID_ROLES = new Set(['SUPER_ADMIN', 'SITE_ADMIN', 'OPERATOR', 'TEACHER', 'FIRST_RESPONDER', 'PARENT']);

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

  // GET /api/v1/users/all — ALL users across all sites (SUPER_ADMIN only)
  app.get('/all', { preHandler: [requireMinRole('SUPER_ADMIN')] }, async (request: FastifyRequest) => {
    const { page, limit, search, role } = request.query as { page?: string; limit?: string; search?: string; role?: string };
    const take = Math.min(parseInt(limit || '50', 10), 100);
    const skip = (Math.max(parseInt(page || '1', 10), 1) - 1) * take;
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;

    const [users, total] = await Promise.all([
      app.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, name: true, role: true, phone: true, isActive: true,
          createdAt: true, updatedAt: true,
          sites: { select: { site: { select: { id: true, name: true } } } },
        },
        orderBy: { name: 'asc' },
        take, skip,
      }),
      app.prisma.user.count({ where }),
    ]);
    return {
      users: users.map((u) => ({ ...u, sites: u.sites.map((s: any) => s.site) })),
      total, page: Math.floor(skip / take) + 1, pages: Math.ceil(total / take),
    };
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

  // POST /api/v1/users/import — bulk CSV import
  app.post('/import', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const file = await (request as any).file();
    if (!file) return reply.code(400).send({ error: 'No CSV file uploaded' });

    const buffer = await file.toBuffer();
    if (buffer.length > 5 * 1024 * 1024) {
      return reply.code(400).send({ error: 'File too large. Maximum 5MB.' });
    }

    const raw = buffer.toString('utf-8');
    let rows: Record<string, string>[];
    try {
      rows = parseCsv(raw);
    } catch {
      return reply.code(400).send({ error: 'Invalid CSV format' });
    }

    if (rows.length === 0) {
      return reply.code(400).send({ error: 'CSV file is empty or has no data rows' });
    }
    if (rows.length > 5000) {
      return reply.code(400).send({ error: `Too many rows (${rows.length}). Maximum 5000.` });
    }

    const dryRun = ((request.query as any).dryRun === 'true');
    const siteId = (request as any).jwtUser.siteIds[0];
    const errors: { row: number; field: string; error: string }[] = [];
    let imported = 0;
    let skipped = 0;

    // Cap bcrypt concurrency to avoid CPU freeze
    const BATCH_SIZE = 10;
    const batches: Record<string, string>[][] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      batches.push(rows.slice(i, i + BATCH_SIZE));
    }

    let globalIdx = 0;
    for (const batch of batches) {
      await Promise.all(batch.map(async (row) => {
        const rowIdx = globalIdx++;
        const rowNum = rowIdx + 2; // 1-indexed + header

        const email = (row.email || '').trim().toLowerCase();
        const name = (row.name || '').trim();
        const role = (row.role || '').trim().toUpperCase();
        const phone = (row.phone || '').trim();
        const password = (row.password || '').trim();

        if (!email) { errors.push({ row: rowNum, field: 'email', error: 'Required' }); return; }
        if (!name) { errors.push({ row: rowNum, field: 'name', error: 'Required' }); return; }
        if (!role) { errors.push({ row: rowNum, field: 'role', error: 'Required' }); return; }
        if (!VALID_ROLES.has(role)) {
          errors.push({ row: rowNum, field: 'role', error: `Invalid role: ${role}. Must be one of: ${[...VALID_ROLES].join(', ')}` });
          return;
        }
        if (!password) { errors.push({ row: rowNum, field: 'password', error: 'Required' }); return; }
        if (password.length < 12) {
          errors.push({ row: rowNum, field: 'password', error: 'Password must be at least 12 characters' });
          return;
        }

        if (dryRun) { imported++; return; }

        try {
          const passwordHash = await bcrypt.hash(password, 12);
          await app.prisma.user.create({
            data: {
              email: sanitizeText(email),
              name: sanitizeText(name),
              role: role as any,
              phone: phone ? sanitizeText(phone) : null,
              passwordHash,
              sites: { create: [{ siteId }] },
            },
          });
          imported++;
        } catch (err: any) {
          if (err.code === 'P2002') {
            skipped++;
          } else {
            errors.push({ row: rowNum, field: 'email', error: err.message || 'Database error' });
          }
        }
      }));
    }

    if (!dryRun && imported > 0) {
      await app.prisma.auditLog.create({
        data: {
          siteId,
          userId: (request as any).jwtUser.id,
          action: 'BULK_IMPORT',
          entity: 'User',
          entityId: siteId,
          details: { imported, skipped, errorCount: errors.length, total: rows.length },
        },
      });
    }

    return { imported, skipped, errors, total: rows.length, dryRun };
  });
}
