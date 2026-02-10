/**
 * Lockdown Bug Tests
 *
 * These tests expose REAL bugs in the lockdown route (packages/api/src/routes/lockdown.ts).
 * All tests are expected to FAIL, proving the bugs exist.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from '../setup.js';
import { SEED, authenticateAs } from '../helpers.js';

let app: FastifyInstance;
const originalMode = process.env.OPERATING_MODE;

beforeAll(async () => {
  // Set edge mode so release tests can proceed past the edge-only guard
  process.env.OPERATING_MODE = 'edge';
  app = await buildTestServer();
});

afterAll(async () => {
  process.env.OPERATING_MODE = originalMode;
  await cleanupTestData(app);
  await app.close();
});

afterEach(async () => {
  // Reset all doors back to LOCKED (seed default) and clean up test lockdowns
  await app.prisma.door.updateMany({
    where: { siteId: SEED.siteId },
    data: { status: 'LOCKED' },
  });
  await cleanupTestData(app);
});

describe('BUG: FLOOR scope does not filter by floor', () => {
  /**
   * Bug location: lockdown.ts lines 22-25
   *
   * When scope=FLOOR and targetId=buildingId, the code does:
   *   doorFilter.buildingId = targetId;
   *   // Floor-based lockdown would need floor field
   *
   * It sets buildingId but NEVER sets a floor filter. So a FLOOR lockdown
   * locks ALL doors in the building, not just doors on the target floor.
   *
   * The seed data has doors on floor 1 in the main building. We need a door
   * on floor 2 to prove the bug. We'll create one, then do a FLOOR lockdown
   * targeting floor 1 only, and verify the floor-2 door was NOT locked.
   */
  it.fails('should only lock doors on the specified floor, not all building doors', async () => {
    // First, unlock all doors so we can see which ones get locked
    await app.prisma.door.updateMany({
      where: { siteId: SEED.siteId },
      data: { status: 'UNLOCKED' },
    });

    // Create a door on floor 2 of the main building (non-emergency-exit)
    const floor2Door = await app.prisma.door.create({
      data: {
        siteId: SEED.siteId,
        buildingId: SEED.buildings.mainId,
        name: 'Floor 2 Classroom Door',
        floor: 2,
        zone: 'classroom',
        status: 'UNLOCKED',
        controllerType: 'mock',
        controllerId: 'mock-floor2-test',
        isExterior: false,
        isEmergencyExit: false,
      },
    });

    const token = await authenticateAs(app, 'admin');

    // Initiate a FLOOR lockdown for floor 1 of the main building.
    // The route currently accepts scope=FLOOR with targetId=buildingId.
    // A proper implementation would also accept a floor number.
    // Since the route doesn't even take a floor param for lockdowns,
    // we pass the buildingId as targetId (which is what the code expects).
    const lockdownRes = await app.inject({
      method: 'POST',
      url: '/api/v1/lockdown',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: 'FLOOR',
        targetId: SEED.buildings.mainId,
        // Note: there's no way to specify WHICH floor -- that's part of the bug
      },
    });

    expect(lockdownRes.statusCode).toBe(201);

    // Now check: the floor-2 door should NOT have been locked
    // (since we requested a FLOOR lockdown, which should only affect one floor)
    const floor2DoorAfter = await app.prisma.door.findUnique({
      where: { id: floor2Door.id },
    });

    // BUG: This will FAIL -- the floor-2 door IS locked because FLOOR scope
    // just sets buildingId filter, locking ALL non-emergency-exit doors in the building.
    expect(floor2DoorAfter!.status).toBe('UNLOCKED');

    // Clean up the test door
    await app.prisma.door.delete({ where: { id: floor2Door.id } });
  });
});

