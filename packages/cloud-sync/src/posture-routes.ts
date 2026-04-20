// @ts-nocheck
/**
 * Physical Security Posture Score Routes
 *
 * A-F grade showing organizational security hygiene.
 * Calculates score from access events, alarms, devices, drills, and credentials.
 *
 * Routes:
 *   GET /posture/score           — Current posture score with breakdown
 *   GET /posture/history         — Score history over time
 *   GET /posture/recommendations — Specific recommendations to improve
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:posture');

export interface PostureRoutesOptions {
  connectionString?: string;
}

interface MetricScore {
  name: string;
  key: string;
  score: number;
  weight: number;
  weightedScore: number;
  status: string;
  detail: string;
}

function getGrade(score: number): { grade: string; color: string } {
  if (score >= 90) return { grade: 'A', color: '#22c55e' };
  if (score >= 80) return { grade: 'B', color: '#3b82f6' };
  if (score >= 70) return { grade: 'C', color: '#f59e0b' };
  if (score >= 60) return { grade: 'D', color: '#f97316' };
  return { grade: 'F', color: '#ef4444' };
}

export async function postureRoutes(fastify: FastifyInstance, opts: PostureRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — posture routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  async function calculatePosture(orgId: string): Promise<{ score: number; grade: string; color: string; metrics: MetricScore[] }> {
    const metrics: MetricScore[] = [];
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000).toISOString();

    // 1. Dormant credentials (15%) — % of cardholders with no access in 90 days (tenant-scoped)
    try {
      const totalCh = await pool.query(`SELECT COUNT(*) as cnt FROM sync_entities WHERE COALESCE(org_id, $1) = $1 AND entity_type = 'cardholder'`, [orgId]);
      const totalCount = parseInt(totalCh.rows[0]?.cnt || '0', 10);
      // Cardholders with recent access
      const activeCh = await pool.query(`
        SELECT COUNT(DISTINCT data->>'cardholderName') as cnt FROM sync_entities
        WHERE COALESCE(org_id, $1) = $1 AND entity_type IN ('access_event', 'event') AND updated_at >= $2
      `, [orgId, ninetyDaysAgo]);
      const activeCount = parseInt(activeCh.rows[0]?.cnt || '0', 10);
      const dormantPct = totalCount > 0 ? ((totalCount - Math.min(activeCount, totalCount)) / totalCount) * 100 : 0;
      const score = Math.max(0, 100 - dormantPct * 2); // More dormant = lower score
      metrics.push({ name: 'Dormant Credentials', key: 'dormant_credentials', score: Math.round(score), weight: 15, weightedScore: score * 0.15, status: dormantPct < 10 ? 'good' : dormantPct < 30 ? 'warning' : 'critical', detail: `${Math.round(dormantPct)}% of credentials unused in 90 days` });
    } catch { metrics.push({ name: 'Dormant Credentials', key: 'dormant_credentials', score: 75, weight: 15, weightedScore: 75 * 0.15, status: 'unknown', detail: 'Unable to calculate' }); }

    // 2. Terminated but active badges (20%) — tenant-scoped
    try {
      const terminated = await pool.query(`
        SELECT COUNT(*) as cnt FROM sync_entities
        WHERE COALESCE(org_id, $1) = $1 AND entity_type = 'cardholder' AND (data->>'status' = 'inactive' OR data->>'status' = 'terminated')
      `, [orgId]);
      const termCount = parseInt(terminated.rows[0]?.cnt || '0', 10);
      const score = termCount === 0 ? 100 : Math.max(0, 100 - termCount * 10);
      metrics.push({ name: 'Terminated Badge Audit', key: 'terminated_badges', score: Math.round(score), weight: 20, weightedScore: score * 0.20, status: termCount === 0 ? 'good' : 'critical', detail: `${termCount} terminated/inactive badges still in system` });
    } catch { metrics.push({ name: 'Terminated Badge Audit', key: 'terminated_badges', score: 80, weight: 20, weightedScore: 80 * 0.20, status: 'unknown', detail: 'Unable to calculate' }); }

    // 3. Door forced events this month (15%) — tenant-scoped
    try {
      const forced = await pool.query(`
        SELECT COUNT(*) as cnt FROM sync_entities
        WHERE COALESCE(org_id, $1) = $1 AND entity_type IN ('access_event', 'event') AND data->>'eventType' = 'door_forced' AND updated_at >= $2
      `, [orgId, thirtyDaysAgo]);
      const forcedCount = parseInt(forced.rows[0]?.cnt || '0', 10);
      const score = Math.max(0, 100 - forcedCount * 5);
      metrics.push({ name: 'Door Forced Events', key: 'door_forced', score: Math.round(score), weight: 15, weightedScore: score * 0.15, status: forcedCount === 0 ? 'good' : forcedCount < 5 ? 'warning' : 'critical', detail: `${forcedCount} door forced events this month` });
    } catch { metrics.push({ name: 'Door Forced Events', key: 'door_forced', score: 90, weight: 15, weightedScore: 90 * 0.15, status: 'unknown', detail: 'Unable to calculate' }); }

    // 4. Alarm acknowledgment rate (10%) — tenant-scoped
    try {
      const total = await pool.query(`SELECT COUNT(*) as cnt FROM alarms WHERE org_id = $1 AND created_at >= $2`, [orgId, thirtyDaysAgo]);
      const acked = await pool.query(`SELECT COUNT(*) as cnt FROM alarms WHERE org_id = $1 AND acknowledged_at IS NOT NULL AND created_at >= $2`, [orgId, thirtyDaysAgo]);
      const totalAlarms = parseInt(total.rows[0]?.cnt || '0', 10);
      const ackedCount = parseInt(acked.rows[0]?.cnt || '0', 10);
      const rate = totalAlarms > 0 ? (ackedCount / totalAlarms) * 100 : 100;
      metrics.push({ name: 'Alarm Acknowledgment Rate', key: 'alarm_ack_rate', score: Math.round(rate), weight: 10, weightedScore: rate * 0.10, status: rate >= 90 ? 'good' : rate >= 70 ? 'warning' : 'critical', detail: `${Math.round(rate)}% of alarms acknowledged` });
    } catch { metrics.push({ name: 'Alarm Acknowledgment Rate', key: 'alarm_ack_rate', score: 85, weight: 10, weightedScore: 85 * 0.10, status: 'unknown', detail: 'Unable to calculate' }); }

    // 5. Average alarm response time (10%) — tenant-scoped
    try {
      const rt = await pool.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (acknowledged_at::timestamp - created_at::timestamp))) as avg_sec
        FROM alarms WHERE org_id = $1 AND acknowledged_at IS NOT NULL AND created_at >= $2
      `, [orgId, thirtyDaysAgo]);
      const avgSec = parseFloat(rt.rows[0]?.avg_sec || '300');
      // Under 5 min = 100, under 15 min = 80, under 30 min = 60, over = 40
      const score = avgSec <= 300 ? 100 : avgSec <= 900 ? 80 : avgSec <= 1800 ? 60 : 40;
      const avgMin = Math.round(avgSec / 60);
      metrics.push({ name: 'Alarm Response Time', key: 'alarm_response_time', score, weight: 10, weightedScore: score * 0.10, status: score >= 80 ? 'good' : score >= 60 ? 'warning' : 'critical', detail: `Average response: ${avgMin} minutes` });
    } catch { metrics.push({ name: 'Alarm Response Time', key: 'alarm_response_time', score: 75, weight: 10, weightedScore: 75 * 0.10, status: 'unknown', detail: 'Unable to calculate' }); }

    // 6. After-hours access rate (10%) — tenant-scoped
    try {
      const total = await pool.query(`SELECT COUNT(*) as cnt FROM sync_entities WHERE COALESCE(org_id, $1) = $1 AND entity_type IN ('access_event', 'event') AND updated_at >= $2`, [orgId, thirtyDaysAgo]);
      const afterHours = await pool.query(`
        SELECT COUNT(*) as cnt FROM sync_entities
        WHERE COALESCE(org_id, $1) = $1 AND entity_type IN ('access_event', 'event') AND updated_at >= $2
        AND (EXTRACT(HOUR FROM updated_at) < 6 OR EXTRACT(HOUR FROM updated_at) >= 22)
      `, [orgId, thirtyDaysAgo]);
      const totalE = parseInt(total.rows[0]?.cnt || '0', 10);
      const ahCount = parseInt(afterHours.rows[0]?.cnt || '0', 10);
      const rate = totalE > 0 ? (ahCount / totalE) * 100 : 0;
      const score = Math.max(0, 100 - rate * 3);
      metrics.push({ name: 'After-Hours Access', key: 'after_hours', score: Math.round(score), weight: 10, weightedScore: score * 0.10, status: rate < 5 ? 'good' : rate < 15 ? 'warning' : 'critical', detail: `${Math.round(rate)}% of access events after hours` });
    } catch { metrics.push({ name: 'After-Hours Access', key: 'after_hours', score: 85, weight: 10, weightedScore: 85 * 0.10, status: 'unknown', detail: 'Unable to calculate' }); }

    // 7. Denied access rate (5%) — tenant-scoped
    try {
      const total = await pool.query(`SELECT COUNT(*) as cnt FROM sync_entities WHERE COALESCE(org_id, $1) = $1 AND entity_type IN ('access_event', 'event') AND updated_at >= $2`, [orgId, thirtyDaysAgo]);
      const denied = await pool.query(`
        SELECT COUNT(*) as cnt FROM sync_entities
        WHERE COALESCE(org_id, $1) = $1 AND entity_type IN ('access_event', 'event') AND updated_at >= $2
        AND (data->>'eventType' = 'access_denied' OR data->>'accessGranted' = 'false')
      `, [orgId, thirtyDaysAgo]);
      const totalE = parseInt(total.rows[0]?.cnt || '0', 10);
      const deniedCount = parseInt(denied.rows[0]?.cnt || '0', 10);
      const rate = totalE > 0 ? (deniedCount / totalE) * 100 : 0;
      // Some denials are normal; too many or too few can be suspicious
      const score = rate < 1 ? 90 : rate < 5 ? 100 : rate < 15 ? 80 : rate < 30 ? 60 : 40;
      metrics.push({ name: 'Denied Access Rate', key: 'denied_rate', score, weight: 5, weightedScore: score * 0.05, status: score >= 80 ? 'good' : score >= 60 ? 'warning' : 'critical', detail: `${Math.round(rate)}% denial rate` });
    } catch { metrics.push({ name: 'Denied Access Rate', key: 'denied_rate', score: 85, weight: 5, weightedScore: 85 * 0.05, status: 'unknown', detail: 'Unable to calculate' }); }

    // 8. System health — % devices online (10%) — tenant-scoped
    try {
      const devices = await pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '10 minutes') as online FROM sync_devices WHERE COALESCE(org_id, $1) = $1`, [orgId]);
      const totalD = parseInt(devices.rows[0]?.total || '0', 10);
      const onlineD = parseInt(devices.rows[0]?.online || '0', 10);
      const rate = totalD > 0 ? (onlineD / totalD) * 100 : 100;
      metrics.push({ name: 'System Health', key: 'system_health', score: Math.round(rate), weight: 10, weightedScore: rate * 0.10, status: rate >= 90 ? 'good' : rate >= 70 ? 'warning' : 'critical', detail: `${onlineD}/${totalD} devices online` });
    } catch { metrics.push({ name: 'System Health', key: 'system_health', score: 90, weight: 10, weightedScore: 90 * 0.10, status: 'unknown', detail: 'Unable to calculate' }); }

    // 9. Drill compliance (5%) — tenant-scoped
    try {
      const drills = await pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'completed') as completed FROM drills WHERE org_id = $1 AND scheduled_date >= $2`, [orgId, ninetyDaysAgo]);
      const totalDr = parseInt(drills.rows[0]?.total || '0', 10);
      const completedDr = parseInt(drills.rows[0]?.completed || '0', 10);
      const rate = totalDr > 0 ? (completedDr / totalDr) * 100 : 50;
      metrics.push({ name: 'Drill Compliance', key: 'drill_compliance', score: Math.round(rate), weight: 5, weightedScore: rate * 0.05, status: rate >= 90 ? 'good' : rate >= 70 ? 'warning' : 'critical', detail: `${completedDr}/${totalDr} drills completed on time` });
    } catch { metrics.push({ name: 'Drill Compliance', key: 'drill_compliance', score: 75, weight: 5, weightedScore: 75 * 0.05, status: 'unknown', detail: 'Unable to calculate' }); }

    const totalScore = Math.round(metrics.reduce((sum, m) => sum + m.weightedScore, 0));
    const { grade, color } = getGrade(totalScore);

    return { score: totalScore, grade, color, metrics };
  }

  // ─── GET /posture/score — Current posture score (tenant-scoped) ────
  fastify.get('/posture/score', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const posture = await calculatePosture(orgId);

      // Save score to history (tenant-scoped; column added lazily)
      try {
        await pool.query(`ALTER TABLE posture_history ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
        await pool.query(`
          INSERT INTO posture_history (id, org_id, score, grade, metrics, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [crypto.randomUUID(), orgId, posture.score, posture.grade, JSON.stringify(posture.metrics), new Date().toISOString()]);
      } catch (err) { log.debug({ err }, 'Failed to save posture score to history (table may not exist)'); }

      return reply.send(posture);
    } catch (err) {
      log.error({ err }, 'Failed to calculate posture score');
      return reply.code(500).send({ error: 'Failed to calculate posture score' });
    }
  });

  // ─── GET /posture/history — Score history over time (tenant-scoped) ────────────
  fastify.get('/posture/history', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '12', 10), 1), 500);
      const { rows } = await pool.query(
        `SELECT * FROM posture_history WHERE COALESCE(org_id, $1) = $1 ORDER BY created_at DESC LIMIT $2`,
        [orgId, limit]
      );
      return reply.send({ history: rows, total: rows.length });
    } catch (err) {
      // Table may not exist yet
      return reply.send({ history: [], total: 0 });
    }
  });

  // ─── GET /posture/recommendations — Improvement recommendations (tenant-scoped) ─
  fastify.get('/posture/recommendations', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const posture = await calculatePosture(orgId);
      const recommendations: Array<{ priority: string; category: string; recommendation: string; impact: string }> = [];

      for (const m of posture.metrics) {
        if (m.status === 'critical') {
          recommendations.push({
            priority: 'high',
            category: m.name,
            recommendation: getRecommendation(m.key, 'critical'),
            impact: `Could improve overall score by up to ${Math.round(m.weight * 0.4)} points`,
          });
        } else if (m.status === 'warning') {
          recommendations.push({
            priority: 'medium',
            category: m.name,
            recommendation: getRecommendation(m.key, 'warning'),
            impact: `Could improve overall score by up to ${Math.round(m.weight * 0.2)} points`,
          });
        }
      }

      // Sort by priority
      recommendations.sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1));

      return reply.send({
        currentScore: posture.score,
        currentGrade: posture.grade,
        recommendations,
        potentialScore: Math.min(100, posture.score + recommendations.reduce((sum, r) => sum + parseInt(r.impact.match(/\d+/)?.[0] || '0', 10), 0)),
      });
    } catch (err) {
      log.error({ err }, 'Failed to generate recommendations');
      return reply.code(500).send({ error: 'Failed to generate recommendations' });
    }
  });

  log.info('Posture score routes registered');
}

function getRecommendation(key: string, severity: string): string {
  const recs: Record<string, Record<string, string>> = {
    dormant_credentials: {
      critical: 'Review and disable credentials unused for 90+ days. Audit all dormant badges and deactivate those belonging to departed employees or inactive roles.',
      warning: 'Schedule a quarterly credential audit. Identify credentials with low usage and verify they are still needed.',
    },
    terminated_badges: {
      critical: 'URGENT: Immediately disable all badges belonging to terminated employees. Implement an automated HR-to-access-control deprovisioning workflow.',
      warning: 'Verify all terminated employee badges are deactivated. Set up alerts for badge usage after employment end dates.',
    },
    door_forced: {
      critical: 'Investigate all door forced events. Check door hardware, ensure closers and strikes are functioning. Consider adding surveillance at high-incident doors.',
      warning: 'Review door forced events for patterns. Some may indicate hardware issues rather than security breaches.',
    },
    alarm_ack_rate: {
      critical: 'Improve alarm monitoring staffing. Unacknowledged alarms indicate gaps in GSOC coverage. Review operator workload and alarm volumes.',
      warning: 'Review alarm acknowledgment procedures. Ensure operators are trained on priority-based triage.',
    },
    alarm_response_time: {
      critical: 'Response times are too high. Review GSOC staffing, alarm routing, and SOP procedures. Consider adding auto-escalation rules.',
      warning: 'Work on reducing average response time. Implement priority-based notification and auto-assignment of critical alarms.',
    },
    after_hours: {
      critical: 'High volume of after-hours access detected. Review which personnel have after-hours privileges and restrict where possible.',
      warning: 'Monitor after-hours access patterns. Verify that after-hours access is authorized and documented.',
    },
    denied_rate: {
      critical: 'Abnormally high denial rate suggests credential issues, misconfigured access policies, or potential unauthorized access attempts.',
      warning: 'Review denied access events for patterns. Some may indicate need for access policy adjustments.',
    },
    system_health: {
      critical: 'Multiple devices offline. Check network connectivity, power, and device health. Offline devices create security blind spots.',
      warning: 'Some devices are offline. Schedule maintenance to restore full coverage.',
    },
    drill_compliance: {
      critical: 'Drills are not being completed on schedule. This may violate regulatory requirements. Schedule overdue drills immediately.',
      warning: 'Some drills are behind schedule. Review drill calendar and ensure adequate staffing for upcoming drills.',
    },
  };
  return recs[key]?.[severity] || 'Review this metric and take corrective action to improve your security posture.';
}
