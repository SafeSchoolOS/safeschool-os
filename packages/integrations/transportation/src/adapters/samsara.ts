/**
 * Samsara — Fleet GPS + Driver Safety Cameras
 *
 * Well-documented REST API: https://developers.samsara.com
 * - Base URL: https://api.samsara.com
 * - Auth: Bearer token
 * - GPS: /fleet/vehicles/stats (snapshot), /fleet/vehicles/stats/feed (near-real-time)
 * - Webhooks 2.0: RouteStopArrival, GeofenceEntry/Exit, VehicleCreated
 * - Camera: AI dash cams with event clips
 *
 * K-12 features: real-time bus locations, parent ETAs, embeddable live sharing links
 */

import type {
  BusFleetAdapter,
  BusFleetAdapterConfig,
  GpsUpdate,
  RfidScanEvent,
  DriverEvent,
  VehicleHealth,
} from './types.js';

export class SamsaraAdapter implements BusFleetAdapter {
  readonly name = 'Samsara';
  private config!: BusFleetAdapterConfig;
  private baseUrl = 'https://api.samsara.com';
  private headers: Record<string, string> = {};

  async connect(config: BusFleetAdapterConfig): Promise<void> {
    this.config = config;
    if (config.apiUrl) this.baseUrl = config.apiUrl;
    this.headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
    console.log(`[Samsara] Connected to ${this.baseUrl}`);
  }

  async disconnect(): Promise<void> {
    console.log('[Samsara] Disconnected');
  }

  async getVehicleLocations(): Promise<GpsUpdate[]> {
    // Use /fleet/vehicles/stats endpoint with types=gps for current positions
    const res = await fetch(`${this.baseUrl}/fleet/vehicles/stats?types=gps`, { headers: this.headers });
    if (!res.ok) throw new Error(`Samsara GPS fetch failed: ${res.status}`);
    const data = await res.json() as any;

    return (data.data || []).map((v: any) => {
      const gps = v.gps?.[0] || {};
      return {
        vehicleId: v.id,
        busNumber: v.name || '',
        latitude: gps.latitude,
        longitude: gps.longitude,
        speed: gps.speedMilesPerHour,
        heading: gps.headingDegrees,
        timestamp: new Date(gps.time || Date.now()),
        odometer: gps.odometerMeters ? gps.odometerMeters / 1609.34 : undefined,
        engineOn: v.engineState?.[0]?.value === 'On',
        metadata: { source: 'samsara', vin: v.vin, externalIds: v.externalIds },
      };
    });
  }