describe('BUG: Lockdown release unlocks manually-locked emergency exit doors', () => {
  /**
   * Bug location: lockdown.ts lines 75-81
   *
   * The initiate lockdown correctly skips isEmergencyExit: true doors (line 20).
   * But the release (DELETE /:id) builds a doorFilter WITHOUT excluding emergency exits:
   *   const doorFilter: any = { siteId: lockdown.siteId };
   *   await fastify.prisma.door.updateMany({ where: doorFilter, data: { status: 'UNLOCKED' } });
   *
   * This means ALL doors in scope get UNLOCKED on release, including emergency exits.
   * If an emergency exit was manually LOCKED (e.g., security lockdown of an exit),
   * the release will incorrectly unlock it.
   */
  it.fails('should not change emergency exit door status during lockdown release', async () => {
    const token = await authenticateAs(app, 'admin');

    // The seed door "Main Emergency Exit" (mainExit) is isEmergencyExit=true.
    // Simulate a security scenario: someone manually locked the emergency exit.
    await app.prisma.door.update({
      where: { id: SEED.doors.mainExit },
      data: { status: 'LOCKED' },
    });

    // Verify it's locked before lockdown
    const exitDoorBefore = await app.prisma.door.findUnique({
      where: { id: SEED.doors.mainExit },
    });
    expect(exitDoorBefore!.status).toBe('LOCKED');
    expect(exitDoorBefore!.isEmergencyExit).toBe(true);

    // Initiate a FULL_SITE lockdown
    const lockdownRes = await app.inject({
      method: 'POST',
      url: '/api/v1/lockdown',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: 'FULL_SITE',
        targetId: SEED.siteId,
      },
    });
    expect(lockdownRes.statusCode).toBe(201);
    const lockdown = JSON.parse(lockdownRes.body);

    // Emergency exit should still be LOCKED (initiate correctly skips it)
    const exitDoorDuringLockdown = await app.prisma.door.findUnique({
      where: { id: SEED.doors.mainExit },
    });
    expect(exitDoorDuringLockdown!.status).toBe('LOCKED');

    // Now release the lockdown
    const releaseRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/lockdown/${lockdown.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(releaseRes.statusCode).toBe(200);

    // BUG: The release does NOT exclude emergency exits from the UNLOCK.
    // The emergency exit door that was manually LOCKED should remain LOCKED,
    // but the release will UNLOCK it because the doorFilter doesn't exclude
    // isEmergencyExit doors.
    const exitDoorAfterRelease = await app.prisma.door.findUnique({
      where: { id: SEED.doors.mainExit },
    });

    // This FAILS: the door was changed to UNLOCKED by the release
    expect(exitDoorAfterRelease!.status).toBe('LOCKED');
  });
});

describe('FIXED: Role check on lockdown initiate', () => {
  /**
   * Previously a bug: no role check on lockdown initiation.
   * Now FIXED: only SUPER_ADMIN, SITE_ADMIN, OPERATOR, and FIRST_RESPONDER can initiate.
   * TEACHER and PARENT roles are rejected with 403.
   */
  it('rejects lockdown initiation from a TEACHER role', async () => {
    const teacherToken = await authenticateAs(app, 'teacher1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lockdown',
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        scope: 'FULL_SITE',
        targetId: SEED.siteId,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('ROLE_LEVEL_REQUIRED');
  });

  it('allows lockdown initiation from a FIRST_RESPONDER role', async () => {
    const responderToken = await authenticateAs(app, 'responder');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lockdown',
      headers: { authorization: `Bearer ${responderToken}` },
      payload: {
        scope: 'BUILDING',
        targetId: SEED.buildings.mainId,
      },
    });

    // FIRST_RESPONDER is now an allowed role for lockdown initiation
    expect(res.statusCode).toBe(201);
  });
});

describe('BUG: ZONE scope not implemented', () => {
  /**
   * Bug location: lockdown.ts lines 19-25
   *
   * The LockdownScope enum has ZONE, but the route only handles BUILDING and FLOOR.
   * When scope=ZONE, the doorFilter only has { siteId, isEmergencyExit: false },
   * meaning it locks ALL non-emergency-exit doors at the site (same as FULL_SITE).
   *
   * Doors in the seed have zone values like 'entrance', 'south', 'admin', 'common',
   * 'athletics', 'hallway'. A ZONE lockdown targeting 'entrance' should only lock
   * doors in the 'entrance' zone.
   */
  it.fails('should only lock doors in the specified zone, not all site doors', async () => {
    // Unlock all doors first
    await app.prisma.door.updateMany({
      where: { siteId: SEED.siteId },
      data: { status: 'UNLOCKED' },
    });

    const token = await authenticateAs(app, 'admin');

    // Initiate a ZONE lockdown targeting the 'entrance' zone.
    // The targetId for a ZONE lockdown should identify the zone.
    const lockdownRes = await app.inject({
      method: 'POST',
      url: '/api/v1/lockdown',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: 'ZONE',
        targetId: 'entrance', // zone name
      },
    });

    expect(lockdownRes.statusCode).toBe(201);

    // Check: doors in the 'admin' zone should still be UNLOCKED
    // (office door has zone='admin')
    const officeDoor = await app.prisma.door.findUnique({
      where: { id: SEED.doors.mainEntrance },
    });
    // The main entrance IS in the 'entrance' zone, so it should be locked.
    // But let's check a door NOT in the entrance zone:
    const hallwayDoor = await app.prisma.door.findUnique({
      where: { id: '00000000-0000-4000-a000-000000002006' }, // hallway1, zone='hallway'
    });

    // BUG: This FAILS -- the hallway door is LOCKED even though we only
    // requested a ZONE lockdown for 'entrance'. The ZONE scope falls through
    // without setting any zone filter, so ALL non-emergency-exit doors get locked.
    expect(hallwayDoor!.status).toBe('UNLOCKED');

    // Also check: the office door (zone='admin') should be UNLOCKED
    const offDoor = await app.prisma.door.findUnique({
      where: { id: '00000000-0000-4000-a000-000000002003' }, // office, zone='admin'
    });
    expect(offDoor!.status).toBe('UNLOCKED');
  });
});
