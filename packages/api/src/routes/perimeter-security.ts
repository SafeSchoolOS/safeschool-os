import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const perimeterSecurityRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════
  // Sensors
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId?: string; type?: string; status?: string };
  }>('/sensors', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, type, status } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds }, isActive: true };
    if (siteId) where.siteId = siteId;
    if (type) where.type = type;
    if (status) where.status = status;

    return fastify.prisma.perimeterSensor.findMany({
      where,
      include: { _count: { select: { events: true } } },
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
    });
  });

  fastify.post<{
    Body: {
      siteId: string;
      name: string;
      type: string;
      zone?: string;
      lat?: number;
      lng?: number;
      serialNumber?: string;
      manufacturer?: string;
      sensitivity?: number;
    };
  }>('/sensors', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, name, type, zone, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const sensor = await fastify.prisma.perimeterSensor.create({
      data: {
        siteId,
        name: sanitizeText(name),
        type: type as any,
        zone: zone ? sanitizeText(zone) : null,
        ...rest,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'PERIMETER_SENSOR_CREATED',
        entity: 'PerimeterSensor',
        entityId: sensor.id,
        details: { name, type, zone },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(sensor);
  });

  fastify.patch<{
    Params: { sensorId: string };
    Body: { name?: string; status?: string; sensitivity?: number; zone?: string; isActive?: boolean };
  }>('/sensors/:sensorId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const sensor = await fastify.prisma.perimeterSensor.findFirst({
      where: { id: request.params.sensorId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!sensor) return reply.code(404).send({ error: 'Sensor not found' });

    const { name, zone, status, ...data } = request.body;
    const updateData: any = { ...data };
    if (name) updateData.name = sanitizeText(name);
    if (zone) updateData.zone = sanitizeText(zone);
    if (status) updateData.status = status as any;

    return fastify.prisma.perimeterSensor.update({ where: { id: sensor.id }, data: updateData });
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────
  fastify.post<{
    Params: { sensorId: string };
  }>('/sensors/:sensorId/heartbeat', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const sensor = await fastify.prisma.perimeterSensor.findFirst({
      where: { id: request.params.sensorId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!sensor) return reply.code(404).send({ error: 'Sensor not found' });

    return fastify.prisma.perimeterSensor.update({
      where: { id: sensor.id },
      data: { lastHeartbeatAt: new Date(), status: 'ONLINE' },
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Events
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId?: string; sensorId?: string; eventType?: string; status?: string; from?: string; to?: string; limit?: string };
  }>('/events', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, sensorId, eventType, status, from, to, limit } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (sensorId) where.sensorId = sensorId;
    if (eventType) where.eventType = eventType;
    if (status) where.status = status;
    if (from || to) {
      where.detectedAt = {};
      if (from) where.detectedAt.gte = new Date(from);
      if (to) where.detectedAt.lte = new Date(to);
    }

    return fastify.prisma.perimeterEvent.findMany({
      where,
      include: { sensor: { select: { id: true, name: true, type: true, zone: true } } },
      orderBy: { detectedAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 200),
    });
  });

  // ── Ingest event ──────────────────────────────────────────────────────
  fastify.post<{
    Body: {
      siteId: string;
      sensorId: string;
      eventType: string;
      severity?: string;
      lat?: number;
      lng?: number;
      description?: string;
      imageUrl?: string;
      videoClipUrl?: string;
      vehiclePlate?: string;
      vehicleDescription?: string;
    };
  }>('/events', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, sensorId, eventType, description, vehicleDescription, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const sensor = await fastify.prisma.perimeterSensor.findFirst({ where: { id: sensorId, siteId } });
    if (!sensor) return reply.code(404).send({ error: 'Sensor not found' });

    // Check vehicle plate against whitelist
    let isKnownVehicle = false;
    if (rest.vehiclePlate) {
      const whitelisted = await fastify.prisma.vehicleWhitelist.findFirst({
        where: { siteId, plateNumber: rest.vehiclePlate, isActive: true },
      });
      isKnownVehicle = !!whitelisted;
    }

    const event = await fastify.prisma.perimeterEvent.create({
      data: {
        siteId,
        sensorId,
        eventType: eventType as any,
        description: description ? sanitizeText(description) : null,
        vehicleDescription: vehicleDescription ? sanitizeText(vehicleDescription) : null,
        ...rest,
      },
      include: { sensor: { select: { id: true, name: true, zone: true } } },
    });

    // Alert unless it's a known vehicle
    if (!isKnownVehicle) {
      fastify.wsManager?.broadcastToSite(siteId, 'perimeter.event', {
        eventId: event.id,
        sensorName: sensor.name,
        zone: sensor.zone,
        eventType,
        severity: rest.severity || 'MEDIUM',
        vehiclePlate: rest.vehiclePlate,
        detectedAt: event.detectedAt,
      });

      await fastify.prisma.perimeterEvent.update({
        where: { id: event.id },
        data: { alertSentAt: new Date() },
      });
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'PERIMETER_EVENT_INGESTED',
        entity: 'PerimeterEvent',
        entityId: event.id,
        details: { eventType, sensorName: sensor.name, isKnownVehicle },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({ ...event, isKnownVehicle });
  });

  // ── Review event ──────────────────────────────────────────────────────
  fastify.patch<{
    Params: { eventId: string };
    Body: { status?: string; reviewNotes?: string };
  }>('/events/:eventId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const event = await fastify.prisma.perimeterEvent.findFirst({
      where: { id: request.params.eventId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!event) return reply.code(404).send({ error: 'Event not found' });

    const data: any = { reviewedById: request.jwtUser.id, reviewedAt: new Date() };
    if (request.body.status) data.status = request.body.status as any;
    if (request.body.reviewNotes) data.reviewNotes = sanitizeText(request.body.reviewNotes);

    return fastify.prisma.perimeterEvent.update({ where: { id: event.id }, data });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Vehicle Whitelist
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId: string; ownerType?: string; limit?: string };
  }>('/vehicles', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, ownerType, limit } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    const where: any = { siteId, isActive: true };
    if (ownerType) where.ownerType = ownerType;

    return fastify.prisma.vehicleWhitelist.findMany({
      where,
      orderBy: { ownerName: 'asc' },
      take: Math.min(parseInt(limit || '100'), 500),
    });
  });

  fastify.post<{
    Body: {
      siteId: string;
      plateNumber: string;
      plateState?: string;
      ownerName?: string;
      ownerType?: string;
      vehicleMake?: string;
      vehicleModel?: string;
      vehicleColor?: string;
      vehicleYear?: number;
      validFrom?: string;
      validUntil?: string;
    };
  }>('/vehicles', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, plateNumber, ownerName, validFrom, validUntil, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const vehicle = await fastify.prisma.vehicleWhitelist.create({
      data: {
        siteId,
        plateNumber: plateNumber.toUpperCase().replace(/\s/g, ''),
        ownerName: ownerName ? sanitizeText(ownerName) : null,
        validFrom: validFrom ? new Date(validFrom) : null,
        validUntil: validUntil ? new Date(validUntil) : null,
        ...rest,
      },
    });

    return reply.code(201).send(vehicle);
  });

  fastify.delete<{
    Params: { vehicleId: string };
  }>('/vehicles/:vehicleId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const vehicle = await fastify.prisma.vehicleWhitelist.findFirst({
      where: { id: request.params.vehicleId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!vehicle) return reply.code(404).send({ error: 'Vehicle not found' });

    await fastify.prisma.vehicleWhitelist.update({
      where: { id: vehicle.id },
      data: { isActive: false },
    });
    return reply.code(204).send();
  });

  // ── Dashboard ─────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/dashboard', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const twentyFourHours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [sensorStatus, recentEvents, unreviewedCount, eventsByType] = await Promise.all([
      fastify.prisma.perimeterSensor.groupBy({ by: ['status'], where: { siteId, isActive: true }, _count: true }),
      fastify.prisma.perimeterEvent.count({ where: { siteId, detectedAt: { gte: twentyFourHours } } }),
      fastify.prisma.perimeterEvent.count({ where: { siteId, status: 'UNREVIEWED' } }),
      fastify.prisma.perimeterEvent.groupBy({
        by: ['eventType'],
        where: { siteId, detectedAt: { gte: twentyFourHours } },
        _count: true,
      }),
    ]);

    const sensors: Record<string, number> = {};
    for (const s of sensorStatus) sensors[s.status] = s._count;

    return {
      sensors: { online: sensors['ONLINE'] || 0, offline: sensors['OFFLINE'] || 0, triggered: sensors['TRIGGERED'] || 0, total: Object.values(sensors).reduce((a, b) => a + b, 0) },
      events24h: recentEvents,
      unreviewedEvents: unreviewedCount,
      eventsByType: eventsByType.map((e) => ({ type: e.eventType, count: e._count })),
    };
  });
};

export default perimeterSecurityRoutes;
