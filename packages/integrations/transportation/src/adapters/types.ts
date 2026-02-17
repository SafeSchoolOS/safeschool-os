/**
 * Bus Fleet Adapter Interface
 *
 * All school bus GPS/RFID tracking systems implement this interface
 * to normalize data into SafeSchool's transport pipeline.
 */

export interface GpsUpdate {
  vehicleId: string;        // External system's vehicle ID
  busNumber: string;        // Human-readable bus number
  latitude: number;
  longitude: number;
  speed?: number;           // mph
  heading?: number;         // degrees 0-360
  timestamp: Date;
  odometer?: number;        // miles
  engineOn?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RfidScanEvent {
  studentCardId: string;    // RFID card ID
  vehicleId: string;        // External vehicle ID
  busNumber: string;
  scanType: 'BOARD' | 'EXIT';
  timestamp: Date;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, unknown>;
}

export interface DriverEvent {
  vehicleId: string;
  busNumber: string;
  eventType: 'PANIC' | 'STOP_ARM_VIOLATION' | 'HARSH_BRAKE' | 'SPEEDING' | 'ROUTE_DEVIATION' | 'CAMERA_ALERT' | 'GEOFENCE_ENTRY' | 'GEOFENCE_EXIT';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  timestamp: Date;
  latitude?: number;
  longitude?: number;
  description?: string;
  mediaUrl?: string;        // Camera snapshot / video clip URL
  metadata?: Record<string, unknown>;
}

export interface VehicleHealth {
  vehicleId: string;
  busNumber: string;
  engineStatus: 'ON' | 'OFF' | 'FAULT';
  fuelLevel?: number;       // percentage 0-100
  batteryVoltage?: number;  // volts
  odometerMiles?: number;
  dtcCodes?: string[];      // Diagnostic trouble codes
  lastInspection?: Date;
  nextMaintenanceDue?: Date;
}

export interface BusFleetAdapterConfig {
  apiUrl: string;
  apiKey?: string;
  apiSecret?: string;
  orgId?: string;           // Organization/fleet ID
  pollingIntervalMs?: number;
  webhookSecret?: string;
}

/**
 * Common interface for all school bus fleet tracking systems.
 * Each vendor adapter normalizes their data into these standard methods.
 */
export interface BusFleetAdapter {
  /** Adapter display name */
  readonly name: string;

  /** Initialize connection to the fleet system */
  connect(config: BusFleetAdapterConfig): Promise<void>;

  /** Disconnect / cleanup */
  disconnect(): Promise<void>;

  /** Fetch current GPS positions for all active vehicles */
  getVehicleLocations(): Promise<GpsUpdate[]>;

  /** Fetch GPS history for a specific vehicle within a time range */
  getVehicleHistory(vehicleId: string, from: Date, to: Date): Promise<GpsUpdate[]>;

  /** Poll for new RFID scan events since a given timestamp */
  getRfidScans(since: Date): Promise<RfidScanEvent[]>;

  /** Poll for driver/safety events since a given timestamp */
  getDriverEvents(since: Date): Promise<DriverEvent[]>;

  /** Get vehicle health/diagnostics */
  getVehicleHealth(vehicleId: string): Promise<VehicleHealth | null>;

  /** Parse an incoming webhook payload into normalized events */
  parseWebhook(body: unknown, headers?: Record<string, string>): {
    gpsUpdates: GpsUpdate[];
    rfidScans: RfidScanEvent[];
    driverEvents: DriverEvent[];
  };

  /** Health check — is the connection to the fleet system alive? */
  healthCheck(): Promise<boolean>;
}
