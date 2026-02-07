import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer } from '../../__tests__/setup.js';
import { authenticateAs, SEED } from '../../__tests__/helpers.js';

describe('Auth Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns token and user for valid email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@lincoln.edu' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBeTruthy();
      expect(body.user.email).toBe('admin@lincoln.edu');
      expect(body.user.role).toBe('SITE_ADMIN');
      expect(body.user.siteIds).toContain(SEED.siteId);
    });

    it('returns 401 for unknown email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'unknown@example.com' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when email is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns current user with valid token', async () => {
      const token = await authenticateAs(app, 'admin');

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.id).toBe(SEED.users.admin.id);
      expect(body.email).toBe('admin@lincoln.edu');
      expect(body.name).toBe('Dr. Sarah Mitchell');
      expect(body.role).toBe('SITE_ADMIN');
      expect(body.isActive).toBe(true);
    });

    it('returns 401 without auth header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer invalid-token' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('works for all seed roles', async () => {
      for (const role of ['admin', 'operator', 'teacher1', 'responder'] as const) {
        const token = await authenticateAs(app, role);
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.role).toBe(SEED.users[role].role);
      }
    });
  });
});
