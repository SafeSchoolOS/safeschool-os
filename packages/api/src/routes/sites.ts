import type { FastifyPluginAsync } from 'fastify';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { requireMinRole } from '../middleware/rbac.js';

// Ensure floor plan upload directory exists at module load
const FLOOR_PLAN_DIR = process.env.FLOOR_PLAN_DIR || '/app/data/floor-plans';
mkdirSync(FLOOR_PLAN_DIR, { recursive: true });

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

  // POST /:id/buildings/:buildingId/floor-plan-image — upload background image (SITE_ADMIN)
  const ALLOWED_MIMETYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
  };

  fastify.post<{ Params: { id: string; buildingId: string } }>(
    '/:id/buildings/:buildingId/floor-plan-image',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id, buildingId } = request.params;

      // Verify the building belongs to this site
      const building = await fastify.prisma.building.findFirst({
        where: { id: buildingId, siteId: id },
      });
      if (!building) {
        return reply.code(404).send({ error: 'Building not found' });
      }

      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      const ext = ALLOWED_MIMETYPES[file.mimetype];
      if (!ext) {
        return reply.code(400).send({
          error: 'Invalid file type. Allowed: PNG, JPEG, SVG',
        });
      }

      // Read file buffer and save to disk
      const buffer = await file.toBuffer();

      await mkdir(FLOOR_PLAN_DIR, { recursive: true });
      const filename = `${buildingId}.${ext}`;
      const filepath = path.join(FLOOR_PLAN_DIR, filename);
      await writeFile(filepath, buffer);

      // Update building record with the relative path
      await fastify.prisma.building.update({
        where: { id: buildingId },
        data: { floorPlanUrl: filename },
      });

      return {
        url: `/api/v1/sites/${id}/buildings/${buildingId}/floor-plan-image`,
      };
    }
  );

  // GET /:id/buildings/:buildingId/floor-plan-image — serve background image (TEACHER+)
  fastify.get<{ Params: { id: string; buildingId: string } }>(
    '/:id/buildings/:buildingId/floor-plan-image',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request, reply) => {
      const { id, buildingId } = request.params;

      const building = await fastify.prisma.building.findFirst({
        where: { id: buildingId, siteId: id },
      });
      if (!building || !building.floorPlanUrl) {
        return reply.code(404).send({ error: 'Floor plan image not found' });
      }

      const filepath = path.join(FLOOR_PLAN_DIR, building.floorPlanUrl);
      if (!existsSync(filepath)) {
        return reply.code(404).send({ error: 'Floor plan image file not found' });
      }

      const fileBuffer = await readFile(filepath);

      // Determine content type from extension
      const ext = path.extname(building.floorPlanUrl).slice(1);
      const contentTypeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        svg: 'image/svg+xml',
      };

      return reply
        .header('Content-Type', contentTypeMap[ext] || 'application/octet-stream')
        .header('Cache-Control', 'public, max-age=3600')
        .send(fileBuffer);
    }
  );
};

export default siteRoutes;
