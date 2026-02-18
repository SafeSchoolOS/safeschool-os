import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from '../../__tests__/setup.js';
import { authenticateAs, SEED } from '../../__tests__/helpers.js';

describe('Lockdown Routes', () => {
  let app: FastifyInstance;
  let token: string;
  const originalMode = process.env.OPERATING_MODE;

  beforeAll(async () => {
    // Set edge mode so release tests work
    process.env.OPERATING_MODE = 'edge';
    app = await buildTestServer();
    token = await authenticateAs(app, 'admin');
  });

  afterEach(async () => {
    // Reset door statuses to LOCKED
    await app.prisma.door.updateMany({
      where: { siteId: SEED.siteId },
      data: { status: 'LOCKED' },
    });
    await cleanupTestData(app);
  });

  afterAll(async () => {
    process.env.OPERATING_MODE = originalMode;
    await app.close();
  });

  describe('POST /api/v1/lockdown', () => {
    it('initiates a building lockdown', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/lockdown',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          scope: 'BUILDING',
          targetId: SEED.buildings.mainId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.scope).toBe('BUILDING');
      expect(body.targetId).toBe(SEED.buildings.mainId);
      expect(body.siteId).toBe(SEED.siteId);
      expect(body.doorsLocked).toBeGreaterThan(0);
      expect(body.releasedAt).toBeNull();
    });

    it('returns 400 when scope is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/lockdown',
        headers: { authorization: `Bearer ${token}` },
        payload: { targetId: SEED.buildings.mainId },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/lockdown',
        payload: { scope: 'BUILDING', targetId: SEED.buildings.mainId },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/lockdown/:id', () => {
    it('releases a lockdown', async () => {
      // Create lockdown first
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/lockdown',
        headers: { authorization: `Bearer ${token}` },
        payload: { scope: 'BUILDING', targetId: SEED.buildings.mainId },
      });
      const lockdown = JSON.parse(createRes.body);

      // Release it
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/lockdown/${lockdown.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.releasedAt).toBeTruthy();
    });

    it('returns 400 when already released', async () => {
      // Create lockdown
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/lockdown',
        headers: { authorization: `Bearer ${token}` },
        payload: { scope: 'BUILDING', targetId: SEED.buildings.mainId },
      });
      expect(createRes.statusCode).toBe(201);
      const lockdown = JSON.parse(createRes.body);
      expect(lockdown.id).toBeTruthy();

      // Release it
      const releaseRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/lockdown/${lockdown.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(releaseRes.statusCode).toBe(200);

      // Try to release again — should get 400
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/lockdown/${lockdown.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent lockdown', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/lockdown/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/lockdown/active', () => {
    it('returns active lockdowns', async () => {
      // Create a lockdown
      await app.inject({
        method: 'POST',
        url: '/api/v1/lockdown',
        headers: { authorization: `Bearer ${token}` },
        payload: { scope: 'BUILDING', targetId: SEED.buildings.mainId },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/lockdown/active',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.operatingMode).toBeDefined();
      expect(body.lockdowns.length).toBeGreaterThanOrEqual(1);
      for (const lockdown of body.lockdowns) {
        expect(lockdown.releasedAt).toBeNull();
      }
    });
  });
});
