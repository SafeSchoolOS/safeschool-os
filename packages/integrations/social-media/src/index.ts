/**
 * SafeSchool Social Media Monitoring Integration
 *
 * Integrates with services that monitor student social media activity
 * for concerning content (violence, self-harm, bullying, etc.).
 * Supports Bark for Schools, Gaggle, Securly, and Navigate360.
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SocialMediaEvent {
  /** Unique event ID from the monitoring service */
  id: string;
  /** Monitoring platform that flagged this */
  source: 'bark' | 'gaggle' | 'securly' | 'navigate360' | 'manual';
  /** Social media platform where content was found */
  platform: string;
  /** Type of flagged content */
  contentType: 'text' | 'image' | 'video' | 'link';
  /** The flagged content (may be redacted) */
  content?: string;
  /** Why it was flagged */
  category: string;
  /** Severity: LOW, MEDIUM, HIGH, CRITICAL */
  severity: string;
  /** Student info (if identified) */
  studentName?: string;
  studentGrade?: string;
  /** Timestamp of the original post */
  postedAt?: Date;
  /** Timestamp when flagged */
  flaggedAt: Date;
  /** Vendor-specific metadata */
  metadata?: Record<string, unknown>;
}

export interface MonitoringStatus {
  /** Service name */
  service: string;
  /** Connection status */
  connected: boolean;
  /** Number of students being monitored */
  studentsMonitored: number;
  /** Platforms being monitored */
  platforms: string[];
  /** Last time alerts were checked */
  lastCheckedAt?: Date;
}

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface SocialMediaAdapter {
  name: string;
  /** Check connection to the monitoring service */
  healthCheck(): Promise<boolean>;
  /** Get monitoring status / coverage info */
  getStatus(): Promise<MonitoringStatus>;
  /** Poll for new alerts since the given timestamp */
  pollAlerts(since: Date): Promise<SocialMediaEvent[]>;
  /** Acknowledge/dismiss an alert in the external system */
  acknowledgeAlert(externalId: string): Promise<void>;
  /** Verify HMAC-SHA256 webhook signature. Returns true if valid or no secret configured. */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;
}

// ---------------------------------------------------------------------------
// Shared HMAC verification helper
// ---------------------------------------------------------------------------

