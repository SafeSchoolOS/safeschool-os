import { describe, it, expect } from 'vitest';
import { ConsoleDispatchAdapter } from '../adapters/console.js';
import type { DispatchPayload } from '../index.js';

describe('ConsoleDispatchAdapter', () => {
  const adapter = new ConsoleDispatchAdapter();

  it('has a name', () => {
    expect(adapter.name).toBe('Console (Dev)');
  });

  it('dispatches successfully', async () => {
    const payload: DispatchPayload = {
      alertId: 'test-alert-001',
      siteId: 'test-site-001',
      level: 'ACTIVE_THREAT',
      buildingName: 'Main Building',
      roomName: 'Room 101',
      floor: 1,
      latitude: 40.7357,
      longitude: -74.1724,
    };

    const result = await adapter.dispatch(payload);
    expect(result.success).toBe(true);
    expect(result.method).toBe('CONSOLE');
    expect(result.dispatchId).toMatch(/^console-/);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('dispatches without optional fields', async () => {
    const payload: DispatchPayload = {
      alertId: 'test-alert-002',
      siteId: 'test-site-001',
      level: 'MEDICAL',
      buildingName: 'Annex Building',
    };

    const result = await adapter.dispatch(payload);
    expect(result.success).toBe(true);
  });

  it('returns DISPATCHED status', async () => {
    const status = await adapter.getStatus('console-12345');
    expect(status).toBe('DISPATCHED');
  });
});
