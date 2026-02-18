# SafeSchoolOS — First Responder Support Module

## Feature Specification v1.0

**Project:** SafeSchoolOS (open source school safety platform)
**Module:** First Responder Support
**Author:** Bruce (QA Engineering / Product)
**Date:** February 2026
**Stack:** React/Next.js frontend, Node.js API (Express), PostgreSQL, BLE Mesh Gateway (on-premise), Railway hosting

---

## 1. Overview

### 1.1 Purpose

Add a dedicated First Responder Portal and supporting services to SafeSchoolOS that give law enforcement, fire, and EMS real-time access to school safety data before, during, and after emergencies. This module transforms SafeSchoolOS from a school-facing platform into a two-sided system connecting schools with the agencies that protect them.

### 1.2 Motivation — Alyssa's Law Compliance

Multiple states now require that school security data (cameras, maps, access control, door status) be accessible to local law enforcement with coordinated access protocols. Washington requires remote door control and live video/audio feeds. Georgia requires accurate facility mapping data accessible to first responders. Utah requires security cameras accessible to law enforcement. This module fulfills those mandates.

### 1.3 Module Boundaries

This spec covers:

- First Responder Portal (web app — pre-incident, active incident, post-incident modes)
- Dispatch Integration Service (RapidSOS, CAP, SIP/VoIP 911)
- Pre-Shared Data Package (floor plans, door maps, facility data for agencies)
- Reunification Coordination Module (parent notification, student accountability, guardian check-in)
- Anonymous Tip Reporting (text-to-tip, web form, mobile, routing/escalation)
- First Responder API (read-only + controlled write for door commands)

This spec does NOT cover:

- Core access control service (existing)
- Core panic alert / BLE mesh (existing)
- BadgeKiosk integration API (commercial plugin, separate spec)
- BadgeGuard analytics API (commercial plugin, separate spec)

### 1.4 Integration Points with Existing Services

```
Existing SafeSchoolOS Services:
├── Access Control Service    → provides door status, lock/unlock commands
├── Emergency Response Service → provides panic alert events, incident state
├── Visitor Management Service → provides active visitor list
├── Location Service (BLE)    → provides staff location from panic button RSSI
├── Notification Service      → provides 911/PSAP alert dispatch
├── Device Management Service → provides device health, camera registry

New Services (this spec):
├── First Responder Portal Service
├── Dispatch Integration Service
├── Reunification Service
└── Tip Reporting Service
```

### 1.5 On-Premise Gateway Redundancy

SafeSchoolOS is a life-safety system. If the on-premise gateway goes down during an emergency, doors don't lock, panic alerts don't fire, and cameras don't surface. A single gateway is a single point of failure that is unacceptable for a system people depend on to protect children.

Schools can deploy two SafeSchoolOS gateway servers on-site. These gateways operate in one of two modes depending on the school's needs and budget:

#### Mode 1: Active-Active (Recommended)

Both gateways run simultaneously, sharing the workload and providing instant failover.

```
                         ┌─────────────────────────┐
                         │   SafeSchool Cloud       │
                         │   (Railway)              │
                         └────────┬────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │      School Network        │
                    │                            │
              ┌─────┴──────┐          ┌─────────┴────┐
              │ Gateway A   │◄────────►│ Gateway B     │
              │ (PRIMARY)   │ heartbeat│ (PRIMARY)     │
              │             │ + sync   │               │
              │ Handles:    │          │ Handles:      │
              │ Bldg 1 doors│          │ Bldg 2 doors  │
              │ Cameras 1-20│          │ Cameras 21-40 │
              │ BLE mesh    │          │ BLE mesh      │
              │ zone A      │          │ zone B        │
              └──────┬──────┘          └──────┬───────┘
                     │                        │
              ┌──────┴────────────────────────┴───────┐
              │         BLE Mesh / Device Layer        │
              │  Doors, Readers, Panic Buttons,        │
              │  Cameras, Intercoms                    │
              └────────────────────────────────────────┘

  If Gateway A fails:
  → Gateway B detects missing heartbeat within 5 seconds
  → Gateway B assumes ALL devices (both buildings)
  → Cloud notified of failover event
  → Alert sent to school admin + IT
  → When Gateway A recovers, devices rebalance automatically
```

In Active-Active mode, each gateway owns a subset of devices (by building, floor, zone, or device type). Both gateways maintain a full copy of the device registry and configuration so either can assume the other's workload instantly. They exchange heartbeats every 2 seconds over the local network and synchronize state (door status, active incidents, pending commands) via a local replication channel.

#### Mode 2: Active-Passive (Failover)

One gateway handles everything. The second sits idle but hot, ready to take over.

```
              ┌──────────────┐          ┌──────────────┐
              │ Gateway A     │◄────────►│ Gateway B     │
              │ (ACTIVE)      │ heartbeat│ (STANDBY)     │
              │               │ + sync   │               │
              │ Handles ALL:  │          │ Monitors:     │
              │ All doors     │          │ Replicates    │
              │ All cameras   │          │ config + state│
              │ All BLE mesh  │          │ Ready to      │
              │ All services  │          │ assume all    │
              └──────┬────────┘          └───────────────┘
                     │
              ┌──────┴────────────────────────────────┐
              │         BLE Mesh / Device Layer        │
              └────────────────────────────────────────┘

  If Gateway A fails:
  → Gateway B detects missing heartbeat within 5 seconds
  → Gateway B transitions from STANDBY to ACTIVE
  → Gateway B assumes ALL devices
  → Same recovery process as Active-Active
```

Active-Passive is simpler and cheaper (the standby box can be lower-spec hardware). The tradeoff is that failover takes slightly longer (5-10 seconds vs. near-instant for Active-Active) because the standby gateway must initialize device connections it wasn't actively managing.

#### Why This Matters for First Responders

During an active incident, the First Responder Portal connects to whichever gateway is serving data. If a gateway fails mid-incident:

- Door lock commands automatically route to the surviving gateway
- Camera feed proxies reconnect through the surviving gateway
- The incident timeline logs the failover event
- No manual intervention required by school staff or responders
- WebSocket connections to the cloud reconnect and resume pushing real-time data

#### Single Gateway Deployments

Schools that deploy only one gateway still work fine — there's no requirement for dual deployment. The system detects a single-gateway configuration and skips all clustering/replication logic. However, the admin dashboard should display a warning: "This school has a single gateway with no redundancy. Consider adding a second gateway for failover protection."

---

## 2. Data Models

### 2.1 Agency

Represents a law enforcement, fire, or EMS agency with access to the portal.

```typescript
interface Agency {
  id: string;               // UUID
  name: string;             // "Cranston Police Department"
  type: AgencyType;         // POLICE | FIRE | EMS | DISPATCH
  jurisdiction: string;     // "Cranston, RI"
  primaryContact: string;   // Name
  primaryPhone: string;
  primaryEmail: string;
  dispatchPhone: string;    // Non-emergency dispatch line
  psapId?: string;          // PSAP identifier for 911 integration
  rapidSosOrgId?: string;   // RapidSOS organization ID if enrolled
  status: AgencyStatus;     // ACTIVE | SUSPENDED | PENDING
  createdAt: Date;
  updatedAt: Date;
}

enum AgencyType {
  POLICE = 'POLICE',
  FIRE = 'FIRE',
  EMS = 'EMS',
  DISPATCH = 'DISPATCH'
}

enum AgencyStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING = 'PENDING'
}
```

### 2.2 ResponderUser

An individual first responder with portal access credentials.

```typescript
interface ResponderUser {
  id: string;               // UUID
  agencyId: string;         // FK to Agency
  badgeNumber?: string;     // Officer badge/ID number
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: ResponderRole;
  permissions: ResponderPermission[];
  mfaEnabled: boolean;
  lastLogin?: Date;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: Date;
  updatedAt: Date;
}

enum ResponderRole {
  DISPATCH = 'DISPATCH',       // View alerts, view data, no door control
  PATROL = 'PATROL',           // View data, limited door control during incidents
  COMMAND = 'COMMAND',         // Full access including door control
  ADMIN = 'ADMIN',             // Manage agency users
  INVESTIGATOR = 'INVESTIGATOR' // Post-incident access to logs and video bookmarks
}

enum ResponderPermission {
  VIEW_FLOOR_PLANS = 'VIEW_FLOOR_PLANS',
  VIEW_DOOR_STATUS = 'VIEW_DOOR_STATUS',
  VIEW_CAMERA_FEEDS = 'VIEW_CAMERA_FEEDS',
  CONTROL_DOORS = 'CONTROL_DOORS',
  VIEW_VISITOR_LIST = 'VIEW_VISITOR_LIST',
  VIEW_STUDENT_ACCOUNTABILITY = 'VIEW_STUDENT_ACCOUNTABILITY',
  VIEW_INCIDENT_LOGS = 'VIEW_INCIDENT_LOGS',
  EXPORT_DATA = 'EXPORT_DATA',
  COMMUNICATE_STAFF = 'COMMUNICATE_STAFF',
  VIEW_TIPS = 'VIEW_TIPS'
}
```

### 2.3 SchoolAgencyLink

Maps which agencies have access to which schools, with access level.

```typescript
interface SchoolAgencyLink {
  id: string;
  schoolId: string;          // FK to School (existing model)
  agencyId: string;          // FK to Agency
  accessLevel: AccessLevel;
  approvedBy: string;        // School admin user ID who approved
  approvedAt: Date;
  mou_signed: boolean;       // Memorandum of Understanding on file
  expiresAt?: Date;          // Annual renewal date
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  createdAt: Date;
}

enum AccessLevel {
  PRE_INCIDENT = 'PRE_INCIDENT',     // Floor plans, contacts, facility data only
  FULL_RESPONSE = 'FULL_RESPONSE',   // All data including live feeds and door control
  INVESTIGATION = 'INVESTIGATION'     // Post-incident data and exports only
}
```

### 2.4 Incident

Represents an active or historical emergency incident.

```typescript
interface Incident {
  id: string;               // UUID
  schoolId: string;
  type: IncidentType;
  status: IncidentStatus;
  severity: IncidentSeverity;
  triggeredBy: string;       // User ID of staff who activated panic alert
  triggeredAt: Date;
  triggerDeviceId: string;   // Panic button device ID
  triggerLocation: {
    buildingId: string;
    floor: number;
    room: string;
    coordinates?: { lat: number; lng: number };
    rssiData?: RSSIReading[];
  };
  respondingAgencies: string[];  // Agency IDs
  dispatchedAt?: Date;
  firstResponderArrival?: Date;
  allClearAt?: Date;
  reunificationStartedAt?: Date;
  reunificationCompletedAt?: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  notes: string;
  timeline: IncidentTimelineEntry[];
  createdAt: Date;
  updatedAt: Date;
}

enum IncidentType {
  ACTIVE_THREAT = 'ACTIVE_THREAT',
  LOCKDOWN = 'LOCKDOWN',
  MEDICAL = 'MEDICAL',
  FIRE = 'FIRE',
  HAZMAT = 'HAZMAT',
  WEATHER = 'WEATHER',
  INTRUDER = 'INTRUDER',
  BOMB_THREAT = 'BOMB_THREAT',
  OTHER = 'OTHER'
}

enum IncidentStatus {
  TRIGGERED = 'TRIGGERED',       // Panic alert activated
  DISPATCHED = 'DISPATCHED',     // 911/PSAP notified
  RESPONDING = 'RESPONDING',     // Officers en route
  ON_SCENE = 'ON_SCENE',         // Officers arrived
  LOCKDOWN_ACTIVE = 'LOCKDOWN_ACTIVE',
  ALL_CLEAR = 'ALL_CLEAR',       // Threat neutralized
  REUNIFICATION = 'REUNIFICATION', // Student release in progress
  RESOLVED = 'RESOLVED',         // Incident closed
  FALSE_ALARM = 'FALSE_ALARM'
}

enum IncidentSeverity {
  CRITICAL = 'CRITICAL',   // Active threat, immediate danger
  HIGH = 'HIGH',           // Lockdown, intruder
  MEDIUM = 'MEDIUM',       // Medical, weather shelter
  LOW = 'LOW'              // Drill, non-emergency
}

interface IncidentTimelineEntry {
  id: string;
  incidentId: string;
  timestamp: Date;
  action: string;           // Human-readable: "Panic alert activated by Jane Smith in Room 204"
  actionType: TimelineActionType;
  actorType: 'SYSTEM' | 'STAFF' | 'RESPONDER' | 'ADMIN';
  actorId?: string;
  metadata?: Record<string, any>;  // Door ID for lock events, camera ID for video events, etc.
}

enum TimelineActionType {
  PANIC_ACTIVATED = 'PANIC_ACTIVATED',
  DISPATCH_SENT = 'DISPATCH_SENT',
  DISPATCH_ACKNOWLEDGED = 'DISPATCH_ACKNOWLEDGED',
  LOCKDOWN_INITIATED = 'LOCKDOWN_INITIATED',
  DOOR_LOCKED = 'DOOR_LOCKED',
  DOOR_UNLOCKED = 'DOOR_UNLOCKED',
  DOOR_FORCED = 'DOOR_FORCED',
  CAMERA_ACCESSED = 'CAMERA_ACCESSED',
  RESPONDER_EN_ROUTE = 'RESPONDER_EN_ROUTE',
  RESPONDER_ON_SCENE = 'RESPONDER_ON_SCENE',
  NOTIFICATION_SENT = 'NOTIFICATION_SENT',
  ACCOUNTABILITY_UPDATE = 'ACCOUNTABILITY_UPDATE',
  ALL_CLEAR = 'ALL_CLEAR',
  REUNIFICATION_STARTED = 'REUNIFICATION_STARTED',
  STUDENT_RELEASED = 'STUDENT_RELEASED',
  INCIDENT_RESOLVED = 'INCIDENT_RESOLVED',
  NOTE_ADDED = 'NOTE_ADDED',
  MESSAGE_SENT = 'MESSAGE_SENT',
  MESSAGE_RECEIVED = 'MESSAGE_RECEIVED',
  FALSE_ALARM_DECLARED = 'FALSE_ALARM_DECLARED'
}
```

