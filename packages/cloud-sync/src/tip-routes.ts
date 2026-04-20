// @ts-nocheck
/**
 * Anonymous Tip Line Routes (SafeSchool)
 *
 * Two-way anonymous tip submission and management system.
 * Students/staff can report safety concerns anonymously.
 *
 * Tenant scoping:
 *   - Admin routes (GET /tips, /tips/stats, POST /tips/:id/*) are JWT-scoped.
 *   - Public /tips/submit binds to the tenant in one of three ways (in order):
 *       1. Signed `?orgId=X&token=Y` URL (HMAC with TIP_SIGNING_SECRET), so
 *          the dashboard can mint per-tenant submission links.
 *       2. TIP_SUBMISSION_ORG env var, for single-tenant deploys where every
 *          submission is pinned server-side to one school.
 *       3. DASHBOARD_ADMIN_ORG / 'default', as a last-resort fallback for dev.
 *     Caller-supplied `orgId` in the BODY is ignored — only a valid signed
 *     token can override server binding.
 *
 * Routes:
 *   POST   /tips/submit           — Submit tip (public, HMAC or env-bound)
 *   GET    /tips/token            — Mint a signed submission token (JWT-gated)
 *   GET    /tips                  — List tips with filtering (admin, scoped)
 *   GET    /tips/:id              — Get tip detail (scoped)
 *   POST   /tips/:id/respond      — Send response to tipster (scoped)
 *   POST   /tips/:id/assign       — Assign to investigator (scoped)
 *   POST   /tips/:id/resolve      — Resolve tip (scoped)
 *   GET    /tips/stats            — Stats (scoped)
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import { getUsername, getOrgId } from './route-helpers.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import pg from 'pg';

const log = createLogger('cloud-sync:tips');

const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

export interface TipRoutesOptions {
  connectionString?: string;
}

const VALID_CATEGORIES = ['bullying', 'weapons', 'drugs', 'threat', 'self_harm', 'abuse', 'vandalism', 'other'];
const VALID_STATUSES = ['new', 'reviewing', 'investigating', 'resolved', 'dismissed'];
const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];

function generateTipNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 9999) + 1;
  return `TIP-${year}-${String(seq).padStart(4, '0')}`;
}

function autoPriority(category: string): string {
  if (category === 'weapons' || category === 'threat' || category === 'self_harm') return 'critical';
  if (category === 'abuse' || category === 'drugs') return 'high';
  if (category === 'bullying') return 'medium';
  return 'low';
}

/** HMAC-signed submission token. Day-bucketed, same pattern as widget tokens. */
function verifyTipToken(orgId: string | undefined, token: string | undefined): string | null {
  const secret = process.env.TIP_SIGNING_SECRET;
  if (!secret || !orgId || !token) return null;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  for (const day of [today, yesterday]) {
    const expected = crypto.createHmac('sha256', secret).update(`${orgId}:${day}`).digest('base64url');
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(token);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return orgId;
    } catch { /* fall through */ }
  }
  return null;
}

function signTipToken(orgId: string): string | null {
  const secret = process.env.TIP_SIGNING_SECRET;
  if (!secret) return null;
  const today = new Date().toISOString().slice(0, 10);
  return crypto.createHmac('sha256', secret).update(`${orgId}:${today}`).digest('base64url');
}

