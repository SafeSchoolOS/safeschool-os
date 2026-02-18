/**
 * Transportation Bug Tests
 *
 * These tests expose real bugs in the SafeSchool transportation module
 * related to negative counts, FK violations, missing validation,
 * authorization gaps, and stale data.
 *
 * ALL of these tests are expected to FAIL, proving the bugs exist.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from '../setup.js';
import { authenticateAs, SEED } from '../helpers.js';

// Seed transportation IDs (from packages/db/src/seed.ts)
const TRANSPORT = {
  bus42Id: '00000000-0000-4000-a000-000000003001',
  routeAm1Id: '00000000-0000-4000-a000-000000003010',
  student1CardId: '00000000-0000-4000-a000-000000004001',
  student1RfidTag: 'RFID-001-2026',
  student2CardId: '00000000-0000-4000-a000-000000004002',
  student2RfidTag: 'RFID-002-2026',
  parent1Id: '00000000-0000-4000-a000-000000005001',
  parent2Id: '00000000-0000-4000-a000-000000005002',
};

describe('Transportation Bugs', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildTestServer();
    token = await authenticateAs(app, 'admin');
  });

  afterEach(async () => {
    // Clean up non-seed ridership events and buses
    const seedPrefix = '00000000-0000-4000-a000-';
    await app.prisma.ridershipEvent.deleteMany({
      where: { id: { not: { startsWith: seedPrefix } } },
    });
    await app.prisma.busRouteAssignment.deleteMany({
      where: { id: { not: { startsWith: seedPrefix } } },
    });
    await app.prisma.bus.deleteMany({
      where: { id: { not: { startsWith: seedPrefix } } },
    });
    await app.prisma.parentContact.deleteMany({
      where: { id: { not: { startsWith: seedPrefix } } },
    });

    // Reset bus42 student count to 0
    await app.prisma.bus.update({
      where: { id: TRANSPORT.bus42Id },
      data: { currentStudentCount: 0 },
    });

    await cleanupTestData(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Bug 1: Bus student count can go negative
  //
  // In transportation.ts lines 211-215:
  //   const countDelta = scanType === 'BOARD' ? 1 : -1;
  //   await fastify.prisma.bus.update({
  //     where: { id: busId },
  //     data: { currentStudentCount: { increment: countDelta } },
  //   });
  //
  // If a student scans EXIT without ever scanning BOARD (or scans EXIT twice),
  // the count goes to -1. There is no floor check at 0.
  // ---------------------------------------------------------------------------
  describe('Bug: Bus student count can go negative (FIXED)', () => {
    it('EXIT scan without prior BOARD scan clamps currentStudentCount to 0', async () => {
      // Verify bus starts at count 0
      const busBefore = await app.prisma.bus.findUnique({
        where: { id: TRANSPORT.bus42Id },
      });
      expect(busBefore!.currentStudentCount).toBe(0);

      // Scan EXIT without ever boarding
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/transportation/scan',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          cardId: TRANSPORT.student1RfidTag,
          busId: TRANSPORT.bus42Id,
          scanType: 'EXIT',
        },
      });

      expect(res.statusCode).toBe(201);

      // Check bus count
      const busAfter = await app.prisma.bus.findUnique({
        where: { id: TRANSPORT.bus42Id },
      });

      // FIXED: EXIT scan now uses Math.max(0, count - 1) to clamp to 0
      expect(busAfter!.currentStudentCount).toBeGreaterThanOrEqual(0);
    });

    it('Double EXIT scan clamps count to 0', async () => {
      // First EXIT (no prior board)
      await app.inject({
        method: 'POST',
        url: '/api/v1/transportation/scan',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          cardId: TRANSPORT.student1RfidTag,
          busId: TRANSPORT.bus42Id,
          scanType: 'EXIT',
        },
      });

      // Second EXIT from different student
      await app.inject({
        method: 'POST',
        url: '/api/v1/transportation/scan',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          cardId: TRANSPORT.student2RfidTag,
          busId: TRANSPORT.bus42Id,
          scanType: 'EXIT',
        },
      });

      const bus = await app.prisma.bus.findUnique({
        where: { id: TRANSPORT.bus42Id },
      });

      // FIXED: count stays at 0 instead of going to -2
      expect(bus!.currentStudentCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 2: RFID scan with no route assignment creates FK violation
  //
  // In transportation.ts line 196:
  //   const routeId = bus.routeAssignments[0]?.routeId || '';
  //
  // When a bus has no route assignments, routeId becomes ''.
  // RidershipEvent.routeId has a FK to BusRoute.id.
  // Creating a ridership event with routeId='' will fail with FK violation.
  // ---------------------------------------------------------------------------
  describe('Bug: RFID scan with no route assignment creates FK violation', () => {
    it.fails('Scanning RFID on a bus with no route produces empty routeId FK violation', async () => {
      // Create a bus with no route assignments
      const busRes = await app.inject({
        method: 'POST',
        url: '/api/v1/transportation/buses',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          busNumber: 'NO-ROUTE-BUS',
          capacity: 40,
          hasRfidReader: true,
        },
      });
      expect(busRes.statusCode).toBe(201);
      const noRouteBus = JSON.parse(busRes.body);

      // Attempt RFID scan on this bus
      const scanRes = await app.inject({
        method: 'POST',
        url: '/api/v1/transportation/scan',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          cardId: TRANSPORT.student1RfidTag,
          busId: noRouteBus.id,
          scanType: 'BOARD',
        },
      });

      // BUG: routeId becomes '' (empty string), which is not a valid BusRoute.id.
      // Prisma will throw a FK constraint violation.
      // The route should handle this gracefully (e.g., return 400 "Bus has no route assigned").
      // Instead, it returns 500 with an unhandled Prisma error.
      expect(scanRes.statusCode).not.toBe(500);
      expect(scanRes.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 3: GPS update with non-existent busId causes Prisma RecordNotFound (500)
  //
  // In transportation.ts lines 139-148:
  //   const bus = await fastify.prisma.bus.update({
  //     where: { id: busId },
  //     data: { ... }
  //   });
  //
  // When busId doesn't exist, Prisma throws P2025 RecordNotFoundError.
  // The route doesn't catch this, resulting in a 500 instead of 404.
  // ---------------------------------------------------------------------------
  describe('Bug: GPS update with non-existent busId causes 500 instead of 404', () => {
    it.fails('POST /transportation/gps with fake busId should return 404, not 500', async () => {
      const fakeBusId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/transportation/gps',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          busId: fakeBusId,
          latitude: 40.7357,
          longitude: -74.1724,
          speed: 25,
          heading: 180,
        },
      });

      // BUG: Prisma throws P2025 (RecordNotFoundError) for bus.update
      // with a non-existent ID. The route doesn't catch this, so Fastify
      // returns 500 Internal Server Error instead of a proper 404.
      expect(res.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 4: Bus capacity not validated
  //
  // In transportation.ts lines 30-37:
  //   const bus = await fastify.prisma.bus.create({
  //     data: { siteId, busNumber, driverId, capacity, ... },
  //   });
  //
  // There is no validation on the capacity field. Negative values,
  // zero, or absurdly large values are all accepted.
  // ---------------------------------------------------------------------------
  describe('Bug: Bus capacity not validated', () => {
    it.fails('POST /transportation/buses accepts negative capacity', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/transportation/buses',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          busNumber: 'NEG-CAP',
          capacity: -5,
        },
      });

      // BUG: A bus with capacity -5 is created successfully.
      // The API should reject negative capacity values.
      expect(res.statusCode).toBe(400);
    });

    it.fails('POST /transportation/buses accepts zero capacity', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/transportation/buses',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          busNumber: 'ZERO-CAP',
          capacity: 0,
        },
      });

      // BUG: A bus with capacity 0 makes no sense.
      expect(res.statusCode).toBe(400);
    });

    it.fails('POST /transportation/buses accepts absurdly large capacity', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/transportation/buses',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          busNumber: 'HUGE-CAP',
          capacity: 999999,
        },
      });

      // BUG: No reasonable school bus has 999,999 capacity.
      // At minimum there should be an upper bound (e.g., 100-200).
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 5: Parent preferences endpoint has no site authorization
  //
  // In transportation.ts lines 308-319:
  //   PATCH /parents/:id/preferences
  //
  // Any authenticated user can modify any parent contact's notification
  // preferences by knowing (or guessing) the parent contact ID.
  // There's no check that the parent belongs to the user's site,
  // and there's no check that the user is the actual parent.
  // ---------------------------------------------------------------------------
  describe('Bug: Parent preferences endpoint has no site authorization', () => {
    it('(FIXED) Teacher can modify any parent contact preferences (no authorization check)', async () => {
      const teacherToken = await authenticateAs(app, 'teacher1');

      // Teacher modifying a parent's notification preferences
      // should require authorization — e.g., only the parent themselves
      // or a site admin should be able to do this.
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/transportation/parents/${TRANSPORT.parent1Id}/preferences`,
        headers: { authorization: `Bearer ${teacherToken}` },
        payload: {
          boardAlerts: false,
          exitAlerts: false,
          missedBusAlerts: false,
          smsEnabled: false,
          emailEnabled: false,
        },
      });

      // BUG: A teacher (who is not the parent and not an admin) can
      // disable all of a parent's safety notifications. This is a
      // serious authorization gap — a disgruntled teacher could silence
      // all parent alerts.
      expect(res.statusCode).toBe(403);
    });

    it('(FIXED) First responder can disable parent alerts for a student they have no relation to', async () => {
      const responderToken = await authenticateAs(app, 'responder');

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/transportation/parents/${TRANSPORT.parent2Id}/preferences`,
        headers: { authorization: `Bearer ${responderToken}` },
        payload: {
          missedBusAlerts: false,
          delayAlerts: false,
        },
      });

      // BUG: A first responder can disable parent notification preferences.
      // No role or ownership check is performed.
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 6: Student status uses latest ridership event without checking date
  //
  // In transportation.ts lines 248-258:
  //   const latestEvent = await fastify.prisma.ridershipEvent.findFirst({
  //     where: { studentCardId: studentCard.id },
  //     orderBy: { scannedAt: 'desc' },
  //   });
  //   status: latestEvent?.scanType === 'BOARD' ? 'ON_BUS' : 'OFF_BUS'
  //
  // This returns the latest event regardless of date. A BOARD event from
  // yesterday would show the student as "ON_BUS" today, which is incorrect.
  // ---------------------------------------------------------------------------
  describe('Bug: Student status uses latest ridership event but ignores date', () => {
    it.fails('BOARD event from yesterday shows student as ON_BUS today', async () => {
      // Create a ridership event from yesterday (BOARD scan)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(7, 30, 0, 0); // 7:30 AM yesterday

      await app.prisma.ridershipEvent.create({
        data: {
          studentCardId: TRANSPORT.student1CardId,
          busId: TRANSPORT.bus42Id,
          routeId: TRANSPORT.routeAm1Id,
          scanType: 'BOARD',
          scanMethod: 'RFID',
          scannedAt: yesterday,
        },
      });

      // Query student status today
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/transportation/student/${TRANSPORT.student1RfidTag}/status`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // BUG: The student boarded a bus YESTERDAY and never exited.
      // The status query finds the BOARD event from yesterday and reports
      // the student as "ON_BUS" today. This is dangerously wrong — the student
      // is almost certainly not on the bus 24+ hours later.
      //
      // The query should filter events to today's date only, or at minimum
      // within the current school day window.
      expect(body.status).toBe('OFF_BUS');
    });

    it.fails('BOARD event from a week ago still shows ON_BUS', async () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(7, 15, 0, 0);

      await app.prisma.ridershipEvent.create({
        data: {
          studentCardId: TRANSPORT.student2CardId,
          busId: TRANSPORT.bus42Id,
          routeId: TRANSPORT.routeAm1Id,
          scanType: 'BOARD',
          scanMethod: 'RFID',
          scannedAt: weekAgo,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/transportation/student/${TRANSPORT.student2RfidTag}/status`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // BUG: A BOARD event from a WEEK ago still shows ON_BUS.
      // This could cause panic if a parent checks status and sees their
      // child supposedly still on a bus from 7 days ago.
      expect(body.status).toBe('OFF_BUS');
    });
  });
});
