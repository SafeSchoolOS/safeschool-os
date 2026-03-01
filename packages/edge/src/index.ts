// Sync engine
export { SyncClient, SyncClientError } from './sync-client.js';
export type {
  SyncClientConfig,
  SyncEntity,
  PushRequest,
  PushResponse,
  PullResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  UpgradeCommand,
  PeerInfo,
} from './sync-client.js';
export { SyncEngine } from './sync-engine.js';
export { OfflineQueue } from './offline-queue.js';
export type { QueuedOperation, QueueStats } from './offline-queue.js';
export { HealthMonitor } from './health-monitor.js';
export type { HealthCheckResult, HealthMonitorConfig, ModeChangeCallback, HealthStatus } from './health-monitor.js';
export { getStrategy, resolveConflict } from './conflict-resolver.js';
export type { ConflictStrategy, SyncRecord } from './conflict-resolver.js';

// Logger & error types
export { createLogger, SyncError, ConnectorError } from './edge-logger.js';
export type { Logger } from './edge-logger.js';

// Connector framework
export {
  BaseConnector,
  ConnectorRegistry,
  LenelOnGuardConnector,
  MilestoneXProtectConnector,
  FireAlarmConnector,
  IntrusionPanelConnector,
  IntercomConnector,
} from './connectors/index.js';
export type {
  ConnectorConfig,
  ConnectorStatus,
  EventHandler,
  LenelConfig,
  MilestoneConfig,
  FireAlarmConfig,
  IntrusionConfig,
  IntercomConfig,
} from './connectors/index.js';

// Federation
export { FederationManager } from './federation-manager.js';
export type {
  ProductFlag,
  FederationPeer,
  FederationRoute,
  FederationConfig,
  FederationManagerConfig,
  FederationStatus,
  FederationEventHandler,
} from './federation-manager.js';
