/**
 * BadgeGuard Access Control Analytics Client
 *
 * Thin HTTP client that sends AC event data to BadgeGuard's cloud API
 * and fetches processed analytics results. No analytics logic here —
 * all detection (impossible travel, reader attacks, etc.) runs on BadgeGuard.
 */

export interface BadgeGuardConfig {
  apiUrl: string;
  apiKey: string;
  siteId?: string;
  deviceId?: string;
}

export interface BadgeGuardEvent {
  doorId: string;
  doorName: string;
  eventType: 'LOCK' | 'UNLOCK' | 'GRANT' | 'DENY' | 'FORCED' | 'HELD' | 'LOCKDOWN';
  timestamp: string;
  userId?: string;
  userName?: string;
  buildingName?: string;
  floor?: number;
  zone?: string;
  cardNumber?: string;
  metadata?: Record<string, unknown>;
}

export interface BadgeGuardAlert {
  id: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  doorId?: string;
  doorName?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface BadgeGuardAnalytics {
  summary: {
    totalEvents: number;
    anomaliesDetected: number;
    activeAlerts: number;
    complianceScore: number;
  };
  trends: Array<{
    period: string;
    events: number;
    anomalies: number;
  }>;
  heatmap: Array<{
    doorId: string;
    doorName: string;
    hourlyActivity: number[];
  }>;
  topAnomalies: Array<{
    type: string;
    count: number;
    lastSeen: string;
  }>;
}

export interface BadgeGuardComplianceReport {
  overallScore: number;
  categories: Array<{
    name: string;
    score: number;
    findings: string[];
  }>;
  generatedAt: string;
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface AlertFilters {
  severity?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export class BadgeGuardClient {
  private apiUrl: string;
  private apiKey: string;
  private siteId?: string;
  private deviceId?: string;

  constructor(config: BadgeGuardConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.siteId = config.siteId;
    this.deviceId = config.deviceId;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`BadgeGuard API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Register a SafeSchool site with BadgeGuard, receiving a device ID.
   */
  async register(siteData: {
    siteName: string;
    district: string;
    address: string;
    city: string;
    state: string;
    timezone: string;
  }): Promise<{ deviceId: string; token: string }> {
    return this.request('/api/integrations/safeschool/register', {
      method: 'POST',
      body: JSON.stringify(siteData),
    });
  }

  /**
   * Push a batch of AC events to BadgeGuard for analysis.
   */
  async pushEvents(events: BadgeGuardEvent[]): Promise<{ received: number; queued: number }> {
    return this.request('/api/integrations/safeschool/events', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: this.deviceId,
        siteId: this.siteId,
        events,
      }),
    });
  }

  /**
   * Fetch processed analytics (trends, heatmaps, stats).
   */
  async getAnalytics(timeRange?: TimeRange): Promise<BadgeGuardAnalytics> {
    const params = new URLSearchParams();
    if (timeRange?.start) params.set('start', timeRange.start);
    if (timeRange?.end) params.set('end', timeRange.end);
    if (this.deviceId) params.set('deviceId', this.deviceId);
    const qs = params.toString();
    return this.request(`/api/integrations/safeschool/analytics${qs ? `?${qs}` : ''}`);
  }

  /**
   * Fetch anomaly alerts (impossible travel, reader attacks, etc.).
   */
  async getAlerts(filters?: AlertFilters): Promise<{ alerts: BadgeGuardAlert[]; total: number }> {
    const params = new URLSearchParams();
    if (filters?.severity) params.set('severity', filters.severity);
    if (filters?.type) params.set('type', filters.type);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.offset) params.set('offset', String(filters.offset));
    if (this.deviceId) params.set('deviceId', this.deviceId);
    const qs = params.toString();
    return this.request(`/api/integrations/safeschool/alerts${qs ? `?${qs}` : ''}`);
  }

  /**
   * Fetch compliance analytics report.
   */
  async getComplianceReport(dateRange?: TimeRange): Promise<BadgeGuardComplianceReport> {
    const params = new URLSearchParams();
    if (dateRange?.start) params.set('start', dateRange.start);
    if (dateRange?.end) params.set('end', dateRange.end);
    if (this.deviceId) params.set('deviceId', this.deviceId);
    const qs = params.toString();
    return this.request(`/api/integrations/safeschool/compliance${qs ? `?${qs}` : ''}`);
  }

  /**
   * Verify connectivity to BadgeGuard API.
   */
  async testConnection(): Promise<{ ok: boolean; version?: string; message?: string }> {
    try {
      const result = await this.request<{ status: string; version?: string }>(
        '/api/integrations/safeschool/health',
      );
      return { ok: result.status === 'ok', version: result.version };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }
}
