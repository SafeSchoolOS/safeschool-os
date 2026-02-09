/**
 * Centegix CrisisAlert Panic Button Adapter
 *
 * Centegix CrisisAlert uses BLE/Zigbee wearable badges that communicate
 * through dedicated gateways to the Centegix cloud platform.
 *
 * Integration: Centegix pushes alerts via their IP Integration Tool to
 * a configured webhook endpoint. This adapter parses those payloads.
 *
 * To receive alerts, register as a Centegix Platform Partner and configure
 * the SafeSchool webhook URL in the Centegix admin panel.
 *
 * Alert types:
 * - Staff Alert (3 clicks): Local responder notification
 * - Campus-Wide Alert (8+ clicks): Full lockdown + 911 dispatch
 *
 * @see https://www.centegix.com/safety-network-integrations/
 */

import type { PanicAlert, PanicDeviceAdapter } from '../index.js';
import { createHmac, timingSafeEqual } from 'crypto';

export interface CentegixConfig {
  /** Shared secret for HMAC webhook signature verification */
  webhookSecret: string;
}

export class CentegixAdapter implements PanicDeviceAdapter {
  name = 'CrisisAlert';
  vendor = 'Centegix';
  private webhookSecret: string;

  constructor(config: CentegixConfig) {
    this.webhookSecret = config.webhookSecret;
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    const signature = headers['x-centegix-signature'] || headers['x-signature'] || '';
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

  parseWebhook(headers: Record<string, string>, body: unknown): PanicAlert | null {
    if (!body || typeof body !== 'object') return null;

    const payload = body as Record<string, any>;

    // Map Centegix alert types to our standard types
    const alertTypeMap: Record<string, PanicAlert['alertType']> = {
      staff_alert: 'STAFF_ALERT',
      campus_wide: 'CAMPUS_WIDE',
      silent_panic: 'SILENT_PANIC',
      active_assailant: 'ACTIVE_ASSAILANT',
      medical: 'MEDICAL',
      lockdown: 'CAMPUS_WIDE',
    };

    const classification = (payload.classification || payload.alertType || payload.type || '').toLowerCase();

    return {
      alertId: payload.alertId || payload.event_id || payload.id || crypto.randomUUID(),
      alertType: alertTypeMap[classification] || 'SILENT_PANIC',
      timestamp: payload.timestamp || new Date().toISOString(),
      initiator: {
        name: payload.initiator?.name || payload.staffName || payload.user_name || 'Unknown',
        badgeId: payload.initiator?.badgeId || payload.badge_id || payload.deviceId,
        role: payload.initiator?.role || payload.staffRole || payload.user_role,
      },
      location: {
        siteName: payload.location?.siteName || payload.site_name || payload.schoolName,
        buildingName: payload.location?.buildingName || payload.building_name || payload.building,
        floor: payload.location?.floor ?? payload.floor,
        room: payload.location?.room || payload.room_name || payload.room,
        latitude: payload.location?.latitude ?? payload.latitude ?? payload.lat,
        longitude: payload.location?.longitude ?? payload.longitude ?? payload.lng,
      },
      status: this.mapStatus(payload.status),
      confidence: payload.confidence,
      rawPayload: payload,
    };
  }

  private mapStatus(status?: string): PanicAlert['status'] {
    if (!status) return 'ACTIVE';
    const lower = status.toLowerCase();
    if (lower === 'resolved' || lower === 'cancelled' || lower === 'cleared') return 'RESOLVED';
    if (lower === 'acknowledged' || lower === 'ack') return 'ACKNOWLEDGED';
    return 'ACTIVE';
  }
}
