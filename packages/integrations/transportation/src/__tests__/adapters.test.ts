import { describe, it, expect } from 'vitest';
import { ZonarAdapter } from '../adapters/zonar.js';
import { SamsaraAdapter } from '../adapters/samsara.js';
import { SynoviaAdapter } from '../adapters/synovia.js';
import { VersatransAdapter } from '../adapters/versatrans.js';
import { SeonAdapter } from '../adapters/seon.js';
import { BusPatrolAdapter } from '../adapters/buspatrol.js';
import { ConsoleBusFleetAdapter } from '../adapters/console.js';
import {
  createBusFleetAdapter,
  SUPPORTED_BUS_FLEET_VENDORS,
  type BusFleetVendor,
} from '../adapters/index.js';

// ---------------------------------------------------------------------------
// Factory function tests
// ---------------------------------------------------------------------------

describe('createBusFleetAdapter', () => {
  it('creates Zonar adapter', () => {
    const adapter = createBusFleetAdapter('zonar');
    expect(adapter).toBeInstanceOf(ZonarAdapter);
    expect(adapter.name).toBe('Zonar Systems');
  });

  it('creates Samsara adapter', () => {
    const adapter = createBusFleetAdapter('samsara');
    expect(adapter).toBeInstanceOf(SamsaraAdapter);
    expect(adapter.name).toBe('Samsara');
  });

  it('creates Synovia adapter for "synovia"', () => {
    const adapter = createBusFleetAdapter('synovia');
    expect(adapter).toBeInstanceOf(SynoviaAdapter);
    expect(adapter.name).toContain('Synovia');
  });

  it('creates Synovia adapter for "here-comes-the-bus"', () => {
    const adapter = createBusFleetAdapter('here-comes-the-bus');
    expect(adapter).toBeInstanceOf(SynoviaAdapter);
  });

  it('creates Versatrans adapter for "versatrans"', () => {
    const adapter = createBusFleetAdapter('versatrans');
    expect(adapter).toBeInstanceOf(VersatransAdapter);
    expect(adapter.name).toContain('Versatrans');
  });

  it('creates Versatrans adapter for "tyler"', () => {
    const adapter = createBusFleetAdapter('tyler');
    expect(adapter).toBeInstanceOf(VersatransAdapter);
  });

  it('creates Seon adapter', () => {
    const adapter = createBusFleetAdapter('seon');
    expect(adapter).toBeInstanceOf(SeonAdapter);
    expect(adapter.name).toBe('Seon');
  });

  it('creates BusPatrol adapter', () => {
    const adapter = createBusFleetAdapter('buspatrol');
    expect(adapter).toBeInstanceOf(BusPatrolAdapter);
    expect(adapter.name).toBe('BusPatrol');
  });

  it('creates Console adapter', () => {
    const adapter = createBusFleetAdapter('console');
    expect(adapter).toBeInstanceOf(ConsoleBusFleetAdapter);
    expect(adapter.name).toContain('Console');
  });

  it('throws for unknown vendor', () => {
    expect(() => createBusFleetAdapter('unknown-vendor' as BusFleetVendor)).toThrow(
      'Unknown bus fleet vendor',
    );
  });

  it('SUPPORTED_BUS_FLEET_VENDORS includes all vendors', () => {
    expect(SUPPORTED_BUS_FLEET_VENDORS).toContain('zonar');
    expect(SUPPORTED_BUS_FLEET_VENDORS).toContain('samsara');
    expect(SUPPORTED_BUS_FLEET_VENDORS).toContain('synovia');
    expect(SUPPORTED_BUS_FLEET_VENDORS).toContain('versatrans');
    expect(SUPPORTED_BUS_FLEET_VENDORS).toContain('seon');
    expect(SUPPORTED_BUS_FLEET_VENDORS).toContain('buspatrol');
    expect(SUPPORTED_BUS_FLEET_VENDORS).toContain('console');
  });
});

// ---------------------------------------------------------------------------
// Zonar parseWebhook
// ---------------------------------------------------------------------------

