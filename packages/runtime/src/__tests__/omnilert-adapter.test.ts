import { describe, it, expect } from 'vitest';
import { OmnilertAdapter } from '../../../../adapters/src/weapons-detection/adapters/omnilert.js';

describe('OmnilertAdapter', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const adapter = new OmnilertAdapter();
      expect(adapter.name).toBe('Omnilert Gun Detect');
      expect(adapter.vendor).toBe('Omnilert');
    });

    it('should accept api key config', () => {
      const adapter = new OmnilertAdapter({ apiKey: 'my-key' });
      expect(adapter.name).toBe('Omnilert Gun Detect');
    });
  });

  describe('verifySignature', () => {
    it('should pass with matching API key', () => {
      const adapter = new OmnilertAdapter({ apiKey: 'secret-key' });
      expect(adapter.verifySignature({ 'x-api-key': 'secret-key' }, '{}')).toBe(true);
    });

    it('should fail with wrong API key', () => {
      const adapter = new OmnilertAdapter({ apiKey: 'secret-key' });
      expect(adapter.verifySignature({ 'x-api-key': 'wrong-key' }, '{}')).toBe(false);
    });

    it('should fail with missing API key header', () => {
      const adapter = new OmnilertAdapter({ apiKey: 'secret-key' });
      expect(adapter.verifySignature({}, '{}')).toBe(false);
    });

    it('should pass if no API key configured (open mode)', () => {
      const adapter = new OmnilertAdapter();
      expect(adapter.verifySignature({}, '{}')).toBe(true);
    });

    it('should accept X-API-Key header (case variant)', () => {
      const adapter = new OmnilertAdapter({ apiKey: 'key123' });
      expect(adapter.verifySignature({ 'X-API-Key': 'key123' }, '{}')).toBe(true);
    });
  });

  describe('parseWebhook', () => {
    const adapter = new OmnilertAdapter();

    it('should return null for null/undefined body', () => {
      expect(adapter.parseWebhook({}, null)).toBeNull();
      expect(adapter.parseWebhook({}, undefined)).toBeNull();
    });

    it('should return null if no event ID present', () => {
      expect(adapter.parseWebhook({}, { type: 'gun_detected' })).toBeNull();
    });

    it('should parse a verified gun detection', () => {
      const event = adapter.parseWebhook({}, {
        event_id: 'gd-001',
        type: 'gun_verified',
        camera_id: 'cam-lobby-01',
        camera_name: 'Main Lobby Camera',
        confidence: 0.94,
        threat_type: 'handgun',
        verified: true,
        verified_by: 'SOC-Operator-1',
        timestamp: '2026-03-28T14:30:00Z',
        image_url: 'https://gundetect.omnilert.com/captures/abc123.jpg',
        location: { site: 'MTC Campus', building: 'Stake Center', zone: 'Chapel Foyer' },
      });

      expect(event).not.toBeNull();
      expect(event!.eventId).toBe('gd-001');
      expect(event!.threatLevel).toBe('FIREARM');
      expect(event!.confidence).toBe(0.94);
      expect(event!.operatorAction).toBe('ESCALATED');
      expect(event!.status).toBe('ACTIVE');
      expect(event!.detectorId).toBe('cam-lobby-01');
      expect(event!.detectorName).toBe('Main Lobby Camera');
      expect(event!.imageUrl).toBe('https://gundetect.omnilert.com/captures/abc123.jpg');
      expect(event!.location.siteName).toBe('MTC Campus');
      expect(event!.location.buildingName).toBe('Stake Center');
      expect(event!.location.entrance).toBe('Chapel Foyer');
    });

    it('should parse a false positive', () => {
      const event = adapter.parseWebhook({}, {
        event_id: 'gd-002',
        type: 'gun_false_positive',
        camera_id: 'cam-parking-01',
        confidence: 0.35,
        verified: false,
      });

      expect(event).not.toBeNull();
      expect(event!.threatLevel).toBe('CLEAR');
      expect(event!.operatorAction).toBe('CLEARED');
      expect(event!.status).toBe('CLEARED');
    });

    it('should parse an unverified AI detection', () => {
      const event = adapter.parseWebhook({}, {
        event_id: 'gd-003',
        type: 'gun_detected',
        camera_id: 'cam-entry-01',
        confidence: 0.87,
        threat_type: 'rifle',
      });

      expect(event).not.toBeNull();
      expect(event!.threatLevel).toBe('FIREARM');
      expect(event!.operatorAction).toBe('PENDING');
      expect(event!.status).toBe('ACTIVE');
    });

    it('should handle various weapon types as FIREARM', () => {
      for (const weaponType of ['handgun', 'rifle', 'shotgun', 'firearm', 'gun_detected', 'weapon_detected']) {
        const event = adapter.parseWebhook({}, {
          event_id: `gd-${weaponType}`,
          type: weaponType,
          camera_id: 'cam-1',
        });
        expect(event).not.toBeNull();
        expect(event!.threatLevel).toBe('FIREARM');
      }
    });

    it('should map suspicious_object to ANOMALY', () => {
      const event = adapter.parseWebhook({}, {
        event_id: 'gd-sus',
        type: 'suspicious_object',
        camera_id: 'cam-1',
      });

      expect(event!.threatLevel).toBe('ANOMALY');
    });

    it('should use alternative field names', () => {
      const event = adapter.parseWebhook({}, {
        alert_id: 'alt-001',
        event_type: 'gun_verified',
        detector_id: 'det-01',
        detector_name: 'Detector Alpha',
        score: 0.91,
        detected_at: '2026-03-28T15:00:00Z',
        snapshot_url: 'https://example.com/snap.jpg',
        site: 'Test Site',
        building: 'Building A',
        zone: 'Zone 1',
        verified: true,
      });

      expect(event).not.toBeNull();
      expect(event!.eventId).toBe('alt-001');
      expect(event!.detectorId).toBe('det-01');
      expect(event!.detectorName).toBe('Detector Alpha');
      expect(event!.confidence).toBe(0.91);
      expect(event!.timestamp).toBe('2026-03-28T15:00:00Z');
      expect(event!.imageUrl).toBe('https://example.com/snap.jpg');
    });

    it('should preserve raw payload', () => {
      const payload = { event_id: 'raw-001', type: 'gun_detected', camera_id: 'c1', custom_field: 'custom_value' };
      const event = adapter.parseWebhook({}, payload);

      expect(event!.rawPayload).toEqual(payload);
    });

    it('should default timestamp to now if not provided', () => {
      const before = new Date().toISOString();
      const event = adapter.parseWebhook({}, { event_id: 'ts-001', type: 'gun_detected', camera_id: 'c1' });
      const after = new Date().toISOString();

      expect(event!.timestamp >= before).toBe(true);
      expect(event!.timestamp <= after).toBe(true);
    });
  });
});
