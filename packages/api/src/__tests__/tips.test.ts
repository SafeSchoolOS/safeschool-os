import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from './setup.js';
import { authenticateAs, SEED } from './helpers.js';

// ============================================================================
// Seed IDs (from packages/db/src/seed.ts)
// ============================================================================
const SITE_ID = '00000000-0000-4000-a000-000000000001';

// ============================================================================
// Test Suite
// ============================================================================
let app: FastifyInstance;
let adminToken: string;
let operatorToken: string;
let teacherToken: string;

beforeAll(async () => {
  app = await buildTestServer();
  adminToken = await authenticateAs(app, 'admin');
  operatorToken = await authenticateAs(app, 'operator');
  teacherToken = await authenticateAs(app, 'teacher1');
});

afterAll(async () => {
  // Clean up all test-created data
  const seedPrefix = '00000000-0000-4000-a000-';
  const nonSeed = { id: { not: { startsWith: seedPrefix } } };

  // FR tip child tables first
  await app.prisma.tipFollowUp.deleteMany({ where: nonSeed });
  await app.prisma.smsTipMessage.deleteMany({ where: nonSeed });
  await app.prisma.smsTipConversation.deleteMany({ where: nonSeed });
  await app.prisma.fRTip.deleteMany({ where: nonSeed });
  await app.prisma.tipWebhookConfig.deleteMany({ where: nonSeed });
  await app.prisma.auditLog.deleteMany({ where: nonSeed });

  await cleanupTestData(app);
  await app.close();
});

afterEach(async () => {
  const seedPrefix = '00000000-0000-4000-a000-';
  const nonSeed = { id: { not: { startsWith: seedPrefix } } };

  await app.prisma.tipFollowUp.deleteMany({ where: nonSeed });
  await app.prisma.smsTipMessage.deleteMany({ where: nonSeed });
  await app.prisma.smsTipConversation.deleteMany({ where: nonSeed });
  await app.prisma.fRTip.deleteMany({ where: nonSeed });
  await app.prisma.tipWebhookConfig.deleteMany({ where: nonSeed });
  await app.prisma.auditLog.deleteMany({ where: nonSeed });
});

// ============================================================================
// Helper: submit a tip via the public API
// ============================================================================
async function submitTip(overrides: {
  category?: string;
  content?: string;
  siteId?: string;
  severity?: string;
  source?: string;
} = {}): Promise<any> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/tips/public',
    payload: {
      siteId: overrides.siteId || SITE_ID,
      category: overrides.category || 'BULLYING_TIP',
      content: overrides.content || 'I saw someone being bullied in the hallway near the cafeteria.',
      severity: overrides.severity || 'MEDIUM',
      source: overrides.source || 'WEB_FORM',
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body);
}

