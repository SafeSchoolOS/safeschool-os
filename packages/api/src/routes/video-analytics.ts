import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const videoAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════
  // Events — Ingest, List, Review
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: {
      siteId?: string;
      detectionType?: string;
      status?: string;
      from?: string;
      to?: string;
      minConfidence?: string;
      cameraId?: string;
      limit?: string;
    };
  }>('/events', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, detectionType, status, from, to, minConfidence, cameraId, limit } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (detectionType) where.detectionType = detectionType;
    if (status) where.status = status;
    if (cameraId) where.cameraId = cameraId;
    if (minConfidence) where.confidence = { gte: parseFloat(minConfidence) };
    if (from || to) {
      where.detectedAt = {};
      if (from) where.detectedAt.gte = new Date(from);
      if (to) where.detectedAt.lte = new Date(to);
    }

    return fastify.prisma.videoAnalyticsEvent.findMany({
      where,
      orderBy: { detectedAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 200),
    });
  });

  // ── Ingest detection event (from AI pipeline or external service) ─────
  fastify.post<{
    Body: {
      siteId: string;
      cameraId?: string;
      cameraName?: string;
      detectionType: string;
      confidence: number;
      boundingBox?: Record<string, unknown>;
      thumbnailUrl?: string;
      videoClipUrl?: string;
      frameTimestamp?: string;
      objectClass?: string;
      objectAttributes?: Record<string, unknown>;
      zone?: string;
    };
  }>('/events', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, detectionType, confidence, frameTimestamp, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const event = await fastify.prisma.videoAnalyticsEvent.create({
      data: {
        siteId,
        detectionType: detectionType as any,
        confidence,
        frameTimestamp: frameTimestamp ? new Date(frameTimestamp) : null,
        ...rest,
        boundingBox: rest.boundingBox as Prisma.InputJsonValue | undefined,
        objectAttributes: rest.objectAttributes as Prisma.InputJsonValue | undefined,
      },
    });

    // Check config for auto-alert/incident
    const config = await fastify.prisma.videoAnalyticsConfig.findUnique({ where: { siteId } });
    let alertSent = false;
    let incidentCreated = false;

    if (config && config.isEnabled) {
      if (confidence >= config.alertThreshold) {
        fastify.wsManager?.broadcastToSite(siteId, 'video.detection', {
          eventId: event.id,
          cameraId: rest.cameraId,
          cameraName: rest.cameraName,
          detectionType,
          confidence,
          objectClass: rest.objectClass,
          zone: rest.zone,
          thumbnailUrl: rest.thumbnailUrl,
          detectedAt: event.detectedAt,
        });

        await fastify.prisma.videoAnalyticsEvent.update({
          where: { id: event.id },
          data: { alertSentAt: new Date() },
        });
        alertSent = true;
      }

      if (confidence >= config.autoIncidentThreshold) {
        const isWeapon = detectionType.startsWith('WEAPON');
        const incident = await fastify.prisma.incident.create({
          data: {
            siteId,
            type: isWeapon ? 'ACTIVE_SHOOTER' : 'OTHER' as any,
            severity: isWeapon ? 'HIGH_INCIDENT' : 'MEDIUM_INCIDENT' as any,
            triggeredBy: `video_analytics:${rest.cameraName || rest.cameraId}`,
            notes: `Auto-generated: ${detectionType} detected${rest.cameraName ? ` on ${rest.cameraName}` : ''}${rest.zone ? ` in ${rest.zone}` : ''} (confidence: ${(confidence * 100).toFixed(1)}%)`,
          },
        });

        await fastify.prisma.videoAnalyticsEvent.update({
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
        action: 'VIDEO_DETECTION_INGESTED',
        entity: 'VideoAnalyticsEvent',
        entityId: event.id,
        details: { detectionType, confidence, alertSent, incidentCreated },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({ ...event, alertSent, incidentCreated });
  });

  // ── Review a detection ────────────────────────────────────────────────
  fastify.patch<{
    Params: { eventId: string };
    Body: { status?: string; isConfirmed?: boolean; reviewNotes?: string };
  }>('/events/:eventId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const event = await fastify.prisma.videoAnalyticsEvent.findFirst({
      where: { id: request.params.eventId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!event) return reply.code(404).send({ error: 'Event not found' });

    const data: any = { reviewedById: request.jwtUser.id, reviewedAt: new Date() };
    if (request.body.status) data.status = request.body.status as any;
    if (request.body.isConfirmed !== undefined) data.isConfirmed = request.body.isConfirmed;
    if (request.body.reviewNotes) data.reviewNotes = sanitizeText(request.body.reviewNotes);

    return fastify.prisma.videoAnalyticsEvent.update({ where: { id: event.id }, data });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Config
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId: string };
  }>('/config', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    const config = await fastify.prisma.videoAnalyticsConfig.findUnique({ where: { siteId } });
    return config || reply.code(404).send({ error: 'No config found' });
  });

  fastify.put<{
    Body: {
      siteId: string;
      isEnabled?: boolean;
      provider?: string;
      alertThreshold?: number;
      autoIncidentThreshold?: number;
      enabledDetectionTypes?: string[];
      processingFps?: number;
      retentionDays?: number;
      notifyChannels?: string[];
    };
  }>('/config', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, ...data } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const config = await fastify.prisma.videoAnalyticsConfig.upsert({
      where: { siteId },
      create: { siteId, ...data },
      update: data,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'VIDEO_ANALYTICS_CONFIG_UPDATED',
        entity: 'VideoAnalyticsConfig',
        entityId: config.id,
        details: data,
        ipAddress: request.ip,
      },
    });

    return config;
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
    const sevenDays = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [events24h, unreviewedCount, confirmedThreats7d, byDetectionType, recentWeaponEvents] = await Promise.all([
      fastify.prisma.videoAnalyticsEvent.count({ where: { siteId, detectedAt: { gte: twentyFourHours } } }),
      fastify.prisma.videoAnalyticsEvent.count({ where: { siteId, status: 'UNREVIEWED' } }),
      fastify.prisma.videoAnalyticsEvent.count({ where: { siteId, status: 'CONFIRMED_THREAT', detectedAt: { gte: sevenDays } } }),
      fastify.prisma.videoAnalyticsEvent.groupBy({
        by: ['detectionType'],
        where: { siteId, detectedAt: { gte: sevenDays } },
        _count: true,
      }),
      fastify.prisma.videoAnalyticsEvent.findMany({
        where: { siteId, detectionType: { in: ['WEAPON_FIREARM', 'WEAPON_KNIFE', 'WEAPON_OTHER'] }, detectedAt: { gte: sevenDays } },
        orderBy: { detectedAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      events24h,
      unreviewedEvents: unreviewedCount,
      confirmedThreats7d,
      byDetectionType: byDetectionType.map((d) => ({ type: d.detectionType, count: d._count })),
      recentWeaponEvents,
    };
  });
};

export default videoAnalyticsRoutes;
