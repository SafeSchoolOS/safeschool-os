/**
 * Account Management Routes
 *
 * SaaS multi-tenancy: create/manage customer accounts, sites, and user assignments.
 * Mount at prefix '/api/v1/accounts'.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
// pg types — use inline interface to avoid @types/pg dependency
interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

const log = createLogger('cloud-sync:account-routes');

export interface AccountRoutesOptions {
  pool: PgPool;
  getAccountId?: (request: FastifyRequest) => string | undefined;
}

export async function accountRoutes(fastify: FastifyInstance, options: AccountRoutesOptions) {
  const { pool, getAccountId } = options;

  // ─── GET /me — Get current account ─────────────────────────────

  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = getAccountId?.(request);
    if (!accountId) return reply.code(401).send({ error: 'No account context' });

    try {
      const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Account not found' });

      const account = rows[0];
      // Get site count and device count
      const sites = await pool.query('SELECT COUNT(*) as count FROM account_sites WHERE account_id = $1', [accountId]);
      const devices = await pool.query('SELECT COUNT(*) as count FROM sync_devices WHERE org_id = $1', [accountId]);
      const users = await pool.query('SELECT COUNT(*) as count FROM sync_users WHERE org_id = $1', [accountId]);

      return reply.send({
        ...account,
        usage: {
          sites: parseInt(String(sites.rows[0].count)),
          devices: parseInt(String(devices.rows[0].count)),
          users: parseInt(String(users.rows[0].count)),
        },
      });
    } catch (err) {
      log.error({ err }, 'Failed to get account');
      return reply.code(500).send({ error: 'Failed to get account' });
    }
  });

  // ─── PUT /me — Update account settings ─────────────────────────

  fastify.put('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = getAccountId?.(request);
    if (!accountId) return reply.code(401).send({ error: 'No account context' });

    const body = request.body as { account_name?: string; billing_email?: string; settings?: Record<string, unknown> };

    try {
      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let idx = 1;

      if (body.account_name) { sets.push(`account_name = $${idx++}`); params.push(body.account_name); }
      if (body.billing_email) { sets.push(`billing_email = $${idx++}`); params.push(body.billing_email); }
      if (body.settings) { sets.push(`settings = settings || $${idx++}::jsonb`); params.push(JSON.stringify(body.settings)); }

      params.push(accountId);
      await pool.query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = $${idx}`, params);

      const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to update account');
      return reply.code(500).send({ error: 'Failed to update account' });
    }
  });

  // ─── GET /me/sites — List sites ────────────────────────────────

  fastify.get('/me/sites', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = getAccountId?.(request);
    if (!accountId) return reply.code(401).send({ error: 'No account context' });

    try {
      const { rows } = await pool.query(
        'SELECT * FROM account_sites WHERE account_id = $1 ORDER BY site_name',
        [accountId],
      );

      // Attach device counts per site
      const sites = await Promise.all(rows.map(async (site: Record<string, unknown>) => {
        const devices = await pool.query(
          'SELECT COUNT(*) as count FROM sync_devices WHERE org_id = $1 AND account_site_id = $2',
          [accountId, String(site.id)],
        );
        return { ...site, device_count: parseInt(String(devices.rows[0].count)) };
      }));

      return reply.send({ sites, total: sites.length });
    } catch (err) {
      log.error({ err }, 'Failed to list sites');
      return reply.code(500).send({ error: 'Failed to list sites' });
    }
  });

  // ─── POST /me/sites — Create a site ───────────────────────────

  fastify.post('/me/sites', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = getAccountId?.(request);
    if (!accountId) return reply.code(401).send({ error: 'No account context' });

    const body = request.body as {
      site_name: string; site_code?: string; address?: string; city?: string;
      state?: string; country?: string; latitude?: number; longitude?: number;
      timezone?: string; site_type?: string; region?: string;
    };

    if (!body.site_name) return reply.code(400).send({ error: 'site_name is required' });

    try {
      // Check plan limits
      const account = await pool.query('SELECT max_sites FROM accounts WHERE id = $1', [accountId]);
      const siteCount = await pool.query('SELECT COUNT(*) as count FROM account_sites WHERE account_id = $1', [accountId]);
      const maxSites = Number(account.rows[0]?.max_sites) || 1;
      const currentSites = parseInt(String(siteCount.rows[0].count));

      if (currentSites >= maxSites) {
        return reply.code(402).send({
          error: `Site limit reached (${currentSites}/${maxSites}). Upgrade your plan to add more sites.`,
        });
      }

      const id = crypto.randomUUID();
      await pool.query(`
        INSERT INTO account_sites (id, account_id, site_name, site_code, address, city, state, country, latitude, longitude, timezone, site_type, region)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [id, accountId, body.site_name, body.site_code || null, body.address || null, body.city || null,
          body.state || null, body.country || null, body.latitude || null, body.longitude || null,
          body.timezone || null, body.site_type || 'building', body.region || null]);

      const { rows } = await pool.query('SELECT * FROM account_sites WHERE id = $1', [id]);
      log.info({ accountId, siteId: id, siteName: body.site_name }, 'Site created');
      return reply.code(201).send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to create site');
      return reply.code(500).send({ error: 'Failed to create site' });
    }
  });

  // ─── PUT /me/sites/:siteId — Update a site ────────────────────

  fastify.put('/me/sites/:siteId', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = getAccountId?.(request);
    if (!accountId) return reply.code(401).send({ error: 'No account context' });

    const { siteId } = request.params as { siteId: string };
    const body = request.body as Record<string, unknown>;

    try {
      // Verify site belongs to account
      const existing = await pool.query('SELECT id FROM account_sites WHERE id = $1 AND account_id = $2', [siteId, accountId]);
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Site not found' });

      const allowedFields = ['site_name', 'site_code', 'address', 'city', 'state', 'country', 'latitude', 'longitude', 'timezone', 'site_type', 'region', 'status'];
      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let idx = 1;

      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          sets.push(`${field} = $${idx++}`);
          params.push(body[field]);
        }
      }

      params.push(siteId, accountId);
      await pool.query(`UPDATE account_sites SET ${sets.join(', ')} WHERE id = $${idx++} AND account_id = $${idx}`, params);

      const { rows } = await pool.query('SELECT * FROM account_sites WHERE id = $1', [siteId]);
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to update site');
      return reply.code(500).send({ error: 'Failed to update site' });
    }
  });

  // ─── DELETE /me/sites/:siteId — Delete a site ─────────────────

  fastify.delete('/me/sites/:siteId', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = getAccountId?.(request);
    if (!accountId) return reply.code(401).send({ error: 'No account context' });

    const { siteId } = request.params as { siteId: string };

    try {
      const result = await pool.query('DELETE FROM account_sites WHERE id = $1 AND account_id = $2', [siteId, accountId]);
      if (result.rowCount === 0) return reply.code(404).send({ error: 'Site not found' });

      log.info({ accountId, siteId }, 'Site deleted');
      return reply.send({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete site');
      return reply.code(500).send({ error: 'Failed to delete site' });
    }
  });

  // ─── GET /me/users — List users with site roles ───────────────

  fastify.get('/me/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = getAccountId?.(request);
    if (!accountId) return reply.code(401).send({ error: 'No account context' });

    try {
      const { rows: users } = await pool.query(
        'SELECT id, email, display_name, role, provider, created_at FROM sync_users WHERE org_id = $1 ORDER BY email',
        [accountId],
      );

      // Attach site roles per user
      const enriched = await Promise.all(users.map(async (user: Record<string, unknown>) => {
        const { rows: roles } = await pool.query(
          `SELECT usr.site_id, usr.role, s.site_name
           FROM user_site_roles usr
           JOIN account_sites s ON s.id = usr.site_id
           WHERE usr.user_id = $1 AND usr.account_id = $2`,
          [user.id, accountId],
        );
        return { ...user, site_roles: roles };
      }));

      return reply.send({ users: enriched, total: enriched.length });
    } catch (err) {
      log.error({ err }, 'Failed to list users');
      return reply.code(500).send({ error: 'Failed to list users' });
    }
  });

  // ─── POST /me/users/:userId/sites — Assign user to site ───────

  fastify.post('/me/users/:userId/sites', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = getAccountId?.(request);
    if (!accountId) return reply.code(401).send({ error: 'No account context' });

    const { userId } = request.params as { userId: string };
    const body = request.body as { site_id: string; role?: string };

    if (!body.site_id) return reply.code(400).send({ error: 'site_id is required' });

    try {
      // Verify user belongs to account
      const user = await pool.query('SELECT id FROM sync_users WHERE id = $1 AND org_id = $2', [userId, accountId]);
      if (user.rows.length === 0) return reply.code(404).send({ error: 'User not found' });

      // Verify site belongs to account
      const site = await pool.query('SELECT id FROM account_sites WHERE id = $1 AND account_id = $2', [body.site_id, accountId]);
      if (site.rows.length === 0) return reply.code(404).send({ error: 'Site not found' });

      const id = crypto.randomUUID();
      const role = body.role || 'viewer';
      await pool.query(`
        INSERT INTO user_site_roles (id, user_id, account_id, site_id, role)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, site_id) DO UPDATE SET role = $5
      `, [id, userId, accountId, body.site_id, role]);

      return reply.code(201).send({ ok: true, userId, site_id: body.site_id, role });
    } catch (err) {
      log.error({ err }, 'Failed to assign user to site');
      return reply.code(500).send({ error: 'Failed to assign user to site' });
    }
  });

  // ─── DELETE /me/users/:userId/sites/:siteId — Remove site role ─

  fastify.delete('/me/users/:userId/sites/:siteId', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountId = getAccountId?.(request);
    if (!accountId) return reply.code(401).send({ error: 'No account context' });

    const { userId, siteId } = request.params as { userId: string; siteId: string };

    try {
      await pool.query(
        'DELETE FROM user_site_roles WHERE user_id = $1 AND site_id = $2 AND account_id = $3',
        [userId, siteId, accountId],
      );
      return reply.send({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to remove site role');
      return reply.code(500).send({ error: 'Failed to remove site role' });
    }
  });

  // ─── POST / — Create account (admin/signup) ───────────────────

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      account_name: string; slug?: string; billing_email?: string;
      products?: string[]; plan?: string; account_type?: string;
    };

    if (!body.account_name) return reply.code(400).send({ error: 'account_name is required' });

    const id = crypto.randomUUID();
    const slug = body.slug || body.account_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    try {
      await pool.query(`
        INSERT INTO accounts (id, account_name, slug, billing_email, products, plan, account_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [id, body.account_name, slug, body.billing_email || null,
          body.products || ['safeschool'], body.plan || 'free', body.account_type || 'standard']);

      const { rows } = await pool.query('SELECT * FROM accounts WHERE id = $1', [id]);
      log.info({ accountId: id, name: body.account_name, slug }, 'Account created');
      return reply.code(201).send(rows[0]);
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'An account with this slug already exists' });
      }
      log.error({ err }, 'Failed to create account');
      return reply.code(500).send({ error: 'Failed to create account' });
    }
  });
}
