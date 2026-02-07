import { describe, it, expect, vi } from 'vitest';
import { DispatchChain, createDispatchChain } from '../dispatch-chain.js';
import type { DispatchAdapter, DispatchPayload, DispatchResult } from '../index.js';
import type { DispatchChainResult } from '../dispatch-chain.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PAYLOAD: DispatchPayload = {
  alertId: 'alert-chain-001',
  siteId: 'site-001',
  level: 'LOCKDOWN',
  buildingName: 'Main Building',
  roomName: 'Office 201',
  floor: 2,
  latitude: 40.7357,
  longitude: -74.1724,
};

function createMockAdapter(
  name: string,
  behavior: 'success' | 'fail' | 'timeout',
  delayMs = 0,
): DispatchAdapter {
  return {
    name,
    dispatch: vi.fn(async (_alert: DispatchPayload): Promise<DispatchResult> => {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (behavior === 'timeout') {
        // Simulate a very long wait (will be aborted by chain timeout)
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        // Should not reach here
        return { success: false, dispatchId: '', method: name, responseTimeMs: 0 };
      }

      if (behavior === 'fail') {
        return {
          success: false,
          dispatchId: '',
          method: name.toUpperCase().replace(/\s+/g, '_'),
          responseTimeMs: delayMs,
          error: `${name} failed`,
        };
      }

      return {
        success: true,
        dispatchId: `${name.toLowerCase().replace(/\s+/g, '-')}-dispatch-001`,
        method: name.toUpperCase().replace(/\s+/g, '_'),
        responseTimeMs: delayMs,
      };
    }),
    getStatus: vi.fn(async () => 'DISPATCHED'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DispatchChain', () => {
  describe('primary success', () => {
    it('uses only primary when it succeeds', async () => {
      const primary = createMockAdapter('RapidSOS', 'success');
      const secondary = createMockAdapter('Rave911', 'success');
      const cellular = createMockAdapter('Cellular', 'success');

      const chain = new DispatchChain(primary, secondary, cellular, { timeoutMs: 5000 });
      const result = (await chain.dispatch(TEST_PAYLOAD)) as DispatchChainResult;

      expect(result.success).toBe(true);
      expect(result.failoverUsed).toBe(false);
      expect(result.successfulAdapter).toBe('RapidSOS');
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].adapterName).toBe('RapidSOS');
      expect(result.attempts[0].success).toBe(true);

      // Secondary and cellular should NOT have been called
      expect(secondary.dispatch).not.toHaveBeenCalled();
      expect(cellular.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('primary fails -> secondary succeeds', () => {
    it('falls through to secondary on primary failure', async () => {
      const primary = createMockAdapter('RapidSOS', 'fail');
      const secondary = createMockAdapter('Rave911', 'success');
      const cellular = createMockAdapter('Cellular', 'success');

      const chain = new DispatchChain(primary, secondary, cellular, { timeoutMs: 5000 });
      const result = (await chain.dispatch(TEST_PAYLOAD)) as DispatchChainResult;

      expect(result.success).toBe(true);
      expect(result.failoverUsed).toBe(true);
      expect(result.successfulAdapter).toBe('Rave911');
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].adapterName).toBe('RapidSOS');
      expect(result.attempts[0].success).toBe(false);
      expect(result.attempts[1].adapterName).toBe('Rave911');
      expect(result.attempts[1].success).toBe(true);

      expect(cellular.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('primary + secondary fail -> cellular succeeds', () => {
    it('falls through to cellular when primary and secondary fail', async () => {
      const primary = createMockAdapter('RapidSOS', 'fail');
      const secondary = createMockAdapter('Rave911', 'fail');
      const cellular = createMockAdapter('Cellular', 'success');

      const chain = new DispatchChain(primary, secondary, cellular, { timeoutMs: 5000 });
      const result = (await chain.dispatch(TEST_PAYLOAD)) as DispatchChainResult;

      expect(result.success).toBe(true);
      expect(result.failoverUsed).toBe(true);
      expect(result.successfulAdapter).toBe('Cellular');
      expect(result.attempts).toHaveLength(3);

      expect(result.attempts[0].success).toBe(false);
      expect(result.attempts[1].success).toBe(false);
      expect(result.attempts[2].success).toBe(true);
    });
  });

  describe('all adapters fail', () => {
    it('returns failure with all attempt details', async () => {
      const primary = createMockAdapter('RapidSOS', 'fail');
      const secondary = createMockAdapter('Rave911', 'fail');
      const cellular = createMockAdapter('Cellular', 'fail');

      const chain = new DispatchChain(primary, secondary, cellular, { timeoutMs: 5000 });
      const result = (await chain.dispatch(TEST_PAYLOAD)) as DispatchChainResult;

      expect(result.success).toBe(false);
      expect(result.failoverUsed).toBe(true);
      expect(result.method).toBe('CHAIN_EXHAUSTED');
      expect(result.successfulAdapter).toBeUndefined();
      expect(result.attempts).toHaveLength(3);
      expect(result.error).toContain('All dispatch adapters failed');
      expect(result.error).toContain('RapidSOS');
      expect(result.error).toContain('Rave911');
      expect(result.error).toContain('Cellular');
    });
  });

  describe('timeout handling', () => {
    it('moves to secondary when primary times out', async () => {
      const primary = createMockAdapter('RapidSOS', 'timeout');
      const secondary = createMockAdapter('Rave911', 'success');

      // Use a very short timeout for testing
      const chain = new DispatchChain(primary, secondary, null, { timeoutMs: 100 });
      const result = (await chain.dispatch(TEST_PAYLOAD)) as DispatchChainResult;

      expect(result.success).toBe(true);
      expect(result.failoverUsed).toBe(true);
      expect(result.successfulAdapter).toBe('Rave911');
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0].error).toContain('timed out');
    });
  });

  describe('without optional adapters', () => {
    it('works with primary only', async () => {
      const primary = createMockAdapter('RapidSOS', 'success');
      const chain = new DispatchChain(primary);
      const result = (await chain.dispatch(TEST_PAYLOAD)) as DispatchChainResult;

      expect(result.success).toBe(true);
      expect(result.failoverUsed).toBe(false);
      expect(result.attempts).toHaveLength(1);
    });

    it('works with primary + secondary, no cellular', async () => {
      const primary = createMockAdapter('RapidSOS', 'fail');
      const secondary = createMockAdapter('Rave911', 'success');
      const chain = new DispatchChain(primary, secondary);
      const result = (await chain.dispatch(TEST_PAYLOAD)) as DispatchChainResult;

      expect(result.success).toBe(true);
      expect(result.failoverUsed).toBe(true);
      expect(result.attempts).toHaveLength(2);
    });
  });

  describe('attempt metadata', () => {
    it('records timestamps and response times for each attempt', async () => {
      const primary = createMockAdapter('RapidSOS', 'fail', 10);
      const secondary = createMockAdapter('Rave911', 'success', 10);

      const chain = new DispatchChain(primary, secondary, null, { timeoutMs: 5000 });
      const result = (await chain.dispatch(TEST_PAYLOAD)) as DispatchChainResult;

      for (const attempt of result.attempts) {
        expect(attempt.startedAt).toBeTruthy();
        expect(attempt.completedAt).toBeTruthy();
        expect(new Date(attempt.startedAt).getTime()).toBeGreaterThan(0);
        expect(new Date(attempt.completedAt).getTime()).toBeGreaterThan(0);
        expect(attempt.responseTimeMs).toBeGreaterThanOrEqual(0);
      }

      // Total responseTimeMs is the sum of all attempts
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getStatus', () => {
    it('delegates to adapters in order', async () => {
      const primary = createMockAdapter('RapidSOS', 'success');
      const secondary = createMockAdapter('Rave911', 'success');

      const chain = new DispatchChain(primary, secondary);
      const status = await chain.getStatus('dispatch-001');

      expect(status).toBe('DISPATCHED');
      expect(primary.getStatus).toHaveBeenCalledWith('dispatch-001');
    });

    it('falls through to next adapter if first throws', async () => {
      const primary: DispatchAdapter = {
        name: 'Primary',
        dispatch: vi.fn(),
        getStatus: vi.fn(async () => {
          throw new Error('Not found');
        }),
      };
      const secondary: DispatchAdapter = {
        name: 'Secondary',
        dispatch: vi.fn(),
        getStatus: vi.fn(async () => 'ON_SCENE'),
      };

      const chain = new DispatchChain(primary, secondary);
      const status = await chain.getStatus('dispatch-002');

      expect(status).toBe('ON_SCENE');
    });

    it('returns UNKNOWN when all adapters fail', async () => {
      const primary: DispatchAdapter = {
        name: 'Primary',
        dispatch: vi.fn(),
        getStatus: vi.fn(async () => {
          throw new Error('Not found');
        }),
      };

      const chain = new DispatchChain(primary);
      const status = await chain.getStatus('dispatch-unknown');

      expect(status).toBe('UNKNOWN');
    });
  });

  describe('createDispatchChain factory', () => {
    it('creates a chain via factory function', async () => {
      const primary = createMockAdapter('Primary', 'success');
      const chain = createDispatchChain(primary, null, null, { timeoutMs: 2000 });

      expect(chain).toBeInstanceOf(DispatchChain);
      expect(chain.name).toBe('DispatchChain');

      const result = await chain.dispatch(TEST_PAYLOAD);
      expect(result.success).toBe(true);
    });
  });
});
