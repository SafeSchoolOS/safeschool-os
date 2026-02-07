/**
 * SafeSchool Edge Sync Client
 *
 * HTTP client for communicating with the cloud sync API.
 * Authenticates via X-Sync-Key header and provides push/pull/heartbeat operations.
 */

export interface SyncClientConfig {
  baseUrl: string;
  syncKey: string;
  timeoutMs?: number;
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
}

export interface HeartbeatResponse {
  ack: boolean;
  timestamp: string;
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

  constructor(config: SyncClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.syncKey = config.syncKey;
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  /**
   * Push local entity changes to the cloud.
   */
  async push(siteId: string, entities: SyncEntity[]): Promise<PushResponse> {
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
   */
  async heartbeat(
    siteId: string,
    mode: string,
    pendingChanges: number,
  ): Promise<HeartbeatResponse> {
    const body: HeartbeatRequest = { siteId, mode, pendingChanges };
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

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'X-Sync-Key': this.syncKey,
      'Content-Type': 'application/json',
    };

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (body && method === 'POST') {
      init.body = JSON.stringify(body);
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
