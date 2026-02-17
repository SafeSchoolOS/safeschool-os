/**
 * Zonar Systems — ZPass RFID + GPS Fleet Management
 *
 * Zonar Bus Suite provides:
 * - V4 Telematics Control Unit for HD-GPS (lat, lng, time, speed at every data point)
 * - ZPass RFID student tracking (board/exit with time, date, location)
 * - Z Pass+ parent notifications
 * - MyView parent bus tracking app
 *
 * API: Zonar Ground Traffic Control (GTC) platform
 * Auth: API key + fleet ID
 * Data: REST polling + optional webhook callbacks
 */

import type {
  BusFleetAdapter,
  BusFleetAdapterConfig,
  GpsUpdate,
  RfidScanEvent,
  DriverEvent,
  VehicleHealth,
} from './types.js';

export class ZonarAdapter implements BusFleetAdapter {
  readonly name = 'Zonar Systems';
  private config!: BusFleetAdapterConfig;
  private baseUrl = '';
  private headers: Record<string, string> = {};

  async connect(config: BusFleetAdapterConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.apiUrl || 'https://gtc.zonarsystems.net/api/v2';
    this.headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Fleet-Id': config.orgId || '',
    };
    console.log(`[Zonar] Connected to ${this.baseUrl} (fleet: ${config.orgId})`);
  }

  async disconnect(): Promise<void> {
    console.log('[Zonar] Disconnected');
  }

  async getVehicleLocations(): Promise<GpsUpdate[]> {
    const res = await fetch(`${this.baseUrl}/assets/locations`, { headers: this.headers });
    if (!res.ok) throw new Error(`Zonar GPS fetch failed: ${res.status}`);
    const data = await res.json() as any[];

    return data.map((v: any) => ({
      vehicleId: v.asset_id || v.id,
      busNumber: v.asset_tag || v.name || '',
      latitude: v.latitude ?? v.lat,
      longitude: v.longitude ?? v.lng,
      speed: v.speed_mph ?? v.speed,
      heading: v.heading,
      timestamp: new Date(v.timestamp || v.event_time),
      odometer: v.odometer_miles,
      engineOn: v.ignition === 'on' || v.engine_status === 'running',
      metadata: { source: 'zonar', rawId: v.id },
    }));
  }

  async getVehicleHistory(vehicleId: string, from: Date, to: Date): Promise<GpsUpdate[]> {
    const params = new URLSearchParams({
      start: from.toISOString(),
      end: to.toISOString(),
    });
    const res = await fetch(`${this.baseUrl}/assets/${vehicleId}/locations?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((p: any) => ({
      vehicleId,
      busNumber: p.asset_tag || '',
      latitude: p.latitude,
      longitude: p.longitude,
      speed: p.speed_mph,
      heading: p.heading,
      timestamp: new Date(p.timestamp),
      metadata: { source: 'zonar' },
    }));
  }

  async getRfidScans(since: Date): Promise<RfidScanEvent[]> {
    const params = new URLSearchParams({ since: since.toISOString() });
    const res = await fetch(`${this.baseUrl}/zpass/events?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((e: any) => ({
      studentCardId: e.card_id || e.rfid_tag,
      vehicleId: e.asset_id || e.bus_id,
      busNumber: e.bus_number || e.asset_tag || '',
      scanType: (e.event_type === 'board' || e.event_type === 'BOARD') ? 'BOARD' as const : 'EXIT' as const,
      timestamp: new Date(e.timestamp || e.scan_time),
      latitude: e.latitude,
      longitude: e.longitude,
      metadata: { source: 'zonar_zpass', studentName: e.student_name },
    }));
  }

  async getDriverEvents(since: Date): Promise<DriverEvent[]> {
    const params = new URLSearchParams({ since: since.toISOString() });
    const res = await fetch(`${this.baseUrl}/events?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((e: any) => ({
      vehicleId: e.asset_id,
      busNumber: e.asset_tag || '',
      eventType: mapZonarEvent(e.event_type),
      severity: e.severity === 'critical' ? 'CRITICAL' as const : e.severity === 'warning' ? 'WARNING' as const : 'INFO' as const,
      timestamp: new Date(e.timestamp),
      latitude: e.latitude,
      longitude: e.longitude,
      description: e.description || e.message,
      metadata: { source: 'zonar' },
    }));
  }

  async getVehicleHealth(vehicleId: string): Promise<VehicleHealth | null> {
    const res = await fetch(`${this.baseUrl}/assets/${vehicleId}/diagnostics`, { headers: this.headers });
    if (!res.ok) return null;
    const d = await res.json() as any;

    return {
      vehicleId,
      busNumber: d.asset_tag || '',
      engineStatus: d.engine_running ? 'ON' : 'OFF',
      fuelLevel: d.fuel_level_percent,
      batteryVoltage: d.battery_voltage,
      odometerMiles: d.odometer_miles,
      dtcCodes: d.dtc_codes || [],
    };
  }

  parseWebhook(body: unknown): { gpsUpdates: GpsUpdate[]; rfidScans: RfidScanEvent[]; driverEvents: DriverEvent[] } {
    const payload = body as any;
    const result = { gpsUpdates: [] as GpsUpdate[], rfidScans: [] as RfidScanEvent[], driverEvents: [] as DriverEvent[] };

    if (payload.event_type === 'location_update' || payload.type === 'gps') {
      result.gpsUpdates.push({
        vehicleId: payload.asset_id,
        busNumber: payload.asset_tag || '',
        latitude: payload.latitude,
        longitude: payload.longitude,
        speed: payload.speed_mph,
        heading: payload.heading,
        timestamp: new Date(payload.timestamp),
      });
    } else if (payload.event_type === 'zpass_scan' || payload.type === 'rfid') {
      result.rfidScans.push({
        studentCardId: payload.card_id,
        vehicleId: payload.asset_id,
        busNumber: payload.asset_tag || '',
        scanType: payload.scan_type === 'board' ? 'BOARD' : 'EXIT',
        timestamp: new Date(payload.timestamp),
        latitude: payload.latitude,
        longitude: payload.longitude,
      });
    }

    return result;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/ping`, { headers: this.headers });
      return res.ok;
    } catch { return false; }
  }
}

function mapZonarEvent(type: string): DriverEvent['eventType'] {
  const map: Record<string, DriverEvent['eventType']> = {
    'hard_brake': 'HARSH_BRAKE',
    'speeding': 'SPEEDING',
    'panic': 'PANIC',
    'stop_arm': 'STOP_ARM_VIOLATION',
    'geofence_enter': 'GEOFENCE_ENTRY',
    'geofence_exit': 'GEOFENCE_EXIT',
  };
  return map[type] || 'CAMERA_ALERT';
}
