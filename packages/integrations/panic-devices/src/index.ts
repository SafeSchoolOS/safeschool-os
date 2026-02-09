/**
 * Panic Device Integration Module
 *
 * Provides adapters for receiving panic alerts from wearable panic buttons
 * and fixed panic devices. Adapters expose webhook endpoints for receiving
 * alert pushes from vendor cloud platforms.
 */

export interface PanicAlert {
  alertId: string;
  alertType: 'STAFF_ALERT' | 'CAMPUS_WIDE' | 'SILENT_PANIC' | 'ACTIVE_ASSAILANT' | 'MEDICAL';
  timestamp: string;
  initiator: {
    name: string;
    badgeId?: string;
    role?: string;
  };
  location: {
    siteName?: string;
    buildingName?: string;
    floor?: number;
    room?: string;
    latitude?: number;
    longitude?: number;
  };
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  confidence?: number;
  rawPayload?: Record<string, unknown>;
}

export interface PanicDeviceAdapter {
  name: string;
  vendor: string;
  /** Verify and parse an incoming webhook payload */
  parseWebhook(headers: Record<string, string>, body: unknown): PanicAlert | null;
  /** Verify webhook signature/auth */
  verifySignature(headers: Record<string, string>, body: string): boolean;
}

export { CentegixAdapter } from './adapters/centegix.js';
export { RavePanicAdapter } from './adapters/rave-panic.js';
