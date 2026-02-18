/**
 * Brivo Access Control Adapter
 *
 * Integrates with Brivo's cloud-based access control REST API.
 * Auth: OAuth 2.0 + API Key
 * Supports: door control, lockdown, auto token refresh
 */

import type {
  AccessControlAdapter,
  AccessControlConfig,
  DoorCommandResult,
  DoorEvent,
  DoorStatus,
  LockdownResult,
} from '@safeschool/core';

export class BrivoAdapter implements AccessControlAdapter {
  name = 'Brivo';
  vendor = 'Brivo';

  private baseUrl = 'https://api.brivo.com';
  private apiKey = '';
  private accessToken = '';
  private clientId = '';
  private clientSecret = '';
  private tokenExpiresAt = 0;
  private connected = false;
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];

  async connect(config: AccessControlConfig): Promise<void> {
    this.baseUrl = config.apiUrl || this.baseUrl;
    this.apiKey = config.apiKey || '';
    this.clientId = (config.options?.clientId as string) || '';
    this.clientSecret = (config.options?.clientSecret as string) || '';

    await this.refreshToken();

    const healthy = await this.healthCheck();
    if (!healthy) {
      throw new Error('Failed to connect to Brivo API');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/v1/api/sites');
      return response.ok;
    } catch {
      return false;
    }
  }

  async lockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      const response = await this.request('PUT', `/v1/api/accesspoints/${doorId}/activate`, {
        action: 'lock',
      });
      return {
        success: response.ok,
        doorId,
        newStatus: 'LOCKED' as DoorStatus,
        executionTimeMs: Date.now() - start,
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
      const response = await this.request('PUT', `/v1/api/accesspoints/${doorId}/activate`, {
        action: 'unlock',
      });
      return {
        success: response.ok,
        doorId,
        newStatus: 'UNLOCKED' as DoorStatus,
        executionTimeMs: Date.now() - start,
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
      const response = await this.request('POST', `/v1/api/sites/${buildingId}/lockdown`, {
        type: 'full',
        excludeFireEgress: true,
        source: 'SafeSchool',
      });
      const data: any = await response.json();

      return {
        lockdownId: data.id || buildingId,
        status: response.ok ? 'COMPLETE' : 'PARTIAL_FAILURE',
        doorsLocked: data.lockedCount || 0,
        doorsFailed: (data.failures || []).map((f: any) => ({
          doorId: f.accessPointId,
          doorName: f.name,
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
      const response = await this.request('POST', `/v1/api/groups/${zoneId}/lockdown`, {
        source: 'SafeSchool',
      });
      const data: any = await response.json();

      return {
        lockdownId: data.id || zoneId,
        status: response.ok ? 'COMPLETE' : 'PARTIAL_FAILURE',
        doorsLocked: data.lockedCount || 0,
        doorsFailed: [],
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
    await this.request('DELETE', `/v1/api/lockdowns/${lockdownId}`);

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
    const response = await this.request('GET', `/v1/api/accesspoints/${doorId}`);
    const data: any = await response.json();
    return (data.doorMode?.toUpperCase() || 'UNKNOWN') as DoorStatus;
  }

  async getAllDoorStatuses(): Promise<Map<string, DoorStatus>> {
    const response = await this.request('GET', '/v1/api/accesspoints');
    const data: any = await response.json();
    const statuses = new Map<string, DoorStatus>();

    for (const ap of data?.data || []) {
      statuses.set(ap.id, (ap.doorMode?.toUpperCase() || 'UNKNOWN') as DoorStatus);
    }

    return statuses;
  }

  onDoorEvent(callback: (event: DoorEvent) => void): void {
    this.eventCallbacks.push(callback);
  }

  private async refreshToken(): Promise<void> {
    if (this.tokenExpiresAt > Date.now() + 60000) return; // Still valid

    if (!this.clientId || !this.clientSecret) {
      return; // No OAuth credentials, rely on API key only
    }

    try {
      const response = await fetch(`${this.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
        signal: AbortSignal.timeout(10000),
      });

      const data: any = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    } catch (err) {
      console.error('[BrivoAdapter] Token refresh failed:', err);
    }
  }

  private async request(method: string, path: string, body?: any): Promise<Response> {
    await this.refreshToken();

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Integration': 'SafeSchool',
    };

    if (this.apiKey) headers['api-key'] = this.apiKey;
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;

    const options: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(10000),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    return fetch(url, options);
  }
}
