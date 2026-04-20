// @ts-nocheck
/**
 * Ticket Auto-Creation Routes
 *
 * Creates work orders / tickets from security events.
 * Supports push to ServiceNow, Jira, webhook, or internal ticketing.
 *
 * Tenant isolation: tickets, ticket_comments, and ticket_config all carry
 * `org_id`. Each tenant has their own ticket_config row (instead of a single
 * hardcoded 'default' row that previously shared ServiceNow/Jira API keys
 * across tenants).
 *
 * Routes:
 *   POST /tickets/config       — Configure ticket integration (per-tenant)
 *   GET  /tickets/config       — Get current ticket configuration (per-tenant)
 *   POST /tickets              — Create a ticket manually
 *   GET  /tickets              — List tickets (scoped)
 *   GET  /tickets/stats        — Ticket statistics (scoped)
 *   GET  /tickets/:id          — Get ticket detail (scoped)
 *   PUT  /tickets/:id          — Update ticket (scoped)
 *   POST /tickets/:id/comment  — Add comment to ticket (scoped)
 *   POST /tickets/auto-create  — Internal: auto-create ticket from event (scoped)
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:tickets');

export interface TicketRoutesOptions {
  connectionString?: string;
}

function maskApiKey(key: string | null | undefined): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

async function ensureTables(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_config (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'internal',
      endpoint_url TEXT,
      api_key TEXT,
      project_key TEXT,
      auto_create_rules JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      ticket_number TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      source_type TEXT,
      source_id TEXT,
      assigned_to TEXT,
      tags JSONB DEFAULT '[]'::jsonb,
      resolution_notes TEXT,
      external_id TEXT,
      external_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES tickets(id),
      comment TEXT NOT NULL,
      author TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Tenant isolation backfill.
  await ensureOrgColumn(pool, 'ticket_config', 'ticket_config');
  await ensureOrgColumn(pool, 'tickets', 'tickets');
  await ensureOrgColumn(pool, 'ticket_comments', 'ticket_comments');
}

async function generateTicketNumber(pool: pg.Pool, orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const { rows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM tickets WHERE org_id = $1 AND ticket_number LIKE $2`,
    [orgId, `TKT-${year}-%`]
  );
  const seq = parseInt(rows[0]?.cnt || '0', 10) + 1;
  // Incorporate the org suffix hash so concurrent per-tenant numbers don't collide
  // on the global UNIQUE(ticket_number) index.
  const suffix = crypto.createHash('sha1').update(orgId).digest('hex').slice(0, 4);
  return `TKT-${year}-${suffix}-${String(seq).padStart(4, '0')}`;
}

async function pushToExternal(config: any, ticket: any): Promise<{ external_id?: string; external_url?: string }> {
  if (!config || config.provider === 'internal' || !config.endpoint_url) {
    return {};
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const payload: any = {
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      source: 'edgeruntime',
      ticket_number: ticket.ticket_number,
    };

    if (config.provider === 'servicenow') {
      headers['Authorization'] = `Basic ${config.api_key}`;
      payload.short_description = ticket.title;
      payload.urgency = ticket.priority === 'critical' ? '1' : ticket.priority === 'high' ? '2' : '3';
    } else if (config.provider === 'jira') {
      headers['Authorization'] = `Basic ${config.api_key}`;
      payload.summary = ticket.title;
      if (config.project_key) {
        payload.project = { key: config.project_key };
      }
    } else if (config.provider === 'webhook') {
      if (config.api_key) {
        headers['X-API-Key'] = config.api_key;
      }
    }

    const resp = await fetch(config.endpoint_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (resp.ok) {
      const data = await resp.json().catch((err) => { log.warn({ err }, 'Failed to parse external ticket response JSON'); return {}; });
      return {
        external_id: data.id || data.key || data.number || data.sys_id || undefined,
        external_url: data.url || data.self || data.html_url || data.link || undefined,
      };
    } else {
      log.warn({ status: resp.status }, 'External ticket push failed');
    }
  } catch (err) {
    log.error({ err }, 'Error pushing ticket to external system');
  }

  return {};
}

export async function ticketRoutes(fastify: FastifyInstance, opts: TicketRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — ticket routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  try {
    await ensureTables(pool);
  } catch (err) {
    log.warn({ err }, 'Could not ensure ticket tables — they may be created later');
  }

  /** Load the ticket_config row for a tenant. Returns null if none. */
  async function loadConfig(orgId: string): Promise<any | null> {
    const { rows } = await pool.query(
      `SELECT * FROM ticket_config WHERE COALESCE(org_id, $1) = $1 ORDER BY updated_at DESC LIMIT 1`,
      [orgId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // ─── POST /tickets/config — Configure ticket integration (per-tenant) ─
  fastify.post('/tickets/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const body = request.body as any;
      const {
        provider = 'internal',
        endpoint_url = null,
        api_key = null,
        project_key = null,
        auto_create_rules = [],
      } = body || {};

      const now = new Date().toISOString();

      // One config row per tenant. We key by org_id (string) — if a row already
      // exists for this tenant, update it; otherwise insert a new one.
      const existing = await pool.query(
        `SELECT id FROM ticket_config WHERE COALESCE(org_id, $1) = $1 LIMIT 1`,
        [orgId]
      );
      if (existing.rows.length > 0) {
        const existingId = existing.rows[0].id;
        await pool.query(`
          UPDATE ticket_config SET
            provider = $1,
            endpoint_url = $2,
            api_key = $3,
            project_key = $4,
            auto_create_rules = $5,
            updated_at = $6
          WHERE id = $7 AND COALESCE(org_id, $8) = $8
        `, [provider, endpoint_url, api_key, project_key, JSON.stringify(auto_create_rules), now, existingId, orgId]);
        return reply.send({
          id: existingId,
          org_id: orgId,
          provider,
          endpoint_url,
          api_key: maskApiKey(api_key),
          project_key,
          auto_create_rules,
          updated_at: now,
        });
      }

      const id = crypto.randomUUID();
      await pool.query(`
        INSERT INTO ticket_config (id, org_id, provider, endpoint_url, api_key, project_key, auto_create_rules, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      `, [id, orgId, provider, endpoint_url, api_key, project_key, JSON.stringify(auto_create_rules), now]);

      return reply.send({
        id,
        org_id: orgId,
        provider,
        endpoint_url,
        api_key: maskApiKey(api_key),
        project_key,
        auto_create_rules,
        updated_at: now,
      });
    } catch (err) {
      log.error({ err }, 'Failed to save ticket config');
      return reply.code(500).send({ error: 'Failed to save ticket configuration' });
    }
  });

  // ─── GET /tickets/config — Get current ticket configuration (per-tenant) ──
  fastify.get('/tickets/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const config = await loadConfig(orgId);
      if (!config) {
        return reply.send({
          id: null,
          org_id: orgId,
          provider: 'internal',
          endpoint_url: null,
          api_key: '',
          project_key: null,
          auto_create_rules: [],
        });
      }
      config.api_key = maskApiKey(config.api_key);
      return reply.send(config);
    } catch (err) {
      log.error({ err }, 'Failed to get ticket config');
      return reply.code(500).send({ error: 'Failed to get ticket configuration' });
    }
  });

  // ─── POST /tickets — Create a ticket manually (tenant-scoped) ────────
  fastify.post('/tickets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const body = request.body as any;
      const {
        title,
        description = '',
        priority = 'medium',
        source_type = null,
        source_id = null,
        assigned_to = null,
        tags = [],
      } = body || {};

      if (!title) {
        return reply.code(400).send({ error: 'title is required' });
      }

      const id = crypto.randomUUID();
      const ticket_number = await generateTicketNumber(pool, orgId);
      const now = new Date().toISOString();

      // Load this tenant's external provider config (if any)
      let external_id: string | undefined;
      let external_url: string | undefined;
      try {
        const tenantConfig = await loadConfig(orgId);
        if (tenantConfig && tenantConfig.provider !== 'internal') {
          const ext = await pushToExternal(tenantConfig, { title, description, priority, ticket_number });
          external_id = ext.external_id;
          external_url = ext.external_url;
        }
      } catch (err) { log.debug({ err }, 'Failed to load ticket config for external push'); }

      await pool.query(`
        INSERT INTO tickets (id, org_id, ticket_number, title, description, priority, status, source_type, source_id, assigned_to, tags, external_id, external_url, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, $12, $13, $13)
      `, [id, orgId, ticket_number, title, description, priority, source_type, source_id, assigned_to, JSON.stringify(tags), external_id || null, external_url || null, now]);

      log.info({ id, orgId, ticket_number, priority }, 'Ticket created');

      return reply.code(201).send({
        id,
        org_id: orgId,
        ticket_number,
        title,
        description,
        priority,
        status: 'open',
        source_type,
        source_id,
        assigned_to,
        tags,
        external_id: external_id || null,
        external_url: external_url || null,
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      log.error({ err }, 'Failed to create ticket');
      return reply.code(500).send({ error: 'Failed to create ticket' });
    }
  });

  // ─── GET /tickets — List tickets (tenant-scoped) ────────────────────
  fastify.get('/tickets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 500);
      const conditions: string[] = ['org_id = $1'];
      const params: any[] = [orgId];
      let paramIdx = 2;

      if (q.status) {
        conditions.push(`status = $${paramIdx++}`);
        params.push(q.status);
      }
      if (q.priority) {
        conditions.push(`priority = $${paramIdx++}`);
        params.push(q.priority);
      }
      if (q.assigned_to) {
        conditions.push(`assigned_to = $${paramIdx++}`);
        params.push(q.assigned_to);
      }

      const where = `WHERE ${conditions.join(' AND ')}`;

      const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM tickets ${where}`, params);
      const total = parseInt(countResult.rows[0]?.cnt || '0', 10);

      params.push(limit);
      const { rows } = await pool.query(
        `SELECT * FROM tickets ${where} ORDER BY created_at DESC LIMIT $${paramIdx}`,
        params
      );

      return reply.send({ tickets: rows, total });
    } catch (err) {
      log.error({ err }, 'Failed to list tickets');
      return reply.send({ tickets: [], total: 0 });
    }
  });

  // ─── GET /tickets/stats — Ticket statistics (tenant-scoped) ─────────
  fastify.get('/tickets/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const totalResult = await pool.query(`SELECT COUNT(*) as cnt FROM tickets WHERE org_id = $1`, [orgId]);
      const total = parseInt(totalResult.rows[0]?.cnt || '0', 10);

      const statusResult = await pool.query(
        `SELECT status, COUNT(*) as cnt FROM tickets WHERE org_id = $1 GROUP BY status`,
        [orgId]
      );
      const by_status: Record<string, number> = {};
      for (const row of statusResult.rows) {
        by_status[row.status] = parseInt(row.cnt, 10);
      }

      const priorityResult = await pool.query(
        `SELECT priority, COUNT(*) as cnt FROM tickets WHERE org_id = $1 GROUP BY priority`,
        [orgId]
      );
      const by_priority: Record<string, number> = {};
      for (const row of priorityResult.rows) {
        by_priority[row.priority] = parseInt(row.cnt, 10);
      }

      const avgResult = await pool.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (resolved_at::timestamp - created_at::timestamp)) / 3600) as avg_hours
        FROM tickets WHERE org_id = $1 AND resolved_at IS NOT NULL
      `, [orgId]);
      const avg_resolution_hours = parseFloat(avgResult.rows[0]?.avg_hours || '0');

      const openResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM tickets WHERE org_id = $1 AND status = 'open'`,
        [orgId]
      );
      const open_count = parseInt(openResult.rows[0]?.cnt || '0', 10);

      return reply.send({
        total,
        by_status,
        by_priority,
        avg_resolution_hours: Math.round(avg_resolution_hours * 10) / 10,
        open_count,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get ticket stats');
      return reply.send({
        total: 0,
        by_status: {},
        by_priority: {},
        avg_resolution_hours: 0,
        open_count: 0,
      });
    }
  });

  // ─── GET /tickets/:id — Get ticket detail (tenant-scoped) ───────────
  fastify.get('/tickets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const { rows } = await pool.query(`SELECT * FROM tickets WHERE id = $1 AND org_id = $2`, [id, orgId]);

      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }

      // Fetch comments (ticket already verified owned by this tenant)
      let comments: any[] = [];
      try {
        const commentResult = await pool.query(
          `SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at ASC`,
          [id]
        );
        comments = commentResult.rows;
      } catch (err) { log.debug({ err }, 'Failed to load ticket comments'); }

      return reply.send({ ...rows[0], comments });
    } catch (err) {
      log.error({ err }, 'Failed to get ticket');
      return reply.code(500).send({ error: 'Failed to get ticket' });
    }
  });

  // ─── PUT /tickets/:id — Update ticket (tenant-scoped) ───────────────
  fastify.put('/tickets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;

      const { rows: existing } = await pool.query(`SELECT * FROM tickets WHERE id = $1 AND org_id = $2`, [id, orgId]);
      if (existing.length === 0) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }

      const updates: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (body.status !== undefined) {
        updates.push(`status = $${paramIdx++}`);
        params.push(body.status);
      }
      if (body.priority !== undefined) {
        updates.push(`priority = $${paramIdx++}`);
        params.push(body.priority);
      }
      if (body.assigned_to !== undefined) {
        updates.push(`assigned_to = $${paramIdx++}`);
        params.push(body.assigned_to);
      }
      if (body.resolution_notes !== undefined) {
        updates.push(`resolution_notes = $${paramIdx++}`);
        params.push(body.resolution_notes);
      }

      if (body.status === 'resolved' || body.status === 'closed') {
        updates.push(`resolved_at = $${paramIdx++}`);
        params.push(new Date().toISOString());
      }

      if (updates.length === 0) {
        return reply.code(400).send({ error: 'No valid fields to update' });
      }

      updates.push(`updated_at = $${paramIdx++}`);
      params.push(new Date().toISOString());

      params.push(id, orgId);
      const { rows } = await pool.query(
        `UPDATE tickets SET ${updates.join(', ')} WHERE id = $${paramIdx} AND org_id = $${paramIdx + 1} RETURNING *`,
        params
      );

      log.info({ id, orgId, status: body.status }, 'Ticket updated');
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to update ticket');
      return reply.code(500).send({ error: 'Failed to update ticket' });
    }
  });

  // ─── POST /tickets/:id/comment — Add comment to ticket (tenant-scoped) ──
  fastify.post('/tickets/:id/comment', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { id: ticketId } = request.params as { id: string };
      const body = request.body as any;
      const { comment, author = 'system' } = body || {};

      if (!comment) {
        return reply.code(400).send({ error: 'comment is required' });
      }

      const { rows: existing } = await pool.query(
        `SELECT id FROM tickets WHERE id = $1 AND org_id = $2`,
        [ticketId, orgId]
      );
      if (existing.length === 0) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }

      const commentId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pool.query(`
        INSERT INTO ticket_comments (id, org_id, ticket_id, comment, author, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [commentId, orgId, ticketId, comment, author, now]);

      await pool.query(
        `UPDATE tickets SET updated_at = $1 WHERE id = $2 AND org_id = $3`,
        [now, ticketId, orgId]
      );

      return reply.code(201).send({
        id: commentId,
        ticket_id: ticketId,
        comment,
        author,
        created_at: now,
      });
    } catch (err) {
      log.error({ err }, 'Failed to add comment');
      return reply.code(500).send({ error: 'Failed to add comment' });
    }
  });

  // ─── POST /tickets/auto-create — Auto-create ticket from event (tenant-scoped) ──
  fastify.post('/tickets/auto-create', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const body = request.body as any;
      const { event_type, event_id, event_data = {} } = body || {};

      if (!event_type) {
        return reply.code(400).send({ error: 'event_type is required' });
      }

      const tenantConfig = await loadConfig(orgId);

      const rules: any[] = Array.isArray(tenantConfig?.auto_create_rules)
        ? tenantConfig.auto_create_rules
        : (typeof tenantConfig?.auto_create_rules === 'string'
          ? JSON.parse(tenantConfig.auto_create_rules)
          : []);

      let matchedRule: any = null;
      for (const rule of rules) {
        if (rule.trigger === event_type) {
          matchedRule = rule;
          break;
        }
      }

      if (!matchedRule) {
        return reply.send({ created: false, reason: 'No matching auto-create rule' });
      }

      const id = crypto.randomUUID();
      const ticket_number = await generateTicketNumber(pool, orgId);
      const now = new Date().toISOString();
      const priority = matchedRule.priority || 'medium';
      const title = `[Auto] ${event_type}: ${event_data.summary || event_data.description || event_id || 'Security Event'}`;
      const description = [
        `Auto-created from ${event_type} event.`,
        event_id ? `Event ID: ${event_id}` : '',
        event_data.location ? `Location: ${event_data.location}` : '',
        event_data.description ? `Detail: ${event_data.description}` : '',
        event_data.device ? `Device: ${event_data.device}` : '',
      ].filter(Boolean).join('\n');

      const tags = JSON.stringify(['auto-created', event_type]);

      let external_id: string | undefined;
      let external_url: string | undefined;
      if (tenantConfig && tenantConfig.provider !== 'internal') {
        const ext = await pushToExternal(tenantConfig, { title, description, priority, ticket_number });
        external_id = ext.external_id;
        external_url = ext.external_url;
      }

      await pool.query(`
        INSERT INTO tickets (id, org_id, ticket_number, title, description, priority, status, source_type, source_id, tags, external_id, external_url, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, $12, $12)
      `, [id, orgId, ticket_number, title, description, priority, event_type, event_id || null, tags, external_id || null, external_url || null, now]);

      log.info({ id, orgId, ticket_number, event_type, priority }, 'Auto-created ticket from event');

      return reply.code(201).send({
        created: true,
        ticket_id: id,
        ticket_number,
        priority,
        title,
        external_id: external_id || null,
        external_url: external_url || null,
      });
    } catch (err) {
      log.error({ err }, 'Failed to auto-create ticket');
      return reply.code(500).send({ error: 'Failed to auto-create ticket' });
    }
  });

  log.info('Ticket routes registered');
}
