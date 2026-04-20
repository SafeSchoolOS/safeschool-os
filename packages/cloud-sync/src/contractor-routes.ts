// @ts-nocheck
/**
 * Contractor Management Routes (SafeSchool) — tenant-scoped.
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:contractors');

export interface ContractorRoutesOptions {
  connectionString?: string;
}

const VALID_TRADES = ['electrical', 'plumbing', 'hvac', 'it', 'cleaning', 'security', 'construction', 'other'];
const VALID_BG_STATUSES = ['pending', 'cleared', 'flagged', 'expired'];
const VALID_STATUSES = ['active', 'suspended', 'expired', 'banned'];

export async function contractorRoutes(fastify: FastifyInstance, opts: ContractorRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — contractor routes disabled');
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
    await ensureOrgColumn(pool, 'contractors', 'contractors');
    tableMigrated = true;
  }

  fastify.post('/contractors', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.company_name || !body?.contact_name) {
      return reply.code(400).send({ error: 'company_name and contact_name are required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await pool.query(
        `INSERT INTO contractors (id, org_id, company_name, contact_name, email, phone, trade,
         insurance_expiry, license_number, license_expiry, background_check_date,
         background_check_status, certifications, access_zones, status, notes,
         created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [id, orgId, body.company_name, body.contact_name, body.email || null, body.phone || null,
         VALID_TRADES.includes(body.trade) ? body.trade : 'other',
         body.insurance_expiry || null, body.license_number || null, body.license_expiry || null,
         body.background_check_date || null,
         VALID_BG_STATUSES.includes(body.background_check_status) ? body.background_check_status : 'pending',
         JSON.stringify(body.certifications || []), JSON.stringify(body.access_zones || []),
         'active', body.notes || null, now, now]
      );
    } catch (err) {
      log.error({ err }, 'Failed to create contractor');
      return reply.code(500).send({ error: 'Failed to create contractor' });
    }

    const res = await pool.query('SELECT * FROM contractors WHERE id = $1 AND org_id = $2', [id, orgId]);
    log.info({ id, orgId, company: body.company_name }, 'Contractor created');
    return reply.code(201).send(res.rows[0]);
  });

  fastify.get('/contractors', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const conditions: string[] = ['org_id = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
    if (q.trade) { conditions.push(`trade = $${idx++}`); params.push(q.trade); }
    if (q.background_check_status) { conditions.push(`background_check_status = $${idx++}`); params.push(q.background_check_status); }
    if (q.search) {
      conditions.push(`(company_name ILIKE $${idx} OR contact_name ILIKE $${idx} OR email ILIKE $${idx})`);
      params.push(`%${q.search}%`);
      idx++;
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(q.offset || '0', 10), 0);

    const countRes = await pool.query(`SELECT COUNT(*) as total FROM contractors ${where}`, params);
    const total = parseInt(countRes.rows[0].total);

    const dataRes = await pool.query(
      `SELECT * FROM contractors ${where} ORDER BY company_name ASC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ contractors: dataRes.rows, total, limit, offset });
  });

  fastify.get('/contractors/expiring', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const daysAhead = Math.min(Math.max(parseInt(q.days || '30', 10), 1), 365);
    const futureDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const res = await pool.query(
      `SELECT *,
        CASE
          WHEN insurance_expiry IS NOT NULL AND insurance_expiry::date <= CURRENT_DATE THEN 'insurance_expired'
          WHEN insurance_expiry IS NOT NULL AND insurance_expiry::date <= $1::date THEN 'insurance_expiring'
          WHEN license_expiry IS NOT NULL AND license_expiry::date <= CURRENT_DATE THEN 'license_expired'
          WHEN license_expiry IS NOT NULL AND license_expiry::date <= $1::date THEN 'license_expiring'
          WHEN background_check_status = 'expired' THEN 'background_expired'
          ELSE 'expiring'
        END as expiry_type
       FROM contractors
       WHERE org_id = $2 AND status = 'active' AND (
         (insurance_expiry IS NOT NULL AND insurance_expiry::date <= $1::date) OR
         (license_expiry IS NOT NULL AND license_expiry::date <= $1::date) OR
         background_check_status = 'expired'
       )
       ORDER BY LEAST(
         COALESCE(insurance_expiry::date, '2099-12-31'::date),
         COALESCE(license_expiry::date, '2099-12-31'::date)
       ) ASC`,
      [futureDate, orgId]
    );

    return reply.send({ contractors: res.rows, total: res.rows.length, days_ahead: daysAhead });
  });

  fastify.get('/contractors/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query('SELECT * FROM contractors WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (res.rows.length === 0) {
      return reply.code(404).send({ error: 'Contractor not found' });
    }
    return reply.send(res.rows[0]);
  });

  fastify.put('/contractors/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const now = new Date().toISOString();

    const existing = await pool.query('SELECT id FROM contractors WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Contractor not found' });
    }

    const fields: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    const updatable = ['company_name', 'contact_name', 'email', 'phone', 'trade',
      'insurance_expiry', 'license_number', 'license_expiry', 'background_check_date',
      'background_check_status', 'notes', 'status'];
    for (const field of updatable) {
      if (body[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        values.push(body[field]);
      }
    }
    if (body.certifications !== undefined) {
      fields.push(`certifications = $${idx++}`);
      values.push(JSON.stringify(body.certifications));
    }
    if (body.access_zones !== undefined) {
      fields.push(`access_zones = $${idx++}`);
      values.push(JSON.stringify(body.access_zones));
    }

    values.push(id, orgId);
    await pool.query(
      `UPDATE contractors SET ${fields.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`,
      values
    );

    const updated = await pool.query('SELECT * FROM contractors WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  fastify.delete('/contractors/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query('DELETE FROM contractors WHERE id = $1 AND org_id = $2', [id, orgId]);
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Contractor not found' });
    }
    return reply.send({ success: true, deleted: id });
  });

  fastify.post('/contractors/:id/suspend', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const now = new Date().toISOString();

    const existing = await pool.query('SELECT * FROM contractors WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Contractor not found' });
    }

    await pool.query(
      `UPDATE contractors SET status = 'suspended', notes = COALESCE(notes || E'\n', '') || $1, updated_at = $2 WHERE id = $3 AND org_id = $4`,
      [`[SUSPENDED ${now}] ${body?.reason || 'No reason provided'}`, now, id, orgId]
    );

    const updated = await pool.query('SELECT * FROM contractors WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  fastify.post('/contractors/:id/activate', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const now = new Date().toISOString();

    const existing = await pool.query('SELECT * FROM contractors WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Contractor not found' });
    }

    await pool.query(
      `UPDATE contractors SET status = 'active', updated_at = $1 WHERE id = $2 AND org_id = $3`,
      [now, id, orgId]
    );

    const updated = await pool.query('SELECT * FROM contractors WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.send(updated.rows[0]);
  });

  log.info('Contractor management routes registered');
}