describe('ZonarAdapter.parseWebhook', () => {
  const adapter = new ZonarAdapter();

  it('parses GPS location_update', () => {
    const result = adapter.parseWebhook({
      event_type: 'location_update',
      asset_id: 'bus-001',
      asset_tag: 'Bus 42',
      latitude: 40.7358,
      longitude: -74.1724,
      speed_mph: 25,
      heading: 180,
      timestamp: '2026-02-17T12:00:00Z',
    });

    expect(result.gpsUpdates).toHaveLength(1);
    expect(result.rfidScans).toHaveLength(0);
    expect(result.driverEvents).toHaveLength(0);

    const gps = result.gpsUpdates[0];
    expect(gps.vehicleId).toBe('bus-001');
    expect(gps.busNumber).toBe('Bus 42');
    expect(gps.latitude).toBe(40.7358);
    expect(gps.longitude).toBe(-74.1724);
    expect(gps.speed).toBe(25);
    expect(gps.heading).toBe(180);
  });

  it('parses GPS with type: "gps"', () => {
    const result = adapter.parseWebhook({
      type: 'gps',
      asset_id: 'bus-002',
      asset_tag: 'Bus 7',
      latitude: 40.74,
      longitude: -74.17,
      timestamp: '2026-02-17T12:00:00Z',
    });

    expect(result.gpsUpdates).toHaveLength(1);
    expect(result.gpsUpdates[0].vehicleId).toBe('bus-002');
  });

  it('parses RFID zpass_scan', () => {
    const result = adapter.parseWebhook({
      event_type: 'zpass_scan',
      card_id: 'CARD-123',
      asset_id: 'bus-001',
      asset_tag: 'Bus 42',
      scan_type: 'board',
      timestamp: '2026-02-17T07:30:00Z',
      latitude: 40.735,
      longitude: -74.172,
    });

    expect(result.rfidScans).toHaveLength(1);
    expect(result.gpsUpdates).toHaveLength(0);

    const scan = result.rfidScans[0];
    expect(scan.studentCardId).toBe('CARD-123');
    expect(scan.vehicleId).toBe('bus-001');
    expect(scan.scanType).toBe('BOARD');
  });

  it('parses RFID with type: "rfid"', () => {
    const result = adapter.parseWebhook({
      type: 'rfid',
      card_id: 'CARD-456',
      asset_id: 'bus-002',
      asset_tag: 'Bus 7',
      scan_type: 'exit',
      timestamp: '2026-02-17T15:00:00Z',
    });

    expect(result.rfidScans).toHaveLength(1);
    expect(result.rfidScans[0].scanType).toBe('EXIT');
  });

  it('returns empty for unknown event_type', () => {
    const result = adapter.parseWebhook({
      event_type: 'unknown',
      asset_id: 'bus-001',
    });

    expect(result.gpsUpdates).toHaveLength(0);
    expect(result.rfidScans).toHaveLength(0);
    expect(result.driverEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Samsara parseWebhook
// ---------------------------------------------------------------------------

describe('SamsaraAdapter.parseWebhook', () => {
  const adapter = new SamsaraAdapter();

  it('parses VehicleGps event', () => {
    const result = adapter.parseWebhook({
      eventType: 'VehicleGps',
      data: {
        vehicle: { id: 'v-001', name: 'Bus 42' },
        location: { latitude: 40.7358, longitude: -74.1724, speedMilesPerHour: 30, headingDegrees: 90 },
      },
      time: '2026-02-17T12:00:00Z',
    });

    expect(result.gpsUpdates).toHaveLength(1);
    expect(result.gpsUpdates[0].vehicleId).toBe('v-001');
    expect(result.gpsUpdates[0].latitude).toBe(40.7358);
    expect(result.gpsUpdates[0].speed).toBe(30);
  });

  it('parses GeofenceEntry event with both GPS and driver event', () => {
    const result = adapter.parseWebhook({
      eventType: 'GeofenceEntry',
      data: {
        vehicle: { id: 'v-001', name: 'Bus 42' },
        location: { latitude: 40.7, longitude: -74.1 },
        geofence: { name: 'Lincoln Elementary' },
      },
      time: '2026-02-17T08:00:00Z',
    });

    expect(result.gpsUpdates).toHaveLength(1);
    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('GEOFENCE_ENTRY');
    expect(result.driverEvents[0].description).toContain('Lincoln Elementary');
  });

  it('parses GeofenceExit event', () => {
    const result = adapter.parseWebhook({
      eventType: 'GeofenceExit',
      data: {
        vehicle: { id: 'v-001', name: 'Bus 42' },
        location: { latitude: 40.7, longitude: -74.1 },
        geofence: { name: 'School Zone' },
      },
      time: '2026-02-17T15:30:00Z',
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('GEOFENCE_EXIT');
  });

  it('parses SafetyEvent', () => {
    const result = adapter.parseWebhook({
      eventType: 'SafetyEvent',
      data: {
        vehicle: { id: 'v-001', name: 'Bus 42' },
        behaviorLabel: 'Harsh Braking',
        time: '2026-02-17T12:00:00Z',
        downloadForwardVideoUrl: 'https://example.com/video.mp4',
      },
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('HARSH_BRAKE');
    expect(result.driverEvents[0].mediaUrl).toBe('https://example.com/video.mp4');
  });

  it('returns empty for unknown event type', () => {
    const result = adapter.parseWebhook({
      eventType: 'UnknownEvent',
      data: {},
    });

    expect(result.gpsUpdates).toHaveLength(0);
    expect(result.rfidScans).toHaveLength(0);
    expect(result.driverEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Synovia parseWebhook
// ---------------------------------------------------------------------------

describe('SynoviaAdapter.parseWebhook', () => {
  const adapter = new SynoviaAdapter();

  it('parses position event', () => {
    const result = adapter.parseWebhook({
      type: 'position',
      vehicleId: 'syn-001',
      busNumber: 'Bus 12',
      lat: 40.73,
      lon: -74.17,
      speedMph: 20,
      heading: 270,
      timestamp: '2026-02-17T12:00:00Z',
    });

    expect(result.gpsUpdates).toHaveLength(1);
    expect(result.gpsUpdates[0].vehicleId).toBe('syn-001');
    expect(result.gpsUpdates[0].latitude).toBe(40.73);
  });

  it('parses ridership scan event', () => {
    const result = adapter.parseWebhook({
      type: 'ridership',
      cardId: 'CARD-789',
      vehicleId: 'syn-001',
      busNumber: 'Bus 12',
      direction: 'ON',
      timestamp: '2026-02-17T07:30:00Z',
      lat: 40.73,
      lon: -74.17,
    });

    expect(result.rfidScans).toHaveLength(1);
    expect(result.rfidScans[0].scanType).toBe('BOARD');
    expect(result.rfidScans[0].studentCardId).toBe('CARD-789');
  });

  it('parses stop_arrival event', () => {
    const result = adapter.parseWebhook({
      type: 'stop_arrival',
      vehicleId: 'syn-001',
      busNumber: 'Bus 12',
      stopName: 'Main St & Oak Ave',
      timestamp: '2026-02-17T07:25:00Z',
      lat: 40.73,
      lon: -74.17,
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('GEOFENCE_ENTRY');
    expect(result.driverEvents[0].description).toContain('Main St & Oak Ave');
  });

  it('parses stop_departure event', () => {
    const result = adapter.parseWebhook({
      type: 'stop_departure',
      vehicleId: 'syn-001',
      busNumber: 'Bus 12',
      stopName: 'School',
      timestamp: '2026-02-17T07:45:00Z',
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('GEOFENCE_EXIT');
  });
});

// ---------------------------------------------------------------------------
// Versatrans parseWebhook
// ---------------------------------------------------------------------------

describe('VersatransAdapter.parseWebhook', () => {
  const adapter = new VersatransAdapter();

  it('parses VEHICLE_LOCATION event', () => {
    const result = adapter.parseWebhook({
      eventType: 'VEHICLE_LOCATION',
      vehicleId: 'vt-001',
      busNumber: 'Bus 5',
      latitude: 40.73,
      longitude: -74.17,
      speedMph: 15,
      heading: 45,
      timestamp: '2026-02-17T12:00:00Z',
    });

    expect(result.gpsUpdates).toHaveLength(1);
    expect(result.gpsUpdates[0].vehicleId).toBe('vt-001');
    expect(result.gpsUpdates[0].busNumber).toBe('Bus 5');
  });

  it('parses RIDERSHIP_SCAN event', () => {
    const result = adapter.parseWebhook({
      eventType: 'RIDERSHIP_SCAN',
      cardId: 'STU-001',
      vehicleId: 'vt-001',
      busNumber: 'Bus 5',
      direction: 'on',
      timestamp: '2026-02-17T07:30:00Z',
      latitude: 40.73,
      longitude: -74.17,
    });

    expect(result.rfidScans).toHaveLength(1);
    expect(result.rfidScans[0].scanType).toBe('BOARD');
  });

  it('parses STOP_ARRIVAL event', () => {
    const result = adapter.parseWebhook({
      eventType: 'STOP_ARRIVAL',
      vehicleId: 'vt-001',
      busNumber: 'Bus 5',
      stopName: 'Elm St Stop',
      timestamp: '2026-02-17T07:25:00Z',
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('GEOFENCE_ENTRY');
  });

  it('parses STOP_DEPARTURE event', () => {
    const result = adapter.parseWebhook({
      eventType: 'STOP_DEPARTURE',
      vehicleId: 'vt-001',
      busNumber: 'Bus 5',
      timestamp: '2026-02-17T07:35:00Z',
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('GEOFENCE_EXIT');
  });
});

// ---------------------------------------------------------------------------
// Seon parseWebhook
// ---------------------------------------------------------------------------

describe('SeonAdapter.parseWebhook', () => {
  const adapter = new SeonAdapter();

  it('parses gps event', () => {
    const result = adapter.parseWebhook({
      type: 'gps',
      vehicleId: 'seon-001',
      busNumber: 'Bus 99',
      latitude: 40.73,
      longitude: -74.17,
      speedMph: 22,
      heading: 180,
      timestamp: '2026-02-17T12:00:00Z',
    });

    expect(result.gpsUpdates).toHaveLength(1);
    expect(result.gpsUpdates[0].vehicleId).toBe('seon-001');
    expect(result.gpsUpdates[0].speed).toBe(22);
  });

  it('parses ridership event', () => {
    const result = adapter.parseWebhook({
      type: 'ridership',
      cardId: 'RFID-001',
      vehicleId: 'seon-001',
      busNumber: 'Bus 99',
      action: 'board',
      timestamp: '2026-02-17T07:30:00Z',
      latitude: 40.73,
      longitude: -74.17,
    });

    expect(result.rfidScans).toHaveLength(1);
    expect(result.rfidScans[0].scanType).toBe('BOARD');
  });

  it('parses rfid_scan event', () => {
    const result = adapter.parseWebhook({
      type: 'rfid_scan',
      cardId: 'RFID-002',
      vehicleId: 'seon-001',
      busNumber: 'Bus 99',
      action: 'exit',
      timestamp: '2026-02-17T15:00:00Z',
    });

    expect(result.rfidScans).toHaveLength(1);
    expect(result.rfidScans[0].scanType).toBe('EXIT');
  });

  it('parses safety_event', () => {
    const result = adapter.parseWebhook({
      type: 'safety_event',
      vehicleId: 'seon-001',
      busNumber: 'Bus 99',
      eventType: 'stop_arm_violation',
      priority: 'high',
      timestamp: '2026-02-17T08:00:00Z',
      latitude: 40.73,
      longitude: -74.17,
      description: 'Stop arm violation detected',
      videoClipUrl: 'https://example.com/clip.mp4',
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('STOP_ARM_VIOLATION');
    expect(result.driverEvents[0].severity).toBe('CRITICAL');
    expect(result.driverEvents[0].mediaUrl).toBe('https://example.com/clip.mp4');
  });

  it('parses camera_event', () => {
    const result = adapter.parseWebhook({
      type: 'camera_event',
      vehicleId: 'seon-001',
      busNumber: 'Bus 99',
      eventType: 'speeding',
      priority: 'normal',
      timestamp: '2026-02-17T12:00:00Z',
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('SPEEDING');
  });
});

// ---------------------------------------------------------------------------
// BusPatrol parseWebhook
// ---------------------------------------------------------------------------

describe('BusPatrolAdapter.parseWebhook', () => {
  const adapter = new BusPatrolAdapter();

  it('parses gps event', () => {
    const result = adapter.parseWebhook({
      type: 'gps',
      busId: 'bp-001',
      busNumber: 'Bus 33',
      latitude: 40.73,
      longitude: -74.17,
      speedMph: 18,
      heading: 90,
      timestamp: '2026-02-17T12:00:00Z',
    });

    expect(result.gpsUpdates).toHaveLength(1);
    expect(result.gpsUpdates[0].vehicleId).toBe('bp-001');
    expect(result.gpsUpdates[0].busNumber).toBe('Bus 33');
  });

  it('parses position_update event', () => {
    const result = adapter.parseWebhook({
      type: 'position_update',
      vehicleId: 'bp-002',
      busNumber: 'Bus 44',
      latitude: 40.74,
      longitude: -74.18,
      timestamp: '2026-02-17T12:00:00Z',
    });

    expect(result.gpsUpdates).toHaveLength(1);
    expect(result.gpsUpdates[0].vehicleId).toBe('bp-002');
  });

  it('parses stop_arm_violation event', () => {
    const result = adapter.parseWebhook({
      type: 'stop_arm_violation',
      busId: 'bp-001',
      busNumber: 'Bus 33',
      licensePlate: 'ABC 1234',
      violationId: 'viol-001',
      timestamp: '2026-02-17T08:15:00Z',
      latitude: 40.73,
      longitude: -74.17,
      videoUrl: 'https://example.com/violation.mp4',
    });

    expect(result.driverEvents).toHaveLength(1);
    const event = result.driverEvents[0];
    expect(event.eventType).toBe('STOP_ARM_VIOLATION');
    expect(event.severity).toBe('CRITICAL');
    expect(event.description).toContain('ABC 1234');
    expect(event.mediaUrl).toBe('https://example.com/violation.mp4');
  });

  it('parses violation event alias', () => {
    const result = adapter.parseWebhook({
      type: 'violation',
      busId: 'bp-001',
      busNumber: 'Bus 33',
      licensePlate: 'XYZ 5678',
      timestamp: '2026-02-17T08:30:00Z',
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('STOP_ARM_VIOLATION');
  });

  it('parses safety_event', () => {
    const result = adapter.parseWebhook({
      type: 'safety_event',
      busId: 'bp-001',
      busNumber: 'Bus 33',
      eventType: 'speeding',
      timestamp: '2026-02-17T12:00:00Z',
      description: 'Bus exceeding speed limit',
    });

    expect(result.driverEvents).toHaveLength(1);
    expect(result.driverEvents[0].eventType).toBe('SPEEDING');
  });

  it('returns empty for unknown event type', () => {
    const result = adapter.parseWebhook({
      type: 'unknown',
      busId: 'bp-001',
    });

    expect(result.gpsUpdates).toHaveLength(0);
    expect(result.rfidScans).toHaveLength(0);
    expect(result.driverEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Console adapter
// ---------------------------------------------------------------------------

describe('ConsoleBusFleetAdapter', () => {
  const adapter = new ConsoleBusFleetAdapter();

  it('parseWebhook returns empty arrays', () => {
    const result = adapter.parseWebhook({ type: 'gps', lat: 40.7, lon: -74.1 });
    expect(result.gpsUpdates).toHaveLength(0);
    expect(result.rfidScans).toHaveLength(0);
    expect(result.driverEvents).toHaveLength(0);
  });

  it('healthCheck returns true', async () => {
    expect(await adapter.healthCheck()).toBe(true);
  });

  it('getVehicleLocations returns mock data', async () => {
    await adapter.connect({ apiUrl: 'http://localhost' });
    const locations = await adapter.getVehicleLocations();
    expect(locations.length).toBeGreaterThanOrEqual(2);
    expect(locations[0].busNumber).toBe('Bus 42');
    expect(locations[0].latitude).toBeGreaterThan(0);
  });

  it('getVehicleHealth returns mock data', async () => {
    const health = await adapter.getVehicleHealth('mock-bus-1');
    expect(health).not.toBeNull();
    expect(health!.engineStatus).toBe('ON');
    expect(health!.fuelLevel).toBe(75);
  });
});
