// @ts-nocheck
/**
 * PACS Analytics Engine — "Splunk for Physical Access Control"
 *
 * Ingests normalized access control events and provides analytics, anomaly detection,
 * occupancy tracking, heatmaps, and per-door/per-cardholder statistics.
 *
 * Detection algorithms (no ML required — pure SQL):
 *   1. Tailgating — door open without preceding badge read
 *   2. Badge Sharing / Impossible Travel — same credential at distant doors too quickly
 *   3. After-Hours Access — events outside business hours
 *   4. Access Creep — employee accessing new areas not in their 30-day history
 *   5. Denied Access Spike — cardholder with abnormal denied event count
 *   6. Occupancy Anomaly — zone occupancy deviating from historical average
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { safeEqualSecret, getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:analytics');

export interface AnalyticsRoutesOptions {
  connectionString?: string;
}

export async function analyticsRoutes(fastify: FastifyInstance, opts: AnalyticsRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — analytics routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 8,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  let tableMigrated = false;
  async function ensureTable() {
    if (tableMigrated) return;
    await ensureOrgColumn(pool, 'access_events', 'access_events');
    await ensureOrgColumn(pool, 'analytics_results', 'analytics_results');
    tableMigrated = true;
  }

  // ─── GET /analytics/events — Query events with filters (tenant-scoped) ─
  fastify.get('/analytics/events', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.event_type) { conditions.push(`event_type = $${idx++}`); params.push(q.event_type); }
      if (q.cardholder_id) { conditions.push(`cardholder_id = $${idx++}`); params.push(q.cardholder_id); }
      if (q.cardholder_name) { conditions.push(`cardholder_name ILIKE $${idx++}`); params.push('%' + q.cardholder_name + '%'); }
      if (q.door_id) { conditions.push(`door_id = $${idx++}`); params.push(q.door_id); }
      if (q.door_name) { conditions.push(`door_name ILIKE $${idx++}`); params.push('%' + q.door_name + '%'); }
      if (q.building) { conditions.push(`building ILIKE $${idx++}`); params.push('%' + q.building + '%'); }
      if (q.zone) { conditions.push(`zone ILIKE $${idx++}`); params.push('%' + q.zone + '%'); }
      if (q.result) { conditions.push(`result = $${idx++}`); params.push(q.result); }
      if (q.since) { conditions.push(`timestamp >= $${idx++}`); params.push(q.since); }
      if (q.until) { conditions.push(`timestamp <= $${idx++}`); params.push(q.until); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const limit = Math.min(Math.max(parseInt(q.limit || '200', 10), 1), 1000);
      const offset = Math.max(parseInt(q.offset || '0', 10), 0);

      const countRes = await pool.query(`SELECT COUNT(*) as total FROM access_events ${where}`, params);
      const total = parseInt(countRes.rows[0].total, 10);

      const dataRes = await pool.query(
        `SELECT * FROM access_events ${where} ORDER BY timestamp DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return reply.send({ events: dataRes.rows, total, limit, offset });
    } catch (err) {
      log.error({ err }, 'Failed to query events');
      return reply.code(500).send({ error: 'Failed to query events' });
    }
  });

  // ─── GET /analytics/events/search — Full-text search ─────────
  fastify.get('/analytics/events/search', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const searchTerm = q.q || '';
      if (!searchTerm) return reply.code(400).send({ error: 'Search query (q) required' });

      const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);
      const pattern = '%' + searchTerm + '%';

      const { rows } = await pool.query(`
        SELECT * FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND (
          cardholder_name ILIKE $2
          OR door_name ILIKE $2
          OR location ILIKE $2
          OR building ILIKE $2
          OR zone ILIKE $2
          OR event_type ILIKE $2
        )
        ORDER BY timestamp DESC LIMIT $3
      `, [orgId, pattern, limit]);

      return reply.send({ events: rows, total: rows.length, query: searchTerm });
    } catch (err) {
      log.error({ err }, 'Failed to search events');
      return reply.code(500).send({ error: 'Failed to search events' });
    }
  });

  // ─── POST /analytics/run — Run analytics scan (tenant-scoped) ─
  fastify.post('/analytics/run', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const hoursBack = body.hours || 24;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
      const businessStart = body.business_hours_start || '06:00';
      const businessEnd = body.business_hours_end || '20:00';
      const findings = [];

      // 1. After-Hours Access (tenant-scoped)
      try {
        const afterHoursRes = await pool.query(`
          SELECT cardholder_id, cardholder_name, door_name, location, timestamp, event_type
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1 AND timestamp >= $2
            AND result = 'granted'
            AND (EXTRACT(HOUR FROM timestamp::timestamp) < $3 OR EXTRACT(HOUR FROM timestamp::timestamp) >= $4)
          ORDER BY timestamp DESC LIMIT 50
        `, [orgId, since, parseInt(businessStart), parseInt(businessEnd)]);

        if (afterHoursRes.rows.length > 0) {
          // Group by cardholder
          const byCardholder = {};
          for (const row of afterHoursRes.rows) {
            const key = row.cardholder_id || row.cardholder_name;
            if (!byCardholder[key]) byCardholder[key] = { name: row.cardholder_name, events: [] };
            byCardholder[key].events.push(row);
          }
          for (const [subjectId, data] of Object.entries(byCardholder)) {
            const d = data as any;
            findings.push({
              id: crypto.randomUUID(),
              analysis_type: 'after_hours',
              severity: d.events.length > 5 ? 'high' : 'medium',
              title: `After-Hours Access: ${d.name}`,
              description: `${d.name} had ${d.events.length} access events outside business hours (${businessStart}-${businessEnd})`,
              subject_id: subjectId,
              subject_name: d.name,
              evidence: d.events.slice(0, 10),
              status: 'new',
            });
          }
        }
      } catch (e) { log.warn({ err: e }, 'After-hours analysis failed'); }

      // 2. Denied Access Spike (tenant-scoped)
      try {
        const deniedRes = await pool.query(`
          SELECT cardholder_id, cardholder_name, COUNT(*) as denied_count
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1 AND timestamp >= $2 AND result = 'denied'
          GROUP BY cardholder_id, cardholder_name
          HAVING COUNT(*) >= 5
          ORDER BY COUNT(*) DESC LIMIT 20
        `, [orgId, since]);

        for (const row of deniedRes.rows) {
          const baselineRes = await pool.query(`
            SELECT COUNT(*) as total FROM access_events
            WHERE COALESCE(org_id, $1) = $1 AND cardholder_id = $2 AND result = 'denied'
              AND timestamp >= (NOW() - INTERVAL '30 days')::TEXT
          `, [orgId, row.cardholder_id]);
          const baseline30d = parseInt(baselineRes.rows[0]?.total || '0', 10);
          const avgDaily = baseline30d / 30;
          const currentCount = parseInt(row.denied_count, 10);

          if (currentCount > avgDaily * 3 || currentCount >= 10) {
            findings.push({
              id: crypto.randomUUID(),
              analysis_type: 'denied_spike',
              severity: currentCount >= 20 ? 'critical' : currentCount >= 10 ? 'high' : 'medium',
              title: `Denied Access Spike: ${row.cardholder_name}`,
              description: `${row.cardholder_name} had ${currentCount} denied access attempts in ${hoursBack}h (30-day avg: ${avgDaily.toFixed(1)}/day)`,
              subject_id: row.cardholder_id,
              subject_name: row.cardholder_name,
              evidence: { denied_count: currentCount, avg_daily_baseline: avgDaily, period_hours: hoursBack },
              status: 'new',
            });
          }
        }
      } catch (e) { log.warn({ err: e }, 'Denied spike analysis failed'); }

      // 3. Badge Sharing / Impossible Travel (tenant-scoped)
      try {
        const travelRes = await pool.query(`
          SELECT a.cardholder_id, a.cardholder_name,
            a.door_name as door1, a.building as building1, a.timestamp as time1,
            b.door_name as door2, b.building as building2, b.timestamp as time2,
            EXTRACT(EPOCH FROM (b.timestamp::timestamp - a.timestamp::timestamp)) as seconds_between
          FROM access_events a
          JOIN access_events b ON a.cardholder_id = b.cardholder_id
            AND b.timestamp > a.timestamp
            AND a.id != b.id
            AND COALESCE(b.org_id, $1) = $1
          WHERE COALESCE(a.org_id, $1) = $1 AND a.timestamp >= $2
            AND a.result = 'granted' AND b.result = 'granted'
            AND a.building IS NOT NULL AND b.building IS NOT NULL
            AND a.building != b.building
            AND EXTRACT(EPOCH FROM (b.timestamp::timestamp - a.timestamp::timestamp)) BETWEEN 1 AND 120
          ORDER BY seconds_between ASC LIMIT 20
        `, [orgId, since]);

        for (const row of travelRes.rows) {
          findings.push({
            id: crypto.randomUUID(),
            analysis_type: 'impossible_travel',
            severity: 'critical',
            title: `Impossible Travel: ${row.cardholder_name}`,
            description: `${row.cardholder_name} accessed ${row.door1} (${row.building1}) and ${row.door2} (${row.building2}) within ${Math.round(row.seconds_between)}s`,
            subject_id: row.cardholder_id,
            subject_name: row.cardholder_name,
            evidence: { door1: row.door1, building1: row.building1, time1: row.time1, door2: row.door2, building2: row.building2, time2: row.time2, seconds: Math.round(row.seconds_between) },
            status: 'new',
          });
        }
      } catch (e) { log.warn({ err: e }, 'Impossible travel analysis failed'); }

      // 4. Tailgating Detection (tenant-scoped)
      try {
        const tailgateRes = await pool.query(`
          SELECT door_name, location, COUNT(*) as event_count,
            MIN(timestamp) as first_event, MAX(timestamp) as last_event
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1 AND timestamp >= $2
            AND event_type IN ('door_forced', 'door_held', 'tailgate')
          GROUP BY door_name, location
          HAVING COUNT(*) >= 2
          ORDER BY COUNT(*) DESC LIMIT 20
        `, [orgId, since]);

        for (const row of tailgateRes.rows) {
          findings.push({
            id: crypto.randomUUID(),
            analysis_type: 'tailgating',
            severity: parseInt(row.event_count) >= 10 ? 'high' : 'medium',
            title: `Tailgating Detected: ${row.door_name}`,
            description: `${row.event_count} tailgating/forced/held events at ${row.door_name} (${row.location || 'unknown location'})`,
            subject_id: row.door_name,
            subject_name: row.door_name,
            evidence: { door_name: row.door_name, location: row.location, event_count: parseInt(row.event_count), first_event: row.first_event, last_event: row.last_event },
            status: 'new',
          });
        }
      } catch (e) { log.warn({ err: e }, 'Tailgating analysis failed'); }

      // 5. Access Creep (tenant-scoped)
      try {
        const creepRes = await pool.query(`
          WITH recent_doors AS (
            SELECT DISTINCT cardholder_id, cardholder_name, door_id, door_name, zone
            FROM access_events
            WHERE COALESCE(org_id, $1) = $1 AND timestamp >= $2 AND result = 'granted' AND cardholder_id IS NOT NULL
          ),
          historical_doors AS (
            SELECT DISTINCT cardholder_id, door_id
            FROM access_events
            WHERE COALESCE(org_id, $1) = $1
              AND timestamp >= (NOW() - INTERVAL '30 days')::TEXT
              AND timestamp < $2
              AND result = 'granted' AND cardholder_id IS NOT NULL
          )
          SELECT r.cardholder_id, r.cardholder_name,
            ARRAY_AGG(DISTINCT r.door_name) as new_doors,
            COUNT(DISTINCT r.door_id) as new_door_count
          FROM recent_doors r
          LEFT JOIN historical_doors h ON r.cardholder_id = h.cardholder_id AND r.door_id = h.door_id
          WHERE h.door_id IS NULL
          GROUP BY r.cardholder_id, r.cardholder_name
          HAVING COUNT(DISTINCT r.door_id) >= 3
          ORDER BY COUNT(DISTINCT r.door_id) DESC LIMIT 20
        `, [orgId, since]);

        for (const row of creepRes.rows) {
          findings.push({
            id: crypto.randomUUID(),
            analysis_type: 'access_creep',
            severity: parseInt(row.new_door_count) >= 10 ? 'high' : 'medium',
            title: `Access Creep: ${row.cardholder_name}`,
            description: `${row.cardholder_name} accessed ${row.new_door_count} new doors not seen in their 30-day history`,
            subject_id: row.cardholder_id,
            subject_name: row.cardholder_name,
            evidence: { new_doors: row.new_doors, new_door_count: parseInt(row.new_door_count) },
            status: 'new',
          });
        }
      } catch (e) { log.warn({ err: e }, 'Access creep analysis failed'); }

      // 6. Occupancy Anomaly (tenant-scoped)
      try {
        const occRes = await pool.query(`
          WITH current_occ AS (
            SELECT building,
              COUNT(*) FILTER (WHERE event_type = 'access_granted') as entries,
              COUNT(*) FILTER (WHERE event_type IN ('access_granted') AND door_name ILIKE '%exit%') as exits
            FROM access_events
            WHERE COALESCE(org_id, $1) = $1 AND timestamp >= $2 AND building IS NOT NULL
            GROUP BY building
          ),
          historical_avg AS (
            SELECT building,
              COUNT(*) / GREATEST(EXTRACT(DAY FROM (NOW() - (NOW() - INTERVAL '30 days'))), 1) as avg_daily
            FROM access_events
            WHERE COALESCE(org_id, $1) = $1
              AND timestamp >= (NOW() - INTERVAL '30 days')::TEXT
              AND timestamp < $2
              AND building IS NOT NULL
            GROUP BY building
          )
          SELECT c.building, c.entries, COALESCE(h.avg_daily, 0) as avg_daily,
            CASE WHEN h.avg_daily > 0 THEN ROUND((c.entries::numeric / h.avg_daily) * 100) ELSE 0 END as pct_of_normal
          FROM current_occ c
          LEFT JOIN historical_avg h ON c.building = h.building
          WHERE h.avg_daily > 0 AND (c.entries > h.avg_daily * 1.5 OR c.entries < h.avg_daily * 0.5)
        `, [orgId, since]);

        for (const row of occRes.rows) {
          const pct = parseInt(row.pct_of_normal);
          findings.push({
            id: crypto.randomUUID(),
            analysis_type: 'occupancy_anomaly',
            severity: pct > 200 || pct < 25 ? 'high' : 'medium',
            title: `Occupancy Anomaly: ${row.building}`,
            description: `${row.building} is at ${pct}% of normal activity (${row.entries} events vs avg ${Math.round(row.avg_daily)}/day)`,
            subject_id: row.building,
            subject_name: row.building,
            evidence: { building: row.building, current_entries: parseInt(row.entries), avg_daily: Math.round(parseFloat(row.avg_daily)), pct_of_normal: pct },
            status: 'new',
          });
        }
      } catch (e) { log.warn({ err: e }, 'Occupancy anomaly analysis failed'); }

      // Store findings in analytics_results (tenant-scoped)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const f of findings) {
          await client.query(`
            INSERT INTO analytics_results (id, org_id, analysis_type, severity, title, description, subject_id, subject_name, evidence, status, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (id) DO NOTHING
          `, [f.id, orgId, f.analysis_type, f.severity, f.title, f.description, f.subject_id, f.subject_name, JSON.stringify(f.evidence), f.status, new Date().toISOString()]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        log.warn({ err: e }, 'Failed to store some findings');
      } finally {
        client.release();
      }

      log.info({ findings: findings.length, hoursBack }, 'Analytics scan complete');
      return reply.send({ findings: findings.length, results: findings });
    } catch (err) {
      log.error({ err }, 'Analytics scan failed');
      return reply.code(500).send({ error: 'Analytics scan failed' });
    }
  });

  // ─── GET /analytics/results — Get analytics findings ─────────
  fastify.get('/analytics/results', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.analysis_type) { conditions.push(`analysis_type = $${idx++}`); params.push(q.analysis_type); }
      if (q.severity) { conditions.push(`severity = $${idx++}`); params.push(q.severity); }
      if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
      if (q.since) { conditions.push(`created_at >= $${idx++}`); params.push(q.since); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);
      const offset = Math.max(parseInt(q.offset || '0', 10), 0);

      const countRes = await pool.query(`SELECT COUNT(*) as total FROM analytics_results ${where}`, params);
      const total = parseInt(countRes.rows[0].total, 10);

      const dataRes = await pool.query(
        `SELECT * FROM analytics_results ${where} ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC,
          created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return reply.send({ results: dataRes.rows, total, limit, offset });
    } catch (err) {
      log.error({ err }, 'Failed to get analytics results');
      return reply.code(500).send({ error: 'Failed to get analytics results' });
    }
  });

  // ─── GET /analytics/results/:id — Finding detail ─────────────
  fastify.get('/analytics/results/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const { rows } = await pool.query(
        'SELECT * FROM analytics_results WHERE id = $1 AND COALESCE(org_id, $2) = $2',
        [id, orgId]
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'Finding not found' });
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to get finding');
      return reply.code(500).send({ error: 'Failed to get finding' });
    }
  });

  // ─── POST /analytics/results/:id/resolve (tenant-scoped) ─────
  fastify.post('/analytics/results/:id/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const user = (request as any).user || {};
      const now = new Date().toISOString();
      const { rowCount } = await pool.query(`
        UPDATE analytics_results SET status = 'resolved', resolved_by = $1, resolved_at = $2
        WHERE id = $3 AND COALESCE(org_id, $4) = $4 AND status NOT IN ('resolved', 'false_positive')
      `, [user.username || user.sub || 'operator', now, id, orgId]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Finding not found or already resolved' });
      return reply.send({ success: true, status: 'resolved' });
    } catch (err) {
      log.error({ err }, 'Failed to resolve finding');
      return reply.code(500).send({ error: 'Failed to resolve finding' });
    }
  });

  // ─── POST /analytics/results/:id/false-positive (tenant-scoped) ──
  fastify.post('/analytics/results/:id/false-positive', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const user = (request as any).user || {};
      const now = new Date().toISOString();
      const { rowCount } = await pool.query(`
        UPDATE analytics_results SET status = 'false_positive', resolved_by = $1, resolved_at = $2
        WHERE id = $3 AND COALESCE(org_id, $4) = $4 AND status NOT IN ('resolved', 'false_positive')
      `, [user.username || user.sub || 'operator', now, id, orgId]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Finding not found or already resolved' });
      return reply.send({ success: true, status: 'false_positive' });
    } catch (err) {
      log.error({ err }, 'Failed to mark finding as false positive');
      return reply.code(500).send({ error: 'Failed to mark false positive' });
    }
  });

  // ─── GET /analytics/dashboard (tenant-scoped) ───────────────
  fastify.get('/analytics/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const eventsToday = await pool.query(
        `SELECT COUNT(*) as count FROM access_events WHERE COALESCE(org_id, $1) = $1 AND timestamp >= CURRENT_DATE::TEXT`,
        [orgId]
      );

      const eventsLast24h = await pool.query(
        `SELECT COUNT(*) as count FROM access_events WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '24 hours')::TEXT`,
        [orgId]
      );
      const eventsPerHour = Math.round(parseInt(eventsLast24h.rows[0]?.count || '0', 10) / 24 * 10) / 10;

      const deniedRate = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE result = 'denied') as denied,
          COUNT(*) as total
        FROM access_events WHERE COALESCE(org_id, $1) = $1 AND timestamp >= CURRENT_DATE::TEXT
      `, [orgId]);
      const totalEvents = parseInt(deniedRate.rows[0]?.total || '0', 10);
      const deniedCount = parseInt(deniedRate.rows[0]?.denied || '0', 10);
      const deniedPercent = totalEvents > 0 ? Math.round((deniedCount / totalEvents) * 1000) / 10 : 0;

      const anomalies = await pool.query(`
        SELECT severity, COUNT(*) as count FROM analytics_results
        WHERE COALESCE(org_id, $1) = $1 AND status IN ('new', 'investigating')
        GROUP BY severity
      `, [orgId]);
      const anomalyCounts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
      for (const row of anomalies.rows) {
        anomalyCounts[row.severity] = parseInt(row.count, 10);
        anomalyCounts.total += parseInt(row.count, 10);
      }

      const topDoors = await pool.query(`
        SELECT door_name, COUNT(*) as event_count,
          COUNT(*) FILTER (WHERE result = 'denied') as denied_count
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '24 hours')::TEXT AND door_name IS NOT NULL
        GROUP BY door_name ORDER BY COUNT(*) DESC LIMIT 10
      `, [orgId]);

      const topCardholders = await pool.query(`
        SELECT cardholder_name, cardholder_id, COUNT(*) as event_count,
          COUNT(DISTINCT door_name) as unique_doors
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '24 hours')::TEXT AND cardholder_name IS NOT NULL
        GROUP BY cardholder_name, cardholder_id ORDER BY COUNT(*) DESC LIMIT 10
      `, [orgId]);

      const busiestHours = await pool.query(`
        SELECT EXTRACT(HOUR FROM timestamp::timestamp)::integer as hour, COUNT(*) as count
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '7 days')::TEXT
        GROUP BY EXTRACT(HOUR FROM timestamp::timestamp)
        ORDER BY hour
      `, [orgId]);

      return reply.send({
        eventsToday: parseInt(eventsToday.rows[0]?.count || '0', 10),
        eventsPerHour,
        deniedRate: deniedPercent,
        deniedCount,
        anomalies: anomalyCounts,
        topDoors: topDoors.rows,
        topCardholders: topCardholders.rows,
        busiestHours: busiestHours.rows,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get analytics dashboard');
      return reply.code(500).send({ error: 'Failed to get analytics dashboard' });
    }
  });

  // ─── GET /analytics/occupancy — Building/floor occupancy ─────
  fastify.get('/analytics/occupancy', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const allowedGroupBy = new Set(['building', 'zone', 'floor', 'location']);
      const groupBy = allowedGroupBy.has(q.group_by) ? q.group_by : 'building';

      const { rows } = await pool.query(`
        SELECT ${groupBy},
          COUNT(*) FILTER (WHERE event_type = 'access_granted') as entries,
          COUNT(DISTINCT cardholder_id) as unique_cardholders,
          MAX(timestamp) as last_event
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= CURRENT_DATE::TEXT AND ${groupBy} IS NOT NULL
        GROUP BY ${groupBy} ORDER BY entries DESC
      `, [orgId]);

      return reply.send({ occupancy: rows, group_by: groupBy });
    } catch (err) {
      log.error({ err }, 'Failed to get occupancy');
      return reply.code(500).send({ error: 'Failed to get occupancy' });
    }
  });

  // ─── GET /analytics/heatmap — Activity heatmap data ──────────
  fastify.get('/analytics/heatmap', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '7', 10), 1), 365);

      const { rows } = await pool.query(`
        SELECT
          EXTRACT(DOW FROM timestamp::timestamp)::integer as day_of_week,
          EXTRACT(HOUR FROM timestamp::timestamp)::integer as hour,
          COUNT(*) as count
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
        GROUP BY EXTRACT(DOW FROM timestamp::timestamp), EXTRACT(HOUR FROM timestamp::timestamp)
        ORDER BY day_of_week, hour
      `, [orgId]);

      // Build 7x24 grid
      const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
      let maxCount = 0;
      for (const row of rows) {
        const count = parseInt(row.count, 10);
        grid[row.day_of_week][row.hour] = count;
        if (count > maxCount) maxCount = count;
      }

      return reply.send({ heatmap: grid, maxCount, days });
    } catch (err) {
      log.error({ err }, 'Failed to get heatmap');
      return reply.code(500).send({ error: 'Failed to get heatmap' });
    }
  });

  // ─── GET /analytics/movement/:cardholderId — Movement trail ──
  fastify.get('/analytics/movement/:cardholderId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { cardholderId } = request.params as { cardholderId: string };
      const q = request.query as Record<string, string>;
      const since = q.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const limit = Math.min(Math.max(parseInt(q.limit || '200', 10), 1), 1000);

      const { rows } = await pool.query(`
        SELECT id, event_type, timestamp, door_name, door_id, reader_name, location, building, floor, zone, result
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND cardholder_id = $2 AND timestamp >= $3
        ORDER BY timestamp ASC LIMIT $4
      `, [orgId, cardholderId, since, limit]);

      // Get cardholder name
      const nameRes = await pool.query(
        `SELECT cardholder_name FROM access_events WHERE COALESCE(org_id, $1) = $1 AND cardholder_id = $2 LIMIT 1`,
        [orgId, cardholderId]
      );

      return reply.send({
        cardholder_id: cardholderId,
        cardholder_name: nameRes.rows[0]?.cardholder_name || cardholderId,
        trail: rows,
        total: rows.length,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get movement trail');
      return reply.code(500).send({ error: 'Failed to get movement trail' });
    }
  });

  // ─── GET /analytics/door-stats — Per-door statistics ─────────
  fastify.get('/analytics/door-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '7', 10), 1), 365);
      const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);

      const { rows } = await pool.query(`
        SELECT door_name, door_id, location, building, zone,
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE result = 'granted') as granted_count,
          COUNT(*) FILTER (WHERE result = 'denied') as denied_count,
          COUNT(*) FILTER (WHERE event_type IN ('door_forced', 'door_held', 'tailgate')) as forced_count,
          COUNT(DISTINCT cardholder_id) as unique_users,
          MIN(timestamp) as first_event,
          MAX(timestamp) as last_event,
          ROUND(COUNT(*) FILTER (WHERE result = 'denied')::numeric / NULLIF(COUNT(*), 0) * 100, 1) as denied_rate
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT AND door_name IS NOT NULL
        GROUP BY door_name, door_id, location, building, zone
        ORDER BY total_events DESC LIMIT $2
      `, [orgId, limit]);

      return reply.send({ doors: rows, days });
    } catch (err) {
      log.error({ err }, 'Failed to get door stats');
      return reply.code(500).send({ error: 'Failed to get door stats' });
    }
  });

  // ─── GET /analytics/cardholder-stats — Per-cardholder stats ──
  fastify.get('/analytics/cardholder-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '7', 10), 1), 365);
      const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);

      const { rows } = await pool.query(`
        SELECT cardholder_name, cardholder_id,
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE result = 'granted') as granted_count,
          COUNT(*) FILTER (WHERE result = 'denied') as denied_count,
          COUNT(DISTINCT door_name) as unique_doors,
          COUNT(DISTINCT building) as unique_buildings,
          COUNT(DISTINCT zone) as unique_zones,
          MIN(timestamp) as first_event,
          MAX(timestamp) as last_event,
          ROUND(COUNT(*) FILTER (WHERE result = 'denied')::numeric / NULLIF(COUNT(*), 0) * 100, 1) as denied_rate
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT AND cardholder_name IS NOT NULL
        GROUP BY cardholder_name, cardholder_id
        ORDER BY total_events DESC LIMIT $2
      `, [orgId, limit]);

      return reply.send({ cardholders: rows, days });
    } catch (err) {
      log.error({ err }, 'Failed to get cardholder stats');
      return reply.code(500).send({ error: 'Failed to get cardholder stats' });
    }
  });

  // ─── GET /analytics/workforce — Badge hours vs reported hours ──
  fastify.get('/analytics/workforce', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '7', 10), 1), 365);

      // Get per-cardholder daily event counts and estimate badge hours
      const { rows } = await pool.query(`
        SELECT cardholder_id, cardholder_name,
          COUNT(*) as total_events,
          COUNT(DISTINCT DATE(timestamp::timestamp)) as active_days,
          ROUND(COUNT(*)::numeric * 0.25, 1) as estimated_badge_hours,
          ROUND(COUNT(*)::numeric * 0.25 / GREATEST(COUNT(DISTINCT DATE(timestamp::timestamp)), 1), 1) as avg_hours_per_day,
          MIN(timestamp) as first_seen,
          MAX(timestamp) as last_seen
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
          AND cardholder_name IS NOT NULL AND result = 'granted'
        GROUP BY cardholder_id, cardholder_name
        ORDER BY total_events DESC LIMIT 100
      `, [orgId]);

      // Aggregate stats
      const presentToday = await pool.query(`
        SELECT COUNT(DISTINCT cardholder_id) as count FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= CURRENT_DATE::TEXT AND cardholder_name IS NOT NULL AND result = 'granted'
      `, [orgId]);

      const avgHours = rows.length > 0 ? (rows.reduce((s: number, r: any) => s + parseFloat(r.avg_hours_per_day || 0), 0) / rows.length).toFixed(1) : '0';
      const overtime = rows.filter((r: any) => parseFloat(r.estimated_badge_hours) > 40).length;
      const under40 = rows.filter((r: any) => parseFloat(r.estimated_badge_hours) < 40 && parseFloat(r.estimated_badge_hours) > 0).length;

      return reply.send({
        present_today: parseInt(presentToday.rows[0]?.count || '0', 10),
        avg_hours: parseFloat(avgHours),
        overtime,
        under_40: under40,
        discrepancies: rows.filter((r: any) => parseFloat(r.avg_hours_per_day) > 12 || parseFloat(r.avg_hours_per_day) < 2).length,
        employees: rows.map((r: any) => ({
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          badge_hours: parseFloat(r.estimated_badge_hours),
          avg_hours_per_day: parseFloat(r.avg_hours_per_day),
          active_days: parseInt(r.active_days, 10),
          total_events: parseInt(r.total_events, 10),
          issue: parseFloat(r.avg_hours_per_day) > 12 ? 'Excessive Hours' : parseFloat(r.avg_hours_per_day) < 2 ? 'Low Activity' : null,
        })),
        days,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get workforce analytics');
      return reply.code(500).send({ error: 'Failed to get workforce analytics' });
    }
  });

  // ─── GET /analytics/behavioral — Behavioral drift detection ────
  fastify.get('/analytics/behavioral', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      // Detect behavioral drift by comparing recent 7-day pattern to 30-day baseline
      const { rows: driftRows } = await pool.query(`
        WITH baseline AS (
          SELECT cardholder_id, cardholder_name,
            AVG(EXTRACT(HOUR FROM timestamp::timestamp)) as avg_hour,
            STDDEV(EXTRACT(HOUR FROM timestamp::timestamp)) as std_hour,
            COUNT(DISTINCT door_name) as typical_doors,
            COUNT(*) as baseline_events
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1
            AND timestamp >= (NOW() - INTERVAL '30 days')::TEXT
            AND timestamp < (NOW() - INTERVAL '7 days')::TEXT
            AND cardholder_name IS NOT NULL AND result = 'granted'
          GROUP BY cardholder_id, cardholder_name
          HAVING COUNT(*) >= 10
        ),
        recent AS (
          SELECT cardholder_id,
            AVG(EXTRACT(HOUR FROM timestamp::timestamp)) as avg_hour,
            STDDEV(EXTRACT(HOUR FROM timestamp::timestamp)) as std_hour,
            COUNT(DISTINCT door_name) as recent_doors,
            COUNT(*) as recent_events
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1
            AND timestamp >= (NOW() - INTERVAL '7 days')::TEXT
            AND cardholder_name IS NOT NULL AND result = 'granted'
          GROUP BY cardholder_id
          HAVING COUNT(*) >= 3
        )
        SELECT b.cardholder_id, b.cardholder_name,
          b.avg_hour as baseline_avg_hour, r.avg_hour as recent_avg_hour,
          b.typical_doors, r.recent_doors,
          b.baseline_events, r.recent_events,
          ABS(b.avg_hour - r.avg_hour) as hour_drift,
          CASE WHEN b.typical_doors > 0 THEN ROUND(ABS(r.recent_doors - b.typical_doors)::numeric / b.typical_doors * 100) ELSE 0 END as door_drift_pct
        FROM baseline b
        JOIN recent r ON b.cardholder_id = r.cardholder_id
        WHERE ABS(b.avg_hour - r.avg_hour) > 2 OR ABS(r.recent_doors - b.typical_doors) >= 3
        ORDER BY ABS(b.avg_hour - r.avg_hour) DESC
        LIMIT 50
      `, [orgId]);

      // Pre-termination signals: sudden drop in activity
      const { rows: pretermRows } = await pool.query(`
        WITH monthly AS (
          SELECT cardholder_id, cardholder_name,
            COUNT(*) FILTER (WHERE timestamp >= (NOW() - INTERVAL '30 days')::TEXT AND timestamp < (NOW() - INTERVAL '7 days')::TEXT) as month_events,
            COUNT(*) FILTER (WHERE timestamp >= (NOW() - INTERVAL '7 days')::TEXT) as week_events
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1
            AND timestamp >= (NOW() - INTERVAL '30 days')::TEXT
            AND cardholder_name IS NOT NULL AND result = 'granted'
          GROUP BY cardholder_id, cardholder_name
          HAVING COUNT(*) FILTER (WHERE timestamp >= (NOW() - INTERVAL '30 days')::TEXT AND timestamp < (NOW() - INTERVAL '7 days')::TEXT) >= 15
        )
        SELECT *, ROUND((1 - week_events::numeric / GREATEST(month_events / 3.3, 1)) * 100) as drop_pct
        FROM monthly
        WHERE week_events < month_events / 3.3 * 0.4
        ORDER BY drop_pct DESC LIMIT 20
      `, [orgId]);

      // First-in/last-out anomalies
      const { rows: filoRows } = await pool.query(`
        SELECT cardholder_id, cardholder_name,
          MIN(EXTRACT(HOUR FROM timestamp::timestamp)) as earliest_hour,
          MAX(EXTRACT(HOUR FROM timestamp::timestamp)) as latest_hour,
          COUNT(*) as event_count
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '7 days')::TEXT
          AND cardholder_name IS NOT NULL AND result = 'granted'
        GROUP BY cardholder_id, cardholder_name
        HAVING MIN(EXTRACT(HOUR FROM timestamp::timestamp)) < 5 OR MAX(EXTRACT(HOUR FROM timestamp::timestamp)) > 22
        ORDER BY MIN(EXTRACT(HOUR FROM timestamp::timestamp)) ASC
        LIMIT 20
      `, [orgId]);

      return reply.send({
        drift_alerts: driftRows.length,
        pretermination_count: pretermRows.length,
        pattern_anomalies: filoRows.length,
        drift_employees: driftRows.map((r: any) => ({
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          drift_score: Math.min(100, Math.round(parseFloat(r.hour_drift) * 10 + parseFloat(r.door_drift_pct || 0))),
          change_type: parseFloat(r.hour_drift) > 3 ? 'Schedule Shift' : 'Area Change',
          baseline_avg_hour: Math.round(parseFloat(r.baseline_avg_hour)),
          recent_avg_hour: Math.round(parseFloat(r.recent_avg_hour)),
          typical_doors: parseInt(r.typical_doors, 10),
          recent_doors: parseInt(r.recent_doors, 10),
        })),
        pretermination: pretermRows.map((r: any) => ({
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          risk_score: Math.min(100, parseInt(r.drop_pct || '0', 10)),
          month_events: parseInt(r.month_events, 10),
          week_events: parseInt(r.week_events, 10),
          drop_pct: parseInt(r.drop_pct || '0', 10),
        })),
        first_in_last_out: filoRows.map((r: any) => ({
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          earliest_hour: parseInt(r.earliest_hour, 10),
          latest_hour: parseInt(r.latest_hour, 10),
          event_count: parseInt(r.event_count, 10),
          pattern: parseInt(r.earliest_hour, 10) < 5 ? 'Early Arrival' : 'Late Departure',
          concern: parseInt(r.earliest_hour, 10) < 3 || parseInt(r.latest_hour, 10) > 23 ? 'High' : 'Medium',
        })),
      });
    } catch (err) {
      log.error({ err }, 'Failed to get behavioral analytics');
      return reply.code(500).send({ error: 'Failed to get behavioral analytics' });
    }
  });

  // ─── GET /analytics/social — Social network / co-access patterns ─
  fastify.get('/analytics/social', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '30', 10), 1), 365);

      // Co-access pairs: people who badge in to same door within 5 minutes
      const { rows: coAccessRows } = await pool.query(`
        SELECT a.cardholder_name as person1, b.cardholder_name as person2,
          COUNT(*) as co_access_count,
          MODE() WITHIN GROUP (ORDER BY a.door_name) as common_area
        FROM access_events a
        JOIN access_events b ON a.door_name = b.door_name
          AND a.cardholder_id < b.cardholder_id
          AND ABS(EXTRACT(EPOCH FROM (a.timestamp::timestamp - b.timestamp::timestamp))) < 300
          AND a.cardholder_name IS NOT NULL AND b.cardholder_name IS NOT NULL
          AND COALESCE(b.org_id, $1) = $1
        WHERE COALESCE(a.org_id, $1) = $1
          AND a.timestamp >= (NOW() - INTERVAL '${days} days')::TEXT AND a.result = 'granted'
        GROUP BY a.cardholder_name, b.cardholder_name
        HAVING COUNT(*) >= 5
        ORDER BY COUNT(*) DESC LIMIT 30
      `, [orgId]);

      // Cross-building connections
      const { rows: crossBldg } = await pool.query(`
        SELECT cardholder_name, COUNT(DISTINCT building) as building_count,
          ARRAY_AGG(DISTINCT building) as buildings,
          COUNT(*) as total_events
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
          AND building IS NOT NULL AND cardholder_name IS NOT NULL AND result = 'granted'
        GROUP BY cardholder_id, cardholder_name
        HAVING COUNT(DISTINCT building) >= 3
        ORDER BY COUNT(DISTINCT building) DESC LIMIT 20
      `, [orgId]);

      // Influence: people with most unique door accesses (network hubs)
      const { rows: influenceRows } = await pool.query(`
        SELECT cardholder_name, cardholder_id,
          COUNT(DISTINCT door_name) as unique_doors,
          COUNT(DISTINCT building) as unique_buildings,
          COUNT(*) as total_events
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
          AND cardholder_name IS NOT NULL AND result = 'granted'
        GROUP BY cardholder_id, cardholder_name
        ORDER BY COUNT(DISTINCT door_name) DESC LIMIT 20
      `, [orgId]);

      // Isolated: people with very few co-access connections
      const { rows: isolated } = await pool.query(`
        SELECT cardholder_name, cardholder_id, COUNT(*) as total_events,
          COUNT(DISTINCT door_name) as unique_doors
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
          AND cardholder_name IS NOT NULL AND result = 'granted'
        GROUP BY cardholder_id, cardholder_name
        HAVING COUNT(DISTINCT door_name) = 1 AND COUNT(*) >= 5
        ORDER BY COUNT(*) DESC LIMIT 20
      `, [orgId]);

      return reply.send({
        cluster_count: coAccessRows.length,
        cross_dept_count: crossBldg.length,
        informal_leaders: influenceRows.filter((r: any) => parseInt(r.unique_doors) >= 10).length,
        isolated_count: isolated.length,
        co_access: coAccessRows,
        cross_building: crossBldg,
        influence: influenceRows.map((r: any) => ({
          name: r.cardholder_name,
          connections: parseInt(r.unique_doors, 10),
          buildings: parseInt(r.unique_buildings, 10),
          influence_score: Math.min(100, Math.round(parseInt(r.unique_doors) * 3 + parseInt(r.unique_buildings) * 10)),
          role: parseInt(r.unique_doors) >= 15 ? 'Hub' : parseInt(r.unique_doors) >= 10 ? 'Connector' : 'Regular',
        })),
        isolated: isolated,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get social analytics');
      return reply.code(500).send({ error: 'Failed to get social analytics' });
    }
  });

  // ─── GET /analytics/ghost — Ghost employee / inactive badge detection ─
  fastify.get('/analytics/ghost', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const inactiveDays = Math.min(Math.max(parseInt(q.inactive_days || '30', 10), 1), 365);

      // Ghost employees: had activity >30 days ago but none recently
      const { rows: ghostRows } = await pool.query(`
        SELECT cardholder_id, cardholder_name,
          MAX(timestamp) as last_access,
          COUNT(*) as total_events,
          EXTRACT(DAY FROM (NOW() - MAX(timestamp::timestamp))) as days_inactive
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND cardholder_name IS NOT NULL AND result = 'granted'
        GROUP BY cardholder_id, cardholder_name
        HAVING MAX(timestamp::timestamp) < NOW() - INTERVAL '${inactiveDays} days'
        ORDER BY MAX(timestamp) DESC LIMIT 50
      `, [orgId]);

      // Credential sharing: same credential used at multiple buildings in short time
      const { rows: sharingRows } = await pool.query(`
        SELECT a.cardholder_id, a.cardholder_name,
          a.building as building1, b.building as building2,
          a.timestamp as time1, b.timestamp as time2,
          EXTRACT(EPOCH FROM (b.timestamp::timestamp - a.timestamp::timestamp)) as seconds_between
        FROM access_events a
        JOIN access_events b ON a.cardholder_id = b.cardholder_id
          AND b.timestamp > a.timestamp
          AND a.building != b.building
          AND EXTRACT(EPOCH FROM (b.timestamp::timestamp - a.timestamp::timestamp)) BETWEEN 1 AND 120
          AND COALESCE(b.org_id, $1) = $1
        WHERE COALESCE(a.org_id, $1) = $1
          AND a.timestamp >= (NOW() - INTERVAL '7 days')::TEXT
          AND a.result = 'granted' AND b.result = 'granted'
          AND a.building IS NOT NULL AND b.building IS NOT NULL
        ORDER BY seconds_between ASC LIMIT 20
      `, [orgId]);

      // Inactive badges: active credentials with no recent activity
      const { rows: inactiveRows } = await pool.query(`
        SELECT cardholder_id, cardholder_name,
          MAX(timestamp) as last_use,
          COUNT(*) as historical_events,
          EXTRACT(DAY FROM (NOW() - MAX(timestamp::timestamp))) as days_since
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND cardholder_name IS NOT NULL
        GROUP BY cardholder_id, cardholder_name
        HAVING MAX(timestamp::timestamp) < NOW() - INTERVAL '${inactiveDays} days'
          AND COUNT(*) > 5
        ORDER BY MAX(timestamp) ASC LIMIT 50
      `, [orgId]);

      return reply.send({
        ghost_count: ghostRows.length,
        sharing_count: sharingRows.length,
        inactive_count: inactiveRows.length,
        payroll_risk: ghostRows.filter((r: any) => parseInt(r.days_inactive) > 60).length,
        ghost_employees: ghostRows.map((r: any) => ({
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          last_access: r.last_access,
          days_inactive: Math.round(parseFloat(r.days_inactive)),
          total_events: parseInt(r.total_events, 10),
          status: parseInt(r.days_inactive) > 90 ? 'Critical' : parseInt(r.days_inactive) > 60 ? 'Warning' : 'Monitor',
        })),
        sharing_detected: sharingRows.map((r: any) => ({
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          building1: r.building1,
          building2: r.building2,
          seconds_between: Math.round(parseFloat(r.seconds_between)),
          confidence: parseFloat(r.seconds_between) < 30 ? 'High' : parseFloat(r.seconds_between) < 60 ? 'Medium' : 'Low',
        })),
        inactive_badges: inactiveRows.map((r: any) => ({
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          last_use: r.last_use,
          days_since: Math.round(parseFloat(r.days_since)),
          historical_events: parseInt(r.historical_events, 10),
          action: parseInt(r.days_since) > 90 ? 'Disable' : 'Review',
        })),
      });
    } catch (err) {
      log.error({ err }, 'Failed to get ghost analytics');
      return reply.code(500).send({ error: 'Failed to get ghost analytics' });
    }
  });

  // ─── GET /analytics/tailgating-detail — Detailed tailgating analysis ─
  fastify.get('/analytics/tailgating-detail', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '7', 10), 1), 365);

      // Tailgating events
      const { rows: tailgateEvents } = await pool.query(`
        SELECT id, timestamp, door_name, cardholder_name, event_type, location, building
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
          AND event_type IN ('door_forced', 'door_held', 'tailgate')
        ORDER BY timestamp DESC LIMIT 100
      `, [orgId]);

      // Entry/exit mismatch
      const { rows: mismatchRows } = await pool.query(`
        WITH entries AS (
          SELECT cardholder_id, cardholder_name, door_name, MAX(timestamp) as last_entry
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1
            AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
            AND result = 'granted' AND event_type NOT LIKE '%exit%'
            AND cardholder_name IS NOT NULL
          GROUP BY cardholder_id, cardholder_name, door_name
        ),
        exits AS (
          SELECT cardholder_id, door_name, MAX(timestamp) as last_exit
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1
            AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
            AND (event_type LIKE '%exit%' OR door_name ILIKE '%exit%')
          GROUP BY cardholder_id, door_name
        )
        SELECT e.cardholder_id, e.cardholder_name, e.door_name, e.last_entry,
          x.last_exit, CASE WHEN x.last_exit IS NOT NULL THEN true ELSE false END as exit_recorded
        FROM entries e
        LEFT JOIN exits x ON e.cardholder_id = x.cardholder_id AND e.door_name = x.door_name
        WHERE x.last_exit IS NULL
        ORDER BY e.last_entry DESC LIMIT 50
      `, [orgId]);

      // Door risk scoring
      const { rows: doorRisk } = await pool.query(`
        SELECT door_name, location, building,
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE event_type IN ('door_forced', 'door_held', 'tailgate')) as security_events,
          ROUND(COUNT(*) FILTER (WHERE event_type IN ('door_forced', 'door_held', 'tailgate'))::numeric / GREATEST(COUNT(*), 1) * 100, 1) as risk_score
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT AND door_name IS NOT NULL
        GROUP BY door_name, location, building
        HAVING COUNT(*) FILTER (WHERE event_type IN ('door_forced', 'door_held', 'tailgate')) > 0
        ORDER BY security_events DESC LIMIT 30
      `, [orgId]);

      return reply.send({
        tailgate_count: tailgateEvents.length,
        mismatch_count: mismatchRows.length,
        high_risk_doors: doorRisk.filter((r: any) => parseFloat(r.risk_score) > 10).length,
        tailgate_events: tailgateEvents,
        mismatch: mismatchRows,
        door_risk: doorRisk.map((r: any) => ({
          ...r,
          risk_level: parseFloat(r.risk_score) > 20 ? 'Critical' : parseFloat(r.risk_score) > 10 ? 'High' : parseFloat(r.risk_score) > 5 ? 'Medium' : 'Low',
        })),
      });
    } catch (err) {
      log.error({ err }, 'Failed to get tailgating analytics');
      return reply.code(500).send({ error: 'Failed to get tailgating analytics' });
    }
  });

  // ─── GET /analytics/requests — Access request / denied access patterns ─
  fastify.get('/analytics/requests', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '7', 10), 1), 365);

      // Employees with most denials
      const { rows: deniedEmployees } = await pool.query(`
        SELECT cardholder_id, cardholder_name,
          COUNT(*) as denied_count,
          COUNT(DISTINCT door_name) as unique_doors,
          MODE() WITHIN GROUP (ORDER BY door_name) as most_attempted_door
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
          AND result = 'denied' AND cardholder_name IS NOT NULL
        GROUP BY cardholder_id, cardholder_name
        ORDER BY COUNT(*) DESC LIMIT 30
      `, [orgId]);

      // Frequently denied doors
      const { rows: deniedDoors } = await pool.query(`
        SELECT door_name, location, building,
          COUNT(*) as denial_count,
          COUNT(DISTINCT cardholder_id) as unique_people
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
          AND result = 'denied' AND door_name IS NOT NULL
        GROUP BY door_name, location, building
        ORDER BY COUNT(*) DESC LIMIT 20
      `, [orgId]);

      // Total stats
      const totalDenied = deniedEmployees.reduce((s: number, r: any) => s + parseInt(r.denied_count, 10), 0);
      const uniqueDenied = deniedEmployees.length;

      return reply.send({
        total_denied: totalDenied,
        unique_denied: uniqueDenied,
        suggested_access: deniedEmployees.filter((r: any) => parseInt(r.denied_count) >= 5).length,
        suspicious: deniedEmployees.filter((r: any) => parseInt(r.denied_count) >= 10).length,
        denied_employees: deniedEmployees.map((r: any) => ({
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          denied_count: parseInt(r.denied_count, 10),
          unique_doors: parseInt(r.unique_doors, 10),
          most_attempted: r.most_attempted_door,
          recommendation: parseInt(r.denied_count) >= 10 ? 'Investigate' : parseInt(r.denied_count) >= 5 ? 'Grant Access' : 'Monitor',
        })),
        denied_doors: deniedDoors.map((r: any) => ({
          door_name: r.door_name,
          location: r.location,
          building: r.building,
          denial_count: parseInt(r.denial_count, 10),
          unique_people: parseInt(r.unique_people, 10),
          policy_review: parseInt(r.unique_people) >= 5 ? 'Required' : 'Optional',
        })),
        days,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get access request analytics');
      return reply.code(500).send({ error: 'Failed to get access request analytics' });
    }
  });

  // ─── GET /analytics/insider — Insider threat risk scoring ──────
  fastify.get('/analytics/insider', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '7', 10), 1), 365);

      // Build risk scores from multiple signals
      const { rows } = await pool.query(`
        WITH signals AS (
          SELECT cardholder_id, cardholder_name,
            COUNT(*) FILTER (WHERE result = 'denied') as denials,
            COUNT(*) FILTER (WHERE event_type IN ('door_forced', 'door_held')) as forced,
            COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM timestamp::timestamp) < 6 OR EXTRACT(HOUR FROM timestamp::timestamp) > 22) as after_hours,
            COUNT(DISTINCT door_name) as unique_doors,
            COUNT(DISTINCT building) as unique_buildings,
            COUNT(*) as total_events
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1
            AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
            AND cardholder_name IS NOT NULL
          GROUP BY cardholder_id, cardholder_name
          HAVING COUNT(*) >= 3
        )
        SELECT *,
          LEAST(100, (
            denials * 5 +
            forced * 15 +
            after_hours * 3 +
            CASE WHEN unique_doors > 15 THEN 10 ELSE 0 END +
            CASE WHEN unique_buildings > 3 THEN 5 ELSE 0 END
          )) as risk_score,
          CASE
            WHEN forced > 0 THEN 'DOOR_FORCED'
            WHEN denials > 10 THEN 'EXCESSIVE_DENIALS'
            WHEN after_hours > 5 THEN 'AFTER_HOURS'
            WHEN unique_doors > 15 THEN 'BROAD_ACCESS'
            ELSE 'NORMAL'
          END as top_signal
        FROM signals
        ORDER BY risk_score DESC LIMIT 50
      `, [orgId]);

      // Recent risk signals (findings from analytics_results)
      const { rows: recentSignals } = await pool.query(`
        SELECT id, analysis_type, severity, title, subject_name, created_at
        FROM analytics_results
        WHERE COALESCE(org_id, $1) = $1
          AND created_at >= (NOW() - INTERVAL '${days} days')::TEXT
        ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          created_at DESC
        LIMIT 30
      `, [orgId]);

      const critical = rows.filter((r: any) => parseInt(r.risk_score) >= 80).length;
      const high = rows.filter((r: any) => parseInt(r.risk_score) >= 60 && parseInt(r.risk_score) < 80).length;
      const elevated = rows.filter((r: any) => parseInt(r.risk_score) >= 40 && parseInt(r.risk_score) < 60).length;

      return reply.send({
        critical,
        high,
        elevated,
        threat_scores: rows.map((r: any, i: number) => ({
          rank: i + 1,
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          risk_score: parseInt(r.risk_score, 10),
          top_signal: r.top_signal,
          denials: parseInt(r.denials, 10),
          forced: parseInt(r.forced, 10),
          after_hours: parseInt(r.after_hours, 10),
          unique_doors: parseInt(r.unique_doors, 10),
          trend: 'Stable',
        })),
        recent_signals: recentSignals,
        risk_factors: [
          { factor: 'Door Forced/Held', weight: 15, description: 'Physical security violations' },
          { factor: 'Access Denials', weight: 5, description: 'Attempted unauthorized access' },
          { factor: 'After-Hours Access', weight: 3, description: 'Activity outside business hours' },
          { factor: 'Broad Access', weight: 10, description: 'Access to >15 unique doors' },
          { factor: 'Multi-Building', weight: 5, description: 'Access across >3 buildings' },
        ],
      });
    } catch (err) {
      log.error({ err }, 'Failed to get insider threat analytics');
      return reply.code(500).send({ error: 'Failed to get insider threat analytics' });
    }
  });

  // ─── GET /analytics/emergency — Emergency preparedness ─────────
  fastify.get('/analytics/emergency', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      // Current building occupancy by zone/building
      const { rows: zones } = await pool.query(`
        SELECT COALESCE(zone, building, 'Unknown') as zone_name,
          building,
          COUNT(DISTINCT cardholder_id) as current_count,
          COUNT(*) as total_events
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= CURRENT_DATE::TEXT AND result = 'granted'
        GROUP BY COALESCE(zone, building, 'Unknown'), building
        ORDER BY current_count DESC
      `, [orgId]);

      const totalInBuilding = zones.reduce((s: number, r: any) => s + parseInt(r.current_count, 10), 0);

      return reply.send({
        total_in_building: totalInBuilding,
        zone_count: zones.length,
        zones: zones.map((r: any) => ({
          name: r.zone_name,
          building: r.building,
          current_count: parseInt(r.current_count, 10),
          capacity: 100,
          exits: 2,
          est_evac_time: '3 min',
          status: parseInt(r.current_count) > 80 ? 'High Occupancy' : 'Normal',
        })),
        muster_points: [],
        special_needs: [],
        drills: [],
      });
    } catch (err) {
      log.error({ err }, 'Failed to get emergency analytics');
      return reply.code(500).send({ error: 'Failed to get emergency analytics' });
    }
  });

  // ─── GET /analytics/access-creep-detail — Access creep detailed view ─
  fastify.get('/analytics/access-creep-detail', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '30', 10), 1), 365);

      const { rows } = await pool.query(`
        WITH granted_doors AS (
          SELECT cardholder_id, cardholder_name,
            COUNT(DISTINCT door_name) as total_granted,
            COUNT(DISTINCT door_name) FILTER (WHERE timestamp >= (NOW() - INTERVAL '${days} days')::TEXT) as recently_used
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1 AND cardholder_name IS NOT NULL AND result = 'granted'
          GROUP BY cardholder_id, cardholder_name
          HAVING COUNT(DISTINCT door_name) >= 3
        )
        SELECT *,
          total_granted - recently_used as unused_count,
          ROUND(recently_used::numeric / GREATEST(total_granted, 1) * 100, 1) as usage_pct
        FROM granted_doors
        WHERE recently_used::numeric / GREATEST(total_granted, 1) < 0.5
        ORDER BY total_granted DESC LIMIT 50
      `, [orgId]);

      // Summary by building
      const { rows: summaryRows } = await pool.query(`
        SELECT COALESCE(building, 'Unknown') as building,
          COUNT(DISTINCT cardholder_id) as total_credentials,
          COUNT(DISTINCT door_name) as total_doors
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT AND result = 'granted'
        GROUP BY COALESCE(building, 'Unknown')
        ORDER BY total_credentials DESC
      `, [orgId]);

      return reply.send({
        total_flagged: rows.length,
        high_risk_count: rows.filter((r: any) => parseFloat(r.usage_pct) < 10).length,
        avg_usage_pct: rows.length > 0 ? Math.round(rows.reduce((s: number, r: any) => s + parseFloat(r.usage_pct), 0) / rows.length) : 0,
        total_credentials: rows.length,
        creep_results: rows.map((r: any) => ({
          cardholder_id: r.cardholder_id,
          name: r.cardholder_name,
          total_granted: parseInt(r.total_granted, 10),
          recently_used: parseInt(r.recently_used, 10),
          unused_count: parseInt(r.unused_count, 10),
          usage_pct: parseFloat(r.usage_pct),
          risk_level: parseFloat(r.usage_pct) < 10 ? 'High' : parseFloat(r.usage_pct) < 25 ? 'Medium' : 'Low',
          recommendation: parseFloat(r.usage_pct) < 10 ? 'Revoke Unused' : parseFloat(r.usage_pct) < 25 ? 'Review' : 'Monitor',
        })),
        summary_by_building: summaryRows,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get access creep detail');
      return reply.code(500).send({ error: 'Failed to get access creep detail' });
    }
  });

  // ─── GET /analytics/door-health — Door health correlation ──────
  fastify.get('/analytics/door-health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const days = Math.min(Math.max(parseInt(q.days || '30', 10), 1), 365);

      const { rows } = await pool.query(`
        SELECT door_name, door_id, location, building,
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE event_type = 'door_held') as held_count,
          COUNT(*) FILTER (WHERE event_type = 'door_forced') as forced_count,
          COUNT(*) FILTER (WHERE result = 'denied') as denial_count,
          COUNT(*) FILTER (WHERE event_type IN ('door_forced', 'door_held', 'tailgate')) as anomaly_count,
          ROUND(100 - LEAST(100, (
            COUNT(*) FILTER (WHERE event_type = 'door_held') * 3 +
            COUNT(*) FILTER (WHERE event_type = 'door_forced') * 10 +
            COUNT(*) FILTER (WHERE result = 'denied')
          ))) as health_score
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT AND door_name IS NOT NULL
        GROUP BY door_name, door_id, location, building
        ORDER BY (
          COUNT(*) FILTER (WHERE event_type = 'door_held') * 3 +
          COUNT(*) FILTER (WHERE event_type = 'door_forced') * 10
        ) DESC LIMIT 50
      `, [orgId]);

      // Correlated alerts: doors with both hardware and access issues
      const { rows: correlatedAlerts } = await pool.query(`
        SELECT door_name, event_type, timestamp, cardholder_id, cardholder_name
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1
          AND timestamp >= (NOW() - INTERVAL '${days} days')::TEXT
          AND event_type IN ('door_forced', 'door_held', 'tailgate')
        ORDER BY timestamp DESC LIMIT 50
      `, [orgId]);

      const doorsAtRisk = rows.filter((r: any) => parseInt(r.health_score) < 70).length;
      const totalForced = rows.reduce((s: number, r: any) => s + parseInt(r.forced_count, 10), 0);
      const correlated = rows.filter((r: any) => parseInt(r.forced_count) > 0 && parseInt(r.held_count) > 0).length;

      return reply.send({
        total_doors: rows.length,
        doors_at_risk: doorsAtRisk,
        forced_count: totalForced,
        correlated_count: correlated,
        door_report: rows.map((r: any) => ({
          door_name: r.door_name,
          location: r.location,
          building: r.building,
          health_score: Math.max(0, parseInt(r.health_score, 10)),
          held_count: parseInt(r.held_count, 10),
          forced_count: parseInt(r.forced_count, 10),
          denial_count: parseInt(r.denial_count, 10),
          anomaly_count: parseInt(r.anomaly_count, 10),
          correlated: parseInt(r.forced_count) > 0 && parseInt(r.held_count) > 0,
          risk: parseInt(r.health_score) < 50 ? 'Critical' : parseInt(r.health_score) < 70 ? 'High' : parseInt(r.health_score) < 85 ? 'Medium' : 'Low',
          recommendation: parseInt(r.health_score) < 50 ? 'Immediate Maintenance' : parseInt(r.health_score) < 70 ? 'Schedule Maintenance' : 'Monitor',
        })),
        correlated_alerts: correlatedAlerts,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get door health analytics');
      return reply.code(500).send({ error: 'Failed to get door health analytics' });
    }
  });

  // ─── GET /analytics/space — Space utilization ──────────────────
  fastify.get('/analytics/space', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      // Floor/zone occupancy from access events
      const { rows: floors } = await pool.query(`
        SELECT COALESCE(zone, floor, building, 'Unknown') as zone_name,
          building,
          COUNT(DISTINCT cardholder_id) as current_count,
          COUNT(*) as total_events
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= CURRENT_DATE::TEXT AND result = 'granted'
        GROUP BY COALESCE(zone, floor, building, 'Unknown'), building
        ORDER BY current_count DESC
      `, [orgId]);

      // Hourly occupancy prediction based on last 7 days
      const { rows: hourlyAvg } = await pool.query(`
        SELECT EXTRACT(HOUR FROM timestamp::timestamp)::integer as hour,
          ROUND(AVG(cnt)) as avg_count
        FROM (
          SELECT DATE(timestamp::timestamp) as d,
            EXTRACT(HOUR FROM timestamp::timestamp) as hour,
            COUNT(DISTINCT cardholder_id) as cnt
          FROM access_events
          WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '7 days')::TEXT AND result = 'granted'
          GROUP BY DATE(timestamp::timestamp), EXTRACT(HOUR FROM timestamp::timestamp)
        ) sub
        GROUP BY hour
        ORDER BY hour
      `, [orgId]);

      const avgUtilization = floors.length > 0
        ? Math.round(floors.reduce((s: number, r: any) => s + parseInt(r.current_count, 10), 0) / floors.length)
        : 0;

      return reply.send({
        avg_utilization: avgUtilization,
        peak_occupancy: floors.length > 0 ? Math.max(...floors.map((r: any) => parseInt(r.current_count, 10))) : 0,
        floors: floors.map((r: any) => ({
          zone: r.zone_name,
          building: r.building,
          current: parseInt(r.current_count, 10),
          capacity: 100,
          utilization: Math.min(100, parseInt(r.current_count, 10)),
          trend: 'Stable',
        })),
        predictions: hourlyAvg.map((r: any) => ({
          hour: parseInt(r.hour, 10),
          predicted: parseInt(r.avg_count, 10),
          confidence: 75,
        })),
      });
    } catch (err) {
      log.error({ err }, 'Failed to get space analytics');
      return reply.code(500).send({ error: 'Failed to get space analytics' });
    }
  });

  // ─── GET /analytics/detectors — Detector configuration ─────────
  fastify.get('/analytics/detectors', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      // Report configured detector status
      const detectors = [
        { name: 'After-Hours Access', enabled: true, param_label: 'Business Hours', param_value: '06:00 - 20:00' },
        { name: 'Denied Access Spike', enabled: true, param_label: 'Threshold', param_value: '5+ denials / 24h' },
        { name: 'Impossible Travel', enabled: true, param_label: 'Max Window', param_value: '120 seconds between buildings' },
        { name: 'Tailgating Detection', enabled: true, param_label: 'Event Types', param_value: 'door_forced, door_held, tailgate' },
        { name: 'Access Creep', enabled: true, param_label: 'Lookback', param_value: '30-day baseline' },
        { name: 'Occupancy Anomaly', enabled: true, param_label: 'Deviation', param_value: '>150% or <50% of normal' },
        { name: 'Behavioral Drift', enabled: true, param_label: 'Baseline Window', param_value: '30-day comparison' },
        { name: 'Ghost Employee', enabled: true, param_label: 'Inactive Threshold', param_value: '30 days' },
        { name: 'Insider Threat', enabled: true, param_label: 'Signal Weighting', param_value: 'Multi-factor scoring' },
      ];

      // Get event counts
      const { rows: eventCount } = await pool.query(`
        SELECT COUNT(*) as total FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '7 days')::TEXT
      `, [orgId]);

      // Top credentials
      const { rows: topCreds } = await pool.query(`
        SELECT cardholder_name, COUNT(*) as event_count
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '7 days')::TEXT AND cardholder_name IS NOT NULL
        GROUP BY cardholder_name ORDER BY COUNT(*) DESC LIMIT 10
      `, [orgId]);

      // Top readers/doors
      const { rows: topReaders } = await pool.query(`
        SELECT door_name, location, COUNT(*) as event_count
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= (NOW() - INTERVAL '7 days')::TEXT AND door_name IS NOT NULL
        GROUP BY door_name, location ORDER BY COUNT(*) DESC LIMIT 10
      `, [orgId]);

      return reply.send({
        active_count: detectors.filter(d => d.enabled).length,
        total_events: parseInt(eventCount.rows?.[0]?.total || eventCount[0]?.total || '0', 10),
        detectors,
        top_credentials: topCreds,
        top_readers: topReaders,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get detector config');
      return reply.code(500).send({ error: 'Failed to get detector config' });
    }
  });

  log.info('PACS Analytics routes registered');
}

/**
 * Device-key → org resolver for unauthenticated analytics ingest.
 * Precedence:
 *   1. ANALYTICS_INGEST_ORG_MAP JSON ({"<device-key>":"<orgId>", ...}) — per-key binding, fail-closed
 *   2. ANALYTICS_INGEST_KEY + ANALYTICS_INGEST_ORG — legacy single-key
 *   3. CLOUD_SYNC_KEY + DASHBOARD_ADMIN_ORG — legacy compat fallback
 */
