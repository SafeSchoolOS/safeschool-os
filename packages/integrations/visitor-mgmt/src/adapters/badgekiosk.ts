/**
 * BadgeKiosk External API Client
 *
 * Integrates SafeSchool with BadgeKiosk's external API for:
 * - Badge printing on thermal printers (free with SafeSchool)
 * - Guard console features (paid, requires BadgeKiosk subscription)
 *
 * Uses X-API-Key header authentication (machine-to-machine).
 * All routes are under /api/external/*.
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

export interface BKCustomField {
  id: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'checkbox';
  options?: string[];
  required: boolean;
  sortOrder: number;
  createdAt?: string;
}

// ── Client ─────────────────────────────────────────────────────────────────

export class BadgeKioskClient {
  private apiUrl: string;
  private apiKey: string;
  private tenantId?: string;

  constructor(config: BadgeKioskConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.tenantId = config.tenantId;
  }

  // ── Features ─────────────────────────────────────────────────────────────

  /**
   * Get feature flags for the current subscription tier.
   */
  async getFeatureFlags(): Promise<BKFeatureFlags> {
    return this.fetch('/api/external/features');
  }

  // ── Cardholders ────────────────────────────────────────────────────────

  /**
   * Create or update a cardholder in BadgeKiosk from a SafeSchool visitor.
   * Uses externalId for upsert. Any keys in customFields will auto-create
   * field definitions in BadgeKiosk if they don't already exist.
   */
  async createCardholder(visitor: {
    externalId: string;
    firstName: string;
    lastName: string;
    company?: string;
    email?: string;
    phone?: string;
    photo?: string;
    department?: string;
    title?: string;
    destination?: string;
    hostName?: string;
    badgeNumber?: string;
    customFields?: Record<string, unknown>;
  }): Promise<BKCardholder & { autoCreatedFields?: string[] }> {
    return this.fetch('/api/external/cardholders', {
      method: 'POST',
      body: JSON.stringify(visitor),
    });
  }

  /**
   * Update an existing cardholder.
   */
  async updateCardholder(id: string, data: Partial<BKCardholder>): Promise<BKCardholder> {
    return this.fetch(`/api/external/cardholders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Get a cardholder by ID.
   */
  async getCardholder(id: string): Promise<BKCardholder> {
    return this.fetch(`/api/external/cardholders/${id}`);
  }

  // ── Templates ──────────────────────────────────────────────────────────

  /**
   * List available badge templates.
   */
  async getTemplates(): Promise<BKTemplate[]> {
    return this.fetch('/api/external/templates');
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
    return this.fetch('/api/external/print', {
      method: 'POST',
      body: JSON.stringify({ templateId, cardholderId, serverId }),
    });
  }

  /**
   * Check print job status.
   */
  async getPrintJobStatus(jobId: string): Promise<BKPrintJob> {
    return this.fetch(`/api/external/jobs/${jobId}`);
  }

  // ── Print Servers ──────────────────────────────────────────────────────

  /**
   * List available print servers/printers.
   */
  async getPrintServers(): Promise<BKPrintServer[]> {
    return this.fetch('/api/external/servers');
  }

  // ── Custom Fields ──────────────────────────────────────────────────────

  /**
   * List custom field definitions for this site.
   * Fields are auto-created when cardholders are pushed with customFields.
   */
  async getCustomFields(): Promise<BKCustomField[]> {
    const res = await this.fetch('/api/external/custom-fields');
    return res.fields;
  }

  /**
   * Create a custom field definition explicitly.
   */
  async createCustomField(field: {
    fieldName: string;
    fieldLabel: string;
    fieldType: BKCustomField['fieldType'];
    options?: string[];
    required?: boolean;
    sortOrder?: number;
  }): Promise<BKCustomField> {
    return this.fetch('/api/external/custom-fields', {
      method: 'POST',
      body: JSON.stringify(field),
    });
  }

  /**
   * Update a custom field definition.
   */
  async updateCustomField(id: string, data: Partial<Omit<BKCustomField, 'id' | 'fieldName'>>): Promise<BKCustomField> {
    return this.fetch(`/api/external/custom-fields/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /**
   * Delete a custom field definition.
   */
  async deleteCustomField(id: string): Promise<{ deleted: boolean; fieldName: string }> {
    return this.fetch(`/api/external/custom-fields/${id}`, {
      method: 'DELETE',
    });
  }

  // ── Guard Console (paid feature) ──────────────────────────────────────

  /**
   * List guard checkpoints.
   */
  async getCheckpoints(): Promise<BKCheckpoint[]> {
    return this.fetch('/api/external/guard/checkpoints');
  }

  /**
   * Validate a QR/badge scan at a checkpoint.
   */
  async validateScan(data: {
    scanData: string;
    checkpointId?: string;
  }): Promise<BKValidationResult> {
    return this.fetch('/api/external/guard/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Get guard session statistics.
   */
  async getSessionStats(): Promise<BKSessionStats> {
    return this.fetch('/api/external/guard/session/stats');
  }

  // ── Connection Test ────────────────────────────────────────────────────

  /**
   * Test the API connection. Returns true if the API key is valid.
   */
  async testConnection(): Promise<{ ok: boolean; features?: BKFeatureFlags; error?: string }> {
    try {
      const features = await this.getFeatureFlags();
      return { ok: true, features };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  // ── Internal HTTP helper ─────────────────────────────────────────────

  private async fetch(path: string, init?: RequestInit): Promise<any> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
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
