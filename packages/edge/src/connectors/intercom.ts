/**
 * IP Intercom Connector
 *
 * Copied from EdgeRuntime modules/safeschool/src/connectors/intercom.ts
 * Integrates with SIP/VoIP-based door intercoms (2N, Axis, Aiphone, etc.)
 * for:
 * - Call event monitoring (incoming call, answered, missed, door release)
 * - Remote door release via intercom relay
 * - Audio/video stream URL resolution
 * - Directory management (tenant/room lists)
 */

import { BaseConnector, type ConnectorConfig } from './base-connector.js';

export interface IntercomConfig extends ConnectorConfig {
  apiUrl: string;
  username: string;
  password: string;
  /** Intercom unit IDs to monitor (empty = all) */
  unitFilter: string[];
  /** Auto-release on verified visitor */
  autoReleaseOnVerified: boolean;
}

export class IntercomConnector extends BaseConnector {
  private readonly apiUrl: string;
  private readonly authHeader: string;
  private readonly unitFilter: string[];
  private readonly autoReleaseOnVerified: boolean;

  constructor(name: string, config: IntercomConfig) {
    super(name, config);
    this.apiUrl = config.apiUrl;
    this.authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
    this.unitFilter = config.unitFilter ?? [];
    this.autoReleaseOnVerified = config.autoReleaseOnVerified ?? false;
  }

  async connect(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.apiUrl}/system/info`, {
        headers: { Authorization: this.authHeader },
      });
      if (resp.ok) {
        const info = await resp.json() as Record<string, string>;
        this.log.info({ model: info.model, firmware: info.firmware }, 'Connected to intercom');
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
      const resp = await fetch(`${this.apiUrl}/system/info`, {
        headers: { Authorization: this.authHeader },
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

      const resp = await fetch(`${this.apiUrl}/log/events?${params}`, {
        headers: { Authorization: this.authHeader },
      });

      if (!resp.ok) {
        this.recordError(`Fetch events failed: HTTP ${resp.status}`);
        return [];
      }

      const data = await resp.json() as { events?: Record<string, unknown>[] };
      const events = (data.events ?? [])
        .filter(e => {
          if (this.unitFilter.length === 0) return true;
          return this.unitFilter.includes(e.unitId as string);
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
      call_incoming: 'intercom_call',
      call_answered: 'intercom_answered',
      call_missed: 'intercom_missed',
      door_release: 'intercom_door_release',
      button_press: 'intercom_button',
      tamper: 'intercom_tamper',
    };

    const severityMap: Record<string, string> = {
      intercom_call: 'info',
      intercom_answered: 'info',
      intercom_missed: 'low',
      intercom_door_release: 'info',
      intercom_button: 'info',
      intercom_tamper: 'high',
    };

    const rawType = (rawEvent.type as string) ?? 'unknown';
    const eventType = eventTypeMap[rawType] ?? `intercom_${rawType}`;

    return {
      sourceSystem: 'IP Intercom',
      sourceConnector: this.name,
      eventType,
      severity: severityMap[eventType] ?? 'info',
      timestamp: rawEvent.timestamp ?? new Date().toISOString(),
      unitId: rawEvent.unitId,
      unitName: rawEvent.unitName,
      callerName: rawEvent.callerName,
      callerNumber: rawEvent.callerNumber,
      doorId: rawEvent.doorId,
      doorName: rawEvent.doorName,
      duration: rawEvent.duration,
      raw: rawEvent,
    };
  }

  /** Trigger door release relay */
  async releaseDoor(switchId = 1): Promise<boolean> {
    try {
      const resp = await fetch(`${this.apiUrl}/switch/ctrl?switch=${switchId}&action=on`, {
        method: 'GET',
        headers: { Authorization: this.authHeader },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** Get live video snapshot URL */
  getSnapshotUrl(): string {
    return `${this.apiUrl}/camera/snapshot`;
  }

  /** Get RTSP stream URL */
  getRtspUrl(): string {
    const url = new URL(this.apiUrl);
    return `rtsp://${url.hostname}/live`;
  }
}
