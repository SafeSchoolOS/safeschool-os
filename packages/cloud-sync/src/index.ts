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

export { getUser, getUsername, getUserRole, getOrgId, getIpAddress } from './route-helpers.js';
export { syncRoutes } from './sync-routes.js';
export { fleetRoutes, type FleetRoutesOptions } from './fleet-routes.js';
export { entityRoutes, type EntityRoutesOptions } from './entity-routes.js';
export { userRoutes, type UserRoutesOptions } from './user-routes.js';
export { dashboardRoutes, type DashboardRoutesOptions } from './dashboard-routes.js';
export { oauthRoutes, type OAuthRoutesOptions } from './oauth-routes.js';
export { deviceConfigRoutes, type DeviceConfigRoutesOptions } from './device-config-routes.js';

export { createHmacVerifyHook, type HmacVerifyOptions } from './hmac-verify.js';
export { MemoryAdapter } from './memory-adapter.js';
export { PostgresAdapter } from './postgres-adapter.js';
export { backupRoutes, startDemoResetCron, type BackupRoutesOptions } from './backup-routes.js';
export { startPacEmulator, stopPacEmulator, generateDemoSeed } from './pac-emulator.js';
export { DemoEmulator, startDemoEmulator, stopDemoEmulator, getDemoEmulatorStats, type DemoEmulatorStats } from './demo-emulator.js';
export { seedDemoData, type SeedResult } from './demo-seed.js';
export { incidentRoutes, type IncidentRoutesOptions } from './incident-routes.js';
export { visitorRoutes, type VisitorRoutesOptions } from './visitor-routes.js';
export { panicRoutes, type PanicRoutesOptions } from './panic-routes.js';
export { alarmRoutes, alarmIngestRoute, type AlarmRoutesOptions } from './alarm-routes.js';
export { drillRoutes, type DrillRoutesOptions } from './drill-routes.js';
export { auditRoutes, type AuditRoutesOptions } from './audit-routes.js';
export { signinFlowRoutes, type SigninFlowRoutesOptions } from './signin-flow-routes.js';
export { guardRoutes, type GuardRoutesOptions } from './guard-routes.js';
export { notificationRoutes, type NotificationRoutesOptions } from './notification-routes.js';
export { floorplanRoutes, type FloorplanRoutesOptions } from './floorplan-routes.js';
export { tipRoutes, type TipRoutesOptions } from './tip-routes.js';
export { contractorRoutes, type ContractorRoutesOptions } from './contractor-routes.js';
export { caseRoutes, type CaseRoutesOptions } from './case-routes.js';
export { channelRoutes, type ChannelRoutesOptions } from './channel-routes.js';
export { reunificationRoutes, type ReunificationRoutesOptions } from './reunification-routes.js';
export { threatRoutes, type ThreatRoutesOptions } from './threat-routes.js';
export { sensorRoutes, sensorIngestRoute, type SensorRoutesOptions } from './sensor-routes.js';
export { riskRoutes, type RiskRoutesOptions } from './risk-routes.js';
export { healthRoutes, healthIngestRoute, type HealthRoutesOptions } from './health-routes.js';
export { analyticsRoutes, analyticsIngestRoute, type AnalyticsRoutesOptions } from './analytics-routes.js';
export { uebaRoutes, type UebaRoutesOptions } from './ueba-routes.js';
export { hallpassRoutes, type HallpassRoutesOptions } from './hallpass-routes.js';
export { grantRoutes, type GrantRoutesOptions } from './grant-routes.js';
export { tenantRoutes, type TenantRoutesOptions } from './tenant-routes.js';
export { passRoutes, type PassRoutesOptions } from './pass-routes.js';
export { buildingRoutes, type BuildingRoutesOptions } from './building-routes.js';
export { agencyRoutes, type AgencyRoutesOptions } from './agency-routes.js';
export { webhookRoutes, apiDocsRoute, type WebhookRoutesOptions } from './webhook-routes.js';
export { nlqueryRoutes, type NlqueryRoutesOptions } from './nlquery-routes.js';
export { postureRoutes, type PostureRoutesOptions } from './posture-routes.js';
export { siemRoutes, type SiemRoutesOptions } from './siem-routes.js';
export { briefingRoutes, type BriefingRoutesOptions } from './briefing-routes.js';
export { multisiteRoutes, type MultisiteRoutesOptions } from './multisite-routes.js';
export { widgetRoutes, type WidgetRoutesOptions } from './widget-routes.js';
export { ticketRoutes, type TicketRoutesOptions } from './ticket-routes.js';
export { vmsRoutes, type VmsRoutesOptions } from './vms-routes.js';
export { accountRoutes, type AccountRoutesOptions } from './account-routes.js';
export { gsocEnterpriseRoutes, type GsocEnterpriseRoutesOptions } from './gsoc-enterprise-routes.js';
export { pairingRoutes, type PairingRoutesOptions } from './pairing-routes.js';
export { recipeRoutes, type RecipeRoutesOptions, type RecipeUIDef } from './recipe-routes.js';
export { adapterRegistryRoutes, type AdapterRegistryRoutesOptions } from './adapter-registry-routes.js';
export { resolveUpdates, type UpdateDirective, type UpdateCheckRequest, type UpdateCheckResponse } from './adapter-update-resolver.js';
export { telephonyRoutes, telephonyVoiceRoutes, type TelephonyRoutesOptions } from './telephony-routes.js';
export { badgeRoutes, type BadgeRoutesOptions } from './badge-routes.js';
export { packageRoutes, type PackageRoutesOptions } from './package-routes.js';
export { buildAdapterManifest, buildAndWriteManifest, type AdapterManifest, type AdapterManifestEntry, type AdapterManifestCategory } from './adapter-manifest.js';
export { cardholderSyncRoutes, type CardholderSyncRoutesOptions } from './cardholder-sync-routes.js';
export { aiInsightsRoutes, type AiInsightsRoutesOptions } from './ai-insights-routes.js';
export { configuratorRoutes, type ConfiguratorRoutesOptions } from './configurator-routes.js';
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
