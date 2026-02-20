import type { FastifyPluginAsync } from 'fastify';
import { sanitizeText } from '../../utils/sanitize.js';

/**
 * Webhook endpoint for external speech-to-text / keyword detection systems.
 * Edge servers or cloud STT pipelines POST detected verbal emergency events here.
 * Signature-verified — no JWT auth.
 */
const speechDetectionWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: {
      sensorSerial: string;
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
      timestamp?: string;
    };
    Headers: { 'x-webhook-signature'?: string };
  }>('/event', async (request, reply) => {
    // Verify webhook signature
    const signature = request.headers['x-webhook-signature'];
    const secret = process.env.SPEECH_WEBHOOK_SECRET || process.env.AUDIO_WEBHOOK_SECRET;

    if (secret && !signature) {
      return reply.code(401).send({ error: 'Missing webhook signature' });
    }

    if (secret && signature !== secret) {
      fastify.log.warn('Speech detection webhook signature mismatch');
      return reply.code(401).send({ error: 'Invalid webhook signature' });
    }

    const {
      sensorSerial, detectionType, transcript, matchedKeywords,
      confidence, speechConfidence, keywordConfidence, speakerCount,
      emotionTag, decibelLevel, durationMs, audioClipUrl, timestamp,
    } = request.body;

    // Look up sensor by serial number
    const sensor = await fastify.prisma.audioSensor.findFirst({
      where: { serialNumber: sensorSerial, isActive: true, speechDetectionEnabled: true },
    });

    if (!sensor) {
      fastify.log.warn({ sensorSerial }, 'Speech webhook: unknown sensor or speech detection not enabled');
      return reply.code(404).send({ error: 'Unknown sensor or speech detection not enabled' });
    }

    // Verify site-level speech detection is enabled
    const speechConfig = await fastify.prisma.speechDetectionConfig.findUnique({
      where: { siteId: sensor.siteId },
    });

    if (!speechConfig?.isEnabled) {
      return reply.code(400).send({ error: 'Speech detection is not enabled for this site' });
    }

    // Map external detection types to our enum
    const typeMap: Record<string, string> = {
      fire: 'VERBAL_FIRE_REPORT',
      fire_report: 'VERBAL_FIRE_REPORT',
      verbal_fire: 'VERBAL_FIRE_REPORT',
      weapon: 'VERBAL_WEAPON_REPORT',
      weapon_report: 'VERBAL_WEAPON_REPORT',
      shooter: 'VERBAL_WEAPON_REPORT',
      verbal_weapon: 'VERBAL_WEAPON_REPORT',
      medical: 'VERBAL_MEDICAL_EMERGENCY',
      medical_emergency: 'VERBAL_MEDICAL_EMERGENCY',
      verbal_medical: 'VERBAL_MEDICAL_EMERGENCY',
      intruder: 'VERBAL_INTRUDER_REPORT',
      intruder_report: 'VERBAL_INTRUDER_REPORT',
      verbal_intruder: 'VERBAL_INTRUDER_REPORT',
      bomb: 'VERBAL_BOMB_THREAT',
      bomb_threat: 'VERBAL_BOMB_THREAT',
      verbal_bomb: 'VERBAL_BOMB_THREAT',
      fight: 'VERBAL_FIGHT_REPORT',
      fight_report: 'VERBAL_FIGHT_REPORT',
      verbal_fight: 'VERBAL_FIGHT_REPORT',
      distress: 'VERBAL_GENERAL_DISTRESS',
      general_distress: 'VERBAL_GENERAL_DISTRESS',
    };

    const mappedType = typeMap[detectionType.toLowerCase()] || detectionType;

    // Create speech detection event
    const event = await fastify.prisma.speechDetectionEvent.create({
      data: {
        siteId: sensor.siteId,
        sensorId: sensor.id,
        detectionType: mappedType as any,
        transcript: sanitizeText(transcript),
        matchedKeywords,
        confidence,
        speechConfidence: speechConfidence ?? null,
        keywordConfidence: keywordConfidence ?? null,
        speakerCount: speakerCount ?? null,
        emotionTag: emotionTag ?? null,
        decibelLevel: decibelLevel ?? null,
        durationMs: durationMs ?? null,
        audioClipUrl: audioClipUrl ?? null,
        detectedAt: timestamp ? new Date(timestamp) : new Date(),
      },
    });

    // Update sensor heartbeat
    await fastify.prisma.audioSensor.update({
      where: { id: sensor.id },
      data: { lastHeartbeatAt: new Date(), status: 'ONLINE' },
    });

    let alertSent = false;
    let incidentCreated = false;

    // Auto-alert
    if (confidence >= speechConfig.autoAlertThreshold) {
      fastify.wsManager?.broadcastToSite(sensor.siteId, 'speech.detection', {
        eventId: event.id,
        sensorId: sensor.id,
        sensorName: sensor.name,
        sensorLocation: sensor.installLocation,
        detectionType: mappedType,
        transcript: sanitizeText(transcript),
        matchedKeywords,
        confidence,
        emotionTag,
        speakerCount,
        detectedAt: event.detectedAt,
      });

      await fastify.prisma.speechDetectionEvent.update({
        where: { id: event.id },
        data: { alertSentAt: new Date() },
      });
      alertSent = true;
    }

    // Auto-incident
    if (confidence >= speechConfig.autoIncidentThreshold) {
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
          siteId: sensor.siteId,
          type: (incidentTypeMap[mappedType] || 'OTHER') as any,
          severity: 'HIGH_INCIDENT' as any,
          triggeredBy: `speech_detection:${sensor.serialNumber}`,
          triggerDeviceId: sensor.id,
          triggerBuildingId: sensor.buildingId,
          notes: `Auto-generated from verbal report: "${sanitizeText(transcript)}" — keywords: [${matchedKeywords.join(', ')}] (confidence: ${(confidence * 100).toFixed(1)}%) at ${sensor.installLocation || sensor.name}`,
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
        detectionType: mappedType,
        matchedKeywords,
        confidence,
      }, 'Speech webhook auto-created incident');
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId: sensor.siteId,
        userId: 'SYSTEM',
        action: 'SPEECH_WEBHOOK_RECEIVED',
        entity: 'SpeechDetectionEvent',
        entityId: event.id,
        details: { sensorSerial, detectionType: mappedType, matchedKeywords, confidence, alertSent, incidentCreated },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({ received: true, eventId: event.id, alertSent, incidentCreated });
  });
};

export default speechDetectionWebhookRoutes;
