/**
 * Tyler Technologies / Versatrans — Student Transportation Management
 *
 * Versatrans (now Tyler Technologies) provides:
 * - RP (Routing & Planning) — route optimization, bus assignments
 * - e-Link — real-time GPS tracking, parent notifications
 * - My Stop — parent bus-tracking app
 * - RFID / barcode student scanning via third-party hardware
 *
 * API: Tyler Technologies REST API (Versatrans e-Link)
 * Auth: API key + district code
 */

import type {
  BusFleetAdapter,
  BusFleetAdapterConfig,
  GpsUpdate,
  RfidScanEvent,
  DriverEvent,
  VehicleHealth,
} from './types.js';

export class VersatransAdapter implements BusFleetAdapter {
  readonly name = 'Tyler Versatrans';
  private config!: BusFleetAdapterConfig;
  private baseUrl = '';
  private headers: Record<string, string> = {};

  async connect(config: BusFleetAdapterConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.apiUrl || 'https://api.tylertech.com/versatrans/v1';
    this.headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-District-Code': config.orgId || '',
    };
    console.log(`[Versatrans] Connected to ${this.baseUrl} (district: ${config.orgId})`);
  }

  async disconnect(): Promise<void> { console.log('[Versatrans] Disconnected'); }

  async getVehicleLocations(): Promise<GpsUpdate[]> {
    const res = await fetch(`${this.baseUrl}/vehicles/locations`, { headers: this.headers });
    if (!res.ok) throw new Error(`Versatrans GPS fetch failed: ${res.status}`);
    const data = await res.json() as any;

    return (data.vehicles || data || []).map((v: any) => ({
      vehicleId: v.vehicleId || v.id,
      busNumber: v.busNumber || v.vehicleName || '',
      latitude: v.latitude ?? v.lat,
      longitude: v.longitude ?? v.lng,
      speed: v.speedMph ?? v.speed,
      heading: v.heading ?? v.direction,
      timestamp: new Date(v.lastUpdate || v.timestamp),
      engineOn: v.ignitionOn === true,
      metadata: { source: 'versatrans', routeId: v.routeId, runId: v.runId },
    }));
  }

  async getVehicleHistory(vehicleId: string, from: Date, to: Date): Promise<GpsUpdate[]> {
    const params = new URLSearchParams({
      startDate: from.toISOString(),
      endDate: to.toISOString(),
    });
    const res = await fetch(`${this.baseUrl}/vehicles/${vehicleId}/history?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];
    return data.map((p: any) => ({
      vehicleId,
      busNumber: '',
      latitude: p.latitude,
      longitude: p.longitude,
      speed: p.speedMph,
      heading: p.heading,
      timestamp: new Date(p.timestamp),
      metadata: { source: 'versatrans' },
    }));
  }

  async getRfidScans(since: Date): Promise<RfidScanEvent[]> {
    const params = new URLSearchParams({ since: since.toISOString() });
    const res = await fetch(`${this.baseUrl}/ridership/scans?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((s: any) => ({
      studentCardId: s.cardId || s.studentId,
      vehicleId: s.vehicleId,
      busNumber: s.busNumber || '',
      scanType: s.scanType === 'BOARD' || s.direction === 'on' ? 'BOARD' as const : 'EXIT' as const,
      timestamp: new Date(s.scanTime || s.timestamp),
      latitude: s.latitude,
      longitude: s.longitude,
      metadata: { source: 'versatrans', studentName: s.studentName, stopId: s.stopId },
    }));
  }

  async getDriverEvents(since: Date): Promise<DriverEvent[]> {
    const params = new URLSearchParams({ since: since.toISOString() });
    const res = await fetch(`${this.baseUrl}/events?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((e: any) => ({
      vehicleId: e.vehicleId,
      busNumber: e.busNumber || '',
      eventType: mapVersatransEvent(e.eventType),
      severity: e.severity === 'critical' ? 'CRITICAL' as const : 'WARNING' as const,
      timestamp: new Date(e.timestamp),
      latitude: e.latitude,
      longitude: e.longitude,
      description: e.description,
      metadata: { source: 'versatrans' },
    }));
  }

  async getVehicleHealth(vehicleId: string): Promise<VehicleHealth | null> {
    const res = await fetch(`${this.baseUrl}/vehicles/${vehicleId}/diagnostics`, { headers: this.headers });
    if (!res.ok) return null;
    const d = await res.json() as any;
    return {
      vehicleId,
      busNumber: d.busNumber || '',
      engineStatus: d.engineRunning ? 'ON' : 'OFF',
      fuelLevel: d.fuelLevelPercent,
      odometerMiles: d.odometerMiles,
      dtcCodes: d.dtcCodes || [],
    };
  }

  parseWebhook(body: unknown): { gpsUpdates: GpsUpdate[]; rfidScans: RfidScanEvent[]; driverEvents: DriverEvent[] } {
    const p = body as any;
    const result = { gpsUpdates: [] as GpsUpdate[], rfidScans: [] as RfidScanEvent[], driverEvents: [] as DriverEvent[] };

    if (p.eventType === 'VEHICLE_LOCATION' || p.type === 'gps') {
      result.gpsUpdates.push({
        vehicleId: p.vehicleId, busNumber: p.busNumber || '',
        latitude: p.latitude, longitude: p.longitude,
        speed: p.speedMph, heading: p.heading,
        timestamp: new Date(p.timestamp),
      });
    } else if (p.eventType === 'RIDERSHIP_SCAN' || p.type === 'scan') {
      result.rfidScans.push({
        studentCardId: p.cardId || p.studentId,
        vehicleId: p.vehicleId, busNumber: p.busNumber || '',
        scanType: p.direction === 'on' ? 'BOARD' : 'EXIT',
        timestamp: new Date(p.timestamp),
        latitude: p.latitude, longitude: p.longitude,
      });
    } else if (p.eventType === 'STOP_ARRIVAL' || p.eventType === 'STOP_DEPARTURE') {
      result.driverEvents.push({
        vehicleId: p.vehicleId, busNumber: p.busNumber || '',
        eventType: p.eventType === 'STOP_ARRIVAL' ? 'GEOFENCE_ENTRY' : 'GEOFENCE_EXIT',
        severity: 'INFO', timestamp: new Date(p.timestamp),
        latitude: p.latitude, longitude: p.longitude,
        description: `Stop: ${p.stopName || 'unknown'}`,
      });
    }
    return result;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { headers: this.headers });
      return res.ok;
    } catch { return false; }
  }
}

function mapVersatransEvent(type: string): DriverEvent['eventType'] {
  const map: Record<string, DriverEvent['eventType']> = {
    'HARD_BRAKE': 'HARSH_BRAKE', 'HARSH_BRAKING': 'HARSH_BRAKE',
    'SPEEDING': 'SPEEDING', 'OVER_SPEED': 'SPEEDING',
    'PANIC': 'PANIC', 'SOS': 'PANIC',
    'STOP_ARM_VIOLATION': 'STOP_ARM_VIOLATION',
    'ROUTE_DEVIATION': 'ROUTE_DEVIATION',
    'GEOFENCE_ENTRY': 'GEOFENCE_ENTRY', 'GEOFENCE_EXIT': 'GEOFENCE_EXIT',
  };
  return map[type] || 'CAMERA_ALERT';
}