// ============================================================================
// 1. Public Routes — /api/v1/tips/public
// ============================================================================
describe('Public Tip Submission', () => {
  it('POST /api/v1/tips/public — submit a tip (category + content required)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/public',
      payload: {
        siteId: SITE_ID,
        category: 'THREAT_OF_VIOLENCE',
        content: 'Someone threatened another student in the bathroom after lunch today.',
        severity: 'HIGH',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.trackingCode).toBeDefined();
    expect(body.trackingCode).toMatch(/^TIP-[A-Z2-9]{6}$/);
    expect(body.status).toBe('NEW_TIP');
    expect(body.createdAt).toBeDefined();
  });

  it('POST /api/v1/tips/public — CRITICAL severity sets status to UNDER_REVIEW_TIP', async () => {
    const tip = await submitTip({ severity: 'CRITICAL', content: 'Someone has a weapon in their locker on the second floor.' });

    expect(tip.status).toBe('UNDER_REVIEW_TIP');
  });

  it('POST /api/v1/tips/public — returns 400 when category is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/public',
      payload: {
        content: 'Some content that is long enough to pass validation.',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('category');
  });

  it('POST /api/v1/tips/public — returns 400 when content is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/public',
      payload: {
        category: 'BULLYING_TIP',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('content');
  });

  it('POST /api/v1/tips/public — returns 400 when content is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/public',
      payload: {
        category: 'BULLYING_TIP',
        content: 'Short',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('10 characters');
  });

  it('POST /api/v1/tips/public — returns 400 for invalid category', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/public',
      payload: {
        category: 'INVALID_CATEGORY',
        content: 'This is a valid content message that is longer than ten characters.',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Invalid category');
  });

  it('GET /api/v1/tips/public/categories — list tip categories', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/public/categories',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(9); // 9 categories
    expect(body[0]).toHaveProperty('value');
    expect(body[0]).toHaveProperty('label');

    const values = body.map((c: any) => c.value);
    expect(values).toContain('THREAT_OF_VIOLENCE');
    expect(values).toContain('WEAPON');
    expect(values).toContain('BULLYING_TIP');
    expect(values).toContain('SELF_HARM_TIP');
  });

  it('GET /api/v1/tips/public/track/:trackingCode — track tip status', async () => {
    const tip = await submitTip();

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tips/public/track/${tip.trackingCode}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.trackingCode).toBe(tip.trackingCode);
    expect(body.status).toBe('NEW_TIP');
    expect(body.category).toBe('BULLYING_TIP');
    expect(body.createdAt).toBeDefined();
    expect(body.updatedAt).toBeDefined();
    // Should NOT expose sensitive fields
    expect(body.content).toBeUndefined();
    expect(body.tipsterContact).toBeUndefined();
    expect(body.assignedTo).toBeUndefined();
  });

  it('GET /api/v1/tips/public/track/:trackingCode — 404 for nonexistent code', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/public/track/TIP-ZZZZZZ',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Tip not found');
  });

  it('POST /api/v1/tips/public/track/:trackingCode/followup — add follow-up', async () => {
    const tip = await submitTip();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tips/public/track/${tip.trackingCode}/followup`,
      payload: {
        content: 'I forgot to mention the incident happened at 3pm near room 101.',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.message).toBe('Follow-up submitted successfully');
  });

  it('POST /api/v1/tips/public/track/:trackingCode/followup — 400 when content too short', async () => {
    const tip = await submitTip();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tips/public/track/${tip.trackingCode}/followup`,
      payload: {
        content: 'Hi',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('5 characters');
  });

  it('POST /api/v1/tips/public/track/:trackingCode/followup — 404 for nonexistent code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/public/track/TIP-ZZZZZZ/followup',
      payload: {
        content: 'This should not work because the tracking code does not exist.',
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Tip not found');
  });

  it('GET /api/v1/tips/public/schools — list schools for dropdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/public/schools',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const site = body[0];
    expect(site.id).toBeDefined();
    expect(site.name).toBeDefined();
    // Should not expose full site details
    expect(site.address).toBeUndefined();
  });
});

