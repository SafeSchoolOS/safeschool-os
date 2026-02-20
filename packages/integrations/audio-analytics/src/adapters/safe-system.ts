/**
 * Audio Enhancement SAFE System Adapter
 *
 * SAFE (Signal Alert For Education) is a teacher-activated panic button system
 * integrated with Audio Enhancement's EPIC campus intercom platform.  Unlike
 * the other audio analytics vendors, SAFE is NOT an automated acoustic
 * detection system — it relies on a human pressing a button on their
 * wireless microphone (3-second press-and-hold) or wall-mounted alert panel.
 *
 * Integration: EPIC dispatches events via:
 *  - Common Alerting Protocol (CAP 1.2 XML) for digital signage
 *  - Pre-built pushes to CrisisGo, Raptor Technologies, Vivi
 *  - Custom district-level API (provided on request)
 *
 * This adapter handles:
 *  1. The JSON webhook format from EPIC's district API
 *  2. A simplified CAP-to-JSON translation for sites that relay CAP via middleware
 *
 * To obtain API credentials, contact Audio Enhancement:
 *   https://audioenhancement.com/safe/
 *
 * @see https://audioenhancement.com/safe/
 * @see https://audioenhancement.com/epic-system/
 */

import type { AudioAnalyticsAlert, AudioAnalyticsAdapter, AudioAlertCategory } from '../index.js';

export interface SafeSystemConfig {
  /** API key provided by Audio Enhancement for webhook verification */
  apiKey: string;
}

/** Map SAFE alert types to our categories */
const SAFE_ALERT_MAP: Record<string, AudioAlertCategory> = {
  safe_alert: 'PANIC_BUTTON',
  lockdown: 'VERBAL_INTRUDER_REPORT',
  active_shooter: 'GUNSHOT',
  fire: 'VERBAL_FIRE_REPORT',
  medical: 'VERBAL_MEDICAL_EMERGENCY',
  evacuation: 'VERBAL_FIRE_REPORT',
  shelter_in_place: 'UNKNOWN_THREAT',
  all_clear: 'UNKNOWN_THREAT',
  custom: 'VERBAL_GENERAL_DISTRESS',
};

export class SafeSystemAdapter implements AudioAnalyticsAdapter {
  name = 'SAFE System';
  vendor = 'Audio Enhancement';
  private apiKey: string;

  constructor(config: SafeSystemConfig) {
    this.apiKey = config.apiKey;
  }

  verifyAuth(headers: Record<string, string>, _body: string): boolean {
    const token = headers['x-safe-api-key']
      || headers['x-api-key']
      || headers['authorization']?.replace('Bearer ', '')
      || '';

    return token === this.apiKey;
  }

  parseWebhook(_headers: Record<string, string>, body: unknown): AudioAnalyticsAlert | null {
    if (!body || typeof body !== 'object') return null;
    const payload = body as Record<string, any>;

    // Format 1: EPIC district API JSON
    if (payload.alertType || payload.alert_type || payload.eventType) {
      return this.parseEpicJson(payload);
    }

    // Format 2: CAP-to-JSON relay (middleware converts CAP XML to JSON)
    if (payload.alert && payload.alert.info) {
      return this.parseCapJson(payload.alert);
    }

    return null;
  }

  /** Parse EPIC district API JSON format */
  private parseEpicJson(payload: Record<string, any>): AudioAnalyticsAlert {
    const alertType = (payload.alertType || payload.alert_type || payload.eventType || 'safe_alert')
      .toLowerCase().replace(/[\s-]+/g, '_');

    const initiator = payload.initiator || payload.teacher || {};
    const location = payload.location || {};
    const status = (payload.status || 'active').toLowerCase();

    return {
      vendorEventId: String(payload.alertId || payload.alert_id || payload.id || crypto.randomUUID()),
      category: SAFE_ALERT_MAP[alertType] || 'PANIC_BUTTON',
      description: `SAFE Alert: ${alertType.replace(/_/g, ' ')} activated by ${initiator.name || 'staff member'} in ${location.room || location.building || 'unknown location'}`,
      sensorIdentifier: payload.deviceId || payload.device_id || payload.microphoneId || '',
      sensorName: payload.deviceName || location.room,
      timestamp: payload.timestamp || payload.activatedAt || payload.activated_at || new Date().toISOString(),
      confidence: 1.0, // Human-activated — always 100% intentional
      status: status === 'resolved' || status === 'all_clear' ? 'RESET' : 'FIRED',
      location: {
        building: location.building || location.buildingName,
        floor: location.floor ? parseInt(location.floor) : undefined,
        room: location.room || location.roomName || location.areaDesc,
        zone: location.zone,
      },
      rawPayload: payload,
    };
  }

  /** Parse CAP 1.2 JSON-converted format */
  private parseCapJson(alert: Record<string, any>): AudioAnalyticsAlert {
    const info = alert.info || {};
    const area = info.area || {};

    const eventType = (info.event || 'safe_alert').toLowerCase().replace(/[\s-]+/g, '_');
    const status = (alert.msgType || 'Alert').toLowerCase();

    return {
      vendorEventId: String(alert.identifier || crypto.randomUUID()),
      category: SAFE_ALERT_MAP[eventType] || 'PANIC_BUTTON',
      description: `SAFE/CAP Alert: ${info.event || 'Unknown'} — ${info.headline || info.description || ''}`,
      sensorIdentifier: alert.sender || '',
      sensorName: info.senderName,
      timestamp: alert.sent || new Date().toISOString(),
      confidence: 1.0,
      status: status === 'cancel' || status === 'update' ? 'RESET' : 'FIRED',
      location: {
        room: area.areaDesc,
      },
      rawPayload: { alert },
    };
  }
}
