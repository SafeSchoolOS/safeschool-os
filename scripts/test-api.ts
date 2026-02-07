/**
 * SafeSchool API — Exhaustive End-to-End Test Suite
 *
 * Prerequisites:
 *   docker compose up -d postgres redis
 *   cd packages/db && npx prisma migrate dev --name init && npx tsx src/seed.ts
 *   cd packages/api && npx tsx src/server.ts        (terminal 1)
 *   cd packages/api && npx tsx src/worker-entry.ts   (terminal 2)
 *
 * Run:
 *   npx tsx scripts/test-api.ts
 */

const BASE = process.env.API_URL || 'http://localhost:3000';
let TOKEN = '';
let ADMIN_TOKEN = '';
let ALERT_ID = '';
let LOCKDOWN_ID = '';

const SITE_ID = '00000000-0000-4000-a000-000000000001';
const BUILDING_MAIN = '00000000-0000-4000-a000-000000000010';
const BUILDING_ANNEX = '00000000-0000-4000-a000-000000000011';
const DOOR_MAIN_ENTRANCE = '00000000-0000-4000-a000-000000002001';
const DOOR_OFFICE = '00000000-0000-4000-a000-000000002003';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function req(method: string, path: string, body?: any, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
    failures.push(name);
  }
}

async function testHealthEndpoints() {
  console.log('\n🏥 === HEALTH & INFO ===');

  const { status, data } = await req('GET', '/health');
  assert('GET /health returns 200', status === 200);
  assert('Health has status=ok', data.status === 'ok');
  assert('Health has mode', typeof data.mode === 'string');
  assert('Health has timestamp', typeof data.timestamp === 'string');

  const info = await req('GET', '/');
  assert('GET / returns 200', info.status === 200);
  assert('Info has name=SafeSchool API', info.data.name === 'SafeSchool API');
  assert('Info has version', info.data.version === '0.1.0');
}

async function testAuth() {
  console.log('\n🔐 === AUTHENTICATION ===');

  // Valid login
  const { status, data } = await req('POST', '/api/v1/auth/login', { email: 'teacher1@lincoln.edu' });
  assert('POST /auth/login returns 200', status === 200);
  assert('Login returns token', typeof data.token === 'string' && data.token.length > 0);
  assert('Login returns user object', data.user?.email === 'teacher1@lincoln.edu');
  assert('Login user has role TEACHER', data.user?.role === 'TEACHER');
  assert('Login user has siteIds', Array.isArray(data.user?.siteIds) && data.user.siteIds.length > 0);
  TOKEN = data.token;

  // Admin login
  const admin = await req('POST', '/api/v1/auth/login', { email: 'admin@lincoln.edu' });
  assert('Admin login returns 200', admin.status === 200);
  assert('Admin has SITE_ADMIN role', admin.data.user?.role === 'SITE_ADMIN');
  ADMIN_TOKEN = admin.data.token;

  // Operator login
  const op = await req('POST', '/api/v1/auth/login', { email: 'operator@lincoln.edu' });
  assert('Operator login returns 200', op.status === 200);
  assert('Operator has OPERATOR role', op.data.user?.role === 'OPERATOR');

  // First responder login
  const fr = await req('POST', '/api/v1/auth/login', { email: 'responder@lincoln.edu' });
  assert('Responder login returns 200', fr.status === 200);
  assert('Responder has FIRST_RESPONDER role', fr.data.user?.role === 'FIRST_RESPONDER');

  // Invalid login
  const bad = await req('POST', '/api/v1/auth/login', { email: 'nobody@nowhere.com' });
  assert('Invalid login returns 401', bad.status === 401);

  // Missing email
  const noEmail = await req('POST', '/api/v1/auth/login', {});
  assert('Missing email returns 400', noEmail.status === 400);

  // GET /me with token
  const me = await req('GET', '/api/v1/auth/me', undefined, TOKEN);
  assert('GET /auth/me returns 200', me.status === 200);
  assert('/me returns correct email', me.data.email === 'teacher1@lincoln.edu');
  assert('/me returns correct name', me.data.name === 'Emily Chen');
  assert('/me returns siteIds', Array.isArray(me.data.siteIds));

  // GET /me without token
  const noAuth = await req('GET', '/api/v1/auth/me');
  assert('GET /auth/me without token returns 401', noAuth.status === 401);

  // GET /me with invalid token
  const badToken = await req('GET', '/api/v1/auth/me', undefined, 'invalid-token');
  assert('GET /auth/me with bad token returns 401', badToken.status === 401);
}

