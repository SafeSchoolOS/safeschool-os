/**
 * Weapons Detection Integration Module
 *
 * Provides adapters for receiving alerts from walk-through weapons detection
 * systems (AI-powered and traditional) installed at school entrances.
 *
 * When a weapon is detected, SafeSchool auto-creates an ACTIVE_THREAT or
 * LOCKDOWN alert that triggers 911 dispatch + lockdown + staff notification.
 *
 * Supported vendors:
 * - Evolv Technology (Express) — AI-powered, largest K-12 install base
 * - CEIA OPENGATE — traditional relay-based, VMS bridge forwarding
 * - Xtract One (Gateway) — AI-powered, growing K-12 presence
 */

export type ThreatLevel = 'FIREARM' | 'KNIFE' | 'MASS_CASUALTY' | 'ANOMALY' | 'CLEAR';

export type OperatorAction = 'PENDING' | 'CLEARED' | 'ESCALATED' | 'SECONDARY_SCREENING';

export type DetectionStatus = 'ACTIVE' | 'RESOLVED' | 'CLEARED';

export interface WeaponDetectionEvent {
  eventId: string;
  detectorId: string;
  detectorName?: string;
  threatLevel: ThreatLevel;
  confidence: number;
  timestamp: string;
  imageUrl?: string;
  location: {
    siteName?: string;
    buildingName?: string;
    entrance?: string;
    lane?: number;
  };
  operatorAction?: OperatorAction;
  status: DetectionStatus;
  rawPayload?: Record<string, unknown>;
}

export interface WeaponsDetectionAdapter {
  name: string;
  vendor: string;
  parseWebhook(headers: Record<string, string>, body: unknown): WeaponDetectionEvent | null;
  verifySignature(headers: Record<string, string>, body: string): boolean;
}

export { EvolvAdapter } from './adapters/evolv.js';
export { CeiaAdapter } from './adapters/ceia.js';
export { XtractOneAdapter } from './adapters/xtract-one.js';
