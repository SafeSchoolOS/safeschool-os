import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { buildTestServer, cleanupTestData } from './setup.js';
import { authenticateAs, SEED } from './helpers.js';

// ============================================================================
// Constants
// ============================================================================
const SITE_ID = SEED.siteId;
const DOOR_ID_1 = SEED.doors.mainEntrance;
const DOOR_ID_2 = SEED.doors.mainExit;

// ============================================================================
// Test Suite
// ============================================================================
let app: FastifyInstance;
let adminToken: string;
let operatorToken: string;

beforeAll(async () => {
  app = await buildTestServer();
  adminToken = await authenticateAs(app, 'admin');
  operatorToken = await authenticateAs(app, 'operator');
});

afterAll(async () => {
  await cleanupGatewayData();
  await cleanupTestData(app);
  await app.close();
});

afterEach(async () => {
  await cleanupGatewayData();
});

async function cleanupGatewayData() {
  const seedPrefix = '00000000-0000-4000-a000-';
  const nonSeed = { id: { not: { startsWith: seedPrefix } } };

  await app.prisma.gatewayStateSync.deleteMany({ where: nonSeed });
  await app.prisma.gatewayHeartbeat.deleteMany({ where: nonSeed });
  await app.prisma.doorCommand.deleteMany({ where: nonSeed });
  await app.prisma.gatewayFailoverEvent.deleteMany({ where: nonSeed });
  await app.prisma.auditLog.deleteMany({ where: nonSeed });
  // Unpair gateways before deleting (clear partnerId FK)
  await app.prisma.gateway.updateMany({
    where: { id: { not: { startsWith: seedPrefix } } },
    data: { partnerId: null },
  });
  await app.prisma.gateway.deleteMany({ where: nonSeed });
}

// ============================================================================
// Helpers
// ============================================================================
async function registerGateway(name: string, overrides: Record<string, any> = {}): Promise<any> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/gateways',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      siteId: SITE_ID,
      name,
      hostname: `${name.toLowerCase().replace(/\s/g, '-')}.local`,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body);
}

async function activateGateway(provisioningToken: string): Promise<{ gateway: any; authToken: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/gateways/cloud/activate',
    payload: {
      provisioningToken,
      hostname: 'gw-activated.local',
      ipAddress: '10.0.0.50',
      firmwareVersion: '1.0.0',
    },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

/** Create a gateway that is already activated (ONLINE_GW) with a known auth token. */
async function createActivatedGateway(name: string): Promise<{ gateway: any; authToken: string }> {
  const registered = await registerGateway(name);
  return activateGateway(registered.provisioningToken);
}

/** Create a gateway directly in DB with known auth token for cloud route testing. */
async function createGatewayInDb(
  name: string,
  overrides: Record<string, any> = {},
): Promise<{ gateway: any; rawToken: string }> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const authTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const gateway = await app.prisma.gateway.create({
    data: {
      siteId: SITE_ID,
      name,
      status: 'ONLINE_GW',
      clusterRole: 'SINGLE',
      clusterMode: 'STANDALONE',
      authTokenHash,
      lastHeartbeatAt: new Date(),
      ...overrides,
    },
  });

  return { gateway, rawToken };
}