### 2.5 FloorPlan

Enhanced floor plan model for first responder consumption.

```typescript
interface FloorPlan {
  id: string;
  schoolId: string;
  buildingId: string;
  buildingName: string;
  floor: number;
  floorName: string;        // "First Floor", "Basement", "Second Floor"
  imageUrl: string;          // Floor plan image (PNG/SVG)
  imageWidth: number;        // Pixel dimensions for coordinate mapping
  imageHeight: number;
  devices: FloorPlanDevice[];
  annotations: FloorPlanAnnotation[];
  updatedAt: Date;
}

interface FloorPlanDevice {
  id: string;
  deviceId: string;          // FK to Device (existing model)
  type: FloorDeviceType;
  label: string;             // "Main Entry", "Room 204 Door", "Hallway Camera 3"
  x: number;                 // Position on floor plan image (pixels)
  y: number;
  status?: DeviceStatus;     // Populated at runtime from device service
  metadata?: Record<string, any>;
}

enum FloorDeviceType {
  DOOR = 'DOOR',
  CAMERA = 'CAMERA',
  PANIC_BUTTON_WALL = 'PANIC_BUTTON_WALL',
  READER = 'READER',
  INTERCOM = 'INTERCOM',
  AED = 'AED',
  FIRE_EXTINGUISHER = 'FIRE_EXTINGUISHER',
  FIRE_PULL = 'FIRE_PULL',
  FIRE_PANEL = 'FIRE_PANEL',
  UTILITY_SHUTOFF_ELECTRIC = 'UTILITY_SHUTOFF_ELECTRIC',
  UTILITY_SHUTOFF_GAS = 'UTILITY_SHUTOFF_GAS',
  UTILITY_SHUTOFF_WATER = 'UTILITY_SHUTOFF_WATER',
  FIRST_AID_KIT = 'FIRST_AID_KIT',
  RALLY_POINT = 'RALLY_POINT',
  STAIRWELL = 'STAIRWELL',
  ELEVATOR = 'ELEVATOR',
  RESTROOM = 'RESTROOM',
  OFFICE = 'OFFICE',
  HAZMAT_STORAGE = 'HAZMAT_STORAGE'
}

interface FloorPlanAnnotation {
  id: string;
  type: 'TEXT' | 'ZONE' | 'PATH';
  label: string;
  coordinates: { x: number; y: number }[];  // Single point for TEXT, polygon for ZONE, polyline for PATH
  color?: string;
  notes?: string;           // "Staging area for responding units", "Do not enter - construction"
}
```

### 2.6 DataPackage

Pre-shared facility data package for agencies.

```typescript
interface DataPackage {
  id: string;
  schoolId: string;
  version: number;
  generatedAt: Date;
  generatedBy: string;       // Admin user ID
  contents: {
    school: SchoolInfo;
    buildings: BuildingInfo[];
    floorPlans: FloorPlan[];
    keyHolders: KeyHolder[];
    emergencyContacts: EmergencyContact[];
    reunificationSites: ReunificationSite[];
    stagingAreas: StagingArea[];
    populationData: PopulationData;
    hazards: HazardInfo[];
  };
  pdfUrl?: string;           // Generated printable PDF version
  lastDownloadedBy?: string;
  lastDownloadedAt?: Date;
}

interface SchoolInfo {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  afterHoursPhone: string;
  principalName: string;
  principalCell: string;
  safetyDirectorName?: string;
  safetyDirectorCell?: string;
  sroName?: string;           // School Resource Officer
  sroCell?: string;
  sroBadge?: string;
  sroAgency?: string;
  totalStudents: number;
  totalStaff: number;
  schoolHours: string;        // "7:30 AM - 3:00 PM"
  accessControlVendor?: string;
  cameraVendor?: string;
  panicAlertVendor?: string;
}

interface BuildingInfo {
  id: string;
  name: string;
  address?: string;          // If different from main school
  floors: number;
  yearBuilt?: number;
  constructionType?: string; // "Steel frame", "Wood frame", "Masonry"
  sprinklered: boolean;
  firePanelLocation: string;
  electricalShutoffLocation: string;
  gasShutoffLocation: string;
  waterShutoffLocation: string;
  roofAccess: string;        // "Ladder on north side", "Interior stairwell"
  knoxBoxLocation?: string;  // Key lockbox for fire dept
}

interface KeyHolder {
  name: string;
  role: string;
  phone: string;
  hasKeys: boolean;
  hasAccessCard: boolean;
  alarmCode: boolean;        // Has alarm panel code (don't store code itself)
  priority: number;          // Call order: 1 = first call, 2 = backup, etc.
}

interface ReunificationSite {
  id: string;
  name: string;              // "Community Center"
  address: string;
  isPrimary: boolean;
  capacity: number;
  distanceFromSchool: string; // "0.5 miles"
  drivingDirections: string;
  contactName: string;
  contactPhone: string;
  parkingCapacity: number;
  notes: string;
}

interface StagingArea {
  id: string;
  name: string;              // "East Parking Lot"
  type: 'LAW_ENFORCEMENT' | 'FIRE' | 'EMS' | 'COMMAND_POST' | 'MEDIA';
  description: string;
  coordinates?: { lat: number; lng: number };
  notes: string;
}

interface PopulationData {
  studentsByGrade: Record<string, number>;
  staffByRole: Record<string, number>;
  typicalVisitorsPerDay: number;
  peakOccupancy: number;
  peakOccupancyTime: string;
  afterHoursOccupancy: string;  // "Custodial staff 3-10 PM, empty overnight"
}

interface HazardInfo {
  id: string;
  type: string;              // "Chemical storage", "Pool chemicals", "Art supplies"
  location: string;          // "Room 108 - Science Lab"
  buildingId: string;
  floor: number;
  description: string;
  sdsAvailable: boolean;     // Safety Data Sheets on file
}
```

### 2.7 ReunificationEvent

```typescript
interface ReunificationEvent {
  id: string;
  incidentId: string;
  schoolId: string;
  siteId: string;            // FK to ReunificationSite
  status: ReunificationStatus;
  startedAt: Date;
  completedAt?: Date;
  totalStudents: number;
  studentsAccountedFor: number;
  studentsReleased: number;
  studentsMissing: number;
  studentsInjured: number;
  checkIns: GuardianCheckIn[];
  releases: StudentRelease[];
  updatedAt: Date;
}

enum ReunificationStatus {
  PREPARING = 'PREPARING',
  ACTIVE = 'ACTIVE',
  WINDING_DOWN = 'WINDING_DOWN',
  COMPLETED = 'COMPLETED'
}

interface GuardianCheckIn {
  id: string;
  reunificationEventId: string;
  guardianName: string;
  guardianIdType: string;    // "Driver License", "Passport", "State ID"
  guardianIdNumber: string;  // Last 4 only for privacy
  guardianIdVerified: boolean;
  requestedStudents: string[];  // Student IDs
  authorizedInSIS: boolean;  // Verified against SIS emergency contacts
  checkedInAt: Date;
  checkedInBy: string;       // Staff user ID
  status: 'CHECKED_IN' | 'WAITING' | 'RELEASED' | 'DENIED';
  denyReason?: string;
}

interface StudentRelease {
  id: string;
  reunificationEventId: string;
  studentId: string;
  studentName: string;
  guardianCheckInId: string;
  releasedTo: string;        // Guardian name
  releasedAt: Date;
  releasedBy: string;        // Staff user ID
  notes?: string;
}
```

### 2.8 Tip

```typescript
interface Tip {
  id: string;
  trackingCode: string;      // Public-facing code for tipster to check status (e.g., "TIP-A7X9M2")
  schoolId?: string;         // May be null if tipster doesn't specify
  source: TipSource;
  category: TipCategory;
  content: string;
  attachments?: string[];    // URLs to uploaded images/files
  tipsterContact?: string;   // Optional, tips can be anonymous
  isAnonymous: boolean;
  severity: TipSeverity;
  status: TipStatus;
  assignedTo?: string;       // Safety team user ID
  escalatedToAgency?: string; // Agency ID if escalated to law enforcement
  escalatedAt?: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolution?: string;
  publicStatusMessage?: string; // Message visible to tipster on tracking page (no internal details)
  timeline: TipTimelineEntry[];
  followUps: TipFollowUp[];  // Additional messages from the tipster via tracking page or SMS
  externalSourceId?: string; // ID from third-party platform (WeTip, STOPit, Say Something)
  externalSource?: string;   // Name of third-party platform
  smsConversationId?: string; // Twilio conversation SID for SMS-based tips
  smsPhone?: string;         // Tipster phone (hashed, for SMS reply routing only)
  createdAt: Date;
  updatedAt: Date;
}

enum TipSource {
  WEB_FORM = 'WEB_FORM',
  MOBILE_APP = 'MOBILE_APP',
  TEXT_SMS = 'TEXT_SMS',
  PHONE = 'PHONE',
  EMAIL = 'EMAIL',
  WEBHOOK_WETIP = 'WEBHOOK_WETIP',           // Third-party: WeTip
  WEBHOOK_STOPIT = 'WEBHOOK_STOPIT',         // Third-party: STOPit
  WEBHOOK_SAY_SOMETHING = 'WEBHOOK_SAY_SOMETHING', // Third-party: Sandy Hook Say Something
  WEBHOOK_CUSTOM = 'WEBHOOK_CUSTOM'          // Generic third-party webhook
}

enum TipCategory {
  THREAT_OF_VIOLENCE = 'THREAT_OF_VIOLENCE',
  WEAPON = 'WEAPON',
  BULLYING = 'BULLYING',
  DRUGS = 'DRUGS',
  SELF_HARM = 'SELF_HARM',
  SUSPICIOUS_PERSON = 'SUSPICIOUS_PERSON',
  SUSPICIOUS_PACKAGE = 'SUSPICIOUS_PACKAGE',
  INFRASTRUCTURE = 'INFRASTRUCTURE',   // Propped door, broken lock, etc.
  OTHER = 'OTHER'
}

enum TipSeverity {
  CRITICAL = 'CRITICAL',    // Immediate threat — auto-escalate
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

enum TipStatus {
  NEW = 'NEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED'
}

interface TipTimelineEntry {
  timestamp: Date;
  action: string;
  userId?: string;
  isPublic: boolean;         // If true, visible to tipster on tracking page
}

// Additional information submitted by tipster after initial report
interface TipFollowUp {
  id: string;
  tipId: string;
  source: 'TRACKING_PAGE' | 'SMS' | 'MOBILE_APP';
  content: string;
  attachments?: string[];
  createdAt: Date;
}

// SMS conversation state machine for text-to-tip flow
interface SmsTipConversation {
  id: string;
  phone: string;             // Hashed phone number
  phoneRaw?: string;         // Raw phone, encrypted at rest, purged after conversation ends
  state: SmsTipState;
  schoolId?: string;
  category?: TipCategory;
  content?: string;
  tipId?: string;            // FK to Tip once created
  lastMessageAt: Date;
  expiresAt: Date;           // Conversations expire after 30 minutes of inactivity
  createdAt: Date;
}

enum SmsTipState {
  AWAITING_SCHOOL = 'AWAITING_SCHOOL',     // "What school? Reply with school name"
  AWAITING_CATEGORY = 'AWAITING_CATEGORY', // "What type of issue? Reply 1-9"
  AWAITING_CONTENT = 'AWAITING_CONTENT',   // "Describe what you saw/heard"
  AWAITING_CONFIRM = 'AWAITING_CONFIRM',   // "Submit this tip? Reply YES or NO"
  COMPLETED = 'COMPLETED',                 // Tip created
  EXPIRED = 'EXPIRED',                     // Timed out
  CANCELLED = 'CANCELLED'                  // User replied CANCEL
}

// Inbound webhook payload from third-party tip platforms
interface ThirdPartyTipWebhook {
  externalId: string;        // ID in the source platform
  source: string;            // "wetip", "stopit", "saysomething", "custom"
  schoolName?: string;       // May need fuzzy matching to resolve to schoolId
  schoolExternalId?: string; // If the platform has its own school ID
  category?: string;         // Platform-specific category, mapped to TipCategory
  content: string;
  severity?: string;         // Platform-specific severity, mapped to TipSeverity
  isAnonymous: boolean;
  tipsterContact?: string;
  attachments?: string[];
  timestamp: string;         // ISO 8601
  metadata?: Record<string, any>; // Platform-specific fields preserved for reference
}
```

