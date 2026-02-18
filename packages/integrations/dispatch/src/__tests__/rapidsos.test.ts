import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RapidSOSAdapter } from '../adapters/rapidsos.js';
import type { RapidSOSConfig } from '../adapters/rapidsos.js';
import type { DispatchPayload } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG: RapidSOSConfig = {
  apiUrl: 'https://api.rapidsos.test/v1',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  agencyId: 'agency-001',
  requestTimeoutMs: 5000,
};

const TEST_PAYLOAD: DispatchPayload = {
  alertId: 'alert-001',
  siteId: 'site-001',
  level: 'ACTIVE_THREAT',
  buildingName: 'Main Building',
  roomName: 'Room 101',
  floor: 1,
  latitude: 40.7357,
  longitude: -74.1724,
  callerInfo: 'John Smith',
};

function createMockFetch(responses: Array<{ status: number; body: any }>) {
  let callIndex = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      text: async () =>
        typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body),
      json: async () => resp.body,
    } as unknown as Response;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RapidSOSAdapter', () => {
  describe('OAuth2 token management', () => {
    it('fetches a token on first dispatch', async () => {
      const mockFetch = createMockFetch([
        // Token endpoint
        {
          status: 200,
          body: { access_token: 'tok-123', expires_in: 3600, token_type: 'Bearer' },
        },
        // Emergency endpoint
        {
          status: 201,
          body: { id: 'em-001', status: 'CREATED', created_at: new Date().toISOString() },
        },
      ]);

      const adapter = new RapidSOSAdapter(TEST_CONFIG, mockFetch as any);
      const result = await adapter.dispatch(TEST_PAYLOAD);

      expect(result.success).toBe(true);
      expect(result.dispatchId).toBe('em-001');
      expect(result.method).toBe('RAPIDSOS');

      // First call = token, second call = emergency
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify token request
      const tokenCall = mockFetch.mock.calls[0];
      expect(tokenCall[0]).toBe('https://api.rapidsos.test/v1/oauth/token');
      expect(tokenCall[1]?.method).toBe('POST');
    });

    it('reuses cached token for subsequent dispatches', async () => {
      const mockFetch = createMockFetch([
        // Token (called once)
        {
          status: 200,
          body: { access_token: 'tok-456', expires_in: 3600, token_type: 'Bearer' },
        },
        // First dispatch
        {
          status: 201,
          body: { id: 'em-002', status: 'CREATED', created_at: new Date().toISOString() },
        },
        // Second dispatch (no token call)
        {
          status: 201,
          body: { id: 'em-003', status: 'CREATED', created_at: new Date().toISOString() },
        },
      ]);

      const adapter = new RapidSOSAdapter(TEST_CONFIG, mockFetch as any);
      await adapter.dispatch(TEST_PAYLOAD);
      await adapter.dispatch(TEST_PAYLOAD);

      // Token fetched once + 2 emergency calls = 3
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('returns error on OAuth failure', async () => {
      const mockFetch = createMockFetch([
        { status: 401, body: 'Invalid credentials' },
      ]);

      const adapter = new RapidSOSAdapter(TEST_CONFIG, mockFetch as any);
      const result = await adapter.dispatch(TEST_PAYLOAD);

      expect(result.success).toBe(false);
      expect(result.error).toContain('OAuth failed');
    });
  });

  describe('dispatch', () => {
    it('sends alert with PIDF-LO and returns success', async () => {
      const mockFetch = createMockFetch([
        {
          status: 200,
          body: { access_token: 'tok-abc', expires_in: 3600, token_type: 'Bearer' },
        },
        {
          status: 201,
          body: { id: 'em-100', status: 'RECEIVED', created_at: new Date().toISOString() },
        },
      ]);

      const adapter = new RapidSOSAdapter(TEST_CONFIG, mockFetch as any);
      const result = await adapter.dispatch(TEST_PAYLOAD);

      expect(result.success).toBe(true);
      expect(result.dispatchId).toBe('em-100');
      expect(result.method).toBe('RAPIDSOS');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);

      // Verify emergency POST body
      const emergencyCall = mockFetch.mock.calls[1];
      expect(emergencyCall[0]).toBe('https://api.rapidsos.test/v1/emergencies');
      expect(emergencyCall[1]?.method).toBe('POST');

      const body = JSON.parse(emergencyCall[1]?.body as string);
      expect(body.alert_id).toBe('alert-001');
      expect(body.level).toBe('ACTIVE_THREAT');
      expect(body.agency_id).toBe('agency-001');
      expect(body.location_xml).toContain('pidf');
      expect(body.location_xml).toContain('40.7357');
    });

    it('handles API error gracefully', async () => {
      const mockFetch = createMockFetch([
        {
          status: 200,
          body: { access_token: 'tok-err', expires_in: 3600, token_type: 'Bearer' },
        },
        { status: 500, body: 'Internal Server Error' },
      ]);

      const adapter = new RapidSOSAdapter(TEST_CONFIG, mockFetch as any);
      const result = await adapter.dispatch(TEST_PAYLOAD);

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
      expect(result.method).toBe('RAPIDSOS');
    });

    it('dispatches without optional fields', async () => {
      const mockFetch = createMockFetch([
        {
          status: 200,
          body: { access_token: 'tok-min', expires_in: 3600, token_type: 'Bearer' },
        },
        {
          status: 201,
          body: { id: 'em-min', status: 'CREATED', created_at: new Date().toISOString() },
        },
      ]);

      const minimalPayload: DispatchPayload = {
        alertId: 'alert-min',
        siteId: 'site-001',
        level: 'MEDICAL',
        buildingName: 'Health Center',
      };

      const adapter = new RapidSOSAdapter(TEST_CONFIG, mockFetch as any);
      const result = await adapter.dispatch(minimalPayload);

      expect(result.success).toBe(true);
    });

    it('handles network error', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Network unreachable');
      });

      const adapter = new RapidSOSAdapter(TEST_CONFIG, mockFetch as any);
      const result = await adapter.dispatch(TEST_PAYLOAD);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network unreachable');
    });
  });

  describe('getStatus', () => {
    it('returns dispatch status from API', async () => {
      const mockFetch = createMockFetch([
        {
          status: 200,
          body: { access_token: 'tok-st', expires_in: 3600, token_type: 'Bearer' },
        },
        {
          status: 200,
          body: { id: 'em-100', status: 'DISPATCHED' },
        },
      ]);

      const adapter = new RapidSOSAdapter(TEST_CONFIG, mockFetch as any);
      const status = await adapter.getStatus('em-100');

      expect(status).toBe('DISPATCHED');
    });

    it('throws on API failure', async () => {
      const mockFetch = createMockFetch([
        {
          status: 200,
          body: { access_token: 'tok-st', expires_in: 3600, token_type: 'Bearer' },
        },
        { status: 404, body: 'Not found' },
      ]);

      const adapter = new RapidSOSAdapter(TEST_CONFIG, mockFetch as any);
      await expect(adapter.getStatus('em-999')).rejects.toThrow('status check failed');
    });
  });
});
