/**
 * Seon — Bus Camera Systems + GPS Tracking
 *
 * Seon provides:
 * - HD video surveillance cameras for school buses
 * - GPS tracking with live map view
 * - Student ridership tracking (optional RFID/barcode add-on)
 * - Stop-arm violation detection cameras
 * - Driver behavior monitoring
 *
 * API: Seon Fleet Management REST API
 * Auth: API key + fleet ID
 */

import type {
  BusFleetAdapter,
  BusFleetAdapterConfig,
  GpsUpdate,
  RfidScanEvent,
  DriverEvent,
  VehicleHealth,
} from './types.js';

export class SeonAdapter implements BusFleetAdapter {
  readonly name = 'Seon';
  private config!: BusFleetAdapterConfig;
  private baseUrl = '';
  private headers: Record<string, string> = {};

  async connect(config: BusFleetAdapterConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.apiUrl || 'https://api.seon.com/v1';
    this.headers = {
      'Authorization': `ApiKey ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Fleet-Id': config.orgId || '',
    };
    console.log(`[Seon] Connected to ${this.baseUrl} (fleet: ${config.orgId})`);
  }

  async disconnect(): Promise<void> { console.log('[Seon] Disconnected'); }

  async getVehicleLocations(): Promise<GpsUpdate[]> {
    const res = await fetch(`${this.baseUrl}/fleet/vehicles/positions`, { headers: this.headers });
    if (!res.ok) throw new Error(`Seon GPS fetch failed: ${res.status}`);
    const data = await res.json() as any;

    return (data.vehicles || data.data || []).map((v: any) => ({
      vehicleId: v.vehicleId || v.id,
      busNumber: v.busNumber || v.unitNumber || '',
      latitude: v.latitude ?? v.lat,
      longitude: v.longitude ?? v.lng,
      speed: v.speedMph ?? v.speed,
      heading: v.heading ?? v.bearing,
      timestamp: new Date(v.lastGpsTime || v.timestamp),
      engineOn: v.ignition === true || v.engineStatus === 'on',
      metadata: { source: 'seon', cameraStatus: v.cameraStatus },
    }));
  }

  async getVehicleHistory(vehicleId: string, from: Date, to: Date): Promise<GpsUpdate[]> {
    const params = new URLSearchParams({
      startTime: from.toISOString(),
      endTime: to.toISOString(),
    });
    const res = await fetch(`${this.baseUrl}/fleet/vehicles/${vehicleId}/trail?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];
    return data.map((p: any) => ({
      vehicleId,
      busNumber: '',
      latitude: p.latitude ?? p.lat,
      longitude: p.longitude ?? p.lng,
      speed: p.speedMph,
      heading: p.heading,
      timestamp: new Date(p.timestamp),
      metadata: { source: 'seon' },
    }));
  }

  async getRfidScans(since: Date): Promise<RfidScanEvent[]> {
    // Seon supports RFID as an optional add-on module
    const params = new URLSearchParams({ since: since.toISOString() });
    const res = await fetch(`${this.baseUrl}/ridership/events?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((s: any) => ({
      studentCardId: s.cardId || s.rfidTag,
      vehicleId: s.vehicleId,
      busNumber: s.busNumber || '',
      scanType: s.action === 'board' || s.action === 'BOARD' ? 'BOARD' as const : 'EXIT' as const,
      timestamp: new Date(s.scanTime || s.timestamp),
      latitude: s.latitude,
      longitude: s.longitude,
      metadata: { source: 'seon', studentName: s.studentName },
    }));
  }

  async getDriverEvents(since: Date): Promise<DriverEvent[]> {
    const params = new URLSearchParams({ since: since.toISOString() });
    const res = await fetch(`${this.baseUrl}/fleet/events?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((e: any) => ({
      vehicleId: e.vehicleId,
      busNumber: e.busNumber || e.unitNumber || '',
      eventType: mapSeonEvent(e.eventType || e.type),
      severity: e.priority === 'high' || e.severity === 'critical' ? 'CRITICAL' as const : 'WARNING' as const,
      timestamp: new Date(e.timestamp),
      latitude: e.latitude,
      longitude: e.longitude,
      description: e.description || e.eventName,
      mediaUrl: e.videoClipUrl || e.snapshotUrl,
      metadata: { source: 'seon', cameraId: e.cameraId },
    }));
  }

  async getVehicleHealth(vehicleId: string): Promise<VehicleHealth | null> {
    const res = await fetch(`${this.baseUrl}/fleet/vehicles/${vehicleId}/status`, { headers: this.headers });
    if (!res.ok) return null;
    const d = await res.json() as any;
    return {
      vehicleId,
      busNumber: d.busNumber || d.unitNumber || '',
      engineStatus: d.engineOn ? 'ON' : 'OFF',
      fuelLevel: d.fuelPercent,
      batteryVoltage: d.batteryVoltage,
      odometerMiles: d.odometerMiles,
      dtcCodes: d.faultCodes || [],
    };
  }

  parseWebhook(body: unknown): { gpsUpdates: GpsUpdate[]; rfidScans: RfidScanEvent[]; driverEvents: DriverEvent[] } {
    const p = body as any;
    const result = { gpsUpdates: [] as GpsUpdate[], rfidScans: [] as RfidScanEvent[], driverEvents: [] as DriverEvent[] };

    if (p.type === 'gps' || p.type === 'position') {
      result.gpsUpdates.push({
        vehicleId: p.vehicleId, busNumber: p.busNumber || '',
        latitude: p.latitude, longitude: p.longitude,
        speed: p.speedMph, heading: p.heading,
        timestamp: new Date(p.timestamp),
      });
    } else if (p.type === 'ridership' || p.type === 'rfid_scan') {
      result.rfidScans.push({
        studentCardId: p.cardId, vehicleId: p.vehicleId,
        busNumber: p.busNumber || '',
        scanType: p.action === 'board' ? 'BOARD' : 'EXIT',
        timestamp: new Date(p.timestamp),
        latitude: p.latitude, longitude: p.longitude,
      });
    } else if (p.type === 'safety_event' || p.type === 'camera_event') {
      result.driverEvents.push({
        vehicleId: p.vehicleId, busNumber: p.busNumber || '',
        eventType: mapSeonEvent(p.eventType),
        severity: p.priority === 'high' ? 'CRITICAL' : 'WARNING',
        timestamp: new Date(p.timestamp),
        latitude: p.latitude, longitude: p.longitude,
        description: p.description,
        mediaUrl: p.videoClipUrl,
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

function mapSeonEvent(type: string): DriverEvent['eventType'] {
  const map: Record<string, DriverEvent['eventType']> = {
    'hard_brake': 'HARSH_BRAKE', 'harsh_braking': 'HARSH_BRAKE',
    'speeding': 'SPEEDING', 'over_speed': 'SPEEDING',
    'panic': 'PANIC', 'sos': 'PANIC', 'driver_panic': 'PANIC',
    'stop_arm_violation': 'STOP_ARM_VIOLATION', 'stop_arm': 'STOP_ARM_VIOLATION',
    'route_deviation': 'ROUTE_DEVIATION',
    'geofence_entry': 'GEOFENCE_ENTRY', 'geofence_exit': 'GEOFENCE_EXIT',
    'camera_alert': 'CAMERA_ALERT', 'video_event': 'CAMERA_ALERT',
  };
  return map[type?.toLowerCase()] || 'CAMERA_ALERT';
}
