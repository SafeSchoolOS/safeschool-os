// @ts-nocheck
/**
 * Case Management Routes (SafeSchool)
 *
 * Investigation case management with evidence tracking and chain of custody.
 *
 * Routes:
 *   POST   /cases                        — Create case
 *   GET    /cases                        — List cases with filters
 *   GET    /cases/:id                    — Get case detail with evidence
 *   PUT    /cases/:id                    — Update case
 *   DELETE /cases/:id                    — Delete case
 *   POST   /cases/:id/evidence           — Add evidence
 *   GET    /cases/:id/evidence           — List evidence for case
 *   PUT    /cases/:caseId/evidence/:evidenceId — Update evidence
 *   POST   /cases/:id/link-incident      — Link incident to case
 *   POST   /cases/:id/link-alarm         — Link alarm to case
 *   GET    /cases/stats                  — Case stats
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import { getUsername, getOrgId, ensureOrgColumn } from './route-helpers.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import pg from 'pg';

const log = createLogger('cloud-sync:cases');

export interface CaseRoutesOptions {
  connectionString?: string;
}

const VALID_CASE_TYPES = ['investigation', 'complaint', 'theft', 'vandalism', 'harassment', 'workplace_violence', 'fraud', 'other'];
const VALID_CASE_STATUSES = ['open', 'active', 'pending_review', 'closed', 'archived'];
const VALID_EVIDENCE_TYPES = ['video', 'photo', 'document', 'audio', 'physical', 'digital'];
const VALID_EVIDENCE_STATUSES = ['collected', 'in_review', 'submitted', 'archived'];
const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];

function generateCaseNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 9999) + 1;
  return `CASE-${year}-${String(seq).padStart(4, '0')}`;
}

export async function caseRoutes(fastify: FastifyInstance, opts: CaseRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — case routes disabled');
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
    await ensureOrgColumn(pool, 'cases', 'cases');
    await ensureOrgColumn(pool, 'evidence', 'evidence');
    tableMigrated = true;
  }

  // ─── POST /cases — Create (tenant-scoped) ──────────────────────

  fastify.post('/cases', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.title) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let caseNumber = generateCaseNumber();
    const existing = await pool.query(
      'SELECT id FROM cases WHERE case_number = $1 AND org_id = $2',
      [caseNumber, orgId]
    );
    if (existing.rows.length > 0) {
      caseNumber = `CASE-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999) + 1).padStart(5, '0')}`;
    }

    try {
      await pool.query(
        `INSERT INTO cases (id, org_id, case_number, title, description, case_type, status, priority,
         lead_investigator, linked_incidents, linked_alarms, findings, recommendations,
         created_at, updated_at, closed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [id, orgId, caseNumber, body.title, body.description || '',
         VALID_CASE_TYPES.includes(body.case_type) ? body.case_type : 'other',
         'open',
         VALID_PRIORITIES.includes(body.priority) ? body.priority : 'medium',
         body.lead_investigator || getUsername(request),
         JSON.stringify(body.linked_incidents || []),
         JSON.stringify(body.linked_alarms || []),
         body.findings || null, body.recommendations || null,
         now, now, null]
      );
    } catch (err) {
      log.error({ err }, 'Failed to create case');
      return reply.code(500).send({ error: 'Failed to create case' });
    }

    log.info({ caseNumber, orgId, type: body.case_type }, 'Case created');
    const res = await pool.query('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.code(201).send(res.rows[0]);
  });

  // ─── GET /cases — List with filters ────────────────────────────

  fastify.get('/cases', async (request: FastifyRequest, reply: FastifyReply) => {
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
    if (q.case_type) {
      conditions.push(`case_type = $${idx++}`);
      params.push(q.case_type);
    }
    if (q.lead_investigator) {
      conditions.push(`lead_investigator = $${idx++}`);
      params.push(q.lead_investigator);
    }
    if (q.search) {
      conditions.push(`(title ILIKE $${idx} OR description ILIKE $${idx} OR case_number ILIKE $${idx})`);
      params.push(`%${q.search}%`);
      idx++;
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM cases ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT * FROM cases ${where} ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ cases: dataRes.rows, total, limit, offset });
  });

  // ─── GET /cases/stats — Case stats ─────────────────────────────

  fastify.get('/cases/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const [statusRes, typeRes, priorityRes, avgDurationRes] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count FROM cases WHERE org_id = $1 GROUP BY status`, [orgId]),
      pool.query(`SELECT case_type, COUNT(*) as count FROM cases WHERE org_id = $1 GROUP BY case_type ORDER BY count DESC`, [orgId]),
      pool.query(`SELECT priority, COUNT(*) as count FROM cases WHERE org_id = $1 AND status NOT IN ('closed','archived') GROUP BY priority`, [orgId]),
      pool.query(`SELECT AVG(EXTRACT(EPOCH FROM (closed_at::timestamp - created_at::timestamp)) / 86400) as avg_days FROM cases WHERE org_id = $1 AND closed_at IS NOT NULL`, [orgId]),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusRes.rows) byStatus[row.status] = parseInt(row.count);

    const byType: Record<string, number> = {};
    for (const row of typeRes.rows) byType[row.case_type] = parseInt(row.count);

    const byPriority: Record<string, number> = {};
    for (const row of priorityRes.rows) byPriority[row.priority] = parseInt(row.count);

    const avgDays = parseFloat(avgDurationRes.rows[0]?.avg_days || '0');

    return reply.send({
      open: byStatus.open || 0,
      active: byStatus.active || 0,
      pendingReview: byStatus.pending_review || 0,
      closed: byStatus.closed || 0,
      archived: byStatus.archived || 0,
      avgResolutionDays: Math.round(avgDays * 10) / 10,
      byStatus,
      byType,
      byPriority,
    });
  });

  // ─── GET /cases/:id — Detail with evidence ─────────────────────

  fastify.get('/cases/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };

    const caseRes = await pool.query('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (caseRes.rows.length === 0) {
      return reply.code(404).send({ error: 'Case not found' });
    }

    const evidenceRes = await pool.query(
      'SELECT * FROM evidence WHERE case_id = $1 AND COALESCE(org_id, $2) = $2 ORDER BY collected_at DESC',
      [id, orgId]
    );

    return reply.send({
      case: caseRes.rows[0],
      evidence: evidenceRes.rows,
    });
  });

  // ─── PUT /cases/:id — Update ───────────────────────────────────

  fastify.put('/cases/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const now = new Date().toISOString();

    const existing = await pool.query('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Case not found' });
    }

    const fields: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    const updatable = ['title', 'description', 'case_type', 'priority', 'lead_investigator', 'findings', 'recommendations'];
    for (const field of updatable) {
      if (body[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        values.push(body[field]);
      }
    }

    if (body.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(body.status);
      if (body.status === 'closed' || body.status === 'archived') {
        fields.push(`closed_at = $${idx++}`);
        values.push(now);
      }
    }

    values.push(id, orgId);
    await pool.query(
      `UPDATE cases SET ${fields.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`,
      values
    );

    const updated = await pool.query('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── DELETE /cases/:id (tenant-scoped) ─────────────────────────

  fastify.delete('/cases/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    // Delete evidence for this case (scoped via case_id which we've verified)
    const caseCheck = await pool.query('SELECT id FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (caseCheck.rows.length === 0) {
      return reply.code(404).send({ error: 'Case not found' });
    }
    await pool.query('DELETE FROM evidence WHERE case_id = $1', [id]);
    await pool.query('DELETE FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send({ success: true, deleted: id });
  });

  // ─── POST /cases/:id/evidence — Add evidence ──────────────────

  fastify.post('/cases/:id/evidence', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id: caseId } = request.params as { id: string };
    const body = request.body as any;

    const caseExists = await pool.query('SELECT id FROM cases WHERE id = $1 AND org_id = $2', [caseId, orgId]);
    if (caseExists.rows.length === 0) {
      return reply.code(404).send({ error: 'Case not found' });
    }

    if (!body?.title) {
      return reply.code(400).send({ error: 'title is required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const user = getUsername(request);

    const initialCustody = [{
      action: 'collected',
      by: body.collected_by || user,
      at: body.collected_at || now,
      notes: 'Evidence initially collected',
    }];

    await pool.query(
      `INSERT INTO evidence (id, org_id, case_id, evidence_type, title, description, file_url,
       metadata, collected_by, collected_at, chain_of_custody, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, orgId, caseId,
       VALID_EVIDENCE_TYPES.includes(body.evidence_type) ? body.evidence_type : 'digital',
       body.title, body.description || '', body.file_url || null,
       JSON.stringify(body.metadata || {}),
       body.collected_by || user, body.collected_at || now,
       JSON.stringify(body.chain_of_custody || initialCustody),
       'collected', now]
    );

    await pool.query('UPDATE cases SET updated_at = $1 WHERE id = $2 AND org_id = $3', [now, caseId, orgId]);

    const res = await pool.query('SELECT * FROM evidence WHERE id = $1 AND case_id = $2', [id, caseId]);
    return reply.code(201).send(res.rows[0]);
  });

  // ─── GET /cases/:id/evidence — List evidence (tenant-scoped) ──

  fastify.get('/cases/:id/evidence', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id: caseId } = request.params as { id: string };

    const caseExists = await pool.query('SELECT id FROM cases WHERE id = $1 AND org_id = $2', [caseId, orgId]);
    if (caseExists.rows.length === 0) {
      return reply.code(404).send({ error: 'Case not found' });
    }

    const res = await pool.query(
      'SELECT * FROM evidence WHERE case_id = $1 ORDER BY collected_at DESC',
      [caseId]
    );
    return reply.send({ evidence: res.rows, total: res.rows.length });
  });

  // ─── PUT /cases/:caseId/evidence/:evidenceId (tenant-scoped) ──

  fastify.put('/cases/:caseId/evidence/:evidenceId', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { caseId, evidenceId } = request.params as { caseId: string; evidenceId: string };
    const body = request.body as any;
    const now = new Date().toISOString();
    const user = getUsername(request);

    // Verify case ownership first
    const caseCheck = await pool.query('SELECT id FROM cases WHERE id = $1 AND org_id = $2', [caseId, orgId]);
    if (caseCheck.rows.length === 0) {
      return reply.code(404).send({ error: 'Case not found' });
    }

    const existing = await pool.query(
      'SELECT * FROM evidence WHERE id = $1 AND case_id = $2', [evidenceId, caseId]
    );
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Evidence not found' });
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (body.title !== undefined) { fields.push(`title = $${idx++}`); values.push(body.title); }
    if (body.description !== undefined) { fields.push(`description = $${idx++}`); values.push(body.description); }
    if (body.file_url !== undefined) { fields.push(`file_url = $${idx++}`); values.push(body.file_url); }
    if (body.status !== undefined) { fields.push(`status = $${idx++}`); values.push(body.status); }
    if (body.metadata !== undefined) { fields.push(`metadata = $${idx++}`); values.push(JSON.stringify(body.metadata)); }

    // Add custody transfer if provided
    if (body.custody_transfer) {
      const currentCustody = existing.rows[0].chain_of_custody || [];
      const parsed = typeof currentCustody === 'string' ? JSON.parse(currentCustody) : currentCustody;
      parsed.push({
        action: body.custody_transfer.action || 'transferred',
        by: body.custody_transfer.by || user,
        to: body.custody_transfer.to || null,
        at: now,
        notes: body.custody_transfer.notes || '',
      });
      fields.push(`chain_of_custody = $${idx++}`);
      values.push(JSON.stringify(parsed));
    }

    if (fields.length === 0) {
      return reply.send(existing.rows[0]);
    }

    values.push(evidenceId);
    await pool.query(`UPDATE evidence SET ${fields.join(', ')} WHERE id = $${idx}`, values);

    const updated = await pool.query('SELECT * FROM evidence WHERE id = $1', [evidenceId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /cases/:id/link-incident — Link incident ────────────

  fastify.post('/cases/:id/link-incident', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const incidentId = body?.incident_id;
    if (!incidentId) {
      return reply.code(400).send({ error: 'incident_id is required' });
    }

    const existing = await pool.query('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Case not found' });
    }

    const currentLinks = existing.rows[0].linked_incidents || [];
    const parsed = typeof currentLinks === 'string' ? JSON.parse(currentLinks) : currentLinks;
    if (!parsed.includes(incidentId)) {
      parsed.push(incidentId);
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE cases SET linked_incidents = $1, updated_at = $2 WHERE id = $3 AND org_id = $4`,
      [JSON.stringify(parsed), now, id, orgId]
    );

    const updated = await pool.query('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  // ─── POST /cases/:id/link-alarm (tenant-scoped) ────────────────

  fastify.post('/cases/:id/link-alarm', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const alarmId = body?.alarm_id;
    if (!alarmId) {
      return reply.code(400).send({ error: 'alarm_id is required' });
    }

    const existing = await pool.query('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Case not found' });
    }

    const currentLinks = existing.rows[0].linked_alarms || [];
    const parsed = typeof currentLinks === 'string' ? JSON.parse(currentLinks) : currentLinks;
    if (!parsed.includes(alarmId)) {
      parsed.push(alarmId);
    }

    const now = new Date().toISOString();
    await pool.query(
      `UPDATE cases SET linked_alarms = $1, updated_at = $2 WHERE id = $3 AND org_id = $4`,
      [JSON.stringify(parsed), now, id, orgId]
    );

    const updated = await pool.query('SELECT * FROM cases WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  log.info('Case management routes registered');
}