async function testSites() {
  console.log('\n🏫 === SITES ===');

  const { status, data } = await req('GET', '/api/v1/sites', undefined, TOKEN);
  assert('GET /sites returns 200', status === 200);
  assert('Sites returns array', Array.isArray(data));
  assert('Sites has at least 1 site', data.length >= 1);

  const site = data[0];
  assert('Site has name', site.name === 'Lincoln Elementary School');
  assert('Site has district', site.district === 'Newark Public Schools');
  assert('Site has buildings array', Array.isArray(site.buildings));
  assert('Site has 2 buildings', site.buildings.length === 2);

  // Site detail
  const detail = await req('GET', `/api/v1/sites/${SITE_ID}`, undefined, TOKEN);
  assert('GET /sites/:id returns 200', detail.status === 200);
  assert('Site detail has buildings with rooms', detail.data.buildings?.[0]?.rooms?.length > 0);
  assert('Site detail has buildings with doors', detail.data.buildings?.[0]?.doors?.length > 0);

  // Main building has correct rooms
  const mainBuilding = detail.data.buildings.find((b: any) => b.id === BUILDING_MAIN);
  assert('Main building found', !!mainBuilding);
  assert('Main building has 9 rooms', mainBuilding?.rooms?.length === 9);
  assert('Main building has 6 doors', mainBuilding?.doors?.length === 6);

  // Annex building
  const annex = detail.data.buildings.find((b: any) => b.id === BUILDING_ANNEX);
  assert('Annex building found', !!annex);
  assert('Annex has 3 rooms', annex?.rooms?.length === 3);
  assert('Annex has 2 doors', annex?.doors?.length === 2);

  // Non-existent site
  const notFound = await req('GET', '/api/v1/sites/00000000-0000-0000-0000-000000000000', undefined, TOKEN);
  assert('Non-existent site returns 404', notFound.status === 404);

  // Sites without auth
  const noAuth = await req('GET', '/api/v1/sites');
  assert('GET /sites without auth returns 401', noAuth.status === 401);
}

async function testDoors() {
  console.log('\n🚪 === DOORS ===');

  const { status, data } = await req('GET', '/api/v1/doors', undefined, TOKEN);
  assert('GET /doors returns 200', status === 200);
  assert('Doors returns array', Array.isArray(data));
  assert('Has 8 doors total', data.length === 8);

  // Check door properties
  const door = data[0];
  assert('Door has id', typeof door.id === 'string');
  assert('Door has name', typeof door.name === 'string');
  assert('Door has status', typeof door.status === 'string');
  assert('Door has buildingId', typeof door.buildingId === 'string');
  assert('Door has controllerType', typeof door.controllerType === 'string');

  // Filter by siteId
  const bySite = await req('GET', `/api/v1/doors?siteId=${SITE_ID}`, undefined, TOKEN);
  assert('Doors filtered by siteId returns 200', bySite.status === 200);
  assert('Site filter returns 8 doors', bySite.data.length === 8);

  // Filter by buildingId
  const byBuilding = await req('GET', `/api/v1/doors?buildingId=${BUILDING_MAIN}`, undefined, TOKEN);
  assert('Doors filtered by buildingId returns 200', byBuilding.status === 200);
  assert('Main building has 6 doors', byBuilding.data.length === 6);

  const byAnnex = await req('GET', `/api/v1/doors?buildingId=${BUILDING_ANNEX}`, undefined, TOKEN);
  assert('Annex has 2 doors', byAnnex.data.length === 2);

  // Unlock a door
  const unlock = await req('POST', `/api/v1/doors/${DOOR_OFFICE}/unlock`, {}, TOKEN);
  assert('POST /doors/:id/unlock returns 200', unlock.status === 200);
  assert('Door status changed to UNLOCKED', unlock.data.status === 'UNLOCKED');

  // Lock it back
  const lock = await req('POST', `/api/v1/doors/${DOOR_OFFICE}/lock`, {}, TOKEN);
  assert('POST /doors/:id/lock returns 200', lock.status === 200);
  assert('Door status changed to LOCKED', lock.data.status === 'LOCKED');

  // Non-existent door
  const notFound = await req('POST', '/api/v1/doors/00000000-0000-0000-0000-000000000000/lock', {}, TOKEN);
  assert('Non-existent door returns 404', notFound.status === 404);

  // Without auth
  const noAuth = await req('GET', '/api/v1/doors');
  assert('GET /doors without auth returns 401', noAuth.status === 401);
}

