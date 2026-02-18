/**
 * Console / Mock Bus Fleet Adapter — for development and testing
 *
 * Logs all operations to console. Returns simulated data for testing
 * the transportation pipeline without a real fleet system.
 */

import type {
  BusFleetAdapter,
  BusFleetAdapterConfig,
  GpsUpdate,
  RfidScanEvent,
  DriverEvent,
  VehicleHealth,
} from './types.js';

export class ConsoleBusFleetAdapter implements BusFleetAdapter {
  readonly name = 'Console (Dev)';
  private config!: BusFleetAdapterConfig;

  async connect(config: BusFleetAdapterConfig): Promise<void> {
    this.config = config;
    console.log(`[BusFleet:Console] Connected (mock mode)`);
  }

  async disconnect(): Promise<void> {
    console.log('[BusFleet:Console] Disconnected');
  }

  async getVehicleLocations(): Promise<GpsUpdate[]> {
    console.log('[BusFleet:Console] getVehicleLocations()');
    // Return a couple of simulated buses for testing
    const now = new Date();
    return [
      {
        vehicleId: 'mock-bus-1',
        busNumber: 'Bus 42',
        latitude: 40.7358 + (Math.random() - 0.5) * 0.01,
        longitude: -74.1724 + (Math.random() - 0.5) * 0.01,
        speed: 15 + Math.random() * 20,
        heading: Math.floor(Math.random() * 360),
        timestamp: now,
        engineOn: true,
        metadata: { source: 'console-mock' },
      },
      {
        vehicleId: 'mock-bus-2',
        busNumber: 'Bus 7',
        latitude: 40.7412 + (Math.random() - 0.5) * 0.01,
        longitude: -74.1689 + (Math.random() - 0.5) * 0.01,
        speed: 10 + Math.random() * 25,
        heading: Math.floor(Math.random() * 360),
        timestamp: now,
        engineOn: true,
        metadata: { source: 'console-mock' },
      },
    ];
  }

  async getVehicleHistory(vehicleId: string, from: Date, to: Date): Promise<GpsUpdate[]> {
    console.log(`[BusFleet:Console] getVehicleHistory(${vehicleId}, ${from.toISOString()}, ${to.toISOString()})`);
    return [];
  }

  async getRfidScans(since: Date): Promise<RfidScanEvent[]> {
    console.log(`[BusFleet:Console] getRfidScans(since: ${since.toISOString()})`);
    return [];
  }

  async getDriverEvents(since: Date): Promise<DriverEvent[]> {
    console.log(`[BusFleet:Console] getDriverEvents(since: ${since.toISOString()})`);
    return [];
  }

  async getVehicleHealth(vehicleId: string): Promise<VehicleHealth | null> {
    console.log(`[BusFleet:Console] getVehicleHealth(${vehicleId})`);
    return {
      vehicleId,
      busNumber: 'Mock Bus',
      engineStatus: 'ON',
      fuelLevel: 75,
      batteryVoltage: 12.6,
      odometerMiles: 45230,
      dtcCodes: [],
    };
  }

  parseWebhook(body: unknown): { gpsUpdates: GpsUpdate[]; rfidScans: RfidScanEvent[]; driverEvents: DriverEvent[] } {
    console.log('[BusFleet:Console] parseWebhook:', JSON.stringify(body).slice(0, 200));
    return { gpsUpdates: [], rfidScans: [], driverEvents: [] };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
