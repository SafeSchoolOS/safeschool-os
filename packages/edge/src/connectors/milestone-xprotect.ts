/**
 * Milestone XProtect VMS Connector
 *
 * Copied from EdgeRuntime modules/safeschool/src/connectors/milestone-xprotect.ts
 * Integrates with Milestone XProtect video management system for:
 * - Camera event monitoring (motion, analytics, tampering)
 * - Recording trigger/bookmark creation on access events
 * - Camera stream URL resolution for live view
 * - Alarm management and acknowledgment
 *
 * Uses the Milestone MIP SDK RESTful API (XProtect 2022 R1+).
 */

import { BaseConnector, type ConnectorConfig } from './base-connector.js';
import { MilestoneAdapter } from '@bwattendorf/adapters/cameras';
import type { CameraAdapter, CameraConfig } from '@bwattendorf/adapters/cameras';

export interface MilestoneConfig extends ConnectorConfig {
  serverUrl: string;
  username: string;
  password: string;
  verifySsl: boolean;
  /** Camera hardware IDs to monitor (empty = all) */
  cameraFilter: string[];
  /** Event types to subscribe: motion, analytics, tamper, connectionChange */
  eventTypes: string[];
  /** Auto-bookmark access events on nearby cameras */
  bookmarkOnAccess: boolean;
}

interface MilestoneSession {
  token: string;
  expiry: Date;
  serverVersion: string;
}

export class MilestoneXProtectConnector extends BaseConnector {
  private session: MilestoneSession | null = null;
  private readonly serverUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly verifySsl: boolean;
  private readonly cameraFilter: string[];
  private readonly eventTypes: string[];
  private readonly bookmarkOnAccess: boolean;
  private readonly cameraAdapterInstance: MilestoneAdapter;

  constructor(name: string, config: MilestoneConfig) {
    super(name, config);
    this.serverUrl = config.serverUrl;
    this.username = config.username;
    this.password = config.password;
    this.verifySsl = config.verifySsl ?? true;
    this.cameraFilter = config.cameraFilter ?? [];
    this.eventTypes = config.eventTypes ?? ['motion', 'analytics', 'tamper'];
    this.bookmarkOnAccess = config.bookmarkOnAccess ?? true;

    this.cameraAdapterInstance = new MilestoneAdapter({
      type: 'milestone',
      host: new URL(config.serverUrl).hostname,
      port: Number(new URL(config.serverUrl).port) || 443,
      username: config.username,
      password: config.password,
    });
  }