### 2.9 SecureMessage

Two-way messaging between staff and responders during incidents.

```typescript
interface SecureMessage {
  id: string;
  incidentId: string;
  threadId: string;          // Groups related messages
  senderType: 'STAFF' | 'RESPONDER' | 'SYSTEM';
  senderId: string;
  senderName: string;
  recipientType: 'STAFF' | 'RESPONDER' | 'BROADCAST';
  recipientId?: string;      // Null for broadcast
  content: string;
  messageType: 'TEXT' | 'LOCATION_UPDATE' | 'STATUS_UPDATE' | 'IMAGE';
  readAt?: Date;
  createdAt: Date;
}
```

### 2.10 Gateway (On-Premise Server)

Represents a physical SafeSchoolOS gateway server deployed on-site at a school.

```typescript
interface Gateway {
  id: string;                // UUID
  schoolId: string;          // FK to School
  name: string;              // "Gateway A - Main Building", "Gateway B - Annex"
  hostname: string;          // Network hostname
  ipAddress: string;         // LAN IP
  macAddress: string;        // For hardware identification
  hardwareModel?: string;    // "NanoPi NEO3", "Intel NUC", etc.
  firmwareVersion: string;   // SafeSchoolOS gateway software version
  serialNumber?: string;

  // Clustering
  clusterRole: GatewayClusterRole;
  clusterMode: GatewayClusterMode;
  partnerId?: string;        // UUID of the paired gateway (null if single deployment)
  clusterState: GatewayClusterState;

  // Device ownership
  assignedDevices: string[]; // Device IDs this gateway manages in active-active mode
  assignedZones?: string[];  // Zone/building IDs for zone-based splitting

  // Health
  status: GatewayStatus;
  lastHeartbeatAt?: Date;
  lastCloudSyncAt?: Date;
  cpuUsage?: number;         // Percentage 0-100
  memoryUsage?: number;      // Percentage 0-100
  diskUsage?: number;        // Percentage 0-100
  uptimeSeconds?: number;
  bleDevicesConnected: number;
  networkLatencyMs?: number; // Latency to cloud

  // Connectivity
  primaryConnection: 'ETHERNET' | 'CELLULAR' | 'WIFI';
  hasBackupCellular: boolean;
  cellularSignalStrength?: number;

  createdAt: Date;
  updatedAt: Date;
}

enum GatewayClusterRole {
  SINGLE = 'SINGLE',                 // Only gateway at this school
  PRIMARY = 'PRIMARY',               // Active-Active: owns a device subset. Active-Passive: handles all.
  SECONDARY = 'SECONDARY',           // Active-Active: owns other device subset. Active-Passive: standby.
  ASSUMED_PRIMARY = 'ASSUMED_PRIMARY' // Was secondary, partner failed, now handling everything
}

enum GatewayClusterMode {
  STANDALONE = 'STANDALONE',         // Single gateway, no clustering
  ACTIVE_ACTIVE = 'ACTIVE_ACTIVE',   // Both gateways handle devices, split by zone/building
  ACTIVE_PASSIVE = 'ACTIVE_PASSIVE'  // One active, one hot standby
}

enum GatewayClusterState {
  HEALTHY = 'HEALTHY',               // Both gateways online, operating normally
  DEGRADED = 'DEGRADED',             // One gateway offline, other has assumed its workload
  FAILOVER = 'FAILOVER',             // Failover in progress (transitional, ~5-10 seconds)
  RECOVERING = 'RECOVERING',         // Failed gateway is back, rebalancing devices
  SINGLE = 'SINGLE'                  // Only one gateway deployed
}

enum GatewayStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  DEGRADED = 'DEGRADED',             // Online but with issues (high CPU, disk, etc.)
  UPDATING = 'UPDATING',             // Firmware update in progress
  PROVISIONING = 'PROVISIONING'      // Initial setup
}

// Heartbeat exchanged between paired gateways every 2 seconds on LAN
interface GatewayHeartbeat {
  gatewayId: string;
  timestamp: Date;
  status: GatewayStatus;
  cpuUsage: number;
  memoryUsage: number;
  bleDevicesConnected: number;
  activeIncidentId?: string; // If an incident is active, include ID for state sync
  pendingCommands: number;   // Door commands queued but not yet executed
  firmwareVersion: string;
}

// Logged when a failover event occurs
interface GatewayFailoverEvent {
  id: string;
  schoolId: string;
  failedGatewayId: string;
  assumingGatewayId: string;
  failoverType: 'AUTOMATIC' | 'MANUAL';
  reason: GatewayFailoverReason;
  devicesTransferred: number;
  failoverStartedAt: Date;
  failoverCompletedAt?: Date;
  durationMs?: number;
  incidentActiveAtTime: boolean; // Was there an active incident during failover?
  recoveredAt?: Date;            // When the failed gateway came back
  rebalancedAt?: Date;           // When devices were rebalanced back
}

enum GatewayFailoverReason {
  HEARTBEAT_TIMEOUT = 'HEARTBEAT_TIMEOUT', // No heartbeat for 5+ seconds
  NETWORK_LOSS = 'NETWORK_LOSS',           // Gateway lost network connectivity
  HARDWARE_FAILURE = 'HARDWARE_FAILURE',   // Gateway reported critical hardware issue
  MANUAL_TRIGGER = 'MANUAL_TRIGGER',       // Admin triggered manual failover
  SOFTWARE_CRASH = 'SOFTWARE_CRASH',       // Gateway process crashed
  UPDATE_REBOOT = 'UPDATE_REBOOT'          // Planned failover during firmware update
}

// State synchronization packet between paired gateways
// Sent on every state change + periodic full sync every 30 seconds
interface GatewayStateSync {
  sourceGatewayId: string;
  timestamp: Date;
  syncType: 'FULL' | 'DELTA';
  data: {
    doorStates?: Record<string, DoorStatus>;     // doorId → current status
    activeIncident?: Incident;
    pendingCommands?: DoorCommand[];
    deviceHealth?: Record<string, DeviceHealth>;
    recentEvents?: IncidentTimelineEntry[];       // Last 60 seconds of events
  };
}

interface DoorCommand {
  id: string;
  doorId: string;
  command: 'LOCK' | 'UNLOCK';
  issuedBy: string;
  issuedAt: Date;
  executedAt?: Date;
  status: 'PENDING' | 'EXECUTED' | 'FAILED' | 'TIMEOUT';
  failureReason?: string;
  gatewayId: string;        // Which gateway should execute this
}
```

---

## 3. API Endpoints

### 3.1 Authentication

First responder authentication is separate from school admin auth. Supports pre-shared API keys for dispatch integration and MFA-enabled login for portal users.

```
POST   /api/responder/auth/login
POST   /api/responder/auth/logout
POST   /api/responder/auth/refresh
POST   /api/responder/auth/mfa/verify
```

### 3.2 Agency Management (School Admin)

School administrators manage which agencies have access.

```
GET    /api/admin/agencies                        — List linked agencies
POST   /api/admin/agencies                        — Invite/link new agency
GET    /api/admin/agencies/:agencyId              — Agency details
PUT    /api/admin/agencies/:agencyId              — Update access level
DELETE /api/admin/agencies/:agencyId              — Revoke agency access
GET    /api/admin/agencies/:agencyId/users         — List agency users
POST   /api/admin/agencies/:agencyId/users         — Create responder user
PUT    /api/admin/agencies/:agencyId/users/:userId — Update permissions
DELETE /api/admin/agencies/:agencyId/users/:userId — Disable user
GET    /api/admin/agencies/:agencyId/audit         — Access audit log
```

### 3.3 First Responder Portal API

All endpoints require responder auth. Data scoped to linked schools only.

#### Pre-Incident (always available)

```
GET    /api/responder/schools                      — List schools this agency has access to
GET    /api/responder/schools/:schoolId             — School detail + facility info
GET    /api/responder/schools/:schoolId/buildings   — Building list with details
GET    /api/responder/schools/:schoolId/floorplans  — All floor plans with device overlays
GET    /api/responder/schools/:schoolId/floorplans/:floorId — Single floor plan
GET    /api/responder/schools/:schoolId/doors       — Door inventory with types and lock status
GET    /api/responder/schools/:schoolId/cameras      — Camera inventory with locations
GET    /api/responder/schools/:schoolId/contacts     — Key holders and emergency contacts
GET    /api/responder/schools/:schoolId/reunification — Reunification site details
GET    /api/responder/schools/:schoolId/staging      — Staging area recommendations
GET    /api/responder/schools/:schoolId/hazards      — Hazard locations
GET    /api/responder/schools/:schoolId/population   — Population data
GET    /api/responder/schools/:schoolId/data-package — Download full data package (JSON + PDF)
```

#### Active Incident

```
GET    /api/responder/incidents                     — Active incidents for linked schools
GET    /api/responder/incidents/:incidentId          — Incident detail + timeline
GET    /api/responder/incidents/:incidentId/timeline — Full timeline
POST   /api/responder/incidents/:incidentId/timeline — Add timeline entry (note, status update)

# Real-time door status and control
GET    /api/responder/incidents/:incidentId/doors    — All doors with real-time lock/open status
POST   /api/responder/incidents/:incidentId/doors/:doorId/lock   — Lock a specific door
POST   /api/responder/incidents/:incidentId/doors/:doorId/unlock — Unlock a specific door
POST   /api/responder/incidents/:incidentId/lockdown             — Lock ALL doors campus-wide
POST   /api/responder/incidents/:incidentId/lockdown/release     — Release full lockdown

# Camera feeds
GET    /api/responder/incidents/:incidentId/cameras   — Camera list with stream URLs
GET    /api/responder/incidents/:incidentId/cameras/:cameraId/stream — RTSP/HLS stream proxy

# Location tracking
GET    /api/responder/incidents/:incidentId/locations  — Staff panic button locations (real-time)

# Visitor data
GET    /api/responder/incidents/:incidentId/visitors   — Active visitor list from BadgeKiosk

# Student accountability
GET    /api/responder/incidents/:incidentId/accountability — Classroom check-in status

# Messaging
GET    /api/responder/incidents/:incidentId/messages    — Message threads
POST   /api/responder/incidents/:incidentId/messages    — Send message to staff
```

