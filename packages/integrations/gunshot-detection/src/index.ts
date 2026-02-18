/**
 * Gunshot Detection Integration Module
 *
 * Provides adapters for receiving gunshot detection alerts from acoustic
 * sensor networks. Adapters expose webhook endpoints for receiving alert
 * pushes from vendor cloud platforms.
 */

export interface GunshotAlert {
  incidentId: string;
  type: 'SINGLE_GUNSHOT' | 'MULTIPLE_GUNSHOTS' | 'PROBABLE_GUNFIRE';
  latitude: number;
  longitude: number;
  timestamp: string;
  address?: string;
  roundsFired?: number;
  confidence?: number;
  multipleShooters?: boolean;
  automaticWeapon?: boolean;
  audioUrl?: string;
  stage: 'MACHINE_DETECTED' | 'ANALYST_CONFIRMED' | 'UPDATED';
  ptzData?: {
    pan: number;
    tilt: number;
    zoom: number;
    cameraId: string;
  }[];
  rawPayload?: Record<string, unknown>;
}

export interface GunshotDetectionAdapter {
  name: string;
  vendor: string;
  parseWebhook(headers: Record<string, string>, body: unknown): GunshotAlert | null;
  verifySignature(headers: Record<string, string>, body: string): boolean;
}

export { SoundThinkingAdapter } from './adapters/soundthinking.js';