// ============================================================================
// 1. Gateway CRUD
// ============================================================================
describe('Gateway CRUD', () => {
  it('GET /api/v1/gateways — list gateways for site', async () => {
    await createGatewayInDb('CRUD List GW');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways?siteId=${SITE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('name');
    expect(body[0]).toHaveProperty('status');
  });

  it('POST /api/v1/gateways — register new gateway returns provisioningToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        siteId: SITE_ID,
        name: 'New Gateway Register',
        hostname: 'new-gw.local',
        hardwareModel: 'MiniPC-v2',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.provisioningToken).toBeDefined();
    expect(body.provisioningToken.length).toBe(64); // 32 bytes hex
    expect(body.status).toBe('PROVISIONING_GW');
    expect(body.clusterRole).toBe('SINGLE');
    expect(body.clusterMode).toBe('STANDALONE');
  });

  it('GET /api/v1/gateways/:gatewayId — get gateway detail', async () => {
    const { gateway } = await createGatewayInDb('Detail GW');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways/${gateway.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(gateway.id);
    expect(body.name).toBe('Detail GW');
    expect(body).toHaveProperty('heartbeats');
    expect(body).toHaveProperty('partner');
  });

  it('PUT /api/v1/gateways/:gatewayId — update gateway config', async () => {
    const { gateway } = await createGatewayInDb('Update GW');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${gateway.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Updated Gateway Name',
        hostname: 'updated-gw.local',
        hasBackupCellular: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('Updated Gateway Name');
    expect(body.hostname).toBe('updated-gw.local');
    expect(body.hasBackupCellular).toBe(true);
  });

  it('DELETE /api/v1/gateways/:gatewayId — decommission gateway', async () => {
    const { gateway } = await createGatewayInDb('Decommission GW');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/gateways/${gateway.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    // Verify status changed to OFFLINE_GW
    const updated = await app.prisma.gateway.findUnique({ where: { id: gateway.id } });
    expect(updated!.status).toBe('OFFLINE_GW');
  });
});

// ============================================================================
// 2. Gateway Activation
// ============================================================================
describe('Gateway Activation', () => {
  it('POST /api/v1/gateways/cloud/activate — activates with valid provisioning token', async () => {
    const registered = await registerGateway('Activate GW');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/activate',
      payload: {
        provisioningToken: registered.provisioningToken,
        hostname: 'activated.local',
        ipAddress: '10.0.0.100',
        firmwareVersion: '2.0.0',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.authToken).toBeDefined();
    expect(body.authToken.length).toBe(64);
    expect(body.gateway.id).toBe(registered.id);
    expect(body.gateway.siteId).toBe(SITE_ID);
  });

  it('POST /api/v1/gateways/cloud/activate — rejects invalid provisioning token (404)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/activate',
      payload: {
        provisioningToken: 'invalid-token-does-not-exist',
        hostname: 'bad.local',
        ipAddress: '10.0.0.200',
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Invalid provisioning token');
  });

  it('POST /api/v1/gateways/cloud/activate — rejects already-activated gateway (409)', async () => {
    const registered = await registerGateway('Double Activate GW');
    await activateGateway(registered.provisioningToken);

    // Try to activate again with a new provisioning token — but original is now null
    // So we manually set a second provisioning token to test the status check
    const secondToken = crypto.randomBytes(32).toString('hex');
    await app.prisma.gateway.update({
      where: { id: registered.id },
      data: { provisioningToken: secondToken },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/activate',
      payload: {
        provisioningToken: secondToken,
        hostname: 'dup.local',
        ipAddress: '10.0.0.201',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('already been activated');
  });
});

// ============================================================================
// 3. Gateway Pairing
// ============================================================================
describe('Gateway Pairing', () => {
  it('POST /api/v1/gateways/:id/pair — pairs two gateways, sets HEALTHY_GW', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Pair GW 1');
    const { gateway: gw2 } = await createGatewayInDb('Pair GW 2');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw1.id}/pair`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        partnerId: gw2.id,
        clusterMode: 'ACTIVE_PASSIVE',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.gateway.clusterState).toBe('HEALTHY_GW');
    expect(body.partner.clusterState).toBe('HEALTHY_GW');
    expect(body.gateway.clusterRole).toBe('PRIMARY_GW');
    expect(body.partner.clusterRole).toBe('SECONDARY_GW');
  });

  it('POST /api/v1/gateways/:id/pair — rejects pairing with self', async () => {
    const { gateway: gw } = await createGatewayInDb('Self Pair GW');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw.id}/pair`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        partnerId: gw.id,
        clusterMode: 'ACTIVE_PASSIVE',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('cannot be paired with itself');
  });

  it('POST /api/v1/gateways/:id/pair — rejects already-paired gateway (409)', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Already Paired 1');
    const { gateway: gw2 } = await createGatewayInDb('Already Paired 2');
    const { gateway: gw3 } = await createGatewayInDb('Already Paired 3');

    // Pair gw1 and gw2
    await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw1.id}/pair`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { partnerId: gw2.id, clusterMode: 'ACTIVE_PASSIVE' },
    });

    // Try to pair gw1 with gw3
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw1.id}/pair`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { partnerId: gw3.id, clusterMode: 'ACTIVE_PASSIVE' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('already paired');
  });

  it('DELETE /api/v1/gateways/:id/pair — unpairs, resets to SINGLE/STANDALONE/SINGLE_GW', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Unpair GW 1');
    const { gateway: gw2 } = await createGatewayInDb('Unpair GW 2');

    await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw1.id}/pair`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { partnerId: gw2.id, clusterMode: 'ACTIVE_PASSIVE' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/gateways/${gw1.id}/pair`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);

    const updated1 = await app.prisma.gateway.findUnique({ where: { id: gw1.id } });
    const updated2 = await app.prisma.gateway.findUnique({ where: { id: gw2.id } });
    expect(updated1!.clusterRole).toBe('SINGLE');
    expect(updated1!.clusterMode).toBe('STANDALONE');
    expect(updated1!.clusterState).toBe('SINGLE_GW');
    expect(updated2!.clusterRole).toBe('SINGLE');
    expect(updated2!.clusterMode).toBe('STANDALONE');
    expect(updated2!.clusterState).toBe('SINGLE_GW');
  });

  it('PUT /api/v1/gateways/:id/cluster-mode — switches between ACTIVE_PASSIVE and ACTIVE_ACTIVE', async () => {
    const { gateway: gw1 } = await createGatewayInDb('ClusterMode GW 1');
    const { gateway: gw2 } = await createGatewayInDb('ClusterMode GW 2');

    await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw1.id}/pair`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { partnerId: gw2.id, clusterMode: 'ACTIVE_PASSIVE' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${gw1.id}/cluster-mode`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { clusterMode: 'ACTIVE_ACTIVE' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.gateway.clusterMode).toBe('ACTIVE_ACTIVE');
    expect(body.partner.clusterMode).toBe('ACTIVE_ACTIVE');
    // In ACTIVE_ACTIVE both are PRIMARY_GW
    expect(body.gateway.clusterRole).toBe('PRIMARY_GW');
    expect(body.partner.clusterRole).toBe('PRIMARY_GW');
  });
});