function resolveAnalyticsIngestOrg(providedKey: unknown): string | null {
  const key = typeof providedKey === 'string' ? providedKey : Array.isArray(providedKey) ? providedKey[0] : '';
  if (!key) return null;

  // 1. JSON map (preferred — fail-closed on unknown key)
  const mapRaw = process.env.ANALYTICS_INGEST_ORG_MAP;
  if (mapRaw) {
    try {
      const map = JSON.parse(mapRaw) as Record<string, string>;
      for (const [expectedKey, orgId] of Object.entries(map)) {
        if (safeEqualSecret(expectedKey, key)) return orgId;
      }
      return null; // fail-closed: key not in map
    } catch (err) {
      log.error({ err }, 'Invalid ANALYTICS_INGEST_ORG_MAP JSON — refusing ingest');
      return null;
    }
  }

  // 2. Legacy single-key
  const legacyKey = process.env.ANALYTICS_INGEST_KEY;
  const legacyOrg = process.env.ANALYTICS_INGEST_ORG;
  if (legacyKey && legacyOrg && safeEqualSecret(legacyKey, key)) return legacyOrg;

  // 3. Legacy CLOUD_SYNC_KEY compat (single-tenant deployments)
  const compatKey = process.env.CLOUD_SYNC_KEY;
  if (compatKey && safeEqualSecret(compatKey, key)) {
    return process.env.DASHBOARD_ADMIN_ORG || 'default';
  }

  return null;
}

