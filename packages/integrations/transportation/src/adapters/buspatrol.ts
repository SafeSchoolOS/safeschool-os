/**
 * BusPatrol — Stop-Arm Camera Enforcement + GPS Tracking
 *
 * BusPatrol provides:
 * - Automated stop-arm violation detection cameras
 * - License plate recognition for violations
 * - Real-time GPS tracking of bus fleet
 * - Safety analytics dashboard
 * - Integration with law enforcement for citation processing
 *
 * API: BusPatrol Safety Platform REST API
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

export class BusPatrolAdapter implements BusFleetAdapter {
  readonly name = 'BusPatrol';
  private config!: BusFleetAdapterConfig;
  private baseUrl = '';
  private headers: Record<string, string> = {};

  async connect(config: BusFleetAdapterConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.apiUrl || 'https://api.buspatrol.com/v1';
    this.headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-District-Id': config.orgId || '',
    };
    console.log(`[BusPatrol] Connected to ${this.baseUrl} (district: ${config.orgId})`);
  }

  async disconnect(): Promise<void> { console.log('[BusPatrol] Disconnected'); }

  async getVehicleLocations(): Promise<GpsUpdate[]> {
    const res = await fetch(`${this.baseUrl}/fleet/positions`, { headers: this.headers });
    if (!res.ok) throw new Error(`BusPatrol GPS fetch failed: ${res.status}`);
    const data = await res.json() as any;

    return (data.buses || data.vehicles || []).map((v: any) => ({
      vehicleId: v.busId || v.vehicleId || v.id,
      busNumber: v.busNumber || v.unitNumber || '',
      latitude: v.latitude ?? v.lat,
      longitude: v.longitude ?? v.lng,
      speed: v.speedMph ?? v.speed,
      heading: v.heading ?? v.bearing,
      timestamp: new Date(v.lastUpdate || v.timestamp),
      engineOn: v.ignition === true,
      metadata: {
        source: 'buspatrol',
        stopArmStatus: v.stopArmStatus,
        lightsActive: v.lightsActive,
      },
    }));
  }

  async getVehicleHistory(vehicleId: string, from: Date, to: Date): Promise<GpsUpdate[]> {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const res = await fetch(`${this.baseUrl}/fleet/${vehicleId}/trail?${params}`, { headers: this.headers });
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
      metadata: { source: 'buspatrol' },
    }));
  }

  async getRfidScans(_since: Date): Promise<RfidScanEvent[]> {
    // BusPatrol focuses on stop-arm cameras, not student RFID scanning
    return [];
  }

  async getDriverEvents(since: Date): Promise<DriverEvent[]> {
    const params = new URLSearchParams({ since: since.toISOString() });
    const res = await fetch(`${this.baseUrl}/safety/events?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any;

    return (data.events || data.data || []).map((e: any) => ({
      vehicleId: e.busId || e.vehicleId,
      busNumber: e.busNumber || '',
      eventType: mapBusPatrolEvent(e.eventType || e.type),
      severity: e.eventType === 'stop_arm_violation' ? 'CRITICAL' as const : 'WARNING' as const,
      timestamp: new Date(e.timestamp || e.eventTime),
      latitude: e.latitude,
      longitude: e.longitude,
      description: e.description || formatViolation(e),
      mediaUrl: e.videoUrl || e.imageUrl,
      metadata: {
        source: 'buspatrol',
        licensePlate: e.licensePlate,
        violationId: e.violationId,
        citationIssued: e.citationIssued,
      },
    }));
  }

  async getVehicleHealth(vehicleId: string): Promise<VehicleHealth | null> {
    const res = await fetch(`${this.baseUrl}/fleet/${vehicleId}/status`, { headers: this.headers });
    if (!res.ok) return null;
    const d = await res.json() as any;
    return {
      vehicleId,
      busNumber: d.busNumber || '',
      engineStatus: d.engineOn ? 'ON' : 'OFF',
      fuelLevel: d.fuelPercent,
      batteryVoltage: d.batteryVoltage,
      odometerMiles: d.odometerMiles,
      dtcCodes: d.diagnosticCodes || [],
    };
  }

  parseWebhook(body: unknown): { gpsUpdates: GpsUpdate[]; rfidScans: RfidScanEvent[]; driverEvents: DriverEvent[] } {
    const p = body as any;
    const result = { gpsUpdates: [] as GpsUpdate[], rfidScans: [] as RfidScanEvent[], driverEvents: [] as DriverEvent[] };

    if (p.type === 'gps' || p.type === 'position_update') {
      result.gpsUpdates.push({
        vehicleId: p.busId || p.vehicleId, busNumber: p.busNumber || '',
        latitude: p.latitude, longitude: p.longitude,
        speed: p.speedMph, heading: p.heading,
        timestamp: new Date(p.timestamp),
      });
    } else if (p.type === 'stop_arm_violation' || p.type === 'violation') {
      result.driverEvents.push({
        vehicleId: p.busId || p.vehicleId, busNumber: p.busNumber || '',
        eventType: 'STOP_ARM_VIOLATION',
        severity: 'CRITICAL',
        timestamp: new Date(p.timestamp),
        latitude: p.latitude, longitude: p.longitude,
        description: `Stop-arm violation: ${p.licensePlate || 'unknown plate'}`,
        mediaUrl: p.videoUrl || p.imageUrl,
        metadata: { source: 'buspatrol', licensePlate: p.licensePlate, violationId: p.violationId },
      });
    } else if (p.type === 'safety_event') {
      result.driverEvents.push({
        vehicleId: p.busId || p.vehicleId, busNumber: p.busNumber || '',
        eventType: mapBusPatrolEvent(p.eventType),
        severity: 'WARNING',
        timestamp: new Date(p.timestamp),
        latitude: p.latitude, longitude: p.longitude,
        description: p.description,
        mediaUrl: p.videoUrl,
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

function mapBusPatrolEvent(type: string): DriverEvent['eventType'] {
  const map: Record<string, DriverEvent['eventType']> = {
    'stop_arm_violation': 'STOP_ARM_VIOLATION',
    'violation': 'STOP_ARM_VIOLATION',
    'speeding': 'SPEEDING',
    'hard_brake': 'HARSH_BRAKE',
    'panic': 'PANIC',
    'route_deviation': 'ROUTE_DEVIATION',
    'geofence_entry': 'GEOFENCE_ENTRY',
    'geofence_exit': 'GEOFENCE_EXIT',
  };
  return map[type?.toLowerCase()] || 'CAMERA_ALERT';
}

function formatViolation(e: any): string {
  const parts = ['Stop-arm violation'];
  if (e.licensePlate) parts.push(`plate: ${e.licensePlate}`);
  if (e.vehicleDescription) parts.push(e.vehicleDescription);
  return parts.join(' — ');
}
