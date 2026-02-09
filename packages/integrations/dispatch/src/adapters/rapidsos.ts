import type { DispatchAdapter, DispatchPayload, DispatchResult } from '../index.js';
import { generatePidfLo, parseAddress } from '../nena-i3.js';
import type { CivicAddress, GeoCoordinates, CallerInfo } from '../nena-i3.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RapidSOSConfig {
  /** RapidSOS API base URL (e.g. https://api.rapidsos.com/v1) */
  apiUrl: string;
  /** OAuth2 client ID */
  clientId: string;
  /** OAuth2 client secret */
  clientSecret: string;
  /** Optional custom token endpoint (defaults to apiUrl + /oauth/token) */
  tokenUrl?: string;
  /** Optional agency ID assigned by RapidSOS */
  agencyId?: string;
  /** HTTP request timeout in ms (default 10000) */
  requestTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface OAuthToken {
  accessToken: string;
  expiresAt: number; // Unix ms
}

interface RapidSOSEmergencyResponse {
  id: string;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * RapidSOS 911 Dispatch Adapter
 *
 * Uses OAuth2 client-credentials to authenticate, then POSTs a NENA i3
 * PIDF-LO payload to the RapidSOS /emergencies endpoint.
 *
 * Status polling is supported via GET /emergencies/:id.
 */
export class RapidSOSAdapter implements DispatchAdapter {
  name = 'RapidSOS';

  private config: RapidSOSConfig;
  private token: OAuthToken | null = null;

  // Allow injection for testing
  private fetchFn: typeof globalThis.fetch;

  constructor(config: RapidSOSConfig, fetchFn?: typeof globalThis.fetch) {
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
      const token = await this.getAccessToken();

      // Build PIDF-LO XML
      const civic = this.buildCivicAddress(alert);
      const geo = this.buildGeoCoordinates(alert);
      const caller = this.buildCallerInfo(alert);
      const pidfLo = generatePidfLo({
        alertId: alert.alertId,
        civic,
        geo,
        caller,
      });

      const url = `${this.config.apiUrl}/emergencies`;

      const body = JSON.stringify({
        alert_id: alert.alertId,
        site_id: alert.siteId,
        level: alert.level,
        location_xml: pidfLo,
        building_name: alert.buildingName,
        room_name: alert.roomName,
        floor: alert.floor,
        latitude: alert.latitude,
        longitude: alert.longitude,
        caller_info: alert.callerInfo,
        ...(this.config.agencyId ? { agency_id: this.config.agencyId } : {}),
      });

      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          dispatchId: '',
          method: 'RAPIDSOS',
          responseTimeMs: Date.now() - start,
          error: `RapidSOS API error ${response.status}: ${errorText}`,
        };
      }

      const data = (await response.json()) as RapidSOSEmergencyResponse;

      return {
        success: true,
        dispatchId: data.id,
        method: 'RAPIDSOS',
        responseTimeMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        dispatchId: '',
        method: 'RAPIDSOS',
        responseTimeMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getStatus(dispatchId: string): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.config.apiUrl}/emergencies/${encodeURIComponent(dispatchId)}`;

    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`RapidSOS status check failed: ${response.status}`);
    }

    const data = (await response.json()) as RapidSOSEmergencyResponse;
    return data.status;
  }

  // -----------------------------------------------------------------------
  // OAuth2 Client Credentials
  // -----------------------------------------------------------------------

  /** Get a valid access token, refreshing if expired or missing. */
  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 30_000) {
      return this.token.accessToken;
    }

    const tokenUrl = this.config.tokenUrl || `${this.config.apiUrl}/oauth/token`;

    const response = await this.fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RapidSOS OAuth failed (${response.status}): ${errorText}`);
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    this.token = {
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    };

    return this.token.accessToken;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

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

  private buildCivicAddress(alert: DispatchPayload): CivicAddress {
    // Use site address if available, fall back to building name
    if (alert.siteAddress) {
      const parsed = parseAddress(
        alert.siteAddress,
        alert.siteCity || '',
        alert.siteState || '',
        alert.siteZip || '',
      );
      return {
        ...parsed,
        floor: alert.floor,
        room: alert.roomName,
        building: alert.buildingName,
      };
    }

    return {
      country: 'US',
      state: '',
      city: '',
      street: alert.buildingName,
      houseNumber: '',
      zip: '',
      floor: alert.floor,
      room: alert.roomName,
      building: alert.buildingName,
    };
  }

  private buildGeoCoordinates(alert: DispatchPayload): GeoCoordinates {
    return {
      latitude: alert.latitude ?? 0,
      longitude: alert.longitude ?? 0,
    };
  }

  private buildCallerInfo(alert: DispatchPayload): CallerInfo | undefined {
    if (!alert.callerInfo) return undefined;
    return { name: alert.callerInfo };
  }
}
