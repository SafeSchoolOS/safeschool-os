// @ts-nocheck
/**
 * System Health Monitoring Routes — tenant-scoped.
 * Each device inventory row (server, camera, panel, NVR) carries org_id;
 * heartbeats bind to the device's tenant via HEALTH_INGEST_ORG_MAP / legacy
 * HEALTH_INGEST_KEY + HEALTH_INGEST_ORG. Reads filter by caller JWT org.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { safeEqualSecret, getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:health');

const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

export interface HealthRoutesOptions {
  connectionString?: string;
}

/** Device-key → orgId resolver. Per-key map (HEALTH_INGEST_ORG_MAP) beats
 *  legacy single-key (HEALTH_INGEST_KEY → HEALTH_INGEST_ORG/DEFAULT_ORG).
 *  Fail-closed if map is configured but no key matches. */
function resolveHealthIngestOrg(request: FastifyRequest): string | null {
  const provided = request.headers['x-device-key'];
  let mapSet = false;
  try {
    if (process.env.HEALTH_INGEST_ORG_MAP) {
      mapSet = true;
      const map = JSON.parse(process.env.HEALTH_INGEST_ORG_MAP);
      for (const [key, mappedOrg] of Object.entries(map)) {
        if (safeEqualSecret(key, provided)) return String(mappedOrg);
      }
    }
  } catch (err) {
    log.warn({ err }, 'HEALTH_INGEST_ORG_MAP failed to parse — ignoring');
    mapSet = false;
  }
  if (mapSet) return null;

  const legacyKey = process.env.HEALTH_INGEST_KEY || process.env.CLOUD_SYNC_KEY;
  if (!safeEqualSecret(legacyKey, provided)) return null;
  return process.env.HEALTH_INGEST_ORG || DEFAULT_ORG;
}

