import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const audioMonitoringRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════
  // Audio Sensors — CRUD
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId?: string; buildingId?: string; status?: string; isActive?: string };
  }>('/sensors', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, buildingId, status, isActive } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (buildingId) where.buildingId = buildingId;
    if (status) where.status = status;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    return fastify.prisma.audioSensor.findMany({
      where,
      include: {
        building: { select: { id: true, name: true } },
        _count: { select: { events: true } },
      },
      orderBy: [{ building: { name: 'asc' } }, { name: 'asc' }],
    });
  });

  fastify.get<{
    Params: { sensorId: string };
  }>('/sensors/:sensorId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const sensor = await fastify.prisma.audioSensor.findFirst({
      where: { id: request.params.sensorId, siteId: { in: request.jwtUser.siteIds } },
      include: {
        building: { select: { id: true, name: true } },
        events: { orderBy: { detectedAt: 'desc' }, take: 10 },
      },
    });
    if (!sensor) return reply.code(404).send({ error: 'Audio sensor not found' });
    return sensor;
  });

  fastify.post<{
    Body: {
      siteId: string;
      buildingId: string;
      roomId?: string;
      name: string;
      serialNumber?: string;
      manufacturer?: string;
      model?: string;
      firmwareVersion?: string;
      installLocation?: string;
      sensitivity?: number;
      enabledDetections?: string[];
    };
  }>('/sensors', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, ...data } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const sensor = await fastify.prisma.audioSensor.create({
      data: {
        siteId,
        ...data,
        name: sanitizeText(data.name),
        installLocation: data.installLocation ? sanitizeText(data.installLocation) : null,
      },
      include: { building: { select: { id: true, name: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'AUDIO_SENSOR_CREATED',
        entity: 'AudioSensor',
        entityId: sensor.id,
        details: { name: data.name, buildingId: data.buildingId },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(sensor);
  });

  fastify.patch<{
    Params: { sensorId: string };
    Body: {
      name?: string;
      status?: string;
      sensitivity?: number;
      enabledDetections?: string[];
      isActive?: boolean;
      firmwareVersion?: string;
      installLocation?: string;
    };
  }>('/sensors/:sensorId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const sensor = await fastify.prisma.audioSensor.findFirst({
      where: { id: request.params.sensorId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!sensor) return reply.code(404).send({ error: 'Sensor not found' });

    const data: any = { ...request.body };
    if (data.name) data.name = sanitizeText(data.name);
    if (data.status) data.status = data.status as any;

    return fastify.prisma.audioSensor.update({
      where: { id: sensor.id },
      data,
      include: { building: { select: { id: true, name: true } } },
    });
  });

  // ── Heartbeat endpoint (sensors report health) ────────────────────────
  fastify.post<{
    Params: { sensorId: string };
    Body: { firmwareVersion?: string };
  }>('/sensors/:sensorId/heartbeat', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const sensor = await fastify.prisma.audioSensor.findFirst({
      where: { id: request.params.sensorId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!sensor) return reply.code(404).send({ error: 'Sensor not found' });

    const data: any = { lastHeartbeatAt: new Date(), status: 'ONLINE' };
    if (request.body.firmwareVersion) data.firmwareVersion = request.body.firmwareVersion;

    return fastify.prisma.audioSensor.update({
      where: { id: sensor.id },
      data,
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Detection Events — Ingest, Review, Escalate
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: {
      siteId?: string;
      sensorId?: string;
      detectionType?: string;
      status?: string;
      from?: string;
      to?: string;
      minConfidence?: string;
      limit?: string;
    };
  }>('/events', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, sensorId, detectionType, status, from, to, minConfidence, limit } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (sensorId) where.sensorId = sensorId;
    if (detectionType) where.detectionType = detectionType;
    if (status) where.status = status;
    if (minConfidence) where.confidence = { gte: parseFloat(minConfidence) };
    if (from || to) {
      where.detectedAt = {};
      if (from) where.detectedAt.gte = new Date(from);
      if (to) where.detectedAt.lte = new Date(to);
    }

    return fastify.prisma.audioDetectionEvent.findMany({
      where,
      include: {
        sensor: { select: { id: true, name: true, installLocation: true, buildingId: true } },
      },
      orderBy: { detectedAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 200),
    });
  });

  // ── Ingest a detection event (from sensor or ML pipeline) ─────────────
  fastify.post<{
    Body: {
      siteId: string;
      sensorId: string;
      detectionType: string;
      confidence: number;
      decibelLevel?: number;
      durationMs?: number;
      audioClipUrl?: string;
      waveformData?: Record<string, unknown>;
    };
  }>('/events', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, sensorId, detectionType, confidence, ...data } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Verify sensor exists
    const sensor = await fastify.prisma.audioSensor.findFirst({
      where: { id: sensorId, siteId },
    });
    if (!sensor) return reply.code(404).send({ error: 'Sensor not found' });

    const event = await fastify.prisma.audioDetectionEvent.create({
      data: {
        siteId,
        sensorId,
        detectionType: detectionType as any,
        confidence,
        ...data,
      },
      include: {
        sensor: { select: { id: true, name: true, installLocation: true } },
      },
    });

    // Check site config for auto-alert/auto-incident thresholds
    const config = await fastify.prisma.audioMonitorConfig.findUnique({ where: { siteId } });

    let alertSent = false;
    let incidentCreated = false;

    if (config) {
      if (confidence >= config.autoAlertThreshold) {
        // Send WebSocket alert
        fastify.wsManager?.broadcastToSite(siteId, 'audio.detection', {
          eventId: event.id,
          sensorId,
          sensorName: sensor.name,
          sensorLocation: sensor.installLocation,
          detectionType,
          confidence,
          detectedAt: event.detectedAt,
        });

        await fastify.prisma.audioDetectionEvent.update({
          where: { id: event.id },
          data: { alertSentAt: new Date() },
        });
        alertSent = true;
      }

      if (confidence >= config.autoIncidentThreshold) {
        // Auto-create an incident for very high confidence detections
        const incident = await fastify.prisma.incident.create({
          data: {
            siteId,
            type: detectionType === 'GUNSHOT' ? 'ACTIVE_SHOOTER' : 'OTHER' as any,
            severity: 'HIGH_INCIDENT' as any,
            triggeredBy: `audio_sensor:${sensor.name}`,
            triggerDeviceId: sensorId,
            triggerBuildingId: sensor.buildingId,
            notes: `Auto-generated from audio detection: ${detectionType} (confidence: ${(confidence * 100).toFixed(1)}%) at ${sensor.installLocation || sensor.name}`,
          },
        });

        await fastify.prisma.audioDetectionEvent.update({
          where: { id: event.id },
          data: { incidentCreated: true, incidentId: incident.id },
        });
        incidentCreated = true;
      }
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'AUDIO_DETECTION_INGESTED',
        entity: 'AudioDetectionEvent',
        entityId: event.id,
        details: { detectionType, confidence, alertSent, incidentCreated },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({ ...event, alertSent, incidentCreated });
  });

  // ── Review a detection event ──────────────────────────────────────────
  fastify.patch<{
    Params: { eventId: string };
    Body: {
      status?: string;
      isConfirmed?: boolean;
      reviewNotes?: string;
    };
  }>('/events/:eventId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const event = await fastify.prisma.audioDetectionEvent.findFirst({
      where: { id: request.params.eventId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!event) return reply.code(404).send({ error: 'Detection event not found' });

    const data: any = {
      reviewedById: request.jwtUser.id,
      reviewedAt: new Date(),
    };
    if (request.body.status) data.status = request.body.status as any;
    if (request.body.isConfirmed !== undefined) data.isConfirmed = request.body.isConfirmed;
    if (request.body.reviewNotes) data.reviewNotes = sanitizeText(request.body.reviewNotes);

    const updated = await fastify.prisma.audioDetectionEvent.update({
      where: { id: event.id },
      data,
      include: {
        sensor: { select: { id: true, name: true, installLocation: true } },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: event.siteId,
        userId: request.jwtUser.id,
        action: 'AUDIO_DETECTION_REVIEWED',
        entity: 'AudioDetectionEvent',
        entityId: event.id,
        details: { status: data.status, isConfirmed: data.isConfirmed },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // ══════════════════════════════════════════════════════════════════════
  // Site Config
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId: string };
  }>('/config', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const config = await fastify.prisma.audioMonitorConfig.findUnique({ where: { siteId } });
    return config || reply.code(404).send({ error: 'No config found' });
  });

  fastify.put<{
    Body: {
      siteId: string;
      isEnabled?: boolean;
      autoAlertThreshold?: number;
      autoIncidentThreshold?: number;
      retentionDays?: number;
      monitoringHours?: Record<string, unknown>;
      notifyChannels?: string[];
      escalationDelayS?: number;
      enabledDetectionTypes?: string[];
    };
  }>('/config', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, ...data } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const config = await fastify.prisma.audioMonitorConfig.upsert({
      where: { siteId },
      create: { siteId, ...data },
      update: data,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'AUDIO_MONITOR_CONFIG_UPDATED',
        entity: 'AudioMonitorConfig',
        entityId: config.id,
        details: data,
        ipAddress: request.ip,
      },
    });

    return config;
  });

  // ── Dashboard summary ─────────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/dashboard', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      sensorCounts,
      recentEvents,
      unreviewedCount,
      confirmedThreats7d,
      detectionsByType,
    ] = await Promise.all([
      fastify.prisma.audioSensor.groupBy({
        by: ['status'],
        where: { siteId, isActive: true },
        _count: true,
      }),
      fastify.prisma.audioDetectionEvent.count({
        where: { siteId, detectedAt: { gte: twentyFourHoursAgo } },
      }),
      fastify.prisma.audioDetectionEvent.count({
        where: { siteId, status: 'UNREVIEWED' },
      }),
      fastify.prisma.audioDetectionEvent.count({
        where: { siteId, status: 'CONFIRMED_THREAT', detectedAt: { gte: sevenDaysAgo } },
      }),
      fastify.prisma.audioDetectionEvent.groupBy({
        by: ['detectionType'],
        where: { siteId, detectedAt: { gte: sevenDaysAgo } },
        _count: true,
      }),
    ]);

    const sensors: Record<string, number> = {};
    for (const row of sensorCounts) sensors[row.status] = row._count;

    return {
      sensors: {
        online: sensors['ONLINE'] || 0,
        offline: sensors['OFFLINE'] || 0,
        fault: sensors['FAULT'] || 0,
        total: Object.values(sensors).reduce((a, b) => a + b, 0),
      },
      events24h: recentEvents,
      unreviewedEvents: unreviewedCount,
      confirmedThreats7d,
      detectionsByType: detectionsByType.map((d) => ({ type: d.detectionType, count: d._count })),
    };
  });
};

export default audioMonitoringRoutes;
