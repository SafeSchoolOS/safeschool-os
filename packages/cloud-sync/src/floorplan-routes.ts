// @ts-nocheck — WIP: will fix types when wiring into runtime
/**
 * Interactive Floor Plan Routes
 *
 * Floor plan management with device placement and zone definitions.
 *
 * Provides:
 *   - GET    /floorplans                — List all floor plans
 *   - POST   /floorplans               — Create a floor plan
 *   - GET    /floorplans/:id           — Get a floor plan
 *   - PUT    /floorplans/:id           — Update a floor plan
 *   - DELETE /floorplans/:id           — Delete a floor plan
 *   - PUT    /floorplans/:id/devices   — Update device positions
 *   - PUT    /floorplans/:id/zones     — Update zone definitions
 *   - GET    /floorplans/:id/status    — Get floor plan with live device status
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:floorplans');

export interface FloorplanRoutesOptions {
  /** PostgreSQL connection string (defaults to DATABASE_URL) */
  connectionString?: string;
}

async function ensureFloorplanTables(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS floor_plans (
      id TEXT PRIMARY KEY,
      building_name TEXT NOT NULL,
      floor_name TEXT NOT NULL,
      floor_number INTEGER NOT NULL DEFAULT 1,
      image_url TEXT,
      svg_data TEXT,
      devices JSONB NOT NULL DEFAULT '[]',
      zones JSONB NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );
    CREATE INDEX IF NOT EXISTS idx_floor_plans_building ON floor_plans (building_name);
    CREATE INDEX IF NOT EXISTS idx_floor_plans_floor ON floor_plans (floor_number);
  `);
}

export async function floorplanRoutes(fastify: FastifyInstance, opts: FloorplanRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — floorplan routes disabled');
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
    await ensureFloorplanTables(pool);
    tableMigrated = true;
  }

  // ─── GET /floorplans ────────────────────────────────────────
  fastify.get('/floorplans', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const query = request.query as { building?: string };

    let sql = 'SELECT id, building_name, floor_name, floor_number, created_at, updated_at FROM floor_plans';
    const params: any[] = [];

    if (query.building) {
      sql += ' WHERE building_name = $1';
      params.push(query.building);
    }
    sql += ' ORDER BY building_name ASC, floor_number ASC';

    const { rows } = await pool.query(sql, params);
    return reply.send({ floorplans: rows, total: rows.length });
  });

  // ─── POST /floorplans ───────────────────────────────────────
  fastify.post('/floorplans', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const body = request.body as any;
    if (!body || !body.building_name || !body.floor_name) {
      return reply.code(400).send({ error: 'building_name and floor_name are required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const devices = body.devices || [];
    const zones = body.zones || [];

    await pool.query(`
      INSERT INTO floor_plans (id, building_name, floor_name, floor_number, image_url, svg_data, devices, zones, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
    `, [id, body.building_name, body.floor_name, body.floor_number || 1,
        body.image_url || null, body.svg_data || null,
        JSON.stringify(devices), JSON.stringify(zones), now]);

    log.info({ floorplanId: id, building: body.building_name, floor: body.floor_name }, 'Floor plan created');

    const { rows } = await pool.query('SELECT * FROM floor_plans WHERE id = $1', [id]);
    return reply.code(201).send({ success: true, floorplan: rows[0] });
  });

  // ─── GET /floorplans/:id ────────────────────────────────────
  fastify.get('/floorplans/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };

    const { rows } = await pool.query('SELECT * FROM floor_plans WHERE id = $1', [id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Floor plan not found' });

    return reply.send({ floorplan: rows[0] });
  });

  // ─── PUT /floorplans/:id ────────────────────────────────────
  fastify.put('/floorplans/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const body = request.body as any;
    if (!body) return reply.code(400).send({ error: 'Request body is required' });

    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = $1'];
    const params: any[] = [now];
    let paramIdx = 2;

    if (body.building_name !== undefined) { updates.push(`building_name = $${paramIdx++}`); params.push(body.building_name); }
    if (body.floor_name !== undefined) { updates.push(`floor_name = $${paramIdx++}`); params.push(body.floor_name); }
    if (body.floor_number !== undefined) { updates.push(`floor_number = $${paramIdx++}`); params.push(body.floor_number); }
    if (body.image_url !== undefined) { updates.push(`image_url = $${paramIdx++}`); params.push(body.image_url); }
    if (body.svg_data !== undefined) { updates.push(`svg_data = $${paramIdx++}`); params.push(body.svg_data); }
    if (body.devices !== undefined) { updates.push(`devices = $${paramIdx++}`); params.push(JSON.stringify(body.devices)); }
    if (body.zones !== undefined) { updates.push(`zones = $${paramIdx++}`); params.push(JSON.stringify(body.zones)); }

    const result = await pool.query(
      `UPDATE floor_plans SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      [...params, id]
    );

    if (result.rowCount === 0) return reply.code(404).send({ error: 'Floor plan not found' });
    return reply.send({ success: true, floorplan: result.rows[0] });
  });

  // ─── DELETE /floorplans/:id ─────────────────────────────────
  fastify.delete('/floorplans/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const result = await pool.query('DELETE FROM floor_plans WHERE id = $1', [id]);
    if ((result.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Floor plan not found' });
    return reply.send({ success: true });
  });

  // ─── PUT /floorplans/:id/devices ────────────────────────────
  fastify.put('/floorplans/:id/devices', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const body = request.body as any;
    if (!body || !Array.isArray(body.devices)) {
      return reply.code(400).send({ error: 'devices array is required' });
    }

    // Validate each device has at minimum: id, type, x, y
    for (const dev of body.devices) {
      if (!dev.id || !dev.type || dev.x === undefined || dev.y === undefined) {
        return reply.code(400).send({ error: 'Each device must have id, type, x, and y fields' });
      }
    }

    const now = new Date().toISOString();
    const result = await pool.query(
      'UPDATE floor_plans SET devices = $1, updated_at = $2 WHERE id = $3 RETURNING *',
      [JSON.stringify(body.devices), now, id]
    );

    if (result.rowCount === 0) return reply.code(404).send({ error: 'Floor plan not found' });
    log.info({ floorplanId: id, deviceCount: body.devices.length }, 'Floor plan devices updated');
    return reply.send({ success: true, floorplan: result.rows[0] });
  });

  // ─── PUT /floorplans/:id/zones ──────────────────────────────
  fastify.put('/floorplans/:id/zones', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };
    const body = request.body as any;
    if (!body || !Array.isArray(body.zones)) {
      return reply.code(400).send({ error: 'zones array is required' });
    }

    // Validate each zone has at minimum: name and points (polygon coordinates)
    for (const zone of body.zones) {
      if (!zone.name || !Array.isArray(zone.points)) {
        return reply.code(400).send({ error: 'Each zone must have name and points (polygon coordinates) fields' });
      }
    }

    const now = new Date().toISOString();
    const result = await pool.query(
      'UPDATE floor_plans SET zones = $1, updated_at = $2 WHERE id = $3 RETURNING *',
      [JSON.stringify(body.zones), now, id]
    );

    if (result.rowCount === 0) return reply.code(404).send({ error: 'Floor plan not found' });
    log.info({ floorplanId: id, zoneCount: body.zones.length }, 'Floor plan zones updated');
    return reply.send({ success: true, floorplan: result.rows[0] });
  });

  // ─── GET /floorplans/:id/status ─────────────────────────────
  fastify.get('/floorplans/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const { id } = request.params as { id: string };

    const { rows } = await pool.query('SELECT * FROM floor_plans WHERE id = $1', [id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Floor plan not found' });

    const floorplan = rows[0];
    const devices = floorplan.devices || [];

    // Enrich devices with live status from sync_entities (doors, cameras)
    const enrichedDevices = [];
    for (const dev of devices) {
      const enriched = { ...dev, status: 'unknown', lastEvent: null };

      // Try to find live status from sync_entities
      try {
        if (dev.type === 'door') {
          const { rows: doorRows } = await pool.query(
            "SELECT data FROM sync_entities WHERE entity_type = 'door' AND id = $1 LIMIT 1",
            [dev.id]
          );
          if (doorRows.length > 0) {
            const doorData = doorRows[0].data;
            enriched.status = doorData.status || 'unknown';
            enriched.lastEvent = doorData.lastEvent || null;
          }
        } else if (dev.type === 'camera') {
          const { rows: camRows } = await pool.query(
            "SELECT data FROM sync_entities WHERE entity_type = 'camera' AND id = $1 LIMIT 1",
            [dev.id]
          );
          if (camRows.length > 0) {
            const camData = camRows[0].data;
            enriched.status = camData.status || 'unknown';
          }
        } else {
          // sensors and other devices
          enriched.status = 'normal';
        }
      } catch (err) {
        // Status lookup failed — keep unknown
      }

      enrichedDevices.push(enriched);
    }

    // Check for active emergencies that affect zones (tenant-scoped)
    const orgId = getOrgId(request);
    let activeEmergency = false;
    let emergencyZones: string[] = [];
    try {
      const { rows: panicRows } = await pool.query(
        "SELECT * FROM panic_alerts WHERE org_id = $1 AND status NOT IN ('resolved', 'cancelled') LIMIT 10",
        [orgId]
      );
      if (panicRows.length > 0) {
        activeEmergency = true;
        emergencyZones = panicRows
          .map(p => p.location)
          .filter(Boolean);
      }
    } catch (err) {
      // Panic table might not exist — that's fine
    }

    return reply.send({
      floorplan: {
        ...floorplan,
        devices: enrichedDevices,
      },
      activeEmergency,
      emergencyZones,
    });
  });
}
