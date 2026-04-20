import { describe, it, expect } from 'vitest';
import { EvolvAdapter } from '../../../../adapters/src/weapons-detection/adapters/evolv.js';
import { OmnilertAdapter } from '../../../../adapters/src/weapons-detection/adapters/omnilert.js';
import type { WeaponDetectionEvent } from '../../../../adapters/src/weapons-detection/index.js';

/**
 * Validates that all weapons detection adapters conform to the
 * WeaponsDetectionAdapter interface and produce consistent events.
 */
describe('Weapons Detection Adapters — Cross-Adapter Consistency', () => {
  const adapters = [
    { name: 'Evolv', create: () => new EvolvAdapter({ webhookSecret: '' }) },
    { name: 'Omnilert', create: () => new OmnilertAdapter({ apiKey: '' }) },
  ];

  for (const { name, create } of adapters) {
    describe(name, () => {
      it('should have name and vendor fields', () => {
        const adapter = create();
        expect(adapter.name).toBeTruthy();
        expect(adapter.vendor).toBeTruthy();
      });

      it('should return null for empty body', () => {
        const adapter = create();
        expect(adapter.parseWebhook({}, null)).toBeNull();
        expect(adapter.parseWebhook({}, {})).toBeNull();
      });

      it('should pass signature when no secret configured', () => {
        const adapter = create();
        expect(adapter.verifySignature({}, '{}')).toBe(true);
      });

      it('should parse a firearm detection into standard event format', () => {
        const adapter = create();
        let event: WeaponDetectionEvent | null = null;

        if (name === 'Evolv') {
          event = adapter.parseWebhook({}, {
            eventId: 'ev-001',
            threatLevel: 'firearm',
            confidence: 0.92,
            timestamp: '2026-03-28T12:00:00Z',
            location: { siteName: 'Test Site', buildingName: 'Bldg A', entrance: 'Main', lane: 1 },
          });
        } else if (name === 'Omnilert') {
          event = adapter.parseWebhook({}, {
            event_id: 'om-001',
            type: 'gun_verified',
            threat_type: 'handgun',
            camera_id: 'cam-1',
            confidence: 0.92,
            timestamp: '2026-03-28T12:00:00Z',
            verified: true,
            location: { site: 'Test Site', building: 'Bldg A', zone: 'Main' },
          });
        }

        // All adapters should produce events with the standard fields
        expect(event).not.toBeNull();
        expect(event!.eventId).toBeTruthy();
        expect(event!.threatLevel).toBe('FIREARM');
        expect(event!.confidence).toBe(0.92);
        expect(event!.timestamp).toBe('2026-03-28T12:00:00Z');
        expect(event!.location).toBeDefined();
        expect(event!.location.siteName).toBe('Test Site');
        expect(event!.location.buildingName).toBe('Bldg A');
        expect(event!.status).toBeDefined();
        expect(['ACTIVE', 'RESOLVED', 'CLEARED']).toContain(event!.status);
      });

      it('should map clear/no-threat to CLEAR threat level', () => {
        const adapter = create();
        let event: WeaponDetectionEvent | null = null;

        if (name === 'Evolv') {
          event = adapter.parseWebhook({}, { eventId: 'clr-001', threatLevel: 'clear', operatorAction: 'cleared' });
        } else if (name === 'Omnilert') {
          event = adapter.parseWebhook({}, { event_id: 'clr-001', type: 'gun_false_positive', camera_id: 'c1', verified: false });
        }

        expect(event).not.toBeNull();
        expect(event!.threatLevel).toBe('CLEAR');
      });
    });
  }
});
