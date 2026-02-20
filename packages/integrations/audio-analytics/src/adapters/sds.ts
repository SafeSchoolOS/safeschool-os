/**
 * Shooter Detection Systems (SDS) Guardian Adapter
 *
 * SDS Guardian provides indoor active-shooter detection using combined
 * acoustic + infrared sensors.  Detection happens entirely at the edge
 * (on-sensor DSP) with sub-one-second latency.  No audio leaves the sensor.
 *
 * Integration: SDS uses a proprietary, NDA-protected API.  Their primary
 * integration path is via certified VMS/mass-notification plugins (Genetec,
 * Milestone, Avigilon, Singlewire, Everbridge, etc.).
 *
 * For direct API integration, you must become a certified SDS Integration
 * Partner.  This adapter handles the inferred webhook payload format based
 * on SDS's public documentation and standard integration patterns.
 *
 * To obtain full API documentation, contact SDS:
 *   Phone: 1-844-SHOT911
 *   Web:   https://shooterdetectionsystems.com/integrations/
 *
 * @see https://shooterdetectionsystems.com/
 * @see https://shooterdetectionsystems.com/integrations/
 */

import type { AudioAnalyticsAlert, AudioAnalyticsAdapter } from '../index.js';
import { createHmac, timingSafeEqual } from 'crypto';

export interface SDSConfig {
  /** Shared secret for HMAC-SHA256 webhook signature verification */
  webhookSecret: string;
}

export class SDSAdapter implements AudioAnalyticsAdapter {
  name = 'Guardian Indoor Gunshot Detection';
  vendor = 'Shooter Detection Systems';
  private webhookSecret: string;

  constructor(config: SDSConfig) {
    this.webhookSecret = config.webhookSecret;
  }

  verifyAuth(headers: Record<string, string>, body: string): boolean {
    const signature = headers['x-sds-signature']
      || headers['x-guardian-signature']
      || headers['x-signature']
      || '';

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

  parseWebhook(_headers: Record<string, string>, body: unknown): AudioAnalyticsAlert | null {
    if (!body || typeof body !== 'object') return null;
    const payload = body as Record<string, any>;

    // SDS only detects gunshots — the sensor uses acoustic + IR verification
    // to confirm actual gunfire with extremely low false-positive rates.

    const sensorId = payload.sensorId || payload.sensor_id || payload.deviceId || '';
    const building = payload.building || payload.buildingName || '';
    const floor = payload.floor || payload.floorNumber;
    const room = payload.room || payload.area || payload.zone || '';
    const roundsFired = parseInt(payload.rounds || payload.roundsFired || payload.shotCount || '0') || undefined;

    return {
      vendorEventId: String(payload.eventId || payload.event_id || payload.id || crypto.randomUUID()),
      category: 'GUNSHOT',
      description: `SDS Guardian: gunshot detected${roundsFired ? ` (${roundsFired} rounds)` : ''} at ${room || building || sensorId}`,
      sensorIdentifier: String(sensorId),
      sensorName: payload.sensorName || payload.sensor_name,
      timestamp: payload.timestamp || payload.detectedAt || payload.dateTime || new Date().toISOString(),
      confidence: payload.confidence ?? 0.99, // SDS uses acoustic+IR dual verification → very high confidence
      decibelLevel: payload.decibelLevel || payload.decibel_level,
      durationMs: payload.durationMs || payload.duration_ms,
      audioClipUrl: payload.audioUrl || payload.audio_url, // Forensic audio stored on-sensor
      status: 'FIRED',
      location: {
        building: building || undefined,
        floor: floor ? parseInt(floor) : undefined,
        room: room || undefined,
        zone: payload.zone,
      },
      rawPayload: payload,
    };
  }
}