export async function healthRoutes(fastify: FastifyInstance, opts: HealthRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — health routes disabled');
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
    await ensureOrgColumn(pool, 'system_health', 'system_health');
    await ensureOrgColumn(pool, 'system_health_history', 'system_health_history');
    tableMigrated = true;
  }

  // ─── GET /health/systems (tenant-scoped) ────────────────────
  fastify.get('/health/systems', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
      if (q.system_type) { conditions.push(`system_type = $${idx++}`); params.push(q.system_type); }
      if (q.vendor) { conditions.push(`vendor = $${idx++}`); params.push(q.vendor); }
      if (q.location) { conditions.push(`location ILIKE $${idx++}`); params.push('%' + q.location + '%'); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const limit = Math.min(Math.max(parseInt(q.limit || '200', 10), 1), 500);
      const offset = Math.max(parseInt(q.offset || '0', 10), 0);

      const countRes = await pool.query(`SELECT COUNT(*) as total FROM system_health ${where}`, params);
      const total = parseInt(countRes.rows[0].total, 10);

      const dataRes = await pool.query(
        `SELECT * FROM system_health ${where} ORDER BY
          CASE status WHEN 'offline' THEN 0 WHEN 'degraded' THEN 1 WHEN 'maintenance' THEN 2 WHEN 'online' THEN 3 ELSE 4 END ASC,
          system_name ASC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return reply.send({ systems: dataRes.rows, total, limit, offset });
    } catch (err) {
      log.error({ err }, 'Failed to list systems');
      return reply.code(500).send({ error: 'Failed to list systems' });
    }
  });

  // ─── POST /health/systems (tenant-scoped) ───────────────────
  fastify.post('/health/systems', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const now = new Date().toISOString();
      const id = body.id || crypto.randomUUID();

      await pool.query(`
        INSERT INTO system_health (id, org_id, system_name, system_type, vendor, ip_address, location,
          status, last_seen, uptime_percent, cpu_usage, memory_usage, disk_usage,
          firmware_version, patch_level, license_type, license_expiry, warranty_expiry,
          last_maintenance, notes, device_id, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      `, [
        id, orgId,
        body.system_name || 'Unnamed System',
        body.system_type || 'other',
        body.vendor || 'other',
        body.ip_address || null,
        body.location || null,
        body.status || 'unknown',
        now,
        body.uptime_percent || 100.0,
        body.cpu_usage || null,
        body.memory_usage || null,
        body.disk_usage || null,
        body.firmware_version || null,
        body.patch_level || null,
        body.license_type || null,
        body.license_expiry || null,
        body.warranty_expiry || null,
        body.last_maintenance || null,
        body.notes || null,
        body.device_id || null,
        now, now,
      ]);

      log.info({ id, orgId, name: body.system_name, type: body.system_type }, 'System registered');
      return reply.code(201).send({ id, system_name: body.system_name, status: body.status || 'unknown' });
    } catch (err) {
      log.error({ err }, 'Failed to register system');
      return reply.code(500).send({ error: 'Failed to register system' });
    }
  });

  // ─── PUT /health/systems/:id (tenant-scoped) ────────────────
  fastify.put('/health/systems/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const now = new Date().toISOString();

      const fields: string[] = [];
      const params: any[] = [];
      let idx = 1;

      const allowedFields = ['system_name', 'system_type', 'vendor', 'ip_address', 'location',
        'status', 'firmware_version', 'patch_level', 'license_type', 'license_expiry',
        'warranty_expiry', 'last_maintenance', 'notes', 'device_id'];

      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          fields.push(`${field} = $${idx++}`);
          params.push(body[field]);
        }
      }

      if (fields.length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      fields.push(`updated_at = $${idx++}`);
      params.push(now);
      params.push(id, orgId);

      const { rowCount } = await pool.query(
        `UPDATE system_health SET ${fields.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
        params
      );

      if (rowCount === 0) return reply.code(404).send({ error: 'System not found' });
      return reply.send({ success: true, id });
    } catch (err) {
      log.error({ err }, 'Failed to update system');
      return reply.code(500).send({ error: 'Failed to update system' });
    }
  });

  // ─── DELETE /health/systems/:id (tenant-scoped) ─────────────
  fastify.delete('/health/systems/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const { rowCount } = await pool.query(
        'DELETE FROM system_health WHERE id = $1 AND COALESCE(org_id, $2) = $2',
        [id, orgId]
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'System not found' });
      await pool.query('DELETE FROM system_health_history WHERE system_id = $1', [id]).catch((err) => { log.warn({ err, systemId: id }, 'Failed to clean up system health history'); });
      return reply.send({ success: true, deleted: id });
    } catch (err) {
      log.error({ err }, 'Failed to delete system');
      return reply.code(500).send({ error: 'Failed to delete system' });
    }
  });

  // ─── GET /health/systems/:id/history (tenant-scoped) ────────
  fastify.get('/health/systems/:id/history', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '288', 10), 1), 2000);
      const since = q.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Verify system belongs to caller's tenant first
      const sys = await pool.query(
        'SELECT id FROM system_health WHERE id = $1 AND COALESCE(org_id, $2) = $2',
        [id, orgId]
      );
      if (sys.rows.length === 0) return reply.code(404).send({ error: 'System not found' });

      const { rows } = await pool.query(
        `SELECT * FROM system_health_history
         WHERE system_id = $1 AND checked_at >= $2
         ORDER BY checked_at DESC LIMIT $3`,
        [id, since, limit]
      );

      return reply.send({ history: rows, system_id: id });
    } catch (err) {
      log.error({ err }, 'Failed to get system history');
      return reply.code(500).send({ error: 'Failed to get system history' });
    }
  });

  // ─── GET /health/dashboard (tenant-scoped) ──────────────────
  fastify.get('/health/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const statusRes = await pool.query(
        `SELECT status, COUNT(*) as count FROM system_health WHERE COALESCE(org_id, $1) = $1 GROUP BY status`,
        [orgId]
      );
      const statusCounts = { online: 0, offline: 0, degraded: 0, maintenance: 0, unknown: 0, total: 0 };
      for (const row of statusRes.rows) {
        statusCounts[row.status] = parseInt(row.count, 10);
        statusCounts.total += parseInt(row.count, 10);
      }

      const typeRes = await pool.query(`
        SELECT system_type, COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'online') as online,
          COUNT(*) FILTER (WHERE status = 'offline') as offline,
          COUNT(*) FILTER (WHERE status = 'degraded') as degraded
        FROM system_health WHERE COALESCE(org_id, $1) = $1 GROUP BY system_type ORDER BY system_type
      `, [orgId]);

      const licExpRes = await pool.query(`
        SELECT id, system_name, system_type, vendor, license_type, license_expiry
        FROM system_health
        WHERE COALESCE(org_id, $1) = $1 AND license_expiry IS NOT NULL
          AND license_expiry <= (NOW() + INTERVAL '90 days')::TEXT
          AND license_expiry >= NOW()::TEXT
        ORDER BY license_expiry ASC
      `, [orgId]);

      const licExpiredRes = await pool.query(`
        SELECT id, system_name, system_type, vendor, license_type, license_expiry
        FROM system_health
        WHERE COALESCE(org_id, $1) = $1 AND license_expiry IS NOT NULL AND license_expiry < NOW()::TEXT
        ORDER BY license_expiry ASC
      `, [orgId]);

      const warExpRes = await pool.query(`
        SELECT id, system_name, system_type, vendor, warranty_expiry
        FROM system_health
        WHERE COALESCE(org_id, $1) = $1 AND warranty_expiry IS NOT NULL
          AND warranty_expiry <= (NOW() + INTERVAL '90 days')::TEXT
          AND warranty_expiry >= NOW()::TEXT
        ORDER BY warranty_expiry ASC
      `, [orgId]);

      const uptimeRes = await pool.query(
        `SELECT AVG(uptime_percent) as avg_uptime FROM system_health WHERE COALESCE(org_id, $1) = $1 AND uptime_percent IS NOT NULL`,
        [orgId]
      );
      const avgUptime = uptimeRes.rows[0]?.avg_uptime ? Math.round(parseFloat(uptimeRes.rows[0].avg_uptime) * 100) / 100 : 100;

      const staleRes = await pool.query(`
        SELECT COUNT(*) as count FROM system_health
        WHERE COALESCE(org_id, $1) = $1 AND last_seen < (NOW() - INTERVAL '15 minutes')::TEXT
          AND status != 'maintenance'
      `, [orgId]);
      const staleCount = parseInt(staleRes.rows[0]?.count || '0', 10);

      return reply.send({
        status: statusCounts,
        byType: typeRes.rows,
        expiringLicenses: licExpRes.rows,
        expiredLicenses: licExpiredRes.rows,
        expiringWarranties: warExpRes.rows,
        avgUptime,
        staleCount,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get health dashboard');
      return reply.code(500).send({ error: 'Failed to get health dashboard' });
    }
  });

  // ─── GET /health/alerts (tenant-scoped) ─────────────────────
  fastify.get('/health/alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const alerts = [];

      const offlineRes = await pool.query(
        `SELECT * FROM system_health WHERE COALESCE(org_id, $1) = $1 AND status = 'offline' ORDER BY last_seen ASC`,
        [orgId]
      );
      for (const sys of offlineRes.rows) {
        alerts.push({
          type: 'offline', severity: 'critical',
          system_id: sys.id, system_name: sys.system_name, system_type: sys.system_type,
          message: `${sys.system_name} is offline (last seen: ${sys.last_seen || 'never'})`,
          last_seen: sys.last_seen,
        });
      }

      const degradedRes = await pool.query(
        `SELECT * FROM system_health WHERE COALESCE(org_id, $1) = $1 AND status = 'degraded' ORDER BY last_seen ASC`,
        [orgId]
      );
      for (const sys of degradedRes.rows) {
        alerts.push({
          type: 'degraded', severity: 'high',
          system_id: sys.id, system_name: sys.system_name, system_type: sys.system_type,
          message: `${sys.system_name} is degraded`,
          last_seen: sys.last_seen,
        });
      }

      const resourceRes = await pool.query(
        `SELECT * FROM system_health WHERE COALESCE(org_id, $1) = $1 AND (cpu_usage > 90 OR memory_usage > 90 OR disk_usage > 90)`,
        [orgId]
      );
      for (const sys of resourceRes.rows) {
        const issues = [];
        if (sys.cpu_usage > 90) issues.push(`CPU ${sys.cpu_usage}%`);
        if (sys.memory_usage > 90) issues.push(`Memory ${sys.memory_usage}%`);
        if (sys.disk_usage > 90) issues.push(`Disk ${sys.disk_usage}%`);
        alerts.push({
          type: 'resource', severity: 'high',
          system_id: sys.id, system_name: sys.system_name, system_type: sys.system_type,
          message: `${sys.system_name}: High resource usage — ${issues.join(', ')}`,
        });
      }

      const expiredRes = await pool.query(
        `SELECT * FROM system_health WHERE COALESCE(org_id, $1) = $1 AND license_expiry IS NOT NULL AND license_expiry < NOW()::TEXT`,
        [orgId]
      );
      for (const sys of expiredRes.rows) {
        alerts.push({
          type: 'license_expired', severity: 'critical',
          system_id: sys.id, system_name: sys.system_name, system_type: sys.system_type,
          message: `${sys.system_name}: License expired (${sys.license_expiry})`,
        });
      }

      const expiringRes = await pool.query(
        `SELECT * FROM system_health WHERE COALESCE(org_id, $1) = $1 AND license_expiry IS NOT NULL
         AND license_expiry >= NOW()::TEXT AND license_expiry <= (NOW() + INTERVAL '30 days')::TEXT`,
        [orgId]
      );
      for (const sys of expiringRes.rows) {
        alerts.push({
          type: 'license_expiring', severity: 'high',
          system_id: sys.id, system_name: sys.system_name, system_type: sys.system_type,
          message: `${sys.system_name}: License expiring soon (${sys.license_expiry})`,
        });
      }

      const warExpiredRes = await pool.query(
        `SELECT * FROM system_health WHERE COALESCE(org_id, $1) = $1 AND warranty_expiry IS NOT NULL AND warranty_expiry < NOW()::TEXT`,
        [orgId]
      );
      for (const sys of warExpiredRes.rows) {
        alerts.push({
          type: 'warranty_expired', severity: 'medium',
          system_id: sys.id, system_name: sys.system_name, system_type: sys.system_type,
          message: `${sys.system_name}: Warranty expired (${sys.warranty_expiry})`,
        });
      }

      const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      alerts.sort((a, b) => (sevOrder[a.severity] || 4) - (sevOrder[b.severity] || 4));

      return reply.send({ alerts, total: alerts.length });
    } catch (err) {
      log.error({ err }, 'Failed to get health alerts');
      return reply.code(500).send({ error: 'Failed to get health alerts' });
    }
  });

  // ─── GET /health/uptime (tenant-scoped) ─────────────────────
  fastify.get('/health/uptime', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);

      const { rows } = await pool.query(`
        SELECT id, system_name, system_type, vendor, location, status,
          uptime_percent, last_seen, created_at,
          EXTRACT(EPOCH FROM (NOW() - created_at::timestamp)) / 86400 as days_monitored
        FROM system_health
        WHERE COALESCE(org_id, $1) = $1
        ORDER BY uptime_percent ASC NULLS LAST
        LIMIT $2
      `, [orgId, limit]);

      return reply.send({ systems: rows });
    } catch (err) {
      log.error({ err }, 'Failed to get uptime report');
      return reply.code(500).send({ error: 'Failed to get uptime report' });
    }
  });

  log.info('Health monitoring routes registered');
}

