/**
 * Genetec Security Center Access Control Adapter
 *
 * Integrates with Genetec's Security Center via WebSDK REST API.
 * Default port: 4590 (HTTPS)
 * Auth: Basic Auth with format "user;appId:password"
 */

import type {
  AccessControlAdapter,
  AccessControlConfig,
  DoorCommandResult,
  DoorEvent,
  DoorStatus,
  LockdownResult,
} from '@safeschool/core';

export class GenetecAdapter implements AccessControlAdapter {
  name = 'Genetec';
  vendor = 'Genetec';

  private baseUrl = '';
  private authHeader = '';
  private connected = false;
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];

  async connect(config: AccessControlConfig): Promise<void> {
    this.baseUrl = config.apiUrl.replace(/\/$/, '');
    const username = config.username || '';
    const appId = config.options?.appId || 'SafeSchool';
    const password = config.password || '';
    this.authHeader = 'Basic ' + Buffer.from(`${username};${appId}:${password}`).toString('base64');

    const healthy = await this.healthCheck();
    if (!healthy) {
      throw new Error('Failed to connect to Genetec WebSDK');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/api/V1/entity/');
      return response.ok;
    } catch {
      return false;
    }
  }

  async lockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      const response = await this.request('POST', `/api/V1/entity/${doorId}/action/Lock`);
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
      const response = await this.request('POST', `/api/V1/entity/${doorId}/action/Unlock`);
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
      // Genetec uses "area" entities for building-level lockdown
      const response = await this.request('POST', `/api/V1/entity/${buildingId}/action/Lockdown`, {
        excludeFireEgress: true,
        source: 'SafeSchool',
      });
      const data: any = await response.json();

      return {
        lockdownId: data.lockdownId || buildingId,
        status: data.allSecured ? 'COMPLETE' : 'PARTIAL_FAILURE',
        doorsLocked: data.securedCount || 0,
        doorsFailed: (data.failures || []).map((f: any) => ({
          doorId: f.entityId,
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
      const response = await this.request('POST', `/api/V1/entity/${zoneId}/action/Lockdown`, {
        source: 'SafeSchool',
      });
      const data: any = await response.json();

      return {
        lockdownId: data.lockdownId || zoneId,
        status: data.allSecured ? 'COMPLETE' : 'PARTIAL_FAILURE',
        doorsLocked: data.securedCount || 0,
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
    await this.request('POST', `/api/V1/entity/${lockdownId}/action/ReleaseLockdown`, {
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
    const response = await this.request('GET', `/api/V1/entity/${doorId}`);
    const data: any = await response.json();
    const state = data?.DoorState?.toLowerCase();
    if (state === 'locked') return 'LOCKED' as DoorStatus;
    if (state === 'unlocked') return 'UNLOCKED' as DoorStatus;
    if (state === 'open') return 'OPEN' as DoorStatus;
    return 'UNKNOWN' as DoorStatus;
  }

  async getAllDoorStatuses(): Promise<Map<string, DoorStatus>> {
    const response = await this.request('GET', '/api/V1/entity/?EntityType=Door');
    const data: any = await response.json();
    const statuses = new Map<string, DoorStatus>();

    for (const door of data?.Entities || []) {
      const state = door.DoorState?.toLowerCase();
      let status: DoorStatus = 'UNKNOWN' as DoorStatus;
      if (state === 'locked') status = 'LOCKED' as DoorStatus;
      else if (state === 'unlocked') status = 'UNLOCKED' as DoorStatus;
      else if (state === 'open') status = 'OPEN' as DoorStatus;
      statuses.set(door.Guid, status);
    }

    return statuses;
  }

  onDoorEvent(callback: (event: DoorEvent) => void): void {
    this.eventCallbacks.push(callback);
  }

  private async request(method: string, path: string, body?: any): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': this.authHeader,
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
}