#### Post-Incident

```
GET    /api/responder/incidents/:incidentId/report      — Generated incident report
GET    /api/responder/incidents/:incidentId/logs         — Access control event logs
GET    /api/responder/incidents/:incidentId/exports      — Export data (CSV/JSON)
POST   /api/responder/incidents/:incidentId/video-bookmarks — Bookmark camera timestamp for evidence
GET    /api/responder/incidents/:incidentId/video-bookmarks — List bookmarks
```

### 3.4 Dispatch Integration API

Machine-to-machine API for PSAP/911 integration. Uses API key auth.

```
POST   /api/dispatch/alerts                         — Receive panic alert (outbound to PSAP)
POST   /api/dispatch/alerts/:alertId/acknowledge     — PSAP acknowledges receipt
POST   /api/dispatch/alerts/:alertId/dispatch        — Units dispatched notification
POST   /api/dispatch/alerts/:alertId/on-scene        — First unit on scene
GET    /api/dispatch/schools/:schoolId/facility-data  — Facility data for CAD systems
```

#### RapidSOS Integration

```
POST   /api/dispatch/rapidsos/alert                  — Push alert to RapidSOS clearinghouse
POST   /api/dispatch/rapidsos/location-update        — Update location data
POST   /api/dispatch/rapidsos/supplemental           — Push supplemental data (floor plans, camera URLs)
```

### 3.5 Reunification API

```
POST   /api/reunification/events                     — Start reunification event
GET    /api/reunification/events/:eventId             — Event status + stats
PUT    /api/reunification/events/:eventId             — Update status

# Student accountability
GET    /api/reunification/events/:eventId/students    — Student list with accountability status
PUT    /api/reunification/events/:eventId/students/:studentId — Update student status

# Guardian check-in
POST   /api/reunification/events/:eventId/checkin     — Guardian check-in (scan ID)
GET    /api/reunification/events/:eventId/checkins    — List all check-ins
PUT    /api/reunification/events/:eventId/checkins/:id — Update check-in status

# Student release
POST   /api/reunification/events/:eventId/release     — Release student to guardian
GET    /api/reunification/events/:eventId/releases    — List all releases

# Parent notification
POST   /api/reunification/events/:eventId/notify      — Send notification to all parents
POST   /api/reunification/events/:eventId/notify/update — Send status update
```

### 3.6 Tip Reporting API

Public-facing (no auth for submission/tracking) + authenticated for management.

```
# Public (no auth)
POST   /api/tips                                     — Submit anonymous tip (returns trackingCode)
GET    /api/tips/categories                          — List tip categories
GET    /api/tips/track/:trackingCode                 — Check tip status (public-safe info only)
POST   /api/tips/track/:trackingCode/followup        — Submit additional info on existing tip
GET    /api/tips/schools                             — List schools for tip submission dropdown

# SMS Inbound Webhook (Twilio signature verification)
POST   /api/tips/sms/inbound                         — Receive inbound SMS from Twilio
POST   /api/tips/sms/status                          — Twilio delivery status callback

# Third-Party Platform Webhooks (API key auth per platform)
POST   /api/tips/webhook/wetip                       — Receive tip from WeTip
POST   /api/tips/webhook/stopit                      — Receive tip from STOPit
POST   /api/tips/webhook/saysomething                — Receive tip from Sandy Hook Say Something
POST   /api/tips/webhook/custom                      — Receive tip from generic webhook source
GET    /api/tips/webhook/config                      — List configured webhook integrations (admin)
PUT    /api/tips/webhook/config/:source              — Update webhook config (admin)

# Authenticated (school safety team)
GET    /api/admin/tips                               — List tips for school
GET    /api/admin/tips/:tipId                        — Tip detail (includes follow-ups, full timeline)
PUT    /api/admin/tips/:tipId                        — Update status, assign, add notes
POST   /api/admin/tips/:tipId/escalate               — Escalate to law enforcement
POST   /api/admin/tips/:tipId/public-update          — Post status message visible to tipster on tracking page
GET    /api/admin/tips/:tipId/followups              — List follow-up messages from tipster
GET    /api/admin/tips/analytics                     — Tip volume, categories, trends, source breakdown
GET    /api/admin/tips/analytics/sources             — Volume by source (web, SMS, WeTip, STOPit, etc.)

# Responder access (linked agencies)
GET    /api/responder/tips                           — Tips escalated to this agency
GET    /api/responder/tips/:tipId                    — Tip detail
PUT    /api/responder/tips/:tipId                    — Update investigation status
```

### 3.7 Gateway Management API

School admin endpoints for managing on-premise gateway servers.

```
# Gateway Registration and Configuration (School Admin)
GET    /api/admin/gateways                            — List gateways for this school
POST   /api/admin/gateways                            — Register new gateway (returns provisioning token)
GET    /api/admin/gateways/:gatewayId                 — Gateway detail + health + cluster status
PUT    /api/admin/gateways/:gatewayId                 — Update gateway config (name, zones, connection type)
DELETE /api/admin/gateways/:gatewayId                 — Decommission gateway

# Cluster Management
POST   /api/admin/gateways/cluster/pair               — Pair two gateways (body: {gatewayA, gatewayB, mode})
PUT    /api/admin/gateways/cluster/mode               — Switch cluster mode (active-active ↔ active-passive)
POST   /api/admin/gateways/cluster/rebalance          — Manual device rebalance between gateways
DELETE /api/admin/gateways/cluster/pair                — Unpair gateways (revert to standalone)

# Device Assignment (Active-Active mode)
GET    /api/admin/gateways/:gatewayId/devices          — List devices assigned to this gateway
PUT    /api/admin/gateways/:gatewayId/devices          — Reassign devices (move devices between gateways)
POST   /api/admin/gateways/:gatewayId/devices/auto     — Auto-assign devices by building/zone

# Health and Monitoring
GET    /api/admin/gateways/:gatewayId/health           — Current health metrics (CPU, memory, disk, uptime)
GET    /api/admin/gateways/:gatewayId/health/history    — Health history (last 24h/7d/30d)
GET    /api/admin/gateways/cluster/status              — Cluster health overview (both gateways)
GET    /api/admin/gateways/failover/history            — List failover events with duration + reason

# Failover Control
POST   /api/admin/gateways/:gatewayId/failover/trigger — Manual failover (move all devices to partner)
POST   /api/admin/gateways/:gatewayId/failover/recover — Manually initiate recovery + rebalance

# Firmware Updates
GET    /api/admin/gateways/:gatewayId/firmware          — Current + available firmware versions
POST   /api/admin/gateways/:gatewayId/firmware/update   — Start firmware update (triggers planned failover first)

# Gateway-to-Cloud API (called by gateway software, gateway auth token)
POST   /api/gateway/heartbeat                          — Gateway reports health to cloud
POST   /api/gateway/sync                               — Gateway pushes state sync to cloud
POST   /api/gateway/events                             — Gateway pushes device events to cloud
POST   /api/gateway/failover/notify                    — Gateway notifies cloud of failover event
GET    /api/gateway/config                             — Gateway pulls latest config from cloud
GET    /api/gateway/devices                            — Gateway pulls assigned device list
```

---

## 4. WebSocket Events

Real-time data pushed to First Responder Portal during active incidents.

### 4.1 Connection

```
ws://api.safeschoolog.com/ws/responder?token={jwt}
```

### 4.2 Event Types

```typescript
// Door status changes
interface DoorStatusEvent {
  event: 'door.status';
  data: {
    incidentId: string;
    doorId: string;
    doorName: string;
    buildingId: string;
    floor: number;
    status: 'LOCKED' | 'UNLOCKED' | 'OPEN' | 'FORCED' | 'PROPPED' | 'OFFLINE';
    changedAt: Date;
    changedBy?: string;      // User/system that changed it
  };
}

// Panic button location updates
interface LocationEvent {
  event: 'location.update';
  data: {
    incidentId: string;
    userId: string;
    userName: string;
    buildingId: string;
    floor: number;
    room: string;
    x: number;               // Position on floor plan
    y: number;
    timestamp: Date;
  };
}

// Incident timeline additions
interface TimelineEvent {
  event: 'incident.timeline';
  data: IncidentTimelineEntry;
}

// Incident status changes
interface IncidentStatusEvent {
  event: 'incident.status';
  data: {
    incidentId: string;
    previousStatus: IncidentStatus;
    newStatus: IncidentStatus;
    changedBy: string;
    changedAt: Date;
  };
}

// Student accountability updates
interface AccountabilityEvent {
  event: 'accountability.update';
  data: {
    incidentId: string;
    classroomId: string;
    teacherName: string;
    totalStudents: number;
    accountedFor: number;
    missing: number;
    injured: number;
    checkedInAt: Date;
  };
}

// New message
interface MessageEvent {
  event: 'message.new';
  data: SecureMessage;
}

// Visitor movement (from BadgeKiosk integration)
interface VisitorEvent {
  event: 'visitor.update';
  data: {
    incidentId: string;
    visitorId: string;
    visitorName: string;
    visitorType: string;
    lastKnownLocation: string;
    checkedInAt: Date;
    badgeId?: string;
    photoUrl?: string;
  };
}

// Reunification progress
interface ReunificationEvent {
  event: 'reunification.update';
  data: {
    eventId: string;
    totalStudents: number;
    accountedFor: number;
    released: number;
    missing: number;
    lastUpdateAt: Date;
  };
}

// Gateway health and failover events
interface GatewayHealthEvent {
  event: 'gateway.health';
  data: {
    gatewayId: string;
    gatewayName: string;
    status: GatewayStatus;
    clusterState: GatewayClusterState;
    cpuUsage: number;
    memoryUsage: number;
    bleDevicesConnected: number;
    timestamp: Date;
  };
}

interface GatewayFailoverWebSocketEvent {
  event: 'gateway.failover';
  data: {
    schoolId: string;
    failedGatewayId: string;
    failedGatewayName: string;
    assumingGatewayId: string;
    assumingGatewayName: string;
    reason: GatewayFailoverReason;
    devicesTransferred: number;
    clusterState: GatewayClusterState; // DEGRADED during failover, RECOVERING after
    timestamp: Date;
  };
}

interface GatewayRecoveryEvent {
  event: 'gateway.recovery';
  data: {
    schoolId: string;
    recoveredGatewayId: string;
    recoveredGatewayName: string;
    clusterState: GatewayClusterState; // HEALTHY after rebalance
    devicesRebalanced: number;
    timestamp: Date;
  };
}
```

---

## 5. Frontend Components

### 5.1 First Responder Portal — Page Structure

```
/responder
├── /login                          — MFA-enabled login
├── /dashboard                      — School list + active incident banner
├── /schools/:id
│   ├── /overview                   — School info, contacts, population
│   ├── /floorplans                 — Interactive floor plan viewer
│   ├── /doors                      — Door inventory + status
│   ├── /cameras                    — Camera inventory + preview
│   ├── /contacts                   — Key holders + emergency contacts
│   ├── /reunification              — Reunification sites + staging areas
│   ├── /hazards                    — Hazard locations
│   └── /data-package               — Download facility data package
├── /incidents
│   ├── /                           — Active + recent incident list
│   └── /:id
│       ├── /command                — MAIN VIEW: Floor plan + door status + cameras + timeline
│       ├── /doors                  — Door control panel
│       ├── /cameras                — Multi-camera grid view
│       ├── /messages               — Two-way messaging with staff
│       ├── /accountability         — Student accountability dashboard
│       ├── /visitors               — Active visitor list
│       ├── /timeline               — Full incident timeline
│       └── /report                 — Post-incident report + exports
├── /tips                           — Escalated tips
└── /settings                       — Profile, notification preferences
```