// ============================================================================
// 4. Device Assignment
// ============================================================================
describe('Device Assignment', () => {
  it('PUT /api/v1/gateways/:id/devices — assigns devices', async () => {
    const { gateway } = await createGatewayInDb('Device Assign GW');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${gateway.id}/devices`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { deviceIds: [DOOR_ID_1, DOOR_ID_2] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assignedDevices).toContain(DOOR_ID_1);
    expect(body.assignedDevices).toContain(DOOR_ID_2);
  });

  it('PUT /api/v1/gateways/:id/devices — rejects overlapping devices in ACTIVE_ACTIVE mode (409)', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Overlap Device GW 1');
    const { gateway: gw2 } = await createGatewayInDb('Overlap Device GW 2');

    // Pair in ACTIVE_ACTIVE
    await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw1.id}/pair`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { partnerId: gw2.id, clusterMode: 'ACTIVE_ACTIVE' },
    });

    // Assign door to gw1
    await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${gw1.id}/devices`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { deviceIds: [DOOR_ID_1] },
    });

    // Try to assign same door to gw2
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${gw2.id}/devices`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { deviceIds: [DOOR_ID_1] },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('already assigned to partner');
    expect(body.overlapping).toContain(DOOR_ID_1);
  });

  it('PUT /api/v1/gateways/:id/zones — assigns zones', async () => {
    const { gateway } = await createGatewayInDb('Zone Assign GW');

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${gateway.id}/zones`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { zones: ['ZONE-A', 'ZONE-B'] },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assignedZones).toContain('ZONE-A');
    expect(body.assignedZones).toContain('ZONE-B');
  });

  it('PUT /api/v1/gateways/:id/zones — rejects overlapping zones in ACTIVE_ACTIVE mode (409)', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Overlap Zone GW 1');
    const { gateway: gw2 } = await createGatewayInDb('Overlap Zone GW 2');

    // Pair in ACTIVE_ACTIVE
    await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw1.id}/pair`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { partnerId: gw2.id, clusterMode: 'ACTIVE_ACTIVE' },
    });

    // Assign zone to gw1
    await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${gw1.id}/zones`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { zones: ['ZONE-A', 'ZONE-B'] },
    });

    // Try to assign overlapping zone to gw2
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/${gw2.id}/zones`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { zones: ['ZONE-B', 'ZONE-C'] },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('already assigned to partner');
    expect(body.overlapping).toContain('ZONE-B');
  });
});

