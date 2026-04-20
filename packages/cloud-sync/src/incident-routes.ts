// @ts-nocheck
/**
 * Incident Management Routes
 *
 * Full GSOC incident lifecycle: create, acknowledge, assign, escalate, resolve, close.
 * Plus SOP (Standard Operating Procedure) management.
 *
 * Routes:
 *   POST   /incidents              — Create new incident
 *   GET    /incidents              — List incidents (filterable)
 *   GET    /incidents/stats        — Dashboard KPI stats
 *   GET    /incidents/:id          — Get incident with activity log
 *   PUT    /incidents/:id          — Update incident fields
 *   POST   /incidents/:id/acknowledge — Acknowledge incident
 *   POST   /incidents/:id/assign     — Assign to operator
 *   POST   /incidents/:id/escalate   — Escalate priority
 *   POST   /incidents/:id/resolve    — Resolve with notes
 *   POST   /incidents/:id/close      — Close incident
 *   POST   /incidents/:id/notes      — Add note/update
 *
 *   GET    /sops                   — List SOPs
 *   POST   /sops                   — Create SOP
 *   PUT    /sops/:id               — Update SOP
 *   DELETE /sops/:id               — Delete SOP
 *   GET    /sops/match/:incident_type — Match SOP for type
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import { getUsername, getOrgId } from './route-helpers.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import pg from 'pg';

const log = createLogger('cloud-sync:incidents');

export interface IncidentRoutesOptions {
  connectionString?: string;
}

function generateIncidentNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 9999) + 1;
  return `INC-${year}-${String(seq).padStart(4, '0')}`;
}

async function ensureIncidentsTables(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      incident_number TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      incident_type TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      location TEXT,
      site_id TEXT,
      reported_by TEXT,
      assigned_to TEXT,
      sop_id TEXT,
      org_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at TEXT,
      closed_at TEXT,
      resolution_notes TEXT,
      source_event_id TEXT,
      device_id TEXT
    );
    CREATE TABLE IF NOT EXISTS incident_updates (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL,
      update_type TEXT,
      old_value TEXT,
      new_value TEXT,
      comment TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_priority ON incidents(priority);
    CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents(org_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_incident_updates_incident ON incident_updates(incident_id);
  `);
  // Backfill org_id on sops so legacy rows are scoped to the default org
  // (matching the pattern used elsewhere).
  await pool.query(`ALTER TABLE sops ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sops_org ON sops(org_id)`).catch(() => {});
}

export async function incidentRoutes(fastify: FastifyInstance, opts: IncidentRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — incident routes disabled');
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
    await ensureIncidentsTables(pool);
    tableMigrated = true;
  }

  // Helper: add an update record
  async function addUpdate(
    client: pg.PoolClient,
    incidentId: string,
    updateType: string,
    updatedBy: string,
    oldValue?: string,
    newValue?: string,
    comment?: string
  ) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO incident_updates (id, incident_id, update_type, old_value, new_value, comment, updated_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, incidentId, updateType, oldValue || null, newValue || null, comment || null, updatedBy, now]
    );
  }

  // ─── POST /incidents — Create ─────────────────────────────────

  fastify.post('/incidents', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const body = request.body as any;
    if (!body?.title) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Generate unique incident number — retry on collision. Scope the
    // uniqueness check by the caller's org so tenants each have their own
    // per-year sequence and collisions from another tenant don't trigger
    // our fallback path.
    const callerOrgId = getOrgId(request);
    let incidentNumber = generateIncidentNumber();
    const existing = await pool.query(
      'SELECT id FROM incidents WHERE incident_number = $1 AND org_id = $2',
      [incidentNumber, callerOrgId]
    );
    if (existing.rows.length > 0) {
      incidentNumber = `INC-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999) + 1).padStart(5, '0')}`;
    }

    const incident = {
      id,
      incident_number: incidentNumber,
      title: body.title,
      description: body.description || '',
      incident_type: body.incident_type || body.type || 'other',
      priority: body.priority || 'medium',
      status: 'open',
      location: body.location || null,
      reported_by: body.reported_by || getUsername(request),
      assigned_to: body.assigned_to || null,
      sop_id: body.sop_id || null,
      created_at: now,
      updated_at: now,
      acknowledged_at: null,
      resolved_at: null,
      closed_at: null,
      resolution_notes: null,
      source_event_id: body.source_event_id || null,
      device_id: body.device_id || null,
      org_id: getOrgId(request),
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO incidents (id, incident_number, title, description, incident_type, priority, status,
         location, reported_by, assigned_to, sop_id, created_at, updated_at,
         acknowledged_at, resolved_at, closed_at, resolution_notes, source_event_id, device_id, org_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [incident.id, incident.incident_number, incident.title, incident.description,
         incident.incident_type, incident.priority, incident.status,
         incident.location, incident.reported_by, incident.assigned_to, incident.sop_id,
         incident.created_at, incident.updated_at,
         incident.acknowledged_at, incident.resolved_at, incident.closed_at,
         incident.resolution_notes, incident.source_event_id, incident.device_id, incident.org_id]
      );

      await addUpdate(client, id, 'status_change', getUsername(request), null, 'open', 'Incident created');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      log.error({ err }, 'Failed to create incident');
      return reply.code(500).send({ error: 'Failed to create incident' });
    } finally {
      client.release();
    }

    log.info({ incidentNumber, type: incident.incident_type, priority: incident.priority }, 'Incident created');
    return reply.code(201).send(incident);
  });

  // ─── GET /incidents — List with filters ───────────────────────

  fastify.get('/incidents', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const q = request.query as Record<string, string>;
    const orgId = getOrgId(request);
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
    if (q.incident_type || q.type) {
      conditions.push(`incident_type = $${idx++}`);
      params.push(q.incident_type || q.type);
    }
    if (q.assigned_to) {
      conditions.push(`assigned_to = $${idx++}`);
      params.push(q.assigned_to);
    }
    if (q.since) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(q.since);
    }
    if (q.until) {
      conditions.push(`created_at <= $${idx++}`);
      params.push(q.until);
    }
    if (q.search) {
      conditions.push(`(title ILIKE $${idx} OR description ILIKE $${idx} OR incident_number ILIKE $${idx})`);
      params.push(`%${q.search}%`);
      idx++;
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const ALLOWED_SORT = new Set(['created_at', 'updated_at', 'priority', 'status', 'incident_number', 'resolved_at', 'acknowledged_at']);
    const rawSort = (q.sort || 'created_at').toLowerCase();
    const sortField = ALLOWED_SORT.has(rawSort) ? rawSort : 'created_at';
    const sortDir = q.order === 'asc' ? 'ASC' : 'DESC';
    const orderExpr = sortField === 'priority'
      ? `CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END`
      : sortField;
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM incidents ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT * FROM incidents ${where} ORDER BY ${orderExpr} ${sortDir} LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ incidents: dataRes.rows, total, limit, offset });
  });

  // ─── GET /incidents/stats — KPI stats ─────────────────────────

  fastify.get('/incidents/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();

      const [statusRes, priorityRes, resolvedTodayRes, responseTimeRes, recentRes] = await Promise.all([
        pool.query(`SELECT status, COUNT(*) as count FROM incidents WHERE org_id = $1 GROUP BY status`, [orgId]),
        pool.query(`SELECT priority, COUNT(*) as count FROM incidents WHERE org_id = $1 AND status NOT IN ('resolved','closed') GROUP BY priority`, [orgId]),
        pool.query(`SELECT COUNT(*) as count FROM incidents WHERE org_id = $1 AND resolved_at >= $2`, [orgId, todayStr]),
        pool.query(`SELECT AVG(EXTRACT(EPOCH FROM (acknowledged_at::timestamp - created_at::timestamp))) as avg_seconds FROM incidents WHERE org_id = $1 AND acknowledged_at IS NOT NULL`, [orgId]),
        pool.query(`SELECT * FROM incidents WHERE org_id = $1 AND status NOT IN ('resolved','closed') ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC LIMIT 10`, [orgId]),
      ]);

      const statusCounts: Record<string, number> = {};
      for (const row of statusRes.rows) {
        statusCounts[row.status] = parseInt(row.count);
      }

      const priorityCounts: Record<string, number> = {};
      for (const row of priorityRes.rows) {
        priorityCounts[row.priority] = parseInt(row.count);
      }

      const resolvedToday = parseInt(resolvedTodayRes.rows[0]?.count || '0');
      const avgResponseSeconds = parseFloat(responseTimeRes.rows[0]?.avg_seconds || '0');
      const avgResponseMinutes = Math.round(avgResponseSeconds / 60);

      return reply.send({
        open: (statusCounts.open || 0) + (statusCounts.acknowledged || 0) + (statusCounts.investigating || 0) + (statusCounts.dispatched || 0),
        acknowledged: statusCounts.acknowledged || 0,
        investigating: (statusCounts.investigating || 0) + (statusCounts.dispatched || 0),
        resolved: statusCounts.resolved || 0,
        closed: statusCounts.closed || 0,
        resolvedToday,
        avgResponseMinutes,
        byPriority: priorityCounts,
        byStatus: statusCounts,
        recentOpen: recentRes.rows,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get incident stats');
      return reply.send({
        open: 0, acknowledged: 0, investigating: 0, resolved: 0, closed: 0,
        resolvedToday: 0, avgResponseMinutes: 0,
        byPriority: {}, byStatus: {}, recentOpen: [],
      });
    }
  });

  // ─── GET /incidents/:id — Detail with updates ─────────────────

  fastify.get('/incidents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);

    const incRes = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (incRes.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const updatesRes = await pool.query(
      'SELECT * FROM incident_updates WHERE incident_id = $1 ORDER BY created_at ASC',
      [id]
    );

    // Check for matching SOP (tenant-scoped)
    const incident = incRes.rows[0];
    let sop = null;
    if (incident.sop_id) {
      const sopRes = await pool.query(
        'SELECT * FROM sops WHERE id = $1 AND COALESCE(org_id, $2) = $2',
        [incident.sop_id, orgId]
      );
      sop = sopRes.rows[0] || null;
    } else {
      const sopRes = await pool.query(
        'SELECT * FROM sops WHERE incident_type = $1 AND COALESCE(org_id, $2) = $2 LIMIT 1',
        [incident.incident_type, orgId]
      );
      sop = sopRes.rows[0] || null;
    }

    return reply.send({
      incident,
      updates: updatesRes.rows,
      sop,
    });
  });

  // ─── PUT /incidents/:id — Update fields ───────────────────────

  fastify.put('/incidents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);
    const body = request.body as any;
    const now = new Date().toISOString();

    const existing = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const fields: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    const updatable = ['title', 'description', 'incident_type', 'priority', 'location', 'assigned_to', 'sop_id', 'device_id'];
    for (const field of updatable) {
      if (body[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        values.push(body[field]);
      }
    }

    values.push(id, orgId);
    await pool.query(`UPDATE incidents SET ${fields.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`, values);

    const updated = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /incidents/:id/acknowledge ──────────────────────────

  fastify.post('/incidents/:id/acknowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);
    const now = new Date().toISOString();
    const user = getUsername(request);

    const existing = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const oldStatus = existing.rows[0].status;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE incidents SET status = 'acknowledged', acknowledged_at = $1, updated_at = $1 WHERE id = $2 AND org_id = $3`,
        [now, id, orgId]
      );
      await addUpdate(client, id, 'status_change', user, oldStatus, 'acknowledged', `Acknowledged by ${user}`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const updated = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /incidents/:id/assign ───────────────────────────────

  fastify.post('/incidents/:id/assign', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);
    const body = request.body as any;
    const assignTo = body?.assigned_to || body?.operator;
    if (!assignTo) {
      return reply.code(400).send({ error: 'assigned_to is required' });
    }

    const now = new Date().toISOString();
    const user = getUsername(request);

    const existing = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const oldAssigned = existing.rows[0].assigned_to;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE incidents SET assigned_to = $1, status = CASE WHEN status = 'open' THEN 'investigating' ELSE status END, updated_at = $2 WHERE id = $3 AND org_id = $4`,
        [assignTo, now, id, orgId]
      );
      await addUpdate(client, id, 'assignment', user, oldAssigned, assignTo, `Assigned to ${assignTo} by ${user}`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const updated = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /incidents/:id/escalate ─────────────────────────────

  fastify.post('/incidents/:id/escalate', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);
    const now = new Date().toISOString();
    const user = getUsername(request);
    const body = request.body as any;
    const reason = body?.reason || '';

    const existing = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const oldPriority = existing.rows[0].priority;
    const escalationMap: Record<string, string> = { low: 'medium', medium: 'high', high: 'critical', critical: 'critical' };
    const newPriority = body?.priority || escalationMap[oldPriority] || 'critical';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE incidents SET priority = $1, updated_at = $2 WHERE id = $3 AND org_id = $4`,
        [newPriority, now, id, orgId]
      );
      await addUpdate(client, id, 'escalation', user, oldPriority, newPriority,
        `Escalated from ${oldPriority} to ${newPriority}${reason ? ': ' + reason : ''}`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const updated = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /incidents/:id/resolve ──────────────────────────────

  fastify.post('/incidents/:id/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);
    const body = request.body as any;
    const now = new Date().toISOString();
    const user = getUsername(request);

    const existing = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const oldStatus = existing.rows[0].status;
    const notes = body?.resolution_notes || body?.notes || '';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE incidents SET status = 'resolved', resolved_at = $1, updated_at = $1, resolution_notes = $2 WHERE id = $3 AND org_id = $4`,
        [now, notes, id, orgId]
      );
      await addUpdate(client, id, 'status_change', user, oldStatus, 'resolved',
        `Resolved by ${user}${notes ? ': ' + notes : ''}`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const updated = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /incidents/:id/close ────────────────────────────────

  fastify.post('/incidents/:id/close', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);
    const now = new Date().toISOString();
    const user = getUsername(request);

    const existing = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const oldStatus = existing.rows[0].status;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE incidents SET status = 'closed', closed_at = $1, updated_at = $1 WHERE id = $2 AND org_id = $3`,
        [now, id, orgId]
      );
      await addUpdate(client, id, 'status_change', user, oldStatus, 'closed', `Closed by ${user}`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const updated = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /incidents/:id/notes — Add note ────────────────────

  fastify.post('/incidents/:id/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const comment = body?.comment || body?.note || body?.text;
    if (!comment) {
      return reply.code(400).send({ error: 'comment is required' });
    }

    const orgId = getOrgId(request);
    const existing = await pool.query('SELECT id FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const user = getUsername(request);
    const now = new Date().toISOString();
    const noteId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO incident_updates (id, incident_id, update_type, comment, updated_by, created_at)
       VALUES ($1, $2, 'note', $3, $4, $5)`,
      [noteId, id, comment, user, now]
    );

    // Also update incident's updated_at
    await pool.query('UPDATE incidents SET updated_at = $1 WHERE id = $2 AND org_id = $3', [now, id, orgId]);

    return reply.send({ id: noteId, incident_id: id, update_type: 'note', comment, updated_by: user, created_at: now });
  });

  // ═══════════════════════════════════════════════════════════════
  // SOP Routes
  // ═══════════════════════════════════════════════════════════════

  // ─── GET /sops — tenant-scoped ────────────────────────────────
  fastify.get('/sops', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const res = await pool.query(
      'SELECT * FROM sops WHERE COALESCE(org_id, $1) = $1 ORDER BY name ASC',
      [orgId]
    );
    return reply.send({ sops: res.rows, total: res.rows.length });
  });

  // ─── POST /sops ───────────────────────────────────────────────

  fastify.post('/sops', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.name || !body?.incident_type) {
      return reply.code(400).send({ error: 'name and incident_type are required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await pool.query(
      `INSERT INTO sops (id, name, incident_type, steps, auto_actions, created_at, updated_at, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
      [id, body.name, body.incident_type,
       JSON.stringify(body.steps || []),
       body.auto_actions ? JSON.stringify(body.auto_actions) : null,
       now, orgId]
    );

    const res = await pool.query(
      'SELECT * FROM sops WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    return reply.code(201).send(res.rows[0]);
  });

  // ─── PUT /sops/:id ───────────────────────────────────────────

  fastify.put('/sops/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const now = new Date().toISOString();

    const existing = await pool.query(
      'SELECT id FROM sops WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'SOP not found' });
    }

    const fields: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    if (body.name !== undefined) { fields.push(`name = $${idx++}`); values.push(body.name); }
    if (body.incident_type !== undefined) { fields.push(`incident_type = $${idx++}`); values.push(body.incident_type); }
    if (body.steps !== undefined) { fields.push(`steps = $${idx++}`); values.push(JSON.stringify(body.steps)); }
    if (body.auto_actions !== undefined) { fields.push(`auto_actions = $${idx++}`); values.push(JSON.stringify(body.auto_actions)); }

    values.push(id, orgId);
    await pool.query(
      `UPDATE sops SET ${fields.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
      values
    );

    const res = await pool.query(
      'SELECT * FROM sops WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    return reply.send(res.rows[0]);
  });

  // ─── DELETE /sops/:id (tenant-scoped) ──────────────────────────

  fastify.delete('/sops/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query(
      'DELETE FROM sops WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'SOP not found' });
    }
    return reply.send({ success: true, deleted: id });
  });

  // ─── GET /sops/match/:incident_type (tenant-scoped) ────────────

  fastify.get('/sops/match/:incident_type', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { incident_type } = request.params as { incident_type: string };
    const res = await pool.query(
      'SELECT * FROM sops WHERE incident_type = $1 AND COALESCE(org_id, $2) = $2 LIMIT 1',
      [incident_type, orgId]
    );
    if (res.rows.length === 0) {
      return reply.code(404).send({ error: 'No SOP found for this incident type' });
    }
    return reply.send(res.rows[0]);
  });

  // ─── POST /incidents/:id/summarize — Generate AI summary ──────

  fastify.post('/incidents/:id/summarize', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);

    const incRes = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (incRes.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const inc = incRes.rows[0];

    // Gather all linked data
    const updatesRes = await pool.query(
      'SELECT * FROM incident_updates WHERE incident_id = $1 ORDER BY created_at ASC', [id]
    );
    const updates = updatesRes.rows;

    // Find linked alarms (tenant-scoped — linked_incident_id is a
    // human-readable INC-YYYY-NNNN string that could collide across tenants,
    // so we join on org_id to avoid pulling another tenant's alarm rows).
    const alarmsRes = await pool.query(
      'SELECT * FROM alarms WHERE org_id = $1 AND linked_incident_id = $2 ORDER BY created_at ASC',
      [orgId, id]
    ).catch((err) => { log.warn({ err, incidentId: id }, 'Failed to query linked alarms for incident summary'); return { rows: [] }; });
    const alarms = alarmsRes.rows;

    // Build template-based intelligent summary
    const priorityWords = { critical: 'Critical', high: 'High-priority', medium: 'Medium-priority', low: 'Low-priority' };
    const priorityWord = priorityWords[inc.priority] || 'Priority';

    let summary = `${priorityWord} ${(inc.incident_type || 'security').replace(/_/g, ' ')} incident`;
    summary += inc.incident_number ? ` (${inc.incident_number})` : '';
    summary += ` — "${inc.title}"`;
    summary += inc.location ? `, reported at ${inc.location}` : '';
    summary += inc.reported_by ? `, reported by ${inc.reported_by}` : '';
    summary += `. `;

    // Timeline summary
    summary += `Created on ${new Date(inc.created_at).toLocaleString()}`;
    if (inc.acknowledged_at) {
      const respMs = new Date(inc.acknowledged_at).getTime() - new Date(inc.created_at).getTime();
      const respMin = Math.floor(respMs / 60000);
      summary += `; acknowledged in ${respMin} minute${respMin !== 1 ? 's' : ''}`;
    }
    if (inc.assigned_to) {
      summary += `; assigned to ${inc.assigned_to}`;
    }
    if (inc.resolved_at) {
      const resMs = new Date(inc.resolved_at).getTime() - new Date(inc.created_at).getTime();
      const resMin = Math.floor(resMs / 60000);
      const resStr = resMin < 60 ? `${resMin} minute${resMin !== 1 ? 's' : ''}` : `${Math.floor(resMin / 60)} hour${Math.floor(resMin / 60) !== 1 ? 's' : ''} ${resMin % 60} minute${resMin % 60 !== 1 ? 's' : ''}`;
      summary += `; resolved in ${resStr}`;
    }
    summary += `. `;

    if (inc.description) {
      summary += `Description: ${inc.description}. `;
    }

    // Updates summary
    const notes = updates.filter(u => u.update_type === 'note');
    const escalations = updates.filter(u => u.update_type === 'escalation');
    const statusChanges = updates.filter(u => u.update_type === 'status_change');

    if (escalations.length > 0) {
      summary += `The incident was escalated ${escalations.length} time${escalations.length !== 1 ? 's' : ''}. `;
    }
    if (notes.length > 0) {
      summary += `${notes.length} note${notes.length !== 1 ? 's were' : ' was'} added during the investigation. `;
    }
    if (statusChanges.length > 1) {
      summary += `The incident went through ${statusChanges.length} status changes. `;
    }

    // Linked alarms
    if (alarms.length > 0) {
      summary += `${alarms.length} alarm${alarms.length !== 1 ? 's were' : ' was'} linked to this incident`;
      const alarmTypes = [...new Set(alarms.map(a => a.alarm_type))];
      if (alarmTypes.length > 0) summary += ` (types: ${alarmTypes.join(', ')})`;
      summary += `. `;
    }

    if (inc.resolution_notes) {
      summary += `Resolution: ${inc.resolution_notes}. `;
    }

    // Current status
    summary += `Current status: ${inc.status}.`;

    // Save summary as an update
    const user = getUsername(request);
    const now = new Date().toISOString();
    const noteId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO incident_updates (id, incident_id, update_type, comment, updated_by, created_at)
       VALUES ($1, $2, 'note', $3, $4, $5)`,
      [noteId, id, `[AI Summary] ${summary}`, user, now]
    );
    await pool.query('UPDATE incidents SET updated_at = $1 WHERE id = $2 AND org_id = $3', [now, id, orgId]);

    return reply.send({
      summary,
      incident_id: id,
      linked_alarms: alarms.length,
      updates_count: updates.length,
      generated_at: now,
    });
  });

  // ─── GET /incidents/:id/timeline — Full chronological timeline ─

  fastify.get('/incidents/:id/timeline', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);

    const incRes = await pool.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (incRes.rows.length === 0) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const inc = incRes.rows[0];
    const timeline = [];

    // 1. Incident creation
    timeline.push({
      timestamp: inc.created_at,
      type: 'incident_created',
      title: 'Incident Created',
      detail: `${inc.title} — ${(inc.incident_type || 'other').replace(/_/g, ' ')} (${inc.priority} priority)`,
      actor: inc.reported_by || 'system',
    });

    // 2. All incident updates
    const updatesRes = await pool.query(
      'SELECT * FROM incident_updates WHERE incident_id = $1 ORDER BY created_at ASC', [id]
    );
    for (const u of updatesRes.rows) {
      let title = 'Update';
      if (u.update_type === 'status_change') title = `Status: ${u.old_value || '?'} → ${u.new_value || '?'}`;
      else if (u.update_type === 'assignment') title = `Assigned to ${u.new_value || 'unknown'}`;
      else if (u.update_type === 'escalation') title = `Escalated: ${u.old_value} → ${u.new_value}`;
      else if (u.update_type === 'note') title = 'Note Added';
      else if (u.update_type === 'evidence') title = 'Evidence Attached';

      timeline.push({
        timestamp: u.created_at,
        type: u.update_type,
        title,
        detail: u.comment || null,
        actor: u.updated_by,
      });
    }

    // 3. Linked alarms (tenant-scoped)
    const alarmsRes = await pool.query(
      'SELECT * FROM alarms WHERE org_id = $1 AND linked_incident_id = $2 ORDER BY created_at ASC',
      [orgId, id]
    ).catch((err) => { log.warn({ err, incidentId: id }, 'Failed to query linked alarms for incident timeline'); return { rows: [] }; });
    for (const a of alarmsRes.rows) {
      timeline.push({
        timestamp: a.created_at,
        type: 'alarm',
        title: `Alarm: ${a.title || a.alarm_number}`,
        detail: `${a.alarm_type} alarm (${a.priority}) — ${a.status}${a.location ? ' at ' + a.location : ''}`,
        actor: a.source_system || 'system',
      });
      if (a.acknowledged_at) {
        timeline.push({
          timestamp: a.acknowledged_at,
          type: 'alarm_acknowledged',
          title: `Alarm ${a.alarm_number} Acknowledged`,
          detail: null,
          actor: a.acknowledged_by || 'operator',
        });
      }
      if (a.resolved_at) {
        timeline.push({
          timestamp: a.resolved_at,
          type: 'alarm_resolved',
          title: `Alarm ${a.alarm_number} Resolved`,
          detail: a.resolution_notes || null,
          actor: a.resolved_by || 'operator',
        });
      }
    }

    // 4. Key timestamps from the incident itself
    if (inc.acknowledged_at) {
      // Only add if not already in updates
      const hasAck = updatesRes.rows.some(u => u.update_type === 'status_change' && u.new_value === 'acknowledged');
      if (!hasAck) {
        timeline.push({
          timestamp: inc.acknowledged_at,
          type: 'acknowledged',
          title: 'Incident Acknowledged',
          detail: null,
          actor: 'operator',
        });
      }
    }
    if (inc.resolved_at) {
      const hasResolved = updatesRes.rows.some(u => u.update_type === 'status_change' && u.new_value === 'resolved');
      if (!hasResolved) {
        timeline.push({
          timestamp: inc.resolved_at,
          type: 'resolved',
          title: 'Incident Resolved',
          detail: inc.resolution_notes || null,
          actor: 'operator',
        });
      }
    }
    if (inc.closed_at) {
      const hasClosed = updatesRes.rows.some(u => u.update_type === 'status_change' && u.new_value === 'closed');
      if (!hasClosed) {
        timeline.push({
          timestamp: inc.closed_at,
          type: 'closed',
          title: 'Incident Closed',
          detail: null,
          actor: 'operator',
        });
      }
    }

    // Sort everything chronologically
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return reply.send({
      incident: inc,
      timeline,
      total_events: timeline.length,
    });
  });

  log.info('Incident management routes registered');
}
