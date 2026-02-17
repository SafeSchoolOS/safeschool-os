/**
 * Synovia Solutions (GPS Trackit) / Here Comes The Bus
 *
 * Synovia provides:
 * - GPS Trackit fleet management with real-time tracking
 * - RFID student ridership (via integrated readers)
 * - "Here Comes The Bus" parent app — real-time bus locations + ETAs
 * - Geofence-based stop arrival/departure detection
 *
 * API: Synovia Solutions REST API
 * Auth: API key + district ID
 */

import type {
  BusFleetAdapter,
  BusFleetAdapterConfig,
  GpsUpdate,
  RfidScanEvent,
  DriverEvent,
  VehicleHealth,
} from './types.js';

export class SynoviaAdapter implements BusFleetAdapter {
  readonly name = 'Synovia Solutions / Here Comes The Bus';
  private config!: BusFleetAdapterConfig;
  private baseUrl = '';
  private headers: Record<string, string> = {};

  async connect(config: BusFleetAdapterConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.apiUrl || 'https://api.gpstrackit.com/api/v1';
    this.headers = {
      'Authorization': `ApiKey ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-District-Id': config.orgId || '',
    };
    console.log(`[Synovia] Connected to ${this.baseUrl} (district: ${config.orgId})`);
  }

  async disconnect(): Promise<void> { console.log('[Synovia] Disconnected'); }

  async getVehicleLocations(): Promise<GpsUpdate[]> {
    const res = await fetch(`${this.baseUrl}/vehicles/positions`, { headers: this.headers });
    if (!res.ok) throw new Error(`Synovia GPS fetch failed: ${res.status}`);
    const data = await res.json() as any[];

    return data.map((v: any) => ({
      vehicleId: v.vehicleId || v.id,
      busNumber: v.busNumber || v.vehicleName || '',
      latitude: v.lat ?? v.latitude,
      longitude: v.lon ?? v.longitude,
      speed: v.speedMph ?? v.speed,
      heading: v.heading ?? v.course,
      timestamp: new Date(v.positionTime || v.timestamp),
      engineOn: v.ignition === true,
      metadata: { source: 'synovia', routeId: v.activeRouteId },
    }));
  }

  async getVehicleHistory(vehicleId: string, from: Date, to: Date): Promise<GpsUpdate[]> {
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const res = await fetch(`${this.baseUrl}/vehicles/${vehicleId}/history?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];
    return data.map((p: any) => ({
      vehicleId,
      busNumber: '',
      latitude: p.lat,
      longitude: p.lon,
      speed: p.speedMph,
      heading: p.heading,
      timestamp: new Date(p.positionTime),
      metadata: { source: 'synovia' },
    }));
  }

  async getRfidScans(since: Date): Promise<RfidScanEvent[]> {
    const params = new URLSearchParams({ since: since.toISOString() });
    const res = await fetch(`${this.baseUrl}/ridership/scans?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((s: any) => ({
      studentCardId: s.cardId || s.rfidTag,
      vehicleId: s.vehicleId,
      busNumber: s.busNumber || '',
      scanType: s.direction === 'ON' || s.scanType === 'BOARD' ? 'BOARD' as const : 'EXIT' as const,
      timestamp: new Date(s.scanTime || s.timestamp),
      latitude: s.lat,
      longitude: s.lon,
      metadata: { source: 'synovia', studentName: s.studentName },
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
      eventType: mapSynoviaEvent(e.eventType),
      severity: e.priority === 'high' ? 'CRITICAL' as const : 'WARNING' as const,
      timestamp: new Date(e.timestamp),
      latitude: e.lat,
      longitude: e.lon,
      description: e.description,
      metadata: { source: 'synovia' },
    }));
  }

  async getVehicleHealth(vehicleId: string): Promise<VehicleHealth | null> {
    const res = await fetch(`${this.baseUrl}/vehicles/${vehicleId}/diagnostics`, { headers: this.headers });
    if (!res.ok) return null;
    const d = await res.json() as any;
    return {
      vehicleId,
      busNumber: d.busNumber || '',
      engineStatus: d.engineOn ? 'ON' : 'OFF',
      fuelLevel: d.fuelLevelPercent,
      batteryVoltage: d.batteryVoltage,
      odometerMiles: d.odometerMiles,
      dtcCodes: d.diagnosticCodes || [],
    };
  }

  parseWebhook(body: unknown): { gpsUpdates: GpsUpdate[]; rfidScans: RfidScanEvent[]; driverEvents: DriverEvent[] } {
    const p = body as any;
    const result = { gpsUpdates: [] as GpsUpdate[], rfidScans: [] as RfidScanEvent[], driverEvents: [] as DriverEvent[] };

    if (p.type === 'position' || p.type === 'gps') {
      result.gpsUpdates.push({
        vehicleId: p.vehicleId, busNumber: p.busNumber || '',
        latitude: p.lat, longitude: p.lon, speed: p.speedMph,
        heading: p.heading, timestamp: new Date(p.timestamp),
      });
    } else if (p.type === 'ridership' || p.type === 'scan') {
      result.rfidScans.push({
        studentCardId: p.cardId, vehicleId: p.vehicleId,
        busNumber: p.busNumber || '',
        scanType: p.direction === 'ON' ? 'BOARD' : 'EXIT',
        timestamp: new Date(p.timestamp),
        latitude: p.lat, longitude: p.lon,
      });
    } else if (p.type === 'stop_arrival' || p.type === 'stop_departure') {
      result.driverEvents.push({
        vehicleId: p.vehicleId, busNumber: p.busNumber || '',
        eventType: p.type === 'stop_arrival' ? 'GEOFENCE_ENTRY' : 'GEOFENCE_EXIT',
        severity: 'INFO', timestamp: new Date(p.timestamp),
        latitude: p.lat, longitude: p.lon,
        description: `Stop: ${p.stopName || 'unknown'}`,
      });
    }
    return result;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/status`, { headers: this.headers });
      return res.ok;
    } catch { return false; }
  }
}

function mapSynoviaEvent(type: string): DriverEvent['eventType'] {
  const map: Record<string, DriverEvent['eventType']> = {
    'hard_brake': 'HARSH_BRAKE', 'harsh_braking': 'HARSH_BRAKE',
    'speeding': 'SPEEDING', 'over_speed': 'SPEEDING',
    'panic': 'PANIC', 'sos': 'PANIC',
    'stop_arm_violation': 'STOP_ARM_VIOLATION',
    'route_deviation': 'ROUTE_DEVIATION',
    'geofence_entry': 'GEOFENCE_ENTRY', 'geofence_exit': 'GEOFENCE_EXIT',
  };
  return map[type] || 'CAMERA_ALERT';
}