// ============================================================================
// 2. Admin Routes — /api/v1/tips/admin
// ============================================================================
describe('Admin Tip Management', () => {
  it('GET /api/v1/tips/admin — list tips (OPERATOR+ auth)', async () => {
    await submitTip();
    await submitTip({ category: 'WEAPON', content: 'Found a knife in the parking lot behind the gymnasium.' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/admin',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.tips).toBeDefined();
    expect(Array.isArray(body.tips)).toBe(true);
    expect(body.tips.length).toBeGreaterThanOrEqual(2);
    expect(typeof body.total).toBe('number');
    expect(body.total).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/v1/tips/admin — filter by status', async () => {
    await submitTip({ severity: 'CRITICAL', content: 'Critical tip that should go to UNDER_REVIEW_TIP automatically.' });
    await submitTip(); // This creates a NEW_TIP

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/admin?status=UNDER_REVIEW_TIP',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.tips.length).toBeGreaterThanOrEqual(1);
    for (const tip of body.tips) {
      expect(tip.status).toBe('UNDER_REVIEW_TIP');
    }
  });

  it('GET /api/v1/tips/admin — filter by category', async () => {
    await submitTip({ category: 'WEAPON', content: 'Spotted something suspicious in the locker room near gym entrance.' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/admin?category=WEAPON',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.tips.length).toBeGreaterThanOrEqual(1);
    for (const tip of body.tips) {
      expect(tip.category).toBe('WEAPON');
    }
  });

  it('GET /api/v1/tips/admin — rejected for TEACHER role (below OPERATOR)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/admin',
      headers: { authorization: `Bearer ${teacherToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('GET /api/v1/tips/admin — rejected without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/admin',
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/tips/admin/analytics — tip analytics', async () => {
    await submitTip();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/admin/analytics',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.bySource).toBeDefined();
    expect(body.byCategory).toBeDefined();
    expect(body.bySeverity).toBeDefined();
    expect(body.byStatus).toBeDefined();
    expect(typeof body.total).toBe('number');
    expect(body.total).toBeGreaterThanOrEqual(1);
    // avgResponseTimeMinutes can be null if no tips resolved
    expect(body).toHaveProperty('avgResponseTimeMinutes');
  });

  it('GET /api/v1/tips/admin/:tipId — tip detail with follow-ups', async () => {
    const tip = await submitTip();

    // Add a follow-up first
    await app.inject({
      method: 'POST',
      url: `/api/v1/tips/public/track/${tip.trackingCode}/followup`,
      payload: {
        content: 'Additional detail about the bullying incident in the hallway.',
      },
    });

    // Get full tip from DB to obtain the ID
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { trackingCode: tip.trackingCode },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tips/admin/${dbTip!.id}`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.id).toBe(dbTip!.id);
    expect(body.trackingCode).toBe(tip.trackingCode);
    expect(body.content).toBeDefined();
    expect(body.followUps).toBeDefined();
    expect(Array.isArray(body.followUps)).toBe(true);
    expect(body.followUps.length).toBeGreaterThanOrEqual(1);
    expect(body.timeline).toBeDefined();
  });

  it('GET /api/v1/tips/admin/:tipId — 404 for nonexistent tip', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/admin/00000000-0000-0000-0000-ffffffffffff',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Tip not found');
  });

  it('PUT /api/v1/tips/admin/:tipId — update tip status and assignee', async () => {
    const tip = await submitTip();
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { trackingCode: tip.trackingCode },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/tips/admin/${dbTip!.id}`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        status: 'UNDER_REVIEW_TIP',
        assignedTo: SEED.users.operator.id,
        severity: 'HIGH',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.status).toBe('UNDER_REVIEW_TIP');
    expect(body.assignedTo).toBe(SEED.users.operator.id);
    expect(body.severity).toBe('HIGH');
    // Timeline should have been updated
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(body.timeline.length).toBeGreaterThanOrEqual(2); // initial + update entries
  });

  it('PUT /api/v1/tips/admin/:tipId — resolve tip sets resolvedAt and resolvedBy', async () => {
    const tip = await submitTip();
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { trackingCode: tip.trackingCode },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/tips/admin/${dbTip!.id}`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        status: 'RESOLVED_TIP',
        resolution: 'Investigated and resolved. No threat found.',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.status).toBe('RESOLVED_TIP');
    expect(body.resolvedAt).toBeDefined();
    expect(body.resolvedBy).toBe(SEED.users.operator.id);
    expect(body.resolution).toBe('Investigated and resolved. No threat found.');
  });

  it('POST /api/v1/tips/admin/:tipId/escalate — escalate tip to agency (SITE_ADMIN+)', async () => {
    const tip = await submitTip({ severity: 'HIGH', content: 'A student mentioned bringing a weapon to school tomorrow morning.' });
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { trackingCode: tip.trackingCode },
    });

    // Find the first available agency in seed data
    const agency = await app.prisma.agency.findFirst();
    if (!agency) {
      // Skip if no agencies are seeded — this test requires seed data
      return;
    }

    // Mock wsManager for escalation broadcast
    const broadcastFn = vi.fn();
    const originalWsManager = app.wsManager;
    Object.defineProperty(app, 'wsManager', {
      get: () => ({ broadcastToSite: broadcastFn }),
      configurable: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tips/admin/${dbTip!.id}/escalate`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        agencyId: agency.id,
        notes: 'Immediate law enforcement response needed',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.status).toBe('ESCALATED_TIP');
    expect(body.escalatedToAgencyId).toBe(agency.id);
    expect(body.escalatedAt).toBeDefined();

    // Restore wsManager
    Object.defineProperty(app, 'wsManager', {
      get: () => originalWsManager,
      configurable: true,
    });
  });

  it('POST /api/v1/tips/admin/:tipId/escalate — rejected for OPERATOR (below SITE_ADMIN)', async () => {
    const tip = await submitTip();
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { trackingCode: tip.trackingCode },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tips/admin/${dbTip!.id}/escalate`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        agencyId: '00000000-0000-0000-0000-ffffffffffff',
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('POST /api/v1/tips/admin/:tipId/escalate — 400 when agencyId is missing', async () => {
    const tip = await submitTip();
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { trackingCode: tip.trackingCode },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tips/admin/${dbTip!.id}/escalate`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('agencyId');
  });

  it('POST /api/v1/tips/admin/:tipId/public-update — post public message visible to tipster', async () => {
    const tip = await submitTip();
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { trackingCode: tip.trackingCode },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tips/admin/${dbTip!.id}/public-update`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        message: 'Thank you for your tip. We are looking into this matter.',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.publicStatusMessage).toBe('Thank you for your tip. We are looking into this matter.');
    // The public timeline entry should be appended
    const publicEntries = (body.timeline as any[]).filter((e: any) => e.isPublic);
    expect(publicEntries.length).toBeGreaterThanOrEqual(2); // initial + public update
  });

  it('POST /api/v1/tips/admin/:tipId/public-update — 400 when message is empty', async () => {
    const tip = await submitTip();
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { trackingCode: tip.trackingCode },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tips/admin/${dbTip!.id}/public-update`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        message: '   ',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('message');
  });

  it('public tracking shows publicStatusMessage after admin posts update', async () => {
    const tip = await submitTip();
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { trackingCode: tip.trackingCode },
    });

    // Admin posts a public update
    await app.inject({
      method: 'POST',
      url: `/api/v1/tips/admin/${dbTip!.id}/public-update`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        message: 'We have received your tip and are investigating.',
      },
    });

    // Public tracking should show the message
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tips/public/track/${tip.trackingCode}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.publicStatusMessage).toBe('We have received your tip and are investigating.');
  });
});

// ============================================================================
// 3. Integration Routes — /api/v1/tips/integrations
// ============================================================================
describe('SMS Tip Line', () => {
  it('POST /api/v1/tips/integrations/sms/inbound — starts conversation in AWAITING_SCHOOL state', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/sms/inbound',
      payload: {
        From: '+15551234567',
        Body: 'Hello',
        MessageSid: 'SM_test_001',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/xml');
    const body = res.body;
    // Should ask for school name since no match
    expect(body).toContain('could not find');
  });

  it('POST /api/v1/tips/integrations/sms/inbound — transitions through full SMS state machine', async () => {
    const phone = '+15559999001';

    // Step 1: Send school name — should match a seed site
    const site = await app.prisma.site.findFirst();
    expect(site).not.toBeNull();

    const step1 = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/sms/inbound',
      payload: { From: phone, Body: site!.name, MessageSid: 'SM_flow_1' },
    });
    expect(step1.statusCode).toBe(200);
    expect(step1.body).toContain('category');

    // Step 2: Select category (1 = Threat of Violence)
    const step2 = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/sms/inbound',
      payload: { From: phone, Body: '1', MessageSid: 'SM_flow_2' },
    });
    expect(step2.statusCode).toBe(200);
    expect(step2.body).toContain('Describe what you saw');

    // Step 3: Provide content
    const step3 = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/sms/inbound',
      payload: { From: phone, Body: 'A student was making threats during lunch about bringing a weapon.', MessageSid: 'SM_flow_3' },
    });
    expect(step3.statusCode).toBe(200);
    expect(step3.body).toContain('YES');
    expect(step3.body).toContain('Summary');

    // Step 4: Confirm with YES
    const step4 = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/sms/inbound',
      payload: { From: phone, Body: 'YES', MessageSid: 'SM_flow_4' },
    });
    expect(step4.statusCode).toBe(200);
    expect(step4.body).toContain('Tracking code');
    expect(step4.body).toContain('TIP-');
  });

  it('POST /api/v1/tips/integrations/sms/inbound — cancel during confirmation', async () => {
    const phone = '+15559999002';
    const site = await app.prisma.site.findFirst();

    // Step 1-3: Get to confirmation
    await app.inject({ method: 'POST', url: '/api/v1/tips/integrations/sms/inbound', payload: { From: phone, Body: site!.name, MessageSid: 'SM_cancel_1' } });
    await app.inject({ method: 'POST', url: '/api/v1/tips/integrations/sms/inbound', payload: { From: phone, Body: '3', MessageSid: 'SM_cancel_2' } });
    await app.inject({ method: 'POST', url: '/api/v1/tips/integrations/sms/inbound', payload: { From: phone, Body: 'This is a detailed description of bullying near the playground area.', MessageSid: 'SM_cancel_3' } });

    // Step 4: Cancel
    const step4 = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/sms/inbound',
      payload: { From: phone, Body: 'NO', MessageSid: 'SM_cancel_4' },
    });
    expect(step4.statusCode).toBe(200);
    expect(step4.body).toContain('cancelled');
  });

  it('POST /api/v1/tips/integrations/sms/inbound — rejects invalid request (no From/Body)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/sms/inbound',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/xml');
    expect(res.body).toContain('Invalid request');
  });

  it('POST /api/v1/tips/integrations/sms/status — updates message delivery status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/sms/status',
      payload: {
        MessageSid: 'SM_test_delivery',
        MessageStatus: 'delivered',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
  });
});

describe('Webhook Tip Ingestion', () => {
  it('POST /api/v1/tips/integrations/webhook/:source — 400 for unknown source', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/webhook/unknownsource',
      headers: { 'x-api-key': 'some-key' },
      payload: { content: 'Some tip content for testing webhook.' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Unknown webhook source');
  });

  it('POST /api/v1/tips/integrations/webhook/wetip — 401 without API key', async () => {
    // First create a config so the source is recognized
    await app.prisma.tipWebhookConfig.create({
      data: {
        siteId: SITE_ID,
        source: 'WEBHOOK_WETIP',
        enabled: true,
        apiKey: 'test-wetip-key-12345',
        categoryMapping: {},
        defaultCategory: 'OTHER_TIP',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/webhook/wetip',
      payload: { content: 'WeTip anonymous tip about suspicious activity.' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Missing X-API-Key');
  });

  it('POST /api/v1/tips/integrations/webhook/wetip — 401 with wrong API key', async () => {
    // Ensure config exists
    await app.prisma.tipWebhookConfig.upsert({
      where: { siteId_source: { siteId: SITE_ID, source: 'WEBHOOK_WETIP' } },
      update: { apiKey: 'correct-api-key-abc123' },
      create: {
        siteId: SITE_ID,
        source: 'WEBHOOK_WETIP',
        enabled: true,
        apiKey: 'correct-api-key-abc123',
        categoryMapping: {},
        defaultCategory: 'OTHER_TIP',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/webhook/wetip',
      headers: { 'x-api-key': 'wrong-api-key' },
      payload: { content: 'WeTip tip with wrong API key.' },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Invalid API key');
  });

  it('POST /api/v1/tips/integrations/webhook/wetip — creates tip with valid API key', async () => {
    const apiKey = 'valid-wetip-api-key-xyz';

    await app.prisma.tipWebhookConfig.upsert({
      where: { siteId_source: { siteId: SITE_ID, source: 'WEBHOOK_WETIP' } },
      update: { apiKey, enabled: true },
      create: {
        siteId: SITE_ID,
        source: 'WEBHOOK_WETIP',
        enabled: true,
        apiKey,
        categoryMapping: {},
        defaultCategory: 'OTHER_TIP',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/webhook/wetip',
      headers: { 'x-api-key': apiKey },
      payload: {
        content: 'Anonymous tip about suspicious person near the school entrance during pickup.',
        category: 'SUSPICIOUS_PERSON',
        severity: 'HIGH',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.trackingCode).toBeDefined();
    expect(body.trackingCode).toMatch(/^TIP-/);

    // Verify the tip was created correctly in DB
    const dbTip = await app.prisma.fRTip.findUnique({
      where: { id: body.id },
    });
    expect(dbTip).not.toBeNull();
    expect(dbTip!.source).toBe('WEBHOOK_WETIP');
    expect(dbTip!.category).toBe('SUSPICIOUS_PERSON');
    expect(dbTip!.severity).toBe('HIGH');
  });

  it('POST /api/v1/tips/integrations/webhook/wetip — 400 when content is missing', async () => {
    const apiKey = 'valid-wetip-api-key-xyz';

    await app.prisma.tipWebhookConfig.upsert({
      where: { siteId_source: { siteId: SITE_ID, source: 'WEBHOOK_WETIP' } },
      update: { apiKey, enabled: true },
      create: {
        siteId: SITE_ID,
        source: 'WEBHOOK_WETIP',
        enabled: true,
        apiKey,
        categoryMapping: {},
        defaultCategory: 'OTHER_TIP',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tips/integrations/webhook/wetip',
      headers: { 'x-api-key': apiKey },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('content');
  });
});

describe('Webhook Config Management', () => {
  it('GET /api/v1/tips/integrations/webhook/config — list configs (SITE_ADMIN+)', async () => {
    // Create a config first
    await app.prisma.tipWebhookConfig.upsert({
      where: { siteId_source: { siteId: SITE_ID, source: 'WEBHOOK_STOPIT' } },
      update: {},
      create: {
        siteId: SITE_ID,
        source: 'WEBHOOK_STOPIT',
        enabled: false,
        apiKey: 'stopit-key-123',
        categoryMapping: {},
        defaultCategory: 'BULLYING_TIP',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tips/integrations/webhook/config?siteId=${SITE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);

    const config = body.find((c: any) => c.source === 'WEBHOOK_STOPIT');
    expect(config).toBeDefined();
    expect(config.siteId).toBe(SITE_ID);
  });

  it('GET /api/v1/tips/integrations/webhook/config — 400 without siteId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tips/integrations/webhook/config',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('siteId');
  });

  it('GET /api/v1/tips/integrations/webhook/config — rejected for OPERATOR (below SITE_ADMIN)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tips/integrations/webhook/config?siteId=${SITE_ID}`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('PUT /api/v1/tips/integrations/webhook/config/stopit — upsert webhook config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/tips/integrations/webhook/config/stopit',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        siteId: SITE_ID,
        enabled: true,
        apiKey: 'new-stopit-api-key-456',
        defaultCategory: 'BULLYING_TIP',
        categoryMapping: { bullying: 'BULLYING_TIP', threat: 'THREAT_OF_VIOLENCE' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.siteId).toBe(SITE_ID);
    expect(body.source).toBe('WEBHOOK_STOPIT');
    expect(body.enabled).toBe(true);
  });

  it('PUT /api/v1/tips/integrations/webhook/config/:source — 400 for unknown source', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/tips/integrations/webhook/config/unknownsource',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        siteId: SITE_ID,
        enabled: true,
        apiKey: 'some-key',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Unknown webhook source');
  });

  it('PUT /api/v1/tips/integrations/webhook/config/stopit — 400 without siteId', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/tips/integrations/webhook/config/stopit',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        enabled: true,
        apiKey: 'some-key',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('siteId');
  });
});
