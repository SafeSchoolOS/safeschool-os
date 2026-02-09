/**
 * Sicunet Access Control Adapter
 *
 * PRIMARY integration for SafeSchool. Sicunet is our top-priority access
 * control system with the deepest native integration. SafeSchool team
 * members work directly with Sicunet, enabling tight coupling for
 * lockdown, door monitoring, and credential management.
 *
 * Capabilities:
 * - Full building lockdown via API
 * - Zone-based lockdown
 * - Real-time door status monitoring via SSE
 * - Credential management (permanent + temporary visitor credentials)
 * - Event streaming for door open/close/forced/held
 * - Integration with Sicunet's video and visitor management
 * - OSDP reader support
 * - Mobile credential support
 * - Anti-passback enforcement
 * - Mustering / headcount for evacuations
 */

import type {
  AccessControlAdapter,
  AccessControlConfig,
  DoorCommandResult,
  DoorEvent,
  DoorStatus,
  LockdownResult,
} from '@safeschool/core';

interface SicunetConfig extends AccessControlConfig {
  /** SSE endpoint for real-time events (default: /api/v1/events/stream) */
  eventStreamPath?: string;
  /** Polling interval in ms when SSE is unavailable (default: 2000) */
  pollIntervalMs?: number;
  /** Max reconnection attempts before falling back to polling */
  maxReconnectAttempts?: number;
  /** Site ID for multi-site filtering */
  siteId?: string;
}

export class SicunetAdapter implements AccessControlAdapter {
  name = 'Sicunet';
  vendor = 'Sicunet';

