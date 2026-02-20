import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const bleTrackingRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════
  // Beacons — CRUD
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId?: string; buildingId?: string; status?: string; floor?: string };
  }>('/beacons', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, buildingId, status, floor } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (buildingId) where.buildingId = buildingId;
    if (status) where.status = status;
    if (floor) where.floor = parseInt(floor);

    return fastify.prisma.bLEBeacon.findMany({
      where,
      include: { building: { select: { id: true, name: true } } },
      orderBy: [{ building: { name: 'asc' } }, { floor: 'asc' }, { name: 'asc' }],
    });
  });

  fastify.post<{
    Body: {
      siteId: string;
      buildingId: string;
      roomId?: string;
      uuid: string;
      major: number;
      minor: number;
      name: string;
      floor?: number;
      lat?: number;
      lng?: number;
      mapX?: number;
      mapY?: number;
      txPower?: number;
    };
  }>('/beacons', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, name, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const beacon = await fastify.prisma.bLEBeacon.create({
      data: { siteId, name: sanitizeText(name), ...rest },
      include: { building: { select: { id: true, name: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'BLE_BEACON_CREATED',
        entity: 'BLEBeacon',
        entityId: beacon.id,
        details: { name, uuid: rest.uuid, major: rest.major, minor: rest.minor },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(beacon);
  });

  fastify.patch<{
    Params: { beaconId: string };
    Body: { name?: string; status?: string; batteryLevel?: number; txPower?: number; mapX?: number; mapY?: number };
  }>('/beacons/:beaconId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const beacon = await fastify.prisma.bLEBeacon.findFirst({
      where: { id: request.params.beaconId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!beacon) return reply.code(404).send({ error: 'Beacon not found' });

    const { name, status, ...data } = request.body;
    const updateData: any = { ...data };
    if (name) updateData.name = sanitizeText(name);
    if (status) updateData.status = status as any;

    return fastify.prisma.bLEBeacon.update({ where: { id: beacon.id }, data: updateData });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Location Pings — Ingest proximity readings from mobile devices
  // ══════════════════════════════════════════════════════════════════════

  fastify.post<{
    Body: {
      siteId: string;
      personType: string;
      personId: string;
      beaconUuid: string;
      beaconMajor: number;
      beaconMinor: number;
      rssi: number;
      accuracy?: number;
    };
  }>('/pings', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const { siteId, personType, personId, beaconUuid, beaconMajor, beaconMinor, rssi, accuracy } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Resolve beacon to building/room
    const beacon = await fastify.prisma.bLEBeacon.findFirst({
      where: { uuid: beaconUuid, major: beaconMajor, minor: beaconMinor },
    });

    const ping = await fastify.prisma.locationPing.create({
      data: {
        siteId,
        personType,
        personId,
        beaconUuid,
        beaconMajor,
        beaconMinor,
        buildingId: beacon?.buildingId || null,
        roomId: beacon?.roomId || null,
        floor: beacon?.floor || null,
        lat: beacon?.lat || null,
        lng: beacon?.lng || null,
        rssi,
        accuracy: accuracy || null,
        confidence: rssi > -60 ? 0.95 : rssi > -75 ? 0.75 : rssi > -90 ? 0.5 : 0.25,
      },
    });

    // Update or create current location snapshot
    if (beacon) {
      await fastify.prisma.locationSnapshot.upsert({
        where: { siteId_personType_personId: { siteId, personType, personId } },
        create: {
          siteId,
          personType,
          personId,
          buildingId: beacon.buildingId,
          roomId: beacon.roomId,
          floor: beacon.floor,
          lat: beacon.lat,
          lng: beacon.lng,
          confidence: ping.confidence,
          lastSeenAt: new Date(),
        },
        update: {
          buildingId: beacon.buildingId,
          roomId: beacon.roomId,
          floor: beacon.floor,
          lat: beacon.lat,
          lng: beacon.lng,
          confidence: ping.confidence,
          lastSeenAt: new Date(),
        },
      });

      // Update beacon's last seen
      await fastify.prisma.bLEBeacon.update({
        where: { id: beacon.id },
        data: { lastSeenAt: new Date() },
      });
    }

    return reply.code(201).send(ping);
  });

  // ── Batch pings (mobile app sends multiple at once) ───────────────────
  fastify.post<{
    Body: {
      siteId: string;
      personType: string;
      personId: string;
      readings: Array<{ beaconUuid: string; beaconMajor: number; beaconMinor: number; rssi: number }>;
    };
  }>('/pings/batch', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const { siteId, personType, personId, readings } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Find the strongest signal (closest beacon)
    const sorted = [...readings].sort((a, b) => b.rssi - a.rssi);
    const strongest = sorted[0];
    if (!strongest) return reply.code(400).send({ error: 'No readings provided' });

    const beacon = await fastify.prisma.bLEBeacon.findFirst({
      where: { uuid: strongest.beaconUuid, major: strongest.beaconMajor, minor: strongest.beaconMinor },
    });

    // Store the best ping
    const ping = await fastify.prisma.locationPing.create({
      data: {
        siteId,
        personType,
        personId,
        beaconUuid: strongest.beaconUuid,
        beaconMajor: strongest.beaconMajor,
        beaconMinor: strongest.beaconMinor,
        buildingId: beacon?.buildingId || null,
        roomId: beacon?.roomId || null,
        floor: beacon?.floor || null,
        lat: beacon?.lat || null,
        lng: beacon?.lng || null,
        rssi: strongest.rssi,
        confidence: strongest.rssi > -60 ? 0.95 : strongest.rssi > -75 ? 0.75 : 0.5,
      },
    });

    // Update snapshot
    if (beacon) {
      await fastify.prisma.locationSnapshot.upsert({
        where: { siteId_personType_personId: { siteId, personType, personId } },
        create: {
          siteId, personType, personId,
          buildingId: beacon.buildingId, roomId: beacon.roomId,
          floor: beacon.floor, lat: beacon.lat, lng: beacon.lng,
          confidence: ping.confidence, lastSeenAt: new Date(),
        },
        update: {
          buildingId: beacon.buildingId, roomId: beacon.roomId,
          floor: beacon.floor, lat: beacon.lat, lng: beacon.lng,
          confidence: ping.confidence, lastSeenAt: new Date(),
        },
      });
    }

    return reply.code(201).send({ processed: readings.length, bestMatch: ping });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Location Queries — Current positions & history
  // ══════════════════════════════════════════════════════════════════════

  // ── Current location of all people at a site ──────────────────────────
  fastify.get<{
    Querystring: { siteId: string; personType?: string; buildingId?: string; floor?: string };
  }>('/locations', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, personType, buildingId, floor } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const where: any = { siteId };
    if (personType) where.personType = personType;
    if (buildingId) where.buildingId = buildingId;
    if (floor) where.floor = parseInt(floor);

    // Only show snapshots from last 15 minutes (stale = person left)
    const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);
    where.lastSeenAt = { gte: staleThreshold };

    return fastify.prisma.locationSnapshot.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
    });
  });

  // ── Location of a specific person ─────────────────────────────────────
  fastify.get<{
    Params: { personType: string; personId: string };
    Querystring: { siteId: string };
  }>('/locations/:personType/:personId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { personType, personId } = request.params;
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const snapshot = await fastify.prisma.locationSnapshot.findUnique({
      where: { siteId_personType_personId: { siteId, personType, personId } },
    });

    const recentPings = await fastify.prisma.locationPing.findMany({
      where: { siteId, personType, personId },
      orderBy: { pingedAt: 'desc' },
      take: 20,
    });

    return { current: snapshot, recentPings };
  });

  // ── Building/room occupancy (heatmap data) ────────────────────────────
  fastify.get<{
    Querystring: { siteId: string; buildingId?: string };
  }>('/occupancy', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, buildingId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);
    const where: any = { siteId, lastSeenAt: { gte: staleThreshold } };
    if (buildingId) where.buildingId = buildingId;

    const byRoom = await fastify.prisma.locationSnapshot.groupBy({
      by: ['buildingId', 'roomId', 'floor'],
      where,
      _count: true,
    });

    const byBuilding = await fastify.prisma.locationSnapshot.groupBy({
      by: ['buildingId'],
      where: { siteId, lastSeenAt: { gte: staleThreshold } },
      _count: true,
    });

    return {
      byRoom: byRoom.map((r) => ({ buildingId: r.buildingId, roomId: r.roomId, floor: r.floor, count: r._count })),
      byBuilding: byBuilding.map((b) => ({ buildingId: b.buildingId, count: b._count })),
    };
  });

  // ── Dashboard summary ─────────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/dashboard', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);

    const [beaconStatus, activePeople, byPersonType] = await Promise.all([
      fastify.prisma.bLEBeacon.groupBy({ by: ['status'], where: { siteId }, _count: true }),
      fastify.prisma.locationSnapshot.count({ where: { siteId, lastSeenAt: { gte: staleThreshold } } }),
      fastify.prisma.locationSnapshot.groupBy({
        by: ['personType'],
        where: { siteId, lastSeenAt: { gte: staleThreshold } },
        _count: true,
      }),
    ]);

    const beacons: Record<string, number> = {};
    for (const b of beaconStatus) beacons[b.status] = b._count;

    return {
      beacons: { active: beacons['ACTIVE'] || 0, lowBattery: beacons['LOW_BATTERY'] || 0, offline: beacons['OFFLINE'] || 0, total: Object.values(beacons).reduce((a, b) => a + b, 0) },
      activePeople,
      byPersonType: byPersonType.map((p) => ({ type: p.personType, count: p._count })),
    };
  });
};

export default bleTrackingRoutes;
