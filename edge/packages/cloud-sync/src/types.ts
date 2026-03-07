/**
 * Shared types for the cloud-sync package.
 * These mirror the edge-side SyncClient types.
 */

// ─── Sync Protocol Types ────────────────────────────────────────────

export interface SyncEntity {
  type: string;
  action: 'create' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: string;
}

export interface PushRequest {
  siteId: string;
  entities: SyncEntity[];
}

export interface PushResponse {
  synced: number;
  errors: number;
  timestamp: string;
}

export interface PullRequest {
  siteId: string;
  since: string;
  entities?: string;
}

export interface PullResponse {
  data: Record<string, unknown[]>;
  timestamp: string;
}

export interface HeartbeatRequest {
  siteId: string;
  mode: string;
  pendingChanges: number;
  orgId?: string;
  version?: string;
  hostname?: string;
  nodeVersion?: string;
  diskUsagePercent?: number;
  memoryUsageMb?: number;
  ipAddress?: string;
  apiPort?: number;
  upgradeStatus?: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS';
  upgradeError?: string;
  configVersion?: number;
}

export interface UpgradeCommand {
  targetVersion: string;
  action: 'update';
}

export interface HeartbeatResponse {
  ack: boolean;
  timestamp: string;
  upgrade?: UpgradeCommand;
  peers?: PeerInfo[];
  license?: LicenseInfo;
  config?: DeviceConfigPayload;
}

// ─── Remote Device Configuration ─────────────────────────────────

export interface ConnectorConfigEntry {
  name: string;
  type: string;
  enabled: boolean;
  pollIntervalMs?: number;
  [key: string]: unknown;
}

export interface FederationPeerEntry {
  product: string;
  host: string;
  port: number;
}

export interface DeviceConfigPayload {
  version: number;
  connectors?: ConnectorConfigEntry[];
  syncIntervalMs?: number;
  siteName?: string;
  federation?: {
    enabled: boolean;
    peers: FederationPeerEntry[];
  };
  commands?: DeviceCommand[];
}

export interface DeviceCommand {
  id: string;
  action: 'restart' | 'reboot' | 'clear_cache' | 'rotate_logs';
  issuedAt: string;
}

export interface DeviceConfigRecord {
  siteId: string;
  config: DeviceConfigPayload;
  appliedVersion?: number;
  updatedAt: Date;
}

export interface PeerInfo {
  siteId: string;
  ipAddress: string;
  apiPort: number;
  version: string;
  lastHeartbeatAt: string;
}

// ─── Device Registry Types ──────────────────────────────────────────

export interface EdgeDevice {
  id: string;
  siteId: string;
  orgId?: string;
  hostname?: string;
  ipAddress?: string;
  apiPort?: number;
  version?: string;
  nodeVersion?: string;
  mode: string;
  pendingChanges: number;
  diskUsagePercent?: number;
  memoryUsageMb?: number;
  lastHeartbeatAt: Date;
  targetVersion?: string;
  upgradeStatus?: 'IDLE' | 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';
  upgradeError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FleetSummary {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  versionDistribution: Record<string, number>;
  upgradeStatus: {
    idle: number;
    pending: number;
    inProgress: number;
    success: number;
    failed: number;
  };
}

// ─── Cloud Sync Plugin Options ──────────────────────────────────────

export interface CloudSyncOptions {
  /** The shared HMAC key for verifying edge device requests */
  syncKey: string;
  /** Database adapter for persisting sync data */
  adapter: SyncDatabaseAdapter;
  /** Max entities per push request (default: 100) */
  maxBatchSize?: number;
  /** Max heartbeat age in ms before device is "offline" (default: 5 min) */
  offlineThresholdMs?: number;
  /** Max request age in ms for replay protection (default: 5 min) */
  maxRequestAgeMs?: number;
  /** Entity types allowed for push (empty = all) */
  allowedEntityTypes?: string[];
  /** Fields to strip from pull responses (e.g., password hashes) */
  redactFields?: string[];
  /** Optional license adapter for billing enforcement on push/pull */
  licenseAdapter?: LicenseDatabaseAdapter;
  /** Grace period in ms after cancellation/trial expiry (default: 30 days) */
  gracePeriodMs?: number;
}

// ─── Billing / License Status Types ─────────────────────────────────

export type LicenseStatus = 'active' | 'trial' | 'past_due' | 'canceled' | 'expired';

/** Products that never trigger billing enforcement (always free). */
export const BILLING_EXEMPT_PRODUCTS = new Set(['safeschool']);

/** Products eligible for auto-trial on first subscribe. */
export const TRIAL_ELIGIBLE_PRODUCTS = new Set([]);

export interface LicenseInfo {
  status: LicenseStatus;
  expiresAt?: string | null;
  gracePeriodEndsAt?: string | null;
}

export interface OrgLicense {
  orgId: string;
  products: string[];
  tier: string;
  activationKey: string;
  proxyIndex: number;
  status?: LicenseStatus;
  expiresAt?: Date | null;
  gracePeriodEndsAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}


export interface StripeWebhookOptions {
  stripeWebhookSecret: string;
  licenseAdapter: LicenseDatabaseAdapter;
  productMappings: StripeProductMapping[];
  gracePeriodMs?: number;
}

// ─── License Database Adapter Interface ─────────────────────────────

/**
 * Each product implements this adapter to store org license/subscription data.
 * When a customer changes their subscription, the activation key is
 * auto-regenerated with the updated product flags.
 */
export interface LicenseDatabaseAdapter {
  /** Get the license for an org. */
  getLicense(orgId: string): Promise<OrgLicense | null>;

