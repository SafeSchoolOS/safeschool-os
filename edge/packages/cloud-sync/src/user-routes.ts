/**
 * User Management Routes
 *
 * Fastify plugin for managing dashboard users (CRUD + CSV import).
 * Mount behind JWT auth at prefix '/api/v1/users'.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import type { UserDatabaseAdapter, OAuthProvider } from './types.js';

const log = createLogger('cloud-sync:user-routes');

const VALID_ROLES = ['admin', 'editor', 'viewer'];

export interface UserRoutesOptions {
  adapter: UserDatabaseAdapter;
  getOrgId?: (request: FastifyRequest) => string | undefined;
}

export async function userRoutes(fastify: FastifyInstance, options: UserRoutesOptions) {
  const { adapter, getOrgId } = options;

  // ─── GET / — List users ───────────────────────────────────────

  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      let users = await adapter.listUsers(orgId);

      // Filter by role
      if (q.role) {
        users = users.filter(u => u.role === q.role);
      }

      // Pagination
      const limit = q.limit ? parseInt(q.limit, 10) : 100;
      const offset = q.offset ? parseInt(q.offset, 10) : 0;
      const total = users.length;
      const paged = users.slice(offset, offset + limit);

      return reply.send({ users: paged, total, limit, offset });
    } catch (err) {
      log.error({ err }, 'Failed to list users');
      return reply.code(500).send({ error: 'Failed to list users' });
    }
  });

  // ─── GET /:userId — Get single user ───────────────────────────

  fastify.get('/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { userId } = request.params as { userId: string };
      const user = await adapter.findById(userId);
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }
      // Org isolation
      if (orgId && user.orgId !== orgId) {
        return reply.code(404).send({ error: 'User not found' });
      }
      return reply.send(user);
    } catch (err) {
      log.error({ err }, 'Failed to get user');
      return reply.code(500).send({ error: 'Failed to get user' });
    }
  });

  // ─── POST / — Create user ────────────────────────────────────

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const body = request.body as { email?: string; displayName?: string; role?: string; provider?: string };

      if (!body.email) {
        return reply.code(400).send({ error: 'email is required' });
      }

      if (body.role && !VALID_ROLES.includes(body.role)) {
        return reply.code(400).send({ error: `Invalid role. Valid: ${VALID_ROLES.join(', ')}` });
      }

      const user = await adapter.upsertUser({
        email: body.email,
        displayName: body.displayName,
        provider: (body.provider as OAuthProvider) || 'password',
        orgId: orgId || 'default',
        role: body.role || 'viewer',
      });

      return reply.code(201).send(user);
    } catch (err) {
      log.error({ err }, 'Failed to create user');
      return reply.code(500).send({ error: 'Failed to create user' });
    }
  });

  // ─── PUT /:userId — Update user ───────────────────────────────

  fastify.put('/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { userId } = request.params as { userId: string };
      const body = request.body as { displayName?: string; role?: string };

      const existing = await adapter.findById(userId);
      if (!existing) {
        return reply.code(404).send({ error: 'User not found' });
      }
      if (orgId && existing.orgId !== orgId) {
        return reply.code(404).send({ error: 'User not found' });
      }

      if (body.role && !VALID_ROLES.includes(body.role)) {
        return reply.code(400).send({ error: `Invalid role. Valid: ${VALID_ROLES.join(', ')}` });
      }

      // Update role if provided
      if (body.role) {
        await adapter.updateUserRole(userId, body.role);
      }

      // Update display name via upsert
      if (body.displayName !== undefined) {
        await adapter.upsertUser({
          email: existing.email,
          displayName: body.displayName,
          provider: existing.provider,
          orgId: existing.orgId,
          role: body.role || existing.role,
        });
      }

      const updated = await adapter.findById(userId);
      return reply.send(updated);
    } catch (err) {
      log.error({ err }, 'Failed to update user');
      return reply.code(500).send({ error: 'Failed to update user' });
    }
  });

  // ─── DELETE /:userId — Delete user ────────────────────────────

  fastify.delete('/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { userId } = request.params as { userId: string };

      const existing = await adapter.findById(userId);
      if (!existing) {
        return reply.code(404).send({ error: 'User not found' });
      }
      if (orgId && existing.orgId !== orgId) {
        return reply.code(404).send({ error: 'User not found' });
      }

      await adapter.deleteUser(userId);
      return reply.send({ ok: true, userId });
    } catch (err) {
      log.error({ err }, 'Failed to delete user');
      return reply.code(500).send({ error: 'Failed to delete user' });
    }
  });

  // ─── POST /import — Bulk CSV import ──────────────────────────

  fastify.post('/import', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const body = request.body as { csv?: string };

      if (!body.csv) {
        return reply.code(400).send({ error: 'csv field is required (CSV string)' });
      }

      const lines = body.csv.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        return reply.code(400).send({ error: 'CSV must have a header row and at least one data row' });
      }

      // Parse header
      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const emailIdx = header.indexOf('email');
      if (emailIdx === -1) {
        return reply.code(400).send({ error: 'CSV must have an "email" column' });
      }
      const nameIdx = header.indexOf('name') !== -1 ? header.indexOf('name') : header.indexOf('displayname');
      const roleIdx = header.indexOf('role');

      let imported = 0;
      let errors = 0;
      const results: { email: string; status: string }[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        const email = cols[emailIdx];
        if (!email || !email.includes('@')) {
          errors++;
          results.push({ email: email || `row ${i}`, status: 'invalid email' });
          continue;
        }

        try {
          const role = roleIdx >= 0 && cols[roleIdx] ? cols[roleIdx] : 'viewer';
          if (!VALID_ROLES.includes(role)) {
            errors++;
            results.push({ email, status: `invalid role: ${role}` });
            continue;
          }

          await adapter.upsertUser({
            email,
            displayName: nameIdx >= 0 ? cols[nameIdx] : undefined,
            provider: 'password',
            orgId: orgId || 'default',
            role,
          });
          imported++;
          results.push({ email, status: 'ok' });
        } catch {
          errors++;
          results.push({ email, status: 'error' });
        }
      }

      return reply.send({ imported, errors, total: lines.length - 1, results });
    } catch (err) {
      log.error({ err }, 'Failed to import users');
      return reply.code(500).send({ error: 'Failed to import users' });
    }
  });

  // ─── GET /import/template — CSV template ─────────────────────

  fastify.get('/import/template', async (_request: FastifyRequest, reply: FastifyReply) => {
    const csv = 'email,name,role\njohn@example.com,John Doe,viewer\njane@example.com,Jane Smith,admin\n';
    return reply.type('text/csv')
      .header('Content-Disposition', 'attachment; filename="user-import-template.csv"')
      .send(csv);
  });
}
