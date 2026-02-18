import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const visitorSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/visitor-settings — Get site visitor settings
  fastify.get('/', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    let settings = await fastify.prisma.siteVisitorSettings.findUnique({ where: { siteId } });
    if (!settings) {
      settings = await fastify.prisma.siteVisitorSettings.create({ data: { siteId } });
    }
    return settings;
  });

  // PUT /api/v1/visitor-settings — Upsert settings
  fastify.put<{
    Body: {
      hostNotificationEnabled?: boolean;
      autoCheckoutEnabled?: boolean;
      autoCheckoutTime?: string;
      requireSignature?: boolean;
      requirePhoto?: boolean;
      requirePolicyAck?: boolean;
      publicPreRegEnabled?: boolean;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const data = request.body;
    const settings = await fastify.prisma.siteVisitorSettings.upsert({
      where: { siteId },
      update: data,
      create: { siteId, ...data },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'VISITOR_SETTINGS_UPDATED',
        entity: 'SiteVisitorSettings',
        entityId: settings.id,
        details: data as any,
        ipAddress: request.ip,
      },
    });

    return settings;
  });

  // GET /api/v1/visitor-settings/policies — List active policies
  fastify.get('/policies', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];

    return fastify.prisma.visitorPolicy.findMany({
      where: { siteId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  // POST /api/v1/visitor-settings/policies — Create policy
  fastify.post<{ Body: { title: string; body: string } }>(
    '/policies',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const title = sanitizeText(request.body.title);
      const body = sanitizeText(request.body.body);
      if (!title || !body) return reply.code(400).send({ error: 'title and body are required' });

      const policy = await fastify.prisma.visitorPolicy.create({
        data: { siteId, title, body },
      });
      return reply.code(201).send(policy);
    },
  );

  // PUT /api/v1/visitor-settings/policies/:id — Update policy
  fastify.put<{ Params: { id: string }; Body: { title?: string; body?: string; isActive?: boolean } }>(
    '/policies/:id',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id } = request.params;
      const update: any = {};
      if (request.body.title !== undefined) update.title = sanitizeText(request.body.title);
      if (request.body.body !== undefined) update.body = sanitizeText(request.body.body);
      if (request.body.isActive !== undefined) update.isActive = request.body.isActive;

      try {
        const policy = await fastify.prisma.visitorPolicy.update({ where: { id }, data: update });
        return policy;
      } catch {
        return reply.code(404).send({ error: 'Policy not found' });
      }
    },
  );

  // DELETE /api/v1/visitor-settings/policies/:id — Deactivate policy
  fastify.delete<{ Params: { id: string } }>(
    '/policies/:id',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      try {
        await fastify.prisma.visitorPolicy.update({
          where: { id: request.params.id },
          data: { isActive: false },
        });
        return { success: true };
      } catch {
        return reply.code(404).send({ error: 'Policy not found' });
      }
    },
  );

  // GET /api/v1/visitor-settings/public/:siteId — Public settings (no auth)
  fastify.get<{ Params: { siteId: string } }>('/public/:siteId', async (request, reply) => {
    const { siteId } = request.params;

    const site = await fastify.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } });
    if (!site) return reply.code(404).send({ error: 'Site not found' });

    const settings = await fastify.prisma.siteVisitorSettings.findUnique({ where: { siteId } });
    const policies = await fastify.prisma.visitorPolicy.findMany({
      where: { siteId, isActive: true },
      select: { id: true, title: true, body: true },
    });

    return {
      requireSignature: settings?.requireSignature ?? false,
      requirePhoto: settings?.requirePhoto ?? false,
      requirePolicyAck: settings?.requirePolicyAck ?? false,
      policies,
    };
  });
};

export default visitorSettingsRoutes;
