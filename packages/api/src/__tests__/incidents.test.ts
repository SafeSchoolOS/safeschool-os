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
const AGENCY_CFD = '00000000-0000-4000-a000-00000000b002';
const AGENCY_EMS = '00000000-0000-4000-a000-00000000b003'; // No school link
const SGT_SMITH = '00000000-0000-4000-a000-00000000c001'; // COMMAND
const OFR_JONES = '00000000-0000-4000-a000-00000000c002'; // PATROL
const GATEWAY_A = '00000000-0000-4000-a000-00000000f301';

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
  // EMS agency exists but has NO schoolAgencyLink to Lincoln Elementary
  return signResponderToken({
    id: '00000000-0000-4000-a000-eeeeeeeeeeee',
    email: 'fake@cranstonems.gov',
    role: 'COMMAND',
    agencyId: AGENCY_EMS,
    permissions: [
      'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'CONTROL_DOORS',
    ],
  });
}

function makeFireDeptToken() {
  // Fire dept is linked with PRE_INCIDENT access level
  return signResponderToken({
    id: '00000000-0000-4000-a000-ffffffffffff',
    email: 'fake@cranstonfd.gov',
    role: 'COMMAND',
    agencyId: AGENCY_CFD,
    permissions: ['VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'CONTROL_DOORS'],
  });
}

// ============================================================================
// Test Suite
// ============================================================================
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestServer();
});

afterAll(async () => {
  await app.close();
});

afterEach(async () => {
  await cleanupTestData(app);

  // Clean up any test-created incidents and related data
  const seedPrefix = '00000000-0000-4000-a000-';
  const nonSeed = { id: { not: { startsWith: seedPrefix } } };

  // Delete in FK order: children first
  await app.prisma.doorCommand.deleteMany({ where: nonSeed });
  await app.prisma.incidentTimeline.deleteMany({ where: nonSeed });
  await app.prisma.incidentAgency.deleteMany({
    where: { incidentId: { not: { startsWith: seedPrefix } } },
  });
  await app.prisma.incident.deleteMany({ where: nonSeed });

  // Restore all doors to UNLOCKED status in case lockdown tests changed them
  await app.prisma.door.updateMany({
    where: { siteId: SITE_ID },
    data: { status: 'UNLOCKED' },
  });

  // Clean up lockdowns created by tests
  await app.prisma.lockdownCommand.deleteMany({ where: nonSeed });

  // Clean up responder audit logs from tests
  await app.prisma.responderAuditLog.deleteMany({ where: nonSeed });
});

// ============================================================================
// Helper: create an incident via the admin API
// ============================================================================
async function createIncident(overrides: {
  type?: string;
  severity?: string;
  notes?: string;
} = {}): Promise<any> {
  const token = await authenticateAs(app, 'admin');
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/incidents',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      siteId: SITE_ID,
      type: overrides.type || 'LOCKDOWN_INCIDENT',
      severity: overrides.severity || 'HIGH_INCIDENT',
      triggerBuildingId: SEED.buildings.mainId,
      triggerFloor: 1,
      triggerRoom: 'Main Office',
      notes: overrides.notes || 'Test incident',
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body);
}

