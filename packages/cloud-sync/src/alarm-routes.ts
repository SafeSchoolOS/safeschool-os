// @ts-nocheck
/**
 * Alarm Queue Routes
 *
 * Priority-based alarm triage system for GSOC operations.
 * Operators monitor, acknowledge, assign, and resolve alarms in real-time.
 *
 * Mount behind JWT auth at prefix '/api/v1/alarms'.
 * Also provides a public ingest endpoint for connector/federation event ingestion.
 *
 * Tenant isolation: every row carries `org_id`. Reads filter by the caller's
 * JWT org; writes stamp it in. The public ingest endpoint accepts `org_id` in
 * the payload (falls back to DEFAULT_ORG) since it has no JWT.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getUser, getOrgId, safeEqualSecret } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:alarms');

/** Default SLA deadlines in milliseconds per priority */
const SLA_DEFAULTS_MS = {
  critical: 2 * 60 * 1000,   // 2 minutes
  high: 5 * 60 * 1000,       // 5 minutes
  medium: 15 * 60 * 1000,    // 15 minutes
  low: 60 * 60 * 1000,       // 60 minutes
  info: 0,                    // no SLA
};

const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

export interface AlarmRoutesOptions {
  connectionString?: string;
}

async function ensureAlarmsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alarms (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG.replace(/'/g, "''")}',
      alarm_number TEXT,
      source_system TEXT DEFAULT 'manual',
      source_event_id TEXT,
      alarm_type TEXT DEFAULT 'other',
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'new',
      title TEXT,
      description TEXT,
      location TEXT,
      site_id TEXT,
      zone TEXT,
      device_name TEXT,
      assigned_to TEXT,
      auto_actions_taken TEXT,
      linked_incident_id TEXT,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      resolved_at TEXT,
      resolved_by TEXT,
      resolution_notes TEXT,
      sla_deadline TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alarms_status ON alarms(status);
    CREATE INDEX IF NOT EXISTS idx_alarms_priority ON alarms(priority);
    CREATE INDEX IF NOT EXISTS idx_alarms_created ON alarms(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alarms_site ON alarms(site_id);
  `);
  // Backfill org_id column on tables created before multi-tenant isolation was added.
  await pool.query(`ALTER TABLE alarms ADD COLUMN IF NOT EXISTS org_id TEXT`);
  await pool.query(`UPDATE alarms SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_alarms_org ON alarms(org_id)`);
}

export async function alarmRoutes(fastify: FastifyInstance, opts: AlarmRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — alarm routes disabled');
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
    await ensureAlarmsTable(pool);
    tableMigrated = true;
  }

  // ─── GET /active/count — Active alarm count for dashboard cards (tenant-scoped) ────
  fastify.get('/active/count', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const params: any[] = [orgId];
      let sql = `SELECT COUNT(*) as count FROM alarms WHERE org_id = $1 AND status IN ('active', 'new', 'acknowledged')`;
      if (q.type) {
        params.push(q.type);
        sql += ` AND alarm_type = $${params.length}`;
      }
      const { rows } = await pool.query(sql, params);
      return reply.send({ count: parseInt(rows[0]?.count || '0', 10) });
    } catch {
      return reply.send({ count: 0 });
    }
  });

  // ─── Helper: generate alarm number (per-tenant) ──────────────────────────────
  async function nextAlarmNumber(orgId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `ALM-${year}-`;
    try {
      const { rows } = await pool.query(
        `SELECT alarm_number FROM alarms WHERE org_id = $1 AND alarm_number LIKE $2 ORDER BY alarm_number DESC LIMIT 1`,
        [orgId, prefix + '%']
      );
      if (rows.length > 0) {
        const last = parseInt(rows[0].alarm_number.replace(prefix, ''), 10);
        return prefix + String(last + 1).padStart(4, '0');
      }
    } catch (err) { log.debug({ err }, 'Failed to query last alarm number (may be first alarm)'); }
    return prefix + '0001';
  }

  // ─── POST /alarms — Create new alarm (tenant-scoped) ──────────────────────────
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const now = new Date().toISOString();
      const id = body.id || crypto.randomUUID();
      const alarmNumber = await nextAlarmNumber(orgId);
      const priority = body.priority || 'medium';
      const slaDeadline = body.sla_deadline || (SLA_DEFAULTS_MS[priority]
        ? new Date(Date.now() + SLA_DEFAULTS_MS[priority]).toISOString()
        : null);

      await pool.query(`
        INSERT INTO alarms (id, org_id, alarm_number, source_system, source_event_id, alarm_type, priority,
          status, title, description, location, zone, device_name, assigned_to, auto_actions_taken,
          linked_incident_id, created_at, updated_at, sla_deadline)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      `, [
        id, orgId, alarmNumber,
        body.source_system || 'manual',
        body.source_event_id || null,
        body.alarm_type || 'other',
        priority,
        'new',
        body.title || 'Untitled Alarm',
        body.description || null,
        body.location || null,
        body.zone || null,
        body.device_name || null,
        body.assigned_to || null,
        body.auto_actions_taken ? JSON.stringify(body.auto_actions_taken) : null,
        body.linked_incident_id || null,
        now, now, slaDeadline,
      ]);

      log.info({ id, orgId, alarmNumber, priority, type: body.alarm_type }, 'Alarm created');
      return reply.code(201).send({ id, alarm_number: alarmNumber, status: 'new', priority });
    } catch (err) {
      log.error({ err }, 'Failed to create alarm');
      return reply.code(500).send({ error: 'Failed to create alarm' });
    }
  });

  // ─── GET /alarms — List with filtering (tenant-scoped) ────────────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['org_id = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
      if (q.priority) { conditions.push(`priority = $${idx++}`); params.push(q.priority); }
      if (q.alarm_type) { conditions.push(`alarm_type = $${idx++}`); params.push(q.alarm_type); }
      if (q.source_system) { conditions.push(`source_system = $${idx++}`); params.push(q.source_system); }
      if (q.zone) { conditions.push(`zone = $${idx++}`); params.push(q.zone); }
      if (q.assigned_to) { conditions.push(`assigned_to = $${idx++}`); params.push(q.assigned_to); }
      if (q.since) { conditions.push(`created_at >= $${idx++}`); params.push(q.since); }
      if (q.until) { conditions.push(`created_at <= $${idx++}`); params.push(q.until); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);
      const offset = Math.max(parseInt(q.offset || '0', 10), 0);

      const countRes = await pool.query(`SELECT COUNT(*) as total FROM alarms ${where}`, params);
      const total = parseInt(countRes.rows[0].total, 10);

      const dataRes = await pool.query(
        `SELECT * FROM alarms ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return reply.send({ alarms: dataRes.rows, total, limit, offset });
    } catch (err) {
      log.error({ err }, 'Failed to list alarms');
      return reply.code(500).send({ error: 'Failed to list alarms' });
    }
  });

  // ─── GET /alarms/queue — Active alarm queue (tenant-scoped, priority-sorted) ──
  fastify.get('/queue', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '200', 10), 1), 1000);

      const { rows } = await pool.query(`
        SELECT * FROM alarms
        WHERE org_id = $1 AND status IN ('new', 'acknowledged', 'investigating', 'dispatched')
        ORDER BY
          CASE priority
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
            WHEN 'info' THEN 4
          END ASC,
          created_at ASC
        LIMIT $2
      `, [orgId, limit]);

      return reply.send({ alarms: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to get alarm queue');
      return reply.code(500).send({ error: 'Failed to get alarm queue' });
    }
  });

  // ─── GET /alarms/stats — Dashboard statistics (tenant-scoped) ──────────────────
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      // Active alarms by priority
      const activeRes = await pool.query(`
        SELECT priority, COUNT(*) as count FROM alarms
        WHERE org_id = $1 AND status IN ('new', 'acknowledged', 'investigating', 'dispatched')
        GROUP BY priority
      `, [orgId]);
      const activeCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
      for (const row of activeRes.rows) {
        activeCounts[row.priority] = parseInt(row.count, 10);
        activeCounts.total += parseInt(row.count, 10);
      }

      // Average acknowledgment time (last 24h)
      const ackRes = await pool.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (acknowledged_at::timestamp - created_at::timestamp))) as avg_ack_seconds
        FROM alarms
        WHERE org_id = $1 AND acknowledged_at IS NOT NULL
          AND created_at >= NOW() - INTERVAL '24 hours'
      `, [orgId]);
      const avgAckSeconds = ackRes.rows[0]?.avg_ack_seconds ? Math.round(parseFloat(ackRes.rows[0].avg_ack_seconds)) : 0;

      // False alarm rate (last 7 days)
      const falseRes = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'false_alarm') as false_count,
          COUNT(*) as total_resolved
        FROM alarms
        WHERE org_id = $1 AND status IN ('resolved', 'false_alarm', 'auto_cleared')
          AND resolved_at IS NOT NULL
          AND created_at >= NOW() - INTERVAL '7 days'
      `, [orgId]);
      const falseCount = parseInt(falseRes.rows[0]?.false_count || '0', 10);
      const totalResolved = parseInt(falseRes.rows[0]?.total_resolved || '0', 10);
      const falseAlarmRate = totalResolved > 0 ? Math.round((falseCount / totalResolved) * 100) : 0;

      // Alarms today
      const todayRes = await pool.query(`
        SELECT COUNT(*) as count FROM alarms
        WHERE org_id = $1 AND created_at >= CURRENT_DATE
      `, [orgId]);
      const alarmsToday = parseInt(todayRes.rows[0]?.count || '0', 10);

      // Alarms per hour (last 24h)
      const hourRes = await pool.query(`
        SELECT COUNT(*) as count FROM alarms
        WHERE org_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
      `, [orgId]);
      const alarmsLast24h = parseInt(hourRes.rows[0]?.count || '0', 10);
      const alarmsPerHour = Math.round((alarmsLast24h / 24) * 10) / 10;

      // SLA breach count
      const slaRes = await pool.query(`
        SELECT COUNT(*) as count FROM alarms
        WHERE org_id = $1 AND status IN ('new', 'acknowledged')
          AND sla_deadline IS NOT NULL
          AND sla_deadline < NOW()::text
      `, [orgId]);
      const slaBreached = parseInt(slaRes.rows[0]?.count || '0', 10);

      return reply.send({
        active: activeCounts,
        avgAckSeconds,
        falseAlarmRate,
        alarmsToday,
        alarmsPerHour,
        slaBreached,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get alarm stats');
      return reply.code(500).send({ error: 'Failed to get alarm stats' });
    }
  });

  // ─── GET /alarms/recent — Last 50 alarms for real-time feed (tenant-scoped) ────
  fastify.get('/recent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { rows } = await pool.query(
        `SELECT * FROM alarms WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [orgId]
      );
      return reply.send({ alarms: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to get recent alarms');
      return reply.code(500).send({ error: 'Failed to get recent alarms' });
    }
  });

  // ─── GET /alarms/:id — Alarm details (tenant-scoped) ──────────────────────────
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const { rows } = await pool.query('SELECT * FROM alarms WHERE id = $1 AND org_id = $2', [id, orgId]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Alarm not found' });
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to get alarm');
      return reply.code(500).send({ error: 'Failed to get alarm' });
    }
  });

  // ─── POST /alarms/:id/acknowledge (tenant-scoped) ─────────────────────────────
  fastify.post('/:id/acknowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const user = getUser(request);
      const now = new Date().toISOString();
      const { rowCount } = await pool.query(`
        UPDATE alarms SET status = 'acknowledged', acknowledged_at = $1, acknowledged_by = $2, updated_at = $1
        WHERE id = $3 AND org_id = $4 AND status = 'new'
      `, [now, user.username || user.sub || 'operator', id, orgId]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Alarm not found or already acknowledged' });
      log.info({ id, orgId, by: user.username }, 'Alarm acknowledged');
      return reply.send({ success: true, status: 'acknowledged' });
    } catch (err) {
      log.error({ err }, 'Failed to acknowledge alarm');
      return reply.code(500).send({ error: 'Failed to acknowledge alarm' });
    }
  });

  // ─── POST /alarms/:id/assign (tenant-scoped) ──────────────────────────────────
  fastify.post('/:id/assign', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const now = new Date().toISOString();
      const { rowCount } = await pool.query(`
        UPDATE alarms SET assigned_to = $1, status = CASE WHEN status = 'new' THEN 'acknowledged' ELSE status END, updated_at = $2
        WHERE id = $3 AND org_id = $4
      `, [body.assigned_to || body.operator, now, id, orgId]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Alarm not found' });
      return reply.send({ success: true, assigned_to: body.assigned_to || body.operator });
    } catch (err) {
      log.error({ err }, 'Failed to assign alarm');
      return reply.code(500).send({ error: 'Failed to assign alarm' });
    }
  });

  // ─── POST /alarms/:id/resolve (tenant-scoped) ─────────────────────────────────
  fastify.post('/:id/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const user = getUser(request);
      const now = new Date().toISOString();
      const { rowCount } = await pool.query(`
        UPDATE alarms SET status = 'resolved', resolved_at = $1, resolved_by = $2,
          resolution_notes = $3, updated_at = $1
        WHERE id = $4 AND org_id = $5 AND status NOT IN ('resolved', 'false_alarm', 'auto_cleared')
      `, [now, user.username || user.sub || 'operator', body.resolution_notes || body.notes || null, id, orgId]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Alarm not found or already resolved' });
      log.info({ id, orgId, by: user.username }, 'Alarm resolved');
      return reply.send({ success: true, status: 'resolved' });
    } catch (err) {
      log.error({ err }, 'Failed to resolve alarm');
      return reply.code(500).send({ error: 'Failed to resolve alarm' });
    }
  });

  // ─── POST /alarms/:id/false-alarm (tenant-scoped) ────────────────────────────
  fastify.post('/:id/false-alarm', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const user = getUser(request);
      const now = new Date().toISOString();
      const { rowCount } = await pool.query(`
        UPDATE alarms SET status = 'false_alarm', resolved_at = $1, resolved_by = $2,
          resolution_notes = 'Marked as false alarm', updated_at = $1
        WHERE id = $3 AND org_id = $4 AND status NOT IN ('resolved', 'false_alarm', 'auto_cleared')
      `, [now, user.username || user.sub || 'operator', id, orgId]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Alarm not found or already resolved' });
      log.info({ id, orgId, by: user.username }, 'Alarm marked false alarm');
      return reply.send({ success: true, status: 'false_alarm' });
    } catch (err) {
      log.error({ err }, 'Failed to mark alarm as false alarm');
      return reply.code(500).send({ error: 'Failed to mark false alarm' });
    }
  });

  // ─── POST /alarms/:id/escalate — Escalate to incident (tenant-scoped) ────────
  fastify.post('/:id/escalate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const user = getUser(request);
      const now = new Date().toISOString();

      // Get alarm details (scoped)
      const { rows } = await pool.query('SELECT * FROM alarms WHERE id = $1 AND org_id = $2', [id, orgId]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Alarm not found' });
      const alarm = rows[0];

      // Create incident ID
      const incidentId = `INC-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

      // Try to create a corresponding incident record if incidents table exists
      try {
        await pool.query(`
          INSERT INTO incidents (id, org_id, incident_number, title, description, incident_type, priority, status,
            location, reported_by, source_event_id, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, $10, $11, $11)
        `, [
          crypto.randomUUID(), orgId, incidentId,
          body.incident_title || alarm.title,
          alarm.description || 'Escalated from alarm ' + alarm.alarm_number,
          alarm.alarm_type || 'other',
          alarm.priority,
          alarm.location || null,
          user.username || user.sub || 'system',
          alarm.source_event_id || null,
          now,
        ]);
      } catch (err) { log.debug({ err }, 'Failed to create linked incident from alarm escalation (incidents table may not exist)'); }

      // Update alarm with linked incident (scoped)
      await pool.query(`
        UPDATE alarms SET status = 'investigating', linked_incident_id = $1, updated_at = $2
        WHERE id = $3 AND org_id = $4
      `, [incidentId, now, id, orgId]);

      log.info({ alarmId: id, orgId, incidentId, by: user.username }, 'Alarm escalated to incident');
      return reply.send({
        success: true,
        incident_id: incidentId,
        alarm_id: id,
        title: body.incident_title || alarm.title,
      });
    } catch (err) {
      log.error({ err }, 'Failed to escalate alarm');
      return reply.code(500).send({ error: 'Failed to escalate alarm' });
    }
  });

  // ─── POST /alarms/bulk-acknowledge — Bulk acknowledge (tenant-scoped) ─────────
  fastify.post('/bulk-acknowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const ids = body.ids as string[];
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({ error: 'ids array required' });
      }
      const user = getUser(request);
      const now = new Date().toISOString();

      // params: [now, by, orgId, ...ids] — placeholders $1..$3 fixed, $4+ are ids
      const placeholders = ids.map((_, i) => `$${i + 4}`).join(',');
      const { rowCount } = await pool.query(`
        UPDATE alarms SET status = 'acknowledged', acknowledged_at = $1, acknowledged_by = $2, updated_at = $1
        WHERE org_id = $3 AND id IN (${placeholders}) AND status = 'new'
      `, [now, user.username || user.sub || 'operator', orgId, ...ids]);

      log.info({ count: rowCount, orgId, by: user.username }, 'Bulk alarm acknowledge');
      return reply.send({ success: true, acknowledged: rowCount });
    } catch (err) {
      log.error({ err }, 'Failed to bulk acknowledge alarms');
      return reply.code(500).send({ error: 'Failed to bulk acknowledge' });
    }
  });
}

