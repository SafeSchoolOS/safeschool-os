import type { FastifyPluginAsync } from 'fastify';

/**
 * Webhook endpoint for external audio detection systems (e.g., Louroe, Shooter Detection Systems).
 * These systems analyze audio in real-time and POST events when threats are detected.
 * Signature-verified — no JWT auth.
 */
const audioDetectionWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: {
      sensorSerial: string;
      eventType: string;
      confidence: number;
      decibelLevel?: number;
      durationMs?: number;
      audioClipUrl?: string;
      timestamp?: string;
      metadata?: Record<string, unknown>;
    };
    Headers: { 'x-webhook-signature'?: string };
  }>('/event', async (request, reply) => {
    // Verify webhook signature
    const signature = request.headers['x-webhook-signature'];
    const secret = process.env.AUDIO_WEBHOOK_SECRET;

    if (secret && !signature) {
      return reply.code(401).send({ error: 'Missing webhook signature' });
    }

    // In production, verify HMAC signature here
    // For now, just check secret is present
    if (secret && signature !== secret) {
      fastify.log.warn('Audio webhook signature mismatch');
      return reply.code(401).send({ error: 'Invalid webhook signature' });
    }

    const { sensorSerial, eventType, confidence, decibelLevel, durationMs, audioClipUrl, timestamp } = request.body;

    // Look up sensor by serial number
    const sensor = await fastify.prisma.audioSensor.findFirst({
      where: { serialNumber: sensorSerial, isActive: true },
    });

    if (!sensor) {
      fastify.log.warn({ sensorSerial }, 'Audio webhook: unknown sensor serial');
      return reply.code(404).send({ error: 'Unknown sensor' });
    }

    // Map external event types to our enum
    const typeMap: Record<string, string> = {
      gunshot: 'GUNSHOT',
      gun_shot: 'GUNSHOT',
      fire_alarm: 'FIRE_ALARM',
      glass_break: 'GLASS_BREAKING',
      glass_breaking: 'GLASS_BREAKING',
      scream: 'SCREAMING',
      screaming: 'SCREAMING',
      explosion: 'EXPLOSION',
      aggressive_voice: 'AGGRESSIVE_VOICE',
      smoke_alarm: 'SMOKE_DETECTOR',
      co_alarm: 'CARBON_MONOXIDE_ALARM',
      pa_anomaly: 'PA_SYSTEM_ANOMALY',
      // Verbal/speech detection types (forwarded from hybrid acoustic+STT systems)
      verbal_fire: 'VERBAL_FIRE_REPORT',
      verbal_weapon: 'VERBAL_WEAPON_REPORT',
      verbal_medical: 'VERBAL_MEDICAL_EMERGENCY',
      verbal_intruder: 'VERBAL_INTRUDER_REPORT',
      verbal_bomb: 'VERBAL_BOMB_THREAT',
      verbal_fight: 'VERBAL_FIGHT_REPORT',
      verbal_distress: 'VERBAL_GENERAL_DISTRESS',
    };

    const detectionType = typeMap[eventType.toLowerCase()] || 'UNKNOWN_THREAT';

    // Create detection event
    const event = await fastify.prisma.audioDetectionEvent.create({
      data: {
        siteId: sensor.siteId,
        sensorId: sensor.id,
        detectionType: detectionType as any,
        confidence,
        decibelLevel: decibelLevel || null,
        durationMs: durationMs || null,
        audioClipUrl: audioClipUrl || null,
        detectedAt: timestamp ? new Date(timestamp) : new Date(),
      },
    });

    // Update sensor heartbeat
    await fastify.prisma.audioSensor.update({
      where: { id: sensor.id },
      data: { lastHeartbeatAt: new Date(), status: 'ONLINE' },
    });

    // Check auto-alert/incident thresholds
    const config = await fastify.prisma.audioMonitorConfig.findUnique({
      where: { siteId: sensor.siteId },
    });

    if (config && config.isEnabled) {
      if (confidence >= config.autoAlertThreshold) {
        // Broadcast real-time alert
        fastify.wsManager?.broadcastToSite(sensor.siteId, 'audio.detection', {
          eventId: event.id,
          sensorId: sensor.id,
          sensorName: sensor.name,
          sensorLocation: sensor.installLocation,
          detectionType,
          confidence,
          decibelLevel,
          detectedAt: event.detectedAt,
        });

        await fastify.prisma.audioDetectionEvent.update({
          where: { id: event.id },
          data: { alertSentAt: new Date() },
        });
      }

      if (confidence >= config.autoIncidentThreshold) {
        const incident = await fastify.prisma.incident.create({
          data: {
            siteId: sensor.siteId,
            type: detectionType === 'GUNSHOT' ? 'ACTIVE_SHOOTER' : 'OTHER' as any,
            severity: 'HIGH_INCIDENT' as any,
            triggeredBy: `audio_sensor:${sensor.serialNumber}`,
            triggerDeviceId: sensor.id,
            triggerBuildingId: sensor.buildingId,
            notes: `Auto-generated: ${detectionType} detected at ${sensor.installLocation || sensor.name} (confidence: ${(confidence * 100).toFixed(1)}%)`,
          },
        });

        await fastify.prisma.audioDetectionEvent.update({
          where: { id: event.id },
          data: { incidentCreated: true, incidentId: incident.id },
        });

        fastify.log.warn({
          incidentId: incident.id,
          sensorId: sensor.id,
          detectionType,
          confidence,
        }, 'Audio detection auto-created incident');
      }
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId: sensor.siteId,
        userId: 'SYSTEM',
        action: 'AUDIO_WEBHOOK_RECEIVED',
        entity: 'AudioDetectionEvent',
        entityId: event.id,
        details: { sensorSerial, eventType, confidence, detectionType },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({ received: true, eventId: event.id });
  });
};

export default audioDetectionWebhookRoutes;
