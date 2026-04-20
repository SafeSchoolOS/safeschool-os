// @ts-nocheck — WIP: will fix types when wiring into runtime
/**
 * Drill Management Routes (Federal/State Compliance)
 *
 * Safety drill scheduling, tracking, and compliance reporting for SafeSchool.
 * Tracks fire drills, lockdown drills, shelter-in-place, earthquake, tornado,
 * active shooter, evacuation, and reunification drills.
 *
 * Routes are tenant-scoped: every row carries `org_id` and every read/update
 * filters by the caller's JWT org.
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:drills');

export interface DrillRoutesOptions {
  /** PostgreSQL connection string (defaults to DATABASE_URL) */
  connectionString?: string;
}

const VALID_DRILL_TYPES = ['fire', 'lockdown', 'shelter_in_place', 'earthquake', 'tornado', 'active_shooter', 'evacuation', 'reunification'];
const VALID_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const VALID_GRADES = ['pass', 'needs_improvement', 'fail'];
const VALID_COMPLIANCE_PERIODS = ['monthly', 'quarterly', 'semester', 'annual'];
const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

async function ensureDrillsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drills (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG.replace(/'/g, "''")}',
      drill_type TEXT NOT NULL DEFAULT 'fire',
      title TEXT NOT NULL,
      description TEXT,
      scheduled_date TEXT,
      started_at TEXT,
      completed_at TEXT,
      duration_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'scheduled',
      participants_count INTEGER,
      building TEXT,
      location TEXT,
      conducted_by TEXT,
      compliance_period TEXT DEFAULT 'quarterly',
      notes TEXT,
      issues_found TEXT,
      corrective_actions TEXT,
      grade TEXT,
      state_requirement TEXT,
      reported_to_state INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_drills_type ON drills (drill_type);
    CREATE INDEX IF NOT EXISTS idx_drills_status ON drills (status);
    CREATE INDEX IF NOT EXISTS idx_drills_scheduled ON drills (scheduled_date DESC);
    CREATE INDEX IF NOT EXISTS idx_drills_created ON drills (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_drills_compliance ON drills (compliance_period);
    CREATE INDEX IF NOT EXISTS idx_drills_grade ON drills (grade);
  `);
  await pool.query(`ALTER TABLE drills ADD COLUMN IF NOT EXISTS org_id TEXT`);
  await pool.query(`UPDATE drills SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_drills_org ON drills(org_id)`);
}

export async function drillRoutes(fastify: FastifyInstance, opts: DrillRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — drill routes disabled');
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
    await ensureDrillsTable(pool);
    tableMigrated = true;
  }

  // GET /drills — List drills with filters (tenant-scoped)
  fastify.get('/drills', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const query = request.query as {
      type?: string; status?: string; grade?: string; compliance_period?: string;
      from?: string; to?: string; building?: string;
      limit?: string; offset?: string; sort?: string; order?: string;
    };

    const conditions: string[] = ['org_id = $1'];
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (query.type) { conditions.push(`drill_type = $${paramIdx++}`); params.push(query.type); }
    if (query.status) { conditions.push(`status = $${paramIdx++}`); params.push(query.status); }
    if (query.grade) { conditions.push(`grade = $${paramIdx++}`); params.push(query.grade); }
    if (query.compliance_period) { conditions.push(`compliance_period = $${paramIdx++}`); params.push(query.compliance_period); }
    if (query.from) { conditions.push(`scheduled_date >= $${paramIdx++}`); params.push(query.from); }
    if (query.to) { conditions.push(`scheduled_date <= $${paramIdx++}`); params.push(query.to); }
    if (query.building) { conditions.push(`building ILIKE $${paramIdx++}`); params.push('%' + query.building + '%'); }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(query.limit || '100', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);
    const sortCol = query.sort === 'drill_type' ? 'drill_type' : query.sort === 'status' ? 'status' : query.sort === 'scheduled_date' ? 'scheduled_date' : 'created_at';
    const sortOrder = query.order === 'asc' ? 'ASC' : 'DESC';

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM drills ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    const { rows } = await pool.query(
      `SELECT * FROM drills ${where} ORDER BY ${sortCol} ${sortOrder} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ drills: rows, total, limit, offset });
  });

  // POST /drills — Create a new drill (tenant-scoped)
  fastify.post('/drills', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    const drillType = body.drill_type || body.drillType || 'fire';
    if (!VALID_DRILL_TYPES.includes(drillType)) {
      return reply.code(400).send({ error: `Invalid drill_type. Must be one of: ${VALID_DRILL_TYPES.join(', ')}` });
    }

    const title = body.title;
    if (!title) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const status = body.status || 'scheduled';
    if (!VALID_STATUSES.includes(status)) {
      return reply.code(400).send({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const compliancePeriod = body.compliance_period || body.compliancePeriod || 'quarterly';
    if (!VALID_COMPLIANCE_PERIODS.includes(compliancePeriod)) {
      return reply.code(400).send({ error: `Invalid compliance_period. Must be one of: ${VALID_COMPLIANCE_PERIODS.join(', ')}` });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const drill = {
      id,
      org_id: orgId,
      drill_type: drillType,
      title: title,
      description: body.description || null,
      scheduled_date: body.scheduled_date || body.scheduledDate || null,
      started_at: null,
      completed_at: null,
      duration_seconds: null,
      status: status,
      participants_count: body.participants_count || body.participantsCount || null,
      building: body.building || null,
      location: body.location || null,
      conducted_by: body.conducted_by || body.conductedBy || null,
      compliance_period: compliancePeriod,
      notes: body.notes || null,
      issues_found: null,
      corrective_actions: null,
      grade: null,
      state_requirement: body.state_requirement || body.stateRequirement || null,
      reported_to_state: 0,
      created_at: now,
      updated_at: now,
    };

    await pool.query(`
      INSERT INTO drills (id, org_id, drill_type, title, description, scheduled_date, started_at, completed_at,
        duration_seconds, status, participants_count, building, location, conducted_by, compliance_period,
        notes, issues_found, corrective_actions, grade, state_requirement, reported_to_state, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
    `, [
      drill.id, drill.org_id, drill.drill_type, drill.title, drill.description, drill.scheduled_date,
      drill.started_at, drill.completed_at, drill.duration_seconds, drill.status,
      drill.participants_count, drill.building, drill.location, drill.conducted_by,
      drill.compliance_period, drill.notes, drill.issues_found, drill.corrective_actions,
      drill.grade, drill.state_requirement, drill.reported_to_state, drill.created_at, drill.updated_at,
    ]);

    log.info({ drillId: id, orgId, drillType, title }, 'Drill created');
    return reply.code(201).send({ success: true, drill });
  });

  // GET /drills/compliance — Compliance dashboard (tenant-scoped)
  fastify.get('/drills/compliance', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
    await ensureTable();
    const orgId = getOrgId(request);

    const { rows: completedRows } = await pool.query(`
      SELECT drill_type, compliance_period, COUNT(*) as completed_count,
        MAX(completed_at) as last_completed,
        AVG(duration_seconds) as avg_duration
      FROM drills
      WHERE org_id = $1 AND status = 'completed' AND completed_at IS NOT NULL
      GROUP BY drill_type, compliance_period
    `, [orgId]);

    const { rows: overdueRows } = await pool.query(`
      SELECT * FROM drills
      WHERE org_id = $1 AND status = 'scheduled' AND scheduled_date < $2
      ORDER BY scheduled_date ASC
    `, [orgId, new Date().toISOString()]);

    const { rows: upcomingRows } = await pool.query(`
      SELECT * FROM drills
      WHERE org_id = $1 AND status = 'scheduled' AND scheduled_date >= $2
      ORDER BY scheduled_date ASC
      LIMIT 20
    `, [orgId, new Date().toISOString()]);

    const now = new Date();
    const yearStart = now.getMonth() >= 7
      ? new Date(now.getFullYear(), 7, 1).toISOString()
      : new Date(now.getFullYear() - 1, 7, 1).toISOString();

    const { rows: yearDrills } = await pool.query(`
      SELECT drill_type, compliance_period, COUNT(*) as count, grade
      FROM drills
      WHERE org_id = $1 AND status = 'completed' AND completed_at >= $2
      GROUP BY drill_type, compliance_period, grade
    `, [orgId, yearStart]);

    const requirements = VALID_DRILL_TYPES.map(function(type) {
      var typeCompleted = yearDrills.filter(function(d) { return d.drill_type === type; });
      var totalCompleted = typeCompleted.reduce(function(s, d) { return s + parseInt(d.count); }, 0);
      var lastDrill = completedRows.find(function(d) { return d.drill_type === type; });
      var overdueCount = overdueRows.filter(function(d) { return d.drill_type === type; }).length;
      var upcomingCount = upcomingRows.filter(function(d) { return d.drill_type === type; }).length;

      var requiredPerYear = type === 'fire' ? 4 : type === 'lockdown' ? 2 : type === 'tornado' ? 2 : type === 'active_shooter' ? 1 : type === 'evacuation' ? 2 : 1;

      return {
        drill_type: type,
        required_per_year: requiredPerYear,
        completed_this_year: totalCompleted,
        remaining: Math.max(0, requiredPerYear - totalCompleted),
        compliant: totalCompleted >= requiredPerYear,
        last_completed: lastDrill ? lastDrill.last_completed : null,
        avg_duration_seconds: lastDrill ? Math.round(parseFloat(lastDrill.avg_duration || '0')) : null,
        overdue_count: overdueCount,
        upcoming_count: upcomingCount,
      };
    });

    var totalRequired = requirements.reduce(function(s, r) { return s + r.required_per_year; }, 0);
    var totalCompleted = requirements.reduce(function(s, r) { return s + r.completed_this_year; }, 0);
    var allCompliant = requirements.every(function(r) { return r.compliant; });

    return reply.send({
      school_year_start: yearStart,
      overall_compliant: allCompliant,
      total_required: totalRequired,
      total_completed: totalCompleted,
      completion_percentage: totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 100) : 100,
      requirements: requirements,
      overdue: overdueRows,
      upcoming: upcomingRows,
    });
    } catch (err) {
      log.error({ err }, 'Failed to get drill compliance');
      return reply.send({
        school_year_start: null, overall_compliant: false,
        total_required: 0, total_completed: 0, completion_percentage: 0,
        requirements: [], overdue: [], upcoming: [],
      });
    }
  });

  // GET /drills/calendar — Calendar view data (tenant-scoped)
  fastify.get('/drills/calendar', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const query = request.query as { year?: string; month?: string };
    const year = parseInt(query.year || String(new Date().getFullYear()), 10);
    const month = query.month ? parseInt(query.month, 10) : null;

    let dateFrom: string;
    let dateTo: string;

    if (month !== null) {
      dateFrom = new Date(year, month - 1, 1).toISOString();
      dateTo = new Date(year, month, 0, 23, 59, 59).toISOString();
    } else {
      dateFrom = new Date(year, 0, 1).toISOString();
      dateTo = new Date(year, 11, 31, 23, 59, 59).toISOString();
    }

    const { rows } = await pool.query(
      `SELECT * FROM drills WHERE org_id = $1 AND ((scheduled_date >= $2 AND scheduled_date <= $3)
       OR (completed_at >= $2 AND completed_at <= $3))
       ORDER BY COALESCE(scheduled_date, completed_at) ASC`,
      [orgId, dateFrom, dateTo]
    );

    const byMonth: Record<string, any[]> = {};
    rows.forEach(function(drill) {
      var d = new Date(drill.scheduled_date || drill.completed_at || drill.created_at);
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(drill);
    });

    return reply.send({ year, month, drills: rows, by_month: byMonth });
  });

  // GET /drills/:id — Get drill by ID (tenant-scoped)
  fastify.get('/drills/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);

    if (id === 'compliance' || id === 'calendar') return;

    const { rows } = await pool.query('SELECT * FROM drills WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Drill not found' });
    }

    return reply.send({ drill: rows[0] });
  });

  // PUT /drills/:id — Update a drill (tenant-scoped)
  fastify.put('/drills/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body) {
      return reply.code(400).send({ error: 'Request body is required' });
    }

    const existing = await pool.query('SELECT * FROM drills WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Drill not found' });
    }

    const now = new Date().toISOString();
    const fields: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    const allowedFields = [
      'drill_type', 'title', 'description', 'scheduled_date', 'status',
      'participants_count', 'building', 'location', 'conducted_by', 'compliance_period',
      'notes', 'issues_found', 'corrective_actions', 'grade', 'state_requirement', 'reported_to_state',
    ];

    const fieldMap: Record<string, string> = {
      drillType: 'drill_type', scheduledDate: 'scheduled_date',
      participantsCount: 'participants_count', conductedBy: 'conducted_by',
      compliancePeriod: 'compliance_period', issuesFound: 'issues_found',
      correctiveActions: 'corrective_actions', stateRequirement: 'state_requirement',
      reportedToState: 'reported_to_state',
    };

    for (const [key, value] of Object.entries(body)) {
      const snakeKey = fieldMap[key] || key;
      if (allowedFields.includes(snakeKey)) {
        fields.push(`${snakeKey} = $${paramIdx++}`);
        params.push(value);
      }
    }

    if (fields.length === 0) {
      return reply.code(400).send({ error: 'No valid fields to update' });
    }

    fields.push(`updated_at = $${paramIdx++}`);
    params.push(now);
    params.push(id, orgId);

    const result = await pool.query(
      `UPDATE drills SET ${fields.join(', ')} WHERE id = $${paramIdx} AND org_id = $${paramIdx + 1} RETURNING *`,
      params
    );

    log.info({ drillId: id, orgId }, 'Drill updated');
    return reply.send({ success: true, drill: result.rows[0] });
  });

  // DELETE /drills/:id — Delete a drill (tenant-scoped)
  fastify.delete('/drills/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);

    const result = await pool.query('DELETE FROM drills WHERE id = $1 AND org_id = $2', [id, orgId]);
    if ((result.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Drill not found' });
    }

    log.info({ drillId: id, orgId }, 'Drill deleted');
    return reply.send({ success: true });
  });

  // POST /drills/:id/start — Start a drill (tenant-scoped)
  fastify.post('/drills/:id/start', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);
    const now = new Date().toISOString();

    const result = await pool.query(
      `UPDATE drills SET status = 'in_progress', started_at = $1, updated_at = $1
       WHERE id = $2 AND org_id = $3 AND status = 'scheduled' RETURNING *`,
      [now, id, orgId]
    );

    if (result.rowCount === 0) {
      return reply.code(404).send({ error: 'Drill not found or not in scheduled status' });
    }

    log.info({ drillId: id, orgId }, 'Drill started');
    return reply.send({ success: true, drill: result.rows[0] });
  });

  // POST /drills/:id/complete — Complete a drill (tenant-scoped)
  fastify.post('/drills/:id/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);
    const body = (request.body as any) || {};
    const now = new Date().toISOString();

    const existing = await pool.query('SELECT * FROM drills WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Drill not found' });
    }

    const drill = existing.rows[0];
    if (drill.status !== 'in_progress' && drill.status !== 'scheduled') {
      return reply.code(400).send({ error: 'Drill must be in_progress or scheduled to complete' });
    }

    let durationSeconds = body.duration_seconds || body.durationSeconds || null;
    if (!durationSeconds && drill.started_at) {
      durationSeconds = Math.round((new Date(now).getTime() - new Date(drill.started_at).getTime()) / 1000);
    }

    const grade = body.grade || null;
    if (grade && !VALID_GRADES.includes(grade)) {
      return reply.code(400).send({ error: `Invalid grade. Must be one of: ${VALID_GRADES.join(', ')}` });
    }

    const result = await pool.query(
      `UPDATE drills SET
        status = 'completed',
        completed_at = $1,
        started_at = COALESCE(started_at, $1),
        duration_seconds = $2,
        grade = $3,
        participants_count = COALESCE($4, participants_count),
        notes = COALESCE($5, notes),
        issues_found = COALESCE($6, issues_found),
        corrective_actions = COALESCE($7, corrective_actions),
        conducted_by = COALESCE($8, conducted_by),
        updated_at = $1
      WHERE id = $9 AND org_id = $10 RETURNING *`,
      [
        now, durationSeconds, grade,
        body.participants_count || body.participantsCount || null,
        body.notes || null,
        body.issues_found || body.issuesFound || null,
        body.corrective_actions || body.correctiveActions || null,
        body.conducted_by || body.conductedBy || null,
        id, orgId,
      ]
    );

    log.info({ drillId: id, orgId, grade, durationSeconds }, 'Drill completed');
    return reply.send({ success: true, drill: result.rows[0] });
  });
}
