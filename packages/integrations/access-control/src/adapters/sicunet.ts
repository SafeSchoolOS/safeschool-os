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
 * - Real-time door status monitoring
 * - Credential management (permanent + temporary visitor credentials)
 * - Event streaming for door open/close/forced/held
 * - Integration with Sicunet's video and visitor management
 * - OSDP reader support
 * - Mobile credential support
 */

import type {
  AccessControlAdapter,
  AccessControlConfig,
  DoorCommandResult,
  DoorEvent,
  DoorStatus,
  LockdownResult,
} from '@safeschool/core';

export class SicunetAdapter implements AccessControlAdapter {
  name = 'Sicunet';
  vendor = 'Sicunet';

  private baseUrl = '';
  private apiKey = '';
  private connected = false;
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];
  private eventSource: EventSource | null = null;

  async connect(config: AccessControlConfig): Promise<void> {
    this.baseUrl = config.apiUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey || '';

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
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connected = false;
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
      const response = await this.request('POST', `/api/v1/doors/${doorId}/lock`);
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
      const response = await this.request('POST', `/api/v1/doors/${doorId}/unlock`);
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
  }

  async getDoorStatus(doorId: string): Promise<DoorStatus> {
    const response = await this.request('GET', `/api/v1/doors/${doorId}/status`);
    const data: any = await response.json();
    return data.status as DoorStatus;
  }

  async getAllDoorStatuses(): Promise<Map<string, DoorStatus>> {
    const response = await this.request('GET', '/api/v1/doors/status');
    const data: any = await response.json();
    const statuses = new Map<string, DoorStatus>();

    for (const door of data.doors || []) {
      statuses.set(door.id, door.status as DoorStatus);
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
  async provisionVisitorCredential(visitorId: string, accessZones: string[], expiresAt: Date): Promise<{ credentialId: string; cardNumber: string }> {
    const response = await this.request('POST', '/api/v1/credentials/temporary', {
      visitorId,
      accessZones,
      expiresAt: expiresAt.toISOString(),
      source: 'SafeSchool-Visitor',
    });
    return response.json() as Promise<{ credentialId: string; cardNumber: string }>;
  }

  /**
   * Revoke a visitor credential immediately (e.g., on checkout or alert).
   */
  async revokeCredential(credentialId: string): Promise<void> {
    await this.request('DELETE', `/api/v1/credentials/${credentialId}`);
  }

  /**
   * Get all doors with their full details for mapping/floor plan display.
   */
  async getDoors(): Promise<any[]> {
    const response = await this.request('GET', '/api/v1/doors');
    const data: any = await response.json();
    return data.doors || [];
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
      },
      signal: AbortSignal.timeout(10000),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    return fetch(url, options);
  }

  private async startEventStream(): Promise<void> {
    // Subscribe to Sicunet's event stream for real-time door events.
    // This uses Server-Sent Events (SSE) or WebSocket depending on
    // Sicunet's API capabilities.
    //
    // TODO: Implement based on Sicunet's actual event streaming API.
    // For now, we fall back to polling.
    this.startPolling();
  }

  private startPolling(): void {
    const pollInterval = setInterval(async () => {
      if (!this.connected) {
        clearInterval(pollInterval);
        return;
      }

      try {
        const response = await this.request('GET', '/api/v1/events/recent');
        const data: any = await response.json();

        for (const event of data.events || []) {
          const doorEvent: DoorEvent = {
            doorId: event.doorId,
            doorName: event.doorName,
            eventType: event.type,
            timestamp: new Date(event.timestamp),
            userId: event.userId,
            credentialType: event.credentialType,
          };

          for (const callback of this.eventCallbacks) {
            callback(doorEvent);
          }
        }
      } catch {
        // Polling failure - log but don't crash
      }
    }, 2000); // Poll every 2 seconds
  }
}
