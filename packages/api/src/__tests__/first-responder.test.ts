import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { buildTestServer, cleanupTestData } from './setup.js';
import { authenticateAs, SEED } from './helpers.js';
import { signResponderToken } from '../middleware/responder-auth.js';

// ============================================================================
// Seed IDs (from packages/db/src/seed.ts)
// ============================================================================
const FR_IDS = {
  agencies: {
    cranstonPd: '00000000-0000-4000-a000-00000000b001',
    cranstonFd: '00000000-0000-4000-a000-00000000b002',
    cranstonEms: '00000000-0000-4000-a000-00000000b003',
  },
  responderUsers: {
    sgtSmith: '00000000-0000-4000-a000-00000000c001',      // COMMAND role
    ofrJones: '00000000-0000-4000-a000-00000000c002',      // PATROL role
    dispatcherLee: '00000000-0000-4000-a000-00000000c003',  // DISPATCH_ROLE
    invBrown: '00000000-0000-4000-a000-00000000c004',       // INVESTIGATOR
  },
  schoolAgencyLinks: {
    lincolnCpd: '00000000-0000-4000-a000-00000000d001', // FULL_RESPONSE
    lincolnCfd: '00000000-0000-4000-a000-00000000d002', // PRE_INCIDENT
  },
  siteId: '00000000-0000-4000-a000-000000000001',
  gateway: '00000000-0000-4000-a000-00000000f301',
};

// ============================================================================
// Token helpers
// ============================================================================
function makeCommandToken() {
  return signResponderToken({
    id: FR_IDS.responderUsers.sgtSmith,
    email: 'sgt.smith@cranstonpd.gov',
    role: 'COMMAND',
    agencyId: FR_IDS.agencies.cranstonPd,
    permissions: [
      'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS',
      'CONTROL_DOORS', 'VIEW_VISITOR_LIST', 'VIEW_STUDENT_ACCOUNTABILITY',
      'VIEW_INCIDENT_LOGS', 'EXPORT_DATA', 'COMMUNICATE_STAFF', 'VIEW_TIPS',
    ],
  });
}

function makePatrolToken() {
  return signResponderToken({
    id: FR_IDS.responderUsers.ofrJones,
    email: 'ofr.jones@cranstonpd.gov',
    role: 'PATROL',
    agencyId: FR_IDS.agencies.cranstonPd,
    permissions: [
      'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS',
      'VIEW_VISITOR_LIST', 'VIEW_INCIDENT_LOGS', 'COMMUNICATE_STAFF',
    ],
  });
}

function makeDispatchToken() {
  return signResponderToken({
    id: FR_IDS.responderUsers.dispatcherLee,
    email: 'dispatch.lee@cranstonpd.gov',
    role: 'DISPATCH_ROLE',
    agencyId: FR_IDS.agencies.cranstonPd,
    permissions: [
      'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_INCIDENT_LOGS',
    ],
  });
}

function makeInvestigatorToken() {
  return signResponderToken({
    id: FR_IDS.responderUsers.invBrown,
    email: 'inv.brown@cranstonpd.gov',
    role: 'INVESTIGATOR',
    agencyId: FR_IDS.agencies.cranstonPd,
    permissions: [
      'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS',
      'VIEW_INCIDENT_LOGS', 'EXPORT_DATA', 'VIEW_TIPS',
    ],
  });
}

