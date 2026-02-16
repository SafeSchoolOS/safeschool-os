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
const AGENCY_EMS = '00000000-0000-4000-a000-00000000b003'; // No school link
const SGT_SMITH = '00000000-0000-4000-a000-00000000c001';
const OFR_JONES = '00000000-0000-4000-a000-00000000c002';

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

function makePatrolToken() {
  return signResponderToken({
    id: OFR_JONES,
    email: 'ofr.jones@cranstonpd.gov',
    role: 'PATROL',
    agencyId: AGENCY_CPD,
    permissions: [
      'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS',
      'VIEW_VISITOR_LIST', 'VIEW_INCIDENT_LOGS', 'COMMUNICATE_STAFF',
    ],
  });
}

function makeUnlinkedToken() {
  return signResponderToken({
    id: '00000000-0000-4000-a000-eeeeeeeeeeee',
    email: 'fake@cranstonems.gov',
    role: 'COMMAND',
    agencyId: AGENCY_EMS,
    permissions: [
      'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'CONTROL_DOORS',
      'COMMUNICATE_STAFF',
    ],
  });
}

// ============================================================================
// Test Suite
// ============================================================================
let app: FastifyInstance;
let incidentId: string;
let adminToken: string;
let adminUserId: string;

beforeAll(async () => {
  app = await buildTestServer();

  // Get admin token and userId
  adminToken = await authenticateAs(app, 'admin');
  adminUserId = SEED.users.admin.id;

  // Create a test incident for all sections
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/incidents',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      siteId: SITE_ID,
      type: 'LOCKDOWN_INCIDENT',
      severity: 'HIGH_INCIDENT',
      triggerBuildingId: SEED.buildings.mainId,
      triggerFloor: 1,
      triggerRoom: 'Main Office',
      notes: 'Communication test incident',
    },
  });

  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.body);
  incidentId = body.id;
});

afterAll(async () => {
  // Clean up test-created data
  const seedPrefix = '00000000-0000-4000-a000-';
  const nonSeed = { id: { not: { startsWith: seedPrefix } } };

  // Delete in FK order: children first
  await app.prisma.videoBookmark.deleteMany({ where: nonSeed });
  await app.prisma.secureMessage.deleteMany({ where: nonSeed });
  await app.prisma.doorCommand.deleteMany({ where: nonSeed });
  await app.prisma.incidentTimeline.deleteMany({ where: nonSeed });
  await app.prisma.incidentAgency.deleteMany({
    where: { incidentId: { not: { startsWith: seedPrefix } } },
  });
  await app.prisma.responderAuditLog.deleteMany({ where: nonSeed });

  await cleanupTestData(app);

  await app.prisma.lockdownCommand.deleteMany({ where: nonSeed });
  await app.prisma.incident.deleteMany({ where: nonSeed });

  await app.close();
});