### 5.2 Incident Command View (`/incidents/:id/command`)

This is the primary screen responders use during an active incident. It must be optimized for high-stress, time-critical use.

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ ACTIVE INCIDENT — Lincoln Elementary — Room 204         │
│  Type: ACTIVE THREAT  │  Status: LOCKDOWN_ACTIVE  │  03:42  │
├───────────────────────────────────────────┬──────────────────┤
│                                           │  📋 TIMELINE     │
│     INTERACTIVE FLOOR PLAN                │                  │
│                                           │  3:42 All doors  │
│     🔴 = Open/Unlocked                    │       locked     │
│     🟢 = Locked                           │  3:41 Lockdown   │
│     🟡 = Propped/Alert                    │       initiated  │
│     ⚫ = Offline                           │  3:40 Dispatch   │
│     📍 = Alert Origin                     │       notified   │
│     📹 = Camera (click for feed)          │  3:39 Panic alert│
│                                           │       Room 204   │
│     [Building: Main] [Floor: ▼ 1st]      │                  │
│                                           │  ──────────────  │
│                                           │  💬 MESSAGES     │
│                                           │                  │
│                                           │  Staff: "Two     │
│                                           │  students in     │
│                                           │  hallway near    │
│                                           │  gym"            │
│                                           │                  │
├───────────────────────────────────────────┤  [Type message]  │
│  🚪 DOOR CONTROLS                        │                  │
│  [🔒 Lock All] [🔓 Release Lockdown]     ├──────────────────┤
│                                           │  👥 ACCOUNTABILITY│
│  Main Entry ····· 🟢 Locked              │  ✅ Room 201 24/24│
│  East Exit ······ 🟢 Locked              │  ✅ Room 202 22/22│
│  West Exit ······ 🟢 Locked              │  ⏳ Room 203  —   │
│  Gym Doors ······ 🔴 OPEN ← [Lock]       │  ✅ Room 204 26/26│
│  Cafeteria ······ 🟢 Locked              │  ❌ Room 205 19/20│
│  Loading Dock ··· 🟢 Locked              │     1 MISSING     │
└───────────────────────────────────────────┴──────────────────┘
```

**Design requirements:**

- Dark theme (reduced glare in tactical environments, especially patrol cars)
- Large touch targets (minimum 44x44px, optimized for phone/tablet use in the field)
- Status colors: Red = danger/action needed, Green = secured, Yellow = warning, Gray = offline
- Auto-refresh via WebSocket (no manual polling)
- Floor plan supports pinch-zoom and pan on mobile
- Camera feed opens as overlay/modal on floor plan tap
- Audible alert tone when new critical events arrive (toggleable)
- Works on mobile browsers without app install (PWA)
- Offline-capable floor plan viewer (pre-cached via service worker)

### 5.3 Reunification Dashboard

Used by school staff at the reunification site.

```
┌──────────────────────────────────────────────────────────────┐
│  REUNIFICATION — Lincoln Elementary — Community Center       │
│  Started: 4:15 PM  │  Students: 412  │  Released: 287       │
├───────────────────────────────┬───────────────────────────────┤
│  GUARDIAN CHECK-IN            │  STUDENT STATUS               │
│                               │                               │
│  [Scan ID]  [Manual Entry]   │  🟢 Accounted: 408            │
│                               │  🔴 Missing: 4                │
│  Waiting:                     │  🟡 Injured: 0                │
│  ┌─────────────────────────┐ │  ✅ Released: 287              │
│  │ Sarah Johnson           │ │  ⏳ Awaiting: 121              │
│  │ Requesting: Emma J. (3) │ │                               │
│  │ ID: Verified ✓          │ │  MISSING STUDENTS:            │
│  │ [Release Student]       │ │  • Tyler R. — Grade 4         │
│  ├─────────────────────────┤ │  • Maria S. — Grade 2         │
│  │ Robert Chen             │ │  • David W. — Grade 5         │
│  │ Requesting: Lily C. (1) │ │  • Aiden K. — Grade 3         │
│  │ ID: NOT IN SIS ⚠️       │ │                               │
│  │ [Deny] [Override+Note]  │ │  [Notify Parents]             │
│  └─────────────────────────┘ │  [Send Update]                │
└───────────────────────────────┴───────────────────────────────┘
```

### 5.4 Tip Reporting Experience (Public)

The tip system has three public-facing touchpoints: web form submission, tip tracking page, and SMS conversation flow. All are accessible without login.

#### 5.4.1 Web Submission Form (`/tip` or `/tip/:schoolSlug`)

Simple, mobile-friendly form accessible without login.

```
┌────────────────────────────────┐
│  🛡️ SafeSchoolOS               │
│  Anonymous Safety Tip          │
│                                │
│  Your identity is protected.   │
│  You do not need to provide    │
│  your name or contact info.    │
│                                │
│  School: [Select School    ▼]  │
│                                │
│  Category:                     │
│  [Select Category          ▼]  │
│                                │
│  What happened?                │
│  ┌──────────────────────────┐  │
│  │                          │  │
│  │                          │  │
│  └──────────────────────────┘  │
│                                │
│  📎 Attach photo/screenshot    │
│                                │
│  Contact (optional):           │
│  [________________________]    │
│                                │
│  [Submit Tip]                  │
│                                │
│  Tips about immediate danger   │
│  should be reported to 911.    │
└────────────────────────────────┘
```

#### 5.4.2 Submission Confirmation

After successful submission, user sees their tracking code and instructions.

```
┌────────────────────────────────┐
│  🛡️ SafeSchoolOS               │
│                                │
│  ✅ Tip Submitted              │
│                                │
│  Your tracking code:           │
│  ┌──────────────────────────┐  │
│  │                          │  │
│  │     TIP-A7X9M2           │  │
│  │                          │  │
│  │     [Copy Code]          │  │
│  └──────────────────────────┘  │
│                                │
│  Save this code to:            │
│  • Check the status of your    │
│    tip at any time             │
│  • Add more information later  │
│                                │
│  Check status anytime at:      │
│  safeschoolog.com/tip/status   │
│                                │
│  If this is an emergency,      │
│  call 911 immediately.         │
│                                │
│  [Check Status]  [Submit       │
│                   Another Tip] │
└────────────────────────────────┘
```

#### 5.4.3 Tip Tracking Page (`/tip/status/:trackingCode`)

Allows tipster to check status and add follow-up information without revealing their identity. Shows ONLY public-safe information — no internal notes, no assignee names, no investigation details.

```
┌────────────────────────────────┐
│  🛡️ SafeSchoolOS               │
│  Tip Status                    │
│                                │
│  Enter your tracking code:     │
│  [TIP-A7X9M2      ] [Check]   │
│                                │
│  ──────────────────────────    │
│                                │
│  Status: 🟡 Under Review       │
│  Submitted: Feb 15, 2026       │
│  Category: Suspicious Person   │
│                                │
│  Updates from safety team:     │
│  ┌──────────────────────────┐  │
│  │ Feb 16 — "Thank you for  │  │
│  │ your report. Our safety  │  │
│  │ team is actively looking │  │
│  │ into this. If you have   │  │
│  │ additional information,  │  │
│  │ please share it below."  │  │
│  └──────────────────────────┘  │
│                                │
│  ──────────────────────────    │
│                                │
│  Have more information?        │
│  ┌──────────────────────────┐  │
│  │                          │  │
│  │                          │  │
│  └──────────────────────────┘  │
│  📎 Attach file                │
│  [Submit Follow-Up]            │
│                                │
│  Your follow-up messages:      │
│  ┌──────────────────────────┐  │
│  │ Feb 16 — "I also saw the │  │
│  │ same person near the     │  │
│  │ east parking lot around  │  │
│  │ 2:30 PM"                 │  │
│  └──────────────────────────┘  │
│                                │
│  Status legend:                │
│  🔵 New — Received             │
│  🟡 Under Review — Being       │
│     investigated               │
│  🟢 Resolved — Action taken    │
│  ⚫ Closed                     │
└────────────────────────────────┘
```

**Tracking page design rules:**

- NEVER show internal notes, assignee names, or investigation details
- NEVER show whether tip was escalated to law enforcement (could tip off a perpetrator)
- Public status messages are written by the safety team specifically for tipster consumption
- Status categories visible to tipster are simplified: New → Under Review → Resolved → Closed
- Rate-limit tracking page lookups (10 per hour per IP) to prevent enumeration attacks
- Tracking codes are 8+ characters alphanumeric, case-insensitive, no ambiguous characters (0/O, 1/l/I)

#### 5.4.4 SMS Tip Flow

Tipsters text a keyword to a dedicated phone number (e.g., text "SAFE" to 555-0199 or short code). The system walks them through the submission via conversational SMS.

```
SMS Conversation Flow:
═══════════════════════════════════════════════════

Tipster → SAFE
                                    ← SafeSchoolOS: You've reached the
                                       SafeSchool anonymous tip line.
                                       Your identity is protected.
                                       What school is this about?
                                       Reply with the school name.
                                       (Reply CANCEL anytime to stop)

Tipster → Lincoln Elementary
                                    ← SafeSchoolOS: Lincoln Elementary.
                                       What type of issue?
                                       Reply with a number:
                                       1. Threat of violence
                                       2. Weapon
                                       3. Bullying
                                       4. Drugs
                                       5. Suspicious person
                                       6. Suspicious package
                                       7. Self-harm concern
                                       8. Building/door issue
                                       9. Other

Tipster → 5
                                    ← SafeSchoolOS: Suspicious person.
                                       Please describe what you saw or
                                       heard. Include as much detail as
                                       you can (who, what, when, where).

Tipster → There's a man in a red jacket
          who has been sitting in a car
          in the east parking lot for the
          last 2 hours watching kids at
          recess. Silver Honda Civic.
                                    ← SafeSchoolOS: Got it. Here's your tip:
                                       School: Lincoln Elementary
                                       Type: Suspicious person
                                       Detail: "There's a man in a red
                                       jacket who has been sitting in a
                                       car in the east parking lot..."
                                       
                                       Reply YES to submit, NO to edit,
                                       or CANCEL to discard.

Tipster → YES
                                    ← SafeSchoolOS: ✅ Tip submitted.
                                       Your tracking code: TIP-K3M8N4
                                       
                                       Check status anytime:
                                       safeschoolog.com/tip/status
                                       
                                       To add more info, reply with
                                       your tracking code followed by
                                       your message. Example:
                                       TIP-K3M8N4 He just got out of
                                       the car

═══════════════════════════════════════════════════

Follow-up via SMS (anytime after submission):

Tipster → TIP-K3M8N4 He just got out
          of the car and is walking
          toward the east entrance
                                    ← SafeSchoolOS: Follow-up added to
                                       tip TIP-K3M8N4. Thank you.
                                       
                                       If this is an emergency,
                                       call 911 immediately.
```

**SMS implementation details:**

- Inbound SMS received via Twilio webhook at `POST /api/tips/sms/inbound`
- Conversation state tracked in `sms_tip_conversations` table
- School name matching uses fuzzy search (Levenshtein distance) against school names in the system
- If school can't be matched, reply "I couldn't find that school. Please try again or reply the school's full name and city."
- Conversations expire after 30 minutes of inactivity
- Phone numbers are hashed for storage; raw numbers encrypted at rest and purged after conversation completion + 24 hours
- Twilio message SIDs logged for delivery verification
- Rate limit: 3 new conversations per phone number per day
- MMS (photo) messages accepted as attachments during the AWAITING_CONTENT state

#### 5.4.5 Third-Party Platform Integration

Schools that already use WeTip, STOPit, Sandy Hook Say Something, or other tip platforms can route those tips into SafeSchoolOS for unified management.

```
Third-Party Tip Webhook Flow:
═══════════════════════════════════════════════════

                ┌──────────┐
