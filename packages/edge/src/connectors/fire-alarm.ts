/**
 * Fire Alarm Panel Connector
 *
 * Copied from EdgeRuntime modules/safeschool/src/connectors/fire-alarm.ts
 * Integrates with fire alarm control panels (Notifier, Simplex, Edwards, Honeywell)
 * for:
 * - Fire alarm event monitoring (alarm, trouble, supervisory)
 * - Zone/device status
 * - Integration with lockdown workflows (auto-unlock on fire alarm)
 * - Event correlation with access events
 */

import { BaseConnector, type ConnectorConfig } from './base-connector.js';

export interface FireAlarmConfig extends ConnectorConfig {
  gatewayUrl: string;
  apiKey?: string;
  /** Zone IDs to monitor (empty = all) */
  zoneFilter: string[];
  /** Trigger door unlock on fire alarm */
  unlockOnFireAlarm: boolean;
  /** Associated access connector name for door unlock */
  accessConnectorName?: string;
}

export class FireAlarmConnector extends BaseConnector {
  private readonly gatewayUrl: string;
  private readonly apiKey: string;
  private readonly zoneFilter: string[];
  private readonly unlockOnFireAlarm: boolean;
  private readonly accessConnectorName?: string;

  constructor(name: string, config: FireAlarmConfig) {
    super(name, config);
    this.gatewayUrl = config.gatewayUrl;
    this.apiKey = config.apiKey ?? '';
    this.zoneFilter = config.zoneFilter ?? [];
    this.unlockOnFireAlarm = config.unlockOnFireAlarm ?? true;
    this.accessConnectorName = config.accessConnectorName;
  }

  async connect(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.gatewayUrl}/status`, {
        headers: this.getHeaders(),
      });
      if (resp.ok) {
        const status = await resp.json() as Record<string, unknown>;
        this.log.info({ panelModel: status.model, zones: status.totalZones }, 'Connected to fire alarm panel');
        return true;
      }
      this.recordError(`Connection failed: HTTP ${resp.status}`);
      return false;
    } catch (err) {
      this.recordError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async disconnect(): Promise<void> {}

  async testConnection(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.gatewayUrl}/status`, {
        headers: this.getHeaders(),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async fetchEvents(since?: Date): Promise<Record<string, unknown>[]> {
    try {
      const params = new URLSearchParams();
      if (since) params.set('since', since.toISOString());

      const resp = await fetch(`${this.gatewayUrl}/events?${params}`, {
        headers: this.getHeaders(),
      });

      if (!resp.ok) {
        this.recordError(`Fetch events failed: HTTP ${resp.status}`);
        return [];
      }

      const data = await resp.json() as { events?: Record<string, unknown>[] };
      const events = (data.events ?? [])
        .filter(e => {
          if (this.zoneFilter.length === 0) return true;
          return this.zoneFilter.includes(e.zoneId as string);
        })
        .map(e => this.normalizeEvent(e));

      this.recordEvents(events.length);
      return events;
    } catch (err) {
      this.recordError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  normalizeEvent(rawEvent: Record<string, unknown>): Record<string, unknown> {
    const eventTypeMap: Record<string, string> = {
      fire_alarm: 'fire_alarm',
      fire_trouble: 'fire_trouble',
      fire_supervisory: 'fire_supervisory',
      fire_alarm_restore: 'fire_alarm_restore',
      fire_trouble_restore: 'fire_trouble_restore',
      smoke_detector: 'fire_smoke',
      heat_detector: 'fire_heat',
      pull_station: 'fire_pull_station',
      waterflow: 'fire_waterflow',
      sprinkler: 'fire_sprinkler',
    };

    const severityMap: Record<string, string> = {
      fire_alarm: 'critical',
      fire_trouble: 'high',
      fire_supervisory: 'medium',
      fire_alarm_restore: 'info',
      fire_trouble_restore: 'info',
      fire_smoke: 'critical',
      fire_heat: 'critical',
      fire_pull_station: 'critical',
      fire_waterflow: 'critical',
      fire_sprinkler: 'high',
    };

    const rawType = (rawEvent.type as string) ?? 'unknown';
    const eventType = eventTypeMap[rawType] ?? `fire_${rawType}`;

    return {
      sourceSystem: 'Fire Alarm Panel',
      sourceConnector: this.name,
      eventType,
      severity: severityMap[eventType] ?? 'high',
      timestamp: rawEvent.timestamp ?? new Date().toISOString(),
      zoneId: rawEvent.zoneId,
      zoneName: rawEvent.zoneName,
      deviceId: rawEvent.deviceId,
      deviceName: rawEvent.deviceName,
      deviceType: rawEvent.deviceType,
      building: rawEvent.building,
      floor: rawEvent.floor,
      location: rawEvent.location,
      alarmActive: rawEvent.active ?? true,
      acknowledged: rawEvent.acknowledged ?? false,
      raw: rawEvent,
    };
  }

  /** Get all zone statuses */
  async getZoneStatuses(): Promise<Array<{ id: string; name: string; status: string }>> {
    try {
      const resp = await fetch(`${this.gatewayUrl}/zones`, {
        headers: this.getHeaders(),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as { zones?: Array<{ id: string; name: string; status: string }> };
      return data.zones ?? [];
    } catch {
      return [];
    }
  }

  /** Acknowledge an alarm at the gateway level */
  async acknowledgeAlarm(eventId: string): Promise<boolean> {
    try {
      const resp = await fetch(`${this.gatewayUrl}/events/${eventId}/ack`, {
        method: 'POST',
        headers: this.getHeaders(),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** Silence panel notification */
  async silencePanel(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.gatewayUrl}/panel/silence`, {
        method: 'POST',
        headers: this.getHeaders(),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }
}
