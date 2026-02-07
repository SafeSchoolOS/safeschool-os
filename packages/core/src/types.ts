// SafeSchool Core Types

// ============================================================================
// Alert Types
// ============================================================================

export enum AlertLevel {
  MEDICAL = 'MEDICAL',
  LOCKDOWN = 'LOCKDOWN',
  ACTIVE_THREAT = 'ACTIVE_THREAT',
  FIRE = 'FIRE',
  WEATHER = 'WEATHER',
  ALL_CLEAR = 'ALL_CLEAR',
  CUSTOM = 'CUSTOM',
}

export enum AlertStatus {
  TRIGGERED = 'TRIGGERED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  DISPATCHED = 'DISPATCHED',
  RESPONDING = 'RESPONDING',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED',
}

export enum AlertSource {
  WEARABLE = 'WEARABLE',
  MOBILE_APP = 'MOBILE_APP',
  WALL_STATION = 'WALL_STATION',
  DASHBOARD = 'DASHBOARD',
  AUTOMATED = 'AUTOMATED', // From threat detection, gunshot sensor, etc.
}

export interface Alert {
  id: string;
  siteId: string;
  level: AlertLevel;
  status: AlertStatus;
  source: AlertSource;
  triggeredBy: string; // User ID
  triggeredAt: Date;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  location: AlertLocation;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface AlertLocation {
  buildingId: string;
  buildingName: string;
  floor?: number;
  room?: string;
  zone?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number; // meters
}

// ============================================================================
// Site & Building Types
// ============================================================================

export interface Site {
  id: string;
  name: string;
  district: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  buildings: Building[];
  timezone: string;
}

export interface Building {
  id: string;
  siteId: string;
  name: string;
  floors: number;
  rooms: Room[];
  floorPlanUrl?: string;
}

export interface Room {
  id: string;
  buildingId: string;
  name: string;
  number: string;
  floor: number;
  type: 'CLASSROOM' | 'OFFICE' | 'GYM' | 'CAFETERIA' | 'HALLWAY' | 'ENTRANCE' | 'OTHER';
  capacity?: number;
  bleBeaconId?: string; // For location tracking
}

// ============================================================================
// User & Role Types
// ============================================================================

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',       // District-wide admin
  SITE_ADMIN = 'SITE_ADMIN',         // School principal/admin
  OPERATOR = 'OPERATOR',             // Safety team/front desk
  TEACHER = 'TEACHER',               // Teacher/faculty with wearable
  FIRST_RESPONDER = 'FIRST_RESPONDER', // Police/fire with read access
  PARENT = 'PARENT',                 // Parent (notifications only)
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  siteIds: string[];   // Sites they have access to
  phone?: string;
  wearableDeviceId?: string;
  isActive: boolean;
}

// ============================================================================
// Access Control Types
// ============================================================================

export enum DoorStatus {
  LOCKED = 'LOCKED',
  UNLOCKED = 'UNLOCKED',
  OPEN = 'OPEN',
  FORCED = 'FORCED',      // Door forced open
  HELD = 'HELD',          // Door held open too long
  UNKNOWN = 'UNKNOWN',
}

export enum LockdownScope {
  FULL_SITE = 'FULL_SITE',
  BUILDING = 'BUILDING',
  FLOOR = 'FLOOR',
  ZONE = 'ZONE',
}

export interface Door {
  id: string;
  name: string;
  buildingId: string;
  floor: number;
  zone?: string;
  status: DoorStatus;
  controllerType: string; // genetec, lenels2, brivo, etc.
  controllerId: string;
  isExterior: boolean;
  isEmergencyExit: boolean;
}

export interface LockdownCommand {
  id: string;
  siteId: string;
  scope: LockdownScope;
  targetId: string; // site/building/floor/zone ID depending on scope
  initiatedBy: string;
  initiatedAt: Date;
  releasedAt?: Date;
  alertId?: string; // Associated alert
}

// ============================================================================
// Visitor Management Types
// ============================================================================

export enum VisitorStatus {
  PRE_REGISTERED = 'PRE_REGISTERED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  DENIED = 'DENIED',
  FLAGGED = 'FLAGGED',
}

export interface Visitor {
  id: string;
  siteId: string;
  firstName: string;
  lastName: string;
  photo?: string;
  idType?: string;         // Driver's license, passport, etc.
  idNumber?: string;        // Hashed/encrypted
  purpose: string;
  destination: string;      // Room/person visiting
  hostUserId?: string;      // Staff member being visited
  status: VisitorStatus;
  checkedInAt?: Date;
  checkedOutAt?: Date;
  badgeNumber?: string;
  screeningResult?: ScreeningResult;
}

export interface ScreeningResult {
  sexOffenderCheck: 'CLEAR' | 'FLAGGED' | 'ERROR';
  watchlistCheck: 'CLEAR' | 'FLAGGED' | 'ERROR';
  customCheck?: 'CLEAR' | 'FLAGGED' | 'ERROR';
  checkedAt: Date;
}

// ============================================================================
// Dispatch / 911 Types
// ============================================================================

export enum DispatchMethod {
  RAPIDSОС = 'RAPIDSОС',
  RAVE_911 = 'RAVE_911',
  SIP_DIRECT = 'SIP_DIRECT',
  CELLULAR = 'CELLULAR',
}

export enum DispatchStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  RECEIVED = 'RECEIVED',
  DISPATCHED = 'DISPATCHED',
  ON_SCENE = 'ON_SCENE',
  FAILED = 'FAILED',
}

export interface DispatchRecord {
  id: string;
  alertId: string;
  method: DispatchMethod;
  status: DispatchStatus;
  sentAt: Date;
  confirmedAt?: Date;
  failoverUsed: boolean;
  failoverMethod?: DispatchMethod;
  responseTimeMs?: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Sync / Edge Types
// ============================================================================

export enum SyncDirection {
  CLOUD_TO_EDGE = 'CLOUD_TO_EDGE',
  EDGE_TO_CLOUD = 'EDGE_TO_CLOUD',
  BIDIRECTIONAL = 'BIDIRECTIONAL',
}

export enum OperatingMode {
  CLOUD = 'CLOUD',           // Running on Railway
  EDGE = 'EDGE',             // Running on on-site mini PC
  STANDALONE = 'STANDALONE',  // Edge running without cloud connectivity
}

export interface SyncState {
  siteId: string;
  lastSyncAt: Date;
  cloudReachable: boolean;
  operatingMode: OperatingMode;
  pendingChanges: number;
  lastError?: string;
}