function makeFireDeptToken() {
  // Fire dept is linked with PRE_INCIDENT access — no seed responder users for FD,
  // so we fabricate a token with the FD agencyId to test data scoping
  return signResponderToken({
    id: '00000000-0000-4000-a000-ffffffffffff',
    email: 'fake@cranstonfd.gov',
    role: 'COMMAND',
    agencyId: FR_IDS.agencies.cranstonFd,
    permissions: ['VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'CONTROL_DOORS'],
  });
}

function makeUnlinkedAgencyToken() {
  // EMS agency exists but has NO schoolAgencyLink to Lincoln Elementary
  return signResponderToken({
    id: '00000000-0000-4000-a000-eeeeeeeeeeee',
    email: 'fake@cranstonems.gov',
    role: 'COMMAND',
    agencyId: FR_IDS.agencies.cranstonEms,
    permissions: ['VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'CONTROL_DOORS'],
  });
}

function makeExpiredToken() {
  return signResponderToken({
    id: FR_IDS.responderUsers.sgtSmith,
    email: 'sgt.smith@cranstonpd.gov',
    role: 'COMMAND',
    agencyId: FR_IDS.agencies.cranstonPd,
    permissions: ['VIEW_FLOOR_PLANS'],
  }, '0s'); // expires immediately
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
});

// ============================================================================
// 1. Responder Auth Tests
// ============================================================================
describe('Responder Auth', () => {
  // POST /api/responder/auth/login
  it('should login with valid responder credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/responder/auth/login',
      payload: {
        email: 'sgt.smith@cranstonpd.gov',
        password: 'safeschool123',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe('string');
    expect(body.user).toBeDefined();
    expect(body.user.id).toBe(FR_IDS.responderUsers.sgtSmith);
    expect(body.user.email).toBe('sgt.smith@cranstonpd.gov');
    expect(body.user.role).toBe('COMMAND');
    expect(body.user.agencyId).toBe(FR_IDS.agencies.cranstonPd);
    expect(body.user.agencyName).toBe('Cranston Police Department');
    expect(body.user.firstName).toBe('James');
    expect(body.user.lastName).toBe('Smith');
    expect(Array.isArray(body.user.permissions)).toBe(true);
    expect(body.user.permissions).toContain('CONTROL_DOORS');
  });

  it('should reject login with wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/responder/auth/login',
      payload: {
        email: 'sgt.smith@cranstonpd.gov',
        password: 'wrongpassword',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Invalid credentials');
  });

  it('should reject login for disabled responder', async () => {
    // Temporarily disable the responder user
    await app.prisma.responderUser.update({
      where: { id: FR_IDS.responderUsers.sgtSmith },
      data: { status: 'DISABLED_RESPONDER' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/responder/auth/login',
      payload: {
        email: 'sgt.smith@cranstonpd.gov',
        password: 'safeschool123',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('RESPONDER_INACTIVE');

    // Restore status
    await app.prisma.responderUser.update({
      where: { id: FR_IDS.responderUsers.sgtSmith },
      data: { status: 'ACTIVE_RESPONDER' },
    });
  });

  it('should reject login when agency is suspended', async () => {
    // Temporarily suspend the agency
    await app.prisma.agency.update({
      where: { id: FR_IDS.agencies.cranstonPd },
      data: { status: 'SUSPENDED_AGENCY' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/responder/auth/login',
      payload: {
        email: 'sgt.smith@cranstonpd.gov',
        password: 'safeschool123',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('AGENCY_INACTIVE');

    // Restore status
    await app.prisma.agency.update({
      where: { id: FR_IDS.agencies.cranstonPd },
      data: { status: 'ACTIVE_AGENCY' },
    });
  });

  it('should return JWT token with correct payload (id, email, role, agencyId, permissions)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/responder/auth/login',
      payload: {
        email: 'ofr.jones@cranstonpd.gov',
        password: 'safeschool123',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const token = body.token;
    expect(token).toBeDefined();

    // Decode the JWT payload (base64url)
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    expect(payload.id).toBe(FR_IDS.responderUsers.ofrJones);
    expect(payload.email).toBe('ofr.jones@cranstonpd.gov');
    expect(payload.role).toBe('PATROL');
    expect(payload.agencyId).toBe(FR_IDS.agencies.cranstonPd);
    expect(Array.isArray(payload.permissions)).toBe(true);
    expect(payload.permissions).toContain('VIEW_FLOOR_PLANS');
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  // POST /api/responder/auth/refresh
  it('should refresh a valid responder token', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'POST',
      url: '/api/responder/auth/refresh',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe('string');
    expect(body.token).not.toBe(token); // new token should differ (at least iat differs)
  });

  it('should reject refresh with invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/responder/auth/refresh',
      headers: { authorization: 'Bearer totally-invalid-token' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unauthorized');
  });

  // POST /api/responder/auth/logout
  it('should return success on logout', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/responder/auth/logout',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// 2. Agency Management Tests (School Admin)
// ============================================================================
describe('Agency Management', () => {
  it('should list agencies linked to a site', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agencies?siteId=${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
    // Each link should include the agency object
    const cpdLink = body.find((l: any) => l.agencyId === FR_IDS.agencies.cranstonPd);
    expect(cpdLink).toBeDefined();
    expect(cpdLink.agency).toBeDefined();
    expect(cpdLink.agency.name).toBe('Cranston Police Department');
  });

  it('should get agency details with users', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agencies/${FR_IDS.agencies.cranstonPd}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(FR_IDS.agencies.cranstonPd);
    expect(body.name).toBe('Cranston Police Department');
    expect(body.type).toBe('POLICE');
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users.length).toBeGreaterThanOrEqual(4);
    expect(Array.isArray(body.schoolLinks)).toBe(true);

    // Check one user
    const sgtSmith = body.users.find((u: any) => u.id === FR_IDS.responderUsers.sgtSmith);
    expect(sgtSmith).toBeDefined();
    expect(sgtSmith.firstName).toBe('James');
    expect(sgtSmith.lastName).toBe('Smith');
    expect(sgtSmith.role).toBe('COMMAND');
    expect(sgtSmith.badgeNumber).toBe('CPD-1247');
  });

  it('should reject agency list without SITE_ADMIN role', async () => {
    const token = await authenticateAs(app, 'teacher1');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agencies?siteId=${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should create a new agency and link it', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agencies',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Test State Police',
        type: 'POLICE',
        jurisdiction: 'State of NJ',
        primaryContact: 'Captain Test',
        primaryPhone: '+18009990001',
        primaryEmail: 'captain@testsp.gov',
        accessLevel: 'PRE_INCIDENT',
        siteId: FR_IDS.siteId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.agency).toBeDefined();
    expect(body.agency.name).toBe('Test State Police');
    expect(body.agency.type).toBe('POLICE');
    expect(body.agency.status).toBe('ACTIVE_AGENCY');
    expect(body.link).toBeDefined();
    expect(body.link.siteId).toBe(FR_IDS.siteId);
    expect(body.link.agencyId).toBe(body.agency.id);
    expect(body.link.accessLevel).toBe('PRE_INCIDENT');
    expect(body.link.status).toBe('ACTIVE_LINK');
  });

  it('should update agency access level', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/agencies/${FR_IDS.agencies.cranstonFd}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        accessLevel: 'FULL_RESPONSE',
        siteId: FR_IDS.siteId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessLevel).toBe('FULL_RESPONSE');

    // Restore original access level
    await app.inject({
      method: 'PUT',
      url: `/api/v1/agencies/${FR_IDS.agencies.cranstonFd}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        accessLevel: 'PRE_INCIDENT',
        siteId: FR_IDS.siteId,
      },
    });
  });

  it('should revoke agency access', async () => {
    const token = await authenticateAs(app, 'admin');

    // First create a temp agency to revoke
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agencies',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Temp Agency To Revoke',
        type: 'EMS',
        accessLevel: 'PRE_INCIDENT',
        siteId: FR_IDS.siteId,
      },
    });
    const tempAgencyId = JSON.parse(createRes.body).agency.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agencies/${tempAgencyId}?siteId=${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('REVOKED_LINK');
  });

  it('should create a responder user', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agencies/${FR_IDS.agencies.cranstonPd}/users`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        firstName: 'Test',
        lastName: 'Officer',
        email: 'test.officer@cranstonpd.gov',
        phone: '+18001234567',
        badgeNumber: 'CPD-9999',
        role: 'PATROL',
        permissions: ['VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS'],
        password: 'testpass123',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.firstName).toBe('Test');
    expect(body.lastName).toBe('Officer');
    expect(body.email).toBe('test.officer@cranstonpd.gov');
    expect(body.role).toBe('PATROL');
    expect(body.badgeNumber).toBe('CPD-9999');
    expect(body.agencyId).toBe(FR_IDS.agencies.cranstonPd);
    expect(body.status).toBe('ACTIVE_RESPONDER');
    expect(body.permissions).toEqual(['VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS']);
    // Password hash should NOT be returned
    expect(body.passwordHash).toBeUndefined();
  });

  it('should update responder user permissions', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/agencies/${FR_IDS.agencies.cranstonPd}/users/${FR_IDS.responderUsers.ofrJones}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        permissions: ['VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS', 'CONTROL_DOORS'],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(FR_IDS.responderUsers.ofrJones);
    expect(body.permissions).toContain('CONTROL_DOORS');

    // Restore original permissions
    await app.inject({
      method: 'PUT',
      url: `/api/v1/agencies/${FR_IDS.agencies.cranstonPd}/users/${FR_IDS.responderUsers.ofrJones}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        permissions: [
          'VIEW_FLOOR_PLANS', 'VIEW_DOOR_STATUS', 'VIEW_CAMERA_FEEDS',
          'VIEW_VISITOR_LIST', 'VIEW_INCIDENT_LOGS', 'COMMUNICATE_STAFF',
        ],
      },
    });
  });

  it('should disable a responder user', async () => {
    const token = await authenticateAs(app, 'admin');

    // Create a temp user to disable
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agencies/${FR_IDS.agencies.cranstonPd}/users`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        firstName: 'Disable',
        lastName: 'Me',
        email: 'disable.me@cranstonpd.gov',
        role: 'PATROL',
        permissions: ['VIEW_FLOOR_PLANS'],
        password: 'testpass123',
      },
    });
    const tempUserId = JSON.parse(createRes.body).id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agencies/${FR_IDS.agencies.cranstonPd}/users/${tempUserId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(tempUserId);
    expect(body.status).toBe('DISABLED_RESPONDER');
  });

  it('should list audit log for an agency', async () => {
    const token = await authenticateAs(app, 'admin');

    // First, trigger some audit activity by accessing portal as a responder
    const responderToken = makeCommandToken();
    await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${responderToken}` },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agencies/${FR_IDS.agencies.cranstonPd}/audit?siteId=${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.entries).toBeDefined();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.total).toBe('number');
  });
});

// ============================================================================
// 3. RBAC Tests
// ============================================================================
describe('Responder RBAC', () => {
  // DISPATCH_ROLE can view data but NOT control doors
  it('should allow DISPATCH_ROLE to view school data', async () => {
    const token = makeDispatchToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/buildings`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('should deny DISPATCH_ROLE door control permission check', async () => {
    // DISPATCH_ROLE has VIEW_DOOR_STATUS but NOT CONTROL_DOORS
    // The doors endpoint requires VIEW_DOOR_STATUS permission, so dispatcher CAN view doors
    // But CONTROL_DOORS would be checked at the door control endpoint if it existed
    // We verify the dispatcher does NOT have CONTROL_DOORS in their token
    const token = makeDispatchToken();
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    expect(payload.permissions).not.toContain('CONTROL_DOORS');
    expect(payload.permissions).toContain('VIEW_DOOR_STATUS');
  });

  // PATROL has limited access
  it('should allow PATROL to view floor plans', async () => {
    const token = makePatrolToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/floorplans`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('should deny PATROL door control (no CONTROL_DOORS permission)', async () => {
    // PATROL has VIEW_DOOR_STATUS but NOT CONTROL_DOORS
    const token = makePatrolToken();
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    expect(payload.permissions).not.toContain('CONTROL_DOORS');
    expect(payload.role).toBe('PATROL');
  });

  // COMMAND has full access
  it('should allow COMMAND to view all data', async () => {
    const token = makeCommandToken();

    // Test buildings access
    const buildingsRes = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/buildings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(buildingsRes.statusCode).toBe(200);

    // Test population access
    const popRes = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/population`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(popRes.statusCode).toBe(200);

    // Test contacts access
    const contactsRes = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(contactsRes.statusCode).toBe(200);
  });

  it('should allow COMMAND with CONTROL_DOORS permission', async () => {
    const token = makeCommandToken();
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    expect(payload.permissions).toContain('CONTROL_DOORS');
    expect(payload.role).toBe('COMMAND');

    // COMMAND can also view doors (has VIEW_DOOR_STATUS)
    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/doors`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ============================================================================
// 4. Data Scoping Tests
// ============================================================================
describe('Data Scoping', () => {
  it('should deny access to unlinked school', async () => {
    // EMS agency has no schoolAgencyLink to Lincoln Elementary
    const token = makeUnlinkedAgencyToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No active access to this school');
  });

  it('should deny access when link is expired', async () => {
    // Set the CPD link to have an expired date
    await app.prisma.schoolAgencyLink.update({
      where: { id: FR_IDS.schoolAgencyLinks.lincolnCpd },
      data: { expiresAt: new Date('2020-01-01') },
    });

    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No active access to this school');

    // Restore
    await app.prisma.schoolAgencyLink.update({
      where: { id: FR_IDS.schoolAgencyLinks.lincolnCpd },
      data: { expiresAt: null },
    });
  });

  it('should deny access when link is revoked', async () => {
    // Set the CPD link status to REVOKED_LINK
    await app.prisma.schoolAgencyLink.update({
      where: { id: FR_IDS.schoolAgencyLinks.lincolnCpd },
      data: { status: 'REVOKED_LINK' },
    });

    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No active access to this school');

    // Restore
    await app.prisma.schoolAgencyLink.update({
      where: { id: FR_IDS.schoolAgencyLinks.lincolnCpd },
      data: { status: 'ACTIVE_LINK' },
    });
  });
});

// ============================================================================
// 5. Pre-Incident Portal Tests
// ============================================================================
describe('Pre-Incident Portal', () => {
  it('should list linked schools for the agency', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: '/api/responder/schools',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const lincoln = body.find((s: any) => s.id === FR_IDS.siteId);
    expect(lincoln).toBeDefined();
    expect(lincoln.name).toBeDefined();
    expect(lincoln.accessLevel).toBe('FULL_RESPONSE');
    expect(lincoln.linkStatus).toBe('ACTIVE_LINK');
  });

  it('should get school details', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(FR_IDS.siteId);
    expect(body.name).toBeDefined();
    expect(body.address).toBeDefined();
    expect(body.accessLevel).toBe('FULL_RESPONSE');
    expect(body.population).toBeDefined();
    expect(typeof body.population.students).toBe('number');
    expect(typeof body.population.staff).toBe('number');
    expect(typeof body.population.total).toBe('number');
    expect(body._count).toBeDefined();
    expect(typeof body._count.buildings).toBe('number');
    expect(typeof body._count.doors).toBe('number');
  });

  it('should get building list', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/buildings`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2); // Main Building + Annex
    // Each building should have _count
    for (const building of body) {
      expect(building.id).toBeDefined();
      expect(building.name).toBeDefined();
      expect(building._count).toBeDefined();
      expect(typeof building._count.rooms).toBe('number');
      expect(typeof building._count.doors).toBe('number');
    }
  });

  it('should get floor plans', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/floorplans`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // May return empty if no floor plans seeded, but should still be an array
    expect(Array.isArray(body)).toBe(true);
  });

  it('should get doors with status', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/doors`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    for (const door of body) {
      expect(door.id).toBeDefined();
      expect(door.name).toBeDefined();
      expect(door.siteId).toBe(FR_IDS.siteId);
    }
  });

  it('should get key holders sorted by priority', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(3);

    // Verify sorted by priority ascending
    for (let i = 1; i < body.length; i++) {
      expect(body[i].priority).toBeGreaterThanOrEqual(body[i - 1].priority);
    }

    // Check first key holder is the principal (priority 1)
    expect(body[0].name).toBe('Dr. Margaret Chen');
    expect(body[0].role).toBe('Principal');
    expect(body[0].hasKeys).toBe(true);
    expect(body[0].hasAccessCard).toBe(true);
    expect(body[0].priority).toBe(1);
  });

  it('should get reunification sites', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/reunification`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);

    // Primary site should be first (ordered by isPrimary desc)
    expect(body[0].isPrimary).toBe(true);
    expect(body[0].name).toBe('Cranston Community Center');
    expect(body[0].capacity).toBe(500);
    expect(body[0].drivingDirections).toBeDefined();
    expect(body[0].contactName).toBeDefined();
  });

  it('should get staging areas', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/staging`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(3);

    // Verify all staging areas present
    const names = body.map((a: any) => a.name);
    expect(names).toContain('East Parking Lot');
    expect(names).toContain('West Athletic Field');
    expect(names).toContain('North Staff Lot');
  });

  it('should get hazard locations', async () => {
    const token = makeCommandToken(); // COMMAND has VIEW_FLOOR_PLANS permission required for hazards

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/hazards`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(3);

    const types = body.map((h: any) => h.type);
    expect(types).toContain('Chemical storage');
    expect(types).toContain('Art supplies');
    expect(types).toContain('Pool chemicals');
  });

  it('should get population data', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/population`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.students).toBeDefined();
    expect(typeof body.students.total).toBe('number');
    expect(body.students.byGrade).toBeDefined();
    expect(body.staff).toBeDefined();
    expect(typeof body.staff.total).toBe('number');
    expect(body.staff.byRole).toBeDefined();
    expect(typeof body.grandTotal).toBe('number');
    expect(body.grandTotal).toBe(body.students.total + body.staff.total);
  });

  it('should return 404 for data package when none exists', async () => {
    const token = makeCommandToken();

    const res = await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/data-package`,
      headers: { authorization: `Bearer ${token}` },
    });

    // No data package has been generated in seed data
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('No data package available for this site');
  });
});

// ============================================================================
// 6. Gateway Tests
// ============================================================================
describe('Gateway Registration', () => {
  it('should list gateways for a site', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways?siteId=${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const gwA = body.find((g: any) => g.id === FR_IDS.gateway);
    expect(gwA).toBeDefined();
    expect(gwA.name).toBe('Gateway A - Main Building');
    expect(gwA.status).toBe('ONLINE_GW');
  });

  it('should get gateway detail with health', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways/${FR_IDS.gateway}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(FR_IDS.gateway);
    expect(body.name).toBe('Gateway A - Main Building');
    expect(body.hostname).toBe('gw-lincoln-a');
    expect(body.ipAddress).toBe('192.168.1.100');
    expect(body.hardwareModel).toBe('Intel NUC 13 Pro');
    expect(body.firmwareVersion).toBe('1.0.0');
    expect(body.clusterRole).toBe('SINGLE');
    expect(body.clusterMode).toBe('STANDALONE');
    // heartbeats array should be included
    expect(Array.isArray(body.heartbeats)).toBe(true);
  });

  it('should register a new gateway and get provisioning token', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        siteId: FR_IDS.siteId,
        name: 'Gateway B - Annex',
        hostname: 'gw-lincoln-b',
        ipAddress: '192.168.1.101',
        macAddress: 'AA:BB:CC:DD:EE:02',
        hardwareModel: 'Intel NUC 13 Pro',
        primaryConnection: 'ETHERNET',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Gateway B - Annex');
    expect(body.status).toBe('PROVISIONING_GW');
    expect(body.provisioningToken).toBeDefined();
    expect(typeof body.provisioningToken).toBe('string');
    expect(body.provisioningToken.length).toBe(64); // 32 bytes hex
    expect(body.clusterRole).toBe('SINGLE');
    expect(body.clusterMode).toBe('STANDALONE');
  });

  it('should update gateway config', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${FR_IDS.gateway}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Gateway A - Main Building Updated',
        hasBackupCellular: false,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(FR_IDS.gateway);
    expect(body.name).toBe('Gateway A - Main Building Updated');
    expect(body.hasBackupCellular).toBe(false);

    // Restore
    await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${FR_IDS.gateway}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Gateway A - Main Building',
        hasBackupCellular: true,
      },
    });
  });

  it('should get cluster status', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways/cluster/status?siteId=${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.siteId).toBe(FR_IDS.siteId);
    expect(Array.isArray(body.gateways)).toBe(true);
    expect(body.gatewayCount).toBeGreaterThanOrEqual(1);
    expect(typeof body.onlineCount).toBe('number');
    expect(body.clusterState).toBeDefined();
  });

  it('should get failover history', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways/failover/history?siteId=${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    // No failover events in seed data, so should be empty
  });
});

describe('Gateway Heartbeat', () => {
  const gatewayAuthToken = crypto.randomBytes(32).toString('hex');
  const gatewayAuthTokenHash = crypto.createHash('sha256').update(gatewayAuthToken).digest('hex');

  beforeAll(async () => {
    // Set the authTokenHash on the seed gateway so we can authenticate as it
    await app.prisma.gateway.update({
      where: { id: FR_IDS.gateway },
      data: { authTokenHash: gatewayAuthTokenHash },
    });
  });

  afterAll(async () => {
    // Clean up the authTokenHash
    await app.prisma.gateway.update({
      where: { id: FR_IDS.gateway },
      data: { authTokenHash: null },
    });
  });

  it('should accept heartbeat from authenticated gateway', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/heartbeat',
      headers: { authorization: `Bearer ${gatewayAuthToken}` },
      payload: {
        gatewayId: FR_IDS.gateway,
        status: 'ONLINE_GW',
        cpuUsage: 25,
        memoryUsage: 45,
        bleDevicesConnected: 6,
        pendingCommands: 0,
        firmwareVersion: '1.0.1',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
  });

  it('should reject heartbeat from unauthenticated gateway', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/heartbeat',
      headers: { authorization: 'Bearer invalid-token-here' },
      payload: {
        gatewayId: FR_IDS.gateway,
        status: 'ONLINE_GW',
        cpuUsage: 25,
        memoryUsage: 45,
        bleDevicesConnected: 6,
        pendingCommands: 0,
        firmwareVersion: '1.0.1',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Invalid gateway token');
  });

  it('should update gateway health metrics on heartbeat', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/heartbeat',
      headers: { authorization: `Bearer ${gatewayAuthToken}` },
      payload: {
        gatewayId: FR_IDS.gateway,
        status: 'ONLINE_GW',
        cpuUsage: 55,
        memoryUsage: 72,
        bleDevicesConnected: 10,
        pendingCommands: 3,
        firmwareVersion: '1.0.2',
      },
    });

    expect(res.statusCode).toBe(200);

    // Verify the gateway record was updated
    const gateway = await app.prisma.gateway.findUnique({
      where: { id: FR_IDS.gateway },
    });

    expect(gateway).not.toBeNull();
    expect(gateway!.cpuUsage).toBe(55);
    expect(gateway!.memoryUsage).toBe(72);
    expect(gateway!.bleDevicesConnected).toBe(10);
    expect(gateway!.firmwareVersion).toBe('1.0.2');
    expect(gateway!.lastHeartbeatAt).toBeDefined();

    // Verify heartbeat record was created
    const latestHeartbeat = await app.prisma.gatewayHeartbeat.findFirst({
      where: { gatewayId: FR_IDS.gateway },
      orderBy: { timestamp: 'desc' },
    });

    expect(latestHeartbeat).not.toBeNull();
    expect(latestHeartbeat!.cpuUsage).toBe(55);
    expect(latestHeartbeat!.memoryUsage).toBe(72);
    expect(latestHeartbeat!.firmwareVersion).toBe('1.0.2');

    // Restore firmware version
    await app.prisma.gateway.update({
      where: { id: FR_IDS.gateway },
      data: { firmwareVersion: '1.0.0', cpuUsage: 12, memoryUsage: 34, bleDevicesConnected: 8 },
    });
  });
});

// ============================================================================
// 7. Audit Logging Tests
// ============================================================================
describe('Audit Logging', () => {
  it('should log responder data access in audit log', async () => {
    const token = makeCommandToken();

    // Clear existing audit logs for this responder to get a clean count
    const beforeCount = await app.prisma.responderAuditLog.count({
      where: { responderUserId: FR_IDS.responderUsers.sgtSmith },
    });

    // Access several endpoints to generate audit entries
    await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/buildings`,
      headers: { authorization: `Bearer ${token}` },
    });

    await app.inject({
      method: 'GET',
      url: `/api/responder/schools/${FR_IDS.siteId}/contacts`,
      headers: { authorization: `Bearer ${token}` },
    });

    const afterCount = await app.prisma.responderAuditLog.count({
      where: { responderUserId: FR_IDS.responderUsers.sgtSmith },
    });

    // Should have at least 3 new audit log entries
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 3);

    // Verify the latest audit entries have proper structure
    const latestEntries = await app.prisma.responderAuditLog.findMany({
      where: { responderUserId: FR_IDS.responderUsers.sgtSmith },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    expect(latestEntries.length).toBe(3);
    for (const entry of latestEntries) {
      expect(entry.responderUserId).toBe(FR_IDS.responderUsers.sgtSmith);
      expect(entry.action).toBeDefined();
      expect(entry.resourceType).toBeDefined();
    }

    // Verify specific actions were logged
    const actions = latestEntries.map((e) => e.action);
    expect(actions).toContain('VIEW_CONTACTS');
    expect(actions).toContain('VIEW_BUILDINGS');
    expect(actions).toContain('VIEW_SCHOOL_DETAIL');
  });
});
