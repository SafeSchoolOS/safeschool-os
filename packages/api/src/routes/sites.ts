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

  // PUT /api/v1/sites/:id/floor-plan — update room/door map positions (admin only)
  fastify.put<{ Params: { id: string } }>(
    '/:id/floor-plan',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const body = request.body as {
        rooms?: Array<{ id: string; mapX: number; mapY: number; mapW: number; mapH: number }>;
        doors?: Array<{ id: string; mapX: number; mapY: number }>;
      };

      const site = await fastify.prisma.site.findUnique({ where: { id: request.params.id } });
      if (!site) return reply.code(404).send({ error: 'Site not found' });

      // Update room positions
      if (body.rooms) {
        for (const room of body.rooms) {
          await fastify.prisma.room.update({
            where: { id: room.id },
            data: { mapX: room.mapX, mapY: room.mapY, mapW: room.mapW, mapH: room.mapH },
          });
        }
      }

      // Update door positions
      if (body.doors) {
        for (const door of body.doors) {
          await fastify.prisma.door.update({
            where: { id: door.id },
            data: { mapX: door.mapX, mapY: door.mapY },
          });
        }
      }

      return { message: 'Floor plan positions updated' };
    }
  );
};

export default siteRoutes;
