/**
 * Bus Fleet Webhook Tests (Unit — no DB required)
 *
 * Tests the bus-fleet webhook route logic using mocked dependencies.
 * Verifies:
 *   - Correct parsing for each vendor
 *   - GPS updates, RFID scans, and driver events enqueued to BullMQ
 *   - Unknown vendor rejection
 *   - Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBusFleetAdapter,
  type BusFleetVendor,
} from '@bwattendorf/adapters/transportation';

// We test the adapter parsing + job enqueueing logic that the webhook route uses.
// Since the route is a Fastify plugin that needs a real server, we test the core logic.

describe('Bus Fleet Webhook Logic', () => {
  const validVendors: BusFleetVendor[] = ['zonar', 'samsara', 'synovia', 'versatrans', 'seon', 'buspatrol'];
  let queueJobs: any[];
  let mockQueue: any;

  beforeEach(() => {
    queueJobs = [];
    mockQueue = {
      add: vi.fn().mockImplementation(async (name: string, data: any) => {
        queueJobs.push({ name, data });
      }),
    };
  });

  /**
   * Simulates the webhook processing logic from the bus-fleet.ts route.
   */
  async function processWebhook(vendor: BusFleetVendor, body: unknown) {
    if (!validVendors.includes(vendor)) {
      throw new Error(`Unknown vendor: ${vendor}`);
    }

    const adapter = createBusFleetAdapter(vendor);
    const parsed = adapter.parseWebhook(body);

    for (const gps of parsed.gpsUpdates) {
      await mockQueue.add('process-gps-update', {
        busId: gps.vehicleId,
        position: {
          latitude: gps.latitude,
          longitude: gps.longitude,
          speed: gps.speed,
          heading: gps.heading,
          timestamp: gps.timestamp,
        },
        source: vendor,
      });
    }

    for (const scan of parsed.rfidScans) {
      await mockQueue.add('process-rfid-scan', {
        cardId: scan.studentCardId,
        busId: scan.vehicleId,
        scanType: scan.scanType,
        timestamp: scan.timestamp,
        source: vendor,
      });
    }

    for (const event of parsed.driverEvents) {
      await mockQueue.add('process-driver-event', {
        vehicleId: event.vehicleId,
        busNumber: event.busNumber,
        eventType: event.eventType,
        severity: event.severity,
        timestamp: event.timestamp,
        source: vendor,
      });
    }

    return {
      ok: true,
      processed: {
        gps: parsed.gpsUpdates.length,
        rfid: parsed.rfidScans.length,
        events: parsed.driverEvents.length,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Vendor-specific tests
  // -----------------------------------------------------------------------

  describe('Zonar GPS webhook', () => {
    it('enqueues GPS update job', async () => {
      const result = await processWebhook('zonar', {
        event_type: 'location_update',
        asset_id: 'bus-001',
        asset_tag: 'Bus 42',
        latitude: 40.7358,
        longitude: -74.1724,
        speed_mph: 25,
        timestamp: '2026-02-17T12:00:00Z',
      });

      expect(result.processed.gps).toBe(1);
      expect(queueJobs[0].name).toBe('process-gps-update');
      expect(queueJobs[0].data.busId).toBe('bus-001');
      expect(queueJobs[0].data.source).toBe('zonar');
    });
  });

  describe('Zonar RFID webhook', () => {
    it('enqueues RFID scan job', async () => {
      const result = await processWebhook('zonar', {
        event_type: 'zpass_scan',
        card_id: 'CARD-123',
        asset_id: 'bus-001',
        asset_tag: 'Bus 42',
        scan_type: 'board',
        timestamp: '2026-02-17T07:30:00Z',
      });

      expect(result.processed.rfid).toBe(1);
      expect(queueJobs[0].name).toBe('process-rfid-scan');
      expect(queueJobs[0].data.cardId).toBe('CARD-123');
      expect(queueJobs[0].data.scanType).toBe('BOARD');
    });
  });

  describe('Samsara GPS webhook', () => {
    it('enqueues GPS update from VehicleGps event', async () => {
      const result = await processWebhook('samsara', {
        eventType: 'VehicleGps',
        data: {
          vehicle: { id: 'v-001', name: 'Bus 42' },
          location: { latitude: 40.7358, longitude: -74.1724, speedMilesPerHour: 30 },
        },
        time: '2026-02-17T12:00:00Z',
      });

      expect(result.processed.gps).toBe(1);
      expect(queueJobs[0].data.source).toBe('samsara');
    });
  });

  describe('Samsara GeofenceEntry', () => {
    it('enqueues GPS + driver event', async () => {
      const result = await processWebhook('samsara', {
        eventType: 'GeofenceEntry',
        data: {
          vehicle: { id: 'v-001', name: 'Bus 42' },
          location: { latitude: 40.7, longitude: -74.1 },
          geofence: { name: 'School Zone' },
        },
        time: '2026-02-17T08:00:00Z',
      });

      expect(result.processed.gps).toBe(1);
      expect(result.processed.events).toBe(1);
      expect(queueJobs.find((j) => j.name === 'process-driver-event')!.data.eventType).toBe('GEOFENCE_ENTRY');
    });
  });

  describe('Samsara SafetyEvent', () => {
    it('enqueues driver event for harsh braking', async () => {
      const result = await processWebhook('samsara', {
        eventType: 'SafetyEvent',
        data: {
          vehicle: { id: 'v-001', name: 'Bus 42' },
          behaviorLabel: 'Harsh Braking',
          time: '2026-02-17T12:00:00Z',
        },
      });

      expect(result.processed.events).toBe(1);
      expect(queueJobs[0].data.eventType).toBe('HARSH_BRAKE');
    });
  });

  describe('Synovia position webhook', () => {
    it('enqueues GPS update', async () => {
      const result = await processWebhook('synovia', {
        type: 'position',
        vehicleId: 'syn-001',
        busNumber: 'Bus 12',
        lat: 40.73,
        lon: -74.17,
        speedMph: 20,
        timestamp: '2026-02-17T12:00:00Z',
      });

      expect(result.processed.gps).toBe(1);
      expect(queueJobs[0].data.source).toBe('synovia');
    });
  });

  describe('Synovia ridership webhook', () => {
    it('enqueues RFID scan', async () => {
      const result = await processWebhook('synovia', {
        type: 'ridership',
        cardId: 'CARD-789',
        vehicleId: 'syn-001',
        direction: 'ON',
        timestamp: '2026-02-17T07:30:00Z',
      });

      expect(result.processed.rfid).toBe(1);
      expect(queueJobs[0].data.scanType).toBe('BOARD');
    });
  });

  describe('Versatrans webhook', () => {
    it('enqueues GPS update from VEHICLE_LOCATION', async () => {
      const result = await processWebhook('versatrans', {
        eventType: 'VEHICLE_LOCATION',
        vehicleId: 'vt-001',
        busNumber: 'Bus 5',
        latitude: 40.73,
        longitude: -74.17,
        timestamp: '2026-02-17T12:00:00Z',
      });

      expect(result.processed.gps).toBe(1);
      expect(queueJobs[0].data.source).toBe('versatrans');
    });

    it('enqueues RFID scan from RIDERSHIP_SCAN', async () => {
      const result = await processWebhook('versatrans', {
        eventType: 'RIDERSHIP_SCAN',
        cardId: 'STU-001',
        vehicleId: 'vt-001',
        direction: 'on',
        timestamp: '2026-02-17T07:30:00Z',
      });

      expect(result.processed.rfid).toBe(1);
    });
  });

  describe('Seon webhook', () => {
    it('enqueues GPS update', async () => {
      const result = await processWebhook('seon', {
        type: 'gps',
        vehicleId: 'seon-001',
        busNumber: 'Bus 99',
        latitude: 40.73,
        longitude: -74.17,
        timestamp: '2026-02-17T12:00:00Z',
      });

      expect(result.processed.gps).toBe(1);
    });

    it('enqueues driver event from safety_event', async () => {
      const result = await processWebhook('seon', {
        type: 'safety_event',
        vehicleId: 'seon-001',
        busNumber: 'Bus 99',
        eventType: 'stop_arm_violation',
        priority: 'high',
        timestamp: '2026-02-17T08:00:00Z',
      });

      expect(result.processed.events).toBe(1);
      expect(queueJobs[0].data.eventType).toBe('STOP_ARM_VIOLATION');
    });
  });

  describe('BusPatrol webhook', () => {
    it('enqueues GPS update', async () => {
      const result = await processWebhook('buspatrol', {
        type: 'gps',
        busId: 'bp-001',
        busNumber: 'Bus 33',
        latitude: 40.73,
        longitude: -74.17,
        timestamp: '2026-02-17T12:00:00Z',
      });

      expect(result.processed.gps).toBe(1);
    });

    it('enqueues stop-arm violation event', async () => {
      const result = await processWebhook('buspatrol', {
        type: 'stop_arm_violation',
        busId: 'bp-001',
        busNumber: 'Bus 33',
        licensePlate: 'ABC 1234',
        timestamp: '2026-02-17T08:15:00Z',
      });

      expect(result.processed.events).toBe(1);
      expect(queueJobs[0].data.eventType).toBe('STOP_ARM_VIOLATION');
      expect(queueJobs[0].data.severity).toBe('CRITICAL');
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('rejects unknown vendor', async () => {
      await expect(
        processWebhook('unknown' as BusFleetVendor, {}),
      ).rejects.toThrow('Unknown vendor');
    });

    it('returns zero counts for unrecognized payload', async () => {
      const result = await processWebhook('zonar', {
        event_type: 'unknown_type',
        something: 'irrelevant',
      });

      expect(result.processed.gps).toBe(0);
      expect(result.processed.rfid).toBe(0);
      expect(result.processed.events).toBe(0);
      expect(queueJobs).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-event payload
  // -----------------------------------------------------------------------

  describe('multi-event processing', () => {
    it('processes multiple payloads in sequence', async () => {
      // GPS update
      await processWebhook('zonar', {
        event_type: 'location_update',
        asset_id: 'bus-001',
        latitude: 40.73,
        longitude: -74.17,
        timestamp: '2026-02-17T12:00:00Z',
      });

      // RFID scan
      await processWebhook('zonar', {
        event_type: 'zpass_scan',
        card_id: 'CARD-001',
        asset_id: 'bus-001',
        scan_type: 'board',
        timestamp: '2026-02-17T12:00:01Z',
      });

      expect(queueJobs).toHaveLength(2);
      expect(queueJobs[0].name).toBe('process-gps-update');
      expect(queueJobs[1].name).toBe('process-rfid-scan');
    });
  });
});