// ============================================================================
// 1. Staff Messaging
// ============================================================================
describe('Staff Messaging', () => {
  it('POST /api/v1/messages — send message from staff (BROADCAST)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        incidentId,
        content: 'All staff shelter in place <script>alert("xss")</script>',
        recipientType: 'BROADCAST',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.senderType).toBe('STAFF');
    expect(body.senderId).toBe(adminUserId);
    expect(body.recipientType).toBe('BROADCAST');
    expect(body.incidentId).toBe(incidentId);
    // Content should be sanitized (XSS stripped)
    expect(body.content).not.toContain('<script>');
    expect(body.content).toContain('All staff shelter in place');
    expect(body.threadId).toBeDefined();
    expect(body.messageType).toBe('TEXT');
  });

  it('GET /api/v1/messages?incidentId=XXX — list messages', async () => {
    // Ensure at least one message exists (from prior test or create one)
    await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        incidentId,
        content: 'Test list message',
        recipientType: 'BROADCAST',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/messages?incidentId=${incidentId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.messages).toBeDefined();
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.total).toBe('number');
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/messages/threads?incidentId=XXX — list threads', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/messages/threads?incidentId=${incidentId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const thread = body[0];
    expect(thread.threadId).toBeDefined();
    expect(thread.lastMessagePreview).toBeDefined();
    expect(thread.lastMessageAt).toBeDefined();
    expect(thread.lastSenderName).toBeDefined();
    expect(thread.lastSenderType).toBeDefined();
    expect(typeof thread.messageCount).toBe('number');
    expect(typeof thread.unreadCount).toBe('number');
  });

  it('PUT /api/v1/messages/:id/read — mark as read', async () => {
    // Create a message first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        incidentId,
        content: 'Message to mark as read',
        recipientType: 'BROADCAST',
      },
    });

    const message = JSON.parse(createRes.body);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/messages/${message.id}/read`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(message.id);
    expect(body.readAt).toBeDefined();
  });

  it('should reject message send for incident not in user sites', async () => {
    // Teacher1 is at the same site, but let's create a message with a fake incident ID
    // that doesn't belong to any site the user has access to
    const fakeIncidentId = '00000000-0000-0000-0000-ffffffffffff';

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        incidentId: fakeIncidentId,
        content: 'Should be rejected',
        recipientType: 'BROADCAST',
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Incident not found');
  });
});

// ============================================================================
// 2. Responder Messaging
// ============================================================================
describe('Responder Messaging', () => {
  it('POST /api/responder/incidents/:id/messages — send from responder', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incidentId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        content: 'Units arriving in 2 minutes',
        recipientType: 'BROADCAST',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.senderType).toBe('RESPONDER');
    expect(body.senderId).toBe(SGT_SMITH);
    // senderName should include the responder's name from DB
    expect(body.senderName).toBeDefined();
    expect(typeof body.senderName).toBe('string');
    expect(body.senderName.length).toBeGreaterThan(0);
    expect(body.incidentId).toBe(incidentId);
    expect(body.recipientType).toBe('BROADCAST');
  });

  it('GET /api/responder/incidents/:id/messages — list messages', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incidentId}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.messages).toBeDefined();
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.total).toBe('number');
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('PUT /api/responder/incidents/:id/messages/:messageId/read — mark as read', async () => {
    const token = makeCommandToken();

    // Create a message to mark as read
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incidentId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        content: 'Responder message to mark read',
        recipientType: 'BROADCAST',
      },
    });

    const message = JSON.parse(createRes.body);

    const readRes = await app.inject({
      method: 'PUT',
      url: `/api/responder/incidents/${incidentId}/messages/${message.id}/read`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(readRes.statusCode).toBe(200);
    const body = JSON.parse(readRes.body);
    expect(body.id).toBe(message.id);
    expect(body.readAt).toBeDefined();
  });

  it('should reject messaging for unlinked agency', async () => {
    const token = makeUnlinkedToken();

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incidentId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        content: 'Should be rejected',
        recipientType: 'BROADCAST',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No access to this incident');
  });

  it('should reject message listing for unlinked agency', async () => {
    const token = makeUnlinkedToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incidentId}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No access to this incident');
  });
});

// ============================================================================
// 3. Dispatch Integration
// ============================================================================
describe('Dispatch Integration', () => {
  const DISPATCH_API_KEY = 'test-dispatch-api-key-12345';
  let alertId: string;

  beforeAll(async () => {
    // Set the dispatch API key for tests
    process.env.DISPATCH_API_KEY = DISPATCH_API_KEY;

    // Create an Alert record directly via Prisma for dispatch tests
    const alert = await app.prisma.alert.create({
      data: {
        siteId: SITE_ID,
        type: 'PANIC',
        severity: 'CRITICAL',
        status: 'ACTIVE',
        triggeredById: adminUserId,
        description: 'Test panic alert',
      },
    });
    alertId = alert.id;
  });

  afterAll(async () => {
    // Clean up the alert
    await app.prisma.dispatchRecord.deleteMany({
      where: { alertId },
    });
    await app.prisma.alert.deleteMany({
      where: { id: alertId },
    });
    delete process.env.DISPATCH_API_KEY;
  });

  it('POST /api/dispatch/alerts — push alert (creates incident and dispatch record)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dispatch/alerts',
      headers: { 'x-api-key': DISPATCH_API_KEY },
      payload: {
        alertId,
        siteId: SITE_ID,
        incidentType: 'ACTIVE_THREAT',
        severity: 'CRITICAL_INCIDENT',
        location: {
          buildingId: SEED.buildings.mainId,
          floor: 1,
          room: 'Main Office',
        },
        description: 'Panic button activated',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.dispatchRecord).toBeDefined();
    expect(body.dispatchRecord.id).toBeDefined();
    expect(body.dispatchRecord.alertId).toBe(alertId);
    expect(body.dispatchRecord.status).toBe('SENT');
    expect(body.incident).toBeDefined();
    expect(body.incident.id).toBeDefined();
    expect(body.incident.status).toBeDefined();
  });

  it('POST /api/dispatch/alerts/:alertId/acknowledge — PSAP ack', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/dispatch/alerts/${alertId}/acknowledge`,
      headers: { 'x-api-key': DISPATCH_API_KEY },
      payload: {
        acknowledgedBy: 'Dispatcher Johnson',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.dispatchRecord).toBeDefined();
    expect(body.dispatchRecord.confirmedAt).toBeDefined();
    expect(body.dispatchRecord.status).toBe('RECEIVED');
    expect(body.dispatchRecord.responseTimeMs).toBeDefined();
    expect(typeof body.dispatchRecord.responseTimeMs).toBe('number');
  });

  it('POST /api/dispatch/alerts/:alertId/dispatch — units dispatched', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/dispatch/alerts/${alertId}/dispatch`,
      headers: { 'x-api-key': DISPATCH_API_KEY },
      payload: {
        unitCount: 3,
        unitIds: ['CPD-Unit-1', 'CPD-Unit-2', 'CPD-Unit-3'],
        estimatedArrival: '5 minutes',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.incident).toBeDefined();
    expect(body.incident.status).toBe('RESPONDING_INCIDENT');
    expect(body.dispatched).toBeDefined();
    expect(body.dispatched.unitCount).toBe(3);
    expect(body.dispatched.unitIds).toEqual(['CPD-Unit-1', 'CPD-Unit-2', 'CPD-Unit-3']);
  });

  it('POST /api/dispatch/alerts/:alertId/on-scene — on scene', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/dispatch/alerts/${alertId}/on-scene`,
      headers: { 'x-api-key': DISPATCH_API_KEY },
      payload: {
        officerId: 'CPD-1247',
        officerName: 'Sgt. Smith',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.incident).toBeDefined();
    expect(body.incident.firstResponderArrival).toBeDefined();
    expect(body.responseTimeMs).toBeDefined();
    expect(typeof body.responseTimeMs).toBe('number');
    expect(body.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/dispatch/schools/:schoolId/facility-data — returns facility data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/dispatch/schools/${SITE_ID}/facility-data`,
      headers: { 'x-api-key': DISPATCH_API_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.site).toBeDefined();
    expect(body.site.id).toBe(SITE_ID);
    expect(body.site.name).toBeDefined();
    expect(body.site.address).toBeDefined();

    expect(body.buildings).toBeDefined();
    expect(Array.isArray(body.buildings)).toBe(true);
    expect(body.buildings.length).toBeGreaterThanOrEqual(1);

    expect(body.doors).toBeDefined();
    expect(typeof body.doors.total).toBe('number');
    expect(body.doors.statusSummary).toBeDefined();

    expect(body.floorPlans).toBeDefined();
    expect(Array.isArray(body.floorPlans)).toBe(true);

    expect(body.keyHolders).toBeDefined();
    expect(Array.isArray(body.keyHolders)).toBe(true);
  });

  it('should reject dispatch API without API key (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dispatch/alerts',
      // No x-api-key header
      payload: {
        alertId,
        siteId: SITE_ID,
        incidentType: 'ACTIVE_THREAT',
        severity: 'CRITICAL_INCIDENT',
        location: {},
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Missing X-API-Key header');
  });

  it('should reject dispatch API with wrong API key (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dispatch/alerts',
      headers: { 'x-api-key': 'wrong-api-key-here' },
      payload: {
        alertId,
        siteId: SITE_ID,
        incidentType: 'ACTIVE_THREAT',
        severity: 'CRITICAL_INCIDENT',
        location: {},
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Invalid API key');
  });
});

// ============================================================================
// 4. Post-Incident
// ============================================================================
describe('Post-Incident', () => {
  it('GET /api/responder/incidents/:id/report — returns incident summary', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incidentId}/report`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.incident).toBeDefined();
    expect(body.incident.id).toBe(incidentId);
    expect(body.incident.type).toBeDefined();
    expect(body.incident.severity).toBeDefined();
    expect(body.incident.status).toBeDefined();
    expect(body.incident.triggeredAt).toBeDefined();
    expect(body.incident.site).toBeDefined();
    expect(body.incident.site.id).toBe(SITE_ID);
    expect(body.incident.site.name).toBeDefined();

    expect(body.timeline).toBeDefined();
    expect(Array.isArray(body.timeline)).toBe(true);

    expect(body.respondingAgencies).toBeDefined();
    expect(Array.isArray(body.respondingAgencies)).toBe(true);

    expect(body.doorCommands).toBeDefined();
    expect(Array.isArray(body.doorCommands)).toBe(true);

    expect(body.duration).toBeDefined();
    expect(typeof body.duration.minutes).toBe('number');
    expect(body.duration.startedAt).toBeDefined();
  });

  it('GET /api/responder/incidents/:id/logs — returns door commands and audit logs', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incidentId}/logs`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.doorCommands).toBeDefined();
    expect(Array.isArray(body.doorCommands)).toBe(true);

    expect(body.auditLogs).toBeDefined();
    expect(Array.isArray(body.auditLogs)).toBe(true);

    expect(typeof body.total).toBe('number');
  });

  it('GET /api/responder/incidents/:id/exports?format=json — returns JSON export with Content-Disposition', async () => {
    const token = makeCommandToken(); // Has EXPORT_DATA permission

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incidentId}/exports?format=json`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Verify Content-Disposition header for file download
    const contentDisposition = res.headers['content-disposition'] as string;
    expect(contentDisposition).toBeDefined();
    expect(contentDisposition).toContain('attachment');
    expect(contentDisposition).toContain('.json');

    // Verify export payload structure
    expect(body.exportedAt).toBeDefined();
    expect(body.exportedBy).toBeDefined();
    expect(body.exportedBy.responderId).toBe(SGT_SMITH);
    expect(body.exportedBy.agencyId).toBe(AGENCY_CPD);

    expect(body.incident).toBeDefined();
    expect(body.incident.id).toBe(incidentId);

    expect(body.timeline).toBeDefined();
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(body.respondingAgencies).toBeDefined();
    expect(body.doorCommands).toBeDefined();
    expect(body.messages).toBeDefined();
    expect(body.videoBookmarks).toBeDefined();
  });

  it('POST /api/responder/incidents/:id/video-bookmarks — create bookmark', async () => {
    const token = makeCommandToken();
    const now = new Date().toISOString();

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incidentId}/video-bookmarks`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        cameraId: 'cam-main-entrance',
        cameraName: 'Main Entrance Camera',
        bookmarkStart: now,
        label: 'Suspect entering',
        notes: 'Individual in dark clothing entered through main entrance',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.incidentId).toBe(incidentId);
    expect(body.cameraId).toBe('cam-main-entrance');
    expect(body.cameraName).toBe('Main Entrance Camera');
    expect(body.label).toBe('Suspect entering');
    expect(body.notes).toBeDefined();
    expect(body.createdBy).toBe(SGT_SMITH);
  });

  it('GET /api/responder/incidents/:id/video-bookmarks — list bookmarks', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incidentId}/video-bookmarks`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const bookmark = body[0];
    expect(bookmark.id).toBeDefined();
    expect(bookmark.incidentId).toBe(incidentId);
    expect(bookmark.cameraId).toBeDefined();
    expect(bookmark.bookmarkStart).toBeDefined();
  });

  it('should reject export without EXPORT_DATA permission (PATROL token)', async () => {
    const token = makePatrolToken(); // No EXPORT_DATA permission

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incidentId}/exports?format=json`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Forbidden');
    expect(body.missingPermissions).toBeDefined();
    expect(body.missingPermissions).toContain('EXPORT_DATA');
  });
});

// ============================================================================
// 5. Parent Notifications
// ============================================================================
describe('Parent Notifications', () => {
  it('POST /api/v1/incidents/:id/notify-parents — send parent notification', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incidentId}/notify-parents`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        message: 'An emergency incident is in progress at Lincoln Elementary. Students are safe. Updates to follow.',
        channels: ['SMS', 'EMAIL'],
      },
    });

    // 201 if parent contacts exist, 200 if none found (still valid)
    expect([200, 201]).toContain(res.statusCode);
    const body = JSON.parse(res.body);

    expect(typeof body.notificationCount).toBe('number');
    expect(body.channels).toBeDefined();
    expect(Array.isArray(body.channels)).toBe(true);
  });

  it('POST /api/v1/incidents/:id/notify-parents/update — send follow-up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incidentId}/notify-parents/update`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        message: 'The situation is under control. All students accounted for.',
        updateType: 'STATUS_UPDATE',
        channels: ['SMS', 'EMAIL'],
      },
    });

    expect([200, 201]).toContain(res.statusCode);
    const body = JSON.parse(res.body);

    expect(typeof body.notificationCount).toBe('number');
    expect(body.channels).toBeDefined();
    expect(body.updateType).toBe('STATUS_UPDATE');
  });

  it('GET /api/v1/incidents/:id/notifications — list sent notifications', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/incidents/${incidentId}/notifications`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.notifications).toBeDefined();
    expect(Array.isArray(body.notifications)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
  });

  it('should reject parent notification from teacher role (not OPERATOR+)', async () => {
    const teacherToken = await authenticateAs(app, 'teacher1');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incidentId}/notify-parents`,
      headers: { authorization: `Bearer ${teacherToken}` },
      payload: {
        message: 'Should be rejected because teacher does not have OPERATOR role',
      },
    });

    expect(res.statusCode).toBe(403);
  });
});
