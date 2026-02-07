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

// ============================================================================
// Student Transportation & Tracking Types
// ============================================================================

export enum StudentTransportStatus {
  WAITING_AT_STOP = 'WAITING_AT_STOP',
  BOARDED = 'BOARDED',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED_AT_SCHOOL = 'ARRIVED_AT_SCHOOL',
  DEPARTED_SCHOOL = 'DEPARTED_SCHOOL',
  EXITED_AT_STOP = 'EXITED_AT_STOP',
  MISSED_BUS = 'MISSED_BUS',
  ABSENT = 'ABSENT',
}

export enum TransportNotificationType {
  STUDENT_BOARDED = 'STUDENT_BOARDED',
  STUDENT_EXITED = 'STUDENT_EXITED',
  BUS_APPROACHING_STOP = 'BUS_APPROACHING_STOP',
  BUS_ARRIVED_AT_SCHOOL = 'BUS_ARRIVED_AT_SCHOOL',
  BUS_DEPARTED_SCHOOL = 'BUS_DEPARTED_SCHOOL',
  BUS_DELAY = 'BUS_DELAY',
  MISSED_BUS = 'MISSED_BUS',
  ROUTE_DEVIATION = 'ROUTE_DEVIATION',
  DRIVER_PANIC = 'DRIVER_PANIC',
}

export interface Bus {
  id: string;
  siteId: string;
  busNumber: string;
  routeId: string;
  driverId?: string;
  capacity: number;
  currentLocation?: GpsPosition;
  currentStudentCount: number;
  isActive: boolean;
  hasRfidReader: boolean;
  hasPanicButton: boolean;
  hasCameras: boolean;
}

export interface BusRoute {
  id: string;
  siteId: string;
  name: string;
  routeNumber: string;
  stops: BusStop[];
  scheduledDepartureTime: string; // HH:MM format
  scheduledArrivalTime: string;
  isAmRoute: boolean;
  isPmRoute: boolean;
}

export interface BusStop {
  id: string;
  routeId: string;
  name: string;
  address: string;
  location: GpsPosition;
  scheduledTime: string; // HH:MM format
  stopOrder: number;
  studentIds: string[]; // Students assigned to this stop
}

export interface GpsPosition {
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number; // mph
  heading?: number; // degrees
  timestamp: Date;
}

export interface StudentRidership {
  id: string;
  studentId: string;
  studentName: string;
  busId: string;
  routeId: string;
  stopId: string;
  scanType: 'BOARD' | 'EXIT';
  scannedAt: Date;
  scanMethod: 'RFID' | 'NFC' | 'BARCODE' | 'MANUAL';
  cardId?: string;
}

export interface TransportNotification {
  id: string;
  type: TransportNotificationType;
  studentId: string;
  parentContactIds: string[]; // Parent user IDs to notify
  busId: string;
  routeId: string;
  message: string;
  sentVia: ('SMS' | 'EMAIL' | 'PUSH')[];
  sentAt: Date;
  metadata?: {
    busNumber?: string;
    stopName?: string;
    eta?: string;
    delayMinutes?: number;
  };
}

export interface ParentContact {
  id: string;
  studentId: string;
  parentName: string;
  relationship: 'MOTHER' | 'FATHER' | 'GUARDIAN' | 'EMERGENCY_CONTACT' | 'OTHER';
  phone?: string;
  email?: string;
  pushToken?: string; // FCM token for push notifications
  notificationPreferences: {
    boardAlerts: boolean;
    exitAlerts: boolean;
    etaAlerts: boolean;
    delayAlerts: boolean;
    missedBusAlerts: boolean;
    smsEnabled: boolean;
    emailEnabled: boolean;
    pushEnabled: boolean;
  };
}

// ============================================================================
// Grant & Funding Types
// ============================================================================

export enum GrantStatus {
  IDENTIFIED = 'IDENTIFIED',       // Found, not yet applied
  PREPARING = 'PREPARING',         // Application in progress
  SUBMITTED = 'SUBMITTED',         // Application submitted
  UNDER_REVIEW = 'UNDER_REVIEW',
  AWARDED = 'AWARDED',
  DENIED = 'DENIED',
  ACTIVE = 'ACTIVE',              // Funding received and being used
  REPORTING = 'REPORTING',        // Compliance reporting period
  CLOSED = 'CLOSED',
}

