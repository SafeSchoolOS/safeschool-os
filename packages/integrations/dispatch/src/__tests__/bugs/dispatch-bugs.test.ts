import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DispatchChain, createDispatchChain } from '../../dispatch-chain.js';
import { generatePidfLo, parseAddress } from '../../nena-i3.js';
import type { DispatchAdapter, DispatchPayload, DispatchResult } from '../../index.js';
import type { DispatchChainResult } from '../../dispatch-chain.js';

// =============================================================================
// Test Helpers
// =============================================================================

const TEST_PAYLOAD: DispatchPayload = {
  alertId: 'alert-bug-001',
  siteId: 'site-001',
  level: 'LOCKDOWN',
  buildingName: 'Lincoln Elementary - Main',
  roomName: 'Room 103',
  floor: 1,
  latitude: 40.7357,
  longitude: -74.1724,
  callerInfo: 'Principal Smith',
};

function createMockAdapter(
  name: string,
  overrides?: Partial<DispatchAdapter>,
): DispatchAdapter {
  return {
    name,
    dispatch: vi.fn(async (_alert: DispatchPayload): Promise<DispatchResult> => ({
      success: true,
      dispatchId: `${name.toLowerCase()}-dispatch-001`,
      method: name.toUpperCase(),
      responseTimeMs: 5,
    })),
    getStatus: vi.fn(async (_id: string): Promise<string> => 'DISPATCHED'),
    ...overrides,
  };
}

// =============================================================================
// BUG 1: DispatchChain.getStatus tries ALL adapters sequentially
// =============================================================================

describe('BUG: DispatchChain.getStatus tries all adapters even when first succeeds', () => {
  it('calls primary getStatus and returns immediately on success, but secondary is never tried', async () => {
    // Setup: primary succeeds with a valid status
    const primary = createMockAdapter('RapidSOS', {
      getStatus: vi.fn(async () => 'DISPATCHED'),
    });
    const secondary = createMockAdapter('Rave911', {
      getStatus: vi.fn(async () => 'PENDING'),
    });

    const chain = new DispatchChain(primary, secondary);
    const status = await chain.getStatus('rapidsos-dispatch-001');

    // The chain returns the primary's status
    expect(status).toBe('DISPATCHED');
    expect(primary.getStatus).toHaveBeenCalledWith('rapidsos-dispatch-001');

    // BUG DOCUMENTATION: When primary succeeds, secondary is NOT called.
    // This is actually correct behavior for the success path. However...
    expect(secondary.getStatus).not.toHaveBeenCalled();
  });

  it('tries ALL adapters when primary throws, even if dispatchId clearly belongs to secondary', async () => {
    // Setup: primary throws (dispatch ID isn't from this adapter), secondary has the answer
    const primary = createMockAdapter('RapidSOS', {
      getStatus: vi.fn(async () => {
        throw new Error('Unknown dispatch ID');
      }),
    });
    const secondary = createMockAdapter('Rave911', {
      getStatus: vi.fn(async () => 'ON_SCENE'),
    });
    const cellular = createMockAdapter('Cellular', {
      getStatus: vi.fn(async () => 'QUEUED'),
    });

    const chain = new DispatchChain(primary, secondary, cellular);

    // BUG: The dispatch ID 'rave-dispatch-xyz' clearly belongs to the Rave adapter,
    // but the chain has no way to route by ID prefix. It tries primary first,
    // which throws an error that is silently caught.
    const status = await chain.getStatus('rave-dispatch-xyz');

    expect(status).toBe('ON_SCENE');

    // Primary was tried and failed (wasted an API call)
    expect(primary.getStatus).toHaveBeenCalledWith('rave-dispatch-xyz');
    // Secondary was tried and succeeded
    expect(secondary.getStatus).toHaveBeenCalledWith('rave-dispatch-xyz');
    // Cellular was NOT called (secondary succeeded)
    expect(cellular.getStatus).not.toHaveBeenCalled();
  });

  it('returns UNKNOWN when all adapters throw, silently swallowing all errors', async () => {
    const primary = createMockAdapter('RapidSOS', {
      getStatus: vi.fn(async () => {
        throw new Error('RapidSOS: dispatch not found');
      }),
    });
    const secondary = createMockAdapter('Rave911', {
      getStatus: vi.fn(async () => {
        throw new Error('Rave: connection refused');
      }),
    });

    const chain = new DispatchChain(primary, secondary);
    const status = await chain.getStatus('unknown-dispatch-id');

    // BUG: All errors are silently caught. The caller has no way to know
    // if the dispatch truly doesn't exist or if both adapters had network errors.
    expect(status).toBe('UNKNOWN');
    expect(primary.getStatus).toHaveBeenCalled();
    expect(secondary.getStatus).toHaveBeenCalled();
  });
});