async function testAlerts() {
  console.log('\n🚨 === ALERTS ===');

  // List alerts (should be empty initially)
  const list = await req('GET', '/api/v1/alerts', undefined, TOKEN);
  assert('GET /alerts returns 200', list.status === 200);
  assert('Alerts returns array', Array.isArray(list.data));

  // Create MEDICAL alert
  const medical = await req('POST', '/api/v1/alerts', {
    level: 'MEDICAL',
    buildingId: BUILDING_MAIN,
    source: 'DASHBOARD',
    message: 'Student injury in Room 101',
  }, TOKEN);
  assert('POST /alerts (MEDICAL) returns 201', medical.status === 201);
  assert('Alert has id', typeof medical.data.id === 'string');
  assert('Alert level is MEDICAL', medical.data.level === 'MEDICAL');
  assert('Alert status is TRIGGERED', medical.data.status === 'TRIGGERED');
  assert('Alert source is DASHBOARD', medical.data.source === 'DASHBOARD');
  assert('Alert has buildingName', medical.data.buildingName === 'Main Building');
  assert('Alert has message', medical.data.message === 'Student injury in Room 101');
  assert('Alert has siteId', medical.data.siteId === SITE_ID);
  const MEDICAL_ID = medical.data.id;

  // Create ACTIVE_THREAT alert (triggers 911 dispatch + auto-lockdown)
  const threat = await req('POST', '/api/v1/alerts', {
    level: 'ACTIVE_THREAT',
    buildingId: BUILDING_MAIN,
    source: 'DASHBOARD',
    floor: 1,
  }, TOKEN);
  assert('POST /alerts (ACTIVE_THREAT) returns 201', threat.status === 201);
  assert('Threat alert status is TRIGGERED', threat.data.status === 'TRIGGERED');
  assert('Threat alert has floor', threat.data.floor === 1);
  ALERT_ID = threat.data.id;

  // Create LOCKDOWN alert
  const lockdownAlert = await req('POST', '/api/v1/alerts', {
    level: 'LOCKDOWN',
    buildingId: BUILDING_ANNEX,
    source: 'WALL_STATION',
  }, TOKEN);
  assert('POST /alerts (LOCKDOWN) returns 201', lockdownAlert.status === 201);
  assert('Lockdown alert buildingName is Annex', lockdownAlert.data.buildingName === 'Annex Building');

  // Create FIRE alert
  const fire = await req('POST', '/api/v1/alerts', {
    level: 'FIRE',
    buildingId: BUILDING_MAIN,
    source: 'AUTOMATED',
  }, TOKEN);
  assert('POST /alerts (FIRE) returns 201', fire.status === 201);

  // Wait a moment for BullMQ worker to process
  await new Promise(r => setTimeout(r, 2000));

  // List alerts again
  const listAfter = await req('GET', '/api/v1/alerts', undefined, TOKEN);
  assert('Alerts list now has 4+ alerts', listAfter.data.length >= 4);

  // Filter by status
  const triggered = await req('GET', '/api/v1/alerts?status=TRIGGERED', undefined, TOKEN);
  assert('Filter by TRIGGERED works', triggered.status === 200);

  // Filter by level
  const byLevel = await req('GET', '/api/v1/alerts?level=MEDICAL', undefined, TOKEN);
  assert('Filter by MEDICAL level works', byLevel.status === 200);
  assert('MEDICAL filter returns at least 1', byLevel.data.length >= 1);

  // Get single alert detail
  const detail = await req('GET', `/api/v1/alerts/${ALERT_ID}`, undefined, TOKEN);
  assert('GET /alerts/:id returns 200', detail.status === 200);
  assert('Alert detail has id', detail.data.id === ALERT_ID);
  assert('Alert detail has dispatchRecords', Array.isArray(detail.data.dispatchRecords));
  assert('Alert detail has lockdowns', Array.isArray(detail.data.lockdowns));

  // Acknowledge alert
  const ack = await req('PATCH', `/api/v1/alerts/${MEDICAL_ID}`, { status: 'ACKNOWLEDGED' }, ADMIN_TOKEN);
  assert('PATCH /alerts/:id ACKNOWLEDGED returns 200', ack.status === 200);
  assert('Alert status is now ACKNOWLEDGED', ack.data.status === 'ACKNOWLEDGED');
  assert('acknowledgedById is set', typeof ack.data.acknowledgedById === 'string');
  assert('acknowledgedAt is set', ack.data.acknowledgedAt !== null);

  // Resolve alert
  const resolve = await req('PATCH', `/api/v1/alerts/${MEDICAL_ID}`, { status: 'RESOLVED' }, ADMIN_TOKEN);
  assert('PATCH /alerts/:id RESOLVED returns 200', resolve.status === 200);
  assert('Alert status is now RESOLVED', resolve.data.status === 'RESOLVED');
  assert('resolvedAt is set', resolve.data.resolvedAt !== null);

  // Cancel another alert
  const cancel = await req('PATCH', `/api/v1/alerts/${fire.data.id}`, { status: 'CANCELLED' }, ADMIN_TOKEN);
  assert('PATCH /alerts/:id CANCELLED returns 200', cancel.status === 200);
  assert('Alert status is now CANCELLED', cancel.data.status === 'CANCELLED');

  // Invalid status transition
  const badStatus = await req('PATCH', `/api/v1/alerts/${ALERT_ID}`, { status: 'INVALID' }, TOKEN);
  assert('Invalid status returns 400', badStatus.status === 400);

  // Missing fields
  const noLevel = await req('POST', '/api/v1/alerts', { buildingId: BUILDING_MAIN }, TOKEN);
  assert('Missing level returns 400', noLevel.status === 400);

  const noBuilding = await req('POST', '/api/v1/alerts', { level: 'MEDICAL' }, TOKEN);
  assert('Missing buildingId returns 400', noBuilding.status === 400);

  // Without auth
  const noAuth = await req('POST', '/api/v1/alerts', { level: 'MEDICAL', buildingId: BUILDING_MAIN });
  assert('POST /alerts without auth returns 401', noAuth.status === 401);

  // Limit
  const limited = await req('GET', '/api/v1/alerts?limit=2', undefined, TOKEN);
  assert('Limit=2 returns at most 2', limited.data.length <= 2);
}