export enum GrantSource {
  FEDERAL = 'FEDERAL',
  STATE = 'STATE',
  LOCAL = 'LOCAL',
  PRIVATE_FOUNDATION = 'PRIVATE_FOUNDATION',
  CORPORATE = 'CORPORATE',
}

export interface Grant {
  id: string;
  name: string;
  source: GrantSource;
  agency: string;             // e.g., "DOJ/BJA", "NJ DOE", "Sandy Hook Promise"
  programName: string;        // e.g., "STOP School Violence Prevention Program"
  description: string;
  fundingAmount: {
    min?: number;
    max?: number;
    typical?: number;
  };
  eligibility: {
    schoolTypes: ('PUBLIC' | 'CHARTER' | 'PRIVATE' | 'PAROCHIAL')[];
    states?: string[];        // Empty = all states
    requirements: string[];
    matchRequired: boolean;
    matchPercentage?: number;
  };
  timeline: {
    applicationOpens?: Date;
    applicationDeadline?: Date;
    awardAnnouncement?: Date;
    performancePeriodStart?: Date;
    performancePeriodEnd?: Date;
    reportingDeadlines?: Date[];
  };
  allowedExpenses: string[];   // e.g., "panic alarm systems", "access control", "training"
  url?: string;
  status: GrantStatus;
}

export interface GrantApplication {
  id: string;
  grantId: string;
  districtId: string;
  siteIds: string[];            // Schools covered by this application
  status: GrantStatus;
  submittedAt?: Date;
  awardedAmount?: number;
  requestedAmount: number;
  budgetItems: GrantBudgetItem[];
  notes: string;
  documents: GrantDocument[];
}

export interface GrantBudgetItem {
  id: string;
  applicationId: string;
  category: string;             // e.g., "Equipment", "Installation", "Training"
  description: string;          // e.g., "Sicunet access control - 30 doors"
  amount: number;
  safeschoolModule?: string;    // Map to SafeSchool module
}

export interface GrantDocument {
  id: string;
  applicationId: string;
  name: string;
  type: 'APPLICATION' | 'BUDGET' | 'NARRATIVE' | 'COMPLIANCE_REPORT' | 'RECEIPT' | 'OTHER';
  fileUrl: string;
  uploadedAt: Date;
}

// ============================================================================
// Access Control Adapter Types (Vendor-Agnostic Interface)
// ============================================================================

export interface AccessControlAdapter {
  name: string;
  vendor: string;
  connect(config: AccessControlConfig): Promise<void>;
  disconnect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  lockDoor(doorId: string): Promise<DoorCommandResult>;
  unlockDoor(doorId: string): Promise<DoorCommandResult>;
  lockdownBuilding(buildingId: string): Promise<LockdownResult>;
  lockdownZone(zoneId: string): Promise<LockdownResult>;
  releaseLockdown(lockdownId: string): Promise<LockdownResult>;
  getDoorStatus(doorId: string): Promise<DoorStatus>;
  getAllDoorStatuses(): Promise<Map<string, DoorStatus>>;
  onDoorEvent(callback: (event: DoorEvent) => void): void;
}

export interface AccessControlConfig {
  apiUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
  siteId?: string;
  options?: Record<string, unknown>;
}

export interface DoorCommandResult {
  success: boolean;
  doorId: string;
  newStatus: DoorStatus;
  executionTimeMs: number;
  error?: string;
}

export interface LockdownResult {
  lockdownId: string;
  status: 'INITIATED' | 'IN_PROGRESS' | 'COMPLETE' | 'PARTIAL_FAILURE';
  doorsLocked: number;
  doorsFailed: { doorId: string; doorName: string; reason: string }[];
  timeToCompleteMs: number;
  timestamp: Date;
}

export interface DoorEvent {
  doorId: string;
  doorName: string;
  eventType: 'OPENED' | 'CLOSED' | 'LOCKED' | 'UNLOCKED' | 'FORCED' | 'HELD' | 'ALARM';
  timestamp: Date;
  userId?: string;
  credentialType?: string;
}