Student tips →  │  WeTip   │ ──webhook──→ POST /api/tips/webhook/wetip
                │  STOPit  │ ──webhook──→ POST /api/tips/webhook/stopit
                │  Say     │ ──webhook──→ POST /api/tips/webhook/saysomething
                │  Custom  │ ──webhook──→ POST /api/tips/webhook/custom
                └──────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │ Webhook Handler   │
                                    │                   │
                                    │ 1. Verify API key │
                                    │ 2. Parse payload  │
                                    │ 3. Map category   │
                                    │ 4. Match school   │
                                    │ 5. Assign severity│
                                    │ 6. Create Tip     │
                                    │ 7. Return 201     │
                                    └──────────────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │ Safety Team       │
                                    │ Dashboard         │
                                    │                   │
                                    │ Tip shows with    │
                                    │ source badge:     │
                                    │ "via WeTip"       │
                                    │ "via STOPit"      │
                                    │ External ID linked│
                                    └──────────────────┘

═══════════════════════════════════════════════════
```

**Webhook configuration (per school, managed by admin):**

```typescript
interface WebhookConfig {
  id: string;
  schoolId: string;
  source: string;            // 'wetip' | 'stopit' | 'saysomething' | 'custom'
  enabled: boolean;
  apiKey: string;            // Key that external platform includes in requests
  endpointUrl: string;       // The full webhook URL for this school
  categoryMapping: Record<string, TipCategory>; // Map external categories to internal
  defaultCategory: TipCategory;
  schoolExternalId?: string; // School's ID in the external platform
  lastReceivedAt?: Date;
  totalReceived: number;
  createdAt: Date;
  updatedAt: Date;
}
```

**Category mapping example (WeTip → SafeSchoolOS):**

```json
{
  "violence_threat": "THREAT_OF_VIOLENCE",
  "weapons": "WEAPON",
  "bullying_harassment": "BULLYING",
  "substance_abuse": "DRUGS",
  "self_harm_suicide": "SELF_HARM",
  "trespassing": "SUSPICIOUS_PERSON",
  "vandalism": "INFRASTRUCTURE",
  "other": "OTHER"
}
```

**Deduplication:** If the same external ID is received twice, return 200 OK without creating a duplicate. Log the duplicate attempt.

---

## 6. Dispatch Integration Details

### 6.1 RapidSOS Integration

RapidSOS is the preferred method for transmitting emergency data to 911 dispatch centers. SafeSchoolOS should integrate with the RapidSOS Emergency Data Clearinghouse.

**Outbound data on panic alert activation:**

```json
{
  "alert_type": "PANIC_ACTIVATION",
  "incident_id": "uuid",
  "timestamp": "2026-02-15T14:30:00Z",
  "location": {
    "civic": {
      "address": "100 Main Street",
      "city": "Cranston",
      "state": "RI",
      "zip": "02920",
      "building": "Main Building",
      "floor": "2",
      "room": "204"
    },
    "coordinates": {
      "latitude": 41.7798,
      "longitude": -71.4373,
      "accuracy_meters": 5
    }
  },
  "caller": {
    "name": "Jane Smith",
    "role": "Teacher",
    "phone": "+14015551234"
  },
  "facility": {
    "name": "Lincoln Elementary School",
    "type": "K-12 School",
    "students": 412,
    "staff": 45,
    "floors": 2
  },
  "supplemental_data": {
    "floor_plan_url": "https://api.safeschoolog.com/responder/floorplans/uuid",
    "camera_feed_url": "https://api.safeschoolog.com/responder/cameras/uuid/stream",
    "door_status_url": "https://api.safeschoolog.com/responder/doors?school=uuid",
    "active_visitors": 3
  }
}
```

### 6.2 CAP (Common Alerting Protocol) Support

Generate CAP-compliant XML alerts for systems that consume the standard.

```xml
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>safeschool-uuid</identifier>
  <sender>safeschoolog.com</sender>
  <sent>2026-02-15T14:30:00-05:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Restricted</scope>
  <info>
    <category>Security</category>
    <event>School Panic Alert</event>
    <urgency>Immediate</urgency>
    <severity>Extreme</severity>
    <certainty>Observed</certainty>
    <description>Panic alert activated at Lincoln Elementary School, Room 204, 2nd Floor</description>
    <area>
      <areaDesc>Lincoln Elementary School, 100 Main St, Cranston RI</areaDesc>
      <circle>41.7798,-71.4373 0.1</circle>
    </area>
  </info>
</alert>
```

### 6.3 SIP/VoIP Automated 911 Call

For agencies/PSAPs that cannot receive digital alerts, fall back to automated voice call.

```
Trigger: Panic alert activation
Action:
  1. Initiate SIP call to configured 911 number
  2. Play pre-recorded message:
     "This is an automated emergency alert from SafeSchoolOS.
      A panic alert has been activated at [school name],
      [address], [city], [state].
      Alert type: [type]. Location: Building [building],
      Floor [floor], Room [room].
      Staff member: [name]. Contact number: [phone].
      [number] students and [number] staff are in the building.
      Please dispatch immediately.
      This message will repeat."
  3. Hold line open for dispatcher response
  4. Log call status (connected, busy, no answer) in incident timeline
```

---

## 7. Security Requirements

### 7.1 Authentication

- Responder portal uses separate auth from school admin
- MFA required for all responder accounts (TOTP or SMS)
- Session timeout: 8 hours pre-incident, no timeout during active incident
- API keys for dispatch integration (rotated annually minimum)
- All auth events logged with IP, user agent, and outcome

### 7.2 Authorization

- Role-based access control (RBAC) per ResponderRole enum
- Data scoped to linked schools only (SchoolAgencyLink)
- Door control commands require COMMAND role + active incident
- Access audit log for all data views and actions
- Schools can revoke agency access immediately

### 7.3 Data Protection

- All API traffic over TLS 1.3
- Camera stream proxied through SafeSchoolOS (no direct camera IP exposure)
- Student PII (names, photos) visible only during active incidents and reunification
- FERPA compliance: student data access logged and auditable
- Facility schematics and camera locations treated as law enforcement sensitive
- Data package downloads logged with user, IP, timestamp
- No permanent storage of camera feeds on SafeSchoolOS servers (pass-through only)
- Student data purged from responder-accessible views after incident resolution + 30 days

### 7.4 CJIS Compliance Considerations

If law enforcement agencies require CJIS Security Policy compliance:

- Encrypt data at rest (AES-256) and in transit (TLS 1.3)
- Advanced authentication (MFA mandatory)
- Audit and accountability logging
- Access control enforcement
- Personnel security (background check requirement for admins)
- Media protection for exported data

Note: Full CJIS compliance may be a later phase. Initial implementation should be "CJIS-ready" in architecture without requiring formal certification.

---

## 8. Database Schema (PostgreSQL)

### 8.1 New Tables

```sql
-- Agencies
CREATE TABLE agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('POLICE','FIRE','EMS','DISPATCH')),
  jurisdiction VARCHAR(255),
  primary_contact VARCHAR(255),
  primary_phone VARCHAR(20),
  primary_email VARCHAR(255),
  dispatch_phone VARCHAR(20),
  psap_id VARCHAR(100),
  rapid_sos_org_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Responder users
CREATE TABLE responder_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  badge_number VARCHAR(50),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  mfa_enabled BOOLEAN DEFAULT false,
  mfa_secret VARCHAR(255),
  last_login TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- School-agency links
CREATE TABLE school_agency_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  access_level VARCHAR(20) NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  mou_signed BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, agency_id)
);

-- Incidents
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  type VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'TRIGGERED',
  severity VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  triggered_by UUID,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_device_id UUID,
  trigger_building_id UUID,
  trigger_floor INTEGER,
  trigger_room VARCHAR(50),
  trigger_lat DOUBLE PRECISION,
  trigger_lng DOUBLE PRECISION,
  dispatched_at TIMESTAMPTZ,
  first_responder_arrival TIMESTAMPTZ,
  all_clear_at TIMESTAMPTZ,
  reunification_started_at TIMESTAMPTZ,
  reunification_completed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_incidents_school ON incidents(school_id);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_active ON incidents(school_id, status) WHERE status NOT IN ('RESOLVED','FALSE_ALARM');

-- Incident timeline
CREATE TABLE incident_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action TEXT NOT NULL,
  action_type VARCHAR(40) NOT NULL,
  actor_type VARCHAR(20) NOT NULL,
  actor_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_timeline_incident ON incident_timeline(incident_id, timestamp);

-- Incident responding agencies
CREATE TABLE incident_agencies (
  incident_id UUID NOT NULL REFERENCES incidents(id),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  notified_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  on_scene_at TIMESTAMPTZ,
  PRIMARY KEY (incident_id, agency_id)
);

-- Floor plan annotations (extends existing floor_plans table)
CREATE TABLE floor_plan_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_plan_id UUID NOT NULL REFERENCES floor_plans(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('TEXT','ZONE','PATH')),
  label VARCHAR(255),
  coordinates JSONB NOT NULL,
  color VARCHAR(7),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Data packages
CREATE TABLE data_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  version INTEGER NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  generated_by UUID,
  contents JSONB NOT NULL,
  pdf_url VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Data package downloads audit
CREATE TABLE data_package_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_package_id UUID NOT NULL REFERENCES data_packages(id),
  downloaded_by UUID NOT NULL REFERENCES responder_users(id),
  downloaded_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

-- Reunification events
CREATE TABLE reunification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  school_id UUID NOT NULL REFERENCES schools(id),
  site_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'PREPARING',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_students INTEGER NOT NULL DEFAULT 0,
  students_accounted INTEGER NOT NULL DEFAULT 0,
  students_released INTEGER NOT NULL DEFAULT 0,
  students_missing INTEGER NOT NULL DEFAULT 0,
  students_injured INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guardian check-ins
CREATE TABLE guardian_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reunification_event_id UUID NOT NULL REFERENCES reunification_events(id),
  guardian_name VARCHAR(255) NOT NULL,
  guardian_id_type VARCHAR(50),
  guardian_id_last4 VARCHAR(4),
  guardian_id_verified BOOLEAN DEFAULT false,
  requested_student_ids UUID[] DEFAULT '{}',
  authorized_in_sis BOOLEAN DEFAULT false,
  checked_in_at TIMESTAMPTZ DEFAULT NOW(),
  checked_in_by UUID,
  status VARCHAR(20) DEFAULT 'CHECKED_IN',
  deny_reason TEXT
);

-- Student releases
CREATE TABLE student_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reunification_event_id UUID NOT NULL REFERENCES reunification_events(id),
  student_id UUID NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  guardian_checkin_id UUID REFERENCES guardian_checkins(id),
  released_to VARCHAR(255) NOT NULL,
  released_at TIMESTAMPTZ DEFAULT NOW(),
  released_by UUID,
  notes TEXT
);

-- Tips
CREATE TABLE tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_code VARCHAR(12) NOT NULL UNIQUE,
  school_id UUID REFERENCES schools(id),
  source VARCHAR(30) NOT NULL,
  category VARCHAR(30) NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT[] DEFAULT '{}',
  tipster_contact VARCHAR(255),
  is_anonymous BOOLEAN DEFAULT true,
  severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  status VARCHAR(20) NOT NULL DEFAULT 'NEW',
  assigned_to UUID,
  escalated_to_agency UUID REFERENCES agencies(id),
  escalated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution TEXT,
  public_status_message TEXT,
  timeline JSONB DEFAULT '[]',
  external_source_id VARCHAR(255),
  external_source VARCHAR(50),
  sms_conversation_id VARCHAR(100),
  sms_phone_hash VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tips_school ON tips(school_id, status);
CREATE INDEX idx_tips_severity ON tips(severity) WHERE status = 'NEW';
CREATE INDEX idx_tips_tracking ON tips(tracking_code);
CREATE INDEX idx_tips_external ON tips(external_source, external_source_id);

-- Tip follow-up messages from tipster
CREATE TABLE tip_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id UUID NOT NULL REFERENCES tips(id),
  source VARCHAR(20) NOT NULL CHECK (source IN ('TRACKING_PAGE','SMS','MOBILE_APP')),
  content TEXT NOT NULL,
  attachments TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tip_followups_tip ON tip_follow_ups(tip_id, created_at);

