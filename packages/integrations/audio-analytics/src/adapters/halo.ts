/**
 * HALO Smart Sensor Adapter (IPVideo Corp / Pelco)
 *
 * HALO is a multi-sensor IoT device that detects:
 *  - Vaping / THC          - Air quality (CO2, PM2.5, TVOC, NO2)
 *  - Gunshots              - Aggression (voice patterns)
 *  - Spoken keywords ("help")  - Noise levels
 *  - Tampering / masking   - Occupancy / motion
 *
 * Integration: HALO pushes JSON events via HTTP POST to a configured URL.
 * Auth is Basic Auth with an API Access Key (AKI) and Secret Key (AKS)
 * encoded in the URL or passed as Authorization header.
 *
 * Payload format (QxControl / rich format):
 *   { "event": { "Device": { "Name", "Mac", "Ip" }, "ID", "Source", "Value", "Status", "Date", "Time" } }
 *
 * Payload format (OpenEye / simple format):
 *   { "sensorName", "macAddress", "eventType", "localEventDate", "localEventTime" }
 *
 * @see https://halodetect.com/resources/partner-integrations/
 */

import type { AudioAnalyticsAlert, AudioAnalyticsAdapter, AudioAlertCategory } from '../index.js';

export interface HaloConfig {
  /** API Access Key (AKI) for Basic Auth verification */
  apiAccessKey: string;
  /** API Secret Key (AKS) for Basic Auth verification */
  apiSecretKey: string;
}

/** Map HALO event IDs to our unified categories */
const HALO_EVENT_MAP: Record<string, AudioAlertCategory> = {
  // Safety / security
  gunshot: 'GUNSHOT',
  aggression: 'AGGRESSIVE_VOICE',
  help: 'VERBAL_MEDICAL_EMERGENCY',
  panic: 'PANIC_BUTTON',
  // Vaping
  vape: 'VAPE_DETECTED',
  thc: 'THC_DETECTED',
  // Environmental
  masking: 'UNKNOWN_THREAT',
  aqi: 'AIR_QUALITY',
  co2: 'AIR_QUALITY',
  tvoc: 'AIR_QUALITY',
  'pm2.5': 'AIR_QUALITY',
  pm1: 'AIR_QUALITY',
  pm10: 'AIR_QUALITY',
  no2: 'AIR_QUALITY',
  co: 'CARBON_MONOXIDE_ALARM',
  nh3: 'AIR_QUALITY',
  // Noise
  sound: 'SCREAMING',
};

export class HaloAdapter implements AudioAnalyticsAdapter {
  name = 'HALO Smart Sensor';
  vendor = 'IPVideo Corp (Pelco)';
  private apiAccessKey: string;
  private apiSecretKey: string;

  constructor(config: HaloConfig) {
    this.apiAccessKey = config.apiAccessKey;
    this.apiSecretKey = config.apiSecretKey;
  }

  verifyAuth(headers: Record<string, string>, _body: string): boolean {
    // HALO uses Basic Auth: base64(AKI:AKS)
    const authHeader = headers['authorization'] || '';
    if (!authHeader.startsWith('Basic ')) return false;

    try {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const [user, pass] = decoded.split(':');
      return user === this.apiAccessKey && pass === this.apiSecretKey;
    } catch {
      return false;
    }
  }

  parseWebhook(_headers: Record<string, string>, body: unknown): AudioAnalyticsAlert | null {
    if (!body || typeof body !== 'object') return null;
    const payload = body as Record<string, any>;

    // Detect payload format: rich (QxControl) vs simple (OpenEye)
    if (payload.event) {
      return this.parseRichFormat(payload.event);
    }

    if (payload.sensorName || payload.macAddress || payload.eventType) {
      return this.parseSimpleFormat(payload);
    }

    return null;
  }

  /** Parse QxControl / rich JSON format */
  private parseRichFormat(event: Record<string, any>): AudioAnalyticsAlert {
    const device = event.Device || {};
    const eventId = (event.ID || event.id || '').toLowerCase();
    const status = (event.Status || '').toLowerCase();

    return {
      vendorEventId: `halo-${device.Mac || 'unknown'}-${event.Date}-${event.Time}-${eventId}`,
      category: HALO_EVENT_MAP[eventId] || 'UNKNOWN_THREAT',
      description: `HALO ${eventId} event from ${device.Name || 'unknown sensor'}`,
      sensorIdentifier: device.Mac || device.Ip || device.Name || '',
      sensorName: device.Name,
      timestamp: this.buildTimestamp(event.Date, event.Time),
      confidence: null, // HALO does not provide a confidence score
      sensorValue: event.Value ? parseFloat(event.Value) : undefined,
      status: status === 'reset' ? 'RESET' : 'FIRED',
      rawPayload: { event },
    };
  }

  /** Parse OpenEye / simple JSON format */
  private parseSimpleFormat(payload: Record<string, any>): AudioAnalyticsAlert {
    const eventType = (payload.eventType || payload.EID || '').toLowerCase();

    return {
      vendorEventId: `halo-${payload.macAddress || 'unknown'}-${payload.localEventDate}-${eventType}`,
      category: HALO_EVENT_MAP[eventType] || 'UNKNOWN_THREAT',
      description: `HALO ${eventType} event from ${payload.sensorName || 'unknown sensor'}`,
      sensorIdentifier: payload.macAddress || payload.sensorName || '',
      sensorName: payload.sensorName,
      timestamp: this.buildTimestamp(payload.localEventDate, payload.localEventTime),
      confidence: null,
      status: 'FIRED',
      rawPayload: payload,
    };
  }

  private buildTimestamp(date?: string, time?: string): string {
    if (date && time) {
      try {
        return new Date(`${date} ${time}`).toISOString();
      } catch {
        // fall through
      }
    }
    return new Date().toISOString();
  }
}
