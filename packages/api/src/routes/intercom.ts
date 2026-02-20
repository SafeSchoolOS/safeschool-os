import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const intercomRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════
  // Devices — CRUD
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId?: string; buildingId?: string; deviceType?: string; status?: string };
  }>('/devices', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, buildingId, deviceType, status } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds }, isActive: true };
    if (siteId) where.siteId = siteId;
    if (buildingId) where.buildingId = buildingId;
    if (deviceType) where.deviceType = deviceType;
    if (status) where.status = status;

    return fastify.prisma.intercomDevice.findMany({
      where,
      include: {
        building: { select: { id: true, name: true } },
        _count: { select: { sessions: true } },
      },
      orderBy: [{ building: { name: 'asc' } }, { name: 'asc' }],
    });
  });

  fastify.post<{
    Body: {
      siteId: string;
      buildingId: string;
      doorId?: string;
      roomId?: string;
      name: string;
      deviceType: string;
      serialNumber?: string;
      ipAddress?: string;
      sipUri?: string;
      streamUrl?: string;
      hasCamera?: boolean;
      hasSpeaker?: boolean;
      hasMicrophone?: boolean;
      hasDoorRelease?: boolean;
    };
  }>('/devices', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, name, deviceType, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const device = await fastify.prisma.intercomDevice.create({
      data: {
        siteId,
        name: sanitizeText(name),
        deviceType: deviceType as any,
        ...rest,
      },
      include: { building: { select: { id: true, name: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'INTERCOM_DEVICE_CREATED',
        entity: 'IntercomDevice',
        entityId: device.id,
        details: { name, deviceType, buildingId: rest.buildingId },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(device);
  });

  fastify.patch<{
    Params: { deviceId: string };
    Body: { name?: string; status?: string; ipAddress?: string; sipUri?: string; streamUrl?: string; isActive?: boolean };
  }>('/devices/:deviceId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const device = await fastify.prisma.intercomDevice.findFirst({
      where: { id: request.params.deviceId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!device) return reply.code(404).send({ error: 'Device not found' });

    const { name, status, ...data } = request.body;
    const updateData: any = { ...data };
    if (name) updateData.name = sanitizeText(name);
    if (status) updateData.status = status as any;

    return fastify.prisma.intercomDevice.update({
      where: { id: device.id },
      data: updateData,
      include: { building: { select: { id: true, name: true } } },
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Sessions — Call initiation, answer, door release
  // ══════════════════════════════════════════════════════════════════════

  // ── Initiate a call (visitor presses buzzer at door station) ──────────
  fastify.post<{
    Body: {
      siteId: string;
      callerDeviceId: string;
      sessionType?: string;
      visitorName?: string;
      visitorPurpose?: string;
    };
  }>('/sessions', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, callerDeviceId, sessionType, visitorName, visitorPurpose } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const callerDevice = await fastify.prisma.intercomDevice.findFirst({
      where: { id: callerDeviceId, siteId },
    });
    if (!callerDevice) return reply.code(404).send({ error: 'Caller device not found' });

    const session = await fastify.prisma.intercomSession.create({
      data: {
        siteId,
        callerDeviceId,
        sessionType: (sessionType || 'DOOR_REQUEST') as any,
        status: 'RINGING',
        visitorName: visitorName ? sanitizeText(visitorName) : null,
        visitorPurpose: visitorPurpose ? sanitizeText(visitorPurpose) : null,
      },
      include: {
        callerDevice: { select: { id: true, name: true, deviceType: true, streamUrl: true } },
      },
    });

    // Broadcast ring to dashboard
    fastify.wsManager?.broadcastToSite(siteId, 'intercom.ring', {
      sessionId: session.id,
      callerDevice: {
        id: callerDevice.id,
        name: callerDevice.name,
        type: callerDevice.deviceType,
        streamUrl: callerDevice.streamUrl,
      },
      visitorName,
      visitorPurpose,
      startedAt: session.startedAt,
    });

    return reply.code(201).send(session);
  });

  // ── Answer a call ─────────────────────────────────────────────────────
  fastify.patch<{
    Params: { sessionId: string };
    Body: { receiverDeviceId?: string };
  }>('/sessions/:sessionId/answer', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const session = await fastify.prisma.intercomSession.findFirst({
      where: { id: request.params.sessionId, siteId: { in: request.jwtUser.siteIds }, status: 'RINGING' },
    });
    if (!session) return reply.code(404).send({ error: 'Session not found or not ringing' });

    const updated = await fastify.prisma.intercomSession.update({
      where: { id: session.id },
      data: {
        status: 'ACTIVE',
        answeredById: request.jwtUser.id,
        answeredAt: new Date(),
        receiverDeviceId: request.body.receiverDeviceId || null,
      },
      include: {
        callerDevice: { select: { id: true, name: true, streamUrl: true } },
      },
    });

    fastify.wsManager?.broadcastToSite(session.siteId, 'intercom.answered', {
      sessionId: session.id,
      answeredById: request.jwtUser.id,
    });

    return updated;
  });

  // ── Release door (grant entry during active session) ──────────────────
  fastify.post<{
    Params: { sessionId: string };
  }>('/sessions/:sessionId/release-door', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const session = await fastify.prisma.intercomSession.findFirst({
      where: { id: request.params.sessionId, siteId: { in: request.jwtUser.siteIds }, status: 'ACTIVE' },
      include: { callerDevice: true },
    });
    if (!session) return reply.code(404).send({ error: 'No active session found' });
    if (!session.callerDevice.hasDoorRelease) {
      return reply.code(400).send({ error: 'Device does not have door release capability' });
    }

    // Release the door
    if (session.callerDevice.doorId) {
      await fastify.prisma.door.update({
        where: { id: session.callerDevice.doorId },
        data: { status: 'UNLOCKED' },
      });
    }

    const updated = await fastify.prisma.intercomSession.update({
      where: { id: session.id },
      data: {
        doorReleased: true,
        doorReleasedAt: new Date(),
        doorReleasedById: request.jwtUser.id,
      },
    });

    fastify.wsManager?.broadcastToSite(session.siteId, 'intercom.door_released', {
      sessionId: session.id,
      doorId: session.callerDevice.doorId,
      releasedById: request.jwtUser.id,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: session.siteId,
        userId: request.jwtUser.id,
        action: 'INTERCOM_DOOR_RELEASED',
        entity: 'IntercomSession',
        entityId: session.id,
        details: {
          doorId: session.callerDevice.doorId,
          visitorName: session.visitorName,
          callerDeviceName: session.callerDevice.name,
        },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // ── End a session ─────────────────────────────────────────────────────
  fastify.patch<{
    Params: { sessionId: string };
    Body: { notes?: string };
  }>('/sessions/:sessionId/end', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const session = await fastify.prisma.intercomSession.findFirst({
      where: { id: request.params.sessionId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const status = session.status === 'RINGING' ? 'MISSED' : 'COMPLETED';

    return fastify.prisma.intercomSession.update({
      where: { id: session.id },
      data: {
        status: status as any,
        endedAt: new Date(),
        notes: request.body.notes ? sanitizeText(request.body.notes) : null,
      },
    });
  });

  // ── Recent sessions ───────────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string; status?: string; limit?: string };
  }>('/sessions', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, status, limit } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const where: any = { siteId };
    if (status) where.status = status;

    return fastify.prisma.intercomSession.findMany({
      where,
      include: {
        callerDevice: { select: { id: true, name: true, deviceType: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(parseInt(limit || '25'), 100),
    });
  });
};

export default intercomRoutes;
