/**
 * @edgeruntime/cloud-sync
 *
 * Shared cloud-side sync API package for EdgeRuntime-powered products.
 *
 * Provides:
 *   - syncRoutes:    Fastify plugin with push/pull/heartbeat endpoints
 *   - fleetRoutes:   Fastify plugin for fleet management (devices, upgrades)
 *   - MemoryAdapter: In-memory SyncDatabaseAdapter for testing/dev
 *   - createHmacVerifyHook: Standalone HMAC middleware (if you need it separately)
 *
 * Quick start:
 *   import Fastify from 'fastify';
 *   import { syncRoutes, fleetRoutes, MemoryAdapter } from '@edgeruntime/cloud-sync';
 *
 *   const app = Fastify();
 *   const adapter = new MemoryAdapter();
 *   const syncKey = process.env.CLOUD_SYNC_KEY!;
 *
 *   // Sync endpoints (edge devices call these)
 *   app.register(syncRoutes, { prefix: '/api/v1/sync', syncKey, adapter });
 *
 *   // Fleet management (admin dashboard calls these)
 *   app.register(fleetRoutes, { prefix: '/api/v1/fleet', adapter });
 *
 * For production, implement SyncDatabaseAdapter backed by your ORM/database.
 */

export { syncRoutes } from './sync-routes.js';
export { fleetRoutes, type FleetRoutesOptions } from './fleet-routes.js';
export { entityRoutes, type EntityRoutesOptions } from './entity-routes.js';
export { userRoutes, type UserRoutesOptions } from './user-routes.js';
export { dashboardRoutes, type DashboardRoutesOptions } from './dashboard-routes.js';
export { oauthRoutes, type OAuthRoutesOptions } from './oauth-routes.js';
export { deviceConfigRoutes, type DeviceConfigRoutesOptions } from './device-config-routes.js';

export { createHmacVerifyHook, type HmacVerifyOptions } from './hmac-verify.js';
export { MemoryAdapter } from './memory-adapter.js';
export { RealtimeChannel } from './realtime-channel.js';
export { loadHomepageHtml } from './homepage-loader.js';

export type {
  CloudSyncOptions,
  SyncDatabaseAdapter,
  LicenseDatabaseAdapter,
  OrgLicense,
  SyncEntity,
  PushRequest,
  PushResponse,
  PullRequest,
  PullResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  UpgradeCommand,
  EdgeDevice,
  FleetSummary,
  PeerInfo,
  LicenseStatus,
  LicenseInfo,
  OAuthProvider,
  DashboardUser,
  UserDatabaseAdapter,
  EntityQueryParams,
  EntityQueryResult,
  DeviceConfigPayload,
  DeviceConfigRecord,
  ConnectorConfigEntry,
  FederationPeerEntry,
  DeviceCommand,
} from './types.js';


export type {
  RealtimeCommand,
  RealtimeAck,
  RealtimeEvent,
  RealtimeChannelOptions,
} from './realtime-channel.js';
