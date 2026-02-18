/**
 * Evolv Technology Express Adapter
 *
 * Evolv Express is an AI-powered weapons detection system with the largest
 * K-12 install base. It provides an Open API with webhook support for
 * real-time threat notifications.
 *
 * Integration: Configure a webhook endpoint in the Evolv Insight dashboard
 * pointing to /webhooks/weapons-detection/evolv. Evolv signs payloads with
 * HMAC-SHA256 via the x-evolv-signature header.
 *
 * Threat classifications:
 * - WEAPON_FIREARM → FIREARM
 * - WEAPON_KNIFE/WEAPON_EDGED → KNIFE
 * - WEAPON_MASS_CASUALTY → MASS_CASUALTY
 * - ANOMALY/UNKNOWN → ANOMALY
 * - CLEAR/NO_THREAT → CLEAR
 */

import type { WeaponDetectionEvent, WeaponsDetectionAdapter, ThreatLevel, DetectionStatus } from '../index.js';
import { createHmac, timingSafeEqual } from 'crypto';

export interface EvolvConfig {
  apiKey: string;
  webhookSecret: string;
  apiUrl?: string;
}

const THREAT_MAP: Record<string, ThreatLevel> = {
  weapon_firearm: 'FIREARM',
  firearm: 'FIREARM',
  gun: 'FIREARM',
  handgun: 'FIREARM',
  rifle: 'FIREARM',
  weapon_knife: 'KNIFE',
  weapon_edged: 'KNIFE',
  knife: 'KNIFE',
  edged_weapon: 'KNIFE',
  weapon_mass_casualty: 'MASS_CASUALTY',
  mass_casualty: 'MASS_CASUALTY',
  explosive: 'MASS_CASUALTY',
  anomaly: 'ANOMALY',
  unknown: 'ANOMALY',
  clear: 'CLEAR',
  no_threat: 'CLEAR',
  passed: 'CLEAR',
};

export class EvolvAdapter implements WeaponsDetectionAdapter {
  name = 'Express';
  vendor = 'Evolv';
  private webhookSecret: string;

  constructor(config: EvolvConfig) {
    this.webhookSecret = config.webhookSecret;
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    const signature = headers['x-evolv-signature'] || headers['x-signature'] || '';
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
      payload.threatClassification ||
      payload.threat_classification ||
      payload.classification ||
      payload.threatType ||
      payload.type ||
      ''
    ).toLowerCase();

    const threatLevel = THREAT_MAP[classification] || 'ANOMALY';

    return {
      eventId: payload.eventId || payload.event_id || payload.id || crypto.randomUUID(),
      detectorId: payload.detectorId || payload.detector_id || payload.systemId || payload.system_id || 'unknown',
      detectorName: payload.detectorName || payload.detector_name || payload.systemName || payload.system_name,
      threatLevel,
      confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.9,
      timestamp: payload.timestamp || payload.detectedAt || payload.detected_at || new Date().toISOString(),
      imageUrl: payload.imageUrl || payload.image_url || payload.screenshotUrl || payload.screenshot_url,
      location: {
        siteName: payload.location?.siteName || payload.location?.site_name || payload.siteName || payload.site_name,
        buildingName: payload.location?.buildingName || payload.location?.building_name || payload.buildingName || payload.building_name,
        entrance: payload.location?.entrance || payload.entrance || payload.entryPoint || payload.entry_point,
        lane: payload.location?.lane ?? payload.lane ?? payload.laneNumber ?? payload.lane_number,
      },
      operatorAction: this.mapOperatorAction(payload.operatorAction || payload.operator_action || payload.action),
      status: this.mapStatus(payload.status || payload.eventStatus || payload.event_status),
      rawPayload: payload,
    };
  }

  private mapOperatorAction(action?: string): WeaponDetectionEvent['operatorAction'] {
    if (!action) return 'PENDING';
    const lower = action.toLowerCase();
    if (lower === 'cleared' || lower === 'clear' || lower === 'allowed') return 'CLEARED';
    if (lower === 'escalated' || lower === 'alert' || lower === 'denied') return 'ESCALATED';
    if (lower === 'secondary' || lower === 'secondary_screening' || lower === 'rescan') return 'SECONDARY_SCREENING';
    return 'PENDING';
  }

  private mapStatus(status?: string): DetectionStatus {
    if (!status) return 'ACTIVE';
    const lower = status.toLowerCase();
    if (lower === 'resolved' || lower === 'complete' || lower === 'closed') return 'RESOLVED';
    if (lower === 'cleared' || lower === 'dismissed' || lower === 'allowed') return 'CLEARED';
    return 'ACTIVE';
  }
}
