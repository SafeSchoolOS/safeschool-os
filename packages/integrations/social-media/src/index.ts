/**
 * SafeSchool Social Media Monitoring Integration
 *
 * Integrates with services that monitor student social media activity
 * for concerning content (violence, self-harm, bullying, etc.).
 * Supports Bark for Schools, Gaggle, Securly, and Navigate360.
 */

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
}

// ---------------------------------------------------------------------------
// Bark for Schools Adapter
// ---------------------------------------------------------------------------

export class BarkAdapter implements SocialMediaAdapter {
  name = 'bark';
  private apiUrl: string;
  private apiKey: string;

  constructor(config: { apiUrl: string; apiKey: string }) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
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

  constructor(config: { apiUrl: string; apiKey: string }) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
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