async function ensureTipsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`ALTER TABLE tips ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
  await pool.query(`UPDATE tips SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tips_org ON tips(org_id)`).catch(() => {});
}

export async function tipRoutes(fastify: FastifyInstance, opts: TipRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — tip routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  let tableMigrated = false;
  async function ensureTable() {
    if (tableMigrated) return;
    await ensureTipsTable(pool);
    tableMigrated = true;
  }

  // ─── GET /tips/token — Mint a signed submission token (JWT-gated) ────
  fastify.get('/tips/token', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user?.orgId) {
      return reply.code(401).send({ error: 'JWT required to mint tip token' });
    }
    const token = signTipToken(user.orgId);
    if (!token) {
      return reply.code(503).send({ error: 'TIP_SIGNING_SECRET is not configured on this deployment' });
    }
    return reply.send({ orgId: user.orgId, token, valid_for_hours: 48 });
  });

  // ─── POST /tips/submit — Public endpoint ───────────────────────
  // Tenant is derived server-side from, in order: signed token → env var →
  // default. Body-supplied org_id is deliberately ignored (an anonymous
  // tipster must not be able to inject into an arbitrary tenant's queue).
  fastify.post('/tips/submit', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const body = request.body as any;
    if (!body?.message) {
      return reply.code(400).send({ error: 'message is required' });
    }

    const q = request.query as { orgId?: string; token?: string };
    const signedOrg = verifyTipToken(q.orgId, q.token);
    const envOrg = process.env.TIP_SUBMISSION_ORG;
    const orgId = signedOrg || envOrg || DEFAULT_ORG;

    const category = VALID_CATEGORIES.includes(body.category) ? body.category : 'other';
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let tipNumber = generateTipNumber();
    const existing = await pool.query(
      'SELECT id FROM tips WHERE tip_number = $1 AND org_id = $2',
      [tipNumber, orgId]
    );
    if (existing.rows.length > 0) {
      tipNumber = `TIP-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999) + 1).padStart(5, '0')}`;
    }

    const isAnonymous = body.anonymous !== false && body.anonymous !== 0;

    const tip = {
      id,
      org_id: orgId,
      tip_number: tipNumber,
      category,
      message: body.message,
      anonymous: isAnonymous ? 1 : 0,
      reporter_name: isAnonymous ? null : (body.reporter_name || null),
      reporter_contact: isAnonymous ? null : (body.reporter_contact || null),
      status: 'new',
      priority: VALID_PRIORITIES.includes(body.priority) ? body.priority : autoPriority(category),
      assigned_to: null,
      location: body.location || null,
      response_message: null,
      responded_at: null,
      responded_by: null,
      created_at: now,
      updated_at: now,
    };

    try {
      await pool.query(
        `INSERT INTO tips (id, org_id, tip_number, category, message, anonymous, reporter_name, reporter_contact,
         status, priority, assigned_to, location, response_message, responded_at, responded_by,
         created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [tip.id, tip.org_id, tip.tip_number, tip.category, tip.message, tip.anonymous,
         tip.reporter_name, tip.reporter_contact, tip.status, tip.priority,
         tip.assigned_to, tip.location, tip.response_message, tip.responded_at,
         tip.responded_by, tip.created_at, tip.updated_at]
      );
    } catch (err) {
      log.error({ err }, 'Failed to submit tip');
      return reply.code(500).send({ error: 'Failed to submit tip' });
    }

    log.info({ tipNumber, orgId, category, priority: tip.priority }, 'Tip submitted');
    return reply.code(201).send({
      tip_number: tipNumber,
      message: 'Your tip has been submitted. Save your tip number to check for responses.',
    });
  });

  // ─── GET /tips — List with filters (admin, tenant-scoped) ───────

  fastify.get('/tips', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const conditions: string[] = ['org_id = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (q.status) {
      conditions.push(`status = $${idx++}`);
      params.push(q.status);
    }
    if (q.priority) {
      conditions.push(`priority = $${idx++}`);
      params.push(q.priority);
    }
    if (q.category) {
      conditions.push(`category = $${idx++}`);
      params.push(q.category);
    }
    if (q.assigned_to) {
      conditions.push(`assigned_to = $${idx++}`);
      params.push(q.assigned_to);
    }
    if (q.search) {
      conditions.push(`(message ILIKE $${idx} OR tip_number ILIKE $${idx} OR location ILIKE $${idx})`);
      params.push(`%${q.search}%`);
      idx++;
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM tips ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT * FROM tips ${where} ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ tips: dataRes.rows, total, limit, offset });
  });

  // ─── GET /tips/stats — Dashboard stats (tenant-scoped) ──────────

  fastify.get('/tips/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const [statusRes, categoryRes, responseRes, avgTimeRes] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count FROM tips WHERE org_id = $1 GROUP BY status`, [orgId]),
      pool.query(`SELECT category, COUNT(*) as count FROM tips WHERE org_id = $1 GROUP BY category ORDER BY count DESC`, [orgId]),
      pool.query(`SELECT COUNT(*) FILTER (WHERE response_message IS NOT NULL) as responded, COUNT(*) as total FROM tips WHERE org_id = $1`, [orgId]),
      pool.query(`SELECT AVG(EXTRACT(EPOCH FROM (responded_at::timestamp - created_at::timestamp))) as avg_seconds FROM tips WHERE org_id = $1 AND responded_at IS NOT NULL`, [orgId]),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusRes.rows) byStatus[row.status] = parseInt(row.count);

    const byCategory: Record<string, number> = {};
    for (const row of categoryRes.rows) byCategory[row.category] = parseInt(row.count);

    const responded = parseInt(responseRes.rows[0]?.responded || '0');
    const totalTips = parseInt(responseRes.rows[0]?.total || '0');
    const responseRate = totalTips > 0 ? Math.round((responded / totalTips) * 100) : 0;

    const avgResponseSeconds = parseFloat(avgTimeRes.rows[0]?.avg_seconds || '0');
    const avgResponseMinutes = Math.round(avgResponseSeconds / 60);

    return reply.send({
      newTips: byStatus.new || 0,
      reviewing: byStatus.reviewing || 0,
      investigating: byStatus.investigating || 0,
      resolved: byStatus.resolved || 0,
      dismissed: byStatus.dismissed || 0,
      responseRate,
      avgResponseMinutes,
      byStatus,
      byCategory,
      total: totalTips,
    });
  });

  // ─── GET /tips/:id — Tip detail (tenant-scoped) ────────────────

  fastify.get('/tips/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query('SELECT * FROM tips WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (res.rows.length === 0) {
      return reply.code(404).send({ error: 'Tip not found' });
    }
    return reply.send(res.rows[0]);
  });

  // ─── POST /tips/:id/respond (tenant-scoped) ────────────────────

  fastify.post('/tips/:id/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const message = body?.message || body?.response_message;
    if (!message) {
      return reply.code(400).send({ error: 'message is required' });
    }

    const existing = await pool.query('SELECT * FROM tips WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Tip not found' });
    }

    const now = new Date().toISOString();
    const user = getUsername(request);

    await pool.query(
      `UPDATE tips SET response_message = $1, responded_at = $2, responded_by = $3,
       status = CASE WHEN status = 'new' THEN 'reviewing' ELSE status END,
       updated_at = $2 WHERE id = $4 AND org_id = $5`,
      [message, now, user, id, orgId]
    );

    const updated = await pool.query('SELECT * FROM tips WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /tips/:id/assign (tenant-scoped) ─────────────────────

  fastify.post('/tips/:id/assign', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const assignTo = body?.assigned_to;
    if (!assignTo) {
      return reply.code(400).send({ error: 'assigned_to is required' });
    }

    const existing = await pool.query('SELECT id FROM tips WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Tip not found' });
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE tips SET assigned_to = $1, status = CASE WHEN status IN ('new','reviewing') THEN 'investigating' ELSE status END,
       updated_at = $2 WHERE id = $3 AND org_id = $4`,
      [assignTo, now, id, orgId]
    );

    const updated = await pool.query('SELECT * FROM tips WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /tips/:id/resolve (tenant-scoped) ────────────────────

  fastify.post('/tips/:id/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const status = body?.status === 'dismissed' ? 'dismissed' : 'resolved';

    const existing = await pool.query('SELECT id FROM tips WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Tip not found' });
    }

    const now = new Date().toISOString();
    const user = getUsername(request);

    await pool.query(
      `UPDATE tips SET status = $1, updated_at = $2 WHERE id = $3 AND org_id = $4`,
      [status, now, id, orgId]
    );

    if (body?.message || body?.resolution_notes) {
      await pool.query(
        `UPDATE tips SET response_message = COALESCE(response_message || E'\n', '') || $1,
         responded_at = $2, responded_by = $3 WHERE id = $4 AND org_id = $5`,
        [(body.message || body.resolution_notes), now, user, id, orgId]
      );
    }

    const updated = await pool.query('SELECT * FROM tips WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  log.info('Tip line routes registered');
}
