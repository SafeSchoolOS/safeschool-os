/**
 * Genetec Security Center VMS Adapter
 *
 * Integrates with Genetec Security Center's REST API to:
 * - List cameras managed by the VMS
 * - Get Media Gateway HLS stream URLs
 * - Fetch snapshots via REST
 * - Receive motion events via webhooks
 * - Authenticate via OAuth2 (client_credentials grant)
 */

import type { Camera, CameraAdapter, CameraConfig, MotionEvent, PTZCommand, StreamInfo } from '../index.js';

export class GenetecVmsAdapter implements CameraAdapter {
  name = 'Genetec VMS';

  private vmsUrl: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private connected = false;
  private motionCallbacks: ((event: MotionEvent) => void)[] = [];

  constructor(config: CameraConfig) {
    this.vmsUrl = (config.host || 'https://localhost:4590').replace(/\/$/, '');
    this.clientId = config.clientId || '';
    this.clientSecret = config.clientSecret || '';
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  async connect(): Promise<void> {
    await this.authenticate();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.connected = false;
  }

  // -----------------------------------------------------------------------
  // Camera listing
  // -----------------------------------------------------------------------

  async getCameras(): Promise<Camera[]> {
    const response = await this.request('GET', '/api/V1/entity/?EntityType=Camera');
    const data: any = await response.json();

    return (data?.Entities || []).map((entity: any) => ({
      id: entity.Guid || entity.Id,
      name: entity.Name || 'Unknown Camera',
      model: entity.Model || 'Unknown',
      manufacturer: entity.Manufacturer || 'Genetec-Managed',
      location: {
        buildingId: entity.LogicalId || undefined,
        description: entity.Description || undefined,
      },
      status: this.mapEntityStatus(entity.State),
      capabilities: {
        ptz: entity.Capabilities?.includes('PTZ') || false,
        audio: entity.Capabilities?.includes('Audio') || false,
        analytics: entity.Capabilities?.includes('Analytics') || false,
        ir: false,
      },
    }));
  }

  // -----------------------------------------------------------------------
  // Streaming (HLS via Media Gateway)
  // -----------------------------------------------------------------------

  async getStream(cameraId: string): Promise<StreamInfo> {
    // Genetec Media Gateway provides HLS streams
    const response = await this.request(
      'POST',
      `/api/V1/entity/${cameraId}/action/GetMediaGatewayStream`,
      { format: 'HLS' },
    );
    const data: any = await response.json();

    const hlsUrl = data?.StreamUrl || `${this.vmsUrl}/media/${cameraId}/stream.m3u8`;

    return {
      url: hlsUrl,
      protocol: 'hls',
    };
  }

  // -----------------------------------------------------------------------
  // Snapshot
  // -----------------------------------------------------------------------

  async getSnapshot(cameraId: string): Promise<Buffer> {
    const response = await this.request('GET', `/api/V1/entity/${cameraId}/snapshot`);

    if (!response.ok) {
      throw new Error(`Snapshot failed: HTTP ${response.status}`);
    }

    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  // -----------------------------------------------------------------------
  // PTZ Control
  // -----------------------------------------------------------------------

  async ptzControl(cameraId: string, command: PTZCommand): Promise<void> {
    const response = await this.request('POST', `/api/V1/entity/${cameraId}/action/PTZ`, {
      Pan: command.pan ?? 0,
      Tilt: command.tilt ?? 0,
      Zoom: command.zoom ?? 0,
      Duration: 500, // ms
    });

    if (!response.ok) {
      throw new Error(`PTZ command failed: HTTP ${response.status}`);
    }
  }

  // -----------------------------------------------------------------------
  // Motion Events
  // -----------------------------------------------------------------------

  onMotionEvent(callback: (event: MotionEvent) => void): void {
    this.motionCallbacks.push(callback);
  }

  /**
   * Called by the webhook handler when Genetec sends a motion event.
   * This method is public so the API route can invoke it.
   */
  handleWebhookEvent(payload: any): void {
    if (payload?.EventType !== 'Motion') return;

    const event: MotionEvent = {
      cameraId: payload.EntityId || payload.CameraId || 'unknown',
      timestamp: new Date(payload.Timestamp || Date.now()),
      region: payload.Region || 'full-frame',
      confidence: payload.Confidence ?? 0.5,
    };

    this.motionCallbacks.forEach((cb) => cb(event));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async authenticate(): Promise<void> {
    const response = await fetch(`${this.vmsUrl}/api/V1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Genetec OAuth2 authentication failed: HTTP ${response.status}`);
    }

    const data: any = await response.json();
    this.accessToken = data.access_token;
    // Expire slightly early to avoid edge cases
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  }

  private async ensureToken(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.authenticate();
    }
  }

  private async request(method: string, path: string, body?: any): Promise<Response> {
    await this.ensureToken();

    const url = `${this.vmsUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
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

  private mapEntityStatus(state: string | undefined): Camera['status'] {
    switch (state?.toLowerCase()) {
      case 'running':
      case 'online':
        return 'ONLINE';
      case 'offline':
      case 'stopped':
        return 'OFFLINE';
      case 'error':
      case 'fault':
        return 'ERROR';
      default:
        return 'UNKNOWN';
    }
  }
}