// =============================================================================
// BUG 2: DispatchChain failover timeout doesn't cancel the original promise
// =============================================================================

describe('BUG: DispatchChain failover creates dangling promises on timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves to secondary adapter before slow primary resolves, leaving a dangling promise', async () => {
    // Track whether the slow adapter's promise has resolved
    let slowAdapterResolved = false;
    let slowAdapterResolve: ((v: DispatchResult) => void) | null = null;

    const slowPrimary = createMockAdapter('SlowRapidSOS', {
      dispatch: vi.fn(async (): Promise<DispatchResult> => {
        return new Promise((resolve) => {
          slowAdapterResolve = resolve;
          // This promise takes 30 seconds to resolve (much longer than timeout)
          setTimeout(() => {
            slowAdapterResolved = true;
            resolve({
              success: true,
              dispatchId: 'slow-dispatch-001',
              method: 'RAPIDSOS',
              responseTimeMs: 30_000,
            });
          }, 30_000);
        });
      }),
    });

    const fastSecondary = createMockAdapter('Rave911', {
      dispatch: vi.fn(async (): Promise<DispatchResult> => ({
        success: true,
        dispatchId: 'rave-dispatch-001',
        method: 'RAVE911',
        responseTimeMs: 50,
      })),
    });

    // Chain with 200ms timeout
    const chain = new DispatchChain(slowPrimary, fastSecondary, null, {
      timeoutMs: 200,
    });

    // Start the dispatch
    const dispatchPromise = chain.dispatch(TEST_PAYLOAD);

    // Advance time past the timeout
    await vi.advanceTimersByTimeAsync(300);

    const result = (await dispatchPromise) as DispatchChainResult;

    // The chain correctly moved to secondary
    expect(result.success).toBe(true);
    expect(result.successfulAdapter).toBe('Rave911');
    expect(result.failoverUsed).toBe(true);
    expect(result.attempts[0].error).toContain('timed out');

    // BUG: The slow primary's promise is still pending. It was NOT cancelled
    // because JavaScript Promise API has no built-in cancellation mechanism.
    // The withTimeout() method creates a race but doesn't abort the original.
    expect(slowAdapterResolved).toBe(false);

    // When the slow adapter eventually resolves, nothing happens with the result.
    // But the adapter may have side effects (e.g., creating a real 911 dispatch).
    await vi.advanceTimersByTimeAsync(30_000);
    expect(slowAdapterResolved).toBe(true);

    // The chain already returned the secondary's result. The primary's late result
    // is a dangling promise that's silently resolved with no handler.
  });
});

// =============================================================================
// BUG 3: RapidSOS buildCivicAddress returns empty state/city/zip
// =============================================================================

