/**
 * ZeroEyes Threat Detection Adapter
 *
 * ZeroEyes is an AI-based weapon detection system that analyses camera
 * feeds in real time. This adapter integrates via:
 *
 * - REST API for device status polling (GET /devices)
 * - Health check endpoint
 * - Webhook signature verification (HMAC SHA-256)
 * - Parsing weapon detection events
 * - Mapping ZeroEyes confidence levels to ThreatEvent
 * - Auto-creating ACTIVE_THREAT alerts on high confidence (>0.85)
 */

import crypto from 'node:crypto';
import type { ThreatIntelAdapter, ThreatIntelConfig, ThreatEvent, DeviceStatus } from '../index.js';

// ---------------------------------------------------------------------------
// ZeroEyes-specific payload types (as received from their API/webhooks)
// ---------------------------------------------------------------------------

export interface ZeroEyesDetection {
  /** ZeroEyes event ID */
  event_id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Camera identifier in ZeroEyes system */
  camera_id: string;
  /** Detection classification */
  classification: 'handgun' | 'long_gun' | 'knife' | 'person_of_interest' | 'unknown';
  /** 0-100 confidence score from ZeroEyes */
  confidence_score: number;
  /** URL to the detection frame */
  image_url?: string;
  /** Whether human analyst confirmed the detection */
  analyst_confirmed?: boolean;
  /** Additional context */
  details?: Record<string, unknown>;
}

export interface ZeroEyesDevice {
  device_id: string;
  camera_id: string;
  status: 'active' | 'offline' | 'error' | 'maintenance';
  last_heartbeat: string;
  firmware_version?: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ZeroEyesAdapter implements ThreatIntelAdapter {
  name = 'ZeroEyes';

  private apiUrl: string;
  private apiKey: string;
  private webhookSecret: string;
  private alertThreshold: number;
  private connected = false;
  private threatCallbacks: ((event: ThreatEvent) => void)[] = [];

  constructor(config: ThreatIntelConfig) {
    this.apiUrl = (config.apiUrl || 'https://api.zeroeyes.com').replace(/\/$/, '');
    this.apiKey = config.apiKey || '';
    this.webhookSecret = config.webhookSecret || '';
    this.alertThreshold = config.alertThreshold ?? 0.85;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  async connect(): Promise<void> {
    const healthy = await this.healthCheck();
    if (!healthy) {
      throw new Error('Failed to connect to ZeroEyes API');
    }
    this.connected = true;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/health');
      return response.ok;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Device status
  // -----------------------------------------------------------------------

  async getDeviceStatus(): Promise<DeviceStatus[]> {
    const response = await this.request('GET', '/devices');
    if (!response.ok) {
      throw new Error(`Failed to fetch device status: HTTP ${response.status}`);
    }

    const data: any = await response.json();
    const devices: ZeroEyesDevice[] = data?.devices || data || [];

    return devices.map((d) => ({
      id: d.device_id,
      cameraId: d.camera_id,
      status: this.mapDeviceStatus(d.status),
      lastSeen: new Date(d.last_heartbeat),
    }));
  }

  // -----------------------------------------------------------------------
  // Threat event subscription
  // -----------------------------------------------------------------------

  onThreatDetected(callback: (event: ThreatEvent) => void): void {
    this.threatCallbacks.push(callback);
  }

  // -----------------------------------------------------------------------
  // Webhook handling (called by the API webhook route)
  // -----------------------------------------------------------------------

  /**
   * Verify the HMAC SHA-256 signature of an incoming webhook payload.
   *
   * @param rawBody The raw request body as a string or Buffer
   * @param signature The signature from the X-Signature header
   * @returns true if the signature is valid
   */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!this.webhookSecret) return false;

    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Parse a ZeroEyes webhook payload into a ThreatEvent and fire callbacks.
   * Returns the parsed ThreatEvent, or null if the payload is invalid.
   */
  parseWebhookPayload(payload: ZeroEyesDetection): ThreatEvent | null {
    if (!payload.event_id || !payload.camera_id) return null;

    const event: ThreatEvent = {
      id: payload.event_id,
      timestamp: new Date(payload.timestamp || Date.now()),
      cameraId: payload.camera_id,
      type: this.mapClassification(payload.classification),
      confidence: (payload.confidence_score ?? 0) / 100, // ZeroEyes uses 0-100, we use 0-1
      imageUrl: payload.image_url,
      metadata: {
        classification: payload.classification,
        analystConfirmed: payload.analyst_confirmed,
        ...(payload.details || {}),
      },
    };

    // Fire registered callbacks
    this.threatCallbacks.forEach((cb) => cb(event));

    return event;
  }

  /**
   * Whether a given threat event exceeds the alert threshold and should
   * trigger an automatic ACTIVE_THREAT alert.
   */
  shouldAutoAlert(event: ThreatEvent): boolean {
    return event.confidence >= this.alertThreshold;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async request(method: string, path: string, body?: any): Promise<Response> {
    const url = `${this.apiUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Integration': 'SafeSchool',
      },
      signal: AbortSignal.timeout(10000),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    return fetch(url, options);
  }

  private mapDeviceStatus(status: string): DeviceStatus['status'] {
    switch (status) {
      case 'active':
        return 'ACTIVE';
      case 'offline':
        return 'OFFLINE';
      case 'error':
        return 'ERROR';
      case 'maintenance':
        return 'MAINTENANCE';
      default:
        return 'OFFLINE';
    }
  }

  private mapClassification(classification: string): ThreatEvent['type'] {
    switch (classification) {
      case 'handgun':
      case 'long_gun':
      case 'knife':
        return 'weapon';
      case 'person_of_interest':
        return 'person_of_interest';
      default:
        return 'anomaly';
    }
  }
}