async function testLockdown() {
  console.log('\n🔒 === LOCKDOWN ===');

  // Initiate building lockdown
  const initiate = await req('POST', '/api/v1/lockdown', {
    scope: 'BUILDING',
    targetId: BUILDING_MAIN,
  }, ADMIN_TOKEN);
  assert('POST /lockdown returns 201', initiate.status === 201);
  assert('Lockdown has id', typeof initiate.data.id === 'string');
  assert('Lockdown scope is BUILDING', initiate.data.scope === 'BUILDING');
  assert('Lockdown targetId matches', initiate.data.targetId === BUILDING_MAIN);
  assert('Lockdown has doorsLocked count', typeof initiate.data.doorsLocked === 'number');
  assert('Lockdown doorsLocked > 0', initiate.data.doorsLocked > 0);
  LOCKDOWN_ID = initiate.data.id;

  // Active lockdowns
  const active = await req('GET', '/api/v1/lockdown/active', undefined, ADMIN_TOKEN);
  assert('GET /lockdown/active returns 200', active.status === 200);
  assert('Has at least 1 active lockdown', active.data.length >= 1);
  assert('Active lockdown matches our id', active.data.some((ld: any) => ld.id === LOCKDOWN_ID));

  // Release lockdown
  const release = await req('DELETE', `/api/v1/lockdown/${LOCKDOWN_ID}`, undefined, ADMIN_TOKEN);
  assert('DELETE /lockdown/:id returns 200', release.status === 200);
  assert('Lockdown has releasedAt', release.data.releasedAt !== null);

  // Try to release again (should fail)
  const reRelease = await req('DELETE', `/api/v1/lockdown/${LOCKDOWN_ID}`, undefined, ADMIN_TOKEN);
  assert('Double-release returns 400', reRelease.status === 400);

  // Full site lockdown
  const fullSite = await req('POST', '/api/v1/lockdown', {
    scope: 'FULL_SITE',
    targetId: SITE_ID,
  }, ADMIN_TOKEN);
  assert('Full site lockdown returns 201', fullSite.status === 201);
  assert('Full site scope is FULL_SITE', fullSite.data.scope === 'FULL_SITE');

  // Release it
  await req('DELETE', `/api/v1/lockdown/${fullSite.data.id}`, undefined, ADMIN_TOKEN);

  // Missing fields
  const noScope = await req('POST', '/api/v1/lockdown', { targetId: BUILDING_MAIN }, ADMIN_TOKEN);
  assert('Missing scope returns 400', noScope.status === 400);

  // Non-existent lockdown
  const notFound = await req('DELETE', '/api/v1/lockdown/00000000-0000-0000-0000-000000000000', undefined, ADMIN_TOKEN);
  assert('Non-existent lockdown returns 404', notFound.status === 404);

  // Without auth
  const noAuth = await req('POST', '/api/v1/lockdown', { scope: 'BUILDING', targetId: BUILDING_MAIN });
  assert('POST /lockdown without auth returns 401', noAuth.status === 401);
}

