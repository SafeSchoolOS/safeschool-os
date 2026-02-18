import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { ZeroEyesAdapter } from '../adapters/zeroeyes.js';
import type { ZeroEyesDetection } from '../adapters/zeroeyes.js';
import type { ThreatIntelConfig, ThreatEvent } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = 'test-webhook-secret-key-1234';

const defaultConfig: ThreatIntelConfig = {
  type: 'zeroeyes',
  apiUrl: 'https://api.zeroeyes.test',
  apiKey: 'test-api-key',
  webhookSecret: WEBHOOK_SECRET,
  alertThreshold: 0.85,
};

function signPayload(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function makeDetection(overrides: Partial<ZeroEyesDetection> = {}): ZeroEyesDetection {
  return {
    event_id: 'evt-001',
    timestamp: '2026-02-07T12:00:00Z',
    camera_id: 'cam-front-entrance',
    classification: 'handgun',
    confidence_score: 92,
    image_url: 'https://api.zeroeyes.test/frames/evt-001.jpg',
    analyst_confirmed: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZeroEyesAdapter', () => {
  let adapter: ZeroEyesAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new ZeroEyesAdapter(defaultConfig);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  // -----------------------------------------------------------------------
  // Basic properties
  // -----------------------------------------------------------------------

  it('has the correct name', () => {
    expect(adapter.name).toBe('ZeroEyes');
  });

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  it('reports healthy when API responds OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(true);
  });

  it('reports unhealthy when API fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Connect
  // -----------------------------------------------------------------------

  it('connects successfully when healthy', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    await expect(adapter.connect()).resolves.toBeUndefined();
  });

  it('throws on connect when unhealthy', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(adapter.connect()).rejects.toThrow('Failed to connect to ZeroEyes API');
  });

  // -----------------------------------------------------------------------
  // Device status
  // -----------------------------------------------------------------------

  it('fetches and maps device statuses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        devices: [
          {
            device_id: 'dev-001',
            camera_id: 'cam-001',
            status: 'active',
            last_heartbeat: '2026-02-07T11:59:00Z',
          },
          {
            device_id: 'dev-002',
            camera_id: 'cam-002',
            status: 'offline',
            last_heartbeat: '2026-02-07T10:00:00Z',
          },
        ],
      }),
    });

    const statuses = await adapter.getDeviceStatus();

    expect(statuses).toHaveLength(2);
    expect(statuses[0].id).toBe('dev-001');
    expect(statuses[0].status).toBe('ACTIVE');
    expect(statuses[1].status).toBe('OFFLINE');
  });

  // -----------------------------------------------------------------------
  // Webhook signature verification
  // -----------------------------------------------------------------------

  it('verifies a valid webhook signature', () => {
    const body = JSON.stringify(makeDetection());
    const signature = signPayload(body);
    expect(adapter.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('rejects an invalid webhook signature', () => {
    const body = JSON.stringify(makeDetection());
    const badSignature = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    expect(adapter.verifyWebhookSignature(body, badSignature)).toBe(false);
  });

  it('rejects when webhook secret is not configured', () => {
    const noSecretAdapter = new ZeroEyesAdapter({ ...defaultConfig, webhookSecret: '' });
    const body = JSON.stringify(makeDetection());
    const signature = signPayload(body);
    expect(noSecretAdapter.verifyWebhookSignature(body, signature)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Threat event parsing
  // -----------------------------------------------------------------------

  it('parses a handgun detection into a weapon ThreatEvent', () => {
    const detection = makeDetection({ classification: 'handgun', confidence_score: 92 });
    const event = adapter.parseWebhookPayload(detection);

    expect(event).not.toBeNull();
    expect(event!.id).toBe('evt-001');
    expect(event!.type).toBe('weapon');
    expect(event!.confidence).toBeCloseTo(0.92);
    expect(event!.cameraId).toBe('cam-front-entrance');
    expect(event!.imageUrl).toContain('evt-001.jpg');
  });

  it('parses a long_gun detection as weapon type', () => {
    const detection = makeDetection({ classification: 'long_gun' });
    const event = adapter.parseWebhookPayload(detection);
    expect(event!.type).toBe('weapon');
  });

  it('parses person_of_interest classification', () => {
    const detection = makeDetection({ classification: 'person_of_interest', confidence_score: 75 });
    const event = adapter.parseWebhookPayload(detection);
    expect(event!.type).toBe('person_of_interest');
    expect(event!.confidence).toBeCloseTo(0.75);
  });

  it('maps unknown classification to anomaly', () => {
    const detection = makeDetection({ classification: 'unknown' as any });
    const event = adapter.parseWebhookPayload(detection);
    expect(event!.type).toBe('anomaly');
  });

  it('returns null for invalid payload', () => {
    const event = adapter.parseWebhookPayload({} as any);
    expect(event).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Threat callbacks
  // -----------------------------------------------------------------------

  it('fires onThreatDetected callbacks when parsing webhook payload', () => {
    const callback = vi.fn();
    adapter.onThreatDetected(callback);

    const detection = makeDetection();
    adapter.parseWebhookPayload(detection);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].id).toBe('evt-001');
  });

  it('fires multiple callbacks', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    adapter.onThreatDetected(cb1);
    adapter.onThreatDetected(cb2);

    adapter.parseWebhookPayload(makeDetection());

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Auto-alert threshold
  // -----------------------------------------------------------------------

  it('triggers auto-alert for high confidence (>= 0.85)', () => {
    const event: ThreatEvent = {
      id: 'evt-high',
      timestamp: new Date(),
      cameraId: 'cam-001',
      type: 'weapon',
      confidence: 0.92,
      metadata: {},
    };
    expect(adapter.shouldAutoAlert(event)).toBe(true);
  });

  it('triggers auto-alert at exactly 0.85', () => {
    const event: ThreatEvent = {
      id: 'evt-exact',
      timestamp: new Date(),
      cameraId: 'cam-001',
      type: 'weapon',
      confidence: 0.85,
      metadata: {},
    };
    expect(adapter.shouldAutoAlert(event)).toBe(true);
  });

  it('does NOT trigger auto-alert for low confidence (< 0.85)', () => {
    const event: ThreatEvent = {
      id: 'evt-low',
      timestamp: new Date(),
      cameraId: 'cam-001',
      type: 'weapon',
      confidence: 0.60,
      metadata: {},
    };
    expect(adapter.shouldAutoAlert(event)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Custom threshold
  // -----------------------------------------------------------------------

  it('respects custom alertThreshold from config', () => {
    const customAdapter = new ZeroEyesAdapter({ ...defaultConfig, alertThreshold: 0.5 });
    const event: ThreatEvent = {
      id: 'evt-custom',
      timestamp: new Date(),
      cameraId: 'cam-001',
      type: 'weapon',
      confidence: 0.55,
      metadata: {},
    };
    expect(customAdapter.shouldAutoAlert(event)).toBe(true);
  });
});
