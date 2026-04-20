// @ts-nocheck
/**
 * Environmental Sensor Integration Routes (SafeSchool, SafeSchool)
 *
 * Ingest and manage sensor events from vape detectors, gunshot sensors,
 * noise monitors, air quality sensors, and other IoT devices.
 *
 * Provides:
 *   - POST   /sensors/event              — Ingest sensor event (public, device-key auth)
 *   - GET    /sensors/events             — List events with filters
 *   - GET    /sensors/active-alerts      — Active sensor alerts
 *   - POST   /sensors/events/:id/acknowledge — Acknowledge sensor alert
 *   - POST   /sensors/events/:id/resolve     — Resolve sensor alert
 *   - GET    /sensors/stats              — Sensor dashboard stats
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { safeEqualSecret, getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:sensors');

const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

/** Resolve tenant for a sensor ingest by device key.
 *  Fail-closed semantics:
 *    1. If SENSOR_ORG_MAP is set → the provided key MUST match an entry. If no
 *       map entry matches, reject (null) rather than falling through to the
 *       legacy single-key path. This prevents an "operator set the map but
 *       forgot to remove legacy key" config from silently accepting any key.
 *    2. Otherwise, if SENSOR_KEY is set → must match, binds to SENSOR_ORG.
 *    3. Otherwise (no keys configured anywhere) → sensor ingest is open; pin
 *       to DEFAULT_ORG. Ops deploys SHOULD set at least one key in prod. */
function resolveSensorIngestOrg(request: FastifyRequest): string | null {
  const provided = request.headers['x-sensor-key'] || request.headers['x-device-key'];
  let mapSet = false;
  try {
    if (process.env.SENSOR_ORG_MAP) {
      mapSet = true;
      const map = JSON.parse(process.env.SENSOR_ORG_MAP);
      for (const [key, mappedOrg] of Object.entries(map)) {
        if (safeEqualSecret(key, provided)) return String(mappedOrg);
      }
    }
  } catch (err) {
    log.warn({ err }, 'SENSOR_ORG_MAP failed to parse — ignoring');
    mapSet = false;
  }
  // If a map was provided but matched nothing, fail closed.
  if (mapSet) return null;

  const legacyKey = process.env.SENSOR_KEY;
  if (legacyKey) {
    if (!safeEqualSecret(legacyKey, provided)) return null;
    return process.env.SENSOR_ORG || DEFAULT_ORG;
  }
  // No keys configured → sensor ingest is open. Pin to default org so rows
  // still land somewhere predictable.
  return DEFAULT_ORG;
}

export interface SensorRoutesOptions {
  connectionString?: string;
}

const VALID_SENSOR_TYPES = ['vape', 'thc', 'smoke', 'noise', 'humidity', 'temperature', 'co2', 'motion', 'tamper', 'gunshot'];
const VALID_ALERT_TYPES = ['warning', 'critical'];

