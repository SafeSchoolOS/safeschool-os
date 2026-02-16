/**
 * BadgeKiosk API Client Adapter
 *
 * Integrates SafeSchool with BadgeKiosk's cloud API for:
 * - Badge printing on thermal printers (free with SafeSchool)
 * - Guard console features (paid, requires BadgeKiosk subscription)
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface BadgeKioskConfig {
  apiUrl: string;
  apiKey: string;
  tenantId?: string;
}

export interface BKCardholder {
  id: string;
  firstName: string;
  lastName: string;
  company?: string;
  email?: string;
  phone?: string;
  photo?: string;
  visitorType?: string;
  destination?: string;
  hostName?: string;
  badgeNumber?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BKTemplate {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  isDefault?: boolean;
}

export interface BKPrintServer {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'error';
  printerModel?: string;
  location?: string;
}

export interface BKPrintJob {
  id: string;
  status: 'queued' | 'printing' | 'completed' | 'failed';
  cardholderId: string;
  templateId: string;
  serverId: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface BKFeatureFlags {
  badgePrinting: boolean;
  guardConsole: boolean;
  photoVerification: boolean;
  qrValidation: boolean;
  visitorPreRegistration: boolean;
  multiSite: boolean;
  tier: 'free' | 'basic' | 'professional' | 'enterprise';
}

export interface BKCheckpoint {
  id: string;
  name: string;
  location?: string;
  isActive: boolean;
}

export interface BKValidationResult {
  valid: boolean;
  cardholder?: BKCardholder;
  message?: string;
  photoMatch?: boolean;
}

export interface BKSessionStats {
  totalScans: number;
  validScans: number;
  invalidScans: number;
  sessionStart: string;
}

// ── Client ─────────────────────────────────────────────────────────────────

export class BadgeKioskClient {
  private apiUrl: string;
  private apiKey: string;
  private tenantId?: string;
  private jwt: string | null = null;
  private jwtExpiresAt: number = 0;

  constructor(config: BadgeKioskConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.tenantId = config.tenantId;
  }

  // ── Auth ───────────────────────────────────────────────────────────────

  /**
   * Authenticate with BadgeKiosk API using the API key.
   * Caches JWT until expiry.
   */
  async authenticate(): Promise<void> {
    // Skip if we have a valid cached JWT (with 60s buffer)
    if (this.jwt && Date.now() < this.jwtExpiresAt - 60_000) {
      return;
    }

    const res = await this.rawFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey: this.apiKey }),
    });

    this.jwt = res.token;
    // Default 1h expiry if not provided
    this.jwtExpiresAt = Date.now() + (res.expiresIn || 3600) * 1000;
  }

  /**
   * Get feature flags for the current subscription tier.
   */
  async getFeatureFlags(): Promise<BKFeatureFlags> {
    return this.fetch('/api/auth/me/features');
  }

  // ── Cardholders ────────────────────────────────────────────────────────

  /**
   * Create a cardholder in BadgeKiosk from a SafeSchool visitor.
   */
  async createCardholder(visitor: {
    firstName: string;
    lastName: string;
    company?: string;
    email?: string;
    phone?: string;
    photo?: string;
    destination?: string;
    hostName?: string;
    badgeNumber?: string;
  }): Promise<BKCardholder> {
    return this.fetch('/api/cardholders', {
      method: 'POST',
      body: JSON.stringify(visitor),
    });
  }

  /**
   * Update an existing cardholder.
   */
  async updateCardholder(id: string, data: Partial<BKCardholder>): Promise<BKCardholder> {
    return this.fetch(`/api/cardholders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Get a cardholder by ID.
   */
  async getCardholder(id: string): Promise<BKCardholder> {
    return this.fetch(`/api/cardholders/${id}`);
  }

  // ── Templates ──────────────────────────────────────────────────────────

  /**
   * List available badge templates.
   */
  async getTemplates(): Promise<BKTemplate[]> {
    return this.fetch('/api/templates');
  }

  // ── Print Jobs ─────────────────────────────────────────────────────────

  /**
   * Submit a badge print job.
   */
  async submitPrintJob(
    templateId: string,
    cardholderId: string,
    serverId: string,
  ): Promise<BKPrintJob> {
    return this.fetch('/api/print-jobs', {
      method: 'POST',
      body: JSON.stringify({ templateId, cardholderId, serverId }),
    });
  }

  /**
   * Check print job status.
   */
  async getPrintJobStatus(jobId: string): Promise<BKPrintJob> {
    return this.fetch(`/api/print-jobs/${jobId}`);
  }

  // ── Print Servers ──────────────────────────────────────────────────────

  /**
   * List available print servers/printers.
   */
  async getPrintServers(): Promise<BKPrintServer[]> {
    return this.fetch('/api/print-servers');
  }

  // ── Guard Console (paid feature) ──────────────────────────────────────

  /**
   * List guard checkpoints.
   */
  async getCheckpoints(): Promise<BKCheckpoint[]> {
    return this.fetch('/api/guard/checkpoints');
  }

  /**
   * Validate a QR/badge scan at a checkpoint.
   */
  async validateScan(data: {
    scanData: string;
    checkpointId?: string;
  }): Promise<BKValidationResult> {
    return this.fetch('/api/guard/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Get guard session statistics.
   */
  async getSessionStats(): Promise<BKSessionStats> {
    return this.fetch('/api/guard/session/stats');
  }

  // ── Connection Test ────────────────────────────────────────────────────

  /**
   * Test the API connection. Returns true if authentication succeeds.
   */
  async testConnection(): Promise<{ ok: boolean; features?: BKFeatureFlags; error?: string }> {
    try {
      await this.authenticate();
      const features = await this.getFeatureFlags();
      return { ok: true, features };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  // ── Internal HTTP helpers ──────────────────────────────────────────────

  private async fetch(path: string, init?: RequestInit): Promise<any> {
    await this.authenticate();
    return this.rawFetch(path, {
      ...init,
      headers: {
        ...((init?.headers as Record<string, string>) || {}),
        Authorization: `Bearer ${this.jwt}`,
      },
    });
  }

  private async rawFetch(path: string, init?: RequestInit): Promise<any> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string>) || {}),
    };
    if (this.tenantId) {
      headers['X-Tenant-Id'] = this.tenantId;
    }

    const res = await globalThis.fetch(url, {
      ...init,
      headers,
    });

    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      throw new Error(
        body.error || body.message || `BadgeKiosk API error: ${res.status} ${res.statusText}`,
      );
    }

    return res.json();
  }
}
