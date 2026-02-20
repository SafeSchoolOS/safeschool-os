/**
 * Louroe Electronics / Sound Intelligence Adapter
 *
 * Louroe's DigiFact IP microphones run Sound Intelligence audio analytics
 * on-device, detecting:
 *  - Aggression (angry/fearful voice patterns)
 *  - Gunshots / Explosions
 *  - Glass breaking
 *  - Panic screaming
 *  - Car alarms
 *
 * Integration: DigiFact devices send HTTP POST notifications with 4
 * configurable fields plus automatic timestamp data when an analytic
 * triggers.  Also supports ONVIF Profile S/T events and TCP serial text.
 *
 * This adapter handles the HTTP POST format.  The field names are
 * configured by the installer in the DigiFact web portal — we support
 * both the common field naming conventions and a flexible fallback.
 *
 * @see https://www.louroe.com/analytics/
 * @see https://www.louroe.com/wp-content/uploads/2021/06/DigiFact-Software-User-Guide-.pdf
 */

import type { AudioAnalyticsAlert, AudioAnalyticsAdapter, AudioAlertCategory } from '../index.js';

export interface LouroeConfig {
  /** Shared webhook secret for signature verification */
  webhookSecret?: string;
  /**
   * Field name mapping — since DigiFact lets installers configure
   * the 4 custom POST fields, this maps their chosen names to our
   * expected fields.  Defaults to common conventions.
   */
  fieldMapping?: {
    eventType?: string;    // default: "event_type" or "eventType"
    sensorId?: string;     // default: "sensor_id" or "device_id"
    sensorName?: string;   // default: "sensor_name" or "device_name"
    value?: string;        // default: "value" or "level"
  };
}

/** Map Sound Intelligence event types to our categories */
const LOUROE_EVENT_MAP: Record<string, AudioAlertCategory> = {
  aggression: 'AGGRESSIVE_VOICE',
  aggressive: 'AGGRESSIVE_VOICE',
  aggressive_voice: 'AGGRESSIVE_VOICE',
  gunshot: 'GUNSHOT',
  gun_shot: 'GUNSHOT',
  gunfire: 'GUNSHOT',
  explosion: 'EXPLOSION',
  glass_break: 'GLASS_BREAKING',
  glass_breaking: 'GLASS_BREAKING',
  glassbreak: 'GLASS_BREAKING',
  scream: 'SCREAMING',
  screaming: 'SCREAMING',
  panic_scream: 'SCREAMING',
  car_alarm: 'UNKNOWN_THREAT',
  noise: 'UNKNOWN_THREAT',
  // Sound Event Detector (SED) additional types
  graffiti_spray: 'UNKNOWN_THREAT',
  drill: 'UNKNOWN_THREAT',
  grinder: 'UNKNOWN_THREAT',
  drone: 'UNKNOWN_THREAT',
};

export class LouroeAdapter implements AudioAnalyticsAdapter {
  name = 'DigiFact Audio Analytics';
  vendor = 'Louroe Electronics / Sound Intelligence';
  private webhookSecret?: string;
  private fieldMapping: Required<NonNullable<LouroeConfig['fieldMapping']>>;

  constructor(config: LouroeConfig = {}) {
    this.webhookSecret = config.webhookSecret;
    this.fieldMapping = {
      eventType: config.fieldMapping?.eventType || 'event_type',
      sensorId: config.fieldMapping?.sensorId || 'sensor_id',
      sensorName: config.fieldMapping?.sensorName || 'sensor_name',
      value: config.fieldMapping?.value || 'value',
    };
  }

  verifyAuth(headers: Record<string, string>, _body: string): boolean {
    if (!this.webhookSecret) return true; // No secret configured = open (LAN-only)

    const token = headers['x-louroe-token']
      || headers['x-webhook-secret']
      || headers['authorization']?.replace('Bearer ', '')
      || '';

    return token === this.webhookSecret;
  }

  parseWebhook(_headers: Record<string, string>, body: unknown): AudioAnalyticsAlert | null {
    if (!body || typeof body !== 'object') return null;
    const payload = body as Record<string, any>;

    // Extract fields using configurable mapping with fallbacks
    const eventType = this.extractField(payload, this.fieldMapping.eventType,
      ['event_type', 'eventType', 'type', 'analytic', 'detection_type', 'event']);
    const sensorId = this.extractField(payload, this.fieldMapping.sensorId,
      ['sensor_id', 'sensorId', 'device_id', 'deviceId', 'mac', 'serial']);
    const sensorName = this.extractField(payload, this.fieldMapping.sensorName,
      ['sensor_name', 'sensorName', 'device_name', 'deviceName', 'name']);
    const value = this.extractField(payload, this.fieldMapping.value,
      ['value', 'level', 'db', 'decibel', 'reading']);

    if (!eventType) return null;

    const normalizedType = eventType.toLowerCase().replace(/[\s-]+/g, '_');
    const category = LOUROE_EVENT_MAP[normalizedType] || 'UNKNOWN_THREAT';

    return {
      vendorEventId: `louroe-${sensorId || 'unknown'}-${Date.now()}-${normalizedType}`,
      category,
      description: `Louroe ${eventType} detected at ${sensorName || sensorId || 'unknown sensor'}`,
      sensorIdentifier: sensorId || '',
      sensorName: sensorName || undefined,
      timestamp: payload.timestamp || payload.time || payload.date || new Date().toISOString(),
      confidence: payload.confidence ? parseFloat(payload.confidence) : null,
      decibelLevel: value ? parseFloat(value) : undefined,
      durationMs: payload.duration_ms || payload.durationMs,
      audioClipUrl: payload.audio_url || payload.audioUrl || payload.clip_url,
      status: (payload.status || '').toLowerCase() === 'reset' ? 'RESET' : 'FIRED',
      rawPayload: payload,
    };
  }

  /** Extract a field value trying the configured name first, then fallbacks */
  private extractField(payload: Record<string, any>, primary: string, fallbacks: string[]): string {
    if (payload[primary] !== undefined) return String(payload[primary]);
    for (const key of fallbacks) {
      if (payload[key] !== undefined) return String(payload[key]);
    }
    return '';
  }
}
