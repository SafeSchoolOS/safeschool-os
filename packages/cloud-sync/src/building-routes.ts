// @ts-nocheck
/**
 * Building Systems Management Routes — tenant-scoped.
 * HVAC/fire/intrusion/elevator integrations and their credentials are
 * per-customer and must not cross tenants.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:building');

export interface BuildingRoutesOptions {
  connectionString?: string;
}

export async function buildingRoutes(fastify: FastifyInstance, opts: BuildingRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — building routes disabled');
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
    await ensureOrgColumn(pool, 'building_systems', 'building_systems');
    tableMigrated = true;
  }

  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.system_type) { conditions.push(`system_type = $${idx++}`); params.push(q.system_type); }
      if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
      if (q.zone) { conditions.push(`zone = $${idx++}`); params.push(q.zone); }
      if (q.location) { conditions.push(`location = $${idx++}`); params.push(q.location); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const { rows } = await pool.query(
        `SELECT * FROM building_systems ${where} ORDER BY system_type, system_name`, params
      );
      return reply.send({ systems: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to list building systems');
      return reply.code(500).send({ error: 'Failed to list building systems' });
    }
  });

  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const now = new Date().toISOString();
      const id = body.id || crypto.randomUUID();

      await pool.query(`
        INSERT INTO building_systems (id, org_id, system_type, system_name, location, zone, status, last_value, last_updated, integration_type, config, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        id, orgId,
        body.system_type || 'other',
        body.system_name || 'Unnamed System',
        body.location || null,
        body.zone || null,
        body.status || 'online',
        body.last_value ? JSON.stringify(body.last_value) : '{}',
        now,
        body.integration_type || 'manual',
        body.config ? JSON.stringify(body.config) : '{}',
        now,
      ]);

      log.info({ id, orgId, type: body.system_type, name: body.system_name }, 'Building system registered');
      return reply.code(201).send({ id, system_type: body.system_type, system_name: body.system_name, status: body.status || 'online' });
    } catch (err) {
      log.error({ err }, 'Failed to register building system');
      return reply.code(500).send({ error: 'Failed to register building system' });
    }
  });

  fastify.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const now = new Date().toISOString();

      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (body.system_type) { updates.push(`system_type = $${idx++}`); params.push(body.system_type); }
      if (body.system_name) { updates.push(`system_name = $${idx++}`); params.push(body.system_name); }
      if (body.location !== undefined) { updates.push(`location = $${idx++}`); params.push(body.location); }
      if (body.zone !== undefined) { updates.push(`zone = $${idx++}`); params.push(body.zone); }
      if (body.status) { updates.push(`status = $${idx++}`); params.push(body.status); }
      if (body.last_value) { updates.push(`last_value = $${idx++}`); params.push(JSON.stringify(body.last_value)); }
      if (body.integration_type) { updates.push(`integration_type = $${idx++}`); params.push(body.integration_type); }
      if (body.config) { updates.push(`config = $${idx++}`); params.push(JSON.stringify(body.config)); }

      if (updates.length === 0) return reply.code(400).send({ error: 'No fields to update' });

      updates.push(`last_updated = $${idx++}`); params.push(now);
      params.push(id, orgId);

      const { rowCount } = await pool.query(
        `UPDATE building_systems SET ${updates.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
        params
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'System not found' });

      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to update building system');
      return reply.code(500).send({ error: 'Failed to update building system' });
    }
  });

  fastify.post('/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const now = new Date().toISOString();

      const updates: string[] = ['last_updated = $1'];
      const params: any[] = [now];
      let idx = 2;

      if (body.status) { updates.push(`status = $${idx++}`); params.push(body.status); }
      if (body.last_value) { updates.push(`last_value = $${idx++}`); params.push(JSON.stringify(body.last_value)); }

      params.push(id, orgId);
      const { rowCount } = await pool.query(
        `UPDATE building_systems SET ${updates.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
        params
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'System not found' });

      log.info({ id, orgId, status: body.status }, 'Building system status updated');
      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to update system status');
      return reply.code(500).send({ error: 'Failed to update system status' });
    }
  });

  fastify.get('/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const typeRes = await pool.query(`
        SELECT system_type, status, COUNT(*) as count
        FROM building_systems WHERE COALESCE(org_id, $1) = $1
        GROUP BY system_type, status
      `, [orgId]);

      const byType = {};
      const statusCounts = { online: 0, offline: 0, alarm: 0, maintenance: 0 };
      let total = 0;

      for (const row of typeRes.rows) {
        const c = parseInt(row.count, 10);
        if (!byType[row.system_type]) byType[row.system_type] = { online: 0, offline: 0, alarm: 0, maintenance: 0, total: 0 };
        byType[row.system_type][row.status] = c;
        byType[row.system_type].total += c;
        statusCounts[row.status] = (statusCounts[row.status] || 0) + c;
        total += c;
      }

      const recentRes = await pool.query(`
        SELECT * FROM building_systems
        WHERE COALESCE(org_id, $1) = $1 AND last_value != '{}'
        ORDER BY last_updated DESC LIMIT 20
      `, [orgId]);

      return reply.send({
        total,
        status_counts: statusCounts,
        by_type: byType,
        recent_readings: recentRes.rows,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get building dashboard');
      return reply.code(500).send({ error: 'Failed to get building dashboard' });
    }
  });

  fastify.get('/alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { rows } = await pool.query(`
        SELECT * FROM building_systems
        WHERE COALESCE(org_id, $1) = $1 AND status IN ('alarm', 'offline')
        ORDER BY
          CASE status WHEN 'alarm' THEN 0 ELSE 1 END,
          last_updated DESC
      `, [orgId]);
      return reply.send({ alerts: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to get building alerts');
      return reply.code(500).send({ error: 'Failed to get building alerts' });
    }
  });
}
