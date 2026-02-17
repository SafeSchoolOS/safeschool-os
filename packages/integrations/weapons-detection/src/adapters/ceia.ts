/**
 * CEIA OPENGATE Adapter
 *
 * CEIA OPENGATE is the most widely deployed traditional walk-through metal
 * detector. It uses relay-based detection and does not have a native cloud API.
 *
 * Integration: Events are forwarded to SafeSchool via a VMS bridge or custom
 * relay-to-HTTP gateway. The bridge sends HTTP POST requests with a shared
 * secret for authentication.
 *
 * Since CEIA is relay-based, payloads are simpler — no confidence scores or
 * detection images. Threat classification comes from the relay zone mapping
 * configured in the bridge software.
 */

import type { WeaponDetectionEvent, WeaponsDetectionAdapter, ThreatLevel, DetectionStatus } from '../index.js';
import { createHmac, timingSafeEqual } from 'crypto';

export interface CeiaConfig {
  webhookSecret: string;
}

const THREAT_MAP: Record<string, ThreatLevel> = {
  firearm: 'FIREARM',
  gun: 'FIREARM',
  weapon: 'FIREARM',
  knife: 'KNIFE',
  edged: 'KNIFE',
  mass_casualty: 'MASS_CASUALTY',
  explosive: 'MASS_CASUALTY',
  anomaly: 'ANOMALY',
  metal: 'ANOMALY',
  alarm: 'ANOMALY',
  clear: 'CLEAR',
  no_alarm: 'CLEAR',
  pass: 'CLEAR',
};

export class CeiaAdapter implements WeaponsDetectionAdapter {
  name = 'OPENGATE';
  vendor = 'CEIA';
  private webhookSecret: string;

  constructor(config: CeiaConfig) {
    this.webhookSecret = config.webhookSecret;
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    const signature = headers['x-ceia-signature'] || headers['x-signature'] || '';
    if (!signature || !this.webhookSecret) return false;

    try {
      const expected = createHmac('sha256', this.webhookSecret)
        .update(body)
        .digest('hex');

      const sigBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');

      if (sigBuffer.length !== expectedBuffer.length) return false;
      return timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  parseWebhook(_headers: Record<string, string>, body: unknown): WeaponDetectionEvent | null {
    if (!body || typeof body !== 'object') return null;

    const payload = body as Record<string, any>;

    const classification = (
      payload.alarmType ||
      payload.alarm_type ||
      payload.classification ||
      payload.type ||
      ''
    ).toLowerCase();

    const threatLevel = THREAT_MAP[classification] || 'ANOMALY';

    return {
      eventId: payload.eventId || payload.event_id || payload.id || crypto.randomUUID(),
      detectorId: payload.detectorId || payload.detector_id || payload.unitId || payload.unit_id || 'unknown',
      detectorName: payload.detectorName || payload.detector_name || payload.unitName || payload.unit_name,
      threatLevel,
      confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.8,
      timestamp: payload.timestamp || payload.alarmTime || payload.alarm_time || new Date().toISOString(),
      location: {
        siteName: payload.location?.siteName || payload.siteName || payload.site_name,
        buildingName: payload.location?.buildingName || payload.buildingName || payload.building_name,
        entrance: payload.location?.entrance || payload.entrance || payload.doorName || payload.door_name,
        lane: payload.location?.lane ?? payload.lane,
      },
      operatorAction: 'PENDING',
      status: this.mapStatus(payload.status),
      rawPayload: payload,
    };
  }

  private mapStatus(status?: string): DetectionStatus {
    if (!status) return 'ACTIVE';
    const lower = status.toLowerCase();
    if (lower === 'resolved' || lower === 'complete') return 'RESOLVED';
    if (lower === 'cleared' || lower === 'dismissed') return 'CLEARED';
    return 'ACTIVE';
  }
}
