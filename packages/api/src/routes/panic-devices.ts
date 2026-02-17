import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Panic Device Management Routes
 *
 * RBAC: All routes require OPERATOR or above.
 * Manages assignment of wearable panic device badge IDs to users.
 * No new DB migration needed — uses existing User.wearableDeviceId field.
 */
export default async function panicDeviceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/panic-devices — List all users with assigned badges
  app.get('/', { preHandler: [requireMinRole('OPERATOR')] }, async () => {
    const users = await app.prisma.user.findMany({
      where: {
        wearableDeviceId: { not: null },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        wearableDeviceId: true,
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

  // GET /api/v1/panic-devices/unassigned-staff — List TEACHER/OPERATOR users without badges
  app.get('/unassigned-staff', { preHandler: [requireMinRole('OPERATOR')] }, async () => {
    const users = await app.prisma.user.findMany({
      where: {
        wearableDeviceId: null,
        isActive: true,
        role: { in: ['TEACHER', 'FIRST_RESPONDER', 'OPERATOR', 'SITE_ADMIN'] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });

    return users;
  });

  // PUT /api/v1/panic-devices/:badgeId/assign — Assign badge to user
  app.put('/:badgeId/assign', { preHandler: [requireMinRole('OPERATOR')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { badgeId } = request.params as { badgeId: string };
    const { userId } = request.body as { userId: string };

    if (!userId) {
      return reply.code(400).send({ error: 'userId is required' });
    }

    const cleanBadgeId = sanitizeText(badgeId);
    if (!cleanBadgeId) {
      return reply.code(400).send({ error: 'Invalid badge ID' });
    }

    // Check user exists
    const user = await app.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, wearableDeviceId: true },
    });
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Check uniqueness — no other user should have this badge
    const conflict = await app.prisma.user.findFirst({
      where: {
        wearableDeviceId: { equals: cleanBadgeId, mode: 'insensitive' },
        id: { not: userId },
      },
      select: { id: true, name: true },
    });
    if (conflict) {
      return reply.code(409).send({
        error: `Badge ${cleanBadgeId} is already assigned to ${conflict.name}`,
      });
    }

    const updated = await app.prisma.user.update({
      where: { id: userId },
      data: { wearableDeviceId: cleanBadgeId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        wearableDeviceId: true,
        sites: { select: { siteId: true }, take: 1 },
      },
    });

    // Audit log
    const requester = (request as any).user || (request as any).jwtUser;
    const siteId = updated.sites[0]?.siteId;
    if (siteId) {
      await app.prisma.auditLog.create({
        data: {
          siteId,
          userId: requester?.id,
          action: 'PANIC_DEVICE_ASSIGNED',
          entity: 'User',
          entityId: userId,
          details: { badgeId: cleanBadgeId, userName: updated.name },
          ipAddress: request.ip,
        },
      });
    }

    const { sites: _sites, ...result } = updated;
    return result;
  });

  // DELETE /api/v1/panic-devices/:badgeId/assign — Unassign badge from user
  app.delete('/:badgeId/assign', { preHandler: [requireMinRole('OPERATOR')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { badgeId } = request.params as { badgeId: string };

    const user = await app.prisma.user.findFirst({
      where: { wearableDeviceId: { equals: badgeId, mode: 'insensitive' } },
      select: { id: true, name: true, sites: { select: { siteId: true }, take: 1 } },
    });

    if (!user) {
      return reply.code(404).send({ error: 'No user found with this badge ID' });
    }

    await app.prisma.user.update({
      where: { id: user.id },
      data: { wearableDeviceId: null },
    });

    // Audit log
    const requester = (request as any).user || (request as any).jwtUser;
    const siteId = user.sites[0]?.siteId;
    if (siteId) {
      await app.prisma.auditLog.create({
        data: {
          siteId,
          userId: requester?.id,
          action: 'PANIC_DEVICE_UNASSIGNED',
          entity: 'User',
          entityId: user.id,
          details: { badgeId, userName: user.name },
          ipAddress: request.ip,
        },
      });
    }

    return { message: `Badge ${badgeId} unassigned from ${user.name}` };
  });
}