// ============================================================================
// 1. Incident CRUD (School Admin)
// ============================================================================
describe('Incident CRUD (School Admin)', () => {
  it('POST /api/v1/incidents — create incident with timeline entry', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        siteId: SITE_ID,
        type: 'ACTIVE_THREAT',
        severity: 'CRITICAL_INCIDENT',
        triggerBuildingId: SEED.buildings.mainId,
        triggerFloor: 2,
        triggerRoom: 'Room 201',
        notes: 'Suspicious person reported near entrance',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.siteId).toBe(SITE_ID);
    expect(body.type).toBe('ACTIVE_THREAT');
    expect(body.status).toBe('TRIGGERED_INCIDENT');
    expect(body.severity).toBe('CRITICAL_INCIDENT');
    expect(body.triggerBuildingId).toBe(SEED.buildings.mainId);
    expect(body.triggerFloor).toBe(2);
    expect(body.triggerRoom).toBe('Room 201');
    expect(body.notes).toBe('Suspicious person reported near entrance');
    expect(body.triggeredAt).toBeDefined();

    // Timeline entry should be auto-created
    expect(body.timeline).toBeDefined();
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(body.timeline.length).toBeGreaterThanOrEqual(1);
    expect(body.timeline[0].actionType).toBe('PANIC_ACTIVATED');
    expect(body.timeline[0].actorType).toBe('STAFF');
  });

  it('GET /api/v1/incidents — list incidents scoped to user sites', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/incidents',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const found = body.find((i: any) => i.id === incident.id);
    expect(found).toBeDefined();
    expect(found.siteId).toBe(SITE_ID);
    expect(found.respondingAgencies).toBeDefined();
  });

  it('GET /api/v1/incidents/:id — get incident detail', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/incidents/${incident.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.id).toBe(incident.id);
    expect(body.timeline).toBeDefined();
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(body.respondingAgencies).toBeDefined();
    expect(body._count).toBeDefined();
    expect(typeof body._count.messages).toBe('number');
    expect(typeof body._count.doorCommands).toBe('number');
  });

  it('POST /api/v1/incidents/:id/timeline — add manual note', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incident.id}/timeline`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        action: 'Police have been notified via phone call',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.incidentId).toBe(incident.id);
    expect(body.action).toBe('Police have been notified via phone call');
    expect(body.actionType).toBe('NOTE_ADDED');
    expect(body.actorType).toBe('STAFF');
  });

  it('POST /api/v1/incidents/:id/agencies — add responding agency', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incident.id}/agencies`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        agencyId: AGENCY_CPD,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.incidentId).toBe(incident.id);
    expect(body.agencyId).toBe(AGENCY_CPD);
    expect(body.notifiedAt).toBeDefined();
    expect(body.agency).toBeDefined();
    expect(body.agency.name).toBe('Cranston Police Department');
  });

  it('PUT /api/v1/incidents/:id/agencies/:agencyId — update agency timestamps', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    // First add the agency
    await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incident.id}/agencies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { agencyId: AGENCY_CPD },
    });

    const now = new Date().toISOString();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/agencies/${AGENCY_CPD}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        acknowledgedAt: now,
        onSceneAt: now,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.acknowledgedAt).toBeDefined();
    expect(body.onSceneAt).toBeDefined();
    expect(body.agency).toBeDefined();
  });

  it('PUT /api/v1/incidents/:id/status — update status', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        status: 'DISPATCHED_INCIDENT',
        notes: 'Dispatch confirmed',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.status).toBe('DISPATCHED_INCIDENT');
    expect(body.dispatchedAt).toBeDefined();
  });

  it('GET /api/v1/incidents/:id/timeline — full timeline with pagination', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    // Add a few more timeline entries
    await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incident.id}/timeline`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'Note one' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incident.id}/timeline`,
      headers: { authorization: `Bearer ${token}` },
      payload: { action: 'Note two' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/incidents/${incident.id}/timeline?limit=10&offset=0`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Should be an array of timeline entries (initial + 2 manual notes)
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(3);

    // Verify ordering is desc by timestamp
    for (let i = 1; i < body.length; i++) {
      const prev = new Date(body[i - 1].timestamp).getTime();
      const curr = new Date(body[i].timestamp).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('should return 404 for non-existent incident', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/incidents/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Incident not found');
  });
});

// ============================================================================
// 2. Responder Incident Access
// ============================================================================
describe('Responder Incident Access', () => {
  it('GET /api/responder/incidents — list active incidents (COMMAND)', async () => {
    await createIncident();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: '/api/responder/incidents',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    // Active incidents should not include RESOLVED or FALSE_ALARM by default
    for (const incident of body) {
      expect(incident.status).not.toBe('RESOLVED_INCIDENT');
      expect(incident.status).not.toBe('FALSE_ALARM');
      expect(incident.respondingAgencies).toBeDefined();
      expect(incident.site).toBeDefined();
    }
  });

  it('GET /api/responder/incidents/:id — incident detail', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incident.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.id).toBe(incident.id);
    expect(body.timeline).toBeDefined();
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(body.respondingAgencies).toBeDefined();
    expect(body.site).toBeDefined();
    expect(body.site.name).toBeDefined();
    expect(body.site.address).toBeDefined();
  });

  it('GET /api/responder/incidents/:id/timeline — timeline with pagination', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incident.id}/timeline?limit=50&offset=0`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.timeline).toBeDefined();
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it('POST /api/responder/incidents/:id/timeline — add note as responder', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/timeline`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        action: 'Units en route, ETA 3 minutes',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.incidentId).toBe(incident.id);
    expect(body.actionType).toBe('NOTE_ADDED');
    expect(body.actorType).toBe('RESPONDER');
    expect(body.actorId).toBe(SGT_SMITH);
  });

  it('GET /api/responder/incidents/:id/doors — door list during incident', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incident.id}/doors`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    for (const door of body) {
      expect(door.id).toBeDefined();
      expect(door.name).toBeDefined();
      expect(door.siteId).toBe(SITE_ID);
    }
  });

  it('GET /api/responder/incidents/:id/visitors — visitor list', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incident.id}/visitors`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    // May be empty if no active visitors — that's fine
  });

  it('GET /api/responder/incidents/:id/accountability — placeholder', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incident.id}/accountability`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.classrooms).toBeDefined();
    expect(Array.isArray(body.classrooms)).toBe(true);
    expect(typeof body.totalStudents).toBe('number');
    expect(typeof body.accountedFor).toBe('number');
    expect(typeof body.missing).toBe('number');
  });
});

