// @ts-nocheck
/**
 * Behavioral Threat Assessment Routes (SafeSchool)
 *
 * Threat assessment case management following CSTAG/NTAC models. All routes
 * are tenant-scoped — threat_assessments store student identifying info + at-
 * risk behavioral records which are FERPA-protected and must not cross tenants.
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:threats');

export interface ThreatRoutesOptions {
  connectionString?: string;
}

const VALID_THREAT_TYPES = ['verbal', 'written', 'behavioral', 'online', 'physical', 'self_harm'];
const VALID_THREAT_LEVELS = ['low', 'moderate', 'high', 'imminent'];
const VALID_STATUSES = ['reported', 'screening', 'assessment', 'intervention', 'monitoring', 'closed'];
const VALID_REPORTER_ROLES = ['teacher', 'student', 'parent', 'staff', 'anonymous'];

async function ensureThreatTables(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS threat_assessments (
        id TEXT PRIMARY KEY,
        case_number TEXT NOT NULL,
        subject_name TEXT NOT NULL,
        subject_id TEXT,
        subject_grade TEXT,
        subject_school TEXT,
        threat_type TEXT NOT NULL DEFAULT 'behavioral',
        threat_level TEXT,
        description TEXT NOT NULL DEFAULT '',
        reported_by TEXT,
        reporter_role TEXT DEFAULT 'staff',
        status TEXT NOT NULL DEFAULT 'reported',
        assigned_to TEXT,
        intervention_plan JSONB DEFAULT '{}',
        risk_factors JSONB DEFAULT '[]',
        protective_factors JSONB DEFAULT '[]',
        actions_taken JSONB DEFAULT '[]',
        follow_up_date TEXT,
        outcome TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
        updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_threat_assess_status ON threat_assessments (status);
      CREATE INDEX IF NOT EXISTS idx_threat_assess_level ON threat_assessments (threat_level);
      CREATE INDEX IF NOT EXISTS idx_threat_assess_type ON threat_assessments (threat_type);
      CREATE INDEX IF NOT EXISTS idx_threat_assess_created ON threat_assessments (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_threat_assess_case ON threat_assessments (case_number);
      CREATE INDEX IF NOT EXISTS idx_threat_assess_assigned ON threat_assessments (assigned_to);
      CREATE INDEX IF NOT EXISTS idx_threat_assess_followup ON threat_assessments (follow_up_date);
    `);
    await ensureOrgColumn({ query: (sql, params) => client.query(sql, params) } as any, 'threat_assessments', 'threat_assessments');
    log.info('Threat assessment tables ensured');
  } finally {
    client.release();
  }
}

function generateCaseNumber(): string {
  const year = new Date().getFullYear();
  const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
  return `TA-${year}-${seq}`;
}

export async function threatRoutes(fastify: FastifyInstance, opts: ThreatRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — threat routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await ensureThreatTables(pool);

  // POST /threats — Create new assessment (tenant-scoped)
  fastify.post('/threats', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.subject_name) {
      return reply.code(400).send({ error: 'subject_name is required' });
    }
    if (!body?.description) {
      return reply.code(400).send({ error: 'description is required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const caseNumber = generateCaseNumber();

    await pool.query(`
      INSERT INTO threat_assessments (id, org_id, case_number, subject_name, subject_id, subject_grade, subject_school,
        threat_type, threat_level, description, reported_by, reporter_role, status, assigned_to,
        risk_factors, protective_factors, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'reported',$13,$14,$15,$16,$16)
    `, [
      id, orgId, caseNumber,
      body.subject_name, body.subject_id || null, body.subject_grade || null, body.subject_school || null,
      body.threat_type || 'behavioral', body.threat_level || null,
      body.description, body.reported_by || null, body.reporter_role || 'staff',
      body.assigned_to || null,
      JSON.stringify(body.risk_factors || []),
      JSON.stringify(body.protective_factors || []),
      now,
    ]);

    log.info({ assessmentId: id, orgId, caseNumber, subject: body.subject_name }, 'Threat assessment created');

    const { rows } = await pool.query('SELECT * FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, assessment: rows[0] });
  });

  // GET /threats — List with filters (tenant-scoped)
  fastify.get('/threats', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const query = request.query as {
      status?: string; threat_level?: string; threat_type?: string;
      assigned_to?: string; search?: string;
      limit?: string; offset?: string;
    };

    const conditions: string[] = ['org_id = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (query.status) { conditions.push(`status = $${idx++}`); params.push(query.status); }
    if (query.threat_level) { conditions.push(`threat_level = $${idx++}`); params.push(query.threat_level); }
    if (query.threat_type) { conditions.push(`threat_type = $${idx++}`); params.push(query.threat_type); }
    if (query.assigned_to) { conditions.push(`assigned_to = $${idx++}`); params.push(query.assigned_to); }
    if (query.search) {
      conditions.push(`(subject_name ILIKE $${idx} OR description ILIKE $${idx} OR case_number ILIKE $${idx})`);
      params.push(`%${query.search}%`);
      idx++;
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM threat_assessments ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    const dataResult = await pool.query(
      `SELECT * FROM threat_assessments ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ assessments: dataResult.rows, total, limit, offset });
  });

  // GET /threats/active (tenant-scoped)
  fastify.get('/threats/active', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { rows } = await pool.query(
      "SELECT * FROM threat_assessments WHERE org_id = $1 AND status != 'closed' ORDER BY CASE threat_level WHEN 'imminent' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, created_at DESC",
      [orgId]
    );
    return reply.send({ assessments: rows, total: rows.length });
  });

  // GET /threats/stats (tenant-scoped)
  fastify.get('/threats/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const [byLevel, byType, byStatus, total, recent] = await Promise.all([
      pool.query("SELECT threat_level, COUNT(*) as count FROM threat_assessments WHERE org_id = $1 AND status != 'closed' GROUP BY threat_level", [orgId]),
      pool.query("SELECT threat_type, COUNT(*) as count FROM threat_assessments WHERE org_id = $1 GROUP BY threat_type", [orgId]),
      pool.query("SELECT status, COUNT(*) as count FROM threat_assessments WHERE org_id = $1 GROUP BY status", [orgId]),
      pool.query("SELECT COUNT(*) as total FROM threat_assessments WHERE org_id = $1", [orgId]),
      pool.query("SELECT COUNT(*) as count FROM threat_assessments WHERE org_id = $1 AND created_at >= (NOW() - INTERVAL '30 days')::TEXT", [orgId]),
    ]);

    const levelCounts = {};
    byLevel.rows.forEach(r => { levelCounts[r.threat_level || 'unassessed'] = parseInt(r.count); });
    const typeCounts = {};
    byType.rows.forEach(r => { typeCounts[r.threat_type] = parseInt(r.count); });
    const statusCounts = {};
    byStatus.rows.forEach(r => { statusCounts[r.status] = parseInt(r.count); });

    return reply.send({
      total: parseInt(total.rows[0].total),
      recent_30d: parseInt(recent.rows[0].count),
      by_level: levelCounts,
      by_type: typeCounts,
      by_status: statusCounts,
    });
  });

  // GET /threats/:id (tenant-scoped)
  fastify.get('/threats/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const { rows } = await pool.query('SELECT * FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Assessment not found' });
    }
    return reply.send({ assessment: rows[0] });
  });

  // PUT /threats/:id (tenant-scoped)
  fastify.put('/threats/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const fields = ['subject_name', 'subject_id', 'subject_grade', 'subject_school',
      'threat_type', 'threat_level', 'description', 'reported_by', 'reporter_role',
      'status', 'assigned_to', 'follow_up_date', 'outcome'];
    for (const field of fields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(body[field]);
      }
    }

    const jsonFields = ['intervention_plan', 'risk_factors', 'protective_factors', 'actions_taken'];
    for (const field of jsonFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        params.push(JSON.stringify(body[field]));
      }
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    updates.push(`updated_at = $${idx++}`);
    params.push(new Date().toISOString());
    params.push(id, orgId);

    const res = await pool.query(
      `UPDATE threat_assessments SET ${updates.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`,
      params
    );
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Assessment not found' });
    }

    const { rows } = await pool.query('SELECT * FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, assessment: rows[0] });
  });

  // DELETE /threats/:id (tenant-scoped)
  fastify.delete('/threats/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const result = await pool.query('DELETE FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    if ((result.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Assessment not found' });
    }
    return reply.send({ success: true, deleted: id });
  });

  // POST /threats/:id/screen (tenant-scoped)
  fastify.post('/threats/:id/screen', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const now = new Date().toISOString();

    const res = await pool.query(
      "UPDATE threat_assessments SET status = 'screening', assigned_to = COALESCE($1, assigned_to), updated_at = $2 WHERE id = $3 AND org_id = $4",
      [body?.assigned_to || null, now, id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Assessment not found' });

    log.info({ assessmentId: id, orgId }, 'Threat assessment moved to screening');
    const { rows } = await pool.query('SELECT * FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, assessment: rows[0] });
  });

  // POST /threats/:id/assess (tenant-scoped)
  fastify.post('/threats/:id/assess', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    if (!body?.threat_level) {
      return reply.code(400).send({ error: 'threat_level is required' });
    }

    const now = new Date().toISOString();
    const updates = [
      "status = 'assessment'",
      'threat_level = $1',
      'updated_at = $2',
    ];
    const params: any[] = [body.threat_level, now];
    let idx = 3;

    if (body.risk_factors) {
      updates.push(`risk_factors = $${idx++}`);
      params.push(JSON.stringify(body.risk_factors));
    }
    if (body.protective_factors) {
      updates.push(`protective_factors = $${idx++}`);
      params.push(JSON.stringify(body.protective_factors));
    }

    params.push(id, orgId);
    const res = await pool.query(
      `UPDATE threat_assessments SET ${updates.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`,
      params
    );
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Assessment not found' });

    log.info({ assessmentId: id, orgId, level: body.threat_level }, 'Threat assessment completed');
    const { rows } = await pool.query('SELECT * FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, assessment: rows[0] });
  });

  // POST /threats/:id/intervene (tenant-scoped)
  fastify.post('/threats/:id/intervene', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    if (!body?.intervention_plan) {
      return reply.code(400).send({ error: 'intervention_plan is required' });
    }

    const now = new Date().toISOString();
    const res = await pool.query(
      "UPDATE threat_assessments SET status = 'intervention', intervention_plan = $1, updated_at = $2 WHERE id = $3 AND org_id = $4",
      [JSON.stringify(body.intervention_plan), now, id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Assessment not found' });

    log.info({ assessmentId: id, orgId }, 'Intervention plan added');
    const { rows } = await pool.query('SELECT * FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, assessment: rows[0] });
  });

  // POST /threats/:id/action (tenant-scoped)
  fastify.post('/threats/:id/action', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    if (!body?.action) {
      return reply.code(400).send({ error: 'action is required' });
    }

    const now = new Date().toISOString();
    const actionEntry = {
      action: body.action,
      date: body.date || now,
      by: body.by || 'admin',
    };

    const res = await pool.query(`
      UPDATE threat_assessments SET
        actions_taken = COALESCE(actions_taken, '[]'::jsonb) || $1::jsonb,
        updated_at = $2
      WHERE id = $3 AND org_id = $4
    `, [JSON.stringify([actionEntry]), now, id, orgId]);
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Assessment not found' });

    log.info({ assessmentId: id, orgId, action: body.action }, 'Action logged');
    const { rows } = await pool.query('SELECT * FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, assessment: rows[0] });
  });

  // POST /threats/:id/follow-up (tenant-scoped)
  fastify.post('/threats/:id/follow-up', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    if (!body?.follow_up_date) {
      return reply.code(400).send({ error: 'follow_up_date is required' });
    }

    const now = new Date().toISOString();
    const res = await pool.query(
      "UPDATE threat_assessments SET status = 'monitoring', follow_up_date = $1, updated_at = $2 WHERE id = $3 AND org_id = $4",
      [body.follow_up_date, now, id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Assessment not found' });

    log.info({ assessmentId: id, orgId, followUp: body.follow_up_date }, 'Follow-up scheduled');
    const { rows } = await pool.query('SELECT * FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, assessment: rows[0] });
  });

  // POST /threats/:id/close (tenant-scoped)
  fastify.post('/threats/:id/close', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const now = new Date().toISOString();
    const res = await pool.query(
      "UPDATE threat_assessments SET status = 'closed', outcome = $1, closed_at = $2, updated_at = $2 WHERE id = $3 AND org_id = $4",
      [body?.outcome || 'Resolved', now, id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Assessment not found' });

    log.info({ assessmentId: id, orgId, outcome: body?.outcome }, 'Threat assessment closed');
    const { rows } = await pool.query('SELECT * FROM threat_assessments WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, assessment: rows[0] });
  });
}
