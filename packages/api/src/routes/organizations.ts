import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/organizations — list organizations (SUPER_ADMIN sees all, others see their own)
  fastify.get('/', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request) => {
    const user = request.jwtUser;

    if (user.role === 'SUPER_ADMIN') {
      return fastify.prisma.organization.findMany({
        include: {
          _count: { select: { sites: true, children: true } },
          parent: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      });
    }

    // SITE_ADMIN: get orgs for their sites
    const sites = await fastify.prisma.site.findMany({
      where: { id: { in: user.siteIds } },
      select: { organizationId: true },
    });
    const orgIds = sites.map((s) => s.organizationId).filter(Boolean) as string[];

    return fastify.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      include: {
        _count: { select: { sites: true, children: true } },
        parent: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  });

  // GET /api/v1/organizations/:id — single organization with sites
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const org = await fastify.prisma.organization.findUnique({
        where: { id: request.params.id },
        include: {
          sites: { select: { id: true, name: true, address: true, city: true, state: true } },
          children: { select: { id: true, name: true, type: true } },
          parent: { select: { id: true, name: true } },
        },
      });

      if (!org) return reply.code(404).send({ error: 'Organization not found' });
      return org;
    }
  );

  // POST /api/v1/organizations — create organization
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, requireMinRole('SUPER_ADMIN')] },
    async (request, reply) => {
      const body = request.body as any;
      const org = await fastify.prisma.organization.create({
        data: {
          name: sanitizeText(body.name),
          slug: sanitizeText(body.slug),
          type: body.type || 'DISTRICT',
          parentId: body.parentId || null,
          address: body.address ? sanitizeText(body.address) : null,
          city: body.city ? sanitizeText(body.city) : null,
          state: body.state ? sanitizeText(body.state) : null,
          zip: body.zip ? sanitizeText(body.zip) : null,
          phone: body.phone ? sanitizeText(body.phone) : null,
          website: body.website ? sanitizeText(body.website) : null,
          logoUrl: body.logoUrl || null,
          settings: body.settings || null,
        },
      });
      return reply.code(201).send(org);
    }
  );

  // PUT /api/v1/organizations/:id — update organization
  fastify.put<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('SUPER_ADMIN')] },
    async (request, reply) => {
      const body = request.body as any;
      const existing = await fastify.prisma.organization.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) return reply.code(404).send({ error: 'Organization not found' });

      const org = await fastify.prisma.organization.update({
        where: { id: request.params.id },
        data: {
          ...(body.name && { name: sanitizeText(body.name) }),
          ...(body.slug && { slug: sanitizeText(body.slug) }),
          ...(body.type && { type: body.type }),
          ...(body.parentId !== undefined && { parentId: body.parentId }),
          ...(body.address !== undefined && { address: body.address ? sanitizeText(body.address) : null }),
          ...(body.city !== undefined && { city: body.city ? sanitizeText(body.city) : null }),
          ...(body.state !== undefined && { state: body.state ? sanitizeText(body.state) : null }),
          ...(body.zip !== undefined && { zip: body.zip ? sanitizeText(body.zip) : null }),
          ...(body.phone !== undefined && { phone: body.phone ? sanitizeText(body.phone) : null }),
          ...(body.website !== undefined && { website: body.website ? sanitizeText(body.website) : null }),
          ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl }),
          ...(body.settings !== undefined && { settings: body.settings }),
        },
      });
      return org;
    }
  );

  // DELETE /api/v1/organizations/:id — delete (only if no sites attached)
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('SUPER_ADMIN')] },
    async (request, reply) => {
      const org = await fastify.prisma.organization.findUnique({
        where: { id: request.params.id },
        include: { _count: { select: { sites: true } } },
      });
      if (!org) return reply.code(404).send({ error: 'Organization not found' });
      if (org._count.sites > 0) {
        return reply.code(409).send({ error: 'Cannot delete organization with active sites. Reassign sites first.' });
      }

      await fastify.prisma.organization.delete({ where: { id: request.params.id } });
      return { message: 'Organization deleted' };
    }
  );

  // POST /api/v1/organizations/:id/sites — assign a site to this organization
  fastify.post<{ Params: { id: string } }>(
    '/:id/sites',
    { preHandler: [fastify.authenticate, requireMinRole('SUPER_ADMIN')] },
    async (request, reply) => {
      const { siteId } = request.body as { siteId: string };
      const org = await fastify.prisma.organization.findUnique({
        where: { id: request.params.id },
      });
      if (!org) return reply.code(404).send({ error: 'Organization not found' });

      const site = await fastify.prisma.site.update({
        where: { id: siteId },
        data: { organizationId: request.params.id },
      });
      return site;
    }
  );

  // DELETE /api/v1/organizations/:id/sites/:siteId — remove site from organization
  fastify.delete<{ Params: { id: string; siteId: string } }>(
    '/:id/sites/:siteId',
    { preHandler: [fastify.authenticate, requireMinRole('SUPER_ADMIN')] },
    async (request, reply) => {
      const site = await fastify.prisma.site.findUnique({
        where: { id: request.params.siteId },
      });
      if (!site || site.organizationId !== request.params.id) {
        return reply.code(404).send({ error: 'Site not found in this organization' });
      }

      const updated = await fastify.prisma.site.update({
        where: { id: request.params.siteId },
        data: { organizationId: null },
      });
      return updated;
    }
  );
};

export default organizationRoutes;
