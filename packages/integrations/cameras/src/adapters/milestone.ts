/**
 * Milestone XProtect VMS Adapter
 *
 * Integrates with Milestone XProtect via the MIP VMS API (API Gateway).
 * Protocol: RESTful + WebSocket events
 * Auth: OAuth2 Bearer Token via built-in IDP
 *
 * Supports: camera listing, WebRTC streaming, snapshot via ImageServer,
 * PTZ via REST, and WebSocket event subscriptions for motion detection.
 *
 * @see https://doc.developer.milestonesys.com/mipvmsapi/
 */

import type { Camera, CameraAdapter, CameraConfig, MotionEvent, PTZCommand, StreamInfo } from '../index.js';

export class MilestoneAdapter implements CameraAdapter {
  name = 'Milestone XProtect';

  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private connected = false;
  private motionCallbacks: ((event: MotionEvent) => void)[] = [];

  constructor(config: CameraConfig) {
    this.baseUrl = (config.host || 'https://localhost').replace(/\/$/, '');
    this.clientId = config.clientId || '';
    this.clientSecret = config.clientSecret || '';
  }

  async connect(): Promise<void> {
    await this.authenticate();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.accessToken = null;
  }

  async getCameras(): Promise<Camera[]> {
    const data = await this.request('GET', '/api/rest/v1/cameras');
    const cameras: any[] = data?.array || data?.cameras || [];

    return cameras.map((cam: any) => ({
      id: cam.id || cam.guid,
      name: cam.name || cam.displayName || 'Unknown Camera',
      model: cam.model || '',
      manufacturer: 'Milestone',
      location: {
        buildingId: cam.parentFolder,
        description: cam.description || cam.shortName,
      },
      status: cam.enabled !== false ? 'ONLINE' : 'OFFLINE',
      capabilities: {
        ptz: cam.ptzEnabled || false,
        audio: cam.audioEnabled || false,
        analytics: cam.analyticsEnabled || false,
        ir: false,
      },
    }));
  }

  async getStream(cameraId: string): Promise<StreamInfo> {
    // Milestone uses WebRTC via session negotiation
    return {
      url: `${this.baseUrl}/webRTC/session?cameraId=${cameraId}`,
      protocol: 'webrtc',
    };
  }

  async getSnapshot(cameraId: string): Promise<Buffer> {
    // Milestone snapshots can be retrieved via the alarms API
    // or the ImageServer protocol (TCP 7563). Using REST approach:
    const response = await fetch(
      `${this.baseUrl}/api/rest/v1/cameras/${cameraId}/snapshot`,
      {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      throw new Error(`Milestone snapshot failed: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async ptzControl(cameraId: string, command: PTZCommand): Promise<void> {
    await this.request('POST', `/api/rest/v1/cameras/${cameraId}/ptz`, {
      pan: command.pan || 0,
      tilt: command.tilt || 0,
      zoom: command.zoom || 0,
    });
  }

  onMotionEvent(callback: (event: MotionEvent) => void): void {
    this.motionCallbacks.push(callback);
  }

  /** Process an incoming motion event from WebSocket subscription */
  handleMotionWebhook(payload: any): void {
    const event: MotionEvent = {
      cameraId: payload.sourceId || payload.cameraId,
      timestamp: new Date(payload.timestamp || Date.now()),
      region: payload.region || 'default',
      confidence: payload.confidence ?? 1.0,
    };

    for (const cb of this.motionCallbacks) {
      cb(event);
    }
  }

  // ── Auth ──────────────────────────────────────────────

  private async authenticate(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/API/IDP/connect/token`, {
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
      throw new Error(`Milestone auth failed: ${response.status}`);
    }

    const data: any = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  }

  private async ensureToken(): Promise<void> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt - 60000) {
      await this.authenticate();
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    await this.ensureToken();

    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(10000),
    };

    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);

    if (response.status === 401) {
      await this.authenticate();
      return this.request(method, path, body);
    }

    if (!response.ok) {
      throw new Error(`Milestone API error: ${response.status}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
}
