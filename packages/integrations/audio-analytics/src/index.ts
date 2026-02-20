/**
 * Audio Analytics Integration Module
 *
 * Provides adapters for receiving audio-based threat detection events from
 * commercial sensor systems.  Covers both acoustic pattern detection (gunshots,
 * glass breaking, fire alarms) and speech/verbal keyword detection ("fire!",
 * "help!", "shooter!").
 *
 * Each adapter translates a vendor's proprietary webhook payload into a
 * unified AudioAnalyticsAlert that the safeSchool platform can ingest.
 *
 * Supported vendors:
 *  - HALO Smart Sensor (IPVideo / Pelco) — acoustic + keyword + environmental
 *  - Shooter Detection Systems (SDS)     — acoustic + infrared gunshot
 *  - Louroe Electronics / Sound Intelligence — acoustic aggression + gunshot
 *  - Audio Enhancement SAFE System       — teacher-activated panic via microphone
 */

// ── Unified alert types ─────────────────────────────────────────────

export type AudioAlertCategory =
  | 'GUNSHOT'
  | 'FIRE_ALARM'
  | 'GLASS_BREAKING'
  | 'SCREAMING'
  | 'EXPLOSION'
  | 'AGGRESSIVE_VOICE'
  | 'SMOKE_DETECTOR'
  | 'CARBON_MONOXIDE_ALARM'
  | 'VERBAL_FIRE_REPORT'
  | 'VERBAL_WEAPON_REPORT'
  | 'VERBAL_MEDICAL_EMERGENCY'
  | 'VERBAL_INTRUDER_REPORT'
  | 'VERBAL_BOMB_THREAT'
  | 'VERBAL_FIGHT_REPORT'
  | 'VERBAL_GENERAL_DISTRESS'
  | 'VAPE_DETECTED'
  | 'THC_DETECTED'
  | 'AIR_QUALITY'
  | 'PANIC_BUTTON'
  | 'UNKNOWN_THREAT';

export interface AudioAnalyticsAlert {
  /** Vendor's unique event ID */
  vendorEventId: string;
  /** Normalized detection category */
  category: AudioAlertCategory;
  /** Human-readable event description */
  description: string;
  /** Sensor / device identifier (serial, MAC, name) */
  sensorIdentifier: string;
  /** Sensor name for display */
  sensorName?: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** 0.0-1.0 confidence score (null if vendor doesn't provide one) */
  confidence: number | null;
  /** Decibel level at time of detection */
  decibelLevel?: number;
  /** Duration of the detected audio segment in ms */
  durationMs?: number;
  /** URL to stored audio clip */
  audioClipUrl?: string;
  /** Transcript text (speech/keyword detections only) */
  transcript?: string;
  /** Keywords that were matched (speech/keyword detections only) */
  matchedKeywords?: string[];
  /** Emotion tag from voice analysis */
  emotionTag?: string;
  /** Whether this is an "event fired" or "event reset/cleared" */
  status: 'FIRED' | 'RESET' | 'UPDATE';
  /** Sensor reading value (environmental sensors) */
  sensorValue?: number;
  /** Location info if provided */
  location?: {
    building?: string;
    floor?: number;
    room?: string;
    zone?: string;
  };
  /** Original raw payload from vendor */
  rawPayload: Record<string, unknown>;
}

// ── Adapter interface ───────────────────────────────────────────────

export interface AudioAnalyticsAdapter {
  /** Display name of this adapter */
  name: string;
  /** Vendor company name */
  vendor: string;
  /** Verify webhook authentication (signature, API key, etc.) */
  verifyAuth(headers: Record<string, string>, body: string): boolean;
  /** Parse vendor webhook payload into normalized alert(s) */
  parseWebhook(headers: Record<string, string>, body: unknown): AudioAnalyticsAlert | null;
}

// ── Export adapters ────────────────────────────────────────────────

export { HaloAdapter } from './adapters/halo.js';
export { SDSAdapter } from './adapters/sds.js';
export { LouroeAdapter } from './adapters/louroe.js';
export { SafeSystemAdapter } from './adapters/safe-system.js';