-- SMS tip conversations (state machine for text-to-tip flow)
CREATE TABLE sms_tip_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash VARCHAR(255) NOT NULL,
  phone_encrypted VARCHAR(500),       -- AES-256 encrypted, purged after completion + 24h
  state VARCHAR(30) NOT NULL DEFAULT 'AWAITING_SCHOOL',
  school_id UUID REFERENCES schools(id),
  category VARCHAR(30),
  content TEXT,
  tip_id UUID REFERENCES tips(id),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,    -- 30 min from last message
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sms_conv_phone ON sms_tip_conversations(phone_hash, state);
CREATE INDEX idx_sms_conv_expires ON sms_tip_conversations(expires_at) WHERE state NOT IN ('COMPLETED','EXPIRED','CANCELLED');

-- SMS message log (for debugging delivery issues)
CREATE TABLE sms_tip_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES sms_tip_conversations(id),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  body TEXT NOT NULL,
  twilio_sid VARCHAR(100),
  status VARCHAR(20),                  -- queued, sent, delivered, failed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Third-party webhook configurations
CREATE TABLE tip_webhook_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  source VARCHAR(30) NOT NULL,         -- wetip, stopit, saysomething, custom
  enabled BOOLEAN DEFAULT true,
  api_key VARCHAR(255) NOT NULL,       -- Key external platform includes in requests
  category_mapping JSONB DEFAULT '{}', -- Map external categories to TipCategory
  default_category VARCHAR(30) DEFAULT 'OTHER',
  school_external_id VARCHAR(255),     -- School's ID in external platform
  last_received_at TIMESTAMPTZ,
  total_received INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, source)
);

-- Secure messages
CREATE TABLE secure_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  thread_id UUID NOT NULL,
  sender_type VARCHAR(20) NOT NULL,
  sender_id UUID NOT NULL,
  sender_name VARCHAR(255) NOT NULL,
  recipient_type VARCHAR(20) NOT NULL,
  recipient_id UUID,
  content TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'TEXT',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_incident ON secure_messages(incident_id, thread_id, created_at);

-- Responder access audit log
CREATE TABLE responder_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  responder_user_id UUID NOT NULL REFERENCES responder_users(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  school_id UUID,
  incident_id UUID,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_responder ON responder_audit_log(responder_user_id, created_at);
CREATE INDEX idx_audit_school ON responder_audit_log(school_id, created_at);

-- Reunification sites
CREATE TABLE reunification_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  name VARCHAR(255) NOT NULL,
  address VARCHAR(500),
  is_primary BOOLEAN DEFAULT false,
  capacity INTEGER,
  distance_from_school VARCHAR(50),
  driving_directions TEXT,
  contact_name VARCHAR(255),
  contact_phone VARCHAR(20),
  parking_capacity INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staging areas
CREATE TABLE staging_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL,
  description TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Key holders
CREATE TABLE key_holders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100),
  phone VARCHAR(20),
  has_keys BOOLEAN DEFAULT false,
  has_access_card BOOLEAN DEFAULT false,
  has_alarm_code BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 99,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hazard locations
CREATE TABLE hazard_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  building_id UUID,
  type VARCHAR(100) NOT NULL,
  location_description VARCHAR(255),
  floor INTEGER,
  description TEXT,
  sds_available BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video bookmarks (for post-incident evidence)
CREATE TABLE video_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  camera_id UUID NOT NULL,
  camera_name VARCHAR(255),
  bookmark_start TIMESTAMPTZ NOT NULL,
  bookmark_end TIMESTAMPTZ,
  label VARCHAR(255),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES responder_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gateway servers (on-premise)
CREATE TABLE gateways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  name VARCHAR(255) NOT NULL,
  hostname VARCHAR(255),
  ip_address INET,
  mac_address VARCHAR(17),
  hardware_model VARCHAR(100),
  firmware_version VARCHAR(50),
  serial_number VARCHAR(100),
  cluster_role VARCHAR(20) NOT NULL DEFAULT 'SINGLE',
  cluster_mode VARCHAR(20) NOT NULL DEFAULT 'STANDALONE',
  cluster_state VARCHAR(20) NOT NULL DEFAULT 'SINGLE',
  partner_id UUID REFERENCES gateways(id),
  assigned_devices UUID[] DEFAULT '{}',
  assigned_zones UUID[] DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'PROVISIONING',
  last_heartbeat_at TIMESTAMPTZ,
  last_cloud_sync_at TIMESTAMPTZ,
  cpu_usage SMALLINT,
  memory_usage SMALLINT,
  disk_usage SMALLINT,
  uptime_seconds BIGINT,
  ble_devices_connected INTEGER DEFAULT 0,
  network_latency_ms INTEGER,
  primary_connection VARCHAR(20) DEFAULT 'ETHERNET',
  has_backup_cellular BOOLEAN DEFAULT false,
  cellular_signal_strength SMALLINT,
  provisioning_token VARCHAR(255),        -- Used during initial gateway setup
  auth_token_hash VARCHAR(255),           -- Hashed token for gateway-to-cloud auth
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gateways_school ON gateways(school_id);
CREATE INDEX idx_gateways_partner ON gateways(partner_id);
CREATE INDEX idx_gateways_status ON gateways(status);

-- Gateway heartbeat log (retain last 24 hours for diagnostics)
CREATE TABLE gateway_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id UUID NOT NULL REFERENCES gateways(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL,
  cpu_usage SMALLINT,
  memory_usage SMALLINT,
  ble_devices_connected INTEGER,
  pending_commands INTEGER DEFAULT 0,
  active_incident_id UUID,
  firmware_version VARCHAR(50)
);

CREATE INDEX idx_heartbeats_gateway ON gateway_heartbeats(gateway_id, timestamp DESC);

-- Failover events (permanent history)
CREATE TABLE gateway_failover_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  failed_gateway_id UUID NOT NULL REFERENCES gateways(id),
  assuming_gateway_id UUID NOT NULL REFERENCES gateways(id),
  failover_type VARCHAR(20) NOT NULL CHECK (failover_type IN ('AUTOMATIC','MANUAL')),
  reason VARCHAR(30) NOT NULL,
  devices_transferred INTEGER NOT NULL DEFAULT 0,
  failover_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failover_completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  incident_active_at_time BOOLEAN DEFAULT false,
  recovered_at TIMESTAMPTZ,
  rebalanced_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_failovers_school ON gateway_failover_events(school_id, failover_started_at DESC);

-- Gateway state sync log (retain last 1 hour for debugging sync issues)
CREATE TABLE gateway_state_syncs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_gateway_id UUID NOT NULL REFERENCES gateways(id),
  target_gateway_id UUID NOT NULL REFERENCES gateways(id),
  sync_type VARCHAR(10) NOT NULL CHECK (sync_type IN ('FULL','DELTA')),
  payload_size_bytes INTEGER,
  sync_duration_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_syncs_source ON gateway_state_syncs(source_gateway_id, created_at DESC);

-- Door command queue (tracks execution across gateways)
CREATE TABLE door_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  door_id UUID NOT NULL,
  command VARCHAR(10) NOT NULL CHECK (command IN ('LOCK','UNLOCK')),
  issued_by UUID NOT NULL,             -- User or system ID
  issued_by_type VARCHAR(20) NOT NULL, -- 'STAFF', 'RESPONDER', 'SYSTEM'
  incident_id UUID REFERENCES incidents(id),
  gateway_id UUID NOT NULL REFERENCES gateways(id),  -- Which gateway should execute
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  executed_at TIMESTAMPTZ,
  failure_reason TEXT,
  retry_count SMALLINT DEFAULT 0,
  max_retries SMALLINT DEFAULT 3,
  timeout_at TIMESTAMPTZ,              -- Command expires if not executed by this time
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_door_commands_gateway ON door_commands(gateway_id, status) WHERE status = 'PENDING';
CREATE INDEX idx_door_commands_incident ON door_commands(incident_id);
```

---

## 9. Implementation Priority

### Phase 1 — Foundation (MVP for ISC West demo)

1. Agency + ResponderUser models and CRUD
2. SchoolAgencyLink management (school admin invites agency)
3. Pre-Incident data: floor plans, doors, cameras, contacts (read-only portal)
4. Data Package generation and download (JSON + PDF)
5. Basic responder portal UI with floor plan viewer
6. Responder audit logging
7. Single gateway registration + provisioning + cloud heartbeat

### Phase 2 — Active Incident

1. Incident model + lifecycle management
2. Real-time door status overlay on floor plan (WebSocket)
3. Door lock/unlock commands from responder portal
4. Campus-wide lockdown initiation from portal
5. Panic alert location display on floor plan
6. Incident timeline (auto-populated + manual notes)
7. Incident Command View UI

### Phase 3 — Communication & Dispatch

1. Two-way secure messaging (staff ↔ responder)
2. RapidSOS integration for 911 data push
3. CAP alert generation
4. SIP/VoIP automated 911 call fallback
5. Parent notification triggers (SMS/email/voice)
6. Mass notification integration

### Phase 4 — Reunification

1. Reunification event management
2. Student accountability dashboard
3. Guardian check-in with ID verification
4. Student release workflow
5. Reunification site management
6. Parent notification with reunification details

### Phase 5 — Tips & Analytics

1. Anonymous tip submission (public web form + confirmation with tracking code)
2. Tip tracking page (public status check + follow-up submission)
3. Tip management dashboard (school safety team — assign, review, update, post public status)
4. Tip escalation to law enforcement
5. SMS tip line via Twilio (conversational flow, state machine, phone hashing)
6. Third-party webhook integration (WeTip, STOPit, Say Something, custom)
7. Webhook configuration UI for school admins (category mapping, enable/disable)
8. Tip analytics and trend reporting (volume by source, category, severity, response time)
9. Post-incident report generation
10. Video bookmark management

### Phase 6 — Gateway Redundancy

1. Gateway pairing protocol (two gateways discover each other on LAN)
2. Heartbeat exchange (2-second interval, 5-second timeout detection)
3. Active-Passive mode: standby gateway monitors, failover on heartbeat loss
4. State synchronization channel (door states, incidents, pending commands)
5. Automatic failover with device assumption + cloud notification
6. Recovery detection + automatic device rebalance
7. Active-Active mode: zone-based device splitting between gateways
8. Admin UI: cluster status dashboard, device assignment, failover history
9. Door command queue with retry logic and gateway routing
10. Planned failover for firmware updates (zero-downtime update sequence)
11. Network-independent gateway-to-gateway communication (direct Ethernet or dedicated VLAN)
12. Responder portal transparent failover (WebSocket reconnects to surviving gateway data)

---

## 10. Testing Requirements

### 10.1 Unit Tests

- All API endpoints with valid/invalid auth
- RBAC enforcement (responder role X cannot access resource Y)
- Data scoping (agency A cannot see school B's data)
- Incident state machine transitions
- WebSocket event generation for all door/location/timeline changes

### 10.2 Integration Tests

- Full panic alert → dispatch → lockdown → notification workflow
- Reunification: check-in → SIS verification → student release flow
- RapidSOS payload format validation
- CAP XML schema validation
- Concurrent door commands during active incident
- Full SMS tip flow: SAFE → school → category → content → YES → tip created
- SMS tip follow-up: tracking code + message → follow-up attached to correct tip
- SMS conversation expiry: no response for 30 min → state transitions to EXPIRED
- SMS fuzzy school matching: "lincon elementry" → matches "Lincoln Elementary"
- Webhook tip ingestion: valid payload → tip created with correct source badge
- Webhook deduplication: same external ID sent twice → 200 OK, no duplicate tip
- Webhook invalid API key → 401 rejected
- Tip tracking page: submit follow-up → appears in admin dashboard
- Tip public status update: admin posts message → visible on tracking page
- Tip auto-escalation: CRITICAL severity tip → automatically pushed to linked agency
- Category mapping: external "violence_threat" → maps to THREAT_OF_VIOLENCE
- Gateway pairing: register two gateways → pair → cluster state becomes HEALTHY
- Gateway failover: stop Gateway A heartbeat → Gateway B detects within 5s → assumes devices → cluster state DEGRADED
- Gateway recovery: restart Gateway A → heartbeat resumes → devices rebalance → cluster state HEALTHY
- Door command routing: lock door assigned to Gateway A → command routes to Gateway A, not Gateway B
- Door command failover: lock door on Gateway A → Gateway A is down → command reroutes to Gateway B
- Door command retry: command fails → retries up to 3 times → logs failure if all retries exhausted
- Gateway state sync: change door state on Gateway A → delta sync to Gateway B within 2 seconds
- Planned failover: trigger firmware update → devices migrate to partner → update proceeds → devices rebalance
- Active-Active zone split: assign Building 1 to Gateway A, Building 2 to Gateway B → each handles only its devices
- Single gateway mode: register one gateway → cluster mode STANDALONE → no pairing/sync/failover logic active
- Lockdown across gateways: campus-wide lockdown → both gateways execute lock commands for their assigned doors simultaneously

### 10.3 Load/Stress Tests

- 50+ simultaneous WebSocket connections during incident
- Door status updates at 1/second across 100 doors
- Message throughput during active incident
- Data package generation for large school (1000+ students)
- Gateway heartbeat at 2-second intervals sustained for 24+ hours without drift or memory leak
- Gateway state sync with 200+ devices in a single FULL sync payload
- Failover under load: trigger failover while 50 door commands are in flight → all commands execute or fail gracefully
- Dual-gateway campus-wide lockdown: 100 doors split across 2 gateways → all locked within 3 seconds
- Gateway recovery rebalance with active WebSocket clients → clients experience no data gaps

### 10.4 Security Tests

- Authentication bypass attempts
- Cross-school data access attempts
- Door command without active incident (must reject)
- Door command without COMMAND role (must reject)
- SQL injection on all input fields
- XSS on message content and tip content
- Rate limiting on public tip submission (5/hr per IP)
- Rate limiting on tip tracking page (10/hr per IP to prevent enumeration)
- Tracking code enumeration resistance (codes must be unpredictable)
- SMS rate limiting (3 new conversations per phone per day)
- Webhook API key verification (reject requests with invalid/missing keys)
- Webhook replay attack prevention (reject duplicate external IDs)
- SMS phone number purge verification (raw numbers deleted after completion + 24h)
- Tip tracking page information leakage (must not reveal internal notes, assignees, escalation status)
- Gateway provisioning token single-use (cannot be reused after initial registration)
- Gateway auth token rotation (old tokens rejected after rotation)
- Gateway-to-cloud API rejects requests from unregistered gateways
- Gateway cannot send commands for devices it doesn't own (active-active boundary enforcement)
- Spoofed heartbeat from unauthorized IP rejected

---

## 11. Environment Variables

```bash
# First Responder Portal
FR_JWT_SECRET=                    # Separate from school admin JWT
FR_JWT_EXPIRY=8h
FR_MFA_ISSUER=SafeSchoolOS
FR_SESSION_TIMEOUT_MINUTES=480

