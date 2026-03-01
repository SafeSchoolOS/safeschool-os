/**
 * Lenel OnGuard Connector (TypeScript)
 *
 * Copied from EdgeRuntime modules/safeschool/src/connectors/lenel-onguard.ts
 * Integrates with Lenel OnGuard access control system API for:
 * - Real-time access events (granted, denied, forced, held, duress)
 * - Door status monitoring
 * - Cardholder lookups
 * - Remote door lock/unlock commands
 *
 * Delegates vendor API calls to @bwattendorf/adapters SicunetAdapter.
 */

import { BaseConnector, type ConnectorConfig } from './base-connector.js';
import { SicunetAdapter } from '@bwattendorf/adapters/access-control';
import type { AccessControlAdapter } from '@bwattendorf/adapters/access-control';

export interface LenelConfig extends ConnectorConfig {
  apiUrl: string;
  apiKey: string;
  /** Filter events to specific panel IDs (empty = all) */
  panelFilter: string[];
  /** Include cardholder details in events */
  includeCardholderDetails: boolean;
}

export class LenelOnGuardConnector extends BaseConnector {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly panelFilter: string[];
  private readonly includeCardholderDetails: boolean;
  private lastEventId: string | null = null;
  private readonly adapter: SicunetAdapter;

  constructor(name: string, config: LenelConfig) {
    super(name, config);
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.panelFilter = config.panelFilter ?? [];
    this.includeCardholderDetails = config.includeCardholderDetails ?? true;
    this.adapter = new SicunetAdapter();
  }

  async connect(): Promise<boolean> {
    try {
      await this.adapter.connect({
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
      });

      const resp = await fetch(`${this.apiUrl}/api/v1/health`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      if (resp.ok) {
        this.log.info('Connected to Lenel OnGuard');
        return true;
      }
      this.recordError(`Connection failed: HTTP ${resp.status}`);
      return false;
    } catch (err) {
      this.recordError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.lastEventId = null;
  }

  async testConnection(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.apiUrl}/api/v1/health`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async fetchEvents(since?: Date): Promise<Record<string, unknown>[]> {
    try {
      const params = new URLSearchParams();
      if (since) params.set('start_time', since.toISOString());
      if (this.lastEventId) params.set('after_id', this.lastEventId);

      const resp = await fetch(`${this.apiUrl}/api/v1/events?${params}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) {
        this.recordError(`Fetch events failed: HTTP ${resp.status}`);
        return [];
      }

      const data = await resp.json() as { events?: Record<string, unknown>[] };
      const rawEvents = data.events ?? [];
      const normalized: Record<string, unknown>[] = [];

      for (const raw of rawEvents) {
        if (this.panelFilter.length > 0) {
          const panelId = raw.panel_id as string;
          if (!this.panelFilter.includes(panelId)) continue;
        }

        normalized.push(this.normalizeEvent(raw));
        this.lastEventId = raw.id as string;
      }

      this.recordEvents(normalized.length);
      return normalized;
    } catch (err) {
      this.recordError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  normalizeEvent(rawEvent: Record<string, unknown>): Record<string, unknown> {
    const eventTypeMap: Record<string, string> = {
      access_granted: 'access_granted',
      access_denied: 'access_denied',
      door_forced_open: 'door_forced',
      door_held_open: 'door_held_open',
      duress: 'duress',
      alarm: 'alarm',
      tamper: 'tamper',
    };

    const severityMap: Record<string, string> = {
      access_granted: 'info',
      access_denied: 'low',
      door_forced: 'high',
      door_held_open: 'medium',
      duress: 'critical',
      alarm: 'high',
      tamper: 'high',
    };

    const rawType = ((rawEvent.event_type as string) ?? '').toLowerCase();
    const eventType = eventTypeMap[rawType] ?? 'unknown';

    return {
      sourceSystem: 'Lenel OnGuard',
      sourceConnector: this.name,
      eventId: `${this.name}_${rawEvent.id}`,
      eventType,
      severity: severityMap[eventType] ?? 'info',
      timestamp: rawEvent.timestamp ?? new Date().toISOString(),
      siteId: rawEvent.site_id,
      siteName: rawEvent.site_name,
      building: rawEvent.building,
      floor: rawEvent.floor,
      zone: rawEvent.zone,
      readerId: rawEvent.reader_id,
      readerName: rawEvent.reader_name,
      doorId: rawEvent.door_id,
      doorName: rawEvent.door_name,
      userId: rawEvent.cardholder_id,
      userName: rawEvent.cardholder_name,
      badgeId: rawEvent.badge_number,
      userType: rawEvent.cardholder_type,
      department: rawEvent.department,
      accessGranted: rawEvent.access_granted ?? false,
      accessReason: rawEvent.denial_reason,
      direction: rawEvent.direction,
      raw: rawEvent,
    };
  }

  /** Remotely unlock a door */
  async unlockDoor(doorId: string): Promise<boolean> {
    const result = await this.adapter.unlockDoor(doorId);
    return result.success;
  }

  /** Remotely lock a door */
  async lockDoor(doorId: string): Promise<boolean> {
    const result = await this.adapter.lockDoor(doorId);
    return result.success;
  }

  /** Initiate full lockdown (lock all doors in a zone) */
  async lockdownZone(zoneId: string): Promise<boolean> {
    const result = await this.adapter.lockdownZone(zoneId);
    return result.status === 'COMPLETE';
  }

  /** Look up cardholder by badge number */
  async lookupCardholder(badgeNumber: string): Promise<Record<string, unknown> | null> {
    try {
      const resp = await fetch(`${this.apiUrl}/api/v1/cardholders?badge=${badgeNumber}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!resp.ok) return null;
      const data = await resp.json() as { cardholders?: Record<string, unknown>[] };
      return data.cardholders?.[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Get the underlying access control adapter for advanced operations */
  getAdapter(): AccessControlAdapter {
    return this.adapter;
  }
}
