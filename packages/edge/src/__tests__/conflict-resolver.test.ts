import { describe, it, expect } from 'vitest';
import {
  resolveConflict,
  getStrategy,
  type SyncRecord,
} from '../conflict-resolver.js';

describe('ConflictResolver', () => {
  // ==========================================================================
  // getStrategy
  // ==========================================================================

  describe('getStrategy', () => {
    it('returns merge for alerts', () => {
      expect(getStrategy('alert')).toBe('merge');
    });

    it('returns cloud-wins for users', () => {
      expect(getStrategy('user')).toBe('cloud-wins');
    });

    it('returns cloud-wins for sites', () => {
      expect(getStrategy('site')).toBe('cloud-wins');
    });

    it('returns cloud-wins for buildings', () => {
      expect(getStrategy('building')).toBe('cloud-wins');
    });

    it('returns cloud-wins for rooms', () => {
      expect(getStrategy('room')).toBe('cloud-wins');
    });

    it('returns edge-wins for doors', () => {
      expect(getStrategy('door')).toBe('edge-wins');
    });

    it('returns edge-wins for visitors', () => {
      expect(getStrategy('visitor')).toBe('edge-wins');
    });

    it('returns edge-wins for lockdown_command', () => {
      expect(getStrategy('lockdown_command')).toBe('edge-wins');
    });

    it('returns last-write-wins for unknown entity types', () => {
      expect(getStrategy('unknown_entity')).toBe('last-write-wins');
      expect(getStrategy('audit_log')).toBe('last-write-wins');
    });
  });

  // ==========================================================================
  // cloud-wins strategy
  // ==========================================================================

  describe('cloud-wins (users, sites, buildings, rooms)', () => {
    it('always returns the remote (cloud) version for users', () => {
      const local: SyncRecord = {
        id: 'u1',
        updatedAt: '2026-02-07T12:00:00Z',
        name: 'Local Name',
        email: 'local@example.com',
      };
      const remote: SyncRecord = {
        id: 'u1',
        updatedAt: '2026-02-07T11:00:00Z', // older, but cloud still wins
        name: 'Cloud Name',
        email: 'cloud@example.com',
      };

      const resolved = resolveConflict('user', local, remote);
      expect(resolved.name).toBe('Cloud Name');
      expect(resolved.email).toBe('cloud@example.com');
    });

    it('always returns the remote version for sites even if local is newer', () => {
      const local: SyncRecord = {
        id: 's1',
        updatedAt: '2026-02-07T15:00:00Z',
        name: 'Local School',
      };
      const remote: SyncRecord = {
        id: 's1',
        updatedAt: '2026-02-07T10:00:00Z',
        name: 'Cloud School',
      };

      const resolved = resolveConflict('site', local, remote);
      expect(resolved.name).toBe('Cloud School');
    });

    it('returns a copy (not the same reference) of the remote object', () => {
      const remote: SyncRecord = {
        id: 'b1',
        updatedAt: '2026-02-07T10:00:00Z',
        name: 'Building A',
      };
      const local: SyncRecord = {
        id: 'b1',
        updatedAt: '2026-02-07T12:00:00Z',
        name: 'Building Local',
      };

      const resolved = resolveConflict('building', local, remote);
      expect(resolved).toEqual(remote);
      expect(resolved).not.toBe(remote);
    });
  });

  // ==========================================================================
  // edge-wins strategy
  // ==========================================================================

  describe('edge-wins (doors, visitors)', () => {
    it('always returns the local (edge) version for doors', () => {
      const local: SyncRecord = {
        id: 'd1',
        updatedAt: '2026-02-07T12:00:00Z',
        status: 'LOCKED',
        name: 'Main Entrance',
      };
      const remote: SyncRecord = {
        id: 'd1',
        updatedAt: '2026-02-07T12:05:00Z', // newer, but edge still wins
        status: 'UNLOCKED',
        name: 'Main Entrance',
      };

      const resolved = resolveConflict('door', local, remote);
      expect(resolved.status).toBe('LOCKED');
    });

    it('always returns the local version for visitors', () => {
      const local: SyncRecord = {
        id: 'v1',
        updatedAt: '2026-02-07T08:30:00Z',
        status: 'CHECKED_IN',
        checkedInAt: '2026-02-07T08:30:00Z',
      };
      const remote: SyncRecord = {
        id: 'v1',
        updatedAt: '2026-02-07T09:00:00Z',
        status: 'PRE_REGISTERED',
      };

      const resolved = resolveConflict('visitor', local, remote);
      expect(resolved.status).toBe('CHECKED_IN');
      expect(resolved.checkedInAt).toBe('2026-02-07T08:30:00Z');
    });

    it('always returns the local version for lockdown_command (edge is authoritative)', () => {
      const local: SyncRecord = {
        id: 'lc1',
        updatedAt: '2026-02-07T10:00:00Z',
        releasedAt: null,
        doorsLocked: 8,
      };
      const remote: SyncRecord = {
        id: 'lc1',
        updatedAt: '2026-02-07T10:05:00Z',
        releasedAt: '2026-02-07T10:05:00Z', // cloud says released, but edge wins
        doorsLocked: 8,
      };

      const resolved = resolveConflict('lockdown_command', local, remote);
      expect(resolved.releasedAt).toBeNull();
      expect(resolved.doorsLocked).toBe(8);
    });

    it('returns a copy (not the same reference) of the local object', () => {
      const local: SyncRecord = {
        id: 'd1',
        updatedAt: '2026-02-07T12:00:00Z',
        status: 'FORCED',
      };
      const remote: SyncRecord = {
        id: 'd1',
        updatedAt: '2026-02-07T12:00:00Z',
        status: 'LOCKED',
      };

      const resolved = resolveConflict('door', local, remote);
      expect(resolved).toEqual(local);
      expect(resolved).not.toBe(local);
    });
  });

  // ==========================================================================
  // merge strategy (alerts)
  // ==========================================================================

  describe('merge (alerts)', () => {
    it('uses the more-progressed status', () => {
      const local: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:00:00Z',
        status: 'TRIGGERED',
      };
      const remote: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:01:00Z',
        status: 'ACKNOWLEDGED',
      };

      const resolved = resolveConflict('alert', local, remote);
      expect(resolved.status).toBe('ACKNOWLEDGED');
    });

    it('keeps local status when local is more progressed', () => {
      const local: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:05:00Z',
        status: 'DISPATCHED',
      };
      const remote: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:01:00Z',
        status: 'ACKNOWLEDGED',
      };

      const resolved = resolveConflict('alert', local, remote);
      expect(resolved.status).toBe('DISPATCHED');
    });

    it('combines acknowledgment from remote when local has none', () => {
      const local: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:00:00Z',
        status: 'TRIGGERED',
        acknowledgedBy: undefined,
        acknowledgedAt: undefined,
      };
      const remote: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:01:00Z',
        status: 'ACKNOWLEDGED',
        acknowledgedBy: 'user-1',
        acknowledgedAt: '2026-02-07T12:01:00Z',
      };

      const resolved = resolveConflict('alert', local, remote);
      expect(resolved.acknowledgedBy).toBe('user-1');
      expect(resolved.acknowledgedAt).toBe('2026-02-07T12:01:00Z');
    });

    it('keeps local acknowledgment when remote has none', () => {
      const local: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:01:00Z',
        status: 'ACKNOWLEDGED',
        acknowledgedBy: 'user-edge',
        acknowledgedAt: '2026-02-07T12:01:00Z',
      };
      const remote: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:00:00Z',
        status: 'TRIGGERED',
      };

      const resolved = resolveConflict('alert', local, remote);
      expect(resolved.acknowledgedBy).toBe('user-edge');
    });

    it('takes the earlier triggeredAt (first detection)', () => {
      const local: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:02:00Z',
        status: 'TRIGGERED',
        triggeredAt: '2026-02-07T12:01:00Z',
      };
      const remote: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:02:00Z',
        status: 'TRIGGERED',
        triggeredAt: '2026-02-07T12:00:30Z', // earlier
      };

      const resolved = resolveConflict('alert', local, remote);
      expect(resolved.triggeredAt).toBe('2026-02-07T12:00:30Z');
    });

    it('takes the latest resolvedAt', () => {
      const local: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T13:00:00Z',
        status: 'RESOLVED',
        resolvedAt: '2026-02-07T12:50:00Z',
      };
      const remote: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T13:00:00Z',
        status: 'RESOLVED',
        resolvedAt: '2026-02-07T12:55:00Z', // later
      };

      const resolved = resolveConflict('alert', local, remote);
      expect(resolved.resolvedAt).toBe('2026-02-07T12:55:00Z');
    });

    it('takes remote resolvedAt when local has none', () => {
      const local: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T13:00:00Z',
        status: 'ACKNOWLEDGED',
      };
      const remote: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T13:00:00Z',
        status: 'RESOLVED',
        resolvedAt: '2026-02-07T12:55:00Z',
      };

      const resolved = resolveConflict('alert', local, remote);
      expect(resolved.resolvedAt).toBe('2026-02-07T12:55:00Z');
    });

    it('merges metadata from both sides (local takes precedence on conflicts)', () => {
      const local: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:00:00Z',
        status: 'TRIGGERED',
        metadata: { edgeInfo: 'from-edge', shared: 'edge-value' },
      };
      const remote: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:00:00Z',
        status: 'TRIGGERED',
        metadata: { cloudInfo: 'from-cloud', shared: 'cloud-value' },
      };

      const resolved = resolveConflict('alert', local, remote);
      const metadata = resolved.metadata as Record<string, unknown>;
      expect(metadata.edgeInfo).toBe('from-edge');
      expect(metadata.cloudInfo).toBe('from-cloud');
      // Local takes precedence on shared keys
      expect(metadata.shared).toBe('edge-value');
    });

    it('uses the most recent updatedAt', () => {
      const local: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:05:00Z',
        status: 'TRIGGERED',
      };
      const remote: SyncRecord = {
        id: 'a1',
        updatedAt: '2026-02-07T12:10:00Z',
        status: 'TRIGGERED',
      };

      const resolved = resolveConflict('alert', local, remote);
      expect(resolved.updatedAt).toBe('2026-02-07T12:10:00Z');
    });
  });

  // ==========================================================================
  // last-write-wins strategy (default / unknown entity types)
  // ==========================================================================

  describe('last-write-wins (default)', () => {
    it('returns the remote version when remote is newer', () => {
      const local: SyncRecord = {
        id: 'x1',
        updatedAt: '2026-02-07T12:00:00Z',
        value: 'local',
      };
      const remote: SyncRecord = {
        id: 'x1',
        updatedAt: '2026-02-07T12:05:00Z',
        value: 'remote',
      };

      const resolved = resolveConflict('audit_log', local, remote);
      expect(resolved.value).toBe('remote');
    });

    it('returns the local version when local is newer', () => {
      const local: SyncRecord = {
        id: 'x1',
        updatedAt: '2026-02-07T12:10:00Z',
        value: 'local',
      };
      const remote: SyncRecord = {
        id: 'x1',
        updatedAt: '2026-02-07T12:05:00Z',
        value: 'remote',
      };

      const resolved = resolveConflict('audit_log', local, remote);
      expect(resolved.value).toBe('local');
    });

    it('returns remote when timestamps are equal (tie goes to remote)', () => {
      const local: SyncRecord = {
        id: 'x1',
        updatedAt: '2026-02-07T12:00:00Z',
        value: 'local',
      };
      const remote: SyncRecord = {
        id: 'x1',
        updatedAt: '2026-02-07T12:00:00Z',
        value: 'remote',
      };

      const resolved = resolveConflict('audit_log', local, remote);
      expect(resolved.value).toBe('remote');
    });

    it('applies to unknown entity types', () => {
      const local: SyncRecord = {
        id: 'custom1',
        updatedAt: '2026-02-07T14:00:00Z',
        data: 'local-data',
      };
      const remote: SyncRecord = {
        id: 'custom1',
        updatedAt: '2026-02-07T13:00:00Z',
        data: 'remote-data',
      };

      const resolved = resolveConflict('some_new_entity', local, remote);
      expect(resolved.data).toBe('local-data');
    });
  });
});
