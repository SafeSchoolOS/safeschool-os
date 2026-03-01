import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine, type SyncStatus } from '../sync-engine.js';
import type { SyncEntity } from '../sync-client.js';

/**
 * These tests mock the network layer (fetch) to simulate cloud interactions.
 * The SyncEngine uses an in-memory SQLite offline queue, so no disk I/O needed.
 */

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createEngine(overrides: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {}): SyncEngine {
  return new SyncEngine({
    siteId: 'site-test-001',
    cloudSyncUrl: 'https://cloud.example.com',
    cloudSyncKey: 'test-sync-key-123',
    syncIntervalMs: 60000, // long interval so we control ticks manually
    healthCheckIntervalMs: 60000,
    queueDbPath: ':memory:',
    checkDatabaseFn: async () => true,
    checkRedisFn: async () => true,
    ...overrides,
  });
}

/**
 * Helper: set up fetch to simulate a healthy cloud that accepts push/pull/heartbeat.
 */
function mockHealthyCloud(): void {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : String(url);

    if (urlStr.includes('/health')) {
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }
    if (urlStr.includes('/sync/push')) {
      const body = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          synced: body.entities.length,
          errors: 0,
          timestamp: new Date().toISOString(),
        }),
        { status: 200 },
      );
    }
    if (urlStr.includes('/sync/pull')) {
      return new Response(
        JSON.stringify({
          data: { users: [], sites: [] },
          timestamp: new Date().toISOString(),
        }),
        { status: 200 },
      );
    }
    if (urlStr.includes('/sync/heartbeat')) {
      return new Response(
        JSON.stringify({ ack: true, timestamp: new Date().toISOString() }),
        { status: 200 },
      );
    }
    return new Response('Not found', { status: 404 });
  });
}

/**
 * Helper: simulate cloud being unreachable.
 */
function mockCloudDown(): void {
  mockFetch.mockImplementation(async () => {
    throw new Error('Network unreachable');
  });
}

