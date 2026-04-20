// @ts-nocheck
/**
 * Predictive Threat / Risk Scoring Routes
 *
 * Risk assessment engine that analyzes incident, alarm, and sensor history
 * to produce risk scores by zone, building, person, door, or time period.
 *
 * Routes:
 *   GET    /risk/scores                       — Current risk scores with filtering
 *   GET    /risk/scores/:entityType/:entityId  — Risk score for specific entity
 *   POST   /risk/calculate                    — Trigger risk recalculation
 *   GET    /risk/heatmap                      — Risk heatmap data by zone/building
 *   GET    /risk/trends                       — Risk trends over time
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:risk');

export interface RiskRoutesOptions {
  connectionString?: string;
}

export async function riskRoutes(fastify: FastifyInstance, opts: RiskRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — risk routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // ─── GET /risk/scores — List risk scores with filtering ───────

  fastify.get('/risk/scores', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string>;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (q.entity_type) {
      conditions.push(`entity_type = $${idx++}`);
      params.push(q.entity_type);
    }
    if (q.risk_level) {
      conditions.push(`risk_level = $${idx++}`);
      params.push(q.risk_level);
    }
    if (q.min_score) {
      conditions.push(`risk_score >= $${idx++}`);
      params.push(parseFloat(q.min_score));
    }
    if (q.trend) {
      conditions.push(`trend = $${idx++}`);
      params.push(q.trend);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = Math.min(parseInt(q.limit || '100', 10), 500);
    const offset = parseInt(q.offset || '0', 10);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM risk_scores ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT * FROM risk_scores ${where} ORDER BY risk_score DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ scores: dataRes.rows, total, limit, offset });
  });

  // ─── GET /risk/scores/:entityType/:entityId — Specific entity ──

  fastify.get('/risk/scores/:entityType/:entityId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { entityType, entityId } = request.params as { entityType: string; entityId: string };

    const res = await pool.query(
      'SELECT * FROM risk_scores WHERE entity_type = $1 AND entity_id = $2 ORDER BY last_calculated DESC LIMIT 1',
      [entityType, entityId]
    );

    if (res.rows.length === 0) {
      return reply.code(404).send({ error: 'No risk score found for this entity' });
    }

    return reply.send(res.rows[0]);
  });

  // ─── POST /risk/calculate — Trigger risk recalculation ────────

  fastify.post('/risk/calculate', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    const entityType = body?.entity_type || 'zone';

    // Gather incident/alarm/event statistics for risk calculation (tenant-scoped)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Count incidents by location (zone proxy, tenant-scoped)
    const incidentStats = await pool.query(
      `SELECT COALESCE(location, 'Unknown') as zone, COUNT(*) as count,
       COUNT(*) FILTER (WHERE priority = 'critical' OR priority = 'high') as high_priority,
       COUNT(*) FILTER (WHERE created_at >= $1) as recent_count
       FROM incidents WHERE org_id = $2 AND created_at >= $3 GROUP BY COALESCE(location, 'Unknown')`,
      [sevenDaysAgo, orgId, thirtyDaysAgo]
    ).catch((err) => { log.warn({ err }, 'Failed to query incident stats for risk heatmap'); return { rows: [] }; });

    // Count alarms by zone (tenant-scoped)
    const alarmStats = await pool.query(
      `SELECT COALESCE(zone, location, 'Unknown') as zone, COUNT(*) as count,
       COUNT(*) FILTER (WHERE priority = 'critical' OR priority = 'high') as high_priority,
       COUNT(*) FILTER (WHERE created_at >= $1) as recent_count
       FROM alarms WHERE org_id = $2 AND created_at >= $3 GROUP BY COALESCE(zone, location, 'Unknown')`,
      [sevenDaysAgo, orgId, thirtyDaysAgo]
    ).catch((err) => { log.warn({ err }, 'Failed to query alarm stats for risk heatmap'); return { rows: [] }; });

    // Combine stats and calculate scores
    const zoneMap = new Map();

    for (const row of incidentStats.rows) {
      const z = row.zone;
      if (!zoneMap.has(z)) zoneMap.set(z, { incidents: 0, highPriIncidents: 0, recentIncidents: 0, alarms: 0, highPriAlarms: 0, recentAlarms: 0 });
      const entry = zoneMap.get(z);
      entry.incidents = parseInt(row.count);
      entry.highPriIncidents = parseInt(row.high_priority);
      entry.recentIncidents = parseInt(row.recent_count);
    }

    for (const row of alarmStats.rows) {
      const z = row.zone;
      if (!zoneMap.has(z)) zoneMap.set(z, { incidents: 0, highPriIncidents: 0, recentIncidents: 0, alarms: 0, highPriAlarms: 0, recentAlarms: 0 });
      const entry = zoneMap.get(z);
      entry.alarms = parseInt(row.count);
      entry.highPriAlarms = parseInt(row.high_priority);
      entry.recentAlarms = parseInt(row.recent_count);
    }

    // If no data, create a default "All Clear" entry
    if (zoneMap.size === 0) {
      zoneMap.set('All Zones', { incidents: 0, highPriIncidents: 0, recentIncidents: 0, alarms: 0, highPriAlarms: 0, recentAlarms: 0 });
    }

    const calculated = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const [zone, stats] of zoneMap) {
        const factors = [];
        let score = 0;

        // Factor: incident volume (0-25 pts)
        const incWeight = Math.min(stats.incidents * 5, 25);
        if (stats.incidents > 0) factors.push({ factor: 'Incident Volume (30d)', weight: incWeight, value: stats.incidents });
        score += incWeight;

        // Factor: high-priority incidents (0-25 pts)
        const highPriWeight = Math.min(stats.highPriIncidents * 10, 25);
        if (stats.highPriIncidents > 0) factors.push({ factor: 'High-Priority Incidents', weight: highPriWeight, value: stats.highPriIncidents });
        score += highPriWeight;

        // Factor: recent activity trend (0-20 pts)
        const recentWeight = Math.min(stats.recentIncidents * 4, 20);
        if (stats.recentIncidents > 0) factors.push({ factor: 'Recent Incidents (7d)', weight: recentWeight, value: stats.recentIncidents });
        score += recentWeight;

        // Factor: alarm volume (0-15 pts)
        const alarmWeight = Math.min(stats.alarms * 3, 15);
        if (stats.alarms > 0) factors.push({ factor: 'Alarm Volume (30d)', weight: alarmWeight, value: stats.alarms });
        score += alarmWeight;

        // Factor: high-priority alarms (0-15 pts)
        const highAlarmWeight = Math.min(stats.highPriAlarms * 5, 15);
        if (stats.highPriAlarms > 0) factors.push({ factor: 'High-Priority Alarms', weight: highAlarmWeight, value: stats.highPriAlarms });
        score += highAlarmWeight;

        score = Math.min(score, 100);

        const riskLevel = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 40 ? 'elevated' : score >= 20 ? 'moderate' : 'low';

        // Determine trend by comparing to previous score
        const prevRes = await client.query(
          'SELECT risk_score FROM risk_scores WHERE entity_type = $1 AND entity_id = $2 ORDER BY last_calculated DESC LIMIT 1',
          ['zone', zone]
        );
        let trend = 'stable';
        if (prevRes.rows.length > 0) {
          const prev = prevRes.rows[0].risk_score;
          if (score > prev + 5) trend = 'increasing';
          else if (score < prev - 5) trend = 'decreasing';
        }

        const id = crypto.randomUUID();
        await client.query(
          `INSERT INTO risk_scores (id, entity_type, entity_id, entity_name, risk_score, risk_level, factors, trend, last_calculated, period_start, period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [id, 'zone', zone, zone, score, riskLevel, JSON.stringify(factors), trend, thirtyDaysAgo, now.toISOString()]
        );

        calculated.push({ id, entity_type: 'zone', entity_id: zone, entity_name: zone, risk_score: score, risk_level: riskLevel, factors, trend });
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      log.error({ err }, 'Risk calculation failed');
      return reply.code(500).send({ error: 'Risk calculation failed' });
    } finally {
      client.release();
    }

    log.info({ zones: calculated.length }, 'Risk scores recalculated');
    return reply.send({ calculated: calculated.length, scores: calculated });
  });

  // ─── GET /risk/heatmap — Risk heatmap data by zone/building ───

  fastify.get('/risk/heatmap', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string>;
    const entityType = q.entity_type || 'zone';

    const res = await pool.query(
      `SELECT entity_id, entity_name, risk_score, risk_level, trend, last_calculated
       FROM risk_scores
       WHERE entity_type = $1
       AND last_calculated = (
         SELECT MAX(last_calculated) FROM risk_scores r2
         WHERE r2.entity_type = risk_scores.entity_type AND r2.entity_id = risk_scores.entity_id
       )
       ORDER BY risk_score DESC`,
      [entityType]
    );

    return reply.send({ heatmap: res.rows, entity_type: entityType });
  });

  // ─── GET /risk/trends — Risk trends over time ─────────────────

  fastify.get('/risk/trends', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string>;
    const entityType = q.entity_type || 'zone';
    const entityId = q.entity_id;
    const limit = Math.min(parseInt(q.limit || '30', 10), 100);

    let query: string;
    let params: any[];

    if (entityId) {
      query = `SELECT * FROM risk_scores WHERE entity_type = $1 AND entity_id = $2 ORDER BY last_calculated DESC LIMIT $3`;
      params = [entityType, entityId, limit];
    } else {
      query = `SELECT * FROM risk_scores WHERE entity_type = $1 ORDER BY last_calculated DESC LIMIT $2`;
      params = [entityType, limit];
    }

    const res = await pool.query(query, params);
    return reply.send({ trends: res.rows });
  });

  log.info('Risk scoring routes registered');
}
