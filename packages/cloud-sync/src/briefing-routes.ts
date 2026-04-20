// @ts-nocheck
/**
 * Executive & Shift Briefing Routes
 *
 * Generate executive summaries, shift handoff documents, and scheduled briefings
 * from security data (incidents, alarms, access events, posture scores).
 *
 * Routes:
 *   POST /briefings/generate      — Generate an executive or daily/weekly briefing
 *   GET  /briefings               — List recent briefings
 *   GET  /briefings/schedule      — Get scheduled auto-briefing configs
 *   GET  /briefings/:id           — Get a specific briefing by ID
 *   POST /briefings/shift-handoff — Generate a shift handoff briefing
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:briefings');

export interface BriefingRoutesOptions {
  connectionString?: string;
}

interface BriefingSection {
  title: string;
  content: string;
  items?: Array<Record<string, any>>;
  stats?: Record<string, any>;
}

function buildTitle(briefingType: string): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  switch (briefingType) {
    case 'executive': return `Executive Security Briefing — ${dateStr}`;
    case 'shift_handoff': return `Shift Handoff Briefing — ${dateStr}`;
    case 'daily': return `Daily Security Summary — ${dateStr}`;
    case 'weekly': return `Weekly Security Summary — ${dateStr}`;
    default: return `Security Briefing — ${dateStr}`;
  }
}

export async function briefingRoutes(fastify: FastifyInstance, opts: BriefingRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — briefing routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // ─── Helper: gather stats from database (tenant-scoped) ─────────────
  async function gatherStats(rangeHours: number, orgId: string) {
    const since = new Date(Date.now() - rangeHours * 3600000).toISOString();

    // Incidents (tenant-scoped)
    let incidentsByStatus: Record<string, number> = {};
    let openIncidents: any[] = [];
    try {
      const statusRes = await pool.query(
        `SELECT status, COUNT(*)::int as cnt FROM incidents WHERE org_id = $1 AND created_at >= $2 GROUP BY status`,
        [orgId, since]
      );
      for (const r of statusRes.rows) incidentsByStatus[r.status] = r.cnt;
      const openRes = await pool.query(
        `SELECT id, title, priority, status, created_at FROM incidents WHERE org_id = $1 AND status NOT IN ('closed', 'resolved') ORDER BY created_at DESC LIMIT 20`,
        [orgId]
      );
      openIncidents = openRes.rows;
    } catch (err) { log.debug({ err }, 'Failed to query incidents for briefing (table may not exist)'); }

    // Alarms (tenant-scoped)
    let alarmsByPriority: Record<string, number> = {};
    let unacknowledgedCount = 0;
    let totalAlarms = 0;
    try {
      const prioRes = await pool.query(
        `SELECT priority, COUNT(*)::int as cnt FROM alarms WHERE org_id = $1 AND created_at >= $2 GROUP BY priority`,
        [orgId, since]
      );
      for (const r of prioRes.rows) {
        alarmsByPriority[r.priority] = r.cnt;
        totalAlarms += r.cnt;
      }
      const unackRes = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM alarms WHERE org_id = $1 AND acknowledged_at IS NULL AND created_at >= $2`,
        [orgId, since]
      );
      unacknowledgedCount = unackRes.rows[0]?.cnt || 0;
    } catch (err) { log.debug({ err }, 'Failed to query alarms for briefing (table may not exist)'); }

    // Access events (tenant-scoped via sync_entities.org_id if present)
    let totalEvents = 0;
    let deniedCount = 0;
    try {
      const evtRes = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM sync_entities WHERE COALESCE(org_id, $1) = $1 AND entity_type IN ('access_event', 'event') AND updated_at >= $2`,
        [orgId, since]
      );
      totalEvents = evtRes.rows[0]?.cnt || 0;
      const deniedRes = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM sync_entities WHERE COALESCE(org_id, $1) = $1 AND entity_type IN ('access_event', 'event') AND updated_at >= $2 AND (data->>'eventType' = 'access_denied' OR data->>'accessGranted' = 'false')`,
        [orgId, since]
      );
      deniedCount = deniedRes.rows[0]?.cnt || 0;
    } catch (err) { log.debug({ err }, 'Failed to query access events for briefing (table may not exist)'); }

    // Posture score (tenant-scoped)
    let latestPosture: any = null;
    try {
      const postRes = await pool.query(
        `SELECT score, grade, metrics, created_at FROM posture_history WHERE COALESCE(org_id, $1) = $1 ORDER BY created_at DESC LIMIT 1`,
        [orgId]
      );
      if (postRes.rows.length > 0) latestPosture = postRes.rows[0];
    } catch (err) { log.debug({ err }, 'Failed to query posture history for briefing (table may not exist)'); }

    // Tips (tenant-scoped via COALESCE — tips table org_id may or may not exist)
    let newTipsCount = 0;
    try {
      const tipRes = await pool.query(
        `SELECT COUNT(*)::int as cnt FROM tips WHERE COALESCE(org_id, $1) = $1 AND created_at >= $2`,
        [orgId, since]
      );
      newTipsCount = tipRes.rows[0]?.cnt || 0;
    } catch (err) { log.debug({ err }, 'Failed to query tips for briefing (table may not exist)'); }

    // Sensor events (tenant-scoped)
    let sensorAlerts: any[] = [];
    try {
      const sensorRes = await pool.query(
        `SELECT id, sensor_type, event_type, severity, created_at FROM sensor_events WHERE COALESCE(org_id, $1) = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 10`,
        [orgId, since]
      );
      sensorAlerts = sensorRes.rows;
    } catch (err) { log.debug({ err }, 'Failed to query sensor events for briefing (table may not exist)'); }

    return {
      incidentsByStatus,
      openIncidents,
      alarmsByPriority,
      unacknowledgedCount,
      totalAlarms,
      totalEvents,
      deniedCount,
      latestPosture,
      newTipsCount,
      sensorAlerts,
    };
  }

  // ─── Helper: build briefing sections from stats ─────────────────
  function buildSections(stats: Awaited<ReturnType<typeof gatherStats>>, briefingType: string): BriefingSection[] {
    const sections: BriefingSection[] = [];

    // 1. Summary stats
    const totalIncidents = Object.values(stats.incidentsByStatus).reduce((a, b) => a + b, 0);
    sections.push({
      title: 'Summary',
      content: `Total incidents: ${totalIncidents}. Total alarms: ${stats.totalAlarms} (${stats.unacknowledgedCount} unacknowledged). Access events: ${stats.totalEvents} (${stats.deniedCount} denied). New tips: ${stats.newTipsCount}. Sensor alerts: ${stats.sensorAlerts.length}.`,
      stats: {
        total_incidents: totalIncidents,
        total_alarms: stats.totalAlarms,
        unacknowledged_alarms: stats.unacknowledgedCount,
        total_access_events: stats.totalEvents,
        denied_access_events: stats.deniedCount,
        new_tips: stats.newTipsCount,
        sensor_alerts: stats.sensorAlerts.length,
      },
    });

    // 2. Key incidents
    if (stats.openIncidents.length > 0) {
      sections.push({
        title: 'Key Incidents',
        content: `${stats.openIncidents.length} open incident(s) requiring attention.`,
        items: stats.openIncidents.map(i => ({
          id: i.id,
          title: i.title,
          priority: i.priority,
          status: i.status,
          created_at: i.created_at,
        })),
      });
    } else {
      sections.push({
        title: 'Key Incidents',
        content: 'No open incidents at this time.',
        items: [],
      });
    }

    // 3. Alarm statistics
    sections.push({
      title: 'Alarm Statistics',
      content: `${stats.totalAlarms} alarm(s) in period. ${stats.unacknowledgedCount} remain unacknowledged.`,
      stats: {
        by_priority: stats.alarmsByPriority,
        unacknowledged: stats.unacknowledgedCount,
      },
    });

    // 4. Access anomalies
    const denialRate = stats.totalEvents > 0 ? ((stats.deniedCount / stats.totalEvents) * 100).toFixed(1) : '0.0';
    sections.push({
      title: 'Access Anomalies',
      content: `${stats.deniedCount} access denied event(s) out of ${stats.totalEvents} total (${denialRate}% denial rate).`,
      stats: {
        denial_rate_pct: parseFloat(denialRate),
        denied_count: stats.deniedCount,
        total_events: stats.totalEvents,
      },
    });

    // 5. Posture score
    if (stats.latestPosture) {
      sections.push({
        title: 'Security Posture',
        content: `Current posture grade: ${stats.latestPosture.grade} (score: ${stats.latestPosture.score}/100).`,
        stats: {
          score: stats.latestPosture.score,
          grade: stats.latestPosture.grade,
          assessed_at: stats.latestPosture.created_at,
        },
      });
    }

    // 6. Sensor alerts
    if (stats.sensorAlerts.length > 0) {
      sections.push({
        title: 'Sensor Alerts',
        content: `${stats.sensorAlerts.length} sensor alert(s) recorded.`,
        items: stats.sensorAlerts,
      });
    }

    // 7. Recommendations
    const recommendations: string[] = [];
    if (stats.unacknowledgedCount > 0) recommendations.push(`Acknowledge ${stats.unacknowledgedCount} pending alarm(s).`);
    if (stats.openIncidents.length > 0) recommendations.push(`Resolve or escalate ${stats.openIncidents.length} open incident(s).`);
    if (parseFloat(denialRate) > 10) recommendations.push('High denial rate detected — review access policies and credential status.');
    if (stats.latestPosture && stats.latestPosture.score < 70) recommendations.push(`Security posture score is ${stats.latestPosture.score} — review posture recommendations.`);
    if (stats.sensorAlerts.length > 5) recommendations.push('Elevated sensor alert volume — investigate environmental conditions.');
    if (recommendations.length === 0) recommendations.push('No critical recommendations at this time. Continue routine monitoring.');

    sections.push({
      title: 'Recommendations',
      content: recommendations.join(' '),
      items: recommendations.map(r => ({ recommendation: r })),
    });

    return sections;
  }

  // ─── POST /briefings/generate — Generate a briefing (tenant-scoped) ─
  fastify.post('/briefings/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    const briefingType = body?.briefing_type || 'daily';
    const timeRangeHours = body?.time_range_hours || (briefingType === 'weekly' ? 168 : briefingType === 'executive' ? 24 : 8);
    const generatedBy = body?.generated_by || 'system';

    try {
      const stats = await gatherStats(timeRangeHours, orgId);
      const sections = buildSections(stats, briefingType);
      const title = buildTitle(briefingType);

      const totalIncidents = Object.values(stats.incidentsByStatus).reduce((a, b) => a + b, 0);
      const keyMetrics = {
        total_incidents: totalIncidents,
        open_incidents: stats.openIncidents.length,
        total_alarms: stats.totalAlarms,
        unacknowledged_alarms: stats.unacknowledgedCount,
        total_access_events: stats.totalEvents,
        denied_access_events: stats.deniedCount,
        posture_score: stats.latestPosture?.score || null,
        posture_grade: stats.latestPosture?.grade || null,
      };

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      try {
        await pool.query(`ALTER TABLE briefings ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
        await pool.query(`
          INSERT INTO briefings (id, org_id, briefing_type, title, generated_by, time_range_hours, sections, key_metrics, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [id, orgId, briefingType, title, generatedBy, timeRangeHours, JSON.stringify(sections), JSON.stringify(keyMetrics), now]);
      } catch (insertErr) {
        log.warn({ err: insertErr }, 'Could not save briefing — table may not exist');
      }

      return reply.code(201).send({
        id,
        briefing_type: briefingType,
        title,
        generated_by: generatedBy,
        time_range_hours: timeRangeHours,
        sections,
        key_metrics: keyMetrics,
        created_at: now,
      });
    } catch (err) {
      log.error({ err }, 'Failed to generate briefing');
      return reply.code(500).send({ error: 'Failed to generate briefing' });
    }
  });

  // ─── GET /briefings — List recent briefings (tenant-scoped) ─────────
  fastify.get('/briefings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '20', 10), 1), 500);
      const briefingType = q.type;

      let query = 'SELECT * FROM briefings WHERE COALESCE(org_id, $1) = $1';
      const values: any[] = [orgId];
      let idx = 2;

      if (briefingType) {
        query += ` AND briefing_type = $${idx++}`;
        values.push(briefingType);
      }

      query += ' ORDER BY created_at DESC';
      query += ` LIMIT $${idx}`;
      values.push(limit);

      const { rows } = await pool.query(query, values);

      // Parse JSON fields
      const briefings = rows.map(r => ({
        ...r,
        sections: typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections,
        key_metrics: typeof r.key_metrics === 'string' ? JSON.parse(r.key_metrics) : r.key_metrics,
      }));

      return reply.send({ briefings, total: briefings.length });
    } catch {
      return reply.send({ briefings: [], total: 0 });
    }
  });

  // ─── GET /briefings/schedule — Get scheduled auto-briefing configs
  fastify.get('/briefings/schedule', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { rows } = await pool.query('SELECT * FROM briefing_schedules ORDER BY created_at DESC');
      return reply.send({ schedules: rows, total: rows.length });
    } catch {
      // Table may not exist — return hardcoded defaults
      const defaults = [
        { id: 'default-daily', briefing_type: 'daily', cron: '0 6 * * *', time_range_hours: 24, enabled: true, description: 'Daily morning briefing at 06:00' },
        { id: 'default-weekly', briefing_type: 'weekly', cron: '0 8 * * 1', time_range_hours: 168, enabled: false, description: 'Weekly briefing every Monday at 08:00' },
        { id: 'default-executive', briefing_type: 'executive', cron: '0 7 * * 1', time_range_hours: 168, enabled: false, description: 'Executive briefing every Monday at 07:00' },
      ];
      return reply.send({ schedules: defaults, total: defaults.length, source: 'defaults' });
    }
  });

  // ─── GET /briefings/:id — Get a specific briefing (tenant-scoped) ─────
  fastify.get('/briefings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    try {
      const { rows } = await pool.query(
        'SELECT * FROM briefings WHERE id = $1 AND COALESCE(org_id, $2) = $2',
        [id, orgId]
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Briefing not found' });
      }
      const briefing = {
        ...rows[0],
        sections: typeof rows[0].sections === 'string' ? JSON.parse(rows[0].sections) : rows[0].sections,
        key_metrics: typeof rows[0].key_metrics === 'string' ? JSON.parse(rows[0].key_metrics) : rows[0].key_metrics,
      };
      return reply.send(briefing);
    } catch (err) {
      log.error({ err }, 'Failed to fetch briefing');
      return reply.code(500).send({ error: 'Failed to fetch briefing' });
    }
  });

  // ─── POST /briefings/shift-handoff — Shift handoff briefing (tenant-scoped) ─
  fastify.post('/briefings/shift-handoff', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    const outgoingOperator = body?.outgoing_operator || 'Unknown';
    const incomingOperator = body?.incoming_operator || 'Unknown';
    const shiftNotes = body?.shift_notes || '';
    const timeRangeHours = 8; // typical shift length

    try {
      const stats = await gatherStats(timeRangeHours, orgId);
      const sections: BriefingSection[] = [];

      // 1. Shift overview
      sections.push({
        title: 'Shift Overview',
        content: `Handoff from ${outgoingOperator} to ${incomingOperator}. Shift covered the last ${timeRangeHours} hours.`,
        stats: {
          outgoing_operator: outgoingOperator,
          incoming_operator: incomingOperator,
          shift_hours: timeRangeHours,
        },
      });

      // 2. Open items requiring attention
      const openItems: any[] = [];
      if (stats.openIncidents.length > 0) {
        openItems.push(...stats.openIncidents.map(i => ({
          type: 'incident',
          id: i.id,
          title: i.title,
          priority: i.priority,
          status: i.status,
        })));
      }
      if (stats.unacknowledgedCount > 0) {
        openItems.push({
          type: 'alarms',
          description: `${stats.unacknowledgedCount} unacknowledged alarm(s)`,
          count: stats.unacknowledgedCount,
        });
      }
      sections.push({
        title: 'Open Items',
        content: openItems.length > 0
          ? `${openItems.length} open item(s) require attention from incoming operator.`
          : 'No open items. All incidents and alarms have been addressed.',
        items: openItems,
      });

      // 3. Escalations
      const escalations: any[] = [];
      try {
        const escRes = await pool.query(
          `SELECT id, title, priority, status FROM incidents WHERE org_id = $1 AND priority IN ('critical', 'high') AND status NOT IN ('closed', 'resolved') ORDER BY created_at DESC LIMIT 10`,
          [orgId]
        );
        escalations.push(...escRes.rows.map(r => ({ type: 'incident', ...r })));
      } catch (err) { log.debug({ err }, 'Failed to query escalations for briefing (table may not exist)'); }
      sections.push({
        title: 'Escalations',
        content: escalations.length > 0
          ? `${escalations.length} high-priority item(s) escalated or pending escalation.`
          : 'No active escalations.',
        items: escalations,
      });

      // 4. Shift activity summary
      const totalIncidents = Object.values(stats.incidentsByStatus).reduce((a, b) => a + b, 0);
      sections.push({
        title: 'Shift Activity',
        content: `During this shift: ${totalIncidents} incident(s), ${stats.totalAlarms} alarm(s), ${stats.totalEvents} access event(s), ${stats.deniedCount} denied.`,
        stats: {
          incidents: totalIncidents,
          alarms: stats.totalAlarms,
          access_events: stats.totalEvents,
          denied_events: stats.deniedCount,
          sensor_alerts: stats.sensorAlerts.length,
        },
      });

      // 5. Outgoing operator notes
      sections.push({
        title: 'Operator Notes',
        content: shiftNotes || 'No additional notes from outgoing operator.',
      });

      const title = `Shift Handoff: ${outgoingOperator} → ${incomingOperator} — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const keyMetrics = {
        open_incidents: stats.openIncidents.length,
        unacknowledged_alarms: stats.unacknowledgedCount,
        total_alarms: stats.totalAlarms,
        total_access_events: stats.totalEvents,
        escalations: escalations.length,
        outgoing_operator: outgoingOperator,
        incoming_operator: incomingOperator,
      };

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      try {
        await pool.query(`ALTER TABLE briefings ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
        await pool.query(`
          INSERT INTO briefings (id, org_id, briefing_type, title, generated_by, time_range_hours, sections, key_metrics, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [id, orgId, 'shift_handoff', title, outgoingOperator, timeRangeHours, JSON.stringify(sections), JSON.stringify(keyMetrics), now]);
      } catch (insertErr) {
        log.warn({ err: insertErr }, 'Could not save shift handoff briefing — table may not exist');
      }

      return reply.code(201).send({
        id,
        briefing_type: 'shift_handoff',
        title,
        generated_by: outgoingOperator,
        time_range_hours: timeRangeHours,
        sections,
        key_metrics: keyMetrics,
        created_at: now,
      });
    } catch (err) {
      log.error({ err }, 'Failed to generate shift handoff briefing');
      return reply.code(500).send({ error: 'Failed to generate shift handoff briefing' });
    }
  });

  log.info('Briefing routes registered');
}
