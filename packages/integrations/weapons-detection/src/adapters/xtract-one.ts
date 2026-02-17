/**
 * Xtract One Gateway Adapter
 *
 * Xtract One Gateway is an AI-powered weapons detection system with a growing
 * K-12 presence. It uses sensor fusion (electromagnetic + AI) for concealed
 * weapons detection without requiring people to stop or empty pockets.
 *
 * Integration: Configure a webhook endpoint in the Xtract One admin portal
 * pointing to /webhooks/weapons-detection/xtract-one. Payloads are signed
 * with HMAC-SHA256 via the x-xtract-signature header.
 */

import type { WeaponDetectionEvent, WeaponsDetectionAdapter, ThreatLevel, DetectionStatus } from '../index.js';
import { createHmac, timingSafeEqual } from 'crypto';

export interface XtractOneConfig {
  apiKey: string;
  webhookSecret: string;
}

const THREAT_MAP: Record<string, ThreatLevel> = {
  firearm: 'FIREARM',
  gun: 'FIREARM',
  handgun: 'FIREARM',
  rifle: 'FIREARM',
  knife: 'KNIFE',
  edged_weapon: 'KNIFE',
  blade: 'KNIFE',
  mass_casualty: 'MASS_CASUALTY',
  explosive: 'MASS_CASUALTY',
  ied: 'MASS_CASUALTY',
  anomaly: 'ANOMALY',
  unknown: 'ANOMALY',
  suspicious: 'ANOMALY',
  clear: 'CLEAR',
  no_threat: 'CLEAR',
  safe: 'CLEAR',
};

export class XtractOneAdapter implements WeaponsDetectionAdapter {
  name = 'Gateway';
  vendor = 'Xtract One';
  private webhookSecret: string;

  constructor(config: XtractOneConfig) {
    this.webhookSecret = config.webhookSecret;
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    const signature = headers['x-xtract-signature'] || headers['x-signature'] || '';
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
      payload.threatType ||
      payload.threat_type ||
      payload.classification ||
      payload.type ||
      ''
    ).toLowerCase();

    const threatLevel = THREAT_MAP[classification] || 'ANOMALY';

    return {
      eventId: payload.eventId || payload.event_id || payload.alertId || payload.alert_id || crypto.randomUUID(),
      detectorId: payload.detectorId || payload.detector_id || payload.gatewayId || payload.gateway_id || 'unknown',
      detectorName: payload.detectorName || payload.detector_name || payload.gatewayName || payload.gateway_name,
      threatLevel,
      confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.85,
      timestamp: payload.timestamp || payload.detectedAt || payload.detected_at || new Date().toISOString(),
      imageUrl: payload.imageUrl || payload.image_url,
      location: {
        siteName: payload.location?.siteName || payload.location?.site_name || payload.siteName,
        buildingName: payload.location?.buildingName || payload.location?.building_name || payload.buildingName,
        entrance: payload.location?.entrance || payload.entrance || payload.entryPoint || payload.entry_point,
        lane: payload.location?.lane ?? payload.lane,
      },
      operatorAction: this.mapOperatorAction(payload.operatorAction || payload.operator_action),
      status: this.mapStatus(payload.status),
      rawPayload: payload,
    };
  }

  private mapOperatorAction(action?: string): WeaponDetectionEvent['operatorAction'] {
    if (!action) return 'PENDING';
    const lower = action.toLowerCase();
    if (lower === 'cleared' || lower === 'clear') return 'CLEARED';
    if (lower === 'escalated' || lower === 'alert') return 'ESCALATED';
    if (lower === 'secondary' || lower === 'rescan') return 'SECONDARY_SCREENING';
    return 'PENDING';
  }

  private mapStatus(status?: string): DetectionStatus {
    if (!status) return 'ACTIVE';
    const lower = status.toLowerCase();
    if (lower === 'resolved' || lower === 'complete') return 'RESOLVED';
    if (lower === 'cleared' || lower === 'dismissed') return 'CLEARED';
    return 'ACTIVE';
  }
}
