import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from '../../__tests__/setup.js';
import { authenticateAs, createTestAlert, SEED } from '../../__tests__/helpers.js';

describe('Alert Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildTestServer();
    token = await authenticateAs(app, 'admin');
  });

  afterEach(async () => {
    await cleanupTestData(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/alerts', () => {
    it('creates a MEDICAL alert', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          level: 'MEDICAL',
          buildingId: SEED.buildings.mainId,
          message: 'Test medical alert',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.level).toBe('MEDICAL');
      expect(body.status).toBe('TRIGGERED');
      expect(body.siteId).toBe(SEED.siteId);
      expect(body.buildingName).toBe('Main Building');
      expect(body.triggeredById).toBe(SEED.users.admin.id);
    });

    it('creates an ACTIVE_THREAT alert with GPS coordinates', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          level: 'ACTIVE_THREAT',
          buildingId: SEED.buildings.mainId,
          roomId: SEED.rooms.room101,
          message: 'Threat detected',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.level).toBe('ACTIVE_THREAT');
      expect(body.latitude).toBeTruthy();
      expect(body.longitude).toBeTruthy();
      expect(body.roomName).toBe('Room 101');
    });

    it('returns 400 when level is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        headers: { authorization: `Bearer ${token}` },
        payload: { buildingId: SEED.buildings.mainId },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/alerts',
        payload: { level: 'MEDICAL', buildingId: SEED.buildings.mainId },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/alerts', () => {
    it('returns alerts for the user site', async () => {
      await createTestAlert(app, { level: 'MEDICAL' });
      await createTestAlert(app, { level: 'FIRE' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/alerts',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by status', async () => {
      await createTestAlert(app, { level: 'MEDICAL' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/alerts?status=TRIGGERED',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      for (const alert of body) {
        expect(alert.status).toBe('TRIGGERED');
      }
    });

    it('filters by level', async () => {
      await createTestAlert(app, { level: 'FIRE' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/alerts?level=FIRE',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.length).toBeGreaterThanOrEqual(1);
      for (const alert of body) {
        expect(alert.level).toBe('FIRE');
      }
    });
  });

  describe('GET /api/v1/alerts/:id', () => {
    it('returns alert detail with relations', async () => {
      const { body: created } = await createTestAlert(app);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/alerts/${created.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe(created.id);
      expect(body.dispatchRecords).toBeDefined();
      expect(body.lockdowns).toBeDefined();
    });

    it('returns 404 for non-existent alert', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/alerts/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/v1/alerts/:id', () => {
    it('acknowledges an alert', async () => {
      const { body: created } = await createTestAlert(app);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/alerts/${created.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'ACKNOWLEDGED' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('ACKNOWLEDGED');
      expect(body.acknowledgedById).toBe(SEED.users.admin.id);
    });

    it('resolves an alert', async () => {
      const { body: created } = await createTestAlert(app);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/alerts/${created.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'RESOLVED' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('RESOLVED');
      expect(body.resolvedAt).toBeTruthy();
    });

    it('cancels an alert', async () => {
      const { body: created } = await createTestAlert(app);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/alerts/${created.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'CANCELLED' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('CANCELLED');
    });

    it('returns 400 for invalid status', async () => {
      const { body: created } = await createTestAlert(app);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/alerts/${created.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'INVALID' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