async function ensureSensorTables(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sensor_events (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        sensor_id TEXT,
        sensor_name TEXT,
        sensor_type TEXT NOT NULL DEFAULT 'motion',
        location TEXT,
        zone TEXT,
        value REAL,
        unit TEXT,
        threshold REAL,
        alert_triggered INTEGER NOT NULL DEFAULT 0,
        alert_type TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        acknowledged_by TEXT,
        resolved_at TEXT,
        device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
      );
      CREATE INDEX IF NOT EXISTS idx_sensor_events_type ON sensor_events (sensor_type);
      CREATE INDEX IF NOT EXISTS idx_sensor_events_status ON sensor_events (status);
      CREATE INDEX IF NOT EXISTS idx_sensor_events_alert ON sensor_events (alert_triggered);
      CREATE INDEX IF NOT EXISTS idx_sensor_events_location ON sensor_events (location);
      CREATE INDEX IF NOT EXISTS idx_sensor_events_created ON sensor_events (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sensor_events_sensor ON sensor_events (sensor_id);
      CREATE INDEX IF NOT EXISTS idx_sensor_events_device ON sensor_events (device_id);
    `);
    await client.query(`ALTER TABLE sensor_events ADD COLUMN IF NOT EXISTS org_id TEXT`);
    await client.query(`UPDATE sensor_events SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sensor_events_org ON sensor_events (org_id)`);
    log.info('Sensor events table ensured');
  } finally {
    client.release();
  }
}

export async function sensorRoutes(fastify: FastifyInstance, opts: SensorRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — sensor routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await ensureSensorTables(pool);

  // POST /sensors/event — Ingest sensor event (JWT or device-key; tenant-scoped)
  fastify.post('/sensors/event', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    if (!body?.sensor_type) {
      return reply.code(400).send({ error: 'sensor_type is required' });
    }

    // Prefer JWT org if present (admin-triggered test events); otherwise
    // fall back to device-key → org resolution. Body-supplied org_id is ignored.
    const user = (request as any).user;
    let orgId: string | null = null;
    if (user?.orgId) {
      orgId = user.orgId;
    } else {
      orgId = resolveSensorIngestOrg(request);
      if (!orgId) {
        return reply.code(401).send({ error: 'Invalid or missing sensor key' });
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const alertTriggered = body.alert_triggered ? 1 : (body.threshold && body.value > body.threshold ? 1 : 0);

    await pool.query(`
      INSERT INTO sensor_events (id, org_id, sensor_id, sensor_name, sensor_type, location, zone,
        value, unit, threshold, alert_triggered, alert_type, status, device_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    `, [
      id, orgId,
      body.sensor_id || null,
      body.sensor_name || null,
      body.sensor_type,
      body.location || null,
      body.zone || null,
      body.value ?? null,
      body.unit || null,
      body.threshold ?? null,
      alertTriggered,
      alertTriggered ? (body.alert_type || 'warning') : null,
      alertTriggered ? 'active' : 'resolved',
      body.device_id || null,
      now,
    ]);

    log.info({ eventId: id, type: body.sensor_type, alert: alertTriggered }, 'Sensor event ingested');

    return reply.send({
      success: true,
      event_id: id,
      alert_triggered: alertTriggered === 1,
    });
  });

  // GET /sensors/events — List events with filters (tenant-scoped)
  fastify.get('/sensors/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const query = request.query as {
      sensor_type?: string; location?: string; zone?: string;
      status?: string; alert_only?: string; device_id?: string;
      since?: string; until?: string;
      limit?: string; offset?: string;
    };

    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (query.sensor_type) { conditions.push(`sensor_type = $${idx++}`); params.push(query.sensor_type); }
    if (query.location) { conditions.push(`location ILIKE $${idx++}`); params.push(`%${query.location}%`); }
    if (query.zone) { conditions.push(`zone = $${idx++}`); params.push(query.zone); }
    if (query.status) { conditions.push(`status = $${idx++}`); params.push(query.status); }
    if (query.alert_only === 'true' || query.alert_only === '1') { conditions.push('alert_triggered = 1'); }
    if (query.device_id) { conditions.push(`device_id = $${idx++}`); params.push(query.device_id); }
    if (query.since) { conditions.push(`created_at >= $${idx++}`); params.push(query.since); }
    if (query.until) { conditions.push(`created_at <= $${idx++}`); params.push(query.until); }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM sensor_events ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    const dataResult = await pool.query(
      `SELECT * FROM sensor_events ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ events: dataResult.rows, total, limit, offset });
  });

  // GET /sensors/active-alerts — Active sensor alerts (tenant-scoped)
  fastify.get('/sensors/active-alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { rows } = await pool.query(
      "SELECT * FROM sensor_events WHERE COALESCE(org_id, $1) = $1 AND alert_triggered = 1 AND status = 'active' ORDER BY CASE alert_type WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC",
      [orgId]
    );
    return reply.send({ alerts: rows, total: rows.length });
  });

  // POST /sensors/events/:id/acknowledge (tenant-scoped)
  fastify.post('/sensors/events/:id/acknowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const { rows } = await pool.query(
      'SELECT * FROM sensor_events WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Sensor event not found' });
    }

    await pool.query(
      "UPDATE sensor_events SET status = 'acknowledged', acknowledged_by = $1 WHERE id = $2 AND COALESCE(org_id, $3) = $3",
      [body?.acknowledged_by || 'admin', id, orgId]
    );

    log.info({ eventId: id, orgId }, 'Sensor alert acknowledged');
    return reply.send({ success: true });
  });

  // POST /sensors/events/:id/resolve (tenant-scoped)
  fastify.post('/sensors/events/:id/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const now = new Date().toISOString();

    const { rows } = await pool.query(
      'SELECT * FROM sensor_events WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Sensor event not found' });
    }

    await pool.query(
      "UPDATE sensor_events SET status = 'resolved', resolved_at = $1 WHERE id = $2 AND COALESCE(org_id, $3) = $3",
      [now, id, orgId]
    );

    log.info({ eventId: id, orgId }, 'Sensor alert resolved');
    return reply.send({ success: true, resolved_at: now });
  });

  // GET /sensors/stats — Sensor dashboard stats (tenant-scoped)
  fastify.get('/sensors/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const today = new Date().toISOString().slice(0, 10);

    const [byType, activeAlerts, todayEvents, topLocations] = await Promise.all([
      pool.query('SELECT sensor_type, COUNT(*) as count FROM sensor_events WHERE COALESCE(org_id, $1) = $1 GROUP BY sensor_type ORDER BY count DESC', [orgId]),
      pool.query("SELECT COUNT(*) as count FROM sensor_events WHERE COALESCE(org_id, $1) = $1 AND alert_triggered = 1 AND status = 'active'", [orgId]),
      pool.query("SELECT COUNT(*) as count FROM sensor_events WHERE COALESCE(org_id, $1) = $1 AND created_at >= $2", [orgId, today]),
      pool.query("SELECT location, COUNT(*) as count FROM sensor_events WHERE COALESCE(org_id, $1) = $1 AND location IS NOT NULL GROUP BY location ORDER BY count DESC LIMIT 10", [orgId]),
    ]);

    const typeCounts = {};
    byType.rows.forEach(r => { typeCounts[r.sensor_type] = parseInt(r.count); });

    return reply.send({
      events_today: parseInt(todayEvents.rows[0].count),
      active_alerts: parseInt(activeAlerts.rows[0].count),
      by_type: typeCounts,
      top_locations: topLocations.rows.map(r => ({ location: r.location, count: parseInt(r.count) })),
    });
  });
}

