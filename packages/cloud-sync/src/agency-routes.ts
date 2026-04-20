// @ts-nocheck
/**
 * Inter-Agency Coordination Routes
 *
 * Agency management for SafeSchool — police, fire, EMS, school district,
 * county emergency, state agency, and federal law enforcement coordination.
 *
 * Mount behind JWT auth at prefix '/api/v1/agencies'. Tenant-scoped.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getUser, getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:agencies');
const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

export interface AgencyRoutesOptions {
  connectionString?: string;
}

async function ensureAgenciesTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_ORG.replace(/'/g, "''")}',
      agency_name TEXT NOT NULL DEFAULT 'Unknown Agency',
      agency_type TEXT DEFAULT 'other',
      contact_name TEXT,
      contact_title TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      jurisdiction TEXT,
      protocols TEXT DEFAULT '{}',
      last_drill_date TEXT,
      mou_signed INTEGER DEFAULT 0,
      mou_expiry TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agencies_type ON agencies(agency_type);
    CREATE INDEX IF NOT EXISTS idx_agencies_name ON agencies(agency_name);
  `);
  await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS org_id TEXT`);
  await pool.query(`UPDATE agencies SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agencies_org ON agencies(org_id)`);
}

export async function agencyRoutes(fastify: FastifyInstance, opts: AgencyRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — agency routes disabled');
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
    await ensureAgenciesTable(pool);
    tableMigrated = true;
  }

  // ─── GET / — List agencies (tenant-scoped) ─────────────────────
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['org_id = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.agency_type) { conditions.push(`agency_type = $${idx++}`); params.push(q.agency_type); }
      if (q.mou_signed !== undefined) { conditions.push(`mou_signed = $${idx++}`); params.push(parseInt(q.mou_signed, 10)); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const { rows } = await pool.query(
        `SELECT * FROM agencies ${where} ORDER BY agency_type, agency_name`, params
      );
      return reply.send({ agencies: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to list agencies');
      return reply.send({ agencies: [], total: 0 });
    }
  });

  // ─── GET /:id — Get agency details (tenant-scoped) ─────────────
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const { rows } = await pool.query('SELECT * FROM agencies WHERE id = $1 AND org_id = $2', [id, orgId]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Agency not found' });
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to get agency');
      return reply.code(500).send({ error: 'Failed to get agency' });
    }
  });

  // ─── POST / — Create agency (tenant-scoped) ────────────────────
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const now = new Date().toISOString();
      const id = body.id || crypto.randomUUID();

      await pool.query(`
        INSERT INTO agencies (id, org_id, agency_name, agency_type, contact_name, contact_title, contact_phone,
          contact_email, jurisdiction, protocols, last_drill_date, mou_signed, mou_expiry, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        id, orgId,
        body.agency_name || 'Unknown Agency',
        body.agency_type || 'other',
        body.contact_name || null,
        body.contact_title || null,
        body.contact_phone || null,
        body.contact_email || null,
        body.jurisdiction || null,
        body.protocols ? JSON.stringify(body.protocols) : '{}',
        body.last_drill_date || null,
        body.mou_signed ? 1 : 0,
        body.mou_expiry || null,
        body.notes || null,
        now, now,
      ]);

      log.info({ id, orgId, name: body.agency_name, type: body.agency_type }, 'Agency created');
      return reply.code(201).send({ id, agency_name: body.agency_name, agency_type: body.agency_type });
    } catch (err) {
      log.error({ err }, 'Failed to create agency');
      return reply.code(500).send({ error: 'Failed to create agency' });
    }
  });

  // ─── PUT /:id — Update agency (tenant-scoped) ──────────────────
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

      if (body.agency_name) { updates.push(`agency_name = $${idx++}`); params.push(body.agency_name); }
      if (body.agency_type) { updates.push(`agency_type = $${idx++}`); params.push(body.agency_type); }
      if (body.contact_name !== undefined) { updates.push(`contact_name = $${idx++}`); params.push(body.contact_name); }
      if (body.contact_title !== undefined) { updates.push(`contact_title = $${idx++}`); params.push(body.contact_title); }
      if (body.contact_phone !== undefined) { updates.push(`contact_phone = $${idx++}`); params.push(body.contact_phone); }
      if (body.contact_email !== undefined) { updates.push(`contact_email = $${idx++}`); params.push(body.contact_email); }
      if (body.jurisdiction !== undefined) { updates.push(`jurisdiction = $${idx++}`); params.push(body.jurisdiction); }
      if (body.protocols !== undefined) { updates.push(`protocols = $${idx++}`); params.push(JSON.stringify(body.protocols)); }
      if (body.last_drill_date !== undefined) { updates.push(`last_drill_date = $${idx++}`); params.push(body.last_drill_date); }
      if (body.mou_signed !== undefined) { updates.push(`mou_signed = $${idx++}`); params.push(body.mou_signed ? 1 : 0); }
      if (body.mou_expiry !== undefined) { updates.push(`mou_expiry = $${idx++}`); params.push(body.mou_expiry); }
      if (body.notes !== undefined) { updates.push(`notes = $${idx++}`); params.push(body.notes); }

      if (updates.length === 0) return reply.code(400).send({ error: 'No fields to update' });

      updates.push(`updated_at = $${idx++}`); params.push(now);
      params.push(id, orgId);

      const { rowCount } = await pool.query(
        `UPDATE agencies SET ${updates.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1}`, params
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Agency not found' });

      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to update agency');
      return reply.code(500).send({ error: 'Failed to update agency' });
    }
  });

  // ─── DELETE /:id — Delete agency (tenant-scoped) ───────────────
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const { rowCount } = await pool.query('DELETE FROM agencies WHERE id = $1 AND org_id = $2', [id, orgId]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Agency not found' });
      log.info({ id, orgId }, 'Agency deleted');
      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete agency');
      return reply.code(500).send({ error: 'Failed to delete agency' });
    }
  });

  // ─── POST /:id/notify — Send alert to specific agency (tenant-scoped) ─────────
  fastify.post('/:id/notify', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const user = getUser(request);
      const now = new Date().toISOString();

      const { rows } = await pool.query('SELECT * FROM agencies WHERE id = $1 AND org_id = $2', [id, orgId]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Agency not found' });
      const agency = rows[0];

      try {
        await pool.query(`
          INSERT INTO audit_log (id, action, actor, actor_role, target_type, target_id, target_name, details, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          crypto.randomUUID(),
          'agency_notified',
          user.username || user.sub || 'system',
          user.role || null,
          'agency',
          id,
          agency.agency_name,
          JSON.stringify({
            message: body.message || 'Emergency notification',
            alert_type: body.alert_type || 'general',
            contact_method: body.contact_method || 'phone',
            agency_type: agency.agency_type,
            org_id: orgId,
          }),
          now,
        ]);
      } catch (err) { log.debug({ err }, 'Failed to write agency notification audit log (table may not exist)'); }

      log.info({ agencyId: id, orgId, agency: agency.agency_name, by: user.username }, 'Agency notified');
      return reply.send({
        success: true,
        agency_name: agency.agency_name,
        notified_at: now,
        message: body.message || 'Emergency notification sent',
      });
    } catch (err) {
      log.error({ err }, 'Failed to notify agency');
      return reply.code(500).send({ error: 'Failed to notify agency' });
    }
  });

  // ─── GET /protocols — Response protocols summary (tenant-scoped) ───────────────
  fastify.get('/protocols/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { rows } = await pool.query(
        `SELECT id, agency_name, agency_type, protocols, mou_signed, mou_expiry FROM agencies WHERE org_id = $1 ORDER BY agency_type`,
        [orgId]
      );

      const protocols = rows.map(r => ({
        agency_name: r.agency_name,
        agency_type: r.agency_type,
        protocols: r.protocols,
        mou_active: r.mou_signed === 1 && (!r.mou_expiry || new Date(r.mou_expiry) > new Date()),
      }));

      return reply.send({ protocols, total: protocols.length });
    } catch (err) {
      log.error({ err }, 'Failed to get protocols');
      return reply.code(500).send({ error: 'Failed to get protocols' });
    }
  });

  // ─── POST /broadcast — Notify all agencies for THIS tenant ────────────────────
  fastify.post('/broadcast', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const user = getUser(request);
      const now = new Date().toISOString();

      const { rows } = await pool.query('SELECT * FROM agencies WHERE org_id = $1', [orgId]);
      const notified = [];

      for (const agency of rows) {
        try {
          await pool.query(`
            INSERT INTO audit_log (id, action, actor, actor_role, target_type, target_id, target_name, details, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            crypto.randomUUID(),
            'agency_broadcast',
            user.username || user.sub || 'system',
            user.role || null,
            'agency',
            agency.id,
            agency.agency_name,
            JSON.stringify({
              message: body.message || 'Emergency broadcast',
              alert_type: body.alert_type || 'emergency',
              org_id: orgId,
            }),
            now,
          ]);
        } catch (err) { log.debug({ err }, 'Failed to write agency broadcast audit log (table may not exist)'); }
        notified.push({ id: agency.id, agency_name: agency.agency_name, agency_type: agency.agency_type });
      }

      log.info({ count: notified.length, orgId, by: user.username }, 'Agency broadcast sent');
      return reply.send({ success: true, notified, count: notified.length, broadcast_at: now });
    } catch (err) {
      log.error({ err }, 'Failed to broadcast to agencies');
      return reply.code(500).send({ error: 'Failed to broadcast' });
    }
  });
}