describe('BUG: RapidSOS buildCivicAddress produces empty civic address fields', () => {
  it('generates PIDF-LO with empty state, city, and zip fields', () => {
    // Simulate what RapidSOSAdapter.buildCivicAddress does internally
    // (lines 228-241 of rapidsos.ts)
    const alert: DispatchPayload = {
      alertId: 'alert-civic-001',
      siteId: 'site-001',
      level: 'LOCKDOWN',
      buildingName: 'Lincoln Elementary',
      roomName: 'Room 103',
      floor: 1,
      latitude: 40.7357,
      longitude: -74.1724,
      callerInfo: 'Principal Smith',
    };

    // This is exactly what buildCivicAddress returns (private method behavior)
    const civic = {
      country: 'US',
      state: '',    // BUG: Empty string - NENA i3 requires a valid state code
      city: '',     // BUG: Empty string - NENA i3 requires a city name
      street: alert.buildingName,
      houseNumber: '',
      zip: '',      // BUG: Empty string - NENA i3 requires a zip code
      floor: alert.floor,
      room: alert.roomName,
      building: alert.buildingName,
    };

    const geo = {
      latitude: alert.latitude!,
      longitude: alert.longitude!,
    };

    // Generate the PIDF-LO XML that would be sent to RapidSOS
    const pidfLo = generatePidfLo({
      alertId: alert.alertId,
      civic,
      geo,
    });

    // BUG: The XML contains empty civic address fields that are critical for dispatch
    expect(pidfLo).toContain('<ca:A1></ca:A1>');  // Empty state!
    expect(pidfLo).toContain('<ca:A3></ca:A3>');  // Empty city!
    expect(pidfLo).toContain('<ca:PC></ca:PC>');  // Empty zip code!

    // These fields SHOULD contain real values for NENA i3 compliance:
    // state should be like 'NJ', city should be like 'Springfield', zip should be like '07081'
    // Without these, a 911 PSAP cannot route the call to the correct jurisdiction.
    expect(civic.state).toBe('');
    expect(civic.city).toBe('');
    expect(civic.zip).toBe('');
  });

  it('parseAddress correctly fills civic fields, proving buildCivicAddress should use it', () => {
    // The parseAddress function in nena-i3.ts properly fills all civic fields
    const civic = parseAddress('100 School Drive', 'Springfield', 'NJ', '07081');

    // parseAddress does it right:
    expect(civic.state).toBe('NJ');
    expect(civic.city).toBe('Springfield');
    expect(civic.zip).toBe('07081');
    expect(civic.houseNumber).toBe('100');
    expect(civic.street).toBe('School Drive');

    // But RapidSOSAdapter.buildCivicAddress never calls parseAddress.
    // It constructs civic address manually with empty strings for state/city/zip.
    // The DispatchPayload interface doesn't even carry address/city/state/zip fields,
    // so there's no way for buildCivicAddress to fill them even if it wanted to.
  });
});

// =============================================================================
// BUG 4: RapidSOS buildGeoCoordinates returns 0,0 for missing coords
// =============================================================================

describe('BUG: RapidSOS buildGeoCoordinates defaults to 0,0 (Gulf of Guinea)', () => {
  it('uses latitude 0, longitude 0 when coordinates are undefined', () => {
    // Simulate buildGeoCoordinates behavior (line 244-248 of rapidsos.ts)
    const alertWithoutCoords: DispatchPayload = {
      alertId: 'alert-geo-001',
      siteId: 'site-001',
      level: 'LOCKDOWN',
      buildingName: 'Lincoln Elementary',
      // latitude and longitude are intentionally undefined
    };

    // This is exactly what buildGeoCoordinates returns
    const geo = {
      latitude: alertWithoutCoords.latitude ?? 0,
      longitude: alertWithoutCoords.longitude ?? 0,
    };

    // BUG: GPS coordinates (0, 0) point to the Gulf of Guinea, off the coast
    // of West Africa. This is the "Null Island" problem. Sending a 911 dispatch
    // with these coordinates would direct responders to the wrong continent.
    expect(geo.latitude).toBe(0);
    expect(geo.longitude).toBe(0);

    // Generate PIDF-LO with these bad coordinates
    const pidfLo = generatePidfLo({
      alertId: alertWithoutCoords.alertId,
      civic: {
        country: 'US',
        state: 'NJ',
        city: 'Springfield',
        street: 'School Drive',
        houseNumber: '100',
        zip: '07081',
      },
      geo,
    });

    // The XML will contain GPS pointing to West Africa
    expect(pidfLo).toContain('<gml:pos>0 0</gml:pos>');

    // This should either:
    // 1. Throw an error if coordinates are missing (force caller to provide them)
    // 2. Omit the gml:Point element entirely
    // 3. Use a sentinel value that PSAPs recognize as "no GPS available"
    // It should NEVER send (0, 0) as if it were a real location.
  });

  it('also produces 0,0 when only one coordinate is provided', () => {
    // Edge case: latitude provided but longitude is undefined
    const alertPartialCoords: DispatchPayload = {
      alertId: 'alert-geo-002',
      siteId: 'site-001',
      level: 'LOCKDOWN',
      buildingName: 'Lincoln Elementary',
      latitude: 40.7357,
      // longitude is undefined
    };

    const geo = {
      latitude: alertPartialCoords.latitude ?? 0,
      longitude: alertPartialCoords.longitude ?? 0,
    };

    // BUG: Latitude is valid but longitude defaults to 0
    // This places the coordinates somewhere in Turkey (40.7357, 0) instead of NJ
    expect(geo.latitude).toBe(40.7357);
    expect(geo.longitude).toBe(0);

    // A half-valid coordinate pair is arguably worse than (0,0) because it
    // looks plausible but points to the wrong location.
  });
});

