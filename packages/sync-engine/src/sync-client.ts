/**
 * EdgeRuntime Sync Client
 *
 * HTTP client for communicating with the cloud sync API.
 * Authenticates via HMAC-SHA256 signed requests with X-Sync-Key header.
 * Ported from SafeSchool edge sync client.
 */

import crypto from 'node:crypto';
import tls from 'node:tls';
import { SyncError, createLogger } from '@edgeruntime/core';

const log = createLogger('sync-client');

export interface SyncClientConfig {
  baseUrl: string;
  syncKey: string;
  timeoutMs?: number;
  tlsFingerprint?: string;
}

export interface SyncEntity {
  type: string;
  action: 'create' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: string;
}

export interface PushRequest {
  siteId: string;
  entities: SyncEntity[];
}

export interface PushResponse {
  synced: number;
  errors: number;
  timestamp: string;
}

export interface PullResponse {
  data: Record<string, unknown[]>;
  timestamp: string;
}

export interface HeartbeatRequest {
  siteId: string;
  mode: string;
  pendingChanges: number;
  orgId?: string;
  version?: string;
  hostname?: string;
  nodeVersion?: string;
  diskUsagePercent?: number;
  memoryUsageMb?: number;
  ipAddress?: string;
  apiPort?: number;
  upgradeStatus?: string;
  upgradeError?: string;
  configVersion?: number;
  /** Activation key — sent so cloud can auto-resolve account/org */
  activationKey?: string;
  /** Map of adapterId -> installed version (for update checking) */
  installedAdapters?: Record<string, string>;
  /** Results from previous adapter update attempts */
  adapterUpdateResults?: AdapterUpdateResult[];
}

export interface UpgradeCommand {
  targetVersion: string;
  action: 'update';
}

export interface PeerInfo {
  siteId: string;
  ipAddress: string;
  apiPort: number;
  version: string;
  lastHeartbeatAt: string;
}

export interface ConnectorConfigEntry {
  name: string;
  type: string;
  enabled: boolean;
  pollIntervalMs?: number;
  [key: string]: unknown;
}

export interface FederationPeerEntry {
  product: string;
  host: string;
  port: number;
}

export interface DeviceCommand {
  id: string;
  action: 'restart' | 'reboot' | 'clear_cache' | 'rotate_logs';
  issuedAt: string;
}

export interface DeviceConfigPayload {
  version: number;
  connectors?: ConnectorConfigEntry[];
  syncIntervalMs?: number;
  siteName?: string;
  federation?: {
    enabled: boolean;
    peers: FederationPeerEntry[];
  };
  commands?: DeviceCommand[];
  /** Adapter updates available for this device */
  adapterUpdates?: AdapterUpdateDirective[];
}

// ─── Adapter Update Protocol ──────────────────────────────────────

export interface AdapterUpdateDirective {
  /** Adapter ID: 'access-control/lenel' */
  adapterId: string;
  /** Target semver version */
  targetVersion: string;
  /** Download URL for the adapter bundle (.mjs) */
  bundleUrl: string;
  /** SHA-256 hash of the bundle for integrity verification */
  bundleHash: string;
  /** Bundle file size in bytes */
  bundleSize: number;
  /** Update priority */
  priority: 'critical' | 'normal' | 'low';
  /** Minimum EdgeRuntime version required */
  minRuntimeVersion?: string;
  /** Deadline — update must be applied by this ISO date */
  deadline?: string;
}

export interface AdapterUpdateResult {
  adapterId: string;
  targetVersion: string;
  status: 'success' | 'failed' | 'rolled_back';
  error?: string;
  appliedAt?: string;
}

export interface HeartbeatResponse {
  ack: boolean;
  timestamp: string;
  upgrade?: UpgradeCommand;
  peers?: PeerInfo[];
  config?: DeviceConfigPayload;
  /** If true, device has been unclaimed — should clear config and re-enter pairing mode. */
  unclaimed?: boolean;
}

export class SyncClient {
  private readonly baseUrl: string;
  private readonly syncKey: string;
  private readonly timeoutMs: number;
  private readonly tlsFingerprint?: string;

