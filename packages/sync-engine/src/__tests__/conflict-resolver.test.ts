import { describe, it, expect } from 'vitest';
import { ConflictResolver, type SyncRecord } from '../conflict-resolver.js';

describe('ConflictResolver', () => {
  const resolver = new ConflictResolver();

  const local: SyncRecord = {
    id: '1',
    updatedAt: '2024-06-01T10:00:00Z',
    name: 'Local Version',
  };

  const remote: SyncRecord = {
    id: '1',
    updatedAt: '2024-06-01T12:00:00Z',
    name: 'Remote Version',
  };

  it('should use cloud-wins for users', () => {
    const result = resolver.resolve('user', local, remote);
    expect(result.name).toBe('Remote Version');
  });

  it('should use edge-wins for doors', () => {
    const result = resolver.resolve('door', local, remote);
    expect(result.name).toBe('Local Version');
  });

  it('should use last-write-wins for unknown entities', () => {
    const result = resolver.resolve('custom_entity', local, remote);
    // Remote is newer
    expect(result.name).toBe('Remote Version');
  });

  it('should use last-write-wins when local is newer', () => {
    const newerLocal = { ...local, updatedAt: '2024-06-02T10:00:00Z' };
    const result = resolver.resolve('custom_entity', newerLocal, remote);
    expect(result.name).toBe('Local Version');
  });

  it('should merge alerts using status priority', () => {
    const localAlert: SyncRecord = {
      id: '1',
      updatedAt: '2024-06-01T10:00:00Z',
      status: 'TRIGGERED',
    };
    const remoteAlert: SyncRecord = {
      id: '1',
      updatedAt: '2024-06-01T12:00:00Z',
      status: 'ACKNOWLEDGED',
      acknowledgedBy: 'user1',
      acknowledgedAt: '2024-06-01T11:00:00Z',
    };

    const result = resolver.resolve('alert', localAlert, remoteAlert);
    expect(result.status).toBe('ACKNOWLEDGED');
    expect(result.acknowledgedBy).toBe('user1');
  });

  it('should allow modules to register custom strategies', () => {
    resolver.registerStrategy('badge', 'edge-wins');
    const result = resolver.resolve('badge', local, remote);
    expect(result.name).toBe('Local Version');
  });

  it('should allow modules to register custom merge functions', () => {
    resolver.registerStrategy('custom_merge', 'merge');
    resolver.registerMerger('custom_merge', (l, r) => ({
      ...l,
      ...r,
      merged: true,
    }));

    const result = resolver.resolve('custom_merge', local, remote);
    expect(result.merged).toBe(true);
  });

  it('should bulk-register from manifest', () => {
    resolver.registerFromManifest({
      visitor: 'edge-wins',
      check_in: 'edge-wins',
    });
    expect(resolver.getStrategy('visitor')).toBe('edge-wins');
    expect(resolver.getStrategy('check_in')).toBe('edge-wins');
  });
});