export async function analyticsIngestRoute(fastify: FastifyInstance, opts: AnalyticsRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — analytics ingest route disabled');
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
  async function ensureIngestTable() {
    if (tableMigrated) return;
    await ensureOrgColumn(pool, 'access_events', 'access_events');
    tableMigrated = true;
  }

  fastify.post('/api/v1/analytics/events', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureIngestTable();
      const orgId = resolveAnalyticsIngestOrg(request.headers['x-device-key']);
      if (!orgId) {
        return reply.code(401).send({ error: 'Invalid or missing X-Device-Key' });
      }

      const body = request.body as any;
      const events = Array.isArray(body) ? body : (body.events || [body]);
      let created = 0;

      for (const evt of events) {
        const now = new Date().toISOString();
        const id = evt.id || crypto.randomUUID();

        await pool.query(`
          INSERT INTO access_events (id, org_id, site_id, event_type, timestamp, cardholder_id, cardholder_name,
            credential_type, door_id, door_name, reader_id, reader_name, facility_code,
            location, building, floor, zone, result, source_system, source_event_id,
            metadata, device_id, created_at)
          VALUES ($1,$22,$23,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          ON CONFLICT (id) DO NOTHING
        `, [
          id,
          evt.event_type || 'access_granted',
          evt.timestamp || now,
          evt.cardholder_id || null,
          evt.cardholder_name || null,
          evt.credential_type || 'card',
          evt.door_id || null,
          evt.door_name || null,
          evt.reader_id || null,
          evt.reader_name || null,
          evt.facility_code || null,
          evt.location || null,
          evt.building || null,
          evt.floor || null,
          evt.zone || null,
          evt.result || 'granted',
          evt.source_system || 'connector',
          evt.source_event_id || null,
          evt.metadata ? JSON.stringify(evt.metadata) : null,
          evt.device_id || null,
          now,
          orgId,
          'default',
        ]);
        created++;
      }

      log.info({ created, orgId }, 'Access events ingested');
      return reply.send({ success: true, created });
    } catch (err) {
      log.error({ err }, 'Failed to ingest access events');
      return reply.code(500).send({ error: 'Failed to ingest access events' });
    }
  });
}
