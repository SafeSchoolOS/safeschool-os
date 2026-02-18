import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

export default async function auditLogRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/audit-log — list audit log entries
  app.get('/', { preHandler: [requireMinRole('OPERATOR')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { action, entity, userId, limit, offset } = request.query as {
      action?: string;
      entity?: string;
      userId?: string;
      limit?: string;
      offset?: string;
    };

    const take = Math.min(parseInt(limit || '50'), 100);
    const skip = parseInt(offset || '0');

    const [entries, total] = await Promise.all([
      app.prisma.auditLog.findMany({
        where: {
          siteId: { in: user.siteIds },
          ...(action && { action: { contains: action } }),
          ...(entity && { entity }),
          ...(userId && { userId }),
        },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      app.prisma.auditLog.count({
        where: {
          siteId: { in: user.siteIds },
          ...(action && { action: { contains: action } }),
          ...(entity && { entity }),
          ...(userId && { userId }),
        },
      }),
    ]);

    return { entries, total, limit: take, offset: skip };
  });

  // GET /api/v1/audit-log/entities — list distinct entity types
  app.get('/entities', { preHandler: [requireMinRole('OPERATOR')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };

    const entities = await app.prisma.auditLog.findMany({
      where: { siteId: { in: user.siteIds } },
      select: { entity: true },
      distinct: ['entity'],
      orderBy: { entity: 'asc' },
    });

    return entities.map((e) => e.entity);
  });

  // GET /api/v1/audit-log/actions — list distinct action types
  app.get('/actions', { preHandler: [requireMinRole('OPERATOR')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };

    const actions = await app.prisma.auditLog.findMany({
      where: { siteId: { in: user.siteIds } },
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
    });

    return actions.map((a) => a.action);
  });
}
