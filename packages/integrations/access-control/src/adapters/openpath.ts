/**
 * Openpath Access Control Adapter
 *
 * Integrates with Openpath cloud-first access control via REST API.
 * Supports door lock/unlock, credential management, and lockdown.
 */

export interface OpenpathConfig {
  baseUrl: string;
  orgId: string;
  apiKey: string;
}

export interface OpenpathDoor {
  id: string;
  name: string;
  siteId: string;
  locked: boolean;
  online: boolean;
}

export class OpenpathAdapter {
  private config: OpenpathConfig;

  constructor(config: OpenpathConfig) {
    this.config = config;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const response = await fetch(
      `${this.config.baseUrl}/orgs/${this.config.orgId}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );

    if (!response.ok) {
      throw new Error(`Openpath API error: ${response.status}`);
    }

    return response.json();
  }

  async listDoors(): Promise<OpenpathDoor[]> {
    const data = await this.request('GET', '/entries');
    return (data.data || []).map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      siteId: entry.site?.id,
      locked: entry.lockState === 'locked',
      online: entry.isOnline,
    }));
  }

  async lockDoor(entryId: string): Promise<void> {
    await this.request('POST', `/entries/${entryId}/lock`);
  }

  async unlockDoor(entryId: string, durationSeconds: number = 5): Promise<void> {
    await this.request('POST', `/entries/${entryId}/unlock`, {
      duration: durationSeconds,
    });
  }

  async lockdownSite(siteId: string): Promise<void> {
    await this.request('POST', `/sites/${siteId}/lockdown`, {
      action: 'activate',
    });
  }

  async releaseLockdown(siteId: string): Promise<void> {
    await this.request('POST', `/sites/${siteId}/lockdown`, {
      action: 'deactivate',
    });
  }

  async getDoorStatus(entryId: string): Promise<OpenpathDoor> {
    const data = await this.request('GET', `/entries/${entryId}`);
    return {
      id: data.data.id,
      name: data.data.name,
      siteId: data.data.site?.id,
      locked: data.data.lockState === 'locked',
      online: data.data.isOnline,
    };
  }
}
