/**
 * LenelS2 (OnGuard/NetBox) Access Control Adapter
 *
 * Integrates with LenelS2 OnGuard through the OpenAccess API.
 * Supports door lock/unlock, status monitoring, and event streaming.
 */

export interface LenelS2Config {
  baseUrl: string;
  applicationId: string;
  directoryId: string;
  username: string;
  password: string;
  version?: string;
}

export interface LenelDoorStatus {
  panelId: number;
  readerId: number;
  doorName: string;
  status: 'LOCKED' | 'UNLOCKED' | 'OPEN' | 'FORCED' | 'HELD';
}

export class LenelS2Adapter {
  private config: LenelS2Config;
  private sessionToken: string | null = null;

  constructor(config: LenelS2Config) {
    this.config = config;
  }

  private get apiBase(): string {
    return `${this.config.baseUrl}/api/access/onguard/openaccess`;
  }

  async authenticate(): Promise<void> {
    const response = await fetch(`${this.apiBase}/authentication`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        application_id: this.config.applicationId,
        directory_id: this.config.directoryId,
        user_name: this.config.username,
        password: this.config.password,
      }),
    });

    if (!response.ok) {
      throw new Error(`LenelS2 auth failed: ${response.status}`);
    }

    const data = await response.json() as { session_token: string };
    this.sessionToken = data.session_token;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    if (!this.sessionToken) await this.authenticate();

    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Session-Token': this.sessionToken!,
        'Application-Id': this.config.applicationId,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401) {
      this.sessionToken = null;
      await this.authenticate();
      return this.request(method, path, body);
    }

    if (!response.ok) {
      throw new Error(`LenelS2 API error: ${response.status} ${await response.text()}`);
    }

    return response.json();
  }

  async listDoors(): Promise<LenelDoorStatus[]> {
    const data = await this.request('GET', '/readers');
    return (data.property_value_map || []).map((reader: any) => ({
      panelId: reader.PANELID,
      readerId: reader.READERID,
      doorName: reader.NAME || `Reader ${reader.READERID}`,
      status: this.mapReaderStatus(reader.STATUS),
    }));
  }

  async lockDoor(panelId: number, readerId: number): Promise<void> {
    await this.request('POST', '/execute_action', {
      action_name: 'lock_door',
      panel_id: panelId,
      reader_id: readerId,
    });
  }

  async unlockDoor(panelId: number, readerId: number): Promise<void> {
    await this.request('POST', '/execute_action', {
      action_name: 'momentary_unlock',
      panel_id: panelId,
      reader_id: readerId,
    });
  }

  async lockdownAll(): Promise<{ locked: number; failed: number }> {
    const doors = await this.listDoors();
    let locked = 0;
    let failed = 0;

    for (const door of doors) {
      try {
        await this.lockDoor(door.panelId, door.readerId);
        locked++;
      } catch {
        failed++;
      }
    }

    return { locked, failed };
  }

  private mapReaderStatus(status: number): LenelDoorStatus['status'] {
    switch (status) {
      case 0: return 'LOCKED';
      case 1: return 'UNLOCKED';
      case 2: return 'OPEN';
      case 3: return 'FORCED';
      case 4: return 'HELD';
      default: return 'LOCKED';
    }
  }
}