// ============================================================================
// 3. Responder Door Control
// ============================================================================
describe('Responder Door Control', () => {
  it('POST /api/responder/incidents/:id/doors/:doorId/lock — lock a door (COMMAND)', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();

    const doorId = SEED.doors.mainEntrance;

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/doors/${doorId}/lock`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.id).toBe(doorId);
    expect(body.status).toBe('LOCKED');

    // Verify DoorCommand was created
    const commands = await app.prisma.doorCommand.findMany({
      where: { doorId, incidentId: incident.id, command: 'LOCK' },
    });
    expect(commands.length).toBeGreaterThanOrEqual(1);
    expect(commands[0].issuedByType).toBe('RESPONDER');
    expect(commands[0].issuedBy).toBe(SGT_SMITH);

    // Verify timeline entry was added
    const timeline = await app.prisma.incidentTimeline.findMany({
      where: { incidentId: incident.id, actionType: 'DOOR_LOCKED' },
    });
    expect(timeline.length).toBeGreaterThanOrEqual(1);
    expect(timeline[0].actorType).toBe('RESPONDER');
  });

  it('POST /api/responder/incidents/:id/doors/:doorId/unlock — unlock a door', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();
    const doorId = SEED.doors.mainEntrance;

    // Lock the door first
    await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/doors/${doorId}/lock`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Then unlock it
    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/doors/${doorId}/unlock`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.id).toBe(doorId);
    expect(body.status).toBe('UNLOCKED');

    // Verify DoorCommand for UNLOCK was created
    const commands = await app.prisma.doorCommand.findMany({
      where: { doorId, incidentId: incident.id, command: 'UNLOCK' },
    });
    expect(commands.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject door control without CONTROL_DOORS permission (PATROL)', async () => {
    const incident = await createIncident();
    const token = makePatrolToken(); // No CONTROL_DOORS permission
    const doorId = SEED.doors.mainEntrance;

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/doors/${doorId}/lock`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });

  it('should reject door control for PRE_INCIDENT access level (fire dept)', async () => {
    const incident = await createIncident();
    const token = makeFireDeptToken(); // CFD has PRE_INCIDENT access
    const doorId = SEED.doors.mainEntrance;

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/doors/${doorId}/lock`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('FULL_RESPONSE access level required');
  });
});

// ============================================================================
// 4. Responder Lockdown
// ============================================================================
describe('Responder Lockdown', () => {
  it('POST /api/responder/incidents/:id/lockdown — campus lockdown (COMMAND)', async () => {
    const incident = await createIncident({ type: 'ACTIVE_THREAT', severity: 'CRITICAL_INCIDENT' });
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/lockdown`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.siteId).toBe(SITE_ID);
    expect(body.scope).toBe('FULL_SITE');
    expect(body.doorsLocked).toBeGreaterThanOrEqual(1);
    expect(body.initiatedById).toBe(SGT_SMITH);

    // Verify LockdownCommand was created in DB
    const lockdown = await app.prisma.lockdownCommand.findUnique({
      where: { id: body.id },
    });
    expect(lockdown).not.toBeNull();
    expect(lockdown!.releasedAt).toBeNull();

    // Verify all non-emergency doors are locked
    const unlockedNonEmergencyDoors = await app.prisma.door.count({
      where: { siteId: SITE_ID, isEmergencyExit: false, status: { not: 'LOCKED' } },
    });
    expect(unlockedNonEmergencyDoors).toBe(0);

    // Verify timeline entry was created
    const timeline = await app.prisma.incidentTimeline.findMany({
      where: { incidentId: incident.id, actionType: 'LOCKDOWN_INITIATED' },
    });
    expect(timeline.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/responder/incidents/:id/lockdown/release — release lockdown', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();

    // First initiate lockdown
    await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/lockdown`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Then release it
    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/lockdown/release`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.releasedAt).toBeDefined();
    expect(body.doorsUnlocked).toBeGreaterThanOrEqual(1);

    // Verify doors are unlocked
    const lockedDoors = await app.prisma.door.count({
      where: { siteId: SITE_ID, status: 'LOCKED' },
    });
    expect(lockedDoors).toBe(0);

    // Verify lockdown record has releasedAt set
    const lockdown = await app.prisma.lockdownCommand.findUnique({
      where: { id: body.id },
    });
    expect(lockdown).not.toBeNull();
    expect(lockdown!.releasedAt).not.toBeNull();

    // Verify timeline entry
    const timeline = await app.prisma.incidentTimeline.findMany({
      where: { incidentId: incident.id, actionType: 'ALL_CLEAR_ACTION' },
    });
    expect(timeline.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject lockdown from PATROL role (not COMMAND)', async () => {
    const incident = await createIncident();
    const token = makePatrolToken(); // PATROL role, no CONTROL_DOORS

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/lockdown`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });

  it('should return 404 when releasing lockdown with no active lockdown', async () => {
    const incident = await createIncident();
    const token = makeCommandToken();

    // Try to release lockdown without initiating one first
    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/lockdown/release`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No active lockdown found for this site');
  });
});

