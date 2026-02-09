import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const transportationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/transportation/buses — List buses for site
  fastify.get('/buses', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];

    return fastify.prisma.bus.findMany({
      where: { siteId },
      include: { routeAssignments: { include: { route: true } } },
      orderBy: { busNumber: 'asc' },
    });
  });

  // POST /api/v1/transportation/buses — Create bus
  fastify.post<{
    Body: {
      busNumber: string;
      driverId?: string;
      capacity?: number;
      hasRfidReader?: boolean;
      hasPanicButton?: boolean;
      hasCameras?: boolean;
    };
  }>('/buses', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const { busNumber, driverId, capacity, hasRfidReader, hasPanicButton, hasCameras } = request.body;
    if (!busNumber) return reply.code(400).send({ error: 'busNumber is required' });

    const bus = await fastify.prisma.bus.create({
      data: { siteId, busNumber, driverId, capacity, hasRfidReader, hasPanicButton, hasCameras },
    });

    return reply.code(201).send(bus);
  });

  // PATCH /api/v1/transportation/buses/:id — Update bus
  fastify.patch<{
    Params: { id: string };
    Body: Record<string, any>;
  }>('/buses/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { id } = request.params;
    const allowedFields = ['busNumber', 'driverId', 'capacity', 'hasRfidReader', 'hasPanicButton', 'hasCameras', 'isActive'];
    const data: any = {};
    for (const key of allowedFields) {
      if (key in request.body) data[key] = request.body[key];
    }

    const bus = await fastify.prisma.bus.update({ where: { id }, data });
    return bus;
  });

  // GET /api/v1/transportation/routes — List routes
  fastify.get('/routes', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];

    return fastify.prisma.busRoute.findMany({
      where: { siteId },
      include: { stops: { orderBy: { stopOrder: 'asc' } } },
      orderBy: { routeNumber: 'asc' },
    });
  });

  // POST /api/v1/transportation/routes — Create route with stops
  fastify.post<{
    Body: {
      name: string;
      routeNumber: string;
      scheduledDepartureTime: string;
      scheduledArrivalTime: string;
      isAmRoute?: boolean;
      isPmRoute?: boolean;
      stops?: { name: string; address: string; latitude: number; longitude: number; scheduledTime: string; stopOrder: number }[];
    };
  }>('/routes', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const { name, routeNumber, scheduledDepartureTime, scheduledArrivalTime, isAmRoute, isPmRoute, stops } = request.body;
    if (!name || !routeNumber) return reply.code(400).send({ error: 'name and routeNumber are required' });

    const route = await fastify.prisma.busRoute.create({
      data: {
        siteId,
        name,
        routeNumber,
        scheduledDepartureTime,
        scheduledArrivalTime,
        isAmRoute,
        isPmRoute,
        stops: stops ? { create: stops } : undefined,
      },
      include: { stops: { orderBy: { stopOrder: 'asc' } } },
    });

    return reply.code(201).send(route);
  });

  // GET /api/v1/transportation/routes/:id — Route detail with stops
  fastify.get<{ Params: { id: string } }>(
    '/routes/:id',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request, reply) => {
      const route = await fastify.prisma.busRoute.findUnique({
        where: { id: request.params.id },
        include: {
          stops: {
            orderBy: { stopOrder: 'asc' },
            include: { studentAssignments: { include: { studentCard: true } } },
          },
          busAssignments: { include: { bus: true } },
        },
      });
      if (!route) return reply.code(404).send({ error: 'Route not found' });
      return route;
    },
  );

  // POST /api/v1/transportation/gps — GPS update from bus hardware
  fastify.post<{
    Body: {
      busId: string;
      latitude: number;
      longitude: number;
      speed?: number;
      heading?: number;
    };
  }>('/gps', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { busId, latitude, longitude, speed, heading } = request.body;
    if (!busId || latitude == null || longitude == null) {
      return reply.code(400).send({ error: 'busId, latitude, and longitude are required' });
    }

    // Update bus position
    const bus = await fastify.prisma.bus.update({
      where: { id: busId },
      data: {
        currentLatitude: latitude,
        currentLongitude: longitude,
        currentSpeed: speed,
        currentHeading: heading,
        lastGpsAt: new Date(),
      },
    });

    // Enqueue GPS processing job
    await fastify.alertQueue.add('process-gps-update', {
      busId,
      latitude,
      longitude,
      speed,
      heading,
      timestamp: new Date().toISOString(),
    });

    fastify.wsManager.broadcastToSite(bus.siteId, 'bus:gps-update', {
      busId,
      busNumber: bus.busNumber,
      latitude,
      longitude,
      speed,
      heading,
    });

    return { success: true };
  });

  // POST /api/v1/transportation/scan — RFID scan from bus reader
  fastify.post<{
    Body: {
      cardId: string;
      busId: string;
      scanType: 'BOARD' | 'EXIT';
    };
  }>('/scan', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { cardId, busId, scanType } = request.body;
    if (!cardId || !busId || !scanType) {
      return reply.code(400).send({ error: 'cardId, busId, and scanType are required' });
    }

    // Look up student card
    const studentCard = await fastify.prisma.studentCard.findUnique({ where: { cardId } });
    if (!studentCard) return reply.code(404).send({ error: 'Student card not found' });

    // Get bus with route
    const bus = await fastify.prisma.bus.findUnique({
      where: { id: busId },
      include: { routeAssignments: true },
    });
    if (!bus) return reply.code(404).send({ error: 'Bus not found' });

    const routeId = bus.routeAssignments[0]?.routeId || '';

    // Create ridership event
    const event = await fastify.prisma.ridershipEvent.create({
      data: {
        studentCardId: studentCard.id,
        busId,
        routeId,
        scanType,
        scanMethod: 'RFID',
        scannedAt: new Date(),
      },
    });

    // Update student count on bus
    const countDelta = scanType === 'BOARD' ? 1 : -1;
    await fastify.prisma.bus.update({
      where: { id: busId },
      data: { currentStudentCount: { increment: countDelta } },
    });

    // Enqueue notification job
    await fastify.alertQueue.add('process-rfid-scan', {
      studentCardId: studentCard.id,
      studentName: studentCard.studentName,
      busId,
      busNumber: bus.busNumber,
      routeId,
      scanType,
      scannedAt: event.scannedAt.toISOString(),
    });

    fastify.wsManager.broadcastToSite(bus.siteId, 'bus:rfid-scan', {
      studentName: studentCard.studentName,
      busNumber: bus.busNumber,
      scanType,
      scannedAt: event.scannedAt,
    });

    return reply.code(201).send(event);
  });

  // GET /api/v1/transportation/student/:cardId/status
  fastify.get<{ Params: { cardId: string } }>(
    '/student/:cardId/status',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request, reply) => {
      const studentCard = await fastify.prisma.studentCard.findUnique({
        where: { cardId: request.params.cardId },
      });
      if (!studentCard) return reply.code(404).send({ error: 'Student not found' });

      const latestEvent = await fastify.prisma.ridershipEvent.findFirst({
        where: { studentCardId: studentCard.id },
        orderBy: { scannedAt: 'desc' },
        include: { bus: true, route: true },
      });

      return {
        student: studentCard,
        latestEvent,
        status: latestEvent?.scanType === 'BOARD' ? 'ON_BUS' : 'OFF_BUS',
      };
    },
  );

  // GET /api/v1/transportation/parents/:studentCardId
  fastify.get<{ Params: { studentCardId: string } }>(
    '/parents/:studentCardId',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request) => {
      return fastify.prisma.parentContact.findMany({
        where: { studentCardId: request.params.studentCardId },
      });
    },
  );

  // POST /api/v1/transportation/parents — Add parent contact
  fastify.post<{
    Body: {
      studentCardId: string;
      parentName: string;
      relationship: string;
      phone?: string;
      email?: string;
    };
  }>('/parents', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { studentCardId, parentName, relationship, phone, email } = request.body;
    if (!studentCardId || !parentName || !relationship) {
      return reply.code(400).send({ error: 'studentCardId, parentName, and relationship are required' });
    }

    const contact = await fastify.prisma.parentContact.create({
      data: { studentCardId, parentName, relationship, phone, email },
    });

    return reply.code(201).send(contact);
  });

  // PATCH /api/v1/transportation/parents/:id/preferences
  fastify.patch<{
    Params: { id: string };
    Body: {
      boardAlerts?: boolean;
      exitAlerts?: boolean;
      etaAlerts?: boolean;
      delayAlerts?: boolean;
      missedBusAlerts?: boolean;
      smsEnabled?: boolean;
      emailEnabled?: boolean;
      pushEnabled?: boolean;
    };
  }>('/parents/:id/preferences', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const data: any = {};
    const fields = ['boardAlerts', 'exitAlerts', 'etaAlerts', 'delayAlerts', 'missedBusAlerts', 'smsEnabled', 'emailEnabled', 'pushEnabled'];
    for (const field of fields) {
      if (field in request.body) data[field] = (request.body as any)[field];
    }

    return fastify.prisma.parentContact.update({
      where: { id: request.params.id },
      data,
    });
  });
};

export default transportationRoutes;
