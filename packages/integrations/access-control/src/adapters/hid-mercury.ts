/**
 * HID Mercury Access Control Adapter
 *
 * Integrates with HID Mercury controller boards via the HID OSDP protocol
 * and HID Origo cloud management platform.
 */

export interface HidMercuryConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
}

export interface MercuryDoor {
  id: string;
  name: string;
  controllerId: string;
  readerNumber: number;
  status: 'LOCKED' | 'UNLOCKED' | 'OPEN' | 'FORCED' | 'HELD' | 'UNKNOWN';
  online: boolean;
}

export class HidMercuryAdapter {
  private config: HidMercuryConfig;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: HidMercuryConfig) {
    this.config = config;
  }

  private async ensureToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return;

    const response = await fetch(`${this.config.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });

    if (!response.ok) throw new Error(`HID auth failed: ${response.status}`);

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    await this.ensureToken();

    const response = await fetch(`${this.config.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HID Mercury API error: ${response.status}`);
    }

    return response.json();
  }

  async listDoors(): Promise<MercuryDoor[]> {
    const data = await this.request('GET', `/sites/${this.config.siteId}/doors`);
    return (data.doors || []).map((door: any) => ({
      id: door.id,
      name: door.name,
      controllerId: door.controller_id,
      readerNumber: door.reader_number,
      status: this.mapStatus(door.lock_state),
      online: door.is_online,
    }));
  }

  async lockDoor(doorId: string): Promise<void> {
    await this.request('POST', `/doors/${doorId}/commands`, {
      command: 'lock',
    });
  }

  async unlockDoor(doorId: string, durationSeconds: number = 5): Promise<void> {
    await this.request('POST', `/doors/${doorId}/commands`, {
      command: 'momentary_unlock',
      duration: durationSeconds,
    });
  }

  async lockdownAll(): Promise<{ locked: number; failed: number }> {
    const doors = await this.listDoors();
    let locked = 0;
    let failed = 0;

    for (const door of doors) {
      try {
        await this.lockDoor(door.id);
        locked++;
      } catch {
        failed++;
      }
    }

    return { locked, failed };
  }

  private mapStatus(state: string): MercuryDoor['status'] {
    switch (state) {
      case 'locked': return 'LOCKED';
      case 'unlocked': return 'UNLOCKED';
      case 'open': return 'OPEN';
      case 'forced': return 'FORCED';
      case 'held': return 'HELD';
      default: return 'UNKNOWN';
    }
  }
}
