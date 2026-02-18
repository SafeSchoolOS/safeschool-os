/**
 * Raptor Connect Emergency Alert Integration
 *
 * Raptor Technologies does NOT expose a public visitor management API.
 * This adapter integrates with Raptor Connect, their bi-directional
 * emergency alert platform. It enables:
 * - Receiving Raptor emergency alerts via webhook (lockdowns, drills)
 * - Sending SafeSchool alerts to Raptor Connect
 *
 * Raptor Connect uses configurable webhook endpoints with JSON payloads.
 * Auth varies by partner (API key, Basic Auth, or HMAC).
 *
 * For visitor management data, apply to the Raptor Ready Partner Program.
 *
 * @see https://raptortech.com/raptor-connect/
 */

export interface RaptorConnectConfig {
  /** Raptor Connect outbound webhook URL (for sending alerts TO Raptor) */
  raptorWebhookUrl?: string;
  /** API key for authenticating to Raptor */
  apiKey?: string;
  /** Shared secret for verifying inbound Raptor webhooks */
  webhookSecret?: string;
}

export interface RaptorAlert {
  id: string;
  status: 'Initiated' | 'Resolved';
  template: string;
  headline: string;
  description: string;
  isDrill: boolean;
  expiresAt?: string;
  incidentType?: string;
  incidentSubType?: string;
}

export class RaptorConnectAdapter {
  name = 'Raptor Connect';
  vendor = 'Raptor Technologies';

  private raptorWebhookUrl: string;
  private apiKey: string;
  private webhookSecret: string;

  constructor(config: RaptorConnectConfig) {
    this.raptorWebhookUrl = config.raptorWebhookUrl || '';
    this.apiKey = config.apiKey || '';
    this.webhookSecret = config.webhookSecret || '';
  }

  /** Parse an inbound Raptor Connect webhook payload */
  parseInboundAlert(body: unknown): RaptorAlert | null {
    if (!body || typeof body !== 'object') return null;

    const payload = body as Record<string, any>;

    return {
      id: payload.id || payload.alertId || '',
      status: payload.status === 'Resolved' ? 'Resolved' : 'Initiated',
      template: payload.template || payload.alertTemplate || '',
      headline: payload.headline || payload.title || '',
      description: payload.description || payload.message || '',
      isDrill: payload.isDrill ?? false,
      expiresAt: payload.expiresAt,
      incidentType: payload.INCIDENT_TYPENAME || payload.incidentType,
      incidentSubType: payload.INCIDENT_SUBTYPENAME || payload.incidentSubType,
    };
  }

  /** Send an alert TO Raptor Connect */
  async sendAlert(alert: {
    type: string;
    headline: string;
    description: string;
    isDrill?: boolean;
    location?: string;
  }): Promise<boolean> {
    if (!this.raptorWebhookUrl) return false;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Basic ${Buffer.from(`:${this.apiKey}`).toString('base64')}`;
      }

      const response = await fetch(this.raptorWebhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: 'SafeSchool',
          alertType: alert.type,
          headline: alert.headline,
          description: alert.description,
          isDrill: alert.isDrill || false,
          location: alert.location,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /** Verify an inbound webhook from Raptor */
  verifyWebhook(headers: Record<string, string>, _body: string): boolean {
    if (!this.webhookSecret) return true; // No secret configured, accept all

    const token = headers['x-raptor-token'] || headers['authorization'] || '';
    return token.includes(this.webhookSecret);
  }
}