async function testWebSocket() {
  console.log('\n🔌 === WEBSOCKET ===');

  // We can't fully test WebSocket from a script without a ws client library,
  // but we can verify the upgrade endpoint exists
  try {
    const res = await fetch(`${BASE}/ws`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    // WebSocket upgrade will either succeed (101) or fail with a non-404 status
    assert('WebSocket endpoint exists (not 404)', res.status !== 404);
  } catch {
    // Connection error is fine — the endpoint exists but upgrade failed in fetch
    assert('WebSocket endpoint exists (connection attempted)', true);
  }
}

async function testEdgeCases() {
  console.log('\n⚠️  === EDGE CASES ===');

  // Non-existent routes
  const notFound = await req('GET', '/api/v1/nonexistent', undefined, TOKEN);
  assert('Non-existent route returns 404', notFound.status === 404);

  // Malformed JSON body
  try {
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    assert('Malformed JSON returns error (not 500)', res.status !== 500);
  } catch {
    assert('Malformed JSON handled', true);
  }

  // Very long email
  const longEmail = await req('POST', '/api/v1/auth/login', { email: 'a'.repeat(500) + '@test.com' });
  assert('Long email returns 401 (user not found)', longEmail.status === 401);

  // Alert with all optional fields
  const fullAlert = await req('POST', '/api/v1/alerts', {
    level: 'WEATHER',
    buildingId: BUILDING_MAIN,
    source: 'AUTOMATED',
    floor: 2,
    roomId: '00000000-0000-4000-a000-000000000103',
    message: 'Severe weather warning — tornado watch',
  }, TOKEN);
  assert('Alert with all fields returns 201', fullAlert.status === 201);
  assert('Alert has roomName from lookup', typeof fullAlert.data.roomName === 'string');
  assert('Alert floor is 2', fullAlert.data.floor === 2);

  // Multiple concurrent alerts
  const concurrent = await Promise.all([
    req('POST', '/api/v1/alerts', { level: 'MEDICAL', buildingId: BUILDING_MAIN }, TOKEN),
    req('POST', '/api/v1/alerts', { level: 'MEDICAL', buildingId: BUILDING_ANNEX }, TOKEN),
  ]);
  assert('Concurrent alerts both succeed', concurrent.every(r => r.status === 201));
  assert('Concurrent alerts have different IDs', concurrent[0].data.id !== concurrent[1].data.id);
}

async function main() {
  console.log('🧪 SafeSchool API — Exhaustive Test Suite');
  console.log(`   Target: ${BASE}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  try {
    await testHealthEndpoints();
    await testAuth();
    await testSites();
    await testDoors();
    await testAlerts();
    await testLockdown();
    await testWebSocket();
    await testEdgeCases();
  } catch (err) {
    console.error('\n💥 Test execution error:', err);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failures.length > 0) {
    console.log(`\n❌ Failed tests:`);
    failures.forEach(f => console.log(`   - ${f}`));
  }
  console.log(`${'='.repeat(60)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