/**
 * Public heartbeat ingest endpoint — edge devices report system health.
 * Authenticated via X-Device-Key. Device-key → orgId binding via
 * HEALTH_INGEST_ORG_MAP (JSON) or legacy HEALTH_INGEST_KEY+HEALTH_INGEST_ORG.
 */
export async function healthIngestRoute(fastify: FastifyInstance, opts: HealthRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — health ingest route disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 3,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  fastify.post('/api/v1/health/systems/:id/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Resolve tenant server-side from the device key; never trust the body.
      const boundOrg = resolveHealthIngestOrg(request);
      if (!boundOrg) {
        return reply.code(401).send({ error: 'Invalid or missing X-Device-Key' });
      }

      const { id } = request.params as { id: string };
      const body = request.body as any;
      const now = new Date().toISOString();

      const status = body.status || 'online';
      const cpuUsage = body.cpu_usage ?? null;
      const memoryUsage = body.memory_usage ?? null;
      const diskUsage = body.disk_usage ?? null;
      const responseTimeMs = body.response_time_ms ?? null;

      // Update system record — only if it's in the caller's tenant.
      const { rowCount } = await pool.query(`
        UPDATE system_health SET
          status = $1, last_seen = $2, cpu_usage = $3, memory_usage = $4, disk_usage = $5,
          firmware_version = COALESCE($6, firmware_version),
          updated_at = $2
        WHERE id = $7 AND COALESCE(org_id, $8) = $8
      `, [status, now, cpuUsage, memoryUsage, diskUsage, body.firmware_version || null, id, boundOrg]);

      if (rowCount === 0) {
        return reply.code(404).send({ error: 'System not found. Register it first via POST /health/systems' });
      }

      try {
        const uptimeRes = await pool.query(`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'online') as online_count
          FROM system_health_history WHERE system_id = $1
        `, [id]);
        const total = parseInt(uptimeRes.rows[0].total, 10) + 1;
        const online = parseInt(uptimeRes.rows[0].online_count, 10) + (status === 'online' ? 1 : 0);
        const uptimePercent = Math.round((online / total) * 10000) / 100;
        await pool.query(
          'UPDATE system_health SET uptime_percent = $1 WHERE id = $2 AND COALESCE(org_id, $3) = $3',
          [uptimePercent, id, boundOrg]
        );
      } catch (err) { log.debug({ err, systemId: id }, 'Uptime calculation failed (best-effort)'); }

      // History insert (also stamps org_id)
      await pool.query(`
        INSERT INTO system_health_history (id, org_id, system_id, status, cpu_usage, memory_usage, disk_usage, response_time_ms, checked_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [crypto.randomUUID(), boundOrg, id, status, cpuUsage, memoryUsage, diskUsage, responseTimeMs, now]);

      return reply.send({ success: true, status, last_seen: now });
    } catch (err) {
      log.error({ err }, 'Failed to process heartbeat');
      return reply.code(500).send({ error: 'Failed to process heartbeat' });
    }
  });
}
