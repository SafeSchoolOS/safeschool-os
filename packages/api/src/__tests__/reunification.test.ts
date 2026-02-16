import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from './setup.js';
import { authenticateAs, SEED } from './helpers.js';
import { signResponderToken } from '../middleware/responder-auth.js';

// ============================================================================
// Seed IDs (from packages/db/src/seed.ts)
// ============================================================================
const SITE_ID = '00000000-0000-4000-a000-000000000001';
const AGENCY_CPD = '00000000-0000-4000-a000-00000000b001';
const SGT_SMITH = '00000000-0000-4000-a000-00000000c001';
const REUNIFICATION_SITE_1 = '00000000-0000-4000-a000-00000000e001'; // Primary, Cranston Community Center
const REUNIFICATION_SITE_2 = '00000000-0000-4000-a000-00000000e002';

// ============================================================================
// Token helpers
// ============================================================================
function makeCommandToken() {
  return signResponderToken({
    id: SGT_SMITH,
    email: 'sgt.smith@cranstonpd.gov',
    role: 'COMMAND',
    agencyId: AGENCY_CPD,
    permissions: [
      'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS',
      'CONTROL_DOORS', 'VIEW_VISITOR_LIST', 'VIEW_STUDENT_ACCOUNTABILITY',
      'VIEW_INCIDENT_LOGS', 'EXPORT_DATA', 'COMMUNICATE_STAFF', 'VIEW_TIPS',
    ],
  });
}

// ============================================================================
// Test Suite
// ============================================================================
let app: FastifyInstance;
let testIncidentId: string;

beforeAll(async () => {
  app = await buildTestServer();

  // Create a test incident for reunification events
  const token = await authenticateAs(app, 'admin');
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/incidents',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      siteId: SITE_ID,
      type: 'LOCKDOWN_INCIDENT',
      severity: 'HIGH_INCIDENT',
      triggerBuildingId: SEED.buildings.mainId,
      triggerFloor: 1,
      triggerRoom: 'Main Office',
      notes: 'Reunification test incident',
    },
  });
  expect(res.statusCode).toBe(201);
  testIncidentId = JSON.parse(res.body).id;
});

afterAll(async () => {
  // Clean up all test-created data before closing
  const seedPrefix = '00000000-0000-4000-a000-';
  const nonSeed = { id: { not: { startsWith: seedPrefix } } };

  // FR reunification child tables first
  await app.prisma.studentRelease.deleteMany({ where: nonSeed });
  await app.prisma.guardianCheckIn.deleteMany({ where: nonSeed });
  await app.prisma.fRReunificationEvent.deleteMany({ where: nonSeed });

  // Notification logs
  await app.prisma.notificationLog.deleteMany({ where: nonSeed });

  // Incident child tables
  await app.prisma.doorCommand.deleteMany({ where: nonSeed });
  await app.prisma.incidentTimeline.deleteMany({ where: nonSeed });
  await app.prisma.incidentAgency.deleteMany({
    where: { incidentId: { not: { startsWith: seedPrefix } } },
  });
  await app.prisma.incident.deleteMany({ where: nonSeed });

  // Audit logs and lockdown commands
  await app.prisma.auditLog.deleteMany({ where: nonSeed });
  await app.prisma.responderAuditLog.deleteMany({ where: nonSeed });
  await app.prisma.lockdownCommand.deleteMany({ where: nonSeed });

  await cleanupTestData(app);
  await app.close();
});

afterEach(async () => {
  // Clean up reunification-specific data created during individual tests
  const seedPrefix = '00000000-0000-4000-a000-';
  const nonSeed = { id: { not: { startsWith: seedPrefix } } };

  await app.prisma.studentRelease.deleteMany({ where: nonSeed });
  await app.prisma.guardianCheckIn.deleteMany({ where: nonSeed });
  await app.prisma.fRReunificationEvent.deleteMany({ where: nonSeed });
  await app.prisma.notificationLog.deleteMany({ where: nonSeed });
  await app.prisma.auditLog.deleteMany({ where: nonSeed });
  await app.prisma.responderAuditLog.deleteMany({ where: nonSeed });
});

// ============================================================================
// Helper: create a reunification event
// ============================================================================
async function createReunificationEvent(overrides: {
  reunificationSiteId?: string;
  role?: 'admin' | 'operator';
} = {}): Promise<any> {
  const token = await authenticateAs(app, overrides.role || 'admin');
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/reunification/events',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      incidentId: testIncidentId,
      siteId: SITE_ID,
      reunificationSiteId: overrides.reunificationSiteId || REUNIFICATION_SITE_1,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body);
}

