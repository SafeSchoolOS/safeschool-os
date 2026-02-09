/**
 * Avigilon ACC/Unity Web Endpoint API (WEP) Camera Adapter
 *
 * Integrates with Avigilon ACC (Access Control Center) / Unity on-premise VMS
 * via the Web Endpoint API (REST).
 *
 * Auth: HMAC-SHA256 partner credentials + session cookie
 * Requires Avigilon Technology Partner Program enrollment for user_nonce/user_key.
 * Contact: integrations@avigilon.com
 *
 * @see https://docs.avigilon.com/bundle/web-endpoint-api/page/introduction.htm
 */

import type { Camera, CameraAdapter, CameraConfig, MotionEvent, PTZCommand, StreamInfo } from '../index.js';
import { createHmac } from 'crypto';

export class AvigilonAdapter implements CameraAdapter {
  name = 'Avigilon ACC';

  private baseUrl: string;
  private username: string;
  private password: string;
  private userNonce: string;
  private userKey: string;
  private sessionToken: string | null = null;
  private connected = false;
  private motionCallbacks: ((event: MotionEvent) => void)[] = [];
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: CameraConfig) {
    const host = (config.host || 'https://localhost:8443').replace(/\/$/, '');
    this.baseUrl = `${host}/mt/api/rest/v1`;
    this.username = config.username || '';
    this.password = config.password || '';
    this.userNonce = (config.options?.userNonce as string) || '';
    this.userKey = (config.options?.userKey as string) || '';
  }

  async connect(): Promise<void> {
    await this.login();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.sessionToken = null;
    this.connected = false;
  }

  async getCameras(): Promise<Camera[]> {
    const data = await this.request('GET', '/cameras');
    const cameras: any[] = data?.cameras || data || [];

    return cameras.map((cam: any) => ({
      id: cam.id || cam.cameraId,
      name: cam.name || cam.displayName || 'Unknown Camera',
      model: cam.model || '',
      manufacturer: 'Avigilon',
      location: {
        description: cam.location || cam.description,
      },
      status: cam.connected ? 'ONLINE' : 'OFFLINE',
      capabilities: {
        ptz: cam.ptzCapable || false,
        audio: cam.audioCapable || false,
        analytics: cam.analyticsEnabled || false,
        ir: false,
      },
    }));
  }

  async getStream(cameraId: string): Promise<StreamInfo> {
    // WEP serves MJPEG streams via /video/stream
    return {
      url: `${this.baseUrl}/video/stream?cameraId=${cameraId}`,
      protocol: 'hls', // MJPEG served as HTTP stream
    };
  }

  async getSnapshot(cameraId: string): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}/video/image?cameraId=${cameraId}`, {
      headers: this.sessionHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Avigilon snapshot failed: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async ptzControl(cameraId: string, command: PTZCommand): Promise<void> {
    await this.request('POST', '/ptz', {
      cameraId,
      pan: command.pan || 0,
      tilt: command.tilt || 0,
      zoom: command.zoom || 0,
    });
  }

  onMotionEvent(callback: (event: MotionEvent) => void): void {
    this.motionCallbacks.push(callback);

    // Start polling for events if not already polling
    if (!this.pollingInterval && this.connected) {
      this.startEventPolling();
    }
  }

  // ── Auth (HMAC-SHA256 + Session) ──────────────────────

  private async login(): Promise<void> {
    const signature = createHmac('sha256', this.userKey)
      .update(this.userNonce)
      .digest('hex');

    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
        userNonce: this.userNonce,
        signature,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Avigilon login failed: ${response.status}`);
    }

    const data: any = await response.json();
    this.sessionToken = data.session || data.sessionId || data.token;

    // Also check Set-Cookie header
    const setCookie = response.headers.get('set-cookie');
    if (setCookie && !this.sessionToken) {
      const match = setCookie.match(/session=([^;]+)/);
      if (match) this.sessionToken = match[1];
    }
  }

  private sessionHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.sessionToken) {
      headers['Cookie'] = `session=${this.sessionToken}`;
      headers['X-Session-Token'] = this.sessionToken;
    }
    return headers;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: this.sessionHeaders(),
      signal: AbortSignal.timeout(10000),
    };

    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);

    if (response.status === 401) {
      await this.login();
      return this.request(method, path, body);
    }

    if (!response.ok) {
      throw new Error(`Avigilon API error: ${response.status}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  private startEventPolling(): void {
    let lastCheck = new Date().toISOString();

    this.pollingInterval = setInterval(async () => {
      try {
        const data = await this.request('GET', `/events?since=${lastCheck}`);
        lastCheck = new Date().toISOString();

        const events: any[] = data?.events || [];
        for (const evt of events) {
          if (evt.type === 'motion' || evt.type === 'MOTION_DETECTED') {
            const motionEvent: MotionEvent = {
              cameraId: evt.cameraId || evt.sourceId,
              timestamp: new Date(evt.timestamp || Date.now()),
              region: evt.region || 'default',
              confidence: evt.confidence ?? 1.0,
            };
            for (const cb of this.motionCallbacks) {
              cb(motionEvent);
            }
          }
        }
      } catch {
        // Polling failure is non-fatal
      }
    }, 2000);
  }
}