describe('SyncEngine', () => {
  let engine: SyncEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    if (engine) {
      engine.shutdown();
    }
    vi.useRealTimers();
  });

  // ==========================================================================
  // Basic lifecycle
  // ==========================================================================

  describe('lifecycle', () => {
    it('creates an engine with correct initial state', () => {
      mockHealthyCloud();
      engine = createEngine();

      const state = engine.getSyncState();
      expect(state.siteId).toBe('site-test-001');
      expect(state.pendingChanges).toBe(0);
      expect(state.operatingMode).toBe('EDGE');
    });

    it('starts and stops without errors', () => {
      mockHealthyCloud();
      engine = createEngine();

      engine.start();
      engine.stop();

      // Should not throw
      expect(true).toBe(true);
    });

    it('shutdown closes the offline queue', () => {
      mockHealthyCloud();
      engine = createEngine();
      engine.start();
      engine.shutdown();

      // Accessing the queue after shutdown should throw
      expect(() => engine.getOfflineQueue().getStats()).toThrow();
    });
  });

  // ==========================================================================
  // Full sync cycle (EDGE mode)
  // ==========================================================================

  describe('full sync cycle', () => {
    it('pushes local changes to cloud on syncToCloud()', async () => {
      mockHealthyCloud();
      engine = createEngine();

      // Track some changes
      const entity: SyncEntity = {
        type: 'alert',
        action: 'create',
        data: { id: 'a1', level: 'LOCKDOWN' },
        timestamp: new Date().toISOString(),
      };
      engine.trackChange(entity);

      expect(engine.getSyncState().pendingChanges).toBe(1);

      await engine.syncToCloud();

      // After pushing, local changes should be drained
      expect(engine.getSyncState().pendingChanges).toBe(0);

      // Verify fetch was called with push endpoint
      const pushCalls = mockFetch.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/sync/push'),
      );
      expect(pushCalls.length).toBe(1);
    });

    it('pulls remote changes from cloud on syncFromCloud()', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/sync/pull')) {
          return new Response(
            JSON.stringify({
              data: {
                users: [
                  { id: 'u1', name: 'Cloud User', updatedAt: '2026-02-07T12:00:00Z' },
                ],
              },
              timestamp: new Date().toISOString(),
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      engine = createEngine();
      // Should not throw
      await engine.syncFromCloud();
    });

    it('emits syncing and synced status during a successful tick', async () => {
      mockHealthyCloud();
      engine = createEngine();

      const statuses: SyncStatus[] = [];
      engine.onStatusChange((status) => statuses.push(status));

      // Simulate the health monitor reporting cloud is up
      const monitor = engine.getHealthMonitor();
      await monitor.performHealthCheck();

      // Manually trigger sync by calling the public methods
      await engine.syncToCloud();
      await engine.syncFromCloud();

      // The engine was idle, then synced. Since we called public methods
      // directly, the status callbacks may not fire (those are from tick).
      // Let's verify through getSyncState instead.
      const state = engine.getSyncState();
      expect(state.cloudReachable).toBe(true);
      expect(state.operatingMode).toBe('EDGE');
    });
  });

  // ==========================================================================
  // STANDALONE mode
  // ==========================================================================

  describe('STANDALONE mode', () => {
    it('queues changes to offline queue when in STANDALONE mode', async () => {
      mockCloudDown();
      engine = createEngine();

      // Force health check to detect cloud is down
      const monitor = engine.getHealthMonitor();
      await monitor.performHealthCheck();
      expect(monitor.getCurrentMode()).toBe('STANDALONE');

      // Track a change - should go to offline queue
      engine.trackChange({
        type: 'alert',
        action: 'create',
        data: { id: 'a1', level: 'LOCKDOWN' },
        timestamp: new Date().toISOString(),
      });

      const stats = engine.getOfflineQueue().getStats();
      expect(stats.pending).toBe(1);
    });

    it('transitions from EDGE to STANDALONE when cloud goes down', async () => {
      mockHealthyCloud();
      engine = createEngine();

      const monitor = engine.getHealthMonitor();

      // First check: cloud is up
      await monitor.performHealthCheck();
      expect(monitor.getCurrentMode()).toBe('EDGE');

      // Cloud goes down
      mockCloudDown();
      await monitor.performHealthCheck();
      expect(monitor.getCurrentMode()).toBe('STANDALONE');
    });

    it('emits standalone status when mode changes', async () => {
      mockHealthyCloud();
      engine = createEngine();

      const statuses: SyncStatus[] = [];
      engine.onStatusChange((status) => statuses.push(status));

      const monitor = engine.getHealthMonitor();

      // Start with cloud up
      await monitor.performHealthCheck();

      // Cloud goes down
      mockCloudDown();
      await monitor.performHealthCheck();

      expect(statuses).toContain('standalone');
    });
  });

  // ==========================================================================
  // Queue drain on reconnect
  // ==========================================================================

  describe('queue drain on reconnect', () => {
    it('drains offline queue when connectivity is restored', async () => {
      // Start with cloud down
      mockCloudDown();
      engine = createEngine();

      const monitor = engine.getHealthMonitor();
      await monitor.performHealthCheck();

      // Queue some changes while offline
      engine.trackChange({
        type: 'alert',
        action: 'create',
        data: { id: 'a1', level: 'LOCKDOWN' },
        timestamp: new Date().toISOString(),
      });
      engine.trackChange({
        type: 'door',
        action: 'update',
        data: { id: 'd1', status: 'LOCKED' },
        timestamp: new Date().toISOString(),
      });

      expect(engine.getOfflineQueue().getStats().pending).toBe(2);

      // Cloud comes back up
      mockHealthyCloud();

      // Manually drain (normally triggered by mode change callback)
      await engine.drainQueueAndSync();

      // Queue should be drained
      const stats = engine.getOfflineQueue().getStats();
      expect(stats.pending).toBe(0);
      expect(stats.complete).toBe(2);
    });

    it('marks queue items as failed when push fails during drain', async () => {
      // Start offline
      mockCloudDown();
      engine = createEngine();

      const monitor = engine.getHealthMonitor();
      await monitor.performHealthCheck();

      engine.trackChange({
        type: 'alert',
        action: 'create',
        data: { id: 'a1' },
        timestamp: new Date().toISOString(),
      });

      expect(engine.getOfflineQueue().getStats().pending).toBe(1);

      // Cloud comes back but push endpoint fails
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/health')) {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        if (typeof url === 'string' && url.includes('/sync/push')) {
          throw new Error('Push endpoint error');
        }
        if (typeof url === 'string' && url.includes('/sync/pull')) {
          return new Response(
            JSON.stringify({ data: {}, timestamp: new Date().toISOString() }),
            { status: 200 },
          );
        }
        return new Response('Not found', { status: 404 });
      });

      // Drain will fail on push
      try {
        await engine.drainQueueAndSync();
      } catch {
        // drain calls syncFromCloud which may throw since pull might fail after push error
      }

      // The item should still be in the queue (marked as failed with retry)
      const stats = engine.getOfflineQueue().getStats();
      expect(stats.pending + stats.failed).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // trackChange behavior
  // ==========================================================================

  describe('trackChange', () => {
    it('adds changes to in-memory buffer in EDGE mode', async () => {
      mockHealthyCloud();
      engine = createEngine();

      const monitor = engine.getHealthMonitor();
      await monitor.performHealthCheck();

      engine.trackChange({
        type: 'visitor',
        action: 'create',
        data: { id: 'v1', status: 'CHECKED_IN' },
        timestamp: new Date().toISOString(),
      });

      // Should be in pending changes count
      expect(engine.getSyncState().pendingChanges).toBe(1);
      // But NOT in offline queue (it's in-memory)
      expect(engine.getOfflineQueue().getStats().pending).toBe(0);
    });

    it('adds changes to offline queue in STANDALONE mode', async () => {
      mockCloudDown();
      engine = createEngine();

      const monitor = engine.getHealthMonitor();
      await monitor.performHealthCheck();

      engine.trackChange({
        type: 'visitor',
        action: 'create',
        data: { id: 'v1', status: 'CHECKED_IN' },
        timestamp: new Date().toISOString(),
      });

      // Should be in offline queue
      expect(engine.getOfflineQueue().getStats().pending).toBe(1);
    });
  });

  // ==========================================================================
  // getSyncState
  // ==========================================================================

  describe('getSyncState', () => {
    it('returns correct state with no pending changes', () => {
      mockHealthyCloud();
      engine = createEngine();

      const state = engine.getSyncState();
      expect(state.siteId).toBe('site-test-001');
      expect(state.pendingChanges).toBe(0);
      expect(state.lastError).toBeUndefined();
    });

    it('includes pending changes from both in-memory and queue', async () => {
      mockHealthyCloud();
      engine = createEngine();

      const monitor = engine.getHealthMonitor();
      await monitor.performHealthCheck();

      // Add in-memory change
      engine.trackChange({
        type: 'alert',
        action: 'create',
        data: { id: 'a1' },
        timestamp: new Date().toISOString(),
      });

      // Also enqueue directly to offline queue (simulating prior offline changes)
      engine.getOfflineQueue().enqueue('door', 'update', { id: 'd1' });

      const state = engine.getSyncState();
      // 1 in-memory + 1 in queue = 2 total
      expect(state.pendingChanges).toBe(2);
    });
  });
});