  /** List all licenses. */
  listLicenses(): Promise<OrgLicense[]>;

  /** Create or update a license record. */
  upsertLicense(license: OrgLicense): Promise<OrgLicense>;

  /** Delete a license (org canceled). */
  deleteLicense(orgId: string): Promise<void>;
}

// ─── OAuth / Dashboard User Types ───────────────────────────────────

export type OAuthProvider = 'google' | 'microsoft' | 'apple' | 'password';

export interface DashboardUser {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  provider: OAuthProvider;
  providerId?: string;
  orgId: string;
  role: string;  // 'admin' | 'editor' | 'viewer'
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDatabaseAdapter {
  findByProviderAndId(provider: string, providerId: string): Promise<DashboardUser | null>;
  findByEmail(email: string): Promise<DashboardUser | null>;
  upsertUser(user: {
    email: string; displayName?: string; avatarUrl?: string;
    provider: OAuthProvider; providerId?: string; orgId: string; role?: string;
  }): Promise<DashboardUser>;
  listUsers(orgId?: string): Promise<DashboardUser[]>;
  findById(userId: string): Promise<DashboardUser | null>;
  deleteUser(userId: string): Promise<boolean>;
  updateUserRole(userId: string, role: string): Promise<DashboardUser | null>;
}

// ─── Entity Query Types ─────────────────────────────────────────────

export interface EntityQueryParams {
  /** Single entity type or array of types to query across (results merged) */
  entityType: string | string[];
  orgId?: string;
  siteId?: string;
  since?: Date;
  until?: Date;
  limit?: number;     // default 100
  offset?: number;    // default 0
  filters?: Record<string, unknown>;  // field-level filters
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface EntityQueryResult {
  entities: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Database Adapter Interface ─────────────────────────────────────

/**
 * Each product implements this adapter to connect cloud-sync to their database.
 *
 * This is the only thing you need to implement to add EdgeRuntime sync
 * support to an existing cloud server.
 */
export interface SyncDatabaseAdapter {
  /**
   * Process a batch of entities pushed from an edge device.
   * Apply creates/updates/deletes to the database.
   * Return the count of successfully processed entities.
   */
  processPush(siteId: string, entities: SyncEntity[], orgId?: string): Promise<{ synced: number; errors: number }>;

  /**
   * Pull entities changed since a given timestamp for a site.
   * The entityTypes array filters which types to return.
   * Return a map of type -> array of records.
   */
  processPull(siteId: string, since: Date, entityTypes: string[], orgId?: string): Promise<Record<string, unknown[]>>;

  /**
   * Record or update an edge device heartbeat.
   * Create the device record if it doesn't exist.
   * Return the device record (for checking upgrade commands).
   */
  upsertDevice(device: {
    siteId: string;
    orgId?: string;
    hostname?: string;
    ipAddress?: string;
    apiPort?: number;
    version?: string;
    nodeVersion?: string;
    mode: string;
    pendingChanges: number;
    diskUsagePercent?: number;
    memoryUsageMb?: number;
    upgradeStatus?: string;
    upgradeError?: string;
  }): Promise<EdgeDevice>;

  /**
   * Get a single device by site ID.
   */
  getDevice(siteId: string): Promise<EdgeDevice | null>;

  /**
   * List all registered edge devices, optionally filtered by org.
   */
  listDevices(orgId?: string): Promise<EdgeDevice[]>;

  /**
   * Set a target version for a device (triggers upgrade on next heartbeat).
   */
  setDeviceTargetVersion(siteId: string, targetVersion: string): Promise<void>;

  /**
   * Set target version for all IDLE devices (batch upgrade), optionally scoped to org.
   */
  setAllDevicesTargetVersion(targetVersion: string, orgId?: string): Promise<number>;

  /**
   * Get fleet summary statistics, optionally scoped to org.
   */
  getFleetSummary(offlineThresholdMs: number, orgId?: string): Promise<FleetSummary>;

  /**
   * Query entities with filtering, pagination, and sorting.
   * Used by the cloud dashboard to read synced edge data.
   */
  queryEntities(params: EntityQueryParams): Promise<EntityQueryResult>;

  /**
   * Get the pending device config for a site (delivered via heartbeat).
   */
  getDeviceConfig(siteId: string): Promise<DeviceConfigRecord | null>;

  /**
   * Set device config (creates or updates). Increments version automatically.
   */
  setDeviceConfig(siteId: string, config: Partial<DeviceConfigPayload>): Promise<DeviceConfigRecord>;

  /**
   * Mark a config version as applied by the edge device.
   */
  ackDeviceConfig(siteId: string, version: number): Promise<void>;
}
