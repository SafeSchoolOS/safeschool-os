// @ts-nocheck — WIP: will fix types when wiring into runtime
/**
 * Panic Alert Routes (Alyssa's Law Compliance)
 *
 * Silent panic button system for SafeSchool and other products.
 * 11 states mandate silent panic buttons in schools.
 *
 * Provides:
 *   - POST   /panic/trigger         — Create a new panic alert (emergency, no JWT required)
 *   - GET    /panic/active          — Get all active (non-resolved) alerts
 *   - POST   /panic/:id/acknowledge — Acknowledge an alert
 *   - POST   /panic/:id/dispatch    — Mark as dispatched to first responders
 *   - POST   /panic/:id/resolve     — Resolve an alert
 *   - POST   /panic/:id/cancel      — Cancel a false alarm
 *   - GET    /panic/history         — Get historical alerts with date range filtering
 *   - POST   /panic/lockdown        — Trigger facility-wide lockdown
 *   - POST   /panic/all-clear       — End lockdown (resolve all active alerts)
 *
 * Tenant isolation: every row carries `org_id`. Reads filter by the caller's
 * JWT org; writes stamp it in. Legacy rows are backfilled to the default org
 * on first migration so single-tenant deployments keep working.
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:panic');

export interface PanicRoutesOptions {
  /** PostgreSQL connection string (defaults to DATABASE_URL) */
  connectionString?: string;
}

const VALID_ALERT_TYPES = ['panic', 'duress', 'medical', 'fire', 'lockdown'];
const VALID_STATUSES = ['active', 'acknowledged', 'dispatched', 'resolved', 'cancelled'];
const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

