// @ts-nocheck
/**
 * Digital Hall Pass Routes (SafeSchool) — tenant-scoped (FERPA).
 * Student movement records carry org_id; reads and writes filter by JWT org.
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import { getUsername, getOrgId, ensureOrgColumn } from './route-helpers.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import pg from 'pg';

const log = createLogger('cloud-sync:hallpasses');

export interface HallpassRoutesOptions {
  connectionString?: string;
}

export async function hallpassRoutes(fastify: FastifyInstance, opts: HallpassRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — hallpass routes disabled');
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
    await ensureOrgColumn(pool, 'hall_passes', 'hall_passes');
    tableMigrated = true;
  }

  fastify.post('/hallpasses', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.student_name) return reply.code(400).send({ error: 'student_name is required' });
    if (!body?.destination) return reply.code(400).send({ error: 'destination is required' });

    const id = crypto.randomUUID();
    const now = new Date();
    const durationMinutes = parseInt(body.duration_minutes || '10', 10);
    const expectedReturn = new Date(now.getTime() + durationMinutes * 60 * 1000);

    const pass = {
      id, org_id: orgId,
      student_name: body.student_name,
      student_id: body.student_id || null,
      grade: body.grade || null,
      homeroom_teacher: body.homeroom_teacher || null,
      destination: body.destination,
      destination_detail: body.destination_detail || null,
      status: 'active',
      issued_by: body.issued_by || getUsername(request),
      issued_at: now.toISOString(),
      expected_return: expectedReturn.toISOString(),
      returned_at: null,
      duration_seconds: null,
      notes: body.notes || null,
      created_at: now.toISOString(),
    };

    await pool.query(
      `INSERT INTO hall_passes (id, org_id, student_name, student_id, grade, homeroom_teacher, destination, destination_detail, status, issued_by, issued_at, expected_return, returned_at, duration_seconds, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [pass.id, pass.org_id, pass.student_name, pass.student_id, pass.grade, pass.homeroom_teacher,
       pass.destination, pass.destination_detail, pass.status, pass.issued_by,
       pass.issued_at, pass.expected_return, pass.returned_at, pass.duration_seconds,
       pass.notes, pass.created_at]
    );

    log.info({ orgId, student: pass.student_name, destination: pass.destination }, 'Hall pass issued');
    return reply.code(201).send(pass);
  });

  fastify.get('/hallpasses/active', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const res = await pool.query(
      `SELECT * FROM hall_passes WHERE org_id = $1 AND status = 'active' ORDER BY issued_at DESC`,
      [orgId]
    );
    const now = Date.now();
    const passes = res.rows.map(p => ({
      ...p,
      overdue: p.expected_return && new Date(p.expected_return).getTime() < now,
      minutes_out: Math.floor((now - new Date(p.issued_at).getTime()) / 60000),
    }));
    return reply.send({ passes, total: passes.length });
  });

  fastify.post('/hallpasses/:id/return', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const now = new Date();

    const existing = await pool.query('SELECT * FROM hall_passes WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) return reply.code(404).send({ error: 'Hall pass not found' });

    const pass = existing.rows[0];
    if (pass.status !== 'active') return reply.code(400).send({ error: 'Pass is not active' });

    const durationSeconds = Math.floor((now.getTime() - new Date(pass.issued_at).getTime()) / 1000);

    await pool.query(
      `UPDATE hall_passes SET status = 'completed', returned_at = $1, duration_seconds = $2 WHERE id = $3 AND org_id = $4`,
      [now.toISOString(), durationSeconds, id, orgId]
    );

    const updated = await pool.query('SELECT * FROM hall_passes WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  fastify.get('/hallpasses', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const conditions: string[] = ['org_id = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
    if (q.destination) { conditions.push(`destination = $${idx++}`); params.push(q.destination); }
    if (q.student_id) { conditions.push(`student_id = $${idx++}`); params.push(q.student_id); }
    if (q.issued_by) { conditions.push(`issued_by = $${idx++}`); params.push(q.issued_by); }
    if (q.grade) { conditions.push(`grade = $${idx++}`); params.push(q.grade); }
    if (q.since) { conditions.push(`issued_at >= $${idx++}`); params.push(q.since); }
    if (q.search) {
      conditions.push(`(student_name ILIKE $${idx} OR student_id ILIKE $${idx})`);
      params.push(`%${q.search}%`);
      idx++;
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM hall_passes ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT * FROM hall_passes ${where} ORDER BY issued_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ passes: dataRes.rows, total, limit, offset });
  });

  fastify.get('/hallpasses/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    const [activeRes, todayRes, avgRes, destRes, overdueRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM hall_passes WHERE org_id = $1 AND status = 'active'`, [orgId]),
      pool.query(`SELECT COUNT(*) as count FROM hall_passes WHERE org_id = $1 AND issued_at >= $2`, [orgId, todayStr]),
      pool.query(`SELECT AVG(duration_seconds) as avg_duration FROM hall_passes WHERE org_id = $1 AND status = 'completed' AND duration_seconds IS NOT NULL`, [orgId]),
      pool.query(`SELECT destination, COUNT(*) as count FROM hall_passes WHERE org_id = $1 AND issued_at >= $2 GROUP BY destination ORDER BY count DESC`, [orgId, todayStr]),
      pool.query(`SELECT COUNT(*) as count FROM hall_passes WHERE org_id = $1 AND status = 'active' AND expected_return < NOW()`, [orgId]),
    ]);

    const byDestination: Record<string, number> = {};
    for (const row of destRes.rows) byDestination[row.destination] = parseInt(row.count);

    return reply.send({
      activeNow: parseInt(activeRes.rows[0]?.count || '0'),
      issuedToday: parseInt(todayRes.rows[0]?.count || '0'),
      avgDurationMinutes: Math.round(parseFloat(avgRes.rows[0]?.avg_duration || '0') / 60),
      overdueCount: parseInt(overdueRes.rows[0]?.count || '0'),
      mostPopularDestination: destRes.rows.length > 0 ? destRes.rows[0].destination : 'N/A',
      byDestination,
    });
  });

  fastify.post('/hallpasses/:id/expire', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };

    const existing = await pool.query('SELECT * FROM hall_passes WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) return reply.code(404).send({ error: 'Hall pass not found' });
    if (existing.rows[0].status !== 'active') return reply.code(400).send({ error: 'Pass is not active' });

    const now = new Date();
    const durationSeconds = Math.floor((now.getTime() - new Date(existing.rows[0].issued_at).getTime()) / 1000);

    await pool.query(
      `UPDATE hall_passes SET status = 'expired', returned_at = $1, duration_seconds = $2 WHERE id = $3 AND org_id = $4`,
      [now.toISOString(), durationSeconds, id, orgId]
    );

    const updated = await pool.query('SELECT * FROM hall_passes WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  log.info('Hall pass routes registered');
}
