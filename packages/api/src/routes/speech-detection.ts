import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const speechDetectionRoutes: FastifyPluginAsync = async (fastify) => {
  // ══════════════════════════════════════════════════════════════════════
  // Keyword Profiles — CRUD
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId?: string; category?: string; isActive?: string };
  }>('/keyword-profiles', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, category, isActive } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (category) where.category = category;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    return fastify.prisma.speechKeywordProfile.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });
  });

  fastify.get<{
    Params: { profileId: string };
  }>('/keyword-profiles/:profileId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const profile = await fastify.prisma.speechKeywordProfile.findFirst({
      where: { id: request.params.profileId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!profile) return reply.code(404).send({ error: 'Keyword profile not found' });
    return profile;
  });

  fastify.post<{
    Body: {
      siteId: string;
      name: string;
      category: string;
      language?: string;
      keywords: string[];
      phrasePatterns?: string[];
      minConfidence?: number;
      priority?: number;
    };
  }>('/keyword-profiles', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, name, keywords, ...data } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const sanitizedKeywords = keywords.map((k) => sanitizeText(k).toLowerCase().trim());

    const profile = await fastify.prisma.speechKeywordProfile.create({
      data: {
        siteId,
        name: sanitizeText(name),
        keywords: sanitizedKeywords,
        category: data.category as any,
        language: data.language || 'en',
        phrasePatterns: data.phrasePatterns || [],
        minConfidence: data.minConfidence ?? 0.70,
        priority: data.priority ?? 5,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'SPEECH_KEYWORD_PROFILE_CREATED',
        entity: 'SpeechKeywordProfile',
        entityId: profile.id,
        details: { name, category: data.category, keywordCount: sanitizedKeywords.length },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(profile);
  });

  fastify.patch<{
    Params: { profileId: string };
    Body: {
      name?: string;
      keywords?: string[];
      phrasePatterns?: string[];
      minConfidence?: number;
      priority?: number;
      isActive?: boolean;
      language?: string;
    };
  }>('/keyword-profiles/:profileId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const profile = await fastify.prisma.speechKeywordProfile.findFirst({
      where: { id: request.params.profileId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!profile) return reply.code(404).send({ error: 'Profile not found' });

    const data: any = { ...request.body };
    if (data.name) data.name = sanitizeText(data.name);
    if (data.keywords) data.keywords = data.keywords.map((k: string) => sanitizeText(k).toLowerCase().trim());

    return fastify.prisma.speechKeywordProfile.update({
      where: { id: profile.id },
      data,
    });
  });

  fastify.delete<{
    Params: { profileId: string };
  }>('/keyword-profiles/:profileId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const profile = await fastify.prisma.speechKeywordProfile.findFirst({
      where: { id: request.params.profileId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!profile) return reply.code(404).send({ error: 'Profile not found' });

    await fastify.prisma.speechKeywordProfile.delete({ where: { id: profile.id } });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: profile.siteId,
        userId: request.jwtUser.id,
        action: 'SPEECH_KEYWORD_PROFILE_DELETED',
        entity: 'SpeechKeywordProfile',
        entityId: profile.id,
        details: { name: profile.name },
        ipAddress: request.ip,
      },
    });

    return reply.code(204).send();
  });

  // ══════════════════════════════════════════════════════════════════════
  // Speech Detection Events — Ingest, Query, Review
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
      emotionTag?: string;
      limit?: string;
    };
  }>('/events', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, sensorId, detectionType, status, from, to, minConfidence, emotionTag, limit } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (sensorId) where.sensorId = sensorId;
    if (detectionType) where.detectionType = detectionType;
    if (status) where.status = status;
    if (emotionTag) where.emotionTag = emotionTag;
    if (minConfidence) where.confidence = { gte: parseFloat(minConfidence) };
    if (from || to) {
      where.detectedAt = {};
      if (from) where.detectedAt.gte = new Date(from);
      if (to) where.detectedAt.lte = new Date(to);
    }

    return fastify.prisma.speechDetectionEvent.findMany({
      where,
      include: {
        sensor: { select: { id: true, name: true, installLocation: true, buildingId: true } },
      },
      orderBy: { detectedAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 200),
    });
  });

  // ── Ingest a speech detection event (from STT pipeline) ────────────
  fastify.post<{
    Body: {
      siteId: string;
      sensorId: string;
      detectionType: string;
      transcript: string;
      matchedKeywords: string[];
      confidence: number;
      speechConfidence?: number;
      keywordConfidence?: number;
      speakerCount?: number;
      emotionTag?: string;
      decibelLevel?: number;
      durationMs?: number;
      audioClipUrl?: string;
      keywordProfileId?: string;
    };
  }>('/events', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId, sensorId, detectionType, transcript, matchedKeywords, confidence, ...data } = request.body;

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Verify sensor exists and has speech detection enabled
    const sensor = await fastify.prisma.audioSensor.findFirst({
      where: { id: sensorId, siteId },
    });
    if (!sensor) return reply.code(404).send({ error: 'Sensor not found' });

    if (!sensor.speechDetectionEnabled) {
      return reply.code(400).send({ error: 'Speech detection is not enabled on this sensor' });
    }

    // Check site-level speech detection config
    const speechConfig = await fastify.prisma.speechDetectionConfig.findUnique({ where: { siteId } });
    if (!speechConfig?.isEnabled) {
      return reply.code(400).send({ error: 'Speech detection is not enabled for this site' });
    }

    const event = await fastify.prisma.speechDetectionEvent.create({
      data: {
        siteId,
        sensorId,
        detectionType: detectionType as any,
        transcript: sanitizeText(transcript),
        matchedKeywords,
        confidence,
        speechConfidence: data.speechConfidence ?? null,
        keywordConfidence: data.keywordConfidence ?? null,
        speakerCount: data.speakerCount ?? null,
        emotionTag: data.emotionTag ?? null,
        decibelLevel: data.decibelLevel ?? null,
        durationMs: data.durationMs ?? null,
        audioClipUrl: data.audioClipUrl ?? null,
        keywordProfileId: data.keywordProfileId ?? null,
      },
      include: {
        sensor: { select: { id: true, name: true, installLocation: true } },
      },
    });

    let alertSent = false;
    let incidentCreated = false;

    if (confidence >= speechConfig.autoAlertThreshold) {
      // Broadcast real-time alert via WebSocket
      fastify.wsManager?.broadcastToSite(siteId, 'speech.detection', {
        eventId: event.id,
        sensorId,
        sensorName: sensor.name,
        sensorLocation: sensor.installLocation,
        detectionType,
        transcript: sanitizeText(transcript),
        matchedKeywords,
        confidence,
        emotionTag: data.emotionTag,
        speakerCount: data.speakerCount,
        detectedAt: event.detectedAt,
      });

      await fastify.prisma.speechDetectionEvent.update({
        where: { id: event.id },
        data: { alertSentAt: new Date() },
      });
      alertSent = true;
    }

    if (confidence >= speechConfig.autoIncidentThreshold) {
      // Map verbal detection types to incident types
      const incidentTypeMap: Record<string, string> = {
        VERBAL_FIRE_REPORT: 'FIRE',
        VERBAL_WEAPON_REPORT: 'ACTIVE_SHOOTER',
        VERBAL_MEDICAL_EMERGENCY: 'MEDICAL',
        VERBAL_INTRUDER_REPORT: 'INTRUDER',
        VERBAL_BOMB_THREAT: 'BOMB_THREAT',
        VERBAL_FIGHT_REPORT: 'FIGHT',
        VERBAL_GENERAL_DISTRESS: 'OTHER',
      };

      const incident = await fastify.prisma.incident.create({
        data: {
          siteId,
          type: (incidentTypeMap[detectionType] || 'OTHER') as any,
          severity: 'HIGH_INCIDENT' as any,
          triggeredBy: `speech_detection:${sensor.name}`,
          triggerDeviceId: sensorId,
          triggerBuildingId: sensor.buildingId,
          notes: `Auto-generated from verbal report: "${sanitizeText(transcript)}" — matched keywords: [${matchedKeywords.join(', ')}] (confidence: ${(confidence * 100).toFixed(1)}%) at ${sensor.installLocation || sensor.name}`,
        },
      });

      await fastify.prisma.speechDetectionEvent.update({
        where: { id: event.id },
        data: { incidentCreated: true, incidentId: incident.id },
      });
      incidentCreated = true;

      fastify.log.warn({
        incidentId: incident.id,
        sensorId: sensor.id,
        detectionType,
        matchedKeywords,
        confidence,
      }, 'Speech detection auto-created incident');
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'SPEECH_DETECTION_INGESTED',
        entity: 'SpeechDetectionEvent',
        entityId: event.id,
        details: { detectionType, matchedKeywords, confidence, alertSent, incidentCreated },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({ ...event, alertSent, incidentCreated });
  });

  // ── Review a speech detection event ────────────────────────────────
  fastify.patch<{
    Params: { eventId: string };
    Body: {
      status?: string;
      isConfirmed?: boolean;
      reviewNotes?: string;
    };
  }>('/events/:eventId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const event = await fastify.prisma.speechDetectionEvent.findFirst({
      where: { id: request.params.eventId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!event) return reply.code(404).send({ error: 'Speech detection event not found' });

    const data: any = {
      reviewedById: request.jwtUser.id,
      reviewedAt: new Date(),
    };
    if (request.body.status) data.status = request.body.status as any;
    if (request.body.isConfirmed !== undefined) data.isConfirmed = request.body.isConfirmed;
    if (request.body.reviewNotes) data.reviewNotes = sanitizeText(request.body.reviewNotes);

    const updated = await fastify.prisma.speechDetectionEvent.update({
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
        action: 'SPEECH_DETECTION_REVIEWED',
        entity: 'SpeechDetectionEvent',
        entityId: event.id,
        details: { status: data.status, isConfirmed: data.isConfirmed },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // ══════════════════════════════════════════════════════════════════════
  // Speech Detection Config (per-site)
  // ══════════════════════════════════════════════════════════════════════

  fastify.get<{
    Querystring: { siteId: string };
  }>('/config', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const config = await fastify.prisma.speechDetectionConfig.findUnique({ where: { siteId } });
    return config || reply.code(404).send({ error: 'No speech detection config found' });
  });

  fastify.put<{
    Body: {
      siteId: string;
      isEnabled?: boolean;
      sttEngine?: string;
      defaultLanguage?: string;
      additionalLanguages?: string[];
      autoAlertThreshold?: number;
      autoIncidentThreshold?: number;
      retainTranscripts?: boolean;
      transcriptRetentionDays?: number;
      retainAudioClips?: boolean;
      audioRetentionDays?: number;
      enableEmotionDetection?: boolean;
      enableSpeakerCounting?: boolean;
      monitoringHours?: Record<string, unknown>;
      enabledCategories?: string[];
      notifyChannels?: string[];
    };
  }>('/config', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, ...data } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const createData = { siteId, ...data } as any;
    const updateData = { ...data } as any;

    const config = await fastify.prisma.speechDetectionConfig.upsert({
      where: { siteId },
      create: createData,
      update: updateData,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'SPEECH_DETECTION_CONFIG_UPDATED',
        entity: 'SpeechDetectionConfig',
        entityId: config.id,
        details: data as any,
        ipAddress: request.ip,
      },
    });

    return config;
  });

  // ── Dashboard summary ─────────────────────────────────────────────
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
      speechConfig,
      speechCapableSensors,
      recentSpeechEvents,
      unreviewedSpeechEvents,
      confirmedVerbalThreats7d,
      speechDetectionsByType,
      keywordProfileCount,
    ] = await Promise.all([
      fastify.prisma.speechDetectionConfig.findUnique({ where: { siteId } }),
      fastify.prisma.audioSensor.count({
        where: { siteId, isActive: true, speechDetectionCapable: true },
      }),
      fastify.prisma.speechDetectionEvent.count({
        where: { siteId, detectedAt: { gte: twentyFourHoursAgo } },
      }),
      fastify.prisma.speechDetectionEvent.count({
        where: { siteId, status: 'UNREVIEWED' },
      }),
      fastify.prisma.speechDetectionEvent.count({
        where: { siteId, status: 'CONFIRMED_THREAT', detectedAt: { gte: sevenDaysAgo } },
      }),
      fastify.prisma.speechDetectionEvent.groupBy({
        by: ['detectionType'],
        where: { siteId, detectedAt: { gte: sevenDaysAgo } },
        _count: true,
      }),
      fastify.prisma.speechKeywordProfile.count({
        where: { siteId, isActive: true },
      }),
    ]);

    return {
      config: {
        isEnabled: speechConfig?.isEnabled ?? false,
        sttEngine: speechConfig?.sttEngine ?? 'NOT_CONFIGURED',
        defaultLanguage: speechConfig?.defaultLanguage ?? 'en',
      },
      sensors: {
        speechCapable: speechCapableSensors,
      },
      keywordProfiles: keywordProfileCount,
      speechEvents24h: recentSpeechEvents,
      unreviewedSpeechEvents,
      confirmedVerbalThreats7d,
      detectionsByType: speechDetectionsByType.map((d) => ({ type: d.detectionType, count: d._count })),
    };
  });

  // ── Seed default keyword profiles for a site ──────────────────────
  fastify.post<{
    Body: { siteId: string; language?: string };
  }>('/keyword-profiles/seed-defaults', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, language } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const lang = language || 'en';

    const defaultProfiles = [
      {
        name: 'Fire Emergency Keywords',
        category: 'VERBAL_FIRE_REPORT' as any,
        language: lang,
        keywords: ['fire', 'burning', 'smoke', 'flames', "something's on fire", 'fire in the', 'smells like smoke', 'the building is on fire'],
        phrasePatterns: ['*on fire*', '*is burning*', '*smell* smoke*', '*flames*'],
        priority: 1,
      },
      {
        name: 'Weapon / Shooter Keywords',
        category: 'VERBAL_WEAPON_REPORT' as any,
        language: lang,
        keywords: ['gun', 'shooter', 'weapon', 'knife', 'he has a gun', 'she has a gun', 'active shooter', 'shots fired', 'shooting'],
        phrasePatterns: ['*has a gun*', '*has a knife*', '*shots fired*', '*active shooter*'],
        priority: 1,
      },
      {
        name: 'Medical Emergency Keywords',
        category: 'VERBAL_MEDICAL_EMERGENCY' as any,
        language: lang,
        keywords: ['help', 'call 911', "someone's hurt", 'need a doctor', 'not breathing', 'passed out', 'heart attack', 'seizure', 'allergic reaction', 'epipen', 'bleeding'],
        phrasePatterns: ['*call 911*', '*need help*', '*not breathing*', "*someone's hurt*", '*need a doctor*'],
        priority: 2,
      },
      {
        name: 'Intruder Keywords',
        category: 'VERBAL_INTRUDER_REPORT' as any,
        language: lang,
        keywords: ['intruder', 'stranger', 'someone broke in', 'unauthorized', "who's that", 'lockdown', "doesn't belong here", 'break in'],
        phrasePatterns: ['*broke in*', '*intruder*', "*doesn't belong*", '*unauthorized*'],
        priority: 2,
      },
      {
        name: 'Bomb Threat Keywords',
        category: 'VERBAL_BOMB_THREAT' as any,
        language: lang,
        keywords: ['bomb', 'explosive', 'going to blow', 'blow up', 'detonate', 'suspicious package', 'ticking'],
        phrasePatterns: ['*going to blow*', '*blow up*', '*suspicious package*'],
        priority: 1,
      },
      {
        name: 'Fight / Violence Keywords',
        category: 'VERBAL_FIGHT_REPORT' as any,
        language: lang,
        keywords: ['fight', 'stop hitting', "they're fighting", 'punching', 'attacking', 'assault', 'beating up'],
        phrasePatterns: ['*stop hitting*', "*they're fighting*", '*beating up*'],
        priority: 3,
      },
    ];

    const created = [];
    for (const profile of defaultProfiles) {
      const existing = await fastify.prisma.speechKeywordProfile.findFirst({
        where: { siteId, name: profile.name },
      });
      if (!existing) {
        const p = await fastify.prisma.speechKeywordProfile.create({
          data: { siteId, ...profile },
        });
        created.push(p);
      }
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'SPEECH_KEYWORD_DEFAULTS_SEEDED',
        entity: 'SpeechKeywordProfile',
        entityId: siteId,
        details: { profilesCreated: created.length, language: lang },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({ created: created.length, profiles: created });
  });
};

export default speechDetectionRoutes;