  constructor(config: SyncClientConfig) {
    const url = config.baseUrl.replace(/\/+$/, '');

    const parsed = new URL(url);
    const isLocalDev = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !isLocalDev) {
      throw new SyncError(
        `SyncClient requires HTTPS for non-local URLs. Got: ${parsed.protocol}//${parsed.hostname}`,
      );
    }

    this.baseUrl = url;
    this.syncKey = config.syncKey;
    this.timeoutMs = config.timeoutMs ?? 10000;

    if (config.tlsFingerprint) {
      this.tlsFingerprint = config.tlsFingerprint.toUpperCase().replace(/[^A-F0-9]/g, '');
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async verifyTlsCertificate(): Promise<void> {
    if (!this.tlsFingerprint) return;

    const parsed = new URL(this.baseUrl);
    const port = parsed.port ? parseInt(parsed.port, 10) : 443;

    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host: parsed.hostname, port, servername: parsed.hostname, rejectUnauthorized: true },
        () => {
          const cert = socket.getPeerCertificate();
          socket.destroy();

          if (!cert || !cert.fingerprint256) {
            reject(new SyncError('Unable to retrieve TLS certificate from cloud server'));
            return;
          }

          const actual = cert.fingerprint256.replace(/:/g, '').toUpperCase();
          if (actual !== this.tlsFingerprint) {
            reject(
              new SyncError(
                `TLS certificate fingerprint mismatch! Expected: ${this.tlsFingerprint}, Got: ${actual}. Possible MITM attack.`,
              ),
            );
            return;
          }

          resolve();
        },
      );

      socket.on('error', (err) => {
        socket.destroy();
        reject(new SyncError(`TLS verification failed: ${err.message}`));
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new SyncError('TLS verification timed out', undefined, true));
      });
    });
  }

  async push(siteId: string, entities: SyncEntity[]): Promise<PushResponse> {
    await this.verifyTlsCertificate();
    const body: PushRequest = { siteId, entities };
    return this.request<PushResponse>('POST', '/api/v1/sync/push', body);
  }

  async pull(siteId: string, since: Date, entityTypes?: string[]): Promise<PullResponse> {
    await this.verifyTlsCertificate();
    const params = new URLSearchParams({ siteId, since: since.toISOString() });
    if (entityTypes && entityTypes.length > 0) {
      params.set('entities', entityTypes.join(','));
    }
    return this.request<PullResponse>('GET', `/api/v1/sync/pull?${params.toString()}`);
  }

  async heartbeat(
    siteIdOrRequest: string | HeartbeatRequest,
    mode?: string,
    pendingChanges?: number,
  ): Promise<HeartbeatResponse> {
    await this.verifyTlsCertificate();
    const body: HeartbeatRequest =
      typeof siteIdOrRequest === 'string'
        ? { siteId: siteIdOrRequest, mode: mode!, pendingChanges: pendingChanges! }
        : siteIdOrRequest;
    return this.request<HeartbeatResponse>('POST', '/api/v1/sync/heartbeat', body);
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.request<unknown>('GET', '/health');
      return true;
    } catch {
      return false;
    }
  }

  private sign(timestamp: string, method: string, path: string, bodyStr: string): string {
    const payload = `${timestamp}.${method}.${path}.${bodyStr}`;
    return crypto.createHmac('sha256', this.syncKey).update(payload).digest('hex');
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const bodyStr = body && method === 'POST' ? JSON.stringify(body) : '';
    const timestamp = new Date().toISOString();
    const signature = this.sign(timestamp, method, path, bodyStr);

    const headers: Record<string, string> = {
      'X-Sync-Key': this.syncKey,
      'X-Sync-Timestamp': timestamp,
      'X-Sync-Signature': signature,
      'Content-Type': 'application/json',
    };

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.timeoutMs) };
    if (bodyStr) init.body = bodyStr;

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new SyncError(`Request timed out after ${this.timeoutMs}ms: ${method} ${path}`, undefined, true);
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SyncError(`Request timed out after ${this.timeoutMs}ms: ${method} ${path}`, undefined, true);
      }
      throw new SyncError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch { /* ignore */ }
      throw new SyncError(`HTTP ${response.status}: ${errorBody || response.statusText}`, response.status);
    }

    return (await response.json()) as T;
  }
}
