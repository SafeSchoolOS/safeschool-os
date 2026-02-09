/**
 * Allegion (Schlage) Access Control Adapter
 *
 * Integrates with Allegion's Schlage Home API and ENGAGE Cloud for WiFi
 * and BLE commercial wireless locks.
 *
 * Auth: OAuth 2.0 Authorization Code + Subscription Key (alle-subscription-key header)
 * Commands are async (202 ACCEPTED) with webhook-based confirmation.
 *
 * @see https://developer.allegion.com
 * @see https://developerapi.allegion.com
 */

import {
  DoorStatus,
  type AccessControlAdapter,
  type AccessControlConfig,
  type DoorCommandResult,
  type DoorEvent,
  type LockdownResult,
} from '@safeschool/core';

export class AllegionAdapter implements AccessControlAdapter {
  name = 'Allegion';
  vendor = 'Allegion';

  private baseUrl = 'https://api.allegion.com';
  private accessToken = '';
  private subscriptionKey = '';
  private connected = false;
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];

  async connect(config: AccessControlConfig): Promise<void> {
    this.baseUrl = config.apiUrl || this.baseUrl;
    this.accessToken = config.apiKey || '';
    this.subscriptionKey = (config.options?.subscriptionKey as string) || '';

    const healthy = await this.healthCheck();
    if (!healthy) throw new Error('Failed to connect to Allegion API');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/devices');
      return response.ok;
    } catch {
      return false;
    }
  }

  async lockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      const response = await this.request('POST', `/devices/${doorId}/lock`);
      // Allegion returns 202 ACCEPTED (async command)
      return {
        success: response.status === 202 || response.ok,
        doorId,
        newStatus: DoorStatus.LOCKED,
        executionTimeMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        doorId,
        newStatus: DoorStatus.UNKNOWN,
        executionTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async unlockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      const response = await this.request('POST', `/devices/${doorId}/unlock`);
      return {
        success: response.status === 202 || response.ok,
        doorId,
        newStatus: DoorStatus.UNLOCKED,
        executionTimeMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        doorId,
        newStatus: DoorStatus.UNKNOWN,
        executionTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  async lockdownBuilding(_buildingId: string): Promise<LockdownResult> {
    const start = Date.now();
    const allDoors = await this.getAllDoorStatuses();
    let locked = 0;
    const failed: { doorId: string; doorName: string; reason: string }[] = [];

    for (const [doorId] of allDoors) {
      const result = await this.lockDoor(doorId);
      if (result.success) {
        locked++;
      } else {
        failed.push({ doorId, doorName: doorId, reason: result.error || 'Lock failed' });
      }
    }

    return {
      lockdownId: `allegion-lockdown-${Date.now()}`,
      status: failed.length === 0 ? 'COMPLETE' : 'PARTIAL_FAILURE',
      doorsLocked: locked,
      doorsFailed: failed,
      timeToCompleteMs: Date.now() - start,
      timestamp: new Date(),
    };
  }

  async lockdownZone(zoneId: string): Promise<LockdownResult> {
    return this.lockdownBuilding(zoneId);
  }

  async releaseLockdown(_lockdownId: string): Promise<LockdownResult> {
    const start = Date.now();
    const allDoors = await this.getAllDoorStatuses();

    for (const [doorId] of allDoors) {
      await this.unlockDoor(doorId);
    }

    return {
      lockdownId: _lockdownId,
      status: 'COMPLETE',
      doorsLocked: 0,
      doorsFailed: [],
      timeToCompleteMs: Date.now() - start,
      timestamp: new Date(),
    };
  }

  async getDoorStatus(doorId: string): Promise<DoorStatus> {
    try {
      const response = await this.request('GET', `/devices/${doorId}`);
      const data: any = await response.json();
      if (data.lockState === 'locked') return DoorStatus.LOCKED;
      if (data.lockState === 'unlocked') return DoorStatus.UNLOCKED;
      return DoorStatus.UNKNOWN;
    } catch {
      return DoorStatus.UNKNOWN;
    }
  }

  async getAllDoorStatuses(): Promise<Map<string, DoorStatus>> {
    const statuses = new Map<string, DoorStatus>();
    try {
      const response = await this.request('GET', '/devices');
      const data: any = await response.json();
      for (const device of data?.devices || data || []) {
        const id = device.deviceId || device.id;
        let status = DoorStatus.UNKNOWN;
        if (device.lockState === 'locked') status = DoorStatus.LOCKED;
        else if (device.lockState === 'unlocked') status = DoorStatus.UNLOCKED;
        statuses.set(id, status);
      }
    } catch {
      // Return empty map on error
    }
    return statuses;
  }

  onDoorEvent(callback: (event: DoorEvent) => void): void {
    this.eventCallbacks.push(callback);
  }

  /** Process incoming Allegion webhook events */
  handleWebhook(payload: any): void {
    if (!payload?.deviceId) return;

    const eventTypeMap: Record<string, DoorEvent['eventType']> = {
      lock: 'LOCKED',
      unlock: 'UNLOCKED',
      alarm: 'ALARM',
      forced: 'FORCED',
    };

    const event: DoorEvent = {
      doorId: payload.deviceId,
      doorName: payload.deviceName || payload.deviceId,
      eventType: eventTypeMap[payload.eventType] || 'LOCKED',
      timestamp: new Date(payload.timestamp || Date.now()),
    };

    for (const cb of this.eventCallbacks) {
      cb(event);
    }
  }

  private async request(method: string, path: string, body?: any): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.accessToken}`,
      'alle-subscription-key': this.subscriptionKey,
    };

    const options: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(10000),
    };

    if (body) options.body = JSON.stringify(body);
    return fetch(url, options);
  }
}
