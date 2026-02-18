import type { DispatchAdapter, DispatchPayload, DispatchResult } from '../index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface Rave911Config {
  /** Rave 911 Suite API base URL */
  apiUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Organization ID assigned by Rave/Motorola */
  organizationId: string;
  /** Optional callback URL for PSAP status updates */
  callbackUrl?: string;
  /** HTTP request timeout in ms (default 10000) */
  requestTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RaveAlertResponse {
  alert_id: string;
  status: string;
  psap_id?: string;
  created_at: string;
  [key: string]: unknown;
}

interface RaveStatusResponse {
  alert_id: string;
  status: string;
  psap_name?: string;
  dispatched_at?: string;
  units_assigned?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Rave 911 Suite (Motorola Solutions) Dispatch Adapter
 *
 * Integrates with the Rave 911 Suite REST API to send PSAP alerts
 * with precise location data. Supports status callback registration
 * so the PSAP can push status updates back to SafeSchool.
 */
export class Rave911Adapter implements DispatchAdapter {
  name = 'Rave 911 Suite';

  private config: Rave911Config;
  private fetchFn: typeof globalThis.fetch;

  constructor(config: Rave911Config, fetchFn?: typeof globalThis.fetch) {
    this.config = {
      requestTimeoutMs: 10_000,
      ...config,
    };
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  // -----------------------------------------------------------------------
  // DispatchAdapter interface
  // -----------------------------------------------------------------------

  async dispatch(alert: DispatchPayload): Promise<DispatchResult> {
    const start = Date.now();

    try {
      // Step 1: Create the PSAP alert
      const alertResult = await this.createPsapAlert(alert);

      // Step 2: Register status callback (if configured)
      if (this.config.callbackUrl && alertResult.alert_id) {
        await this.registerCallback(alertResult.alert_id).catch((err) => {
          // Non-fatal — log but continue
          console.warn(
            `[Rave911] Failed to register callback for ${alertResult.alert_id}:`,
            err instanceof Error ? err.message : err,
          );
        });
      }

      return {
        success: true,
        dispatchId: alertResult.alert_id,
        method: 'RAVE_911',
        responseTimeMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        dispatchId: '',
        method: 'RAVE_911',
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getStatus(dispatchId: string): Promise<string> {
    const url = `${this.config.apiUrl}/alerts/${encodeURIComponent(dispatchId)}/status`;

    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Rave 911 status check failed: ${response.status}`);
    }

    const data = (await response.json()) as RaveStatusResponse;
    return data.status;
  }

  // -----------------------------------------------------------------------
  // Internal methods
  // -----------------------------------------------------------------------

  private async createPsapAlert(
    alert: DispatchPayload,
  ): Promise<RaveAlertResponse> {
    const url = `${this.config.apiUrl}/alerts`;

    const body = JSON.stringify({
      organization_id: this.config.organizationId,
      alert_type: this.mapAlertLevel(alert.level),
      alert_id: alert.alertId,
      site_id: alert.siteId,
      location: {
        building_name: alert.buildingName,
        room_name: alert.roomName,
        floor: alert.floor,
        latitude: alert.latitude,
        longitude: alert.longitude,
      },
      caller_info: alert.callerInfo,
      message: `SafeSchool Alert: ${alert.level} at ${alert.buildingName}${alert.roomName ? ` / ${alert.roomName}` : ''}`,
      priority: this.mapPriority(alert.level),
      timestamp: new Date().toISOString(),
    });

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Rave 911 alert creation failed (${response.status}): ${errorText}`);
    }

    return (await response.json()) as RaveAlertResponse;
  }

  /** Register a callback URL so the PSAP can push status updates. */
  private async registerCallback(alertId: string): Promise<void> {
    const url = `${this.config.apiUrl}/alerts/${encodeURIComponent(alertId)}/callbacks`;

    const body = JSON.stringify({
      callback_url: this.config.callbackUrl,
      events: ['status_changed', 'unit_dispatched', 'unit_on_scene', 'resolved'],
    });

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Callback registration failed (${response.status}): ${errorText}`);
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildHeaders(): Record<string, string> {
    return {
      'X-Api-Key': this.config.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs!,
    );

    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Map SafeSchool alert levels to Rave alert type codes.
   */
  private mapAlertLevel(level: string): string {
    const mapping: Record<string, string> = {
      ACTIVE_THREAT: 'ACTIVE_SHOOTER',
      LOCKDOWN: 'LOCKDOWN',
      MEDICAL: 'MEDICAL_EMERGENCY',
      FIRE: 'FIRE',
      WEATHER: 'SEVERE_WEATHER',
      ALL_CLEAR: 'ALL_CLEAR',
      CUSTOM: 'GENERAL',
    };
    return mapping[level] || 'GENERAL';
  }

  /**
   * Map SafeSchool alert levels to Rave priority values.
   */
  private mapPriority(level: string): number {
    const mapping: Record<string, number> = {
      ACTIVE_THREAT: 1, // Highest
      LOCKDOWN: 1,
      FIRE: 1,
      MEDICAL: 2,
      WEATHER: 3,
      ALL_CLEAR: 5,
      CUSTOM: 3,
    };
    return mapping[level] ?? 3;
  }
}
