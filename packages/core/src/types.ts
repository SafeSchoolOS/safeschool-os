/**
 * Shared types for SafeSchoolOS (EdgeRuntime open-source core)
 */

export type OperatingMode = 'EDGE' | 'STANDALONE' | 'CLOUD' | 'MIRROR';

export type LicenseTier = 'trial' | 'starter' | 'pro' | 'enterprise';

export const LICENSE_TIERS: Record<number, LicenseTier> = {
  0: 'trial',
  1: 'starter',
  2: 'pro',
  3: 'enterprise',
};

export type ProductFlag = 'safeschool';

export const PRODUCT_FLAGS: Record<number, ProductFlag> = {
  3: 'safeschool',
};

export interface SyncState {
  siteId: string;
  lastSyncAt: Date;
  cloudReachable: boolean;
  operatingMode: OperatingMode;
  pendingChanges: number;
  lastError?: string;
}

export interface ModuleManifest {
  name: string;
  version: string;
  product: ProductFlag;
  description: string;
  entityTypes: string[];
  conflictStrategies?: Record<string, string>;
}

export interface ConnectorDefinition {
  name: string;
  type: string;
  enabled: boolean;
  pollIntervalMs?: number;
  [key: string]: unknown;
}

export interface UserAccount {
  id: string;
  username: string;
  email?: string;
  passwordHash: string;
  role: string;
  siteId?: string;
  enabled: boolean;
  syncedAt: string;
}

export interface FederationPeer {
  product: ProductFlag;
  host: string;
  apiPort: number;
  syncKey?: string;
}

export interface FederationRoute {
  targetProduct: ProductFlag;
  entityTypes: string[];
  direction: 'push' | 'pull' | 'both';
}

export interface FederationConfig {
  enabled: boolean;
  peers: FederationPeer[];
  routes: FederationRoute[];
}

export interface EdgeRuntimeConfig {
  activationKey: string | string[];
  siteId: string;
  orgId?: string;
  dataDir: string;
  syncIntervalMs: number;
  healthCheckIntervalMs: number;
  apiPort: number;
  operatingMode?: OperatingMode;
  cloudSyncKey?: string;
  cloudTlsFingerprint?: string;
  moduleDirs?: string[];
  /** Connector instances to create from config */
  connectors?: ConnectorDefinition[];
  /** Enable peer-to-peer sync between edge devices in same org (default: false) */
  enablePeerSync?: boolean;
  /** CLOUD mode: database adapter for sync/fleet operations. If not provided, uses in-memory adapter. */
  cloudSyncAdapter?: any;
  /** CLOUD mode: database adapter for license/subscription operations. If not provided, uses in-memory adapter. */
  cloudLicenseAdapter?: any;
  /** CLOUD mode: extract org ID from request for license routes. Default: reads x-org-id header. */
  cloudGetOrgId?: (request: any) => string;
  /** Cross-product federation config for edge-to-edge event sharing */
  federation?: FederationConfig;
}
