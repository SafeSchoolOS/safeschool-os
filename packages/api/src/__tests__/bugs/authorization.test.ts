/**
 * AUTHORIZATION BYPASS BUG TESTS
 *
 * These tests demonstrate real authorization vulnerabilities in the SafeSchool API.
 * Every test here is EXPECTED TO FAIL because the bugs have NOT been fixed yet.
 *
 * The core issue: routes use `fastify.authenticate` (JWT verification) but never
 * check that the authenticated user's `siteIds` include the site that owns the
 * resource being accessed. Any authenticated user can access any resource across
 * any site by simply knowing the resource ID.
 *
 * In a multi-tenant school safety platform, this is a critical security flaw.
 * A teacher at School A could view alerts, lock/unlock doors, release lockdowns,
 * and access visitor/student data at School B.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from '../setup.js';
import { authenticateAs, createTestAlert, SEED } from '../helpers.js';

// A site ID that no seed user belongs to. Since the auth system trusts the JWT
// payload without cross-referencing the database, we can sign a token with any
// siteIds and the server will accept it.
const FOREIGN_SITE_ID = '99999999-9999-4999-a999-999999999999';

/**
 * Helper: sign a JWT for a fake user who belongs to a completely different site.
 * This simulates a legitimate user from another school in the same district.
 */
async function authenticateAsForeignSiteUser(app: FastifyInstance): Promise<string> {
  return app.jwt.sign({
    id: '99999999-9999-4999-a999-000000000001',
    email: 'attacker@otherschool.edu',
    role: 'SITE_ADMIN',
    siteIds: [FOREIGN_SITE_ID],
  });
}

/**
 * Helper: sign a JWT for a user with a specific role at the foreign site.
 */
async function authenticateAsForeignRole(
  app: FastifyInstance,
  role: string,
): Promise<string> {
  return app.jwt.sign({
    id: '99999999-9999-4999-a999-000000000002',
    email: `${role.toLowerCase()}@otherschool.edu`,
    role,
    siteIds: [FOREIGN_SITE_ID],
  });
}

