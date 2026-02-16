import type { FastifyPluginAsync } from 'fastify';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { requireMinRole } from '../middleware/rbac.js';

// Ensure upload directories exist at module load (best-effort; may fail in CI/test)
const FLOOR_PLAN_DIR = process.env.FLOOR_PLAN_DIR || '/app/data/floor-plans';
const LOGO_DIR = process.env.LOGO_DIR || '/app/data/logos';
try { mkdirSync(FLOOR_PLAN_DIR, { recursive: true }); } catch { /* created lazily at upload time */ }
try { mkdirSync(LOGO_DIR, { recursive: true }); } catch { /* created lazily at upload time */ }

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

  // ============================================================================
  // Site Logo Upload/Serve/Delete
  // ============================================================================

  const LOGO_MIMETYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };

  // POST /:id/logo — upload site logo (SITE_ADMIN+)
  fastify.post<{ Params: { id: string } }>(
    '/:id/logo',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id } = request.params;

      const site = await fastify.prisma.site.findUnique({ where: { id } });
      if (!site) return reply.code(404).send({ error: 'Site not found' });

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'No file uploaded' });

      const ext = LOGO_MIMETYPES[file.mimetype];
      if (!ext) {
        return reply.code(400).send({ error: 'Invalid file type. Allowed: PNG, JPEG, WebP, SVG' });
      }

      const buffer = await file.toBuffer();
      await mkdir(LOGO_DIR, { recursive: true });
      const filename = `${id}.${ext}`;
      const filepath = path.join(LOGO_DIR, filename);
      await writeFile(filepath, buffer);

      await fastify.prisma.site.update({
        where: { id },
        data: { logoUrl: filename },
      });

      return { url: `/api/v1/sites/${id}/logo` };
    }
  );

  // GET /:id/logo — serve site logo (public, no auth — needed by kiosk)
  fastify.get<{ Params: { id: string } }>(
    '/:id/logo',
    async (request, reply) => {
      const { id } = request.params;

      const site = await fastify.prisma.site.findUnique({ where: { id } });
      if (!site || !site.logoUrl) {
        return reply.code(404).send({ error: 'Logo not found' });
      }

      const filepath = path.join(LOGO_DIR, site.logoUrl);
      if (!existsSync(filepath)) {
        return reply.code(404).send({ error: 'Logo file not found' });
      }

      const fileBuffer = await readFile(filepath);
      const ext = path.extname(site.logoUrl).slice(1);
      const contentTypeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        svg: 'image/svg+xml',
      };

      return reply
        .header('Content-Type', contentTypeMap[ext] || 'application/octet-stream')
        .header('Cache-Control', 'public, max-age=3600')
        .send(fileBuffer);
    }
  );

  // DELETE /:id/logo — remove site logo (SITE_ADMIN+)
  fastify.delete<{ Params: { id: string } }>(
    '/:id/logo',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id } = request.params;

      const site = await fastify.prisma.site.findUnique({ where: { id } });
      if (!site) return reply.code(404).send({ error: 'Site not found' });
      if (!site.logoUrl) return reply.code(404).send({ error: 'No logo to delete' });

      const filepath = path.join(LOGO_DIR, site.logoUrl);
      try { await unlink(filepath); } catch { /* file may already be gone */ }

      await fastify.prisma.site.update({
        where: { id },
        data: { logoUrl: null },
      });

      return { message: 'Logo deleted' };
    }
  );

  // ============================================================================
  // Room CRUD
  // ============================================================================

  // POST /:id/rooms — create room (SITE_ADMIN+)
  fastify.post<{ Params: { id: string } }>(
    '/:id/rooms',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body as {
        buildingId: string; name: string; number: string;
        floor?: number; type?: string; mapX?: number; mapY?: number; mapW?: number; mapH?: number;
      };
      if (!body.buildingId || !body.name || !body.number) {
        return reply.code(400).send({ error: 'buildingId, name, and number are required' });
      }
      const building = await fastify.prisma.building.findFirst({ where: { id: body.buildingId, siteId: id } });
      if (!building) return reply.code(404).send({ error: 'Building not found in this site' });

      const room = await fastify.prisma.room.create({
        data: {
          buildingId: body.buildingId,
          name: body.name,
          number: body.number,
          floor: body.floor ?? 1,
          type: (body.type as any) ?? 'CLASSROOM',
          mapX: body.mapX ?? null,
          mapY: body.mapY ?? null,
          mapW: body.mapW ?? 150,
          mapH: body.mapH ?? 80,
        },
      });
      return reply.code(201).send(room);
    }
  );

  // PUT /:id/rooms/:roomId — update room (SITE_ADMIN+)
  fastify.put<{ Params: { id: string; roomId: string } }>(
    '/:id/rooms/:roomId',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id, roomId } = request.params;
      const body = request.body as {
        name?: string; number?: string; floor?: number; type?: string;
        mapX?: number; mapY?: number; mapW?: number; mapH?: number;
      };
      const room = await fastify.prisma.room.findUnique({
        where: { id: roomId },
        include: { building: true },
      });
      if (!room || room.building.siteId !== id) {
        return reply.code(404).send({ error: 'Room not found' });
      }
      const updated = await fastify.prisma.room.update({
        where: { id: roomId },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.number !== undefined && { number: body.number }),
          ...(body.floor !== undefined && { floor: body.floor }),
          ...(body.type !== undefined && { type: body.type as any }),
          ...(body.mapX !== undefined && { mapX: body.mapX }),
          ...(body.mapY !== undefined && { mapY: body.mapY }),
          ...(body.mapW !== undefined && { mapW: body.mapW }),
          ...(body.mapH !== undefined && { mapH: body.mapH }),
        },
      });
      return updated;
    }
  );

  // DELETE /:id/rooms/:roomId — delete room (SITE_ADMIN+)
  fastify.delete<{ Params: { id: string; roomId: string } }>(
    '/:id/rooms/:roomId',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id, roomId } = request.params;
      const room = await fastify.prisma.room.findUnique({
        where: { id: roomId },
        include: { building: true },
      });
      if (!room || room.building.siteId !== id) {
        return reply.code(404).send({ error: 'Room not found' });
      }
      await fastify.prisma.room.delete({ where: { id: roomId } });
      return { message: 'Room deleted' };
    }
  );

  // ============================================================================
  // Door CRUD
  // ============================================================================

  // POST /:id/doors — create door (SITE_ADMIN+)
  fastify.post<{ Params: { id: string } }>(
    '/:id/doors',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body as {
        buildingId: string; name: string;
        floor?: number; isExterior?: boolean; isEmergencyExit?: boolean;
        mapX?: number; mapY?: number;
      };
      if (!body.buildingId || !body.name) {
        return reply.code(400).send({ error: 'buildingId and name are required' });
      }
      const building = await fastify.prisma.building.findFirst({ where: { id: body.buildingId, siteId: id } });
      if (!building) return reply.code(404).send({ error: 'Building not found in this site' });

      const door = await fastify.prisma.door.create({
        data: {
          siteId: id,
          buildingId: body.buildingId,
          name: body.name,
          floor: body.floor ?? 1,
          isExterior: body.isExterior ?? false,
          isEmergencyExit: body.isEmergencyExit ?? false,
          mapX: body.mapX ?? null,
          mapY: body.mapY ?? null,
        },
      });
      return reply.code(201).send(door);
    }
  );

  // PUT /:id/doors/:doorId — update door (SITE_ADMIN+)
  fastify.put<{ Params: { id: string; doorId: string } }>(
    '/:id/doors/:doorId',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id, doorId } = request.params;
      const body = request.body as {
        name?: string; floor?: number;
        isExterior?: boolean; isEmergencyExit?: boolean;
        mapX?: number; mapY?: number;
      };
      const door = await fastify.prisma.door.findFirst({ where: { id: doorId, siteId: id } });
      if (!door) return reply.code(404).send({ error: 'Door not found' });

      const updated = await fastify.prisma.door.update({
        where: { id: doorId },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.floor !== undefined && { floor: body.floor }),
          ...(body.isExterior !== undefined && { isExterior: body.isExterior }),
          ...(body.isEmergencyExit !== undefined && { isEmergencyExit: body.isEmergencyExit }),
          ...(body.mapX !== undefined && { mapX: body.mapX }),
          ...(body.mapY !== undefined && { mapY: body.mapY }),
        },
      });
      return updated;
    }
  );

  // DELETE /:id/doors/:doorId — delete door (SITE_ADMIN+)
  fastify.delete<{ Params: { id: string; doorId: string } }>(
    '/:id/doors/:doorId',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const { id, doorId } = request.params;
      const door = await fastify.prisma.door.findFirst({ where: { id: doorId, siteId: id } });
      if (!door) return reply.code(404).send({ error: 'Door not found' });

      await fastify.prisma.door.delete({ where: { id: doorId } });
      return { message: 'Door deleted' };
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