/**
 * Public alarm ingest endpoint — for connector and federation event ingestion.
 * Authenticated via X-Device-Key header (not JWT). The payload must include
 * `org_id` OR X-Org-Id header to route to the correct tenant; falls back to
 * the single-tenant default when absent.
 */
export async function alarmIngestRoute(fastify: FastifyInstance, opts: AlarmRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — alarm ingest route disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 3,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Server-side device-key → orgId map. Either:
  //   (a) ALARM_INGEST_ORG_MAP = JSON {"key1":"orgA","key2":"orgB"}
  //       — lets multi-tenant clouds issue per-tenant ingest keys, AND
  //   (b) ALARM_INGEST_ORG = "<orgId>"
  //       — simple single-tenant bind when one key is shared.
  // The caller's X-Org-Id / body.org_id is NEVER trusted to determine the row's org_id.
  let ingestOrgMap: Record<string, string> = {};
  try {
    if (process.env.ALARM_INGEST_ORG_MAP) {
      ingestOrgMap = JSON.parse(process.env.ALARM_INGEST_ORG_MAP);
    }
  } catch (err) {
    log.warn({ err }, 'ALARM_INGEST_ORG_MAP failed to parse — ignoring');
  }

  fastify.post('/api/v1/alarms/ingest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Validate device key (constant-time). Iterate the per-key map first so
      // the org binding and the auth check are the same operation.
      const provided = request.headers['x-device-key'];
      let resolvedOrg: string | null = null;
      for (const [key, mappedOrg] of Object.entries(ingestOrgMap)) {
        if (safeEqualSecret(key, provided)) {
          resolvedOrg = mappedOrg;
          break;
        }
      }
      // Fall back to legacy single-key auth when no per-key map match.
      if (!resolvedOrg) {
        const legacyKey = process.env.ALARM_INGEST_KEY || process.env.CLOUD_SYNC_KEY;
        if (!safeEqualSecret(legacyKey, provided)) {
          return reply.code(401).send({ error: 'Invalid or missing X-Device-Key' });
        }
        // Legacy mode binds all ingest to ALARM_INGEST_ORG (or DEFAULT_ORG).
        resolvedOrg = process.env.ALARM_INGEST_ORG || DEFAULT_ORG;
      }

      const body = request.body as any;
      const alarms = Array.isArray(body) ? body : (body.alarms || [body]);
      // The org is fixed by the device key; anything the caller sent in
      // X-Org-Id or body.org_id is discarded.
      const boundOrg = resolvedOrg;
      let created = 0;

      for (const alarm of alarms) {
        const now = new Date().toISOString();
        const id = alarm.id || crypto.randomUUID();
        const priority = alarm.priority || 'medium';
        const year = new Date().getFullYear();
        const rowOrgId = boundOrg;

        // Generate alarm number (per-tenant sequence)
        let alarmNumber;
        try {
          const prefix = `ALM-${year}-`;
          const { rows } = await pool.query(
            `SELECT alarm_number FROM alarms WHERE org_id = $1 AND alarm_number LIKE $2 ORDER BY alarm_number DESC LIMIT 1`,
            [rowOrgId, prefix + '%']
          );
          const last = rows.length > 0 ? parseInt(rows[0].alarm_number.replace(prefix, ''), 10) : 0;
          alarmNumber = prefix + String(last + 1 + created).padStart(4, '0');
        } catch {
          alarmNumber = `ALM-${year}-${String(Date.now()).slice(-4)}`;
        }

        const slaDeadline = alarm.sla_deadline || (SLA_DEFAULTS_MS[priority]
          ? new Date(Date.now() + SLA_DEFAULTS_MS[priority]).toISOString()
          : null);

        await pool.query(`
          INSERT INTO alarms (id, org_id, alarm_number, source_system, source_event_id, alarm_type, priority,
            status, title, description, location, zone, device_name, auto_actions_taken,
            created_at, updated_at, sla_deadline)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT (id) DO NOTHING
        `, [
          id, rowOrgId, alarmNumber,
          alarm.source_system || 'federation',
          alarm.source_event_id || null,
          alarm.alarm_type || 'other',
          priority, 'new',
          alarm.title || 'Ingested Alarm',
          alarm.description || null,
          alarm.location || null,
          alarm.zone || null,
          alarm.device_name || null,
          alarm.auto_actions_taken ? JSON.stringify(alarm.auto_actions_taken) : null,
          now, now, slaDeadline,
        ]);
        created++;
      }

      log.info({ created, org: boundOrg }, 'Alarms ingested');
      return reply.send({ success: true, created });
    } catch (err) {
      log.error({ err }, 'Failed to ingest alarms');
      return reply.code(500).send({ error: 'Failed to ingest alarms' });
    }
  });
}
