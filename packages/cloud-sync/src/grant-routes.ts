// @ts-nocheck
/**
 * Grant Application Helper Routes (SafeSchool)
 *
 * Track school safety grants, auto-generate compliance data from system stats,
 * and manage the grant lifecycle from research to completion.
 *
 * All routes are tenant-scoped: each grant carries `org_id` and every
 * read/write filters by the caller's JWT org.
 *
 * Routes:
 *   POST   /grants                    — Create grant
 *   GET    /grants                    — List grants with filters
 *   GET    /grants/:id                — Get grant detail
 *   PUT    /grants/:id                — Update grant
 *   DELETE /grants/:id                — Delete grant
 *   GET    /grants/programs           — Known grant programs with deadlines
 *   GET    /grants/:id/compliance-data — Auto-generate compliance data
 *   GET    /grants/stats              — Grant tracking stats
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:grants');

const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

export interface GrantRoutesOptions {
  connectionString?: string;
}

// Known federal/state grant programs for school safety
const KNOWN_PROGRAMS = [
  { program: 'stop_school_violence', name: 'STOP School Violence Act', agency: 'DOJ/BJA', typical_amount: '$500,000 - $2,000,000', deadline: '2026-06-30', description: 'Evidence-based school safety improvements including threat assessment, technology, and training', url: 'https://bja.ojp.gov/program/stop-school-violence' },
  { program: 'bsca', name: 'Bipartisan Safer Communities Act', agency: 'DOJ', typical_amount: '$50,000 - $750,000', deadline: '2026-09-30', description: 'School safety infrastructure, mental health resources, and violence intervention programs', url: 'https://www.justice.gov/safer-communities' },
  { program: 'cops_svpp', name: 'COPS SVPP', agency: 'DOJ COPS Office', typical_amount: '$500,000 - $1,000,000', deadline: '2026-05-15', description: 'School Violence Prevention Program — security improvements and coordination with law enforcement', url: 'https://cops.usdoj.gov/svpp' },
  { program: 'state_specific', name: 'State School Safety Grant', agency: 'State DOE', typical_amount: 'Varies by state', deadline: 'Varies', description: 'State-specific school safety funding — contact your state DOE for details' },
  { program: 'erate', name: 'E-Rate Program', agency: 'FCC/USAC', typical_amount: 'Up to 90% discount', deadline: 'Rolling', description: 'Discounts for networking and security infrastructure in schools and libraries', url: 'https://www.usac.org/e-rate/' },
  { program: 'esser', name: 'ESSER III / ARP', agency: 'Dept of Education', typical_amount: 'Varies', deadline: '2026-09-30', description: 'Elementary & Secondary School Emergency Relief — safety improvements eligible', url: 'https://oese.ed.gov/offices/american-rescue-plan/' },
  { program: 'other', name: 'Other / Custom', agency: 'Various', typical_amount: 'Varies', deadline: 'Varies', description: 'Other grant programs or private funding sources' },
];

async function ensureGrantsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`ALTER TABLE grants ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
  await pool.query(`UPDATE grants SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_grants_org ON grants(org_id)`).catch(() => {});
}

export async function grantRoutes(fastify: FastifyInstance, opts: GrantRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — grant routes disabled');
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
    await ensureGrantsTable(pool);
    tableMigrated = true;
  }

  // ─── POST /grants — Create grant (tenant-scoped) ─────────────────

  fastify.post('/grants', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.grant_name) {
      return reply.code(400).send({ error: 'grant_name is required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await pool.query(
      `INSERT INTO grants (id, org_id, grant_name, grant_program, funding_agency, amount_requested, amount_awarded, status, deadline, submission_date, features_funded, compliance_data, notes, contact_name, contact_email, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
      [id, orgId, body.grant_name, body.grant_program || 'other', body.funding_agency || null,
       body.amount_requested || null, body.amount_awarded || null,
       body.status || 'researching', body.deadline || null, body.submission_date || null,
       JSON.stringify(body.features_funded || []), JSON.stringify(body.compliance_data || {}),
       body.notes || null, body.contact_name || null, body.contact_email || null, now]
    );

    const res = await pool.query('SELECT * FROM grants WHERE id = $1 AND org_id = $2', [id, orgId]);
    log.info({ grantName: body.grant_name, orgId }, 'Grant created');
    return reply.code(201).send(res.rows[0]);
  });

  // ─── GET /grants — List grants with filters (tenant-scoped) ──────

  fastify.get('/grants', async (request: FastifyRequest, reply: FastifyReply) => {
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
    if (q.grant_program) {
      conditions.push(`grant_program = $${idx++}`);
      params.push(q.grant_program);
    }
    if (q.search) {
      conditions.push(`(grant_name ILIKE $${idx} OR funding_agency ILIKE $${idx} OR notes ILIKE $${idx})`);
      params.push(`%${q.search}%`);
      idx++;
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM grants ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT * FROM grants ${where} ORDER BY CASE status WHEN 'drafting' THEN 0 WHEN 'researching' THEN 1 WHEN 'submitted' THEN 2 WHEN 'awarded' THEN 3 WHEN 'denied' THEN 4 WHEN 'completed' THEN 5 END, deadline ASC NULLS LAST LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ grants: dataRes.rows, total, limit, offset });
  });

  // ─── GET /grants/:id — Get grant detail (tenant-scoped) ──────────

  fastify.get('/grants/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query('SELECT * FROM grants WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (res.rows.length === 0) {
      return reply.code(404).send({ error: 'Grant not found' });
    }
    return reply.send(res.rows[0]);
  });

  // ─── PUT /grants/:id — Update grant (tenant-scoped) ──────────────

  fastify.put('/grants/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const now = new Date().toISOString();

    const existing = await pool.query('SELECT id FROM grants WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Grant not found' });
    }

    const fields: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    const updatable = ['grant_name', 'grant_program', 'funding_agency', 'amount_requested', 'amount_awarded', 'status', 'deadline', 'submission_date', 'notes', 'contact_name', 'contact_email'];
    for (const field of updatable) {
      if (body[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        values.push(body[field]);
      }
    }
    if (body.features_funded !== undefined) {
      fields.push(`features_funded = $${idx++}`);
      values.push(JSON.stringify(body.features_funded));
    }
    if (body.compliance_data !== undefined) {
      fields.push(`compliance_data = $${idx++}`);
      values.push(JSON.stringify(body.compliance_data));
    }

    values.push(id, orgId);
    await pool.query(
      `UPDATE grants SET ${fields.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`,
      values
    );

    const res = await pool.query('SELECT * FROM grants WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(res.rows[0]);
  });

  // ─── DELETE /grants/:id — Delete grant (tenant-scoped) ───────────

  fastify.delete('/grants/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query('DELETE FROM grants WHERE id = $1 AND org_id = $2', [id, orgId]);
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Grant not found' });
    }
    return reply.send({ success: true, deleted: id });
  });

  // ─── GET /grants/programs — Known grant programs (public-ish) ────

  fastify.get('/grants/programs', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ programs: KNOWN_PROGRAMS });
  });

  // ─── GET /grants/:id/compliance-data — Auto-generate (tenant-scoped) ─

  fastify.get('/grants/:id/compliance-data', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const orgId = getOrgId(request);

    const existing = await pool.query('SELECT * FROM grants WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Grant not found' });
    }

    // Pull real system stats for compliance reporting (tenant-scoped)
    const now = new Date();
    const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const [drillCount, incidentCount, visitorCount, panicCount, alarmCount] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM drills WHERE org_id = $1 AND created_at >= $2`, [orgId, yearAgo]).catch(() => ({ rows: [{ count: '0' }] })),
      pool.query(`SELECT COUNT(*) as count FROM incidents WHERE org_id = $1 AND created_at >= $2`, [orgId, yearAgo]).catch(() => ({ rows: [{ count: '0' }] })),
      pool.query(`SELECT COUNT(*) as total FROM sync_entities WHERE COALESCE(org_id, $1) = $1 AND entity_type = 'visitor' AND updated_at >= $2`, [orgId, yearAgo]).catch(() => ({ rows: [{ total: '0' }] })),
      pool.query(`SELECT COUNT(*) as count FROM panic_alerts WHERE org_id = $1 AND created_at >= $2`, [orgId, yearAgo]).catch(() => ({ rows: [{ count: '0' }] })),
      pool.query(`SELECT COUNT(*) as count FROM alarms WHERE org_id = $1 AND created_at >= $2`, [orgId, yearAgo]).catch(() => ({ rows: [{ count: '0' }] })),
    ]);

    const complianceData = {
      generated_at: now.toISOString(),
      reporting_period: { start: yearAgo, end: now.toISOString() },
      drills: {
        total_conducted: parseInt(drillCount.rows[0]?.count || '0'),
        description: 'Safety drills conducted during reporting period',
      },
      incidents: {
        total_reported: parseInt(incidentCount.rows[0]?.count || '0'),
        description: 'Security incidents reported and tracked',
      },
      visitors: {
        total_screened: parseInt(visitorCount.rows[0]?.total || '0'),
        description: 'Visitor check-ins with screening',
      },
      panic_alerts: {
        total_triggered: parseInt(panicCount.rows[0]?.count || '0'),
        description: 'Panic button activations (Alyssa\'s Law compliance)',
      },
      alarms: {
        total_processed: parseInt(alarmCount.rows[0]?.count || '0'),
        description: 'Security alarms received and processed',
      },
      system_capabilities: [
        'Visitor management with watchlist screening',
        'Silent panic button system (Alyssa\'s Law compliant)',
        'Drill scheduling and compliance tracking',
        'Incident management and reporting',
        'Access control integration',
        'Camera/video surveillance integration',
        'Emergency notification system',
        'Digital hall pass tracking',
      ],
    };

    // Persist the generated data on the grant row (scoped)
    await pool.query(
      `UPDATE grants SET compliance_data = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
      [JSON.stringify(complianceData), id, orgId]
    );

    return reply.send(complianceData);
  });

  // ─── GET /grants/stats — Grant tracking stats (tenant-scoped) ────

  fastify.get('/grants/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const [statusRes, totalReqRes, totalAwardRes] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count FROM grants WHERE org_id = $1 GROUP BY status`, [orgId]),
      pool.query(`SELECT COALESCE(SUM(amount_requested), 0) as total FROM grants WHERE org_id = $1`, [orgId]),
      pool.query(`SELECT COALESCE(SUM(amount_awarded), 0) as total FROM grants WHERE org_id = $1 AND (status = 'awarded' OR status = 'completed')`, [orgId]),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusRes.rows) {
      byStatus[row.status] = parseInt(row.count);
    }

    const totalRequested = parseFloat(totalReqRes.rows[0]?.total || '0');
    const totalAwarded = parseFloat(totalAwardRes.rows[0]?.total || '0');
    const totalGrants = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const awardedCount = (byStatus.awarded || 0) + (byStatus.completed || 0);
    const submittedCount = (byStatus.submitted || 0) + awardedCount + (byStatus.denied || 0);
    const successRate = submittedCount > 0 ? Math.round((awardedCount / submittedCount) * 100) : 0;

    return reply.send({
      totalGrants,
      totalRequested,
      totalAwarded,
      successRate,
      byStatus,
    });
  });

  log.info('Grant routes registered');
}
