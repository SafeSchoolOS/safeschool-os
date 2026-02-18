/**
 * Rave Panic Button Adapter
 *
 * Rave Panic Button (Motorola Solutions) is a mobile app-based panic button
 * for schools. When pressed, it silently alerts 911 and designated responders
 * with the user's identity and precise location.
 *
 * Integration: Rave pushes alert events to a configured webhook endpoint.
 *
 * @see https://www.ravemobilesafety.com/panic-button
 */

import type { PanicAlert, PanicDeviceAdapter } from '../index.js';
import { createHmac, timingSafeEqual } from 'crypto';

export interface RavePanicConfig {
  apiKey: string;
}

export class RavePanicAdapter implements PanicDeviceAdapter {
  name = 'Rave Panic Button';
  vendor = 'Motorola Solutions';
  private apiKey: string;

  constructor(config: RavePanicConfig) {
    this.apiKey = config.apiKey;
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    const signature = headers['x-rave-signature'] || headers['x-signature'] || '';
    if (!signature || !this.apiKey) return false;

    try {
      const expected = createHmac('sha256', this.apiKey)
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

    return {
      alertId: payload.alert_id || payload.id || crypto.randomUUID(),
      alertType: payload.alert_type === 'active_shooter' ? 'ACTIVE_ASSAILANT' : 'SILENT_PANIC',
      timestamp: payload.timestamp || payload.created_at || new Date().toISOString(),
      initiator: {
        name: payload.user_name || payload.caller_name || 'Unknown',
        role: payload.user_role,
      },
      location: {
        siteName: payload.organization_name || payload.school_name,
        buildingName: payload.building,
        floor: payload.floor,
        room: payload.room,
        latitude: payload.latitude,
        longitude: payload.longitude,
      },
      status: payload.status === 'resolved' ? 'RESOLVED' : 'ACTIVE',
      rawPayload: payload,
    };
  }
}
