import type { FastifyPluginAsync } from 'fastify';
import { sanitizeText } from '../../utils/sanitize.js';
import type { AudioAnalyticsAdapter, AudioAnalyticsAlert, AudioAlertCategory } from '@safeschool/audio-analytics';
import { HaloAdapter } from '@safeschool/audio-analytics';
import { SDSAdapter } from '@safeschool/audio-analytics';
import { LouroeAdapter } from '@safeschool/audio-analytics';
import { SafeSystemAdapter } from '@safeschool/audio-analytics';

/**
 * Vendor-specific webhook endpoints for audio analytics integrations.
 *
 * Each vendor gets its own sub-path so their systems can POST to a
 * dedicated URL:
 *   /webhooks/audio-vendors/halo/event
 *   /webhooks/audio-vendors/sds/event
 *   /webhooks/audio-vendors/louroe/event
 *   /webhooks/audio-vendors/safe-system/event
 *
 * All events are normalized via the adapter layer and ingested into
 * either AudioDetectionEvent or SpeechDetectionEvent depending on type.
 */

/** Categories that map to speech/verbal detection events */
const VERBAL_CATEGORIES = new Set<AudioAlertCategory>([
  'VERBAL_FIRE_REPORT',
  'VERBAL_WEAPON_REPORT',
  'VERBAL_MEDICAL_EMERGENCY',
  'VERBAL_INTRUDER_REPORT',
  'VERBAL_BOMB_THREAT',
  'VERBAL_FIGHT_REPORT',
  'VERBAL_GENERAL_DISTRESS',
]);

/** Categories that map to acoustic (non-speech) detection events */
const ACOUSTIC_CATEGORIES = new Set<AudioAlertCategory>([
  'GUNSHOT', 'FIRE_ALARM', 'GLASS_BREAKING', 'SCREAMING', 'EXPLOSION',
  'AGGRESSIVE_VOICE', 'SMOKE_DETECTOR', 'CARBON_MONOXIDE_ALARM',
  'UNKNOWN_THREAT',
]);

/** Map verbal/panic categories to incident types */
const INCIDENT_TYPE_MAP: Record<string, string> = {
  GUNSHOT: 'ACTIVE_SHOOTER',
  VERBAL_FIRE_REPORT: 'FIRE',
  VERBAL_WEAPON_REPORT: 'ACTIVE_SHOOTER',
  VERBAL_MEDICAL_EMERGENCY: 'MEDICAL',
  VERBAL_INTRUDER_REPORT: 'INTRUDER',
  VERBAL_BOMB_THREAT: 'BOMB_THREAT',
  VERBAL_FIGHT_REPORT: 'FIGHT',
  PANIC_BUTTON: 'OTHER',
};

const audioAnalyticsVendorRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Adapter instances (lazy-initialized from env vars) ────────────

  function getAdapter(vendor: string): AudioAnalyticsAdapter | null {
    switch (vendor) {
      case 'halo':
        if (!process.env.HALO_API_ACCESS_KEY || !process.env.HALO_API_SECRET_KEY) return null;
        return new HaloAdapter({
          apiAccessKey: process.env.HALO_API_ACCESS_KEY,
          apiSecretKey: process.env.HALO_API_SECRET_KEY,
        });
      case 'sds':
        if (!process.env.SDS_WEBHOOK_SECRET) return null;
        return new SDSAdapter({ webhookSecret: process.env.SDS_WEBHOOK_SECRET });
      case 'louroe':
        return new LouroeAdapter({
          webhookSecret: process.env.LOUROE_WEBHOOK_SECRET,
          fieldMapping: process.env.LOUROE_FIELD_MAPPING
            ? JSON.parse(process.env.LOUROE_FIELD_MAPPING)
            : undefined,
        });
      case 'safe-system':
        if (!process.env.SAFE_SYSTEM_API_KEY) return null;
        return new SafeSystemAdapter({ apiKey: process.env.SAFE_SYSTEM_API_KEY });
      default:
        return null;
    }
  }

  // ── Shared ingestion handler ──────────────────────────────────────

  async function ingestAlert(
    alert: AudioAnalyticsAlert,
    vendor: string,
    requestIp: string,
  ) {
    // Look up sensor by identifier (serial number or MAC address)
    const sensor = await fastify.prisma.audioSensor.findFirst({
      where: {
        OR: [
          { serialNumber: alert.sensorIdentifier },
          { name: alert.sensorIdentifier },
        ],
        isActive: true,
      },
    });

    if (!sensor) {
      fastify.log.warn({ vendor, sensorIdentifier: alert.sensorIdentifier },
        'Audio vendor webhook: unknown sensor');
      return { received: true, matched: false, reason: 'Unknown sensor' };
    }

    // Skip reset events — just log them
    if (alert.status === 'RESET') {
      await fastify.prisma.auditLog.create({
        data: {
          siteId: sensor.siteId,
          userId: 'SYSTEM',
          action: `${vendor.toUpperCase()}_EVENT_RESET`,
          entity: 'AudioSensor',
          entityId: sensor.id,
          details: { category: alert.category, vendorEventId: alert.vendorEventId },
          ipAddress: requestIp,
        },
      });
      return { received: true, matched: true, status: 'reset_logged' };
    }

    // Update sensor heartbeat
    await fastify.prisma.audioSensor.update({
      where: { id: sensor.id },
      data: { lastHeartbeatAt: new Date(), status: 'ONLINE' },
    });

    const confidence = alert.confidence ?? 0.80;

    // Route to speech detection or acoustic detection table
    if (VERBAL_CATEGORIES.has(alert.category)) {
      return ingestSpeechEvent(alert, sensor, confidence, vendor, requestIp);
    }

    if (alert.category === 'PANIC_BUTTON') {
      // Panic button alerts create acoustic events with high severity
      return ingestAcousticEvent(alert, sensor, confidence, vendor, requestIp);
    }

    // Default: acoustic detection event
    return ingestAcousticEvent(alert, sensor, confidence, vendor, requestIp);
  }

  async function ingestAcousticEvent(
    alert: AudioAnalyticsAlert,
    sensor: any,
    confidence: number,
    vendor: string,
    requestIp: string,
  ) {
    // Map category to AudioDetectionType enum — skip non-acoustic categories
    const detectionType = ACOUSTIC_CATEGORIES.has(alert.category)
      ? alert.category
      : 'UNKNOWN_THREAT';

    const event = await fastify.prisma.audioDetectionEvent.create({
      data: {
        siteId: sensor.siteId,
        sensorId: sensor.id,
        detectionType: detectionType as any,
        confidence,
        decibelLevel: alert.decibelLevel ?? null,
        durationMs: alert.durationMs ?? null,
        audioClipUrl: alert.audioClipUrl ?? null,
        detectedAt: new Date(alert.timestamp),
      },
    });

    const config = await fastify.prisma.audioMonitorConfig.findUnique({
      where: { siteId: sensor.siteId },
    });

    let alertSent = false;
    let incidentCreated = false;

    if (config?.isEnabled) {
      if (confidence >= config.autoAlertThreshold) {
        fastify.wsManager?.broadcastToSite(sensor.siteId, 'audio.detection', {
          eventId: event.id,
          vendor,
          sensorId: sensor.id,
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
        const incident = await fastify.prisma.incident.create({
          data: {
            siteId: sensor.siteId,
            type: (INCIDENT_TYPE_MAP[detectionType] || 'OTHER') as any,
            severity: 'HIGH_INCIDENT' as any,
            triggeredBy: `${vendor}:${alert.sensorIdentifier}`,
            triggerDeviceId: sensor.id,
            triggerBuildingId: sensor.buildingId,
            notes: `Auto-generated from ${vendor}: ${alert.description} (confidence: ${(confidence * 100).toFixed(1)}%)`,
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
        siteId: sensor.siteId,
        userId: 'SYSTEM',
        action: `${vendor.toUpperCase()}_ACOUSTIC_EVENT`,
        entity: 'AudioDetectionEvent',
        entityId: event.id,
        details: { vendor, category: alert.category, confidence, alertSent, incidentCreated },
        ipAddress: requestIp,
      },
    });

    return { received: true, matched: true, eventId: event.id, alertSent, incidentCreated };
  }

  async function ingestSpeechEvent(
    alert: AudioAnalyticsAlert,
    sensor: any,
    confidence: number,
    vendor: string,
    requestIp: string,
  ) {
    // Check if speech detection is enabled for this site
    const speechConfig = await fastify.prisma.speechDetectionConfig.findUnique({
      where: { siteId: sensor.siteId },
    });

    // If speech detection not configured, fall back to acoustic event
    if (!speechConfig?.isEnabled) {
      return ingestAcousticEvent(alert, sensor, confidence, vendor, requestIp);
    }

    const event = await fastify.prisma.speechDetectionEvent.create({
      data: {
        siteId: sensor.siteId,
        sensorId: sensor.id,
        detectionType: alert.category as any,
        transcript: sanitizeText(alert.transcript || alert.description),
        matchedKeywords: alert.matchedKeywords || [],
        confidence,
        emotionTag: alert.emotionTag ?? null,
        decibelLevel: alert.decibelLevel ?? null,
        durationMs: alert.durationMs ?? null,
        audioClipUrl: alert.audioClipUrl ?? null,
        detectedAt: new Date(alert.timestamp),
      },
    });

    let alertSent = false;
    let incidentCreated = false;

    if (confidence >= speechConfig.autoAlertThreshold) {
      fastify.wsManager?.broadcastToSite(sensor.siteId, 'speech.detection', {
        eventId: event.id,
        vendor,
        sensorId: sensor.id,
        sensorName: sensor.name,
        sensorLocation: sensor.installLocation,
        detectionType: alert.category,
        transcript: alert.transcript || alert.description,
        matchedKeywords: alert.matchedKeywords,
        confidence,
        emotionTag: alert.emotionTag,
        detectedAt: event.detectedAt,
      });

      await fastify.prisma.speechDetectionEvent.update({
        where: { id: event.id },
        data: { alertSentAt: new Date() },
      });
      alertSent = true;
    }

    if (confidence >= speechConfig.autoIncidentThreshold) {
      const incident = await fastify.prisma.incident.create({
        data: {
          siteId: sensor.siteId,
          type: (INCIDENT_TYPE_MAP[alert.category] || 'OTHER') as any,
          severity: 'HIGH_INCIDENT' as any,
          triggeredBy: `${vendor}:${alert.sensorIdentifier}`,
          triggerDeviceId: sensor.id,
          triggerBuildingId: sensor.buildingId,
          notes: `Auto-generated from ${vendor} verbal detection: "${sanitizeText(alert.transcript || alert.description)}" (confidence: ${(confidence * 100).toFixed(1)}%)`,
        },
      });

      await fastify.prisma.speechDetectionEvent.update({
        where: { id: event.id },
        data: { incidentCreated: true, incidentId: incident.id },
      });
      incidentCreated = true;
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId: sensor.siteId,
        userId: 'SYSTEM',
        action: `${vendor.toUpperCase()}_SPEECH_EVENT`,
        entity: 'SpeechDetectionEvent',
        entityId: event.id,
        details: { vendor, category: alert.category, confidence, alertSent, incidentCreated },
        ipAddress: requestIp,
      },
    });

    return { received: true, matched: true, eventId: event.id, alertSent, incidentCreated };
  }

  // ══════════════════════════════════════════════════════════════════
  // Vendor-specific webhook endpoints
  // ══════════════════════════════════════════════════════════════════

  /** Generic handler factory for all vendors */
  function createVendorEndpoint(vendorKey: string) {
    return async (request: any, reply: any) => {
      const adapter = getAdapter(vendorKey);
      if (!adapter) {
        return reply.code(503).send({
          error: `${vendorKey} integration not configured`,
          hint: `Set the required environment variables for ${vendorKey}`,
        });
      }

      // Verify authentication
      const rawBody = JSON.stringify(request.body);
      if (!adapter.verifyAuth(request.headers, rawBody)) {
        fastify.log.warn({ vendor: vendorKey }, 'Audio vendor webhook auth failed');
        return reply.code(401).send({ error: 'Authentication failed' });
      }

      // Parse the vendor payload
      const alert = adapter.parseWebhook(request.headers, request.body);
      if (!alert) {
        fastify.log.warn({ vendor: vendorKey, body: request.body },
          'Audio vendor webhook: unable to parse payload');
        return reply.code(400).send({ error: 'Unable to parse event payload' });
      }

      const result = await ingestAlert(alert, vendorKey, request.ip);
      return reply.code(201).send(result);
    };
  }

  // ── HALO Smart Sensor ──────────────────────────────────────────────
  fastify.post('/halo/event', createVendorEndpoint('halo'));

  // ── Shooter Detection Systems (SDS) Guardian ──────────────────────
  fastify.post('/sds/event', createVendorEndpoint('sds'));

  // ── Louroe Electronics / Sound Intelligence ───────────────────────
  fastify.post('/louroe/event', createVendorEndpoint('louroe'));

  // ── Audio Enhancement SAFE System ─────────────────────────────────
  fastify.post('/safe-system/event', createVendorEndpoint('safe-system'));

  // ── Health-check / list configured vendors ────────────────────────
  fastify.get('/status', async (_request, reply) => {
    const vendors = ['halo', 'sds', 'louroe', 'safe-system'];
    const status: Record<string, { configured: boolean; vendor: string }> = {};

    for (const v of vendors) {
      const adapter = getAdapter(v);
      status[v] = {
        configured: adapter !== null,
        vendor: adapter?.vendor || 'Not configured',
      };
    }

    return reply.send({ vendors: status });
  });
};

export default audioAnalyticsVendorRoutes;