async function ensurePanicTable(pool: pg.Pool): Promise<void> {
  // Drop and recreate only if the `alert_type` column is genuinely missing (undefined_column, 42703).
  // Any other error (connection failure, permission, etc.) must NOT destroy the table.
  try {
    await pool.query('SELECT alert_type FROM panic_alerts LIMIT 0');
  } catch (err: any) {
    if (err?.code === '42703') {
      log.info('Recreating panic_alerts table (alert_type column missing)');
      await pool.query('DROP TABLE IF EXISTS panic_alerts CASCADE');
    } else if (err?.code === '42P01') {
      // undefined_table — normal first-run, fall through to CREATE TABLE IF NOT EXISTS
    } else {
      log.warn({ code: err?.code, err: err?.message }, 'panic_alerts probe failed — leaving table intact');
      throw err;
    }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS panic_alerts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG.replace(/'/g, "''")}',
      device_id TEXT,
      user_id TEXT,
      user_name TEXT,
      alert_type TEXT NOT NULL DEFAULT 'panic',
      location TEXT,
      latitude REAL,
      longitude REAL,
      status TEXT NOT NULL DEFAULT 'active',
      triggered_at TEXT NOT NULL,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      resolved_at TEXT,
      resolved_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    )
  `);
  // Backfill org_id column on tables created before multi-tenant isolation was added.
  await pool.query(`ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS org_id TEXT`);
  await pool.query(`UPDATE panic_alerts SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_panic_status ON panic_alerts (status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_panic_triggered ON panic_alerts (triggered_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_panic_type ON panic_alerts (alert_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_panic_org ON panic_alerts (org_id)`);
}

export async function panicRoutes(fastify: FastifyInstance, opts: PanicRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — panic routes disabled');
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
    await ensurePanicTable(pool);
    tableMigrated = true;
  }

  // POST /panic/trigger — Create a new panic alert
  // Accepted auth: (a) valid JWT already attached by upstream preHandler, OR
  //                (b) PANIC_TOKEN header matching env (timing-safe compare) for
  //                    button/device callers that don't have a JWT.
  fastify.post('/panic/trigger', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();

    const user = (request as any).user;
    const authenticated = !!user;

    const panicToken = process.env.PANIC_TOKEN;
    const authHeader = request.headers.authorization;
    const panicHeader = request.headers['x-panic-token'] as string | undefined;
    const provided = panicHeader || (authHeader?.startsWith('PanicToken ') ? authHeader.slice(11) : null);

    let panicTokenValid = false;
    if (panicToken && provided) {
      try {
        const a = Buffer.from(panicToken);
        const b = Buffer.from(provided);
        panicTokenValid = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch {
        panicTokenValid = false;
      }
    }

    if (!authenticated && !panicTokenValid) {
      return reply.code(401).send({ error: 'Unauthorized: valid JWT or PANIC_TOKEN required' });
    }

    const body = request.body as any;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    const alertType = body.alert_type || body.alertType || 'panic';
    if (!VALID_ALERT_TYPES.includes(alertType)) {
      return reply.code(400).send({ error: `Invalid alert_type. Must be one of: ${VALID_ALERT_TYPES.join(', ')}` });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Tenant: JWT callers use their own org; PANIC_TOKEN callers are pinned
    // server-side to PANIC_TOKEN_ORG (or DEFAULT_ORG) — we never trust a
    // body-supplied org_id from an unauthenticated caller, which would let a
    // leaked panic token write into any tenant's queue.
    const orgId = authenticated
      ? getOrgId(request)
      : (process.env.PANIC_TOKEN_ORG || DEFAULT_ORG);

    const alert = {
      id,
      org_id: orgId,
      device_id: body.device_id || body.deviceId || null,
      user_id: body.user_id || body.userId || null,
      user_name: body.user_name || body.userName || null,
      alert_type: alertType,
      location: body.location || null,
      latitude: body.latitude || body.lat || null,
      longitude: body.longitude || body.lng || null,
      status: 'active',
      triggered_at: now,
      acknowledged_at: null,
      acknowledged_by: null,
      resolved_at: null,
      resolved_by: null,
      notes: body.notes || null,
      created_at: now,
    };

    await pool.query(`
      INSERT INTO panic_alerts (id, org_id, device_id, user_id, user_name, alert_type, location, latitude, longitude, status, triggered_at, notes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [alert.id, alert.org_id, alert.device_id, alert.user_id, alert.user_name, alert.alert_type,
        alert.location, alert.latitude, alert.longitude, alert.status, alert.triggered_at,
        alert.notes, alert.created_at]);

    log.warn({ alertId: id, orgId, alertType, location: alert.location }, 'PANIC ALERT TRIGGERED');

    return reply.code(201).send({ success: true, alert });
  });

  // GET /panic/active — Get all active (non-resolved) alerts (tenant-scoped)
  fastify.get('/panic/active', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { rows } = await pool.query(
        `SELECT * FROM panic_alerts WHERE org_id = $1 AND status NOT IN ('resolved', 'cancelled') ORDER BY triggered_at DESC`,
        [orgId]
      );
      return reply.send({ alerts: rows, total: rows.length });
    } catch (err) {
      log.debug({ err: (err as Error).message }, 'Panic active query failed — returning empty');
      return reply.send({ alerts: [], total: 0 });
    }
  });

  // POST /panic/:id/acknowledge — Acknowledge an alert (tenant-scoped)
  fastify.post('/panic/:id/acknowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const body = (request.body as any) || {};
    const user = (request as any).user;
    const orgId = getOrgId(request);
    const acknowledgedBy = body.acknowledged_by || body.acknowledgedBy || user?.username || user?.sub || 'unknown';
    const now = new Date().toISOString();

    const result = await pool.query(
      `UPDATE panic_alerts SET status = 'acknowledged', acknowledged_at = $1, acknowledged_by = $2 WHERE id = $3 AND org_id = $4 AND status = 'active' RETURNING *`,
      [now, acknowledgedBy, id, orgId]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Alert not found or not in active status' });
    }

    log.info({ alertId: id, orgId, acknowledgedBy }, 'Panic alert acknowledged');
    return reply.send({ success: true, alert: result.rows[0] });
  });

  // POST /panic/:id/dispatch — Mark as dispatched (tenant-scoped)
  fastify.post('/panic/:id/dispatch', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const body = (request.body as any) || {};
    const orgId = getOrgId(request);
    const notes = body.notes || null;

    const result = await pool.query(
      `UPDATE panic_alerts SET status = 'dispatched', notes = COALESCE($1, notes) WHERE id = $2 AND org_id = $3 AND status IN ('active', 'acknowledged') RETURNING *`,
      [notes, id, orgId]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Alert not found or already resolved' });
    }

    log.info({ alertId: id, orgId }, 'Panic alert dispatched');
    return reply.send({ success: true, alert: result.rows[0] });
  });

  // POST /panic/:id/resolve — Resolve an alert (tenant-scoped)
  fastify.post('/panic/:id/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const body = (request.body as any) || {};
    const user = (request as any).user;
    const orgId = getOrgId(request);
    const resolvedBy = body.resolved_by || body.resolvedBy || user?.username || user?.sub || 'unknown';
    const notes = body.notes || null;
    const now = new Date().toISOString();

    const result = await pool.query(
      `UPDATE panic_alerts SET status = 'resolved', resolved_at = $1, resolved_by = $2, notes = COALESCE($3, notes) WHERE id = $4 AND org_id = $5 AND status NOT IN ('resolved', 'cancelled') RETURNING *`,
      [now, resolvedBy, notes, id, orgId]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Alert not found or already resolved/cancelled' });
    }

    log.info({ alertId: id, orgId, resolvedBy }, 'Panic alert resolved');
    return reply.send({ success: true, alert: result.rows[0] });
  });

  // POST /panic/:id/cancel — Cancel a false alarm (tenant-scoped)
  fastify.post('/panic/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const body = (request.body as any) || {};
    const user = (request as any).user;
    const orgId = getOrgId(request);
    const resolvedBy = body.cancelled_by || body.cancelledBy || user?.username || user?.sub || 'unknown';
    const notes = body.notes || 'False alarm — cancelled';
    const now = new Date().toISOString();

    const result = await pool.query(
      `UPDATE panic_alerts SET status = 'cancelled', resolved_at = $1, resolved_by = $2, notes = $3 WHERE id = $4 AND org_id = $5 AND status NOT IN ('resolved', 'cancelled') RETURNING *`,
      [now, resolvedBy, notes, id, orgId]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Alert not found or already resolved/cancelled' });
    }

    log.info({ alertId: id, orgId, cancelledBy: resolvedBy }, 'Panic alert cancelled (false alarm)');
    return reply.send({ success: true, alert: result.rows[0] });
  });

  // GET /panic/history — Get historical alerts with date range filtering (tenant-scoped)
  fastify.get('/panic/history', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const query = request.query as { from?: string; to?: string; type?: string; status?: string; limit?: string; offset?: string };
    const orgId = getOrgId(request);

    const conditions: string[] = ['org_id = $1'];
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (query.from) {
      conditions.push(`triggered_at >= $${paramIdx++}`);
      params.push(query.from);
    }
    if (query.to) {
      conditions.push(`triggered_at <= $${paramIdx++}`);
      params.push(query.to);
    }
    if (query.type) {
      conditions.push(`alert_type = $${paramIdx++}`);
      params.push(query.type);
    }
    if (query.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(query.status);
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(query.limit || '100', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM panic_alerts ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    const { rows } = await pool.query(
      `SELECT * FROM panic_alerts ${where} ORDER BY triggered_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ alerts: rows, total, limit, offset });
  });

  // POST /panic/lockdown — Trigger facility-wide lockdown (tenant-scoped)
  fastify.post('/panic/lockdown', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const body = (request.body as any) || {};
    const user = (request as any).user;
    const orgId = getOrgId(request);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const alert = {
      id,
      org_id: orgId,
      device_id: body.device_id || body.deviceId || 'dashboard',
      user_id: body.user_id || body.userId || user?.sub || null,
      user_name: body.user_name || body.userName || user?.username || 'System',
      alert_type: 'lockdown',
      location: body.location || 'Facility-wide',
      latitude: body.latitude || null,
      longitude: body.longitude || null,
      status: 'active',
      triggered_at: now,
      notes: body.notes || 'Facility-wide lockdown initiated',
      created_at: now,
    };

    await pool.query(`
      INSERT INTO panic_alerts (id, org_id, device_id, user_id, user_name, alert_type, location, latitude, longitude, status, triggered_at, notes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [alert.id, alert.org_id, alert.device_id, alert.user_id, alert.user_name, alert.alert_type,
        alert.location, alert.latitude, alert.longitude, alert.status, alert.triggered_at,
        alert.notes, alert.created_at]);

    log.warn({ alertId: id, orgId, initiatedBy: alert.user_name }, 'FACILITY LOCKDOWN INITIATED');

    return reply.code(201).send({ success: true, alert, message: 'Lockdown initiated. All door lock commands will be sent via federation.' });
  });

  // POST /panic/all-clear — End lockdown (resolve all active alerts for THIS tenant only)
  fastify.post('/panic/all-clear', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const body = (request.body as any) || {};
    const user = (request as any).user;
    const orgId = getOrgId(request);
    const resolvedBy = body.resolved_by || body.resolvedBy || user?.username || user?.sub || 'unknown';
    const now = new Date().toISOString();

    const result = await pool.query(
      `UPDATE panic_alerts SET status = 'resolved', resolved_at = $1, resolved_by = $2, notes = COALESCE(notes, '') || ' | ALL CLEAR issued by ' || $2 WHERE org_id = $3 AND status NOT IN ('resolved', 'cancelled') RETURNING *`,
      [now, resolvedBy, orgId]
    );

    const resolvedCount = result.rowCount ?? 0;
    log.info({ resolvedCount, orgId, resolvedBy }, 'ALL CLEAR — lockdown ended, all active alerts resolved');

    return reply.send({ success: true, resolved: resolvedCount, message: 'All clear. All active alerts have been resolved.' });
  });
}