  private baseUrl = '';
  private apiKey = '';
  private siteId = '';
  private connected = false;
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];
  private eventSource: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pollIntervalMs = 2000;
  private eventStreamPath = '/api/v1/events/stream';
  private lastEventId = '';

  async connect(config: SicunetConfig): Promise<void> {
    this.baseUrl = config.apiUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey || '';
    this.siteId = config.siteId || '';
    this.pollIntervalMs = config.pollIntervalMs || 2000;
    this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
    this.eventStreamPath = config.eventStreamPath || '/api/v1/events/stream';

    // Verify connection
    const healthy = await this.healthCheck();
    if (!healthy) {
      throw new Error('Failed to connect to Sicunet API');
    }

    this.connected = true;

    // Start event stream for real-time door events
    await this.startEventStream();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/api/v1/health');
      return response.ok;
    } catch {
      return false;
    }
  }

  async lockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      const response = await this.request('POST', `/api/v1/doors/${doorId}/lock`, {
        source: 'SafeSchool',
        priority: 'HIGH',
      });
      const data: any = await response.json();

      return {
        success: response.ok,
        doorId,
        newStatus: data.status || 'LOCKED',
        executionTimeMs: Date.now() - start,
        error: response.ok ? undefined : data.message,
      };
    } catch (err) {
      return {
        success: false,
        doorId,
        newStatus: 'UNKNOWN' as DoorStatus,
        executionTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async unlockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      const response = await this.request('POST', `/api/v1/doors/${doorId}/unlock`, {
        source: 'SafeSchool',
        duration: 5, // Auto-relock after 5 seconds
      });
      const data: any = await response.json();

      return {
        success: response.ok,
        doorId,
        newStatus: data.status || 'UNLOCKED',
        executionTimeMs: Date.now() - start,
        error: response.ok ? undefined : data.message,
      };
    } catch (err) {
      return {
        success: false,
        doorId,
        newStatus: 'UNKNOWN' as DoorStatus,
        executionTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async lockdownBuilding(buildingId: string): Promise<LockdownResult> {
    const start = Date.now();
    try {
      const response = await this.request('POST', `/api/v1/buildings/${buildingId}/lockdown`, {
        lockdownType: 'full',
        excludeFireEgress: true,
        source: 'SafeSchool',
        priority: 'CRITICAL',
      });
      const data: any = await response.json();

      return {
        lockdownId: data.lockdownId,
        status: data.allSecured ? 'COMPLETE' : 'PARTIAL_FAILURE',
        doorsLocked: data.securedCount || 0,
        doorsFailed: (data.failures || []).map((f: any) => ({
          doorId: f.doorId,
          doorName: f.doorName,
          reason: f.reason,
        })),
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    } catch (err) {
      return {
        lockdownId: '',
        status: 'PARTIAL_FAILURE',
        doorsLocked: 0,
        doorsFailed: [{ doorId: 'all', doorName: 'Building', reason: err instanceof Error ? err.message : 'Connection failed' }],
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    }
  }

  async lockdownZone(zoneId: string): Promise<LockdownResult> {
    const start = Date.now();
    try {
      const response = await this.request('POST', `/api/v1/zones/${zoneId}/lockdown`, {
        source: 'SafeSchool',
        priority: 'CRITICAL',
      });
      const data: any = await response.json();

      return {
        lockdownId: data.lockdownId,
        status: data.allSecured ? 'COMPLETE' : 'PARTIAL_FAILURE',
        doorsLocked: data.securedCount || 0,
        doorsFailed: (data.failures || []).map((f: any) => ({
          doorId: f.doorId,
          doorName: f.doorName,
          reason: f.reason,
        })),
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    } catch (err) {
      return {
        lockdownId: '',
        status: 'PARTIAL_FAILURE',
        doorsLocked: 0,
        doorsFailed: [],
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    }
  }

  async releaseLockdown(lockdownId: string): Promise<LockdownResult> {
    const start = Date.now();
    try {
      const response = await this.request('POST', `/api/v1/lockdowns/${lockdownId}/release`, {
        source: 'SafeSchool',
      });
      const data: any = await response.json();

      return {
        lockdownId,
        status: 'COMPLETE',
        doorsLocked: 0,
        doorsFailed: [],
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    } catch (err) {
      return {
        lockdownId,
        status: 'PARTIAL_FAILURE',
        doorsLocked: 0,
        doorsFailed: [{ doorId: 'unknown', doorName: 'Unknown', reason: err instanceof Error ? err.message : 'Release failed' }],
        timeToCompleteMs: Date.now() - start,
        timestamp: new Date(),
      };
    }
  }

  async getDoorStatus(doorId: string): Promise<DoorStatus> {
    const response = await this.request('GET', `/api/v1/doors/${doorId}/status`);
    const data: any = await response.json();
    return mapSicunetStatus(data.status);
  }

  async getAllDoorStatuses(): Promise<Map<string, DoorStatus>> {
    const params = this.siteId ? `?siteId=${this.siteId}` : '';
    const response = await this.request('GET', `/api/v1/doors/status${params}`);
    const data: any = await response.json();
    const statuses = new Map<string, DoorStatus>();

    for (const door of data.doors || []) {
      statuses.set(door.id, mapSicunetStatus(door.status));
    }

    return statuses;
  }

  onDoorEvent(callback: (event: DoorEvent) => void): void {
    this.eventCallbacks.push(callback);
  }

  // ---- Sicunet-specific methods (beyond the standard adapter interface) ----

  /**
   * Provision a temporary visitor credential.
   * Unique to Sicunet's deep integration with SafeSchool's visitor management.
   */
  async provisionVisitorCredential(
    visitorId: string,
    accessZones: string[],
    expiresAt: Date,
  ): Promise<{ credentialId: string; cardNumber: string }> {
    const response = await this.request('POST', '/api/v1/credentials/temporary', {
      visitorId,
      accessZones,
      expiresAt: expiresAt.toISOString(),
      credentialType: 'mobile', // Default to mobile credential
      source: 'SafeSchool-Visitor',
    });
    return response.json() as Promise<{ credentialId: string; cardNumber: string }>;
  }

  /**
   * Revoke a visitor credential immediately (e.g., on checkout or alert).
   */
  async revokeCredential(credentialId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/credentials/${credentialId}`, {
      reason: 'SafeSchool-Revoke',
    });
  }

  /**
   * Revoke all temporary credentials for a site during lockdown.
   */
  async revokeAllTemporaryCredentials(siteId?: string): Promise<{ revokedCount: number }> {
    const response = await this.request('POST', '/api/v1/credentials/revoke-temporary', {
      siteId: siteId || this.siteId,
      source: 'SafeSchool-Lockdown',
    });
    return response.json() as Promise<{ revokedCount: number }>;
  }

  /**
   * Get all doors with their full details for mapping/floor plan display.
   */
  async getDoors(): Promise<any[]> {
    const params = this.siteId ? `?siteId=${this.siteId}` : '';
    const response = await this.request('GET', `/api/v1/doors${params}`);
    const data: any = await response.json();
    return data.doors || [];
  }

  /**
   * Get zones configured in Sicunet for zone-based lockdown.
   */
  async getZones(): Promise<Array<{ id: string; name: string; doorCount: number }>> {
    const params = this.siteId ? `?siteId=${this.siteId}` : '';
    const response = await this.request('GET', `/api/v1/zones${params}`);
    const data: any = await response.json();
    return data.zones || [];
  }

  /**
   * Get mustering/headcount data from door access events.
   * Useful for evacuation scenarios — shows who is where.
   */
  async getMusterReport(buildingId: string): Promise<Array<{
    personId: string;
    personName: string;
    lastZone: string;
    lastDoor: string;
    lastAccess: Date;
  }>> {
    const response = await this.request('GET', `/api/v1/buildings/${buildingId}/muster`);
    const data: any = await response.json();
    return (data.occupants || []).map((o: any) => ({
      personId: o.personId,
      personName: o.personName,
      lastZone: o.lastZone,
      lastDoor: o.lastDoor,
      lastAccess: new Date(o.lastAccess),
    }));
  }

  /**
   * Set anti-passback mode (useful during lockdowns to track direction of movement).
   */
  async setAntiPassback(enabled: boolean, doorIds?: string[]): Promise<void> {
    await this.request('POST', '/api/v1/settings/anti-passback', {
      enabled,
      doorIds,
      source: 'SafeSchool',
    });
  }

  /**
   * Override a door schedule (e.g., keep doors locked past normal unlock time during a threat).
   */
  async overrideSchedule(doorId: string, overrideUntil: Date, lockState: 'LOCKED' | 'UNLOCKED'): Promise<void> {
    await this.request('POST', `/api/v1/doors/${doorId}/schedule-override`, {
      overrideUntil: overrideUntil.toISOString(),
      lockState,
      source: 'SafeSchool',
    });
  }

  /**
   * Clear all schedule overrides (return to normal operation).
   */
  async clearScheduleOverrides(siteId?: string): Promise<void> {
    await this.request('POST', '/api/v1/schedule-overrides/clear', {
      siteId: siteId || this.siteId,
      source: 'SafeSchool',
    });
  }

  // ---- Private helpers ----

  private async request(method: string, path: string, body?: any): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Integration': 'SafeSchool',
        'X-Site-Id': this.siteId,
      },
      signal: AbortSignal.timeout(10000),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    return fetch(url, options);
  }

  private async startEventStream(): Promise<void> {
    // Try SSE first, fall back to polling
    if (typeof EventSource !== 'undefined') {
      try {
        await this.connectSSE();
        return;
      } catch {
        // SSE not available, fall back to polling
      }
    }
    this.startPolling();
  }

  private async connectSSE(): Promise<void> {
    const url = `${this.baseUrl}${this.eventStreamPath}?apiKey=${this.apiKey}&siteId=${this.siteId}`;

    return new Promise((resolve, reject) => {
      const es = new EventSource(url);

      es.onopen = () => {
        this.eventSource = es;
        this.reconnectAttempts = 0;
        resolve();
      };

      es.addEventListener('door_event', ((e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.lastEventId = e.lastEventId || '';
          const doorEvent: DoorEvent = {
            doorId: data.doorId,
            doorName: data.doorName,
            eventType: mapSicunetEventType(data.type),
            timestamp: new Date(data.timestamp),
            userId: data.userId,
            credentialType: data.credentialType,
          };

          for (const callback of this.eventCallbacks) {
            callback(doorEvent);
          }
        } catch {
          // Invalid event data, skip
        }
      }) as EventListener);

      es.addEventListener('heartbeat', () => {
        // Keep-alive, no action needed
      });

      es.onerror = () => {
        es.close();
        this.eventSource = null;

        if (!this.connected) return;

        this.reconnectAttempts++;
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 16000);
          setTimeout(() => {
            if (this.connected) {
              this.connectSSE().catch(() => this.startPolling());
            }
          }, delay);
        } else {
          // Give up on SSE, fall back to polling
          this.startPolling();
        }
      };

      // Timeout if connection doesn't open in 5s
      setTimeout(() => {
        if (!this.eventSource) {
          es.close();
          reject(new Error('SSE connection timeout'));
        }
      }, 5000);
    });
  }

  private startPolling(): void {
    if (this.pollTimer) return; // Already polling

    this.pollTimer = setInterval(async () => {
      if (!this.connected) {
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        return;
      }

      try {
        const params = this.lastEventId ? `?after=${this.lastEventId}` : '?limit=10';
        const response = await this.request('GET', `/api/v1/events/recent${params}`);
        const data: any = await response.json();

        for (const event of data.events || []) {
          if (event.id) this.lastEventId = event.id;

          const doorEvent: DoorEvent = {
            doorId: event.doorId,
            doorName: event.doorName,
            eventType: mapSicunetEventType(event.type),
            timestamp: new Date(event.timestamp),
            userId: event.userId,
            credentialType: event.credentialType,
          };

          for (const callback of this.eventCallbacks) {
            callback(doorEvent);
          }
        }
      } catch {
        // Polling failure — log but don't crash
      }
    }, this.pollIntervalMs);
  }
}

/** Map Sicunet door status strings to SafeSchool DoorStatus enum */
function mapSicunetStatus(status: string): DoorStatus {
  const mapping: Record<string, DoorStatus> = {
    'locked': 'LOCKED' as DoorStatus,
    'unlocked': 'UNLOCKED' as DoorStatus,
    'open': 'OPEN' as DoorStatus,
    'forced': 'FORCED' as DoorStatus,
    'held_open': 'HELD' as DoorStatus,
    'held': 'HELD' as DoorStatus,
    'unknown': 'UNKNOWN' as DoorStatus,
    'offline': 'UNKNOWN' as DoorStatus,
  };
  return mapping[status?.toLowerCase()] || ('UNKNOWN' as DoorStatus);
}

/** Map Sicunet event type strings to SafeSchool DoorEvent event types */
type DoorEventType = 'OPENED' | 'CLOSED' | 'LOCKED' | 'UNLOCKED' | 'FORCED' | 'HELD' | 'ALARM';

function mapSicunetEventType(type: string): DoorEventType {
  const mapping: Record<string, DoorEventType> = {
    'door_locked': 'LOCKED',
    'door_unlocked': 'UNLOCKED',
    'door_opened': 'OPENED',
    'door_closed': 'CLOSED',
    'door_forced': 'FORCED',
    'door_held_open': 'HELD',
    'access_granted': 'UNLOCKED',
    'access_denied': 'LOCKED',
    'lockdown_activated': 'LOCKED',
    'lockdown_released': 'UNLOCKED',
  };
  return mapping[type?.toLowerCase()] || 'ALARM';
}