// ============================================================================
// 5. Door Command Queue
// ============================================================================
describe('Door Command Queue', () => {
  it('POST /api/v1/gateways/commands — creates PENDING command routed to correct gateway', async () => {
    const { gateway } = await createGatewayInDb('Command GW', {
      assignedDevices: [DOOR_ID_1],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/commands',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        doorId: DOOR_ID_1,
        command: 'LOCK',
        siteId: SITE_ID,
        issuedBy: SEED.users.operator.id,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('PENDING');
    expect(body.gatewayId).toBe(gateway.id);
    expect(body.doorId).toBe(DOOR_ID_1);
    expect(body.command).toBe('LOCK');
    expect(body.retryCount).toBe(0);
    expect(body.maxRetries).toBe(3);
  });

  it('GET /api/v1/gateways/commands — lists commands with filters', async () => {
    const { gateway } = await createGatewayInDb('List Cmd GW', {
      assignedDevices: [DOOR_ID_1],
    });

    // Create a command
    await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/commands',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        doorId: DOOR_ID_1,
        command: 'UNLOCK',
        siteId: SITE_ID,
        issuedBy: SEED.users.operator.id,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways/commands?siteId=${SITE_ID}&status=PENDING`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty('gateway');
    for (const cmd of body) {
      expect(cmd.status).toBe('PENDING');
    }
  });

  it('POST /api/v1/gateways/commands/:id/retry — retries failed command', async () => {
    const { gateway } = await createGatewayInDb('Retry Cmd GW', {
      assignedDevices: [DOOR_ID_1],
    });

    // Create a command and mark it failed
    const cmd = await app.prisma.doorCommand.create({
      data: {
        doorId: DOOR_ID_1,
        command: 'LOCK',
        gatewayId: gateway.id,
        issuedBy: SEED.users.operator.id,
        issuedByType: 'STAFF',
        status: 'FAILED',
        failureReason: 'Device timeout',
        retryCount: 1,
        maxRetries: 3,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/commands/${cmd.id}/retry`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('PENDING');
    expect(body.retryCount).toBe(2);
    expect(body.failureReason).toBeNull();
  });

  it('POST /api/v1/gateways/commands/:id/retry — rejects when max retries exceeded', async () => {
    const { gateway } = await createGatewayInDb('Max Retry GW', {
      assignedDevices: [DOOR_ID_1],
    });

    const cmd = await app.prisma.doorCommand.create({
      data: {
        doorId: DOOR_ID_1,
        command: 'LOCK',
        gatewayId: gateway.id,
        issuedBy: SEED.users.operator.id,
        issuedByType: 'STAFF',
        status: 'FAILED',
        failureReason: 'Device timeout',
        retryCount: 3,
        maxRetries: 3,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/commands/${cmd.id}/retry`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Maximum retries exceeded');
  });

  it('POST /api/v1/gateways/commands/:id/retry — reroutes to partner when original gateway offline', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Reroute GW 1', {
      status: 'OFFLINE_GW',
      assignedDevices: [DOOR_ID_1],
    });
    const { gateway: gw2 } = await createGatewayInDb('Reroute GW 2', {
      status: 'ONLINE_GW',
    });

    // Pair them
    await app.prisma.gateway.update({
      where: { id: gw1.id },
      data: { partnerId: gw2.id, clusterMode: 'ACTIVE_PASSIVE', clusterRole: 'PRIMARY_GW' },
    });
    await app.prisma.gateway.update({
      where: { id: gw2.id },
      data: { partnerId: gw1.id, clusterMode: 'ACTIVE_PASSIVE', clusterRole: 'SECONDARY_GW' },
    });

    const cmd = await app.prisma.doorCommand.create({
      data: {
        doorId: DOOR_ID_1,
        command: 'LOCK',
        gatewayId: gw1.id,
        issuedBy: SEED.users.operator.id,
        issuedByType: 'STAFF',
        status: 'FAILED',
        failureReason: 'Gateway offline',
        retryCount: 0,
        maxRetries: 3,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/commands/${cmd.id}/retry`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('PENDING');
    expect(body.gatewayId).toBe(gw2.id); // Rerouted to partner
  });
});

// ============================================================================
// 6. Cloud Routes (gateway auth)
// ============================================================================
describe('Cloud Routes (gateway auth)', () => {
  it('POST /api/v1/gateways/cloud/heartbeat — records heartbeat', async () => {
    const { gateway, rawToken } = await createGatewayInDb('Heartbeat GW');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/heartbeat',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: {
        gatewayId: gateway.id,
        status: 'ONLINE_GW',
        cpuUsage: 45.2,
        memoryUsage: 62.1,
        bleDevicesConnected: 8,
        pendingCommands: 2,
        firmwareVersion: '1.2.0',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);

    // Verify heartbeat record was created
    const heartbeats = await app.prisma.gatewayHeartbeat.findMany({
      where: { gatewayId: gateway.id },
    });
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
    expect(heartbeats[0].cpuUsage).toBe(45.2);

    // Verify gateway updated
    const updated = await app.prisma.gateway.findUnique({ where: { id: gateway.id } });
    expect(updated!.lastHeartbeatAt).not.toBeNull();
    expect(updated!.firmwareVersion).toBe('1.2.0');
  });

  it('GET /api/v1/gateways/cloud/commands — pulls pending commands', async () => {
    const { gateway, rawToken } = await createGatewayInDb('Pull Cmd GW');

    // Create pending commands for this gateway
    await app.prisma.doorCommand.create({
      data: {
        doorId: DOOR_ID_1,
        command: 'LOCK',
        gatewayId: gateway.id,
        issuedBy: SEED.users.operator.id,
        issuedByType: 'STAFF',
        status: 'PENDING',
        retryCount: 0,
        maxRetries: 3,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/gateways/cloud/commands',
      headers: { authorization: `Bearer ${rawToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.commands).toBeDefined();
    expect(Array.isArray(body.commands)).toBe(true);
    expect(body.commands.length).toBeGreaterThanOrEqual(1);
    expect(body.commands[0].status).toBe('PENDING');
    expect(body.commands[0].doorId).toBe(DOOR_ID_1);
  });

  it('PUT /api/v1/gateways/cloud/commands/:id — marks command EXECUTED', async () => {
    const { gateway, rawToken } = await createGatewayInDb('Exec Cmd GW');

    const cmd = await app.prisma.doorCommand.create({
      data: {
        doorId: DOOR_ID_1,
        command: 'UNLOCK',
        gatewayId: gateway.id,
        issuedBy: SEED.users.operator.id,
        issuedByType: 'STAFF',
        status: 'PENDING',
        retryCount: 0,
        maxRetries: 3,
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/cloud/commands/${cmd.id}`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { status: 'EXECUTED' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('EXECUTED');
    expect(body.executedAt).not.toBeNull();
  });

  it('PUT /api/v1/gateways/cloud/commands/:id — auto-retries on FAILED if under max retries', async () => {
    const { gateway, rawToken } = await createGatewayInDb('Auto Retry GW');

    const cmd = await app.prisma.doorCommand.create({
      data: {
        doorId: DOOR_ID_1,
        command: 'LOCK',
        gatewayId: gateway.id,
        issuedBy: SEED.users.operator.id,
        issuedByType: 'STAFF',
        status: 'PENDING',
        retryCount: 0,
        maxRetries: 3,
      },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/gateways/cloud/commands/${cmd.id}`,
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { status: 'FAILED', failureReason: 'BLE connection lost' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Auto-retried: status goes back to PENDING with incremented retryCount
    expect(body.status).toBe('PENDING');
    expect(body.retryCount).toBe(1);
    expect(body.failureReason).toBeNull();
  });

  it('POST /api/v1/gateways/cloud/sync — logs state sync', async () => {
    const { gateway: gw1, rawToken } = await createGatewayInDb('Sync Source GW');
    const { gateway: gw2 } = await createGatewayInDb('Sync Target GW');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/sync',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: {
        sourceGatewayId: gw1.id,
        targetGatewayId: gw2.id,
        syncType: 'FULL',
        payloadSizeBytes: 4096,
        syncDurationMs: 150,
        success: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);

    // Verify sync record was created
    const syncs = await app.prisma.gatewayStateSync.findMany({
      where: { sourceGatewayId: gw1.id },
    });
    expect(syncs.length).toBeGreaterThanOrEqual(1);
    expect(syncs[0].syncType).toBe('FULL');
    expect(syncs[0].success).toBe(true);
  });
});

// ============================================================================
// 7. Failover & Recovery
// ============================================================================
describe('Failover & Recovery', () => {
  it('POST /api/v1/gateways/cloud/failover/notify — creates failover event', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Failover Failed GW');
    const { gateway: gw2, rawToken } = await createGatewayInDb('Failover Assuming GW');

    // Pair them
    await app.prisma.gateway.update({
      where: { id: gw1.id },
      data: { partnerId: gw2.id, clusterMode: 'ACTIVE_PASSIVE', clusterRole: 'PRIMARY_GW' },
    });
    await app.prisma.gateway.update({
      where: { id: gw2.id },
      data: { partnerId: gw1.id, clusterMode: 'ACTIVE_PASSIVE', clusterRole: 'SECONDARY_GW' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/failover/notify',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: {
        siteId: SITE_ID,
        failedGatewayId: gw1.id,
        assumingGatewayId: gw2.id,
        reason: 'HEARTBEAT_TIMEOUT',
        devicesTransferred: 5,
        incidentActiveAtTime: false,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);

    // Verify failed gateway is OFFLINE, assuming is ASSUMED_PRIMARY
    const failed = await app.prisma.gateway.findUnique({ where: { id: gw1.id } });
    const assuming = await app.prisma.gateway.findUnique({ where: { id: gw2.id } });
    expect(failed!.status).toBe('OFFLINE_GW');
    expect(assuming!.clusterRole).toBe('ASSUMED_PRIMARY');

    // Verify failover event created
    const events = await app.prisma.gatewayFailoverEvent.findMany({
      where: { failedGatewayId: gw1.id },
    });
    expect(events.length).toBe(1);
    expect(events[0].failoverType).toBe('AUTOMATIC');
    expect(events[0].devicesTransferred).toBe(5);
  });

  it('POST /api/v1/gateways/cloud/failover/complete — marks failover completed', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Complete Failed GW');
    const { gateway: gw2, rawToken } = await createGatewayInDb('Complete Assuming GW');

    const failoverEvent = await app.prisma.gatewayFailoverEvent.create({
      data: {
        siteId: SITE_ID,
        failedGatewayId: gw1.id,
        assumingGatewayId: gw2.id,
        failoverType: 'AUTOMATIC',
        reason: 'HEARTBEAT_TIMEOUT',
        devicesTransferred: 3,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/failover/complete',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: {
        failoverEventId: failoverEvent.id,
        durationMs: 2500,
        devicesAssumed: 3,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);

    const updated = await app.prisma.gatewayFailoverEvent.findUnique({
      where: { id: failoverEvent.id },
    });
    expect(updated!.failoverCompletedAt).not.toBeNull();
    expect(updated!.durationMs).toBe(2500);
  });

  it('POST /api/v1/gateways/cloud/recovery — gateway recovers, devices rebalanced', async () => {
    const { gateway: gw1, rawToken: gw1Token } = await createGatewayInDb('Recovery GW 1', {
      status: 'OFFLINE_GW',
      clusterRole: 'PRIMARY_GW',
      clusterMode: 'ACTIVE_PASSIVE',
    });
    const { gateway: gw2 } = await createGatewayInDb('Recovery GW 2', {
      status: 'ONLINE_GW',
      clusterRole: 'ASSUMED_PRIMARY',
      clusterMode: 'ACTIVE_PASSIVE',
      assignedDevices: [DOOR_ID_1, DOOR_ID_2],
    });

    // Set up pairing
    await app.prisma.gateway.update({
      where: { id: gw1.id },
      data: { partnerId: gw2.id },
    });
    await app.prisma.gateway.update({
      where: { id: gw2.id },
      data: { partnerId: gw1.id },
    });

    // Create an open failover event
    await app.prisma.gatewayFailoverEvent.create({
      data: {
        siteId: SITE_ID,
        failedGatewayId: gw1.id,
        assumingGatewayId: gw2.id,
        failoverType: 'AUTOMATIC',
        reason: 'HEARTBEAT_TIMEOUT',
        devicesTransferred: 2,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/gateways/cloud/recovery',
      headers: { authorization: `Bearer ${gw1Token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.rebalanced).toBe(true);

    // Verify gw1 is back ONLINE with rebalanced devices
    const updated1 = await app.prisma.gateway.findUnique({ where: { id: gw1.id } });
    expect(updated1!.status).toBe('ONLINE_GW');
    expect(updated1!.clusterState).toBe('HEALTHY_GW');
    expect(updated1!.assignedDevices.length).toBeGreaterThanOrEqual(1);

    // Verify failover event was closed
    const events = await app.prisma.gatewayFailoverEvent.findMany({
      where: { failedGatewayId: gw1.id },
    });
    expect(events[0].recoveredAt).not.toBeNull();
  });

  it('POST /api/v1/gateways/:id/planned-failover — initiates planned failover', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Planned Failover GW 1', {
      assignedDevices: [DOOR_ID_1, DOOR_ID_2],
    });
    const { gateway: gw2 } = await createGatewayInDb('Planned Failover GW 2');

    // Pair them
    await app.prisma.gateway.update({
      where: { id: gw1.id },
      data: { partnerId: gw2.id, clusterMode: 'ACTIVE_PASSIVE', clusterRole: 'PRIMARY_GW' },
    });
    await app.prisma.gateway.update({
      where: { id: gw2.id },
      data: { partnerId: gw1.id, clusterMode: 'ACTIVE_PASSIVE', clusterRole: 'SECONDARY_GW' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw1.id}/planned-failover`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Firmware upgrade' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.failoverType).toBe('MANUAL');
    expect(body.failedGatewayId).toBe(gw1.id);
    expect(body.assumingGatewayId).toBe(gw2.id);
    expect(body.devicesTransferred).toBe(2);

    // Verify gw1 is OFFLINE, gw2 has all devices
    const updated1 = await app.prisma.gateway.findUnique({ where: { id: gw1.id } });
    const updated2 = await app.prisma.gateway.findUnique({ where: { id: gw2.id } });
    expect(updated1!.status).toBe('OFFLINE_GW');
    expect(updated1!.clusterState).toBe('FAILOVER_GW');
    expect(updated1!.assignedDevices).toEqual([]);
    expect(updated2!.clusterRole).toBe('ASSUMED_PRIMARY');
    expect(updated2!.assignedDevices).toContain(DOOR_ID_1);
    expect(updated2!.assignedDevices).toContain(DOOR_ID_2);
  });

  it('POST /api/v1/gateways/:id/planned-failover/complete — completes planned failover, rebalances', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Complete PF GW 1', {
      status: 'OFFLINE_GW',
      clusterState: 'FAILOVER_GW',
      clusterRole: 'PRIMARY_GW',
      clusterMode: 'ACTIVE_PASSIVE',
      assignedDevices: [],
    });
    const { gateway: gw2 } = await createGatewayInDb('Complete PF GW 2', {
      status: 'ONLINE_GW',
      clusterState: 'FAILOVER_GW',
      clusterRole: 'ASSUMED_PRIMARY',
      clusterMode: 'ACTIVE_PASSIVE',
      assignedDevices: [DOOR_ID_1, DOOR_ID_2],
    });

    // Pair
    await app.prisma.gateway.update({
      where: { id: gw1.id },
      data: { partnerId: gw2.id },
    });
    await app.prisma.gateway.update({
      where: { id: gw2.id },
      data: { partnerId: gw1.id },
    });

    // Create open failover event
    await app.prisma.gatewayFailoverEvent.create({
      data: {
        siteId: SITE_ID,
        failedGatewayId: gw1.id,
        assumingGatewayId: gw2.id,
        failoverType: 'MANUAL',
        reason: 'PLANNED_MAINTENANCE',
        devicesTransferred: 2,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/gateways/${gw1.id}/planned-failover/complete`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);

    // Verify gw1 back online, devices rebalanced
    const updated1 = await app.prisma.gateway.findUnique({ where: { id: gw1.id } });
    const updated2 = await app.prisma.gateway.findUnique({ where: { id: gw2.id } });
    expect(updated1!.status).toBe('ONLINE_GW');
    expect(updated1!.clusterState).toBe('HEALTHY_GW');
    expect(updated2!.clusterState).toBe('HEALTHY_GW');
    // Devices should be split between the two gateways
    const totalDevices = updated1!.assignedDevices.length + updated2!.assignedDevices.length;
    expect(totalDevices).toBe(2);
  });
});

// ============================================================================
// 8. Health Check
// ============================================================================
describe('Health Check', () => {
  it('GET /api/v1/gateways/cluster/status — returns cluster overview', async () => {
    await createGatewayInDb('Cluster Status GW');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways/cluster/status?siteId=${SITE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.siteId).toBe(SITE_ID);
    expect(body.gateways).toBeDefined();
    expect(Array.isArray(body.gateways)).toBe(true);
    expect(typeof body.gatewayCount).toBe('number');
    expect(typeof body.onlineCount).toBe('number');
    expect(body.gatewayCount).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/v1/gateways/cluster/health-check — detects stale heartbeats', async () => {
    // Create a gateway with a very old heartbeat
    const staleDate = new Date(Date.now() - 60000); // 60s ago — well past the 5s threshold
    await createGatewayInDb('Stale HB GW', {
      lastHeartbeatAt: staleDate,
      status: 'ONLINE_GW',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways/cluster/health-check?siteId=${SITE_ID}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);

    const staleGw = body.find((g: any) => g.name === 'Stale HB GW');
    expect(staleGw).toBeDefined();
    expect(staleGw.isStale).toBe(true);
    expect(staleGw.status).toBe('DEGRADED_STATUS_GW');
  });

  it('GET /api/v1/gateways/:id/sync-history — returns sync records', async () => {
    const { gateway: gw1 } = await createGatewayInDb('Sync History GW 1');
    const { gateway: gw2 } = await createGatewayInDb('Sync History GW 2');

    // Create sync records
    await app.prisma.gatewayStateSync.create({
      data: {
        sourceGatewayId: gw1.id,
        targetGatewayId: gw2.id,
        syncType: 'INCREMENTAL',
        payloadSizeBytes: 1024,
        syncDurationMs: 50,
        success: true,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/gateways/${gw1.id}/sync-history`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].syncType).toBe('INCREMENTAL');
    expect(body[0].success).toBe(true);
    expect(body[0]).toHaveProperty('sourceGateway');
    expect(body[0]).toHaveProperty('targetGateway');
  });
});
