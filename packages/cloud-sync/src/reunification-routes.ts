// @ts-nocheck
/**
 * Reunification System Routes (SafeSchool)
 *
 * Parent-student reunification during emergencies — track accountability and custody handoffs.
 *
 * Provides:
 *   - POST   /reunification/initiate       — Start reunification event
 *   - GET    /reunification/active          — Get active reunification event
 *   - POST   /reunification/:id/account     — Mark student as accounted for
 *   - POST   /reunification/:id/release     — Release student to guardian
 *   - GET    /reunification/:id/status      — Real-time status (counts)
 *   - GET    /reunification/:id/unaccounted — List unaccounted students
 *   - POST   /reunification/:id/complete    — End reunification event
 *   - GET    /reunification/history         — Past events
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:reunification');

const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

export interface ReunificationRoutesOptions {
  connectionString?: string;
}

async function ensureReunificationTables(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS reunification_events (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG.replace(/'/g, "''")}',
        event_name TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'evacuation',
        status TEXT NOT NULL DEFAULT 'active',
        initiated_by TEXT,
        initiated_at TEXT NOT NULL,
        completed_at TEXT,
        location TEXT,
        total_students INTEGER NOT NULL DEFAULT 0,
        accounted_for INTEGER NOT NULL DEFAULT 0,
        unaccounted INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
      );
      CREATE INDEX IF NOT EXISTS idx_reunification_events_status ON reunification_events (status);
      CREATE INDEX IF NOT EXISTS idx_reunification_events_created ON reunification_events (created_at DESC);

      CREATE TABLE IF NOT EXISTS reunification_records (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES reunification_events(id) ON DELETE CASCADE,
        student_name TEXT NOT NULL,
        student_id TEXT,
        grade TEXT,
        homeroom TEXT,
        status TEXT NOT NULL DEFAULT 'unaccounted',
        accounted_at TEXT,
        released_to TEXT,
        released_to_id TEXT,
        released_at TEXT,
        verified_by TEXT,
        verification_method TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
      );
      CREATE INDEX IF NOT EXISTS idx_reunification_records_event ON reunification_records (event_id);
      CREATE INDEX IF NOT EXISTS idx_reunification_records_status ON reunification_records (status);
      CREATE INDEX IF NOT EXISTS idx_reunification_records_student ON reunification_records (student_id);
    `);
    // Backfill org_id on events created before multi-tenant isolation was added.
    await client.query(`ALTER TABLE reunification_events ADD COLUMN IF NOT EXISTS org_id TEXT`);
    await client.query(`UPDATE reunification_events SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reunification_events_org ON reunification_events(org_id)`);
    log.info('Reunification tables ensured');
  } finally {
    client.release();
  }
}

export async function reunificationRoutes(fastify: FastifyInstance, opts: ReunificationRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — reunification routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await ensureReunificationTables(pool);

  // POST /reunification/initiate — Start reunification event
  fastify.post('/reunification/initiate', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.event_name) {
      return reply.code(400).send({ error: 'event_name is required' });
    }

    // Check for existing active event (per tenant)
    const { rows: active } = await pool.query(
      "SELECT id FROM reunification_events WHERE org_id = $1 AND status = 'active' LIMIT 1",
      [orgId]
    );
    if (active.length > 0) {
      return reply.code(409).send({ error: 'An active reunification event already exists', event_id: active[0].id });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO reunification_events (id, org_id, event_name, event_type, status, initiated_by, initiated_at, location, total_students, accounted_for, unaccounted, notes, created_at)
      VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, 0, $8, $9, $6)
    `, [
      id,
      orgId,
      body.event_name,
      body.event_type || 'evacuation',
      body.initiated_by || 'admin',
      now,
      body.location || null,
      body.total_students || 0,
      body.notes || null,
    ]);

    // If students list provided, bulk insert records
    const students = body.students || [];
    for (const s of students) {
      const rid = crypto.randomUUID();
      await pool.query(`
        INSERT INTO reunification_records (id, event_id, student_name, student_id, grade, homeroom, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'unaccounted', $7)
      `, [rid, id, s.name || s.student_name, s.student_id || null, s.grade || null, s.homeroom || null, now]);
    }

    // Update total if students were provided
    if (students.length > 0) {
      await pool.query(
        'UPDATE reunification_events SET total_students = $1, unaccounted = $1 WHERE id = $2',
        [students.length, id]
      );
    }

    log.info({ eventId: id, name: body.event_name, type: body.event_type }, 'Reunification event initiated');

    const { rows } = await pool.query('SELECT * FROM reunification_events WHERE id = $1', [id]);
    return reply.send({ success: true, event: rows[0] });
  });

  // GET /reunification/active — Get active reunification event (tenant-scoped)
  fastify.get('/reunification/active', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { rows } = await pool.query(
        "SELECT * FROM reunification_events WHERE org_id = $1 AND status = 'active' ORDER BY initiated_at DESC LIMIT 1",
        [orgId]
      );
      if (rows.length === 0) {
        return reply.send({ active: false, event: null });
      }

      const event = rows[0];
      const { rows: records } = await pool.query(
        'SELECT * FROM reunification_records WHERE event_id = $1 ORDER BY student_name',
        [event.id]
      );

      return reply.send({ active: true, event, records });
    } catch (err) {
      log.error({ err }, 'Failed to get active reunification');
      return reply.send({ active: false, event: null });
    }
  });

  // POST /reunification/:id/account — Mark student as accounted for (tenant-scoped)
  fastify.post('/reunification/:id/account', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    // Verify event belongs to caller's tenant
    const ownership = await pool.query('SELECT id FROM reunification_events WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (ownership.rows.length === 0) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }
    const body = request.body as any;

    if (!body?.student_name && !body?.record_id) {
      return reply.code(400).send({ error: 'student_name or record_id required' });
    }

    const now = new Date().toISOString();

    if (body.record_id) {
      // Update existing record. event_id filter makes cross-tenant record_ids
      // unable to match (the parent event was already verified to be in
      // caller's org).
      const upd = await pool.query(
        "UPDATE reunification_records SET status = 'accounted', accounted_at = $1 WHERE id = $2 AND event_id = $3",
        [now, body.record_id, id]
      );
      if ((upd.rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: 'Student record not found in this event' });
      }
    } else {
      // Find or create record
      const { rows: existing } = await pool.query(
        "SELECT id FROM reunification_records WHERE event_id = $1 AND LOWER(student_name) = LOWER($2) LIMIT 1",
        [id, body.student_name]
      );

      if (existing.length > 0) {
        await pool.query(
          "UPDATE reunification_records SET status = 'accounted', accounted_at = $1 WHERE id = $2",
          [now, existing[0].id]
        );
      } else {
        const rid = crypto.randomUUID();
        await pool.query(`
          INSERT INTO reunification_records (id, event_id, student_name, student_id, grade, homeroom, status, accounted_at, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'accounted', $7, $7)
        `, [rid, id, body.student_name, body.student_id || null, body.grade || null, body.homeroom || null, now]);
      }
    }

    // Update counts
    await updateEventCounts(pool, id);

    log.info({ eventId: id, student: body.student_name || body.record_id }, 'Student accounted for');
    return reply.send({ success: true });
  });

  // POST /reunification/:id/release — Release student to guardian (tenant-scoped)
  fastify.post('/reunification/:id/release', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const ownership = await pool.query('SELECT id FROM reunification_events WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (ownership.rows.length === 0) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }
    const body = request.body as any;

    if (!body?.record_id && !body?.student_name) {
      return reply.code(400).send({ error: 'record_id or student_name required' });
    }
    if (!body?.released_to) {
      return reply.code(400).send({ error: 'released_to (guardian name) is required' });
    }

    const now = new Date().toISOString();
    let recordId = body.record_id;

    if (!recordId) {
      const { rows } = await pool.query(
        "SELECT id FROM reunification_records WHERE event_id = $1 AND LOWER(student_name) = LOWER($2) LIMIT 1",
        [id, body.student_name]
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Student record not found' });
      }
      recordId = rows[0].id;
    }

    // The UPDATE joins by event_id so a record_id from another tenant's event
    // cannot match — rowCount=0. We 404 rather than silently succeed.
    const released = await pool.query(`
      UPDATE reunification_records SET
        status = 'released',
        released_to = $1,
        released_to_id = $2,
        released_at = $3,
        verified_by = $4,
        verification_method = $5,
        notes = COALESCE($6, notes)
      WHERE id = $7 AND event_id = $8
    `, [
      body.released_to,
      body.released_to_id || null,
      now,
      body.verified_by || null,
      body.verification_method || 'id_check',
      body.notes || null,
      recordId,
      id,
    ]);

    if ((released.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Student record not found in this event' });
    }

    await updateEventCounts(pool, id);

    log.info({ eventId: id, recordId, guardian: body.released_to }, 'Student released to guardian');
    return reply.send({ success: true, released_at: now });
  });

  // GET /reunification/:id/status — Real-time status (tenant-scoped)
  fastify.get('/reunification/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };

    const { rows: events } = await pool.query('SELECT * FROM reunification_events WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (events.length === 0) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    const { rows: counts } = await pool.query(`
      SELECT status, COUNT(*) as count FROM reunification_records
      WHERE event_id = $1 GROUP BY status
    `, [id]);

    const statusCounts = { unaccounted: 0, accounted: 0, released: 0, medical: 0, absent: 0 };
    let total = 0;
    for (const row of counts) {
      statusCounts[row.status] = parseInt(row.count);
      total += parseInt(row.count);
    }

    const event = events[0];
    return reply.send({
      event,
      counts: statusCounts,
      total,
      percent_complete: total > 0 ? Math.round(((statusCounts.accounted + statusCounts.released + statusCounts.absent) / total) * 100) : 0,
    });
  });

  // GET /reunification/:id/unaccounted — List unaccounted students (tenant-scoped)
  fastify.get('/reunification/:id/unaccounted', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };

    // Verify event ownership before exposing PII of students
    const ownership = await pool.query('SELECT id FROM reunification_events WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (ownership.rows.length === 0) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    const { rows } = await pool.query(
      "SELECT * FROM reunification_records WHERE event_id = $1 AND status = 'unaccounted' ORDER BY student_name",
      [id]
    );
    return reply.send({ students: rows, total: rows.length });
  });

  // POST /reunification/:id/complete — End reunification event (tenant-scoped)
  fastify.post('/reunification/:id/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const now = new Date().toISOString();

    const res = await pool.query(
      "UPDATE reunification_events SET status = 'completed', completed_at = $1, notes = COALESCE($2, notes) WHERE id = $3 AND org_id = $4",
      [now, body?.notes || null, id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    log.info({ eventId: id, orgId }, 'Reunification event completed');
    const { rows } = await pool.query('SELECT * FROM reunification_events WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, event: rows[0] });
  });

  // GET /reunification/history — Past events (tenant-scoped)
  fastify.get('/reunification/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);

    const { rows } = await pool.query(
      "SELECT * FROM reunification_events WHERE org_id = $1 AND status != 'active' ORDER BY initiated_at DESC LIMIT $2 OFFSET $3",
      [orgId, limit, offset]
    );

    const countResult = await pool.query("SELECT COUNT(*) as total FROM reunification_events WHERE org_id = $1 AND status != 'active'", [orgId]);
    const total = parseInt(countResult.rows[0].total);

    return reply.send({ events: rows, total, limit, offset });
  });
}

async function updateEventCounts(pool: pg.Pool, eventId: string): Promise<void> {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status IN ('accounted', 'released', 'absent')) as accounted,
      COUNT(*) FILTER (WHERE status = 'unaccounted') as unaccounted
    FROM reunification_records WHERE event_id = $1
  `, [eventId]);

  const r = rows[0];
  await pool.query(
    'UPDATE reunification_events SET total_students = $1, accounted_for = $2, unaccounted = $3 WHERE id = $4',
    [parseInt(r.total), parseInt(r.accounted), parseInt(r.unaccounted), eventId]
  );
}