// ============================================================================
// Helper: get a seed student
// ============================================================================
async function getSeedStudent(): Promise<{ id: string; firstName: string; lastName: string }> {
  const student = await app.prisma.student.findFirst({
    where: { siteId: SITE_ID, isActive: true },
  });
  if (!student) throw new Error('No active students in seed data');
  return student;
}

// ============================================================================
// 1. Reunification Event Management
// ============================================================================
describe('Reunification Event Management', () => {
  it('POST /api/v1/reunification/events — create event (admin, OPERATOR+)', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reunification/events',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        incidentId: testIncidentId,
        siteId: SITE_ID,
        reunificationSiteId: REUNIFICATION_SITE_1,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.incidentId).toBe(testIncidentId);
    expect(body.siteId).toBe(SITE_ID);
    expect(body.reunificationSiteId).toBe(REUNIFICATION_SITE_1);
    expect(body.status).toBe('PREPARING');
    expect(body.totalStudents).toBeGreaterThanOrEqual(0);
    expect(body.startedAt).toBeDefined();
  });

  it('POST /api/v1/reunification/events — totalStudents auto-counted from active students', async () => {
    const token = await authenticateAs(app, 'admin');

    // Count active students directly
    const expectedCount = await app.prisma.student.count({
      where: { siteId: SITE_ID, isActive: true },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reunification/events',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        incidentId: testIncidentId,
        siteId: SITE_ID,
        reunificationSiteId: REUNIFICATION_SITE_1,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.totalStudents).toBe(expectedCount);
  });

  it('GET /api/v1/reunification/events — list events (filter by siteId)', async () => {
    await createReunificationEvent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reunification/events?siteId=${SITE_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const event = body[0];
    expect(event.siteId).toBe(SITE_ID);
    expect(event.reunificationSite).toBeDefined();
    expect(event._count).toBeDefined();
    expect(typeof event._count.guardianCheckIns).toBe('number');
    expect(typeof event._count.studentReleases).toBe('number');
  });

  it('GET /api/v1/reunification/events/:id — event detail with _count', async () => {
    const event = await createReunificationEvent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reunification/events/${event.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.id).toBe(event.id);
    expect(body.reunificationSite).toBeDefined();
    expect(body._count).toBeDefined();
    expect(typeof body._count.guardianCheckIns).toBe('number');
    expect(typeof body._count.studentReleases).toBe('number');
  });

  it('PUT /api/v1/reunification/events/:id — update status to ACTIVE_REUNIFICATION', async () => {
    const event = await createReunificationEvent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/reunification/events/${event.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'ACTIVE_REUNIFICATION' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ACTIVE_REUNIFICATION');
    expect(body.completedAt).toBeNull();
  });

  it('PUT /api/v1/reunification/events/:id — complete event (COMPLETED_REUNIFICATION)', async () => {
    const event = await createReunificationEvent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/reunification/events/${event.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'COMPLETED_REUNIFICATION' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('COMPLETED_REUNIFICATION');
    expect(body.completedAt).not.toBeNull();
    expect(body.completedAt).toBeDefined();
  });

  it('should reject create from teacher role (below OPERATOR)', async () => {
    const token = await authenticateAs(app, 'teacher1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reunification/events',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        incidentId: testIncidentId,
        siteId: SITE_ID,
        reunificationSiteId: REUNIFICATION_SITE_1,
      },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ============================================================================
// 2. Guardian Check-In
// ============================================================================
describe('Guardian Check-In', () => {
  it('POST /api/v1/reunification/events/:id/checkin — check in guardian', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        guardianName: 'Sarah Johnson',
        guardianIdType: 'Driver License',
        guardianIdLast4: '1234',
        guardianIdVerified: true,
        requestedStudentIds: [student.id],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.reunificationEventId).toBe(event.id);
    expect(body.guardianName).toBe('Sarah Johnson');
    expect(body.guardianIdType).toBe('Driver License');
    expect(body.guardianIdLast4).toBe('1234');
    expect(body.guardianIdVerified).toBe(true);
    expect(body.requestedStudentIds).toContain(student.id);
    expect(body.status).toBe('CHECKED_IN');
    expect(body.checkedInAt).toBeDefined();
    // authorizedInSis is set based on ParentContact lookup
    expect(typeof body.authorizedInSis).toBe('boolean');
  });

  it('GET /api/v1/reunification/events/:id/checkins — list check-ins', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const token = await authenticateAs(app, 'admin');

    // Create a check-in first
    await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        guardianName: 'John Doe',
        guardianIdType: 'Passport',
        guardianIdLast4: '5678',
        guardianIdVerified: true,
        requestedStudentIds: [student.id],
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reunification/events/${event.id}/checkins`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const checkIn = body[0];
    expect(checkIn.guardianName).toBe('John Doe');
    expect(checkIn.studentReleases).toBeDefined();
    expect(Array.isArray(checkIn.studentReleases)).toBe(true);
  });

  it('PUT /api/v1/reunification/events/:id/checkins/:checkInId — update status to WAITING', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const token = await authenticateAs(app, 'admin');

    // Create check-in
    const checkInRes = await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        guardianName: 'Jane Smith',
        guardianIdVerified: true,
        requestedStudentIds: [student.id],
      },
    });
    const checkIn = JSON.parse(checkInRes.body);

    // Update status to WAITING
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/reunification/events/${event.id}/checkins/${checkIn.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'WAITING' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('WAITING');
  });

  it('PUT /api/v1/reunification/events/:id/checkins/:checkInId — deny with reason', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const token = await authenticateAs(app, 'admin');

    // Create check-in
    const checkInRes = await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        guardianName: 'Unknown Person',
        guardianIdVerified: false,
        requestedStudentIds: [student.id],
      },
    });
    const checkIn = JSON.parse(checkInRes.body);

    // Deny with reason
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/reunification/events/${event.id}/checkins/${checkIn.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        status: 'DENIED',
        denyReason: 'Not in emergency contacts',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('DENIED');
    expect(body.denyReason).toBe('Not in emergency contacts');
  });

  it('check-in includes studentReleases relation', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const token = await authenticateAs(app, 'admin');

    // Create check-in
    const checkInRes = await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        guardianName: 'Sarah Johnson',
        guardianIdVerified: true,
        requestedStudentIds: [student.id],
      },
    });
    const checkIn = JSON.parse(checkInRes.body);

    // List check-ins to see includes
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reunification/events/${event.id}/checkins`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body);
    const found = body.find((ci: any) => ci.id === checkIn.id);
    expect(found).toBeDefined();
    expect(found.studentReleases).toBeDefined();
    expect(Array.isArray(found.studentReleases)).toBe(true);
  });
});

// ============================================================================
// 3. Student Release
// ============================================================================
describe('Student Release', () => {
  it('POST /api/v1/reunification/events/:id/release — release student', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/release`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`,
        releasedTo: 'Sarah Johnson',
        notes: 'Parent verified',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.reunificationEventId).toBe(event.id);
    expect(body.studentId).toBe(student.id);
    expect(body.studentName).toBe(`${student.firstName} ${student.lastName}`);
    expect(body.releasedTo).toBe('Sarah Johnson');
    expect(body.releasedAt).toBeDefined();
    expect(body.notes).toBe('Parent verified');

    // Verify studentsReleased was incremented on the event
    const updatedEvent = await app.prisma.fRReunificationEvent.findUnique({
      where: { id: event.id },
    });
    expect(updatedEvent!.studentsReleased).toBe(1);
  });

  it('GET /api/v1/reunification/events/:id/releases — list releases', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const token = await authenticateAs(app, 'admin');

    // Create a release
    await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/release`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`,
        releasedTo: 'John Doe',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reunification/events/${event.id}/releases`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].studentId).toBe(student.id);
    expect(body[0].releasedTo).toBe('John Doe');
  });

  it('guardian check-in status auto-updates to RELEASED when all requested students released', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const token = await authenticateAs(app, 'admin');

    // Create a guardian check-in requesting one student
    const checkInRes = await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        guardianName: 'Sarah Johnson',
        guardianIdVerified: true,
        requestedStudentIds: [student.id],
      },
    });
    const checkIn = JSON.parse(checkInRes.body);
    expect(checkIn.status).toBe('CHECKED_IN');

    // Release the student linked to this check-in
    await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/release`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`,
        guardianCheckInId: checkIn.id,
        releasedTo: 'Sarah Johnson',
      },
    });

    // Verify the guardian check-in was auto-updated to RELEASED
    const updatedCheckIn = await app.prisma.guardianCheckIn.findUnique({
      where: { id: checkIn.id },
    });
    expect(updatedCheckIn!.status).toBe('RELEASED');
  });

  it('student accountability endpoint shows student as RELEASED after release', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const token = await authenticateAs(app, 'admin');

    // Release the student
    await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/release`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`,
        releasedTo: 'Sarah Johnson',
      },
    });

    // Check accountability
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reunification/events/${event.id}/students`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const released = body.students.find((s: any) => s.id === student.id);
    expect(released).toBeDefined();
    expect(released.status).toBe('RELEASED');
    expect(released.releasedTo).toBe('Sarah Johnson');
  });
});

