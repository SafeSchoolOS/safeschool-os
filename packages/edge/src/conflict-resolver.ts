/**
 * SafeSchool Conflict Resolver
 *
 * Per-entity conflict resolution for bidirectional sync between edge and cloud.
 *
 * Strategies by entity type:
 * - Alerts: merge (combine acknowledgments, use latest status)
 * - Users/Sites: cloud-wins (cloud is authoritative for configuration)
 * - Doors: edge-wins (edge has real-time hardware state)
 * - Visitors: edge-wins for check-in/check-out (edge is authoritative)
 * - Default: last-write-wins using updatedAt timestamp
 */

export type ConflictStrategy = 'cloud-wins' | 'edge-wins' | 'merge' | 'last-write-wins';

export interface SyncRecord {
  id: string;
  updatedAt: string; // ISO-8601 timestamp
  [key: string]: unknown;
}

/**
 * Map of entity types to their conflict resolution strategy.
 */
const ENTITY_STRATEGIES: Record<string, ConflictStrategy> = {
  alert: 'merge',
  user: 'cloud-wins',
  site: 'cloud-wins',
  building: 'cloud-wins',
  room: 'cloud-wins',
  door: 'edge-wins',
  visitor: 'edge-wins',
  lockdown_command: 'edge-wins',
};

/**
 * Status priority for alerts. Higher index = more progressed state.
 */
const ALERT_STATUS_PRIORITY: string[] = [
  'TRIGGERED',
  'ACKNOWLEDGED',
  'DISPATCHED',
  'RESPONDING',
  'RESOLVED',
  'CANCELLED',
];

/**
 * Get the conflict resolution strategy for a given entity type.
 */
export function getStrategy(entityType: string): ConflictStrategy {
  return ENTITY_STRATEGIES[entityType] ?? 'last-write-wins';
}

/**
 * Resolve a conflict between a local (edge) version and remote (cloud) version
 * of the same entity.
 *
 * @param entityType - The type of entity (alert, user, door, visitor, etc.)
 * @param local - The local (edge) version of the entity
 * @param remote - The remote (cloud) version of the entity
 * @returns The resolved entity to keep
 */
export function resolveConflict(
  entityType: string,
  local: SyncRecord,
  remote: SyncRecord,
): SyncRecord {
  const strategy = getStrategy(entityType);

  switch (strategy) {
    case 'cloud-wins':
      return resolveCloudWins(local, remote);

    case 'edge-wins':
      return resolveEdgeWins(local, remote);

    case 'merge':
      return resolveMerge(entityType, local, remote);

    case 'last-write-wins':
    default:
      return resolveLastWriteWins(local, remote);
  }
}

/**
 * Cloud-wins: always take the remote (cloud) version.
 * Used for Users, Sites, Buildings, Rooms - cloud is authoritative for configuration.
 */
function resolveCloudWins(_local: SyncRecord, remote: SyncRecord): SyncRecord {
  return { ...remote };
}

/**
 * Edge-wins: always take the local (edge) version.
 * Used for Doors (real-time hardware state) and Visitors (check-in/out at edge).
 */
function resolveEdgeWins(local: SyncRecord, _remote: SyncRecord): SyncRecord {
  return { ...local };
}

/**
 * Merge: combine fields from both versions intelligently.
 * Used for Alerts - combine acknowledgments, use latest status.
 */
function resolveMerge(
  entityType: string,
  local: SyncRecord,
  remote: SyncRecord,
): SyncRecord {
  if (entityType === 'alert') {
    return mergeAlert(local, remote);
  }
  // Fallback to last-write-wins for unknown merge types
  return resolveLastWriteWins(local, remote);
}

/**
 * Merge alert records:
 * - Use the more-progressed status
 * - Combine acknowledgment data (if one side acknowledged and the other didn't)
 * - Take the most recent updatedAt
 * - Merge metadata from both sides
 */
function mergeAlert(local: SyncRecord, remote: SyncRecord): SyncRecord {
  const merged: SyncRecord = { ...local };

  // Use the more-progressed status
  const localStatusIdx = ALERT_STATUS_PRIORITY.indexOf(local.status as string);
  const remoteStatusIdx = ALERT_STATUS_PRIORITY.indexOf(remote.status as string);

  if (remoteStatusIdx > localStatusIdx) {
    merged.status = remote.status;
  }

  // Combine acknowledgment: take whichever side has acknowledgment data
  if (!local.acknowledgedBy && remote.acknowledgedBy) {
    merged.acknowledgedBy = remote.acknowledgedBy;
    merged.acknowledgedAt = remote.acknowledgedAt;
  }

  // Take the earlier triggeredAt (first detection)
  if (local.triggeredAt && remote.triggeredAt) {
    const localTriggered = new Date(local.triggeredAt as string).getTime();
    const remoteTriggered = new Date(remote.triggeredAt as string).getTime();
    if (remoteTriggered < localTriggered) {
      merged.triggeredAt = remote.triggeredAt;
    }
  }

  // Take the latest resolvedAt
  if (!local.resolvedAt && remote.resolvedAt) {
    merged.resolvedAt = remote.resolvedAt;
  } else if (local.resolvedAt && remote.resolvedAt) {
    const localResolved = new Date(local.resolvedAt as string).getTime();
    const remoteResolved = new Date(remote.resolvedAt as string).getTime();
    if (remoteResolved > localResolved) {
      merged.resolvedAt = remote.resolvedAt;
    }
  }

  // Merge metadata from both sides
  if (local.metadata || remote.metadata) {
    merged.metadata = {
      ...(remote.metadata as Record<string, unknown> ?? {}),
      ...(local.metadata as Record<string, unknown> ?? {}),
    };
  }

  // Use the most recent updatedAt
  const localTime = new Date(local.updatedAt).getTime();
  const remoteTime = new Date(remote.updatedAt).getTime();
  merged.updatedAt = remoteTime > localTime ? remote.updatedAt : local.updatedAt;

  return merged;
}

/**
 * Last-write-wins: use whichever version has the most recent updatedAt.
 * Default fallback strategy.
 */
function resolveLastWriteWins(local: SyncRecord, remote: SyncRecord): SyncRecord {
  const localTime = new Date(local.updatedAt).getTime();
  const remoteTime = new Date(remote.updatedAt).getTime();

  if (remoteTime >= localTime) {
    return { ...remote };
  }
  return { ...local };
}
