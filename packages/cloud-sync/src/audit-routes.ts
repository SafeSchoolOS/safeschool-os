// @ts-nocheck
/**
 * Audit & Compliance Reporting Routes
 *
 * Full audit logging and compliance report generation.
 *
 * Routes:
 *   POST   /audit/log           — Record audit event
 *   GET    /audit/log           — Query audit log with filters
 *   GET    /audit/log/export    — Export audit log as CSV/JSON
 *   POST   /reports/generate    — Generate compliance report
 *   GET    /reports             — List generated reports
 *   GET    /reports/:id         — Get report data
 *   DELETE /reports/:id         — Delete report
 *   GET    /audit/stats         — Audit dashboard stats
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import { getUsername, getUserRole, getIpAddress, getOrgId } from './route-helpers.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import pg from 'pg';

const log = createLogger('cloud-sync:audit');

export interface AuditRoutesOptions {
  connectionString?: string;
}

export async function auditRoutes(fastify: FastifyInstance, opts: AuditRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — audit routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Ensure audit tables exist
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        actor_role TEXT,
        target_type TEXT,
        target_id TEXT,
        target_name TEXT,
        details JSONB DEFAULT '{}',
        ip_address TEXT,
        device_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action);
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor);
      CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log (target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

      CREATE TABLE IF NOT EXISTS compliance_reports (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        report_type TEXT NOT NULL,
        title TEXT NOT NULL,
        parameters JSONB DEFAULT '{}',
        generated_by TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'json',
        data JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_reports_type ON compliance_reports (report_type);
      CREATE INDEX IF NOT EXISTS idx_reports_created ON compliance_reports (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reports_generated_by ON compliance_reports (generated_by);
    `);
    // Backfill org_id on audit tables created before tenant isolation was added.
    await pool.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS org_id TEXT`);
    await pool.query(`ALTER TABLE compliance_reports ADD COLUMN IF NOT EXISTS org_id TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log (org_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reports_org ON compliance_reports (org_id)`);
    log.info('Audit tables ensured');
  } catch (err) {
    log.error({ err }, 'Failed to create audit tables');
  }

  // ─── POST /audit/log — Record audit event ─────────────────────

  fastify.post('/audit/log', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    if (!body?.action) {
      return reply.code(400).send({ error: 'action is required' });
    }

    // Accept any non-empty action string — client sends freeform actions
    // like door.lock, cardholder.create, lockdown.initiate, etc.
    if (typeof body.action !== 'string' || body.action.length === 0 || body.action.length > 100) {
      return reply.code(400).send({ error: 'action must be a non-empty string (max 100 chars)' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const entry = {
      id,
      org_id: getOrgId(request),
      action: body.action,
      actor: body.actor || getUsername(request),
      actor_role: body.actor_role || getUserRole(request),
      target_type: body.target_type || null,
      target_id: body.target_id || null,
      target_name: body.target_name || null,
      details: body.details ? JSON.stringify(body.details) : '{}',
      ip_address: body.ip_address || getIpAddress(request),
      device_id: body.device_id || null,
      created_at: now,
    };

    try {
      await pool.query(
        `INSERT INTO audit_log (id, org_id, action, actor, actor_role, target_type, target_id, target_name, details, ip_address, device_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [entry.id, entry.org_id, entry.action, entry.actor, entry.actor_role, entry.target_type,
         entry.target_id, entry.target_name, entry.details, entry.ip_address,
         entry.device_id, entry.created_at]
      );
    } catch (err) {
      log.error({ err }, 'Failed to record audit event');
      return reply.code(500).send({ error: 'Failed to record audit event' });
    }

    log.info({ action: entry.action, actor: entry.actor }, 'Audit event recorded');
    return reply.code(201).send(entry);
  });

  // ─── GET /audit/log — Query audit log with filters ────────────

  fastify.get('/audit/log', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (q.action) {
      conditions.push(`action = $${idx++}`);
      params.push(q.action);
    }
    if (q.actor) {
      conditions.push(`actor ILIKE $${idx++}`);
      params.push(`%${q.actor}%`);
    }
    if (q.target_type) {
      conditions.push(`target_type = $${idx++}`);
      params.push(q.target_type);
    }
    if (q.target_id) {
      conditions.push(`target_id = $${idx++}`);
      params.push(q.target_id);
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
      conditions.push(`(actor ILIKE $${idx} OR target_name ILIKE $${idx} OR action ILIKE $${idx})`);
      params.push(`%${q.search}%`);
      idx++;
    }
    if (q.device_id) {
      conditions.push(`device_id = $${idx++}`);
      params.push(q.device_id);
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const ALLOWED_SORT = new Set(['created_at', 'action', 'actor', 'target_type', 'target_id', 'device_id']);
    const rawSort = (q.sort || 'created_at').toLowerCase();
    const sortField = ALLOWED_SORT.has(rawSort) ? rawSort : 'created_at';
    const sortDir = q.order === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM audit_log ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY ${sortField} ${sortDir} LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ entries: dataRes.rows, total, limit, offset });
  });

  // ─── GET /audit/log/export — Export audit log as CSV/JSON ─────

  fastify.get('/audit/log/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const format = q.format || 'json';
    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (q.action) {
      conditions.push(`action = $${idx++}`);
      params.push(q.action);
    }
    if (q.actor) {
      conditions.push(`actor ILIKE $${idx++}`);
      params.push(`%${q.actor}%`);
    }
    if (q.since) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(q.since);
    }
    if (q.until) {
      conditions.push(`created_at <= $${idx++}`);
      params.push(q.until);
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(parseInt(q.limit || '10000', 10), 50000);

    const dataRes = await pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      [...params, limit]
    );

    if (format === 'csv') {
      const header = 'id,action,actor,actor_role,target_type,target_id,target_name,ip_address,device_id,created_at\n';
      const rows = dataRes.rows.map(r =>
        [r.id, r.action, r.actor, r.actor_role, r.target_type, r.target_id,
         r.target_name, r.ip_address, r.device_id, r.created_at]
        .map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(',')
      ).join('\n');

      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="audit-log.csv"')
        .send(header + rows);
    }

    return reply.send({ entries: dataRes.rows, total: dataRes.rows.length });
  });

  // ─── GET /audit/stats — Audit dashboard stats ─────────────────

  fastify.get('/audit/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [totalRes, todayRes, byActionRes, topActorsRes, dailyRes] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM audit_log WHERE COALESCE(org_id, $1) = $1', [orgId]),
      pool.query('SELECT COUNT(*) as count FROM audit_log WHERE COALESCE(org_id, $1) = $1 AND created_at >= $2', [orgId, todayStr]),
      pool.query('SELECT action, COUNT(*) as count FROM audit_log WHERE COALESCE(org_id, $1) = $1 GROUP BY action ORDER BY count DESC', [orgId]),
      pool.query('SELECT actor, COUNT(*) as count FROM audit_log WHERE COALESCE(org_id, $1) = $1 GROUP BY actor ORDER BY count DESC LIMIT 10', [orgId]),
      pool.query(
        `SELECT DATE(created_at) as day, COUNT(*) as count FROM audit_log
         WHERE COALESCE(org_id, $1) = $1 AND created_at >= $2
         GROUP BY DATE(created_at)
         ORDER BY day ASC`, [orgId, weekAgo]
      ),
    ]);

    const byAction: Record<string, number> = {};
    for (const row of byActionRes.rows) {
      byAction[row.action] = parseInt(row.count);
    }

    const topActors = topActorsRes.rows.map(r => ({ actor: r.actor, count: parseInt(r.count) }));
    const daily = dailyRes.rows.map(r => ({ day: r.day, count: parseInt(r.count) }));

    return reply.send({
      totalEntries: parseInt(totalRes.rows[0].total),
      todayEntries: parseInt(todayRes.rows[0].count),
      byAction,
      topActors,
      daily,
    });
  });

  // ─── POST /reports/generate — Generate compliance report ──────

  fastify.post('/reports/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.report_type) {
      return reply.code(400).send({ error: 'report_type is required' });
    }

    const validTypes = [
      'access_audit', 'visitor_log', 'incident_summary', 'alarm_summary',
      'guard_tour', 'drill_compliance', 'user_activity', 'door_activity',
    ];
    if (!validTypes.includes(body.report_type)) {
      return reply.code(400).send({ error: 'Invalid report_type. Valid types: ' + validTypes.join(', ') });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const since = body.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const until = body.until || now;
    const format = body.format || 'json';
    const title = body.title || body.report_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' Report';

    // Generate report data based on type
    let reportData: any = {};

    try {
      switch (body.report_type) {
        case 'access_audit': {
          const res = await pool.query(
            `SELECT * FROM audit_log WHERE COALESCE(org_id, $1) = $1
             AND action IN ('door_unlock','door_lock','login','logout')
             AND created_at >= $2 AND created_at <= $3 ORDER BY created_at DESC LIMIT 5000`,
            [orgId, since, until]
          );
          reportData = {
            entries: res.rows,
            total: res.rows.length,
            dateRange: { since, until },
            generatedAt: now,
          };
          break;
        }
        case 'visitor_log': {
          const res = await pool.query(
            `SELECT * FROM audit_log WHERE COALESCE(org_id, $1) = $1 AND action = 'visitor_checkin'
             AND created_at >= $2 AND created_at <= $3 ORDER BY created_at DESC LIMIT 5000`,
            [orgId, since, until]
          );
          reportData = {
            entries: res.rows,
            total: res.rows.length,
            dateRange: { since, until },
            generatedAt: now,
          };
          break;
        }
        case 'incident_summary': {
          const res = await pool.query(
            `SELECT * FROM incidents WHERE org_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at DESC`,
            [orgId, since, until]
          );
          const byStatus: Record<string, number> = {};
          const byPriority: Record<string, number> = {};
          for (const row of res.rows) {
            byStatus[row.status] = (byStatus[row.status] || 0) + 1;
            byPriority[row.priority] = (byPriority[row.priority] || 0) + 1;
          }
          reportData = {
            incidents: res.rows,
            total: res.rows.length,
            byStatus,
            byPriority,
            dateRange: { since, until },
            generatedAt: now,
          };
          break;
        }
        case 'alarm_summary': {
          const res = await pool.query(
            `SELECT * FROM alarms WHERE org_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at DESC`,
            [orgId, since, until]
          );
          const byStatus: Record<string, number> = {};
          const byType: Record<string, number> = {};
          for (const row of res.rows) {
            byStatus[row.status] = (byStatus[row.status] || 0) + 1;
            byType[row.alarm_type] = (byType[row.alarm_type] || 0) + 1;
          }
          reportData = {
            alarms: res.rows,
            total: res.rows.length,
            byStatus,
            byType,
            dateRange: { since, until },
            generatedAt: now,
          };
          break;
        }
        case 'user_activity': {
          const res = await pool.query(
            `SELECT actor, action, COUNT(*) as count FROM audit_log
             WHERE COALESCE(org_id, $1) = $1 AND created_at >= $2 AND created_at <= $3
             GROUP BY actor, action ORDER BY count DESC`,
            [orgId, since, until]
          );
          reportData = {
            activities: res.rows,
            dateRange: { since, until },
            generatedAt: now,
          };
          break;
        }
        case 'door_activity': {
          const res = await pool.query(
            `SELECT * FROM audit_log WHERE COALESCE(org_id, $1) = $1 AND target_type = 'door'
             AND created_at >= $2 AND created_at <= $3 ORDER BY created_at DESC LIMIT 5000`,
            [orgId, since, until]
          );
          reportData = {
            entries: res.rows,
            total: res.rows.length,
            dateRange: { since, until },
            generatedAt: now,
          };
          break;
        }
        default: {
          reportData = {
            message: 'Report type not yet implemented with live data',
            dateRange: { since, until },
            generatedAt: now,
          };
        }
      }
    } catch (err) {
      log.warn({ err, reportType: body.report_type }, 'Error generating report data, storing empty');
      reportData = { error: 'Failed to gather data', dateRange: { since, until }, generatedAt: now };
    }

    const parameters = { since, until, filters: body.filters || {} };

    try {
      await pool.query(
        `INSERT INTO compliance_reports (id, org_id, report_type, title, parameters, generated_by, format, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, orgId, body.report_type, title, JSON.stringify(parameters), getUsername(request),
         format, JSON.stringify(reportData), now]
      );
    } catch (err) {
      log.error({ err }, 'Failed to save report');
      return reply.code(500).send({ error: 'Failed to save report' });
    }

    // Record in audit log
    try {
      await pool.query(
        `INSERT INTO audit_log (id, org_id, action, actor, actor_role, target_type, target_id, target_name, details, ip_address, created_at)
         VALUES ($1, $2, 'report_generate', $3, $4, 'report', $5, $6, $7, $8, $9)`,
        [crypto.randomUUID(), orgId, getUsername(request), getUserRole(request), id, title,
         JSON.stringify({ report_type: body.report_type }), getIpAddress(request), now]
      );
    } catch (err) { log.debug({ err }, 'Failed to write report generation audit log entry'); }

    log.info({ reportType: body.report_type, id }, 'Compliance report generated');
    return reply.code(201).send({
      id, report_type: body.report_type, title, parameters, format,
      generated_by: getUsername(request), created_at: now, data: reportData,
    });
  });

  // ─── GET /reports — List generated reports ────────────────────

  fastify.get('/reports', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (q.report_type) {
      conditions.push(`report_type = $${idx++}`);
      params.push(q.report_type);
    }
    if (q.generated_by) {
      conditions.push(`generated_by = $${idx++}`);
      params.push(q.generated_by);
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 200);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM compliance_reports ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    // Don't include full data in list view for performance
    const dataRes = await pool.query(
      `SELECT id, report_type, title, parameters, generated_by, format, created_at
       FROM compliance_reports ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ reports: dataRes.rows, total, limit, offset });
  });

  // ─── GET /reports/:id — Get report data ───────────────────────

  fastify.get('/reports/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query(
      'SELECT * FROM compliance_reports WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (res.rows.length === 0) {
      return reply.code(404).send({ error: 'Report not found' });
    }
    return reply.send(res.rows[0]);
  });

  // ─── DELETE /reports/:id — Delete report (tenant-scoped) ──────────

  fastify.delete('/reports/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query(
      'DELETE FROM compliance_reports WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Report not found' });
    }
    return reply.send({ success: true, deleted: id });
  });

  log.info('Audit & compliance routes registered');
}