// ============================================================================
// 4. Student Accountability
// ============================================================================
describe('Student Accountability', () => {
  it('GET /api/v1/reunification/events/:id/students — student list with summary', async () => {
    const event = await createReunificationEvent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reunification/events/${event.id}/students`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.students).toBeDefined();
    expect(Array.isArray(body.students)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.total).toBe('number');
    expect(typeof body.summary.accounted).toBe('number');
    expect(typeof body.summary.released).toBe('number');
    expect(typeof body.summary.missing).toBe('number');
    expect(typeof body.summary.injured).toBe('number');
  });

  it('unreleased students show as ACCOUNTED', async () => {
    const event = await createReunificationEvent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reunification/events/${event.id}/students`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body);

    // With no releases, all students should be ACCOUNTED
    for (const student of body.students) {
      expect(student.status).toBe('ACCOUNTED');
    }
  });

  it('summary.total matches actual student count', async () => {
    const event = await createReunificationEvent();
    const token = await authenticateAs(app, 'admin');

    // Get actual count from DB
    const expectedCount = await app.prisma.student.count({
      where: { siteId: SITE_ID, isActive: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reunification/events/${event.id}/students`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body);
    expect(body.students.length).toBe(expectedCount);
    expect(body.summary.total).toBe(expectedCount);
  });
});

// ============================================================================
// 5. Responder Reunification Access
// ============================================================================
describe('Responder Reunification Access', () => {
  it('GET /api/responder/reunification/events — list events (COMMAND token)', async () => {
    await createReunificationEvent();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: '/api/responder/reunification/events',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const event = body[0];
    expect(event.siteId).toBe(SITE_ID);
    expect(event.reunificationSite).toBeDefined();
    expect(event._count).toBeDefined();
  });

  it('GET /api/responder/reunification/events/:id — event detail', async () => {
    const event = await createReunificationEvent();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/reunification/events/${event.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.id).toBe(event.id);
    expect(body.site).toBeDefined();
    expect(body.reunificationSite).toBeDefined();
    expect(body._count).toBeDefined();
    expect(typeof body._count.guardianCheckIns).toBe('number');
    expect(typeof body._count.studentReleases).toBe('number');
  });

  it('GET /api/responder/reunification/events/:id/students — student accountability', async () => {
    const event = await createReunificationEvent();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/reunification/events/${event.id}/students`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.students).toBeDefined();
    expect(Array.isArray(body.students)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary.total).toBe('number');
    expect(typeof body.summary.accounted).toBe('number');
    expect(typeof body.summary.released).toBe('number');
    expect(typeof body.summary.missing).toBe('number');
    expect(typeof body.summary.injured).toBe('number');
  });

  it('GET /api/responder/reunification/events/:id/checkins — check-ins', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const adminToken = await authenticateAs(app, 'admin');

    // Create a check-in via admin API
    await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/checkin`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        guardianName: 'Test Parent',
        guardianIdVerified: true,
        requestedStudentIds: [student.id],
      },
    });

    const token = makeCommandToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/reunification/events/${event.id}/checkins`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const checkIn = body[0];
    expect(checkIn.guardianName).toBe('Test Parent');
    expect(checkIn.studentReleases).toBeDefined();
  });

  it('GET /api/responder/reunification/events/:id/releases — releases', async () => {
    const event = await createReunificationEvent();
    const student = await getSeedStudent();
    const adminToken = await authenticateAs(app, 'admin');

    // Create a release via admin API
    await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/release`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`,
        releasedTo: 'Test Parent',
      },
    });

    const token = makeCommandToken();
    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/reunification/events/${event.id}/releases`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].studentId).toBe(student.id);
    expect(body[0].releasedTo).toBe('Test Parent');
  });
});

// ============================================================================
// 6. Parent Notifications
// ============================================================================
describe('Parent Notifications', () => {
  it('POST /api/v1/reunification/events/:id/notify — send notification', async () => {
    const event = await createReunificationEvent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/notify`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        message: 'Reunification has started at Cranston Community Center. Please proceed to the pickup area.',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.notificationCount).toBeDefined();
    expect(typeof body.notificationCount).toBe('number');
    expect(body.channels).toBeDefined();
    expect(Array.isArray(body.channels)).toBe(true);
    expect(body.channels.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/v1/reunification/events/:id/notify/update — send update', async () => {
    const event = await createReunificationEvent();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/notify/update`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        message: 'Students being released',
        updateType: 'REUNIFICATION_UPDATE',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.notificationCount).toBeDefined();
    expect(typeof body.notificationCount).toBe('number');
    expect(body.channels).toBeDefined();
    expect(Array.isArray(body.channels)).toBe(true);
  });

  it('should reject notification from non-OPERATOR role (teacher)', async () => {
    const event = await createReunificationEvent();
    const token = await authenticateAs(app, 'teacher1');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/reunification/events/${event.id}/notify`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        message: 'Unauthorized notification attempt',
      },
    });

    expect(res.statusCode).toBe(403);
  });
});
