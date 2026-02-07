/**
 * Verkada Access Control Adapter
 *
 * Integrates with Verkada's REST API for door control and lockdown.
 * Auth: API Key + short-lived token via /access/v1/credentials
 * Supports: door lock/unlock, lockdown scenario activation/deactivation
 */

import type {
  AccessControlAdapter,
  AccessControlConfig,
  DoorCommandResult,
  DoorEvent,
  DoorStatus,
  LockdownResult,
} from '@safeschool/core';

export class VerkadaAdapter implements AccessControlAdapter {
  name = 'Verkada';
  vendor = 'Verkada';

  private baseUrl = 'https://api.verkada.com';
  private apiKey = '';
  private orgId = '';
  private accessToken = '';
  private tokenExpiresAt = 0;
  private connected = false;
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];

  async connect(config: AccessControlConfig): Promise<void> {
    this.baseUrl = config.apiUrl || this.baseUrl;
    this.apiKey = config.apiKey || '';
    this.orgId = (config.options?.orgId as string) || '';

    await this.ensureToken();

    const healthy = await this.healthCheck();
    if (!healthy) {
      throw new Error('Failed to connect to Verkada API');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/access/v1/doors');
      return response.ok;
    } catch {
      return false;
    }
  }

  async lockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      const response = await this.request('POST', `/access/v1/doors/${doorId}/lock`);
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
      const response = await this.request('POST', `/access/v1/doors/${doorId}/unlock`);
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
      // Verkada uses "scenarios" for lockdown — activate the lockdown scenario
      const response = await this.request('POST', `/access/v1/scenarios/activate`, {
        scenarioType: 'lockdown',
        siteId: buildingId,
        excludeFireEgress: true,
        source: 'SafeSchool',
      });
      const data: any = await response.json();

      return {
        lockdownId: data.scenarioId || buildingId,
        status: response.ok ? 'COMPLETE' : 'PARTIAL_FAILURE',
        doorsLocked: data.doorsLocked || 0,
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
      const response = await this.request('POST', `/access/v1/scenarios/activate`, {
        scenarioType: 'lockdown',
        zoneId,
        source: 'SafeSchool',
      });
      const data: any = await response.json();

      return {
        lockdownId: data.scenarioId || zoneId,
        status: response.ok ? 'COMPLETE' : 'PARTIAL_FAILURE',
        doorsLocked: data.doorsLocked || 0,
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
    await this.request('POST', `/access/v1/scenarios/${lockdownId}/deactivate`, {
      source: 'SafeSchool',
    });

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
    const response = await this.request('GET', `/access/v1/doors/${doorId}`);
    const data: any = await response.json();
    const state = data?.lockStatus;
    if (state === 'locked') return 'LOCKED' as DoorStatus;
    if (state === 'unlocked') return 'UNLOCKED' as DoorStatus;
    return 'UNKNOWN' as DoorStatus;
  }

  async getAllDoorStatuses(): Promise<Map<string, DoorStatus>> {
    const response = await this.request('GET', '/access/v1/doors');
    const data: any = await response.json();
    const statuses = new Map<string, DoorStatus>();

    for (const door of data?.doors || []) {
      let status: DoorStatus = 'UNKNOWN' as DoorStatus;
      if (door.lockStatus === 'locked') status = 'LOCKED' as DoorStatus;
      else if (door.lockStatus === 'unlocked') status = 'UNLOCKED' as DoorStatus;
      statuses.set(door.doorId, status);
    }

    return statuses;
  }

  onDoorEvent(callback: (event: DoorEvent) => void): void {
    this.eventCallbacks.push(callback);
  }

  private async ensureToken(): Promise<void> {
    if (this.tokenExpiresAt > Date.now() + 60000) return;

    if (!this.apiKey) return;

    try {
      const response = await fetch(`${this.baseUrl}/access/v1/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ org_id: this.orgId }),
        signal: AbortSignal.timeout(10000),
      });

      const data: any = await response.json();
      this.accessToken = data.access_token;
      // Verkada tokens are short-lived (typically 5 minutes)
      this.tokenExpiresAt = Date.now() + 4 * 60 * 1000;
    } catch (err) {
      console.error('[VerkadaAdapter] Token refresh failed:', err);
    }
  }

  private async request(method: string, path: string, body?: any): Promise<Response> {
    await this.ensureToken();

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Integration': 'SafeSchool',
    };

    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

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
