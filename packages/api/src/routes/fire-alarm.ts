import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Fire Alarm PAS Protocol Routes
 *
 * NFPA 72 Positive Alarm Sequence endpoints for managing fire alarms
 * during active lockdown/threat situations.
 *
 * Routes:
 *   GET  /fire-alarm/zones              — List fire alarm zones for a site
 *   POST /fire-alarm/zones              — Create fire alarm zone
 *   GET  /fire-alarm/events             — List fire alarm events (PAS history)
 *   GET  /fire-alarm/events/active      — Get active fire alarm event
 *   POST /fire-alarm/:alertId/acknowledge — PAS: Acknowledge fire (starts 3-min investigation)
 *   POST /fire-alarm/:alertId/confirm   — Confirm real fire (evacuate)
 *   POST /fire-alarm/:alertId/dismiss   — Dismiss as false alarm (maintain lockdown)
 *   POST /fire-alarm/:alertId/extend    — Extend investigation (active threat verified)
 *   GET  /fire-alarm/evacuation-routes  — List evacuation routes
 *   POST /fire-alarm/evacuation-routes  — Create evacuation route
 */

const fireAlarmRoutes: FastifyPluginAsync = async (fastify) => {
  // ---- Fire Alarm Zones ----

  fastify.get('/zones', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
  }, async (request, reply) => {
    const { siteId } = request.query as { siteId?: string };
    const effectiveSiteId = siteId || request.jwtUser.siteIds[0];
    if (!effectiveSiteId || !request.jwtUser.siteIds.includes(effectiveSiteId)) {
      return reply.code(403).send({ error: 'No site access' });
    }

    const zones = await fastify.prisma.fireAlarmZone.findMany({
      where: { siteId: effectiveSiteId },
      orderBy: { zoneNumber: 'asc' },
    });
    return reply.send(zones);
  });

  fastify.post('/zones', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const body = request.body as any;
    const zone = await fastify.prisma.fireAlarmZone.create({
      data: {
        siteId: body.siteId,
        buildingId: body.buildingId,
        name: sanitizeText(body.name),
        zoneNumber: sanitizeText(body.zoneNumber),
        floor: body.floor,
        description: body.description ? sanitizeText(body.description) : null,
        hasPullStations: body.hasPullStations ?? true,
        hasSmokeDetectors: body.hasSmokeDetectors ?? true,
        hasHeatDetectors: body.hasHeatDetectors ?? false,
        hasSprinklers: body.hasSprinklers ?? false,
        mapX: body.mapX,
        mapY: body.mapY,
      },
    });
    return reply.status(201).send(zone);
  });

  // ---- Fire Alarm Events (PAS history) ----

  fastify.get('/events', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
  }, async (request, reply) => {
    const { siteId, status } = request.query as { siteId?: string; status?: string };
    const effectiveSiteId = siteId || request.jwtUser.siteIds[0];
    if (!effectiveSiteId || !request.jwtUser.siteIds.includes(effectiveSiteId)) {
      return reply.code(403).send({ error: 'No site access' });
    }

    const events = await fastify.prisma.fireAlarmEvent.findMany({
      where: {
        siteId: effectiveSiteId,
        ...(status ? { status: status as any } : {}),
      },
      include: { fireAlarmZone: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return reply.send(events);
  });

  fastify.get('/events/active', {
    preHandler: [fastify.authenticate, requireMinRole('TEACHER')],
  }, async (request, reply) => {
    const { siteId } = request.query as { siteId?: string };
    const effectiveSiteId = siteId || request.jwtUser.siteIds[0];
    if (!effectiveSiteId || !request.jwtUser.siteIds.includes(effectiveSiteId)) {
      return reply.code(403).send({ error: 'No site access' });
    }

    const active = await fastify.prisma.fireAlarmEvent.findFirst({
      where: {
        siteId: effectiveSiteId,
        status: { in: ['ALARM_ACTIVE', 'ACKNOWLEDGED_ALARM', 'INVESTIGATING'] },
      },
      include: { fireAlarmZone: true },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(active || null);
  });

  // ---- PAS Decision Endpoints ----

  // Acknowledge fire alarm (starts 3-minute investigation)
  fastify.post<{ Params: { alertId: string } }>('/:alertId/acknowledge', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { AlertEngine } = await import('../services/alert-engine.js');
    const engine = new AlertEngine(fastify);

    try {
      const alert = await engine.acknowledgeFire(
        request.params.alertId,
        request.jwtUser.id,
        request.ip,
      );
      return reply.send(alert);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Confirm real fire (evacuate)
  fastify.post<{ Params: { alertId: string } }>('/:alertId/confirm', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as any;
    const { AlertEngine } = await import('../services/alert-engine.js');
    const engine = new AlertEngine(fastify);

    try {
      const alert = await engine.confirmFire(
        request.params.alertId,
        request.jwtUser.id,
        {
          directedEvacuation: body.directedEvacuation,
          evacuateZones: body.evacuateZones,
          avoidZones: body.avoidZones,
        },
        request.ip,
      );
      return reply.send(alert);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Dismiss as false alarm (maintain lockdown)
  fastify.post<{ Params: { alertId: string } }>('/:alertId/dismiss', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { AlertEngine } = await import('../services/alert-engine.js');
    const engine = new AlertEngine(fastify);

    try {
      const alert = await engine.dismissFire(
        request.params.alertId,
        request.jwtUser.id,
        request.ip,
      );
      return reply.send(alert);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Extend investigation (active threat verified)
  fastify.post<{ Params: { alertId: string } }>('/:alertId/extend', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as any;

    if (!body.reason) {
      return reply.status(400).send({ error: 'Reason is required to extend investigation' });
    }

    const { AlertEngine } = await import('../services/alert-engine.js');
    const engine = new AlertEngine(fastify);

    try {
      const alert = await engine.extendFireInvestigation(
        request.params.alertId,
        request.jwtUser.id,
        sanitizeText(body.reason),
        request.ip,
      );
      return reply.send(alert);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ---- Evacuation Routes ----

  fastify.get('/evacuation-routes', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
  }, async (request, reply) => {
    const { siteId } = request.query as { siteId?: string };
    const effectiveSiteId = siteId || request.jwtUser.siteIds[0];
    if (!effectiveSiteId || !request.jwtUser.siteIds.includes(effectiveSiteId)) {
      return reply.code(403).send({ error: 'No site access' });
    }

    const routes = await fastify.prisma.evacuationRoute.findMany({
      where: { siteId: effectiveSiteId },
      orderBy: { name: 'asc' },
    });
    return reply.send(routes);
  });

  fastify.post('/evacuation-routes', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const body = request.body as any;
    const route = await fastify.prisma.evacuationRoute.create({
      data: {
        siteId: body.siteId,
        buildingId: body.buildingId,
        name: sanitizeText(body.name),
        description: body.description ? sanitizeText(body.description) : null,
        fromZones: body.fromZones || [],
        toExit: body.toExit,
        doorIds: body.doorIds || [],
        avoidZones: body.avoidZones || [],
        isDefault: body.isDefault ?? false,
        mapPath: body.mapPath,
      },
    });
    return reply.status(201).send(route);
  });
};

export default fireAlarmRoutes;