# RapidSOS Integration
RAPIDSOS_API_URL=https://api.rapidsos.com
RAPIDSOS_CLIENT_ID=
RAPIDSOS_CLIENT_SECRET=
RAPIDSOS_ENABLED=false

# SIP/VoIP 911 Integration
SIP_SERVER=
SIP_USERNAME=
SIP_PASSWORD=
SIP_911_NUMBER=
SIP_ENABLED=false

# Camera Stream Proxy
CAMERA_PROXY_ENABLED=true
CAMERA_STREAM_TIMEOUT_MS=30000

# Tip Reporting
TIP_RATE_LIMIT_PER_IP=5          # Tips per hour per IP
TIP_CRITICAL_AUTO_ESCALATE=true  # Auto-escalate CRITICAL severity tips
TIP_TRACKING_CODE_LENGTH=8       # Length of tracking codes (alphanumeric)

# SMS Tip Line (Twilio)
TIP_SMS_ENABLED=false
TIP_SMS_TWILIO_ACCOUNT_SID=
TIP_SMS_TWILIO_AUTH_TOKEN=
TIP_SMS_TWILIO_PHONE_NUMBER=     # Dedicated tip line number (e.g., +15555550199)
TIP_SMS_CONVERSATION_TIMEOUT=30  # Minutes before SMS conversation expires
TIP_SMS_RATE_LIMIT_PER_PHONE=3   # New conversations per phone per day
TIP_SMS_PHONE_PURGE_HOURS=24     # Hours after completion before raw phone is purged

# Third-Party Tip Webhooks
TIP_WEBHOOK_WETIP_ENABLED=false
TIP_WEBHOOK_STOPIT_ENABLED=false
TIP_WEBHOOK_SAYSOMETHING_ENABLED=false
TIP_WEBHOOK_CUSTOM_ENABLED=false

# Parent Notification (via existing Notification Service)
NOTIFICATION_SMS_PROVIDER=twilio
NOTIFICATION_VOICE_PROVIDER=twilio
NOTIFICATION_EMAIL_PROVIDER=sendgrid

# Reunification
REUNIFICATION_ID_SCAN_ENABLED=true

# Gateway Clustering
GATEWAY_HEARTBEAT_INTERVAL_MS=2000            # Heartbeat between paired gateways
GATEWAY_HEARTBEAT_TIMEOUT_MS=5000             # Miss threshold before failover triggers
GATEWAY_STATE_SYNC_INTERVAL_MS=30000          # Full state sync between gateways
GATEWAY_FAILOVER_COOLDOWN_MS=60000            # Minimum time before allowing failback
GATEWAY_HEARTBEAT_RETENTION_HOURS=24          # How long to keep heartbeat logs
GATEWAY_STATE_SYNC_RETENTION_HOURS=1          # How long to keep sync logs
GATEWAY_COMMAND_TIMEOUT_MS=10000              # Door command timeout
GATEWAY_COMMAND_MAX_RETRIES=3                 # Retry failed door commands
GATEWAY_CLOUD_SYNC_INTERVAL_MS=5000           # Gateway → cloud health reporting
GATEWAY_REBALANCE_DELAY_MS=30000              # Wait before rebalancing after recovery
```

---

## 12. Notes for Implementation

### 12.1 Relationship to Existing Services

- The First Responder Portal reads from the same PostgreSQL database as the school admin dashboard
- Door commands route through the existing Access Control Service — the responder portal sends commands to the same endpoint the school admin uses, but with responder auth + incident context
- Camera streams proxy through SafeSchoolOS to avoid exposing camera IPs to external networks
- Panic alert events from the BLE mesh trigger incident creation automatically
- The existing Notification Service handles SMS/email/voice — the reunification module and parent notification use the same service with new message templates

### 12.2 Commercial Plugin Integration Points

- **BadgeKiosk API:** Active visitor list endpoint consumed by the responder portal during incidents. Visitors who checked in through BadgeKiosk appear in the incident view with name, photo, badge number, check-in time, and host.
- **BadgeGuard API:** Credential analytics can surface anomalous badge usage patterns in the incident timeline (e.g., "Badge 4421 used at unusual time 15 minutes before alert"). This is a premium feature available only to schools with BadgeGuard license.

### 12.3 Offline Considerations

- Floor plans should be cacheable via service worker for offline viewing in patrol vehicles
- Data packages include a PDF version specifically for printing and keeping in patrol car binders
- Critical door lock commands should have a queuing mechanism in case of brief network interruption

### 12.4 Mobile Optimization

- Incident Command View must be fully functional on phones (minimum 375px width)
- Touch targets 44x44px minimum throughout responder portal
- Camera feeds should degrade gracefully on low bandwidth (lower resolution, still images fallback)
- PWA manifest for "Add to Home Screen" on mobile devices

### 12.5 Gateway Redundancy Implementation Notes

#### Heartbeat and Failure Detection

- Gateways exchange UDP heartbeats every 2 seconds on a dedicated port (default 9701) over the school LAN
- If 3 consecutive heartbeats are missed (6 seconds), the surviving gateway begins failover
- Heartbeat includes: gateway ID, status, CPU/memory, connected device count, active incident ID, firmware version
- The cloud also monitors gateway heartbeats (via the `/api/gateway/heartbeat` endpoint at 5-second intervals) as a secondary detection mechanism — if both gateways lose internet but the LAN is fine, they still protect each other

#### State Synchronization

- Delta syncs fire on every state change (door locked, command issued, event logged) — lightweight, just the changed fields
- Full syncs fire every 30 seconds as a consistency checkpoint — the receiving gateway compares against its own state and resolves any drift
- Sync travels over TCP on a dedicated port (default 9702) for reliability
- If a sync fails, the next full sync will catch up — the system is eventually consistent with a worst-case lag of 30 seconds
- During active incidents, full sync interval drops to 5 seconds for tighter consistency

#### Device Assignment in Active-Active Mode

- Devices can be assigned manually by the school admin (drag-and-drop in the admin UI) or auto-assigned by building/zone
- Auto-assignment uses the building/zone structure already defined in SafeSchoolOS — devices inherit their building's gateway assignment
- The BLE mesh handles the physical layer — each gateway's BLE radio communicates with devices in its zone, and the mesh relays messages across zones when needed
- If a device's assigned gateway fails, the surviving gateway establishes direct BLE communication with all devices (range permitting — this is why gateways should be physically separated, ideally one per building or wing)

#### Failover Sequence (Automatic)

```
T+0.0s  Gateway A sends last heartbeat
T+2.0s  Gateway A misses heartbeat
T+4.0s  Gateway A misses second heartbeat
T+6.0s  Gateway B declares Gateway A OFFLINE (3 missed heartbeats)
T+6.0s  Gateway B transitions to ASSUMED_PRIMARY
T+6.0s  Gateway B begins connecting to Gateway A's devices via BLE mesh
T+6.1s  Gateway B notifies cloud: failover event (POST /api/gateway/failover/notify)
T+6.1s  Cloud logs failover event, updates cluster state to DEGRADED
T+6.2s  Cloud pushes gateway.failover WebSocket event to all connected portal clients
T+6.5s  Admin notification sent (email + push) — "Gateway A offline, Gateway B handling all devices"
T+7-10s Gateway B completes device connections — all doors/cameras/sensors responsive
T+10s   Full operational on single gateway
```

#### Recovery Sequence

```
T+0.0s  Gateway A comes back online, sends heartbeat
T+0.0s  Gateway B receives heartbeat, transitions cluster state to RECOVERING
T+0.0s  Gateway B sends full state sync to Gateway A
T+30s   Rebalance delay (configurable, default 30s — ensures Gateway A is stable)
T+30s   Gateway B begins releasing Gateway A's original devices back
T+35s   Gateway A re-establishes connections to its devices
T+35s   Both gateways send heartbeats, cluster state → HEALTHY
T+35s   Cloud notified, admin notified — "Gateway A recovered, cluster healthy"
```

#### Planned Failover (Firmware Updates)

To update gateway firmware with zero downtime:

1. Admin triggers firmware update on Gateway A via the admin UI
2. System initiates graceful failover: Gateway A's devices migrate to Gateway B
3. Once all devices confirmed on Gateway B, Gateway A enters UPDATE mode
4. Gateway A downloads firmware, installs, reboots
5. Gateway A comes back online with new firmware, sends heartbeat
6. Standard recovery sequence rebalances devices
7. Repeat for Gateway B if both need updating

This means a school never loses safety coverage during updates. In a single-gateway deployment, the admin is warned that an update will cause a brief outage and must confirm.

#### Physical Deployment Recommendations

- In Active-Active mode, place one gateway per building or wing for optimal BLE mesh coverage
- Gateways should be on the same VLAN but physically separated (don't put both in the same server closet — a single closet fire or power loss shouldn't take out both)
- Each gateway should have its own UPS (uninterruptible power supply) — 30 minutes of battery minimum
- If the school has backup cellular, at least one gateway should have it for cloud connectivity during network outages
- Gateway hardware recommendations: NanoPi NEO3 (budget), Intel NUC (mid-range), or manufacturer-provided certified gateway hardware
