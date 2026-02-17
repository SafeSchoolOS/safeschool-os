import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Zone Management Routes
 *
 * Full CRUD for access zones with type classification, access schedules,
 * door assignments, and restricted area management.
 *
 * RBAC: Read requires OPERATOR+, Write requires SITE_ADMIN+.
 */
const zoneRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/zones — List all zones for site with stats
  fastify.get<{
    Querystring: { siteId?: string; type?: string; restricted?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.query.siteId || request.jwtUser.siteIds[0];
    const where: any = { siteId };

    if (request.query.type) where.type = request.query.type;
    if (request.query.restricted === 'true') where.isRestrictedArea = true;

    const zones = await fastify.prisma.accessZone.findMany({
      where,
      include: {
        doorAssignments: {
          include: {
            door: { select: { id: true, name: true, status: true, buildingId: true, isExterior: true } },
          },
        },
        _count: { select: { doorAssignments: true, credentials: true } },
      },
      orderBy: { name: 'asc' },
    });

    return zones;
  });

  // GET /api/v1/zones/:id — Zone detail
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const zone = await fastify.prisma.accessZone.findUnique({
        where: { id: request.params.id },
        include: {
          doorAssignments: {
            include: {
              door: {
                select: {
                  id: true, name: true, status: true, buildingId: true,
                  building: { select: { name: true } },
                  floor: true, isExterior: true, isEmergencyExit: true,
                },
              },
            },
          },
          credentials: {
            include: {
              credential: {
                select: {
                  id: true, credentialType: true, status: true,
                  cardholder: { select: { firstName: true, lastName: true, personType: true } },
                },
              },
            },
            take: 50,
          },
          _count: { select: { doorAssignments: true, credentials: true } },
        },
      });

      if (!zone) return reply.code(404).send({ error: 'Zone not found' });

      // IDOR protection: verify user has access to this zone's site
      if (!request.jwtUser.siteIds.includes(zone.siteId)) {
        return reply.code(404).send({ error: 'Zone not found' });
      }

      return zone;
    },
  );

  // POST /api/v1/zones — Create new zone
  fastify.post<{
    Body: {
      siteId?: string;
      name: string;
      description?: string;
      type?: string;
      isRestrictedArea?: boolean;
      requiresApproval?: boolean;
      accessSchedule?: { days: number[]; startTime: string; endTime: string }[];
      doorIds?: string[];
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const siteId = request.body.siteId || request.jwtUser.siteIds[0];
    const { name, description, type, isRestrictedArea, requiresApproval, accessSchedule, doorIds } = request.body;

    if (!name) return reply.code(400).send({ error: 'name is required' });

    const zone = await fastify.prisma.accessZone.create({
      data: {
        siteId,
        name: sanitizeText(name),
        description: description ? sanitizeText(description) : undefined,
        type: (type as any) || 'PUBLIC',
        isRestrictedArea: isRestrictedArea || false,
        requiresApproval: requiresApproval || false,
        accessSchedule: accessSchedule || undefined,
        doorAssignments: doorIds && doorIds.length > 0
          ? { create: doorIds.map((doorId) => ({ doorId })) }
          : undefined,
      },
      include: {
        doorAssignments: { include: { door: { select: { id: true, name: true } } } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'ACCESS_ZONE_CREATED',
        entity: 'AccessZone',
        entityId: zone.id,
        details: { name, type: type || 'PUBLIC', isRestrictedArea, doorCount: doorIds?.length || 0 },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(zone);
  });

  // PUT /api/v1/zones/:id — Update zone
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      type?: string;
      isRestrictedArea?: boolean;
      requiresApproval?: boolean;
      accessSchedule?: { days: number[]; startTime: string; endTime: string }[] | null;
    };
  }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const zone = await fastify.prisma.accessZone.findUnique({ where: { id: request.params.id } });
    if (!zone) return reply.code(404).send({ error: 'Zone not found' });
    if (!request.jwtUser.siteIds.includes(zone.siteId)) {
      return reply.code(404).send({ error: 'Zone not found' });
    }

    const { name, description, type, isRestrictedArea, requiresApproval, accessSchedule } = request.body;

    const updated = await fastify.prisma.accessZone.update({
      where: { id: request.params.id },
      data: {
        ...(name !== undefined && { name: sanitizeText(name) }),
        ...(description !== undefined && { description: description ? sanitizeText(description) : null }),
        ...(type !== undefined && { type: type as any }),
        ...(isRestrictedArea !== undefined && { isRestrictedArea }),
        ...(requiresApproval !== undefined && { requiresApproval }),
        ...(accessSchedule !== undefined && { accessSchedule: accessSchedule === null ? 'DbNull' as any : accessSchedule }),
      },
      include: {
        doorAssignments: { include: { door: { select: { id: true, name: true } } } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: zone.siteId,
        userId: request.jwtUser.id,
        action: 'ACCESS_ZONE_UPDATED',
        entity: 'AccessZone',
        entityId: zone.id,
        details: { changes: request.body },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // DELETE /api/v1/zones/:id — Delete zone
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const zone = await fastify.prisma.accessZone.findUnique({ where: { id: request.params.id } });
      if (!zone) return reply.code(404).send({ error: 'Zone not found' });

      await fastify.prisma.accessZone.delete({ where: { id: request.params.id } });

      await fastify.prisma.auditLog.create({
        data: {
          siteId: zone.siteId,
          userId: request.jwtUser.id,
          action: 'ACCESS_ZONE_DELETED',
          entity: 'AccessZone',
          entityId: zone.id,
          details: { name: zone.name },
          ipAddress: request.ip,
        },
      });

      return { message: `Zone "${zone.name}" deleted` };
    },
  );

  // PUT /api/v1/zones/:id/doors — Replace door assignments for zone
  fastify.put<{
    Params: { id: string };
    Body: { doorIds: string[] };
  }>('/:id/doors', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const zone = await fastify.prisma.accessZone.findUnique({ where: { id: request.params.id } });
    if (!zone) return reply.code(404).send({ error: 'Zone not found' });

    // Delete existing and replace
    await fastify.prisma.doorZoneAssignment.deleteMany({ where: { zoneId: zone.id } });

    if (request.body.doorIds.length > 0) {
      await fastify.prisma.doorZoneAssignment.createMany({
        data: request.body.doorIds.map((doorId) => ({ doorId, zoneId: zone.id })),
      });
    }

    const updated = await fastify.prisma.accessZone.findUnique({
      where: { id: zone.id },
      include: {
        doorAssignments: { include: { door: { select: { id: true, name: true } } } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: zone.siteId,
        userId: request.jwtUser.id,
        action: 'ZONE_DOORS_UPDATED',
        entity: 'AccessZone',
        entityId: zone.id,
        details: { doorIds: request.body.doorIds, doorCount: request.body.doorIds.length },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // POST /api/v1/zones/:id/lockdown — Zone-level lockdown
  fastify.post<{ Params: { id: string }; Body: { trainingMode?: boolean } }>(
    '/:id/lockdown',
    { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] },
    async (request, reply) => {
      const zone = await fastify.prisma.accessZone.findUnique({
        where: { id: request.params.id },
        include: { doorAssignments: true },
      });
      if (!zone) return reply.code(404).send({ error: 'Zone not found' });

      if (zone.doorAssignments.length === 0) {
        return reply.code(400).send({ error: 'Zone has no doors assigned' });
      }

      const trainingMode = request.body.trainingMode === true;
      const siteId = zone.siteId;

      const doorIds = zone.doorAssignments.map((da) => da.doorId);
      const result = await fastify.prisma.door.updateMany({
        where: { id: { in: doorIds }, isEmergencyExit: false },
        data: { status: 'LOCKED' },
      });

      const lockdown = await fastify.prisma.lockdownCommand.create({
        data: {
          siteId,
          scope: 'ZONE' as any,
          targetId: zone.id,
          initiatedById: request.jwtUser.id,
          doorsLocked: result.count,
          metadata: { trainingMode, zoneName: zone.name },
        },
      });

      fastify.wsManager.broadcastToSite(siteId, 'lockdown:initiated', {
        ...lockdown,
        zoneName: zone.name,
      });

      await fastify.prisma.auditLog.create({
        data: {
          siteId,
          userId: request.jwtUser.id,
          action: 'ZONE_LOCKDOWN_INITIATED',
          entity: 'AccessZone',
          entityId: zone.id,
          details: { zoneName: zone.name, doorsLocked: result.count, trainingMode },
          ipAddress: request.ip,
        },
      });

      return reply.code(201).send(lockdown);
    },
  );

  // GET /api/v1/zones/:id/access-check — Check if access is allowed at current time
  fastify.get<{ Params: { id: string } }>(
    '/:id/access-check',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const zone = await fastify.prisma.accessZone.findUnique({
        where: { id: request.params.id },
      });
      if (!zone) return reply.code(404).send({ error: 'Zone not found' });

      const schedule = zone.accessSchedule as { days: number[]; startTime: string; endTime: string }[] | null;

      // No schedule = always accessible
      if (!schedule || schedule.length === 0) {
        return { allowed: true, reason: 'No access schedule configured — always accessible' };
      }

      const now = new Date();
      const currentDay = now.getDay(); // 0=Sun, 6=Sat
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      for (const window of schedule) {
        if (window.days.includes(currentDay) && currentTime >= window.startTime && currentTime <= window.endTime) {
          return { allowed: true, reason: `Within schedule: ${window.startTime}-${window.endTime}` };
        }
      }

      return {
        allowed: false,
        reason: `Outside access schedule. Current: ${currentDay} ${currentTime}`,
        schedule,
      };
    },
  );
};

export default zoneRoutes;
