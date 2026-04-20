// @ts-nocheck
/**
 * Tenant Experience Platform Routes (SafeSchool) — tenant-scoped.
 *
 * Note: "tenants" here is a BUILDING TENANT directory (lessee) for commercial
 * property management — distinct from the multi-tenant cloud's own `org_id`.
 * Each SafeSchool customer's building-tenant list is scoped by cloud org_id.
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:tenants');

export interface TenantRoutesOptions {
  connectionString?: string;
}

export async function tenantRoutes(fastify: FastifyInstance, opts: TenantRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — tenant routes disabled');
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
    await ensureOrgColumn(pool, 'tenants', 'tenants');
    tableMigrated = true;
  }

  fastify.post('/tenants', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.tenant_name) return reply.code(400).send({ error: 'tenant_name is required' });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await pool.query(
      `INSERT INTO tenants (id, org_id, tenant_name, building, floor, suite, contact_name, contact_email, contact_phone, lease_start, lease_end, access_zones, visitor_quota, notes, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
      [id, orgId, body.tenant_name, body.building || null, body.floor || null, body.suite || null,
       body.contact_name || null, body.contact_email || null, body.contact_phone || null,
       body.lease_start || null, body.lease_end || null,
       JSON.stringify(body.access_zones || []), body.visitor_quota || null,
       body.notes || null, body.status || 'active', now]
    );

    const res = await pool.query('SELECT * FROM tenants WHERE id = $1 AND org_id = $2', [id, orgId]);
    log.info({ orgId, tenantName: body.tenant_name }, 'Tenant created');
    return reply.code(201).send(res.rows[0]);
  });

  fastify.get('/tenants', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const conditions: string[] = ['org_id = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
    if (q.building) { conditions.push(`building = $${idx++}`); params.push(q.building); }
    if (q.floor) { conditions.push(`floor = $${idx++}`); params.push(q.floor); }
    if (q.search) {
      conditions.push(`(tenant_name ILIKE $${idx} OR contact_name ILIKE $${idx} OR suite ILIKE $${idx})`);
      params.push(`%${q.search}%`);
      idx++;
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM tenants ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT * FROM tenants ${where} ORDER BY building ASC, floor ASC, tenant_name ASC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ tenants: dataRes.rows, total, limit, offset });
  });

  fastify.get('/tenants/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query('SELECT * FROM tenants WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Tenant not found' });
    return reply.send(res.rows[0]);
  });

  fastify.put('/tenants/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const now = new Date().toISOString();

    const existing = await pool.query('SELECT id FROM tenants WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) return reply.code(404).send({ error: 'Tenant not found' });

    const fields: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    const updatable = ['tenant_name', 'building', 'floor', 'suite', 'contact_name', 'contact_email', 'contact_phone', 'lease_start', 'lease_end', 'visitor_quota', 'notes', 'status'];
    for (const field of updatable) {
      if (body[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        values.push(body[field]);
      }
    }
    if (body.access_zones !== undefined) {
      fields.push(`access_zones = $${idx++}`);
      values.push(JSON.stringify(body.access_zones));
    }

    values.push(id, orgId);
    await pool.query(
      `UPDATE tenants SET ${fields.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`,
      values
    );

    const res = await pool.query('SELECT * FROM tenants WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(res.rows[0]);
  });

  fastify.delete('/tenants/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query('DELETE FROM tenants WHERE id = $1 AND org_id = $2', [id, orgId]);
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Tenant not found' });
    return reply.send({ success: true, deleted: id });
  });

  fastify.get('/tenants/:id/visitors', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const q = request.query as Record<string, string>;

    const tenant = await pool.query('SELECT * FROM tenants WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (tenant.rows.length === 0) return reply.code(404).send({ error: 'Tenant not found' });

    const tenantName = tenant.rows[0].tenant_name;
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const res = await pool.query(
      `SELECT data FROM sync_entities
       WHERE COALESCE(org_id, $1) = $1 AND entity_type = 'visitor'
       AND (data->>'hostCompany' ILIKE $2 OR data->>'company' ILIKE $2 OR data->>'host' ILIKE $2)
       ORDER BY updated_at DESC LIMIT $3 OFFSET $4`,
      [orgId, `%${tenantName}%`, limit, offset]
    );

    const visitors = res.rows.map(r => r.data);
    return reply.send({ visitors, tenant: tenant.rows[0] });
  });

  fastify.get('/tenants/:id/access-log', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const q = request.query as Record<string, string>;

    const tenant = await pool.query('SELECT * FROM tenants WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (tenant.rows.length === 0) return reply.code(404).send({ error: 'Tenant not found' });

    const accessZones = tenant.rows[0].access_zones || [];
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);

    if (accessZones.length === 0) {
      return reply.send({ events: [], tenant: tenant.rows[0], message: 'No access zones configured for this tenant' });
    }

    const zonePlaceholders = accessZones.map((_: any, i: number) => `$${i + 2}`).join(', ');
    const res = await pool.query(
      `SELECT data FROM sync_entities
       WHERE COALESCE(org_id, $1) = $1 AND entity_type = 'event'
       AND (data->>'zoneName' IN (${zonePlaceholders}) OR data->>'location' IN (${zonePlaceholders}))
       ORDER BY updated_at DESC LIMIT $${accessZones.length + 2}`,
      [orgId, ...accessZones, limit]
    );

    const events = res.rows.map(r => r.data);
    return reply.send({ events, tenant: tenant.rows[0] });
  });

  fastify.get('/tenants/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const [totalRes, activeRes, buildingRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) as count FROM tenants WHERE org_id = $1`, [orgId]),
      pool.query(`SELECT COUNT(*) as count FROM tenants WHERE org_id = $1 AND status = 'active'`, [orgId]),
      pool.query(`SELECT building, floor, COUNT(*) as count FROM tenants WHERE org_id = $1 AND status = 'active' GROUP BY building, floor ORDER BY building, floor`, [orgId]),
    ]);

    const totalTenants = parseInt(totalRes.rows[0]?.count || '0');
    const activeTenants = parseInt(activeRes.rows[0]?.count || '0');

    const byBuilding: Record<string, { floors: Record<string, number>; total: number }> = {};
    for (const row of buildingRes.rows) {
      const bldg = row.building || 'Unassigned';
      const flr = row.floor || 'N/A';
      if (!byBuilding[bldg]) byBuilding[bldg] = { floors: {}, total: 0 };
      byBuilding[bldg].floors[flr] = parseInt(row.count);
      byBuilding[bldg].total += parseInt(row.count);
    }

    return reply.send({
      totalTenants,
      activeTenants,
      inactiveTenants: totalTenants - activeTenants,
      byBuilding,
    });
  });

  log.info('Tenant routes registered');
}
