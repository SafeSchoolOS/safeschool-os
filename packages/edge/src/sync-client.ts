/**
 * SafeSchool Edge Sync Client
 *
 * HTTP client for communicating with the cloud sync API.
 * Authenticates via HMAC-SHA256 signed requests with X-Sync-Key header.
 */

import crypto from 'node:crypto';
import tls from 'node:tls';

export interface SyncClientConfig {
  baseUrl: string;
  syncKey: string;
  timeoutMs?: number;
  /** SHA-256 fingerprint of the cloud TLS certificate for pinning (hex, colon-separated). */
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

export interface HeartbeatResponse {
  ack: boolean;
  timestamp: string;
  upgrade?: UpgradeCommand;
  peers?: PeerInfo[];
}

export class SyncClientError extends Error {
  public readonly statusCode?: number;
  public readonly isTimeout: boolean;

  constructor(message: string, statusCode?: number, isTimeout = false) {
    super(message);
    this.name = 'SyncClientError';
    this.statusCode = statusCode;
    this.isTimeout = isTimeout;
  }
}

export class SyncClient {
  private readonly baseUrl: string;
  private readonly syncKey: string;
  private readonly timeoutMs: number;
  private readonly tlsFingerprint?: string;

  constructor(config: SyncClientConfig) {
    const url = config.baseUrl.replace(/\/+$/, '');

    // Enforce HTTPS — allow localhost/127.0.0.1 for dev only
    const parsed = new URL(url);
    const isLocalDev = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !isLocalDev) {
      throw new SyncClientError(
        `SyncClient requires HTTPS for non-local URLs. Got: ${parsed.protocol}//${parsed.hostname}`,
      );
    }

    this.baseUrl = url;
    this.syncKey = config.syncKey;
    this.timeoutMs = config.timeoutMs ?? 10000;

    // TLS certificate pinning — verify cloud server identity
    if (config.tlsFingerprint) {
      this.tlsFingerprint = config.tlsFingerprint.toUpperCase().replace(/[^A-F0-9]/g, '');
    }
  }

  /**
   * Verify the TLS certificate fingerprint of the cloud server.
   * Called before each sync operation when tlsFingerprint is configured.
   */
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
            reject(new SyncClientError('Unable to retrieve TLS certificate from cloud server'));
            return;
          }

          // cert.fingerprint256 is "XX:XX:XX:..." format — normalize for comparison
          const actual = cert.fingerprint256.replace(/:/g, '').toUpperCase();
          if (actual !== this.tlsFingerprint) {
            reject(
              new SyncClientError(
                `TLS certificate fingerprint mismatch! Expected: ${this.tlsFingerprint}, Got: ${actual}. ` +
                  'Possible MITM attack. Sync aborted.',
              ),
            );
            return;
          }

          resolve();
        },
      );

      socket.on('error', (err) => {
        socket.destroy();
        reject(new SyncClientError(`TLS verification failed: ${err.message}`));
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new SyncClientError('TLS verification timed out'));
      });
    });
  }

  /**
   * Push local entity changes to the cloud.
   */
  async push(siteId: string, entities: SyncEntity[]): Promise<PushResponse> {
    await this.verifyTlsCertificate();
    const body: PushRequest = { siteId, entities };
    const response = await this.request<PushResponse>(
      'POST',
      '/api/v1/sync/push',
      body,
    );
    return response;
  }

  /**
   * Pull remote changes from the cloud since a given timestamp.
   */
  async pull(
    siteId: string,
    since: Date,
    entityTypes?: string[],
  ): Promise<PullResponse> {
    await this.verifyTlsCertificate();
    const params = new URLSearchParams({
      siteId,
      since: since.toISOString(),
    });
    if (entityTypes && entityTypes.length > 0) {
      params.set('entities', entityTypes.join(','));
    }
    const response = await this.request<PullResponse>(
      'GET',
      `/api/v1/sync/pull?${params.toString()}`,
    );
    return response;
  }

  /**
   * Send a heartbeat to the cloud to indicate edge is alive.
   * Accepts either the legacy 3-arg signature or a full HeartbeatRequest object.
   */
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
    const response = await this.request<HeartbeatResponse>(
      'POST',
      '/api/v1/sync/heartbeat',
      body,
    );
    return response;
  }

  /**
   * Check cloud health endpoint. Returns true if reachable and healthy.
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.request<unknown>('GET', '/health');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Compute HMAC-SHA256 signature for request authentication.
   * Signs: timestamp + method + path + body
   */
  private sign(timestamp: string, method: string, path: string, bodyStr: string): string {
    const payload = `${timestamp}.${method}.${path}.${bodyStr}`;
    return crypto.createHmac('sha256', this.syncKey).update(payload).digest('hex');
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
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

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (bodyStr) {
      init.body = bodyStr;
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new SyncClientError(
          `Request timed out after ${this.timeoutMs}ms: ${method} ${path}`,
          undefined,
          true,
        );
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SyncClientError(
          `Request timed out after ${this.timeoutMs}ms: ${method} ${path}`,
          undefined,
          true,
        );
      }
      throw new SyncClientError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }
      throw new SyncClientError(
        `HTTP ${response.status}: ${errorBody || response.statusText}`,
        response.status,
      );
    }

    const data = (await response.json()) as T;
    return data;
  }
}