  async connect(): Promise<boolean> {
    try {
      const loginUrl = `${this.serverUrl}/IDP/connect/token`;
      const body = new URLSearchParams({
        grant_type: 'password',
        username: this.username,
        password: this.password,
        client_id: 'GrantValidatorClient',
      });

      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        this.recordError(`Auth failed: HTTP ${response.status}`);
        return false;
      }

      const data = await response.json() as { access_token: string; expires_in: number };
      this.session = {
        token: data.access_token,
        expiry: new Date(Date.now() + data.expires_in * 1000),
        serverVersion: 'unknown',
      };

      const infoResp = await this.apiGet('/API/rest/v1/serverInfo');
      if (infoResp) {
        this.session.serverVersion = (infoResp as Record<string, string>).version ?? 'unknown';
      }

      this.log.info({ serverVersion: this.session.serverVersion }, 'Connected to Milestone XProtect');
      return true;
    } catch (err) {
      this.recordError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.session) {
      try {
        await fetch(`${this.serverUrl}/IDP/connect/revocation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${this.session.token}`,
          },
          body: `token=${this.session.token}&token_type_hint=access_token`,
        });
      } catch {
        // Best-effort token revocation
      }
      this.session = null;
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.session || this.isSessionExpired()) {
      return this.connect();
    }
    try {
      const resp = await this.apiGet('/API/rest/v1/serverInfo');
      return resp !== null;
    } catch {
      return false;
    }
  }

  async fetchEvents(since?: Date): Promise<Record<string, unknown>[]> {
    await this.ensureSession();

    const sinceTime = since ?? new Date(Date.now() - 60_000);
    const events: Record<string, unknown>[] = [];

    try {
      const alarms = await this.apiGet('/API/rest/v1/alarms', {
        timestamp: sinceTime.toISOString(),
        state: 'New,InProgress',
      }) as { array?: Record<string, unknown>[] } | null;

      if (alarms?.array) {
        for (const alarm of alarms.array) {
          events.push(this.normalizeEvent({ type: 'alarm', ...alarm }));
        }
      }

      for (const eventType of this.eventTypes) {
        const eventData = await this.apiGet('/API/rest/v1/events', {
          eventType,
          timestamp: sinceTime.toISOString(),
        }) as { array?: Record<string, unknown>[] } | null;

        if (eventData?.array) {
          for (const evt of eventData.array) {
            if (this.cameraFilter.length > 0) {
              const cameraId = evt.sourceId as string;
              if (!this.cameraFilter.includes(cameraId)) continue;
            }
            events.push(this.normalizeEvent({ type: eventType, ...evt }));
          }
        }
      }

      this.recordEvents(events.length);
    } catch (err) {
      this.recordError(err instanceof Error ? err.message : String(err));
    }

    return events;
  }

  normalizeEvent(rawEvent: Record<string, unknown>): Record<string, unknown> {
    const eventType = rawEvent.type as string;

    const severityMap: Record<string, string> = {
      alarm: 'high',
      tamper: 'high',
      analytics: 'medium',
      motion: 'low',
      connectionChange: 'medium',
    };

    return {
      sourceSystem: 'Milestone XProtect',
      sourceConnector: this.name,
      eventType: `video_${eventType}`,
      severity: severityMap[eventType] ?? 'info',
      timestamp: rawEvent.timestamp ?? new Date().toISOString(),
      cameraId: rawEvent.sourceId ?? rawEvent.cameraId,
      cameraName: rawEvent.sourceName ?? rawEvent.cameraName,
      alarmId: rawEvent.id,
      alarmState: rawEvent.state,
      message: rawEvent.message ?? rawEvent.description,
      raw: rawEvent,
    };
  }

  /** List all cameras via the adapter. */
  async listCameras(): Promise<Array<{ id: string; name: string; enabled: boolean }>> {
    try {
      const cameras = await this.cameraAdapterInstance.getCameras();
      return cameras.map((c: { id: string; name: string; status: string }) => ({
        id: c.id,
        name: c.name,
        enabled: c.status === 'online',
      }));
    } catch {
      return this.listCamerasDirectApi();
    }
  }

  /** Get live RTSP stream URL for a camera via the adapter. */
  async getCameraStreamUrl(cameraId: string): Promise<string | null> {
    try {
      const streamInfo = await this.cameraAdapterInstance.getStream(cameraId);
      return streamInfo?.url ?? null;
    } catch {
      return null;
    }
  }

  /** Create a bookmark on a camera. */
  async createBookmark(cameraId: string, description: string, timeOffset = -10): Promise<string | null> {
    await this.ensureSession();
    try {
      const now = new Date();
      const start = new Date(now.getTime() + timeOffset * 1000);
      const resp = await this.apiPost('/API/rest/v1/bookmarks', {
        cameraId,
        timeBegin: start.toISOString(),
        timeEnd: now.toISOString(),
        name: `Access Event: ${description}`,
        description,
      });
      return (resp as Record<string, string>)?.id ?? null;
    } catch (err) {
      this.log.error({ err, cameraId }, 'Failed to create bookmark');
      return null;
    }
  }

  /** Acknowledge an alarm. */
  async acknowledgeAlarm(alarmId: string, comment: string): Promise<boolean> {
    await this.ensureSession();
    try {
      await this.apiPost(`/API/rest/v1/alarms/${alarmId}/acknowledge`, { comment });
      return true;
    } catch {
      return false;
    }
  }

  /** Get the underlying camera adapter for advanced operations */
  getCameraAdapter(): CameraAdapter {
    return this.cameraAdapterInstance;
  }

  private async listCamerasDirectApi(): Promise<Array<{ id: string; name: string; enabled: boolean }>> {
    await this.ensureSession();
    try {
      const resp = await this.apiGet('/API/rest/v1/cameras') as { array?: Record<string, unknown>[] } | null;
      return (resp?.array ?? []).map(c => ({
        id: c.id as string,
        name: c.name as string,
        enabled: c.enabled as boolean,
      }));
    } catch {
      return [];
    }
  }

  private isSessionExpired(): boolean {
    if (!this.session) return true;
    return new Date() >= this.session.expiry;
  }

  private async ensureSession(): Promise<void> {
    if (!this.session || this.isSessionExpired()) {
      const ok = await this.connect();
      if (!ok) throw new Error('Failed to authenticate with Milestone XProtect');
    }
  }

  private async apiGet(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(path, this.serverUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.session!.token}` },
    });
    if (!resp.ok) throw new Error(`Milestone API ${path}: HTTP ${resp.status}`);
    return resp.json();
  }

  private async apiPost(path: string, body: unknown): Promise<unknown> {
    const resp = await fetch(`${this.serverUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.session!.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Milestone API ${path}: HTTP ${resp.status}`);
    return resp.json();
  }
}
