/**
 * Threat Intelligence Integration Module
 *
 * Provides a unified interface for AI-powered threat detection systems
 * such as ZeroEyes (weapon detection). Adapters receive real-time
 * detection events and can auto-create ACTIVE_THREAT alerts when
 * confidence exceeds a configurable threshold.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThreatEvent {
  /** Unique event ID from the detection system */
  id: string;
  timestamp: Date;
  /** Camera that captured the detection */
  cameraId: string;
  /** Classification of the threat */
  type: 'weapon' | 'person_of_interest' | 'anomaly';
  /** Detection confidence from 0.0 to 1.0 */
  confidence: number;
  /** URL to the captured image (if available) */
  imageUrl?: string;
  /** Additional vendor-specific metadata */
  metadata: Record<string, unknown>;
}

export interface DeviceStatus {
  /** Detection device / appliance ID */
  id: string;
  /** Camera this device is analysing */
  cameraId: string;
  /** Operational status */
  status: 'ACTIVE' | 'OFFLINE' | 'ERROR' | 'MAINTENANCE';
  /** Last time the device reported in */
  lastSeen: Date;
}

export interface ThreatIntelConfig {
  type: string;
  apiUrl?: string;
  apiKey?: string;
  /** HMAC secret for webhook signature verification */
  webhookSecret?: string;
  /** Confidence threshold for auto-creating alerts (0-1, default 0.85) */
  alertThreshold?: number;
  /** Additional vendor-specific options */
  options?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adapter Interface
// ---------------------------------------------------------------------------

export interface ThreatIntelAdapter {
  name: string;
  connect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  getDeviceStatus(): Promise<DeviceStatus[]>;
  onThreatDetected(callback: (event: ThreatEvent) => void): void;
}

// ---------------------------------------------------------------------------
// Adapter Exports
// ---------------------------------------------------------------------------

export { ZeroEyesAdapter } from './adapters/zeroeyes.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import { ZeroEyesAdapter } from './adapters/zeroeyes.js';

const adapterRegistry: Record<string, new (config: ThreatIntelConfig) => ThreatIntelAdapter> = {
  zeroeyes: ZeroEyesAdapter,
};

/**
 * Create a threat intelligence adapter by vendor name.
 */
export function createThreatIntelAdapter(type: string, config: ThreatIntelConfig): ThreatIntelAdapter {
  const AdapterClass = adapterRegistry[type.toLowerCase()];
  if (!AdapterClass) {
    throw new Error(
      `Unknown threat intel adapter: ${type}. Supported: ${Object.keys(adapterRegistry).join(', ')}`,
    );
  }
  return new AdapterClass(config);
}
