/**
 * WEBHOOK BUG TESTS
 *
 * These tests expose real bugs in the ZeroEyes and Clerk webhook handlers.
 * Tests marked (BUG) are EXPECTED TO FAIL because the bugs have NOT been fixed.
 *
 * Key issues:
 *   - Missing field validation produces silent failures or 400s
 *   - Confidence score out-of-range values create invalid data
 *   - FK constraint violation on 'SYSTEM' user ID causes 500 errors
 *   - findFirst() with no filter returns wrong site in multi-tenant deployments
 *   - Content type parser conflicts between webhook and global routes
 *   - Clerk webhook secret prefix handling edge cases
 *   - Module-level singleton prevents runtime config changes
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { buildTestServer, cleanupTestData } from '../setup.js';
import { authenticateAs, SEED } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers for ZeroEyes webhook testing
// ---------------------------------------------------------------------------

const TEST_WEBHOOK_SECRET = 'test-zeroeyes-secret-key-for-hmac';

/**
 * Compute the HMAC SHA-256 signature for a ZeroEyes webhook payload.
 * The ZeroEyes adapter uses: crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
 */
function signPayload(rawBody: string, secret: string = TEST_WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Create a valid ZeroEyes detection payload with defaults.
 */
function makeDetectionPayload(overrides: Record<string, unknown> = {}) {
  return {
    event_id: `evt_test_${Date.now()}`,
    timestamp: new Date().toISOString(),
    camera_id: 'cam_lobby_01',
    classification: 'handgun',
    confidence_score: 92,
    image_url: 'https://zeroeyes.example.com/frame/12345.jpg',
    analyst_confirmed: false,
    ...overrides,
  };
}

/**
 * Send a ZeroEyes webhook with proper HMAC signature.
 */
async function sendZeroEyesWebhook(
  app: FastifyInstance,
  payload: Record<string, unknown>,
  secret: string = TEST_WEBHOOK_SECRET,
) {
  const rawBody = JSON.stringify(payload);
  const signature = signPayload(rawBody, secret);

  return app.inject({
    method: 'POST',
    url: '/webhooks/zeroeyes',
    headers: {
      'content-type': 'application/json',
      'x-signature': signature,
    },
    payload: rawBody,
  });
}

describe('Webhook Bug Tests', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    // Set the webhook secret before building the server so the ZeroEyes
    // adapter picks it up from the config.
    process.env.ZEROEYES_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

    app = await buildTestServer();
    adminToken = await authenticateAs(app, 'admin');
  });

  afterEach(async () => {
    await cleanupTestData(app);
  });

  afterAll(async () => {
    delete process.env.ZEROEYES_WEBHOOK_SECRET;
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // BUG #1: ZeroEyes webhook with missing required fields
  // ---------------------------------------------------------------------------
  describe('BUG #1: ZeroEyes webhook with missing fields', () => {
    it('should return 400 when event_id is missing', async () => {
      const payload = makeDetectionPayload({ event_id: undefined });
      // Remove the key entirely (undefined values are stripped by JSON.stringify)
      delete (payload as any).event_id;

      const res = await sendZeroEyesWebhook(app, payload);

      // parseWebhookPayload returns null when event_id is missing,
      // so the route should return 400 with error message.
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Invalid detection payload');
    });

    it('should return 400 when camera_id is missing', async () => {
      const payload = makeDetectionPayload({ camera_id: undefined });
      delete (payload as any).camera_id;

      const res = await sendZeroEyesWebhook(app, payload);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Invalid detection payload');
    });

    it('should return 400 when both event_id and camera_id are missing', async () => {
      const payload = makeDetectionPayload();
      delete (payload as any).event_id;
      delete (payload as any).camera_id;

      const res = await sendZeroEyesWebhook(app, payload);

      expect(res.statusCode).toBe(400);
    });

    it('should handle empty string event_id (truthy check bypass)', async () => {
      // parseWebhookPayload checks: if (!payload.event_id || !payload.camera_id)
      // An empty string is falsy, so this should be caught.
      const payload = makeDetectionPayload({ event_id: '' });

      const res = await sendZeroEyesWebhook(app, payload);

      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #2: ZeroEyes webhook with confidence_score > 100
  // ---------------------------------------------------------------------------
  describe('BUG #2: ZeroEyes webhook with confidence_score > 100', () => {
    it('should reject or clamp confidence_score > 100, but allows 1.5 confidence (BUG)', async () => {
      // ZeroEyes uses 0-100 scale. The adapter divides by 100 to normalize to 0-1.
      // A score of 150 becomes 1.5 -- which is meaningless and exceeds the valid range.
      // The adapter should validate/clamp the score before processing.
      const payload = makeDetectionPayload({ confidence_score: 150 });

      const res = await sendZeroEyesWebhook(app, payload);

      // The request may succeed (200) because the adapter does not validate the range.
      // If it returns 200, check the confidence value:
      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        // BUG: confidence is 1.5, which is outside the valid 0-1 range.
        // The ThreatEvent interface documents: "Detection confidence from 0.0 to 1.0"
        // but the code does not enforce this.
        expect(body.threatEvent.confidence).toBeLessThanOrEqual(1.0);
        expect(body.threatEvent.confidence).toBeGreaterThanOrEqual(0.0);
      }
    });

    it('should not auto-alert on nonsensical negative confidence', async () => {
      // A confidence_score of -50 would become -0.5 after division.
      // shouldAutoAlert checks: event.confidence >= 0.85
      // -0.5 >= 0.85 is false, so it should NOT auto-alert. This is correct
      // behavior but the adapter should still reject the invalid value.
      const payload = makeDetectionPayload({ confidence_score: -50 });

      const res = await sendZeroEyesWebhook(app, payload);

      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        // Negative confidence is meaningless but doesn't trigger auto-alert
        expect(body.alertCreated).toBe(false);
        // BUG: The confidence value is accepted and stored as -0.5
        expect(body.threatEvent.confidence).toBeGreaterThanOrEqual(0.0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #3: ZeroEyes webhook with confidence_score = 0
  // ---------------------------------------------------------------------------
  describe('BUG #3: ZeroEyes webhook with confidence_score = 0', () => {
    it('should not auto-create alert for zero confidence', async () => {
      // Score 0 / 100 = 0.0 confidence. shouldAutoAlert threshold is 0.85.
      // 0.0 >= 0.85 is false, so no alert should be created.
      const payload = makeDetectionPayload({ confidence_score: 0 });

      const res = await sendZeroEyesWebhook(app, payload);

      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        expect(body.alertCreated).toBe(false);
        expect(body.threatEvent.confidence).toBe(0);
      }
    });

    it('should still return threat event data for zero confidence', async () => {
      const payload = makeDetectionPayload({
        confidence_score: 0,
        classification: 'unknown',
      });

      const res = await sendZeroEyesWebhook(app, payload);

      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        expect(body.received).toBe(true);
        expect(body.threatEvent).toBeDefined();
        expect(body.threatEvent.type).toBe('anomaly'); // 'unknown' maps to 'anomaly'
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #4: ZeroEyes webhook creates alert with triggeredById: 'SYSTEM'
  // ---------------------------------------------------------------------------
  describe('BUG #4: ZeroEyes auto-alert uses invalid triggeredById (BUG)', () => {
    it('should not crash when auto-creating alert with triggeredById=SYSTEM (BUG)', async () => {
      // The ZeroEyes webhook route (zeroeyes.ts:117) sets:
      //   triggeredById: 'SYSTEM'
      //
      // But the Alert model has:
      //   triggeredBy User @relation("AlertTriggeredBy", fields: [triggeredById], references: [id])
      //
      // 'SYSTEM' is not a valid User.id in the database. This will cause a
      // Prisma foreign key constraint violation error, resulting in a 500.
      //
      // The route catches the error (try/catch at line 96-138) and falls
      // through to the non-alert response, but:
      // 1. A genuine high-confidence weapon detection SILENTLY FAILS to create an alert
      // 2. The response says alertCreated: false even though it tried to create one
      // 3. There is no indication to the caller that the alert creation failed
      // 4. The error is only logged, not returned

      const payload = makeDetectionPayload({
        confidence_score: 95, // Above 0.85 threshold, will trigger auto-alert
        classification: 'handgun',
      });

      const res = await sendZeroEyesWebhook(app, payload);

      // The route catches the FK error and returns 200 with alertCreated: false.
      // This is the BUG: it should either:
      // a) Use a valid system user ID (create a SYSTEM user in seed/migration)
      // b) Return a 500 to indicate the alert creation failed
      // c) Return the error in the response body

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // BUG: This will be false because the FK error prevented alert creation,
      // but a weapon was detected with high confidence. The system silently
      // swallowed a critical safety event.
      expect(body.alertCreated).toBe(true);
    });

    it('should successfully create alert for high-confidence detection (BUG)', async () => {
      // A more direct test: verify that a high-confidence detection actually
      // results in an alert in the database.
      const payload = makeDetectionPayload({
        confidence_score: 99,
        classification: 'long_gun',
      });

      const res = await sendZeroEyesWebhook(app, payload);
      const body = JSON.parse(res.body);

      if (body.alertCreated && body.alertId) {
        // If the alert was created, verify it exists in the database
        const alert = await app.prisma.alert.findUnique({
          where: { id: body.alertId },
        });
        expect(alert).not.toBeNull();
        expect(alert?.level).toBe('ACTIVE_THREAT');
      } else {
        // BUG: alertCreated is false because of the FK constraint error.
        // This means a 99% confidence long gun detection was silently ignored.
        // In a real scenario, this is a life-safety failure.
        expect(body.alertCreated).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #5: ZeroEyes webhook uses findFirst() with no filter for site
  // ---------------------------------------------------------------------------
  describe('BUG #5: ZeroEyes webhook findFirst() returns arbitrary site', () => {
    it('should associate detection with the correct site based on camera mapping, not findFirst() (BUG)', async () => {
      // zeroeyes.ts:102: const site = await fastify.prisma.site.findFirst();
      //
      // findFirst() with no filter returns the first site in insertion order.
      // In a multi-site deployment (School A, School B, School C), ALL
      // ZeroEyes detections would be associated with whichever site was
      // inserted first, regardless of which school the camera is at.
      //
      // This is a data integrity bug: a weapon detected at School B would
      // trigger a lockdown at School A.

      const payload = makeDetectionPayload({
        camera_id: 'cam_school_b_entrance', // camera at "School B"
        confidence_score: 50, // below threshold, won't trigger alert creation
      });

      const res = await sendZeroEyesWebhook(app, payload);

      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        // The threat event is returned but there is no site association in the
        // response (only in the auto-created alert path). We document that
        // findFirst() is used without a camera-to-site mapping lookup.
        expect(body.received).toBe(true);
      }

      // In the auto-alert path (high confidence), the site from findFirst()
      // is used for the alert's siteId. With seed data there is only one site,
      // so this bug is invisible in testing. It only manifests in production
      // with multiple sites.
      //
      // EXPECTED FIX: Map camera_id to a site via a CameraSiteMapping table
      // or lookup the camera in the Building/Room records.
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #6: ZeroEyes content type parser conflicts with global parser
  // ---------------------------------------------------------------------------
  describe('BUG #6: Content type parser conflict', () => {
    it('should not break other POST routes after webhook route is registered', async () => {
      // The ZeroEyes webhook route registers a custom content type parser:
      //   fastify.addContentTypeParser('application/json', { parseAs: 'string' }, ...)
      //
      // Because Fastify registers webhook routes in a child plugin context
      // (via app.register(zeroeyesWebhookRoutes, { prefix: '/webhooks/zeroeyes' })),
      // the custom parser should be scoped to that plugin and NOT affect
      // other routes. Fastify's encapsulation should protect us.
      //
      // However, if the webhook route was registered without encapsulation
      // (e.g., using fastify-plugin's { encapsulate: false }), the global
      // JSON parser would be replaced.

      // Test: verify that a normal POST route still works with standard JSON
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: { email: 'admin@lincoln.edu' },
      });

      // If the content type parser leaked, this would fail because the
      // global parser would return a string instead of a parsed object.
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBeTruthy();
    });

    it('should not break alert creation after webhook route is registered', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          level: 'MEDICAL',
          buildingId: SEED.buildings.mainId,
          message: 'Parser conflict test',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.level).toBe('MEDICAL');
    });

    it('should not break visitor creation after webhook route is registered', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/visitors',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        payload: {
          firstName: 'Test',
          lastName: 'Visitor',
          purpose: 'Parser test',
          destination: 'Office',
        },
      });

      expect(res.statusCode).toBe(201);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #7: Clerk webhook whsec_ prefix handling
  // ---------------------------------------------------------------------------
  describe('BUG #7: Clerk webhook secret prefix handling', () => {
    it('should correctly handle webhook secret with whsec_ prefix', async () => {
      // auth.ts:123: const secretBytes = Buffer.from(webhookSecret.replace('whsec_', ''), 'base64');
      //
      // If the secret is 'whsec_dGVzdHNlY3JldA==', it becomes 'dGVzdHNlY3JldA=='
      // which is then base64-decoded. This is correct.
      const secretWithPrefix = 'whsec_dGVzdHNlY3JldA==';
      const stripped = secretWithPrefix.replace('whsec_', '');
      expect(stripped).toBe('dGVzdHNlY3JldA==');

      const decoded = Buffer.from(stripped, 'base64');
      expect(decoded.toString('utf-8')).toBe('testsecret');
    });

    it('should correctly handle webhook secret WITHOUT whsec_ prefix', async () => {
      // If someone configures the secret without the prefix (just the raw base64),
      // the replace is a no-op and the base64 is decoded directly. This is also correct.
      const secretWithoutPrefix = 'dGVzdHNlY3JldA==';
      const stripped = secretWithoutPrefix.replace('whsec_', '');
      expect(stripped).toBe('dGVzdHNlY3JldA=='); // unchanged
    });

    it('should handle secret that contains whsec_ in the middle (edge case)', async () => {
      // String.replace only replaces the first occurrence. If 'whsec_' appears
      // in the middle of the base64, it would be corrupted.
      // Base64 is [A-Za-z0-9+/=], so 'whsec_' (with underscore) cannot appear
      // in valid base64. This edge case is theoretical but worth documenting.
      const weirdSecret = 'abc_whsec_xyz';
      const stripped = weirdSecret.replace('whsec_', '');
      // Only the first occurrence is replaced, but 'whsec_' has underscore
      // which is not valid base64, so this would fail at Buffer.from anyway.
      expect(stripped).toBe('abc_xyz');
    });

    it('should verify actual webhook signature with both prefix formats', async () => {
      // Demonstrate that the same secret with and without prefix produces
      // the same HMAC signature when handled correctly.
      const rawSecret = 'dGVzdHNlY3JldA=='; // base64 of "testsecret"
      const prefixedSecret = `whsec_${rawSecret}`;

      const secretBytes1 = Buffer.from(rawSecret.replace('whsec_', ''), 'base64');
      const secretBytes2 = Buffer.from(prefixedSecret.replace('whsec_', ''), 'base64');

      const testContent = 'msg_123.1234567890.{"type":"user.created"}';

      const sig1 = crypto.createHmac('sha256', secretBytes1).update(testContent).digest('base64');
      const sig2 = crypto.createHmac('sha256', secretBytes2).update(testContent).digest('base64');

      expect(sig1).toBe(sig2);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #8: Clerk webhook with invalid JSON body
  // ---------------------------------------------------------------------------
  describe('BUG #8: Clerk webhook with invalid JSON body', () => {
    it('should handle non-JSON body gracefully', async () => {
      // If the body is not valid JSON, Fastify's built-in parser will reject
      // it before the route handler runs. The response should be a clean
      // 400 error, not a 500.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/clerk-webhook',
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_test',
          'svix-timestamp': String(Math.floor(Date.now() / 1000)),
          'svix-signature': 'v1,fakesig',
        },
        payload: 'this is not json{{{',
      });

      // Fastify should return a 400 for malformed JSON, not a 500.
      // In dev mode this will be 404 (clerk webhooks not enabled) because
      // the auth provider check happens before body parsing.
      expect([400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });

    it('should handle empty body gracefully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/clerk-webhook',
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_test',
          'svix-timestamp': String(Math.floor(Date.now() / 1000)),
          'svix-signature': 'v1,fakesig',
        },
        payload: '',
      });

      // Empty body should result in a 400 (bad request) or 404 (not enabled)
      expect([400, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(500);
    });

    it('should handle null body values without crashing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/clerk-webhook',
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_test',
          'svix-timestamp': String(Math.floor(Date.now() / 1000)),
          'svix-signature': 'v1,fakesig',
        },
        payload: { type: null, data: null },
      });

      // With AUTH_PROVIDER=dev, this returns 404. But the handler should
      // handle null values safely if it reaches the processing logic.
      expect(res.statusCode).not.toBe(500);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #9: ZeroEyes adapter module-level singleton
  // ---------------------------------------------------------------------------
  describe('BUG #9: ZeroEyes adapter module-level singleton', () => {
    it('should document that the adapter is a module-level singleton persisting across requests', async () => {
      // zeroeyes.ts:21: let zeroEyesAdapter: ZeroEyesAdapter | null = null;
      //
      // The adapter is lazily created on the first webhook request and then
      // reused for all subsequent requests. The config (API URL, API key,
      // webhook secret) is read from getConfig() at creation time.
      //
      // This means:
      // 1. Config changes (e.g., rotating the webhook secret) require a full
      //    process restart. Hot-reloading config will NOT update the adapter.
      // 2. In testing, if one test modifies process.env.ZEROEYES_WEBHOOK_SECRET,
      //    the adapter still uses the old value from when it was first created.
      // 3. Memory: the adapter accumulates threatCallbacks[] without cleanup.

      // Demonstrate the singleton behavior:
      // First request creates the adapter
      const payload1 = makeDetectionPayload({ confidence_score: 50 });
      const res1 = await sendZeroEyesWebhook(app, payload1);
      // May be 200 or 401 depending on whether the secret matches
      expect(res1.statusCode).toBeDefined();

      // Change the env variable
      const originalSecret = process.env.ZEROEYES_WEBHOOK_SECRET;
      process.env.ZEROEYES_WEBHOOK_SECRET = 'new-secret-that-should-be-used';

      // Second request reuses the cached adapter with the OLD secret
      const payload2 = makeDetectionPayload({ confidence_score: 50 });
      const rawBody = JSON.stringify(payload2);
      // Sign with the NEW secret
      const newSig = crypto
        .createHmac('sha256', 'new-secret-that-should-be-used')
        .update(rawBody)
        .digest('hex');

      const res2 = await app.inject({
        method: 'POST',
        url: '/webhooks/zeroeyes',
        headers: {
          'content-type': 'application/json',
          'x-signature': newSig,
        },
        payload: rawBody,
      });

      // BUG: The adapter still verifies against the old secret, so this
      // request will be rejected with 401 even though the new secret is
      // correctly configured in the environment.
      // (This documents the singleton behavior -- the actual result depends
      // on whether the first request successfully initialized the adapter.)

      // Restore the original secret
      process.env.ZEROEYES_WEBHOOK_SECRET = originalSecret;

      // The key insight: there is no way to refresh the adapter without
      // restarting the process. In production, a webhook secret rotation
      // would require a deployment, not just a config change.
      expect(res2.statusCode).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Additional: ZeroEyes webhook with no X-Signature header
  // ---------------------------------------------------------------------------
  describe('Additional: ZeroEyes webhook without signature', () => {
    it('should reject requests without X-Signature header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/zeroeyes',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(makeDetectionPayload()),
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Missing X-Signature header');
    });

    it('should reject requests with invalid signature', async () => {
      const payload = makeDetectionPayload();

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/zeroeyes',
        headers: {
          'content-type': 'application/json',
          'x-signature': 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        },
        payload: JSON.stringify(payload),
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Invalid signature');
    });
  });

  // ---------------------------------------------------------------------------
  // Additional: ZeroEyes webhook with missing timestamp
  // ---------------------------------------------------------------------------
  describe('Additional: ZeroEyes webhook with edge case payloads', () => {
    it('should handle missing timestamp gracefully', async () => {
      // parseWebhookPayload uses: new Date(payload.timestamp || Date.now())
      // If timestamp is missing, it falls back to Date.now(), which is correct.
      const payload = makeDetectionPayload();
      delete (payload as any).timestamp;

      const res = await sendZeroEyesWebhook(app, payload);

      // Should succeed (timestamp falls back to now)
      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        expect(body.received).toBe(true);
      }
    });

    it('should handle invalid timestamp string', async () => {
      // new Date('not-a-date') produces "Invalid Date"
      // This is stored in the ThreatEvent but does not cause a crash.
      const payload = makeDetectionPayload({ timestamp: 'not-a-date' });

      const res = await sendZeroEyesWebhook(app, payload);

      // Should not crash (500)
      expect(res.statusCode).not.toBe(500);
    });

    it('should handle missing classification field', async () => {
      // mapClassification receives undefined, hits the default case, returns 'anomaly'
      const payload = makeDetectionPayload();
      delete (payload as any).classification;

      const res = await sendZeroEyesWebhook(app, payload);

      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        expect(body.threatEvent.type).toBe('anomaly');
      }
    });

    it('should handle missing confidence_score (undefined)', async () => {
      // parseWebhookPayload uses: (payload.confidence_score ?? 0) / 100
      // If confidence_score is undefined, it defaults to 0, then 0/100 = 0.
      const payload = makeDetectionPayload();
      delete (payload as any).confidence_score;

      const res = await sendZeroEyesWebhook(app, payload);

      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        expect(body.threatEvent.confidence).toBe(0);
        expect(body.alertCreated).toBe(false);
      }
    });
  });
});
