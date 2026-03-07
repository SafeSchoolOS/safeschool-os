/**
 * EdgeRuntime Conflict Resolver
 *
 * Extensible per-entity conflict resolution for bidirectional sync.
 * Modules register their own conflict strategies via the ConflictResolver class.
 * Ported from SafeSchool and extended with a registry pattern.
 */

export type ConflictStrategy = 'cloud-wins' | 'edge-wins' | 'merge' | 'last-write-wins';

export interface SyncRecord {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

export type MergeFn = (local: SyncRecord, remote: SyncRecord) => SyncRecord;

/**
 * Alert status priority for merge resolution.
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
 * ConflictResolver - extensible conflict resolution registry.
 *
 * Ships with default SafeSchool strategies; modules can register additional
 * entity types and custom merge functions.
 */
export class ConflictResolver {
  private strategies: Map<string, ConflictStrategy> = new Map();
  private customMergers: Map<string, MergeFn> = new Map();

  constructor() {
    // Default strategies (from SafeSchool)
    this.registerStrategy('alert', 'merge');
    this.registerStrategy('user', 'cloud-wins');
    this.registerStrategy('site', 'cloud-wins');
    this.registerStrategy('building', 'cloud-wins');
    this.registerStrategy('room', 'cloud-wins');
    this.registerStrategy('door', 'edge-wins');
    this.registerStrategy('visitor', 'edge-wins');
    this.registerStrategy('lockdown_command', 'edge-wins');

    // Register built-in alert merger
    this.registerMerger('alert', mergeAlert);
  }

  /**
   * Register a conflict strategy for an entity type.
   * Modules call this to define how their entities are resolved.
   */
  registerStrategy(entityType: string, strategy: ConflictStrategy): void {
    this.strategies.set(entityType, strategy);
  }

  /**
   * Register a custom merge function for an entity type.
   * Only used when the strategy for that entity is 'merge'.
   */
  registerMerger(entityType: string, merger: MergeFn): void {
    this.customMergers.set(entityType, merger);
  }

  /**
   * Get the strategy for a given entity type.
   */
  getStrategy(entityType: string): ConflictStrategy {
    return this.strategies.get(entityType) ?? 'last-write-wins';
  }

  /**
   * Resolve a conflict between local and remote versions of an entity.
   */
  resolve(entityType: string, local: SyncRecord, remote: SyncRecord): SyncRecord {
    const strategy = this.getStrategy(entityType);

    switch (strategy) {
      case 'cloud-wins':
        return { ...remote };

      case 'edge-wins':
        return { ...local };

      case 'merge': {
        const merger = this.customMergers.get(entityType);
        if (merger) {
          return merger(local, remote);
        }
        // Fallback to last-write-wins if no merger registered
        return resolveLastWriteWins(local, remote);
      }

      case 'last-write-wins':
      default:
        return resolveLastWriteWins(local, remote);
    }
  }

  /**
   * Bulk-register strategies from a module's manifest.
   */
  registerFromManifest(strategies: Record<string, string>): void {
    for (const [entityType, strategy] of Object.entries(strategies)) {
      this.registerStrategy(entityType, strategy as ConflictStrategy);
    }
  }
}

function resolveLastWriteWins(local: SyncRecord, remote: SyncRecord): SyncRecord {
  const localTime = new Date(local.updatedAt).getTime();
  const remoteTime = new Date(remote.updatedAt).getTime();
  return remoteTime >= localTime ? { ...remote } : { ...local };
}

function mergeAlert(local: SyncRecord, remote: SyncRecord): SyncRecord {
  const merged: SyncRecord = { ...local };

  const localStatusIdx = ALERT_STATUS_PRIORITY.indexOf(local.status as string);
  const remoteStatusIdx = ALERT_STATUS_PRIORITY.indexOf(remote.status as string);
  if (remoteStatusIdx > localStatusIdx) {
    merged.status = remote.status;
  }

  if (!local.acknowledgedBy && remote.acknowledgedBy) {
    merged.acknowledgedBy = remote.acknowledgedBy;
    merged.acknowledgedAt = remote.acknowledgedAt;
  }

  if (local.triggeredAt && remote.triggeredAt) {
    const localTriggered = new Date(local.triggeredAt as string).getTime();
    const remoteTriggered = new Date(remote.triggeredAt as string).getTime();
    if (remoteTriggered < localTriggered) {
      merged.triggeredAt = remote.triggeredAt;
    }
  }

  if (!local.resolvedAt && remote.resolvedAt) {
    merged.resolvedAt = remote.resolvedAt;
  } else if (local.resolvedAt && remote.resolvedAt) {
    const localResolved = new Date(local.resolvedAt as string).getTime();
    const remoteResolved = new Date(remote.resolvedAt as string).getTime();
    if (remoteResolved > localResolved) {
      merged.resolvedAt = remote.resolvedAt;
    }
  }

  if (local.metadata || remote.metadata) {
    merged.metadata = {
      ...(remote.metadata as Record<string, unknown> ?? {}),
      ...(local.metadata as Record<string, unknown> ?? {}),
    };
  }

  const localTime = new Date(local.updatedAt).getTime();
  const remoteTime = new Date(remote.updatedAt).getTime();
  merged.updatedAt = remoteTime > localTime ? remote.updatedAt : local.updatedAt;

  return merged;
}