// Public ingest route (no JWT required, device-key auth)
export async function sensorIngestRoute(fastify: FastifyInstance, opts: SensorRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) return;

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 3,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await ensureSensorTables(pool);

  fastify.post('/api/v1/public/sensors/event', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    if (!body?.sensor_type) {
      return reply.code(400).send({ error: 'sensor_type is required' });
    }

    // Resolve tenant server-side from the device key; never trust the body.
    const orgId = resolveSensorIngestOrg(request);
    if (!orgId) {
      return reply.code(401).send({ error: 'Invalid or missing sensor key' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const alertTriggered = body.alert_triggered ? 1 : (body.threshold && body.value > body.threshold ? 1 : 0);

    await pool.query(`
      INSERT INTO sensor_events (id, org_id, sensor_id, sensor_name, sensor_type, location, zone,
        value, unit, threshold, alert_triggered, alert_type, status, device_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    `, [
      id, orgId, body.sensor_id || null, body.sensor_name || null, body.sensor_type,
      body.location || null, body.zone || null, body.value ?? null, body.unit || null,
      body.threshold ?? null, alertTriggered, alertTriggered ? (body.alert_type || 'warning') : null,
      alertTriggered ? 'active' : 'resolved', body.device_id || null, now,
    ]);

    log.info({ eventId: id, orgId, type: body.sensor_type }, 'Sensor event ingested (public)');
    return reply.send({ success: true, event_id: id, alert_triggered: alertTriggered === 1 });
  });
}