  async getVehicleHistory(vehicleId: string, from: Date, to: Date): Promise<GpsUpdate[]> {
    const params = new URLSearchParams({
      types: 'gps',
      vehicleIds: vehicleId,
      startTime: from.toISOString(),
      endTime: to.toISOString(),
    });
    const res = await fetch(`${this.baseUrl}/fleet/vehicles/stats/history?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any;

    return (data.data?.[0]?.gps || []).map((p: any) => ({
      vehicleId,
      busNumber: '',
      latitude: p.latitude,
      longitude: p.longitude,
      speed: p.speedMilesPerHour,
      heading: p.headingDegrees,
      timestamp: new Date(p.time),
      metadata: { source: 'samsara' },
    }));
  }

  async getRfidScans(_since: Date): Promise<RfidScanEvent[]> {
    // Samsara doesn't natively support RFID student scanning
    // RFID events come from separate hardware (ZPass, etc.) integrated via webhook
    return [];
  }

  async getDriverEvents(since: Date): Promise<DriverEvent[]> {
    const params = new URLSearchParams({
      startTime: since.toISOString(),
      endTime: new Date().toISOString(),
    });
    const res = await fetch(`${this.baseUrl}/fleet/safety/events?${params}`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any;

    return (data.data || []).map((e: any) => ({
      vehicleId: e.vehicle?.id || '',
      busNumber: e.vehicle?.name || '',
      eventType: mapSamsaraEvent(e.behaviorLabel),
      severity: e.severity === 'critical' ? 'CRITICAL' as const : 'WARNING' as const,
      timestamp: new Date(e.time),
      latitude: e.location?.latitude,
      longitude: e.location?.longitude,
      description: e.behaviorLabel,
      mediaUrl: e.downloadForwardVideoUrl || e.downloadInwardVideoUrl,
      metadata: { source: 'samsara', coachable: e.isCoachable },
    }));
  }

  async getVehicleHealth(vehicleId: string): Promise<VehicleHealth | null> {
    const res = await fetch(`${this.baseUrl}/fleet/vehicles/stats?types=engineState,fuelPercent,batteryMilliVolts&vehicleIds=${vehicleId}`, { headers: this.headers });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const v = data.data?.[0];
    if (!v) return null;

    return {
      vehicleId,
      busNumber: v.name || '',
      engineStatus: v.engineState?.[0]?.value === 'On' ? 'ON' : 'OFF',
      fuelLevel: v.fuelPercent?.[0]?.value,
      batteryVoltage: v.batteryMilliVolts?.[0]?.value ? v.batteryMilliVolts[0].value / 1000 : undefined,
      dtcCodes: v.faultCodes?.map((f: any) => f.fmiDescription) || [],
    };
  }

  parseWebhook(body: unknown): { gpsUpdates: GpsUpdate[]; rfidScans: RfidScanEvent[]; driverEvents: DriverEvent[] } {
    const payload = body as any;
    const result = { gpsUpdates: [] as GpsUpdate[], rfidScans: [] as RfidScanEvent[], driverEvents: [] as DriverEvent[] };

    const eventType = payload.eventType || payload.type;

    if (eventType === 'VehicleGps' || eventType === 'GeofenceEntry' || eventType === 'GeofenceExit') {
      const v = payload.data?.vehicle || payload.vehicle || {};
      const loc = payload.data?.location || v.gps || {};
      result.gpsUpdates.push({
        vehicleId: v.id || '',
        busNumber: v.name || '',
        latitude: loc.latitude,
        longitude: loc.longitude,
        speed: loc.speedMilesPerHour,
        heading: loc.headingDegrees,
        timestamp: new Date(payload.time || Date.now()),
      });

      if (eventType === 'GeofenceEntry' || eventType === 'GeofenceExit') {
        result.driverEvents.push({
          vehicleId: v.id || '',
          busNumber: v.name || '',
          eventType: eventType === 'GeofenceEntry' ? 'GEOFENCE_ENTRY' : 'GEOFENCE_EXIT',
          severity: 'INFO',
          timestamp: new Date(payload.time || Date.now()),
          latitude: loc.latitude,
          longitude: loc.longitude,
          description: `Geofence: ${payload.data?.geofence?.name || 'unknown'}`,
        });
      }
    } else if (eventType === 'SafetyEvent') {
      const e = payload.data || payload;
      result.driverEvents.push({
        vehicleId: e.vehicle?.id || '',
        busNumber: e.vehicle?.name || '',
        eventType: mapSamsaraEvent(e.behaviorLabel),
        severity: 'WARNING',
        timestamp: new Date(e.time || Date.now()),
        description: e.behaviorLabel,
        mediaUrl: e.downloadForwardVideoUrl,
      });
    }

    return result;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/fleet/vehicles?limit=1`, { headers: this.headers });
      return res.ok;
    } catch { return false; }
  }
}

function mapSamsaraEvent(label: string): DriverEvent['eventType'] {
  const l = (label || '').toLowerCase();
  if (l.includes('harsh') || l.includes('brake')) return 'HARSH_BRAKE';
  if (l.includes('speed')) return 'SPEEDING';
  if (l.includes('panic') || l.includes('sos')) return 'PANIC';
  if (l.includes('stop arm') || l.includes('stop-arm')) return 'STOP_ARM_VIOLATION';
  if (l.includes('route') || l.includes('deviation')) return 'ROUTE_DEVIATION';
  return 'CAMERA_ALERT';
}
