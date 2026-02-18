/**
 * SoundThinking (formerly ShotSpotter) Gunshot Detection Adapter
 *
 * SoundThinking provides acoustic gunshot detection for outdoor areas
 * (ShotSpotter Flex), indoor buildings (SiteSecure), and campus perimeters
 * (SecureCampus).
 *
 * Integration: SoundThinking pushes incident notifications via their
 * Notification API v2.6 to registered subscriber endpoints.
 *
 * To receive alerts, join the SoundThinking Integration Partner Program
 * or request API access as a licensed customer.
 *
 * Alert pipeline: Sensors detect -> ML classifies -> Human analyst confirms
 * -> Push to subscribers (~30-60 seconds total latency)
 *
 * @see https://www.soundthinking.com/partners/
 */

import type { GunshotAlert, GunshotDetectionAdapter } from '../index.js';
import { createHmac, timingSafeEqual } from 'crypto';

export interface SoundThinkingConfig {
  /** Shared secret for webhook signature verification */
  webhookSecret: string;
}

export class SoundThinkingAdapter implements GunshotDetectionAdapter {
  name = 'ShotSpotter';
  vendor = 'SoundThinking';
  private webhookSecret: string;

  constructor(config: SoundThinkingConfig) {
    this.webhookSecret = config.webhookSecret;
  }

  verifySignature(headers: Record<string, string>, body: string): boolean {
    const signature = headers['x-shotspotter-signature']
      || headers['x-soundthinking-signature']
      || headers['x-signature']
      || '';

    if (!signature || !this.webhookSecret) return false;

    try {
      const expected = createHmac('sha256', this.webhookSecret)
        .update(body)
        .digest('hex');

      const sigBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');

      if (sigBuffer.length !== expectedBuffer.length) return false;
      return timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  parseWebhook(headers: Record<string, string>, body: unknown): GunshotAlert | null {
    if (!body || typeof body !== 'object') return null;

    const payload = body as Record<string, any>;

    // Map ShotSpotter type classifications
    const typeMap: Record<string, GunshotAlert['type']> = {
      single_gunshot: 'SINGLE_GUNSHOT',
      multiple_gunshots: 'MULTIPLE_GUNSHOTS',
      probable_gunfire: 'PROBABLE_GUNFIRE',
      gunshots_or_firecracker: 'PROBABLE_GUNFIRE',
    };

    const rawType = (payload.type || payload.Type || payload.classification || '').toLowerCase().replace(/\s+/g, '_');

    // Map stage
    const stageMap: Record<string, GunshotAlert['stage']> = {
      machine_detected: 'MACHINE_DETECTED',
      analyst_confirmed: 'ANALYST_CONFIRMED',
      updated: 'UPDATED',
      confirmed: 'ANALYST_CONFIRMED',
      initial: 'MACHINE_DETECTED',
    };

    const rawStage = (payload.stage || payload.status || 'confirmed').toLowerCase().replace(/\s+/g, '_');

    // Parse PTZ data if present
    let ptzData: GunshotAlert['ptzData'];
    if (payload.ptzData && Array.isArray(payload.ptzData)) {
      ptzData = payload.ptzData.map((p: any) => ({
        pan: p.pan || 0,
        tilt: p.tilt || 0,
        zoom: p.zoom || 0,
        cameraId: p.cameraId || p.camera_id || '',
      }));
    }

    return {
      incidentId: String(payload.id || payload.ID || payload.incidentId || crypto.randomUUID()),
      type: typeMap[rawType] || 'PROBABLE_GUNFIRE',
      latitude: parseFloat(payload.latitude || payload.Latitude || 0),
      longitude: parseFloat(payload.longitude || payload.Longitude || 0),
      timestamp: payload.timestamp || payload.DateTime || payload.dateTime || new Date().toISOString(),
      address: payload.address || payload.Address,
      roundsFired: parseInt(payload.rounds || payload.Rounds || payload.roundsFired || '0') || undefined,
      confidence: payload.confidence,
      multipleShooters: payload.multipleShooters ?? payload.multiple_shooters,
      automaticWeapon: payload.automaticWeapon ?? payload.automatic_weapon,
      audioUrl: payload.audioUrl || payload.audio_url,
      stage: stageMap[rawStage] || 'ANALYST_CONFIRMED',
      ptzData,
      rawPayload: payload,
    };
  }
}