// ============================================================================
// 5. Data Scoping
// ============================================================================
describe('Data Scoping', () => {
  it('unlinked agency (EMS) cannot see incidents — returns 403', async () => {
    const incident = await createIncident();
    const token = makeUnlinkedToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents/${incident.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No access to this incident');
  });

  it('unlinked agency cannot list incidents for inaccessible site', async () => {
    await createIncident();
    const token = makeUnlinkedToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/incidents?siteId=${SITE_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No active access to this school');
  });

  it('unlinked agency cannot control doors during incident', async () => {
    const incident = await createIncident();
    const token = makeUnlinkedToken();
    const doorId = SEED.doors.mainEntrance;

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/doors/${doorId}/lock`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No active access to this incident');
  });

  it('PRE_INCIDENT agency cannot control doors during incident', async () => {
    const incident = await createIncident();
    const token = makeFireDeptToken(); // CFD = PRE_INCIDENT

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/doors/${SEED.doors.mainEntrance}/lock`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('FULL_RESPONSE access level required');
  });

  it('PRE_INCIDENT agency cannot initiate lockdown', async () => {
    const incident = await createIncident();
    const token = makeFireDeptToken();

    const res = await app.inject({
      method: 'POST',
      url: `/api/responder/incidents/${incident.id}/lockdown`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('FULL_RESPONSE access level required');
  });
});

// ============================================================================
// 6. Status Transitions
// ============================================================================
describe('Status Transitions', () => {
  it('valid: TRIGGERED → DISPATCHED → RESPONDING → ON_SCENE → ALL_CLEAR → RESOLVED', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    const transitions = [
      'DISPATCHED_INCIDENT',
      'RESPONDING_INCIDENT',
      'ON_SCENE_INCIDENT',
      'ALL_CLEAR_INCIDENT',
      'RESOLVED_INCIDENT',
    ];

    let currentStatus = 'TRIGGERED_INCIDENT';

    for (const nextStatus of transitions) {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/incidents/${incident.id}/status`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: nextStatus },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe(nextStatus);
      currentStatus = nextStatus;
    }

    // Verify final state
    const finalRes = await app.inject({
      method: 'GET',
      url: `/api/v1/incidents/${incident.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const final = JSON.parse(finalRes.body);
    expect(final.status).toBe('RESOLVED_INCIDENT');
    expect(final.resolvedAt).toBeDefined();
    expect(final.dispatchedAt).toBeDefined();
    expect(final.firstResponderArrival).toBeDefined();
    expect(final.allClearAt).toBeDefined();
  });

  it('invalid: cannot update status after RESOLVED_INCIDENT', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    // Move to RESOLVED
    await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'DISPATCHED_INCIDENT' },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'RESOLVED_INCIDENT' },
    });

    // Try to change status after resolution
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'TRIGGERED_INCIDENT' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Cannot change status of a resolved or false-alarm incident');
  });

  it('invalid: cannot update status after FALSE_ALARM', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    // Move to FALSE_ALARM
    await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'FALSE_ALARM' },
    });

    // Try to change status after false alarm
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'DISPATCHED_INCIDENT' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Cannot change status of a resolved or false-alarm incident');
  });

  it('should reject invalid status value', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'NONEXISTENT_STATUS' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Invalid status');
  });

  it('status update creates timeline entry', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'DISPATCHED_INCIDENT', notes: 'Dispatcher confirmed' },
    });

    // Check timeline for STATUS_CHANGE entry
    const timeline = await app.prisma.incidentTimeline.findMany({
      where: { incidentId: incident.id, actionType: 'STATUS_CHANGE' },
    });

    expect(timeline.length).toBeGreaterThanOrEqual(1);
    const entry = timeline[0];
    expect(entry.action).toContain('TRIGGERED_INCIDENT');
    expect(entry.action).toContain('DISPATCHED_INCIDENT');
    expect(entry.metadata).toBeDefined();
    const meta = entry.metadata as any;
    expect(meta.previousStatus).toBe('TRIGGERED_INCIDENT');
    expect(meta.newStatus).toBe('DISPATCHED_INCIDENT');
  });

  it('DISPATCHED status sets dispatchedAt timestamp', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    const beforeTime = new Date();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'DISPATCHED_INCIDENT' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dispatchedAt).toBeDefined();
    expect(new Date(body.dispatchedAt).getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 1000);
  });

  it('ON_SCENE status sets firstResponderArrival timestamp', async () => {
    const incident = await createIncident();
    const token = await authenticateAs(app, 'admin');

    await app.inject({
      method: 'PUT',
      url: `/api/v1/incidents/${incident.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'ON_SCENE_INCIDENT' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/incidents/${incident.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(res.body);
    expect(body.firstResponderArrival).toBeDefined();
  });
});
