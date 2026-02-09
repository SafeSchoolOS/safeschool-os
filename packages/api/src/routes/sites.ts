import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const siteRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/sites — User's sites
  fastify.get('/', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request) => {
    const sites = await fastify.prisma.site.findMany({
      where: { id: { in: request.jwtUser.siteIds } },
      include: {
        buildings: {
          include: {
            _count: { select: { rooms: true, doors: true } },
          },
        },
      },
    });
    return sites;
  });

  // GET /api/v1/sites/:id — Site with buildings, rooms, door counts
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const site = await fastify.prisma.site.findUnique({
      where: { id: request.params.id },
      include: {
        buildings: {
          include: {
            rooms: true,
            doors: true,
          },
        },
      },
    });

    if (!site) {
      return reply.code(404).send({ error: 'Site not found' });
    }

    return site;
  });
};

export default siteRoutes;
