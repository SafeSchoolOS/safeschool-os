// @ts-nocheck
/**
 * Physical Security UEBA (User & Entity Behavior Analytics)
 *
 * Builds behavioral baselines for cardholders from access_events history,
 * then detects deviations from those baselines to identify insider threats,
 * compromised credentials, and anomalous behavior patterns.
 *
 * Routes:
 *   POST   /ueba/build-baselines       — Build/update baselines from last 30 days
 *   GET    /ueba/baselines              — List all cardholder baselines
 *   GET    /ueba/baselines/:cardholderId — Baseline for specific cardholder
 *   GET    /ueba/alerts                 — Active behavior alerts
 *   GET    /ueba/alerts/:id             — Alert detail
 *   POST   /ueba/alerts/:id/review      — Review alert (resolve/false-positive)
 *   POST   /ueba/analyze               — Run UEBA analysis against baselines
 *   GET    /ueba/risk-ranking           — Cardholders ranked by risk score
 *   GET    /ueba/dashboard              — UEBA dashboard stats
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:ueba');

export interface UebaRoutesOptions {
  connectionString?: string;
}

export async function uebaRoutes(fastify: FastifyInstance, opts: UebaRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — UEBA routes disabled');
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
    await ensureOrgColumn(pool, 'behavior_baselines', 'behavior_baselines');
    await ensureOrgColumn(pool, 'behavior_alerts', 'behavior_alerts');
    tableMigrated = true;
  }

  // ─── POST /ueba/build-baselines — Build behavior baselines (tenant-scoped) ───
  fastify.post('/ueba/build-baselines', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const daysBack = body.days || 30;
      const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      // Get all cardholders with events in the period (tenant-scoped)
      const cardholdersRes = await pool.query(`
        SELECT cardholder_id, cardholder_name,
          ARRAY_AGG(DISTINCT door_name) FILTER (WHERE door_name IS NOT NULL) as doors,
          ARRAY_AGG(DISTINCT zone) FILTER (WHERE zone IS NOT NULL) as zones,
          COUNT(*) as total_events,
          COUNT(DISTINCT DATE(timestamp::timestamp)) as active_days,
          MIN(EXTRACT(HOUR FROM timestamp::timestamp)) as min_hour,
          MAX(EXTRACT(HOUR FROM timestamp::timestamp)) as max_hour
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= $2 AND cardholder_id IS NOT NULL AND result = 'granted'
        GROUP BY cardholder_id, cardholder_name
        HAVING COUNT(*) >= 5
      `, [orgId, since]);

      const client = await pool.connect();
      let built = 0;
      try {
        await client.query('BEGIN');

        for (const row of cardholdersRes.rows) {
          const totalEvents = parseInt(row.total_events, 10);
          const activeDays = parseInt(row.active_days, 10) || 1;
          const avgDaily = Math.round((totalEvents / activeDays) * 100) / 100;
          const avgWeekly = Math.round(avgDaily * 7 * 100) / 100;

          // Determine typical hours
          const typicalHours = {
            start: String(Math.floor(parseFloat(row.min_hour))).padStart(2, '0') + ':00',
            end: String(Math.min(Math.ceil(parseFloat(row.max_hour)) + 1, 23)).padStart(2, '0') + ':00',
          };

          const deptRes = await client.query(`
            SELECT metadata->>'department' as department FROM access_events
            WHERE COALESCE(org_id, $1) = $1 AND cardholder_id = $2 AND metadata->>'department' IS NOT NULL LIMIT 1
          `, [orgId, row.cardholder_id]).catch((err) => { log.warn({ err, cardholderId: row.cardholder_id }, 'Failed to query department for behavior baseline'); return { rows: [] }; });
          const department = deptRes.rows[0]?.department || null;

          const id = crypto.randomUUID();
          await client.query(`
            INSERT INTO behavior_baselines (id, org_id, cardholder_id, cardholder_name, department,
              typical_doors, typical_hours, typical_zones, avg_daily_events, avg_weekly_events,
              last_calculated, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (cardholder_id) DO UPDATE SET
              cardholder_name = $4, department = COALESCE($5, behavior_baselines.department),
              typical_doors = $6, typical_hours = $7, typical_zones = $8,
              avg_daily_events = $9, avg_weekly_events = $10,
              last_calculated = $11, updated_at = $13
          `, [
            id, orgId, row.cardholder_id, row.cardholder_name, department,
            JSON.stringify(row.doors || []),
            JSON.stringify(typicalHours),
            JSON.stringify(row.zones || []),
            avgDaily, avgWeekly,
            now, now, now,
          ]);
          built++;
        }

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      log.info({ built, daysBack }, 'Behavior baselines built');
      return reply.send({ success: true, baselines_built: built, period_days: daysBack });
    } catch (err) {
      log.error({ err }, 'Failed to build baselines');
      return reply.code(500).send({ error: 'Failed to build baselines' });
    }
  });

  // ─── GET /ueba/baselines — List (tenant-scoped) ─────────────
  fastify.get('/ueba/baselines', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);
      const offset = Math.max(parseInt(q.offset || '0', 10), 0);

      const countRes = await pool.query(
        'SELECT COUNT(*) as total FROM behavior_baselines WHERE COALESCE(org_id, $1) = $1',
        [orgId]
      );
      const total = parseInt(countRes.rows[0].total, 10);

      const { rows } = await pool.query(
        `SELECT * FROM behavior_baselines WHERE COALESCE(org_id, $1) = $1 ORDER BY cardholder_name ASC LIMIT $2 OFFSET $3`,
        [orgId, limit, offset]
      );

      return reply.send({ baselines: rows, total, limit, offset });
    } catch (err) {
      log.error({ err }, 'Failed to list baselines');
      return reply.code(500).send({ error: 'Failed to list baselines' });
    }
  });

  // ─── GET /ueba/baselines/:cardholderId (tenant-scoped) ──────
  fastify.get('/ueba/baselines/:cardholderId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { cardholderId } = request.params as { cardholderId: string };
      const { rows } = await pool.query(
        'SELECT * FROM behavior_baselines WHERE cardholder_id = $1 AND COALESCE(org_id, $2) = $2',
        [cardholderId, orgId]
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'Baseline not found' });
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to get baseline');
      return reply.code(500).send({ error: 'Failed to get baseline' });
    }
  });

  // ─── GET /ueba/alerts (tenant-scoped) ───────────────────────
  fastify.get('/ueba/alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.alert_type) { conditions.push(`alert_type = $${idx++}`); params.push(q.alert_type); }
      if (q.severity) { conditions.push(`severity = $${idx++}`); params.push(q.severity); }
      if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
      else { conditions.push(`status IN ('new', 'reviewing')`); }
      if (q.cardholder_id) { conditions.push(`cardholder_id = $${idx++}`); params.push(q.cardholder_id); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);
      const offset = Math.max(parseInt(q.offset || '0', 10), 0);

      const countRes = await pool.query(`SELECT COUNT(*) as total FROM behavior_alerts ${where}`, params);
      const total = parseInt(countRes.rows[0].total, 10);

      const dataRes = await pool.query(
        `SELECT * FROM behavior_alerts ${where} ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC,
          risk_score DESC, created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return reply.send({ alerts: dataRes.rows, total, limit, offset });
    } catch (err) {
      log.error({ err }, 'Failed to get behavior alerts');
      return reply.code(500).send({ error: 'Failed to get behavior alerts' });
    }
  });

  // ─── GET /ueba/alerts/:id (tenant-scoped) ───────────────────
  fastify.get('/ueba/alerts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const { rows } = await pool.query(
        'SELECT * FROM behavior_alerts WHERE id = $1 AND COALESCE(org_id, $2) = $2',
        [id, orgId]
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'Alert not found' });

      const baseline = await pool.query(
        'SELECT * FROM behavior_baselines WHERE cardholder_id = $1 AND COALESCE(org_id, $2) = $2',
        [rows[0].cardholder_id, orgId]
      ).catch((err) => { log.warn({ err, cardholderId: rows[0].cardholder_id }, 'Failed to query behavior baseline for alert detail'); return { rows: [] }; });

      return reply.send({ alert: rows[0], baseline: baseline.rows[0] || null });
    } catch (err) {
      log.error({ err }, 'Failed to get alert detail');
      return reply.code(500).send({ error: 'Failed to get alert detail' });
    }
  });

  // ─── POST /ueba/alerts/:id/review — Review alert ─────────────
  fastify.post('/ueba/alerts/:id/review', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const user = (request as any).user || {};
      const now = new Date().toISOString();
      const newStatus = body.status || 'resolved';

      if (!['resolved', 'false_positive'].includes(newStatus)) {
        return reply.code(400).send({ error: 'Status must be resolved or false_positive' });
      }

      const { rowCount } = await pool.query(`
        UPDATE behavior_alerts SET status = $1, reviewed_by = $2, reviewed_at = $3
        WHERE id = $4 AND COALESCE(org_id, $5) = $5 AND status IN ('new', 'reviewing')
      `, [newStatus, user.username || user.sub || 'operator', now, id, orgId]);

      if (rowCount === 0) return reply.code(404).send({ error: 'Alert not found or already reviewed' });
      return reply.send({ success: true, status: newStatus });
    } catch (err) {
      log.error({ err }, 'Failed to review alert');
      return reply.code(500).send({ error: 'Failed to review alert' });
    }
  });

  // ─── POST /ueba/analyze — Run UEBA analysis ──────────────────
  fastify.post('/ueba/analyze', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const hoursBack = body.hours || 24;
      const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();
      const alerts = [];

      // Get all baselines (tenant-scoped)
      const baselinesRes = await pool.query(
        'SELECT * FROM behavior_baselines WHERE COALESCE(org_id, $1) = $1',
        [orgId]
      );
      const baselines = new Map();
      for (const b of baselinesRes.rows) {
        baselines.set(b.cardholder_id, b);
      }

      if (baselines.size === 0) {
        return reply.send({ success: true, alerts_created: 0, message: 'No baselines found. Run build-baselines first.' });
      }

      // Get recent events grouped by cardholder (tenant-scoped)
      const recentRes = await pool.query(`
        SELECT cardholder_id, cardholder_name,
          ARRAY_AGG(DISTINCT door_name) FILTER (WHERE door_name IS NOT NULL) as doors_used,
          ARRAY_AGG(DISTINCT zone) FILTER (WHERE zone IS NOT NULL) as zones_used,
          COUNT(*) as event_count,
          MIN(EXTRACT(HOUR FROM timestamp::timestamp)) as min_hour,
          MAX(EXTRACT(HOUR FROM timestamp::timestamp)) as max_hour
        FROM access_events
        WHERE COALESCE(org_id, $1) = $1 AND timestamp >= $2 AND cardholder_id IS NOT NULL AND result = 'granted'
        GROUP BY cardholder_id, cardholder_name
      `, [orgId, since]);

      for (const recent of recentRes.rows) {
        const baseline = baselines.get(recent.cardholder_id);
        if (!baseline) continue;

        let riskScore = 0;
        const deviations = [];

        // Parse baseline data
        const typicalDoors = JSON.parse(baseline.typical_doors || '[]');
        const typicalZones = JSON.parse(baseline.typical_zones || '[]');
        const typicalHours = JSON.parse(baseline.typical_hours || '{}');
        const recentDoors = recent.doors_used || [];
        const recentZones = recent.zones_used || [];

        // 1. New doors never used before
        const newDoors = recentDoors.filter(d => d && !typicalDoors.includes(d));
        if (newDoors.length > 0) {
          riskScore += Math.min(newDoors.length * 10, 30);
          deviations.push({
            type: 'new_door',
            description: `Accessed ${newDoors.length} new door(s): ${newDoors.slice(0, 5).join(', ')}`,
            baseline: typicalDoors.length + ' typical doors',
            observed: newDoors.join(', '),
          });
        }

        // 2. New zones
        const newZones = recentZones.filter(z => z && !typicalZones.includes(z));
        if (newZones.length > 0) {
          riskScore += Math.min(newZones.length * 15, 30);
          deviations.push({
            type: 'new_zone',
            description: `Accessed ${newZones.length} new zone(s): ${newZones.join(', ')}`,
            baseline: typicalZones.length + ' typical zones',
            observed: newZones.join(', '),
          });
        }

        // 3. Off-hours access
        const startHour = typicalHours.start ? parseInt(typicalHours.start) : 7;
        const endHour = typicalHours.end ? parseInt(typicalHours.end) : 18;
        const minHour = parseFloat(recent.min_hour);
        const maxHour = parseFloat(recent.max_hour);
        if (minHour < startHour - 1 || maxHour > endHour + 1) {
          riskScore += 20;
          deviations.push({
            type: 'off_hours',
            description: `Activity outside typical hours (${typicalHours.start || '07:00'}-${typicalHours.end || '18:00'})`,
            baseline: `${typicalHours.start || '07:00'} - ${typicalHours.end || '18:00'}`,
            observed: `${Math.floor(minHour)}:00 - ${Math.ceil(maxHour)}:00`,
          });
        }

        // 4. Excessive activity
        const eventCount = parseInt(recent.event_count, 10);
        const expectedDaily = baseline.avg_daily_events * (hoursBack / 24);
        if (expectedDaily > 0 && eventCount > expectedDaily * 2.5) {
          riskScore += Math.min(Math.round((eventCount / expectedDaily - 1) * 10), 25);
          deviations.push({
            type: 'excessive_activity',
            description: `${eventCount} events in ${hoursBack}h vs expected ~${Math.round(expectedDaily)}`,
            baseline: Math.round(expectedDaily) + ' expected events',
            observed: eventCount + ' events',
          });
        }

        // Cap risk score at 100
        riskScore = Math.min(riskScore, 100);

        // Only create alerts for meaningful deviations
        if (deviations.length > 0 && riskScore >= 20) {
          const severity = riskScore >= 80 ? 'critical' : riskScore >= 60 ? 'high' : riskScore >= 40 ? 'medium' : 'low';

          for (const dev of deviations) {
            const alertId = crypto.randomUUID();
            alerts.push({
              id: alertId,
              alert_type: dev.type,
              cardholder_id: recent.cardholder_id,
              cardholder_name: recent.cardholder_name,
              severity,
              description: dev.description,
              baseline_value: dev.baseline,
              observed_value: dev.observed,
              risk_score: riskScore,
              status: 'new',
            });
          }
        }
      }

      // Store alerts (tenant-scoped)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const a of alerts) {
          await client.query(`
            INSERT INTO behavior_alerts (id, org_id, alert_type, cardholder_id, cardholder_name, severity,
              description, baseline_value, observed_value, risk_score, status, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (id) DO NOTHING
          `, [a.id, orgId, a.alert_type, a.cardholder_id, a.cardholder_name, a.severity,
              a.description, a.baseline_value, a.observed_value, a.risk_score, a.status, now]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        log.warn({ err: e }, 'Failed to store some UEBA alerts');
      } finally {
        client.release();
      }

      log.info({ alerts: alerts.length, baselines: baselines.size, hoursBack }, 'UEBA analysis complete');
      return reply.send({ success: true, alerts_created: alerts.length, baselines_checked: baselines.size, alerts });
    } catch (err) {
      log.error({ err }, 'UEBA analysis failed');
      return reply.code(500).send({ error: 'UEBA analysis failed' });
    }
  });

  // ─── GET /ueba/risk-ranking — Cardholders ranked by risk ─────
  fastify.get('/ueba/risk-ranking', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);

      const { rows } = await pool.query(`
        SELECT cardholder_id, cardholder_name,
          MAX(risk_score) as max_risk_score,
          AVG(risk_score) as avg_risk_score,
          COUNT(*) as alert_count,
          COUNT(*) FILTER (WHERE status IN ('new', 'reviewing')) as active_alerts,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
          COUNT(*) FILTER (WHERE severity = 'high') as high_count,
          MAX(created_at) as latest_alert
        FROM behavior_alerts
        WHERE COALESCE(org_id, $1) = $1
        GROUP BY cardholder_id, cardholder_name
        ORDER BY MAX(risk_score) DESC, COUNT(*) FILTER (WHERE status IN ('new', 'reviewing')) DESC
        LIMIT $2
      `, [orgId, limit]);

      return reply.send({ rankings: rows });
    } catch (err) {
      log.error({ err }, 'Failed to get risk ranking');
      return reply.code(500).send({ error: 'Failed to get risk ranking' });
    }
  });

  // ─── GET /ueba/dashboard — UEBA dashboard stats ──────────────
  fastify.get('/ueba/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const baselinesRes = await pool.query(
        'SELECT COUNT(*) as total FROM behavior_baselines WHERE COALESCE(org_id, $1) = $1',
        [orgId]
      );
      const totalBaselines = parseInt(baselinesRes.rows[0].total, 10);

      const alertsRes = await pool.query(`
        SELECT severity, COUNT(*) as count FROM behavior_alerts
        WHERE COALESCE(org_id, $1) = $1 AND status IN ('new', 'reviewing')
        GROUP BY severity
      `, [orgId]);
      const alertCounts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
      for (const row of alertsRes.rows) {
        alertCounts[row.severity] = parseInt(row.count, 10);
        alertCounts.total += parseInt(row.count, 10);
      }

      const highRiskRes = await pool.query(`
        SELECT COUNT(DISTINCT cardholder_id) as count FROM behavior_alerts
        WHERE COALESCE(org_id, $1) = $1 AND risk_score > 60 AND status IN ('new', 'reviewing')
      `, [orgId]);
      const highRiskCount = parseInt(highRiskRes.rows[0].count, 10);

      const fpRes = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'false_positive') as fp_count,
          COUNT(*) FILTER (WHERE status IN ('resolved', 'false_positive')) as resolved_total
        FROM behavior_alerts WHERE COALESCE(org_id, $1) = $1
      `, [orgId]);
      const fpCount = parseInt(fpRes.rows[0]?.fp_count || '0', 10);
      const resolvedTotal = parseInt(fpRes.rows[0]?.resolved_total || '0', 10);
      const falsePositiveRate = resolvedTotal > 0 ? Math.round((fpCount / resolvedTotal) * 100) : 0;

      const topRiskRes = await pool.query(`
        SELECT cardholder_id, cardholder_name,
          MAX(risk_score) as risk_score,
          COUNT(*) FILTER (WHERE status IN ('new', 'reviewing')) as active_alerts
        FROM behavior_alerts
        WHERE COALESCE(org_id, $1) = $1 AND status IN ('new', 'reviewing')
        GROUP BY cardholder_id, cardholder_name
        ORDER BY MAX(risk_score) DESC LIMIT 10
      `, [orgId]);

      const byTypeRes = await pool.query(`
        SELECT alert_type, COUNT(*) as count FROM behavior_alerts
        WHERE COALESCE(org_id, $1) = $1 AND status IN ('new', 'reviewing')
        GROUP BY alert_type ORDER BY COUNT(*) DESC
      `, [orgId]);

      const recentRes = await pool.query(`
        SELECT * FROM behavior_alerts WHERE COALESCE(org_id, $1) = $1 ORDER BY created_at DESC LIMIT 10
      `, [orgId]);

      return reply.send({
        totalBaselines,
        activeAlerts: alertCounts,
        highRiskCount,
        falsePositiveRate,
        topRiskCardholders: topRiskRes.rows,
        alertsByType: byTypeRes.rows,
        recentAlerts: recentRes.rows,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get UEBA dashboard');
      return reply.code(500).send({ error: 'Failed to get UEBA dashboard' });
    }
  });

  log.info('UEBA routes registered');
}