function verifyHmacSha256(secret: string, rawBody: string | Buffer, signature: string): boolean {
  if (!secret) return true; // No secret configured — allow in dev mode
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Bark for Schools Adapter
// ---------------------------------------------------------------------------

export class BarkAdapter implements SocialMediaAdapter {
  name = 'bark';
  private apiUrl: string;
  private apiKey: string;
  private webhookSecret: string;

  constructor(config: { apiUrl: string; apiKey: string; webhookSecret?: string }) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret || '';
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    return verifyHmacSha256(this.webhookSecret, rawBody, signature);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/v1/health`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<MonitoringStatus> {
    const response = await fetch(`${this.apiUrl}/api/v1/status`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      return {
        service: 'bark',
        connected: false,
        studentsMonitored: 0,
        platforms: [],
      };
    }

    const data = await response.json() as {
      students_count: number;
      platforms: string[];
      last_check: string;
    };

    return {
      service: 'bark',
      connected: true,
      studentsMonitored: data.students_count,
      platforms: data.platforms,
      lastCheckedAt: new Date(data.last_check),
    };
  }

  async pollAlerts(since: Date): Promise<SocialMediaEvent[]> {
    const response = await fetch(
      `${this.apiUrl}/api/v1/alerts?since=${since.toISOString()}`,
      { headers: { 'Authorization': `Bearer ${this.apiKey}` } },
    );

    if (!response.ok) {
      throw new Error(`Bark API error: ${response.status}`);
    }

    const data = await response.json() as Array<{
      id: string;
      platform: string;
      content_type: string;
      content: string;
      category: string;
      severity: string;
      student_name: string;
      student_grade: string;
      posted_at: string;
      flagged_at: string;
    }>;

    return data.map((alert) => ({
      id: alert.id,
      source: 'bark' as const,
      platform: alert.platform,
      contentType: alert.content_type as SocialMediaEvent['contentType'],
      content: alert.content,
      category: alert.category,
      severity: alert.severity,
      studentName: alert.student_name,
      studentGrade: alert.student_grade,
      postedAt: alert.posted_at ? new Date(alert.posted_at) : undefined,
      flaggedAt: new Date(alert.flagged_at),
    }));
  }

  async acknowledgeAlert(externalId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/v1/alerts/${externalId}/acknowledge`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`Bark API error: ${response.status}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Console Adapter (Development)
// ---------------------------------------------------------------------------

export class ConsoleSocialMediaAdapter implements SocialMediaAdapter {
  name = 'console';

  verifyWebhookSignature(_rawBody: string | Buffer, _signature: string): boolean {
    console.log('[ConsoleSocialMedia] Webhook signature verification skipped (console adapter)');
    return true;
  }

  async healthCheck(): Promise<boolean> {
    console.log('[ConsoleSocialMedia] Health check: OK');
    return true;
  }

  async getStatus(): Promise<MonitoringStatus> {
    return {
      service: 'console',
      connected: true,
      studentsMonitored: 0,
      platforms: ['console'],
      lastCheckedAt: new Date(),
    };
  }

  async pollAlerts(_since: Date): Promise<SocialMediaEvent[]> {
    console.log(`[ConsoleSocialMedia] Polling alerts since ${_since.toISOString()}`);
    return [];
  }

  async acknowledgeAlert(externalId: string): Promise<void> {
    console.log(`[ConsoleSocialMedia] Acknowledged alert: ${externalId}`);
  }
}

// ---------------------------------------------------------------------------
// Gaggle Adapter
// ---------------------------------------------------------------------------

export class GaggleAdapter implements SocialMediaAdapter {
  name = 'gaggle';
  private apiUrl: string;
  private apiKey: string;
  private webhookSecret: string;

  constructor(config: { apiUrl: string; apiKey: string; webhookSecret?: string }) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret || '';
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    return verifyHmacSha256(this.webhookSecret, rawBody, signature);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/status`, {
        headers: { 'X-API-Key': this.apiKey },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<MonitoringStatus> {
    const response = await fetch(`${this.apiUrl}/api/monitoring/status`, {
      headers: { 'X-API-Key': this.apiKey },
    });

    if (!response.ok) {
      return { service: 'gaggle', connected: false, studentsMonitored: 0, platforms: [] };
    }

    const data = await response.json() as {
      active_students: number;
      monitored_services: string[];
      last_scan: string;
    };

    return {
      service: 'gaggle',
      connected: true,
      studentsMonitored: data.active_students,
      platforms: data.monitored_services,
      lastCheckedAt: new Date(data.last_scan),
    };
  }

  async pollAlerts(since: Date): Promise<SocialMediaEvent[]> {
    const response = await fetch(
      `${this.apiUrl}/api/alerts?after=${since.toISOString()}`,
      { headers: { 'X-API-Key': this.apiKey } },
    );

    if (!response.ok) {
      throw new Error(`Gaggle API error: ${response.status}`);
    }

    const data = await response.json() as Array<{
      alert_id: string;
      service: string;
      type: string;
      excerpt: string;
      category: string;
      priority: string;
      student: { name: string; grade: string };
      detected_at: string;
    }>;

    return data.map((alert) => ({
      id: alert.alert_id,
      source: 'gaggle' as const,
      platform: alert.service,
      contentType: alert.type as SocialMediaEvent['contentType'],
      content: alert.excerpt,
      category: alert.category,
      severity: alert.priority,
      studentName: alert.student?.name,
      studentGrade: alert.student?.grade,
      flaggedAt: new Date(alert.detected_at),
    }));
  }

  async acknowledgeAlert(externalId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/alerts/${externalId}/ack`, {
      method: 'PUT',
      headers: { 'X-API-Key': this.apiKey },
    });

    if (!response.ok) {
      throw new Error(`Gaggle API error: ${response.status}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Securly Adapter
// ---------------------------------------------------------------------------

export class SecurlyAdapter implements SocialMediaAdapter {
  name = 'securly';
  private apiUrl: string;
  private apiKey: string;
  private webhookSecret: string;

  constructor(config: { apiUrl: string; apiKey: string; webhookSecret?: string }) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret || '';
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    return verifyHmacSha256(this.webhookSecret, rawBody, signature);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/v1/health`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<MonitoringStatus> {
    const response = await fetch(`${this.apiUrl}/v1/status`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { service: 'securly', connected: false, studentsMonitored: 0, platforms: [] };
    }

    const data = await response.json() as {
      monitored_count: number;
      services: string[];
      last_scan_at: string;
    };

    return {
      service: 'securly',
      connected: true,
      studentsMonitored: data.monitored_count,
      platforms: data.services,
      lastCheckedAt: new Date(data.last_scan_at),
    };
  }

  async pollAlerts(since: Date): Promise<SocialMediaEvent[]> {
    const response = await fetch(
      `${this.apiUrl}/v1/alerts?since=${since.toISOString()}`,
      {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      throw new Error(`Securly API error: ${response.status}`);
    }

    const data = await response.json() as Array<{
      alert_id: string;
      platform: string;
      content_type: string;
      content: string;
      category: string;
      severity: string;
      student_name: string;
      student_grade: string;
      flagged_at: string;
    }>;

    return data.map((alert) => ({
      id: alert.alert_id,
      source: 'securly' as const,
      platform: alert.platform,
      contentType: alert.content_type as SocialMediaEvent['contentType'],
      content: alert.content,
      category: alert.category,
      severity: alert.severity,
      studentName: alert.student_name,
      studentGrade: alert.student_grade,
      flaggedAt: new Date(alert.flagged_at),
    }));
  }

  async acknowledgeAlert(externalId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/v1/alerts/${externalId}/acknowledge`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Securly API error: ${response.status}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Navigate360 Adapter
// ---------------------------------------------------------------------------

export class Navigate360Adapter implements SocialMediaAdapter {
  name = 'navigate360';
  private apiUrl: string;
  private apiKey: string;
  private webhookSecret: string;

  constructor(config: { apiUrl: string; apiKey: string; webhookSecret?: string }) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret || '';
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    return verifyHmacSha256(this.webhookSecret, rawBody, signature);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/health`, {
        headers: { 'X-API-Key': this.apiKey },
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<MonitoringStatus> {
    const response = await fetch(`${this.apiUrl}/api/status`, {
      headers: { 'X-API-Key': this.apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { service: 'navigate360', connected: false, studentsMonitored: 0, platforms: [] };
    }

    const data = await response.json() as {
      students_monitored: number;
      platforms: string[];
      last_check: string;
    };

    return {
      service: 'navigate360',
      connected: true,
      studentsMonitored: data.students_monitored,
      platforms: data.platforms,
      lastCheckedAt: new Date(data.last_check),
    };
  }

  async pollAlerts(since: Date): Promise<SocialMediaEvent[]> {
    const response = await fetch(
      `${this.apiUrl}/api/alerts?after=${since.toISOString()}`,
      {
        headers: { 'X-API-Key': this.apiKey },
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      throw new Error(`Navigate360 API error: ${response.status}`);
    }

    const data = await response.json() as Array<{
      id: string;
      platform: string;
      content_type: string;
      content: string;
      category: string;
      severity: string;
      student_name: string;
      student_grade: string;
      posted_at: string;
      flagged_at: string;
    }>;

    return data.map((alert) => ({
      id: alert.id,
      source: 'navigate360' as const,
      platform: alert.platform,
      contentType: alert.content_type as SocialMediaEvent['contentType'],
      content: alert.content,
      category: alert.category,
      severity: alert.severity,
      studentName: alert.student_name,
      studentGrade: alert.student_grade,
      postedAt: alert.posted_at ? new Date(alert.posted_at) : undefined,
      flaggedAt: new Date(alert.flagged_at),
    }));
  }

  async acknowledgeAlert(externalId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/alerts/${externalId}/reviewed`, {
      method: 'PUT',
      headers: { 'X-API-Key': this.apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Navigate360 API error: ${response.status}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

export interface SocialMediaConfig {
  adapter: string;
  barkApiUrl?: string;
  barkApiKey?: string;
  barkWebhookSecret?: string;
  gaggleApiUrl?: string;
  gaggleApiKey?: string;
  gaggleWebhookSecret?: string;
  securlyApiUrl?: string;
  securlyApiKey?: string;
  securlyWebhookSecret?: string;
  navigate360ApiUrl?: string;
  navigate360ApiKey?: string;
  navigate360WebhookSecret?: string;
}

export function createSocialMediaAdapter(config: SocialMediaConfig): SocialMediaAdapter {
  switch (config.adapter) {
    case 'bark':
      return new BarkAdapter({
        apiUrl: config.barkApiUrl || '',
        apiKey: config.barkApiKey || '',
        webhookSecret: config.barkWebhookSecret,
      });
    case 'gaggle':
      return new GaggleAdapter({
        apiUrl: config.gaggleApiUrl || '',
        apiKey: config.gaggleApiKey || '',
        webhookSecret: config.gaggleWebhookSecret,
      });
    case 'securly':
      return new SecurlyAdapter({
        apiUrl: config.securlyApiUrl || '',
        apiKey: config.securlyApiKey || '',
        webhookSecret: config.securlyWebhookSecret,
      });
    case 'navigate360':
      return new Navigate360Adapter({
        apiUrl: config.navigate360ApiUrl || '',
        apiKey: config.navigate360ApiKey || '',
        webhookSecret: config.navigate360WebhookSecret,
      });
    default:
      return new ConsoleSocialMediaAdapter();
  }
}

/** Get the webhook secret for a given source, from config */
export function getWebhookSecretForSource(source: string, config: SocialMediaConfig): string {
  switch (source) {
    case 'bark': return config.barkWebhookSecret || '';
    case 'gaggle': return config.gaggleWebhookSecret || '';
    case 'securly': return config.securlyWebhookSecret || '';
    case 'navigate360': return config.navigate360WebhookSecret || '';
    default: return '';
  }
}