describe('Authorization Bypass Bugs', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let foreignToken: string;

  beforeAll(async () => {
    app = await buildTestServer();
    adminToken = await authenticateAs(app, 'admin');
    foreignToken = await authenticateAsForeignSiteUser(app);
  });

  afterEach(async () => {
    // Reset door statuses so other tests are not affected
    await app.prisma.door.updateMany({
      where: { siteId: SEED.siteId },
      data: { status: 'LOCKED' },
    });
    await cleanupTestData(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // BUG #1: GET /api/v1/alerts/:id - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #1: GET /api/v1/alerts/:id - cross-site alert access', () => {
    it.fails('should return 403 when a user from a different site views an alert, but returns 200 (BUG)', async () => {
      // Step 1: Admin at Lincoln Elementary creates an alert
      const { body: alert } = await createTestAlert(app, { level: 'MEDICAL' });
      expect(alert.siteId).toBe(SEED.siteId);

      // Step 2: A user from a COMPLETELY DIFFERENT site tries to view it
      // This should be forbidden -- they have no business seeing Lincoln Elementary alerts.
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/alerts/${alert.id}`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      // BUG: The server returns 200 with full alert details including dispatch records.
      // It should return 403 Forbidden because the user's siteIds do not include
      // the alert's siteId.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #2: PATCH /api/v1/alerts/:id - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #2: PATCH /api/v1/alerts/:id - cross-site alert modification', () => {
    it.fails('should return 403 when a user from a different site acknowledges an alert, but allows it (BUG)', async () => {
      // Step 1: Create alert at Lincoln Elementary
      const { body: alert } = await createTestAlert(app, { level: 'ACTIVE_THREAT' });

      // Step 2: Foreign site user tries to acknowledge it
      // In a real scenario, this could be used to prematurely close critical alerts
      // at a school under active threat -- a life-safety concern.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/alerts/${alert.id}`,
        headers: { authorization: `Bearer ${foreignToken}` },
        payload: { status: 'ACKNOWLEDGED' },
      });

      // BUG: Returns 200 and actually modifies the alert. A user from School B
      // can acknowledge, resolve, or cancel alerts at School A.
      expect(res.statusCode).toBe(403);
    });

    it.fails('should return 403 when a user from a different site cancels an alert, but allows it (BUG)', async () => {
      const { body: alert } = await createTestAlert(app, { level: 'FIRE' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/alerts/${alert.id}`,
        headers: { authorization: `Bearer ${foreignToken}` },
        payload: { status: 'CANCELLED' },
      });

      // BUG: Cancelling a FIRE alert from another school should be impossible.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #3: DELETE /api/v1/lockdown/:id - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #3: DELETE /api/v1/lockdown/:id - cross-site lockdown release', () => {
    it('should return 403 when a user from a different site releases a lockdown (FIXED)', async () => {
      // Step 1: Admin initiates a lockdown at Lincoln Elementary
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/lockdown',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          scope: 'BUILDING',
          targetId: SEED.buildings.mainId,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const lockdown = JSON.parse(createRes.body);

      // Step 2: A user from a DIFFERENT site releases the lockdown
      // This is catastrophic in a real scenario -- an attacker could unlock all
      // doors during an active threat at a school they have no affiliation with.
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/lockdown/${lockdown.id}`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      // BUG: Returns 200 and actually releases the lockdown, unlocking all doors.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #4: POST /api/v1/doors/:id/lock - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #4: POST /api/v1/doors/:id/lock - cross-site door locking', () => {
    it.fails('should return 403 when a user from a different site locks a door, but allows it (BUG)', async () => {
      // First unlock the door so we can test locking it
      await app.prisma.door.update({
        where: { id: SEED.doors.mainEntrance },
        data: { status: 'UNLOCKED' },
      });

      // Foreign user attempts to lock a door at Lincoln Elementary
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/doors/${SEED.doors.mainEntrance}/lock`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      // BUG: Returns 200 and locks the door. A user from any school can lock
      // any door at any other school.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #5: POST /api/v1/doors/:id/unlock - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #5: POST /api/v1/doors/:id/unlock - cross-site door unlocking', () => {
    it.fails('should return 403 when a user from a different site unlocks a door, but allows it (BUG)', async () => {
      // Ensure door is locked
      await app.prisma.door.update({
        where: { id: SEED.doors.mainEntrance },
        data: { status: 'LOCKED' },
      });

      // Foreign user attempts to unlock a door at Lincoln Elementary
      // This is a severe physical security vulnerability -- an outsider could
      // remotely unlock exterior doors at a school.
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/doors/${SEED.doors.mainEntrance}/unlock`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      // BUG: Returns 200 and unlocks the door.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #6: POST /api/v1/visitors/:id/check-in - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #6: POST /api/v1/visitors/:id/check-in - cross-site visitor check-in', () => {
    it.fails('should return 403 when a user from a different site checks in a visitor, but allows it (BUG)', async () => {
      // The seed data includes a pre-registered visitor at Lincoln Elementary
      const visitorId = '00000000-0000-4000-a000-000000006001';

      // A user from a different site should not be able to check in visitors
      // at Lincoln Elementary
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visitors/${visitorId}/check-in`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      // BUG: The check-in proceeds without verifying the user has access to
      // the visitor's site. Any authenticated user can check in visitors
      // at any school.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #7: POST /api/v1/visitors/:id/check-out - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #7: POST /api/v1/visitors/:id/check-out - cross-site visitor check-out', () => {
    it.fails('should return 403 when a user from a different site checks out a visitor, but allows it (BUG)', async () => {
      const visitorId = '00000000-0000-4000-a000-000000006001';

      // First check the visitor in (as admin who has access)
      await app.inject({
        method: 'POST',
        url: `/api/v1/visitors/${visitorId}/check-in`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // Now a foreign user tries to check them out
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/visitors/${visitorId}/check-out`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      // BUG: Returns 200 and checks the visitor out. A user from any school
      // can modify visitor records at any other school, bypassing visitor
      // management controls.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #8: GET /api/v1/visitors/:id - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #8: GET /api/v1/visitors/:id - cross-site visitor data access', () => {
    it.fails('should return 403 when a user from a different site views visitor details, but returns 200 (BUG)', async () => {
      const visitorId = '00000000-0000-4000-a000-000000006001';

      // A foreign user tries to view visitor details including screening data.
      // This leaks PII (name, ID info, photo, screening results) to
      // unauthorized users -- a FERPA concern for school environments.
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/visitors/${visitorId}`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      // BUG: Returns 200 with full visitor details.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #9: GET /api/v1/sites/:id - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #9: GET /api/v1/sites/:id - cross-site detail access', () => {
    it.fails('should return 403 when a user from a different site views site details, but returns 200 (BUG)', async () => {
      // A user from a foreign site views Lincoln Elementary's full site details
      // including all buildings, rooms, and doors. This is a reconnaissance
      // goldmine -- an attacker learns the entire physical layout.
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/sites/${SEED.siteId}`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      const body = JSON.parse(res.body);

      // BUG: Returns 200 with complete building/room/door inventory.
      // The GET /api/v1/sites (list) correctly filters by siteIds,
      // but GET /api/v1/sites/:id does NOT check siteIds at all.
      expect(res.statusCode).toBe(403);

      // If it did return 200 (the bug), verify the data leak includes buildings
      if (res.statusCode === 200) {
        expect(body.buildings).toBeDefined();
        expect(body.buildings.length).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #10: PATCH /api/v1/transportation/buses/:id - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #10: PATCH /api/v1/transportation/buses/:id - cross-site bus modification', () => {
    it.fails('should return 403 when a user from a different site updates a bus, but allows it (BUG)', async () => {
      const busId = '00000000-0000-4000-a000-000000003001'; // Bus #42

      // A foreign user tries to deactivate a bus at Lincoln Elementary.
      // This could disrupt student transportation -- parents would not
      // receive boarding alerts, GPS tracking would be impacted.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/transportation/buses/${busId}`,
        headers: { authorization: `Bearer ${foreignToken}` },
        payload: { isActive: false },
      });

      // BUG: Returns 200 and deactivates the bus. No site ownership check.
      expect(res.statusCode).toBe(403);

      // Restore bus state if the bug allowed the update
      if (res.statusCode === 200) {
        await app.prisma.bus.update({
          where: { id: busId },
          data: { isActive: true },
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #11: GET /api/v1/transportation/routes/:id - No site authorization check
  // ---------------------------------------------------------------------------
  describe('BUG #11: GET /api/v1/transportation/routes/:id - cross-site route access', () => {
    it.fails('should return 403 when a user from a different site views route details, but returns 200 (BUG)', async () => {
      const routeId = '00000000-0000-4000-a000-000000003010'; // AM-1 route

      // A foreign user views route details including stop locations, student
      // assignments, and student card info. This leaks student PII and
      // physical locations where children are picked up -- a severe
      // FERPA and child safety issue.
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/transportation/routes/${routeId}`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      // BUG: Returns 200 with full route, stop locations, and student data.
      expect(res.statusCode).toBe(403);

      // If the bug manifests, verify the data leak includes student info
      if (res.statusCode === 200) {
        const body = JSON.parse(res.body);
        expect(body.stops).toBeDefined();
        expect(body.stops.length).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // BUG #12: No role-based access control (RBAC)
  // ---------------------------------------------------------------------------
  describe('BUG #12: Missing role-based access control', () => {
    it('should prevent a TEACHER from initiating a lockdown (FIXED)', async () => {
      // Teachers should NOT be able to initiate lockdowns -- that is an
      // ADMIN or OPERATOR action. In Alyssa's Law compliance, lockdown
      // initiation should be restricted to trained personnel.
      const teacherToken = await authenticateAs(app, 'teacher1');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/lockdown',
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: {
          scope: 'BUILDING',
          targetId: SEED.buildings.mainId,
        },
      });

      // BUG: Returns 201 -- any authenticated user can initiate a lockdown
      // regardless of role. There is no role check anywhere in the lockdown route.
      expect(res.statusCode).toBe(403);
    });

    it('should prevent a TEACHER from locking/unlocking doors (FIXED)', async () => {
      // Door control should be limited to ADMIN, OPERATOR, or FIRST_RESPONDER roles.
      // A teacher should not be able to remotely lock/unlock exterior doors.
      const teacherToken = await authenticateAs(app, 'teacher1');

      await app.prisma.door.update({
        where: { id: SEED.doors.mainEntrance },
        data: { status: 'LOCKED' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/doors/${SEED.doors.mainEntrance}/unlock`,
        headers: { authorization: `Bearer ${teacherToken}` },
      });

      // BUG: Returns 200 -- teachers can unlock exterior doors.
      expect(res.statusCode).toBe(403);
    });

    it.fails('should prevent a FIRST_RESPONDER from creating alerts via DASHBOARD, but allows it (BUG)', async () => {
      // First responders should receive and respond to alerts, not create them
      // via the dashboard. Alert creation from DASHBOARD should be limited to
      // school staff (ADMIN, OPERATOR, TEACHER). Panic button alerts are different.
      const responderToken = await authenticateAs(app, 'responder');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        headers: { authorization: `Bearer ${responderToken}` },
        payload: {
          level: 'ACTIVE_THREAT',
          buildingId: SEED.buildings.mainId,
          source: 'DASHBOARD',
          message: 'Responder should not create dashboard alerts',
        },
      });

      // BUG: Returns 201. No role check on alert creation.
      // Any authenticated user can create alerts of any severity level.
      expect(res.statusCode).toBe(403);
    });

    it.fails('should prevent a user with a fabricated role from accessing protected endpoints (BUG)', async () => {
      // Since the JWT payload is trusted blindly, a user could craft a token
      // with any role string. The system should validate roles against known values.
      const fakeRoleToken = app.jwt.sign({
        id: '99999999-9999-4999-a999-000000000099',
        email: 'parent@example.com',
        role: 'PARENT',
        siteIds: [SEED.siteId],
      });

      // A PARENT role should not be able to create alerts
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        headers: { authorization: `Bearer ${fakeRoleToken}` },
        payload: {
          level: 'MEDICAL',
          buildingId: SEED.buildings.mainId,
          source: 'DASHBOARD',
          message: 'Parent should not create alerts',
        },
      });

      // BUG: Returns 201. The system does not validate the role field at all.
      // Any string in the role field is accepted, and no role-based restrictions exist.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Additional cross-cutting authorization bugs
  // ---------------------------------------------------------------------------
  describe('Cross-cutting: Alerts list endpoint siteId filter bypass', () => {
    it.fails('should not allow overriding siteId filter via query param to see other sites alerts (BUG)', async () => {
      // Create an alert at Lincoln Elementary
      const { body: alert } = await createTestAlert(app, { level: 'MEDICAL' });
      expect(alert.siteId).toBe(SEED.siteId);

      // Foreign user tries to list alerts by explicitly passing Lincoln's siteId
      // as a query parameter. The GET /api/v1/alerts route has a check:
      //   if (siteId) where.siteId = siteId;
      //   else where.siteId = { in: request.jwtUser.siteIds };
      // The siteId query param OVERRIDES the user's siteIds filter.
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/alerts?siteId=${SEED.siteId}`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      const body = JSON.parse(res.body);

      // BUG: The query param bypasses the siteIds check entirely.
      // A user can list ALL alerts at ANY site by passing the siteId parameter.
      // The server should intersect the query siteId with the user's siteIds.
      expect(body.length).toBe(0);
    });
  });

  describe('Cross-cutting: Doors list endpoint siteId filter bypass', () => {
    it.fails('should not allow overriding siteId filter to see other sites doors (BUG)', async () => {
      // Same pattern as alerts -- the doors GET / route allows siteId override
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/doors?siteId=${SEED.siteId}`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      const body = JSON.parse(res.body);

      // BUG: Returns all doors at Lincoln Elementary to a foreign site user.
      // Leaks physical security configuration (door names, zones, status, controller IDs).
      expect(body.length).toBe(0);
    });
  });

  describe('Cross-cutting: Visitors list endpoint siteId filter bypass', () => {
    it.fails('should not allow overriding siteId filter to see other sites visitors (BUG)', async () => {
      // Same pattern -- visitors GET / allows siteId query param override
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/visitors?siteId=${SEED.siteId}`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      const body = JSON.parse(res.body);

      // BUG: Returns all visitors at Lincoln Elementary including screening data.
      // PII leak: visitor names, purposes, destinations, host info.
      expect(body.length).toBe(0);
    });
  });
});
