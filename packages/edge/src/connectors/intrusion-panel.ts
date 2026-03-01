/**
 * Intrusion Detection Panel Connector
 *
 * Copied from EdgeRuntime modules/safeschool/src/connectors/intrusion-panel.ts
 * Integrates with burglar/intrusion alarm panels (Bosch, DSC, Honeywell Vista, DMP)
 * for:
 * - Zone status monitoring (armed, disarmed, alarm, trouble)
 * - Arm/disarm commands
 * - Event monitoring (zone violations, tamper, low battery)
 * - Integration with access control (auto-arm when last person exits)
 */

import { BaseConnector, type ConnectorConfig } from './base-connector.js';

export interface IntrusionConfig extends ConnectorConfig {
  gatewayUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  /** Partition IDs to monitor (empty = all) */
  partitionFilter: string[];
  /** Auto-arm when all access-control readers show zero occupancy */
  autoArmOnEmpty: boolean;
}

export class IntrusionPanelConnector extends BaseConnector {
  private readonly gatewayUrl: string;
  private readonly authHeader: string;
  private readonly partitionFilter: string[];
  private readonly autoArmOnEmpty: boolean;

  constructor(name: string, config: IntrusionConfig) {
    super(name, config);
    this.gatewayUrl = config.gatewayUrl;
    this.partitionFilter = config.partitionFilter ?? [];
    this.autoArmOnEmpty = config.autoArmOnEmpty ?? false;

    if (config.apiKey) {
      this.authHeader = `Bearer ${config.apiKey}`;
    } else if (config.username && config.password) {
      this.authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
    } else {
      this.authHeader = '';
    }
  }

  async connect(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.gatewayUrl}/status`, {
        headers: this.getHeaders(),
      });
      if (resp.ok) {
        const status = await resp.json() as Record<string, unknown>;
        this.log.info({ model: status.model, partitions: status.partitions }, 'Connected to intrusion panel');
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
          if (this.partitionFilter.length === 0) return true;
          return this.partitionFilter.includes(e.partitionId as string);
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
      zone_alarm: 'intrusion_alarm',
      zone_restore: 'intrusion_restore',
      zone_tamper: 'intrusion_tamper',
      zone_fault: 'intrusion_fault',
      armed_away: 'intrusion_armed_away',
      armed_stay: 'intrusion_armed_stay',
      armed_night: 'intrusion_armed_night',
      disarmed: 'intrusion_disarmed',
      entry_delay: 'intrusion_entry_delay',
      exit_delay: 'intrusion_exit_delay',
      panic: 'intrusion_panic',
      low_battery: 'intrusion_low_battery',
      ac_failure: 'intrusion_ac_failure',
    };

    const severityMap: Record<string, string> = {
      intrusion_alarm: 'critical',
      intrusion_restore: 'info',
      intrusion_tamper: 'high',
      intrusion_fault: 'medium',
      intrusion_armed_away: 'info',
      intrusion_armed_stay: 'info',
      intrusion_armed_night: 'info',
      intrusion_disarmed: 'info',
      intrusion_entry_delay: 'low',
      intrusion_exit_delay: 'low',
      intrusion_panic: 'critical',
      intrusion_low_battery: 'low',
      intrusion_ac_failure: 'medium',
    };

    const rawType = (rawEvent.type as string) ?? 'unknown';
    const eventType = eventTypeMap[rawType] ?? `intrusion_${rawType}`;

    return {
      sourceSystem: 'Intrusion Panel',
      sourceConnector: this.name,
      eventType,
      severity: severityMap[eventType] ?? 'medium',
      timestamp: rawEvent.timestamp ?? new Date().toISOString(),
      partitionId: rawEvent.partitionId,
      partitionName: rawEvent.partitionName,
      zoneId: rawEvent.zoneId,
      zoneName: rawEvent.zoneName,
      zoneType: rawEvent.zoneType,
      userId: rawEvent.userId,
      userName: rawEvent.userName,
      building: rawEvent.building,
      floor: rawEvent.floor,
      raw: rawEvent,
    };
  }

  /** Arm a partition in away mode */
  async armAway(partitionId: string, userCode?: string): Promise<boolean> {
    return this.sendCommand(partitionId, 'arm_away', userCode);
  }

  /** Arm a partition in stay mode */
  async armStay(partitionId: string, userCode?: string): Promise<boolean> {
    return this.sendCommand(partitionId, 'arm_stay', userCode);
  }

  /** Disarm a partition */
  async disarm(partitionId: string, userCode: string): Promise<boolean> {
    return this.sendCommand(partitionId, 'disarm', userCode);
  }

  /** Get partition status (armed/disarmed/alarm) */
  async getPartitionStatus(partitionId: string): Promise<Record<string, unknown> | null> {
    try {
      const resp = await fetch(`${this.gatewayUrl}/partitions/${partitionId}`, {
        headers: this.getHeaders(),
      });
      if (!resp.ok) return null;
      return await resp.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Get all zone statuses for a partition */
  async getZoneStatuses(partitionId?: string): Promise<Array<{ id: string; name: string; status: string; type: string }>> {
    try {
      const path = partitionId
        ? `/api/partitions/${partitionId}/zones`
        : '/api/zones';
      const resp = await fetch(`${this.gatewayUrl}${path}`, {
        headers: this.getHeaders(),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as { zones?: Array<{ id: string; name: string; status: string; type: string }> };
      return data.zones ?? [];
    } catch {
      return [];
    }
  }

  /** Bypass a zone */
  async bypassZone(zoneId: string, userCode: string): Promise<boolean> {
    try {
      const resp = await fetch(`${this.gatewayUrl}/zones/${zoneId}/bypass`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ userCode }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async sendCommand(partitionId: string, command: string, userCode?: string): Promise<boolean> {
    try {
      const resp = await fetch(`${this.gatewayUrl}/partitions/${partitionId}/command`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ command, userCode }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authHeader) headers['Authorization'] = this.authHeader;
    return headers;
  }
}