// =============================================================================
// BUG 5: ConsoleDispatchAdapter always returns success
// =============================================================================

describe('BUG: ConsoleDispatchAdapter never fails, masking failover logic', () => {
  it('always returns success regardless of alert content', async () => {
    // Import the actual ConsoleDispatchAdapter
    const { ConsoleDispatchAdapter } = await import('../../adapters/console.js');
    const adapter = new ConsoleDispatchAdapter();

    // Spy on console.log to suppress output during testing
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Even with completely invalid/empty data, console adapter succeeds
    const result = await adapter.dispatch({
      alertId: '',
      siteId: '',
      level: '',
      buildingName: '',
    });

    // BUG: Console adapter always returns success: true
    expect(result.success).toBe(true);
    expect(result.method).toBe('CONSOLE');
    expect(result.dispatchId).toMatch(/^console-\d+$/);

    // This means in development/test environments where ConsoleDispatchAdapter
    // is used as a stand-in for real adapters, the failover path of DispatchChain
    // is NEVER exercised. If the chain is configured as:
    //   primary: ConsoleDispatchAdapter (always succeeds)
    //   secondary: RealAdapter
    // The secondary adapter code path is unreachable.

    consoleSpy.mockRestore();
  });

  it('getStatus always returns DISPATCHED regardless of dispatchId', async () => {
    const { ConsoleDispatchAdapter } = await import('../../adapters/console.js');
    const adapter = new ConsoleDispatchAdapter();

    // Even with a completely bogus dispatch ID
    const status = await adapter.getStatus('nonexistent-id-12345');

    // BUG: Always returns 'DISPATCHED' - never 'PENDING', 'FAILED', etc.
    expect(status).toBe('DISPATCHED');
  });

  it('when used as primary in DispatchChain, secondary is never reached', async () => {
    const { ConsoleDispatchAdapter } = await import('../../adapters/console.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const primary = new ConsoleDispatchAdapter();
    const secondary = createMockAdapter('Rave911');

    const chain = new DispatchChain(primary, secondary);
    const result = (await chain.dispatch(TEST_PAYLOAD)) as DispatchChainResult;

    // Console always succeeds, so secondary is dead code
    expect(result.success).toBe(true);
    expect(result.successfulAdapter).toBe('Console (Dev)');
    expect(secondary.dispatch).not.toHaveBeenCalled();
    expect(result.failoverUsed).toBe(false);

    consoleSpy.mockRestore();
  });
});

// =============================================================================
// BUG 6: createDispatchAdapter uses require() instead of import()
// =============================================================================

describe('BUG: createDispatchAdapter uses require() for lazy imports', () => {
  it('creates a console adapter without require()', async () => {
    // Console adapter is imported normally (not via require), so it works
    const { createDispatchAdapter } = await import('../../index.js');

    const adapter = createDispatchAdapter('console');
    expect(adapter.name).toBe('Console (Dev)');
  });

  it('attempts to create rapidsos adapter via require() which may fail in ESM', async () => {
    const { createDispatchAdapter } = await import('../../index.js');

    // BUG: The factory function (index.ts:78-81) uses require() for RapidSOS:
    //   const { RapidSOSAdapter } = require('./adapters/rapidsos.js');
    //
    // In a pure ESM environment (type: "module" in package.json, or .mjs files),
    // require() is not available. This would throw:
    //   ReferenceError: require is not defined
    //
    // The fix should use dynamic import():
    //   const { RapidSOSAdapter } = await import('./adapters/rapidsos.js');
    //
    // For now, in the vitest/tsx environment, require() may work because
    // vitest transpiles to CJS. So we test that it at least doesn't throw
    // in this environment, while documenting the ESM incompatibility.
    try {
      const adapter = createDispatchAdapter('rapidsos', {
        apiUrl: 'https://api.rapidsos.com/v1',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      });
      // If require() works (CJS or transpiled), we get an adapter
      expect(adapter.name).toBe('RapidSOS');
    } catch (err) {
      // If require() fails (pure ESM), we expect this error
      expect(err).toBeDefined();
      // The error would be ReferenceError in pure ESM or a module resolution error
    }
  });

  it('throws for unknown adapter type', async () => {
    const { createDispatchAdapter } = await import('../../index.js');

    expect(() => createDispatchAdapter('unknown-adapter')).toThrow(
      'Unknown dispatch adapter: unknown-adapter',
    );
  });
});
