/**
 * ASSA ABLOY (Abloy BEAT / CUMULUS) Access Control Adapter
 *
 * Integrates with ASSA ABLOY's cloud-based keyless access management API
 * (Abloy BEAT / CUMULUS Administration API v2).
 *
 * Auth: API Key (X-API-Key header) + JWT Bearer Token via /login endpoint.
 * Lock/unlock is permission-based via gateway remote operations.
 *
 * @see https://api-docs.keyless.assaabloy.com/administration/v2/index.html
 */

import {
  DoorStatus,
  type AccessControlAdapter,
  type AccessControlConfig,
  type DoorCommandResult,
  type DoorEvent,
  type LockdownResult,
} from '@safeschool/core';

export class AssaAbloyAdapter implements AccessControlAdapter {
  name = 'ASSA ABLOY';
  vendor = 'ASSA ABLOY';

  private baseUrl = 'https://eu-api.keyless.assaabloy.com/administration';
  private apiKey = '';
  private jwtToken = '';
  private tokenExpiresAt = 0;
  private username = '';
  private password = '';
  private connected = false;
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];

  async connect(config: AccessControlConfig): Promise<void> {
    this.baseUrl = config.apiUrl || this.baseUrl;
    this.apiKey = config.apiKey || '';
    this.username = config.username || '';
    this.password = config.password || '';

    await this.authenticate();

    const healthy = await this.healthCheck();
    if (!healthy) throw new Error('Failed to connect to ASSA ABLOY API');
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.jwtToken = '';
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('GET', '/locking-devices?limit=1');
      return true;
    } catch {
      return false;
    }
  }

  async lockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    try {
      await this.request('POST', `/locking-devices/${doorId}/lock`, {
        source: 'SafeSchool',
      });
      return {
        success: true,
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
      await this.request('POST', `/locking-devices/${doorId}/unlock`, {
        source: 'SafeSchool',
        durationSeconds: 5,
      });
      return {
        success: true,
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
      lockdownId: `assa-lockdown-${Date.now()}`,
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
      const data = await this.request('GET', `/locking-devices/${doorId}`);
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
      const data = await this.request('GET', '/locking-devices');
      for (const device of data?.lockingDevices || data || []) {
        const id = device.id || device.lockingDeviceId;
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

  /** Process incoming ASSA ABLOY webhook (LockingDeviceAuditLogEntryReceivedV2) */
  handleWebhook(payload: any): void {
    if (!payload?.lockingDeviceId) return;

    const event: DoorEvent = {
      doorId: payload.lockingDeviceId,
      doorName: payload.lockingDeviceName || payload.lockingDeviceId,
      eventType: payload.operation === 'unlock' ? 'UNLOCKED' : 'LOCKED',
      timestamp: new Date(payload.timestamp || Date.now()),
      userId: payload.userId,
    };

    for (const cb of this.eventCallbacks) {
      cb(event);
    }
  }

  // ── Auth ──────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`ASSA ABLOY auth failed: ${response.status}`);
    }

    const data: any = await response.json();
    this.jwtToken = data.token || data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  }

  private async ensureToken(): Promise<void> {
    if (!this.jwtToken || Date.now() >= this.tokenExpiresAt - 60000) {
      await this.authenticate();
    }
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    await this.ensureToken();

    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.jwtToken}`,
        'X-API-Key': this.apiKey,
      },
      signal: AbortSignal.timeout(10000),
    };

    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);

    if (response.status === 401) {
      await this.authenticate();
      return this.request(method, path, body);
    }

    if (!response.ok) {
      throw new Error(`ASSA ABLOY API error: ${response.status}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
}
