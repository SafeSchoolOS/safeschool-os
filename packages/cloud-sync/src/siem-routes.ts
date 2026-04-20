// @ts-nocheck
/**
 * SIEM/SOC Webhook Export Routes
 *
 * Push security events to Splunk, Microsoft Sentinel, or any SIEM.
 *
 * Routes:
 *   POST /siem/configure — Configure SIEM export
 *   GET  /siem/config    — Get current SIEM config
 *   PUT  /siem/config    — Update SIEM config
 *   POST /siem/test      — Send test event to SIEM
 *   GET  /siem/log       — Recent SIEM export log
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:siem');

export interface SiemRoutesOptions {
  connectionString?: string;
}

// ─── CEF/LEEF/Syslog Formatters ─────────────────────────────────
function formatCEF(event: Record<string, any>): string {
  const severity = { critical: 10, high: 7, medium: 5, low: 3, info: 1 }[event.priority || 'medium'] || 5;
  const ext = Object.entries(event)
    .filter(([k]) => !['id', 'priority'].includes(k))
    .map(([k, v]) => `${k}=${String(v).replace(/[=\\]/g, '\\$&')}`)
    .join(' ');
  return `CEF:0|EdgeRuntime|SecurityPlatform|1.0|${event.eventType || event.alarm_type || 'generic'}|${event.title || event.eventType || 'Security Event'}|${severity}|${ext}`;
}

function formatLEEF(event: Record<string, any>): string {
  const attrs = Object.entries(event)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('\t');
  return `LEEF:2.0|EdgeRuntime|SecurityPlatform|1.0|${event.eventType || 'generic'}|${attrs}`;
}

function formatSyslog(event: Record<string, any>): string {
  const pri = { critical: 2, high: 3, medium: 5, low: 6, info: 6 }[event.priority || 'medium'] || 5;
  const facility = 4; // security/authorization
  const priVal = facility * 8 + pri;
  const ts = new Date().toISOString();
  return `<${priVal}>1 ${ts} edgeruntime security - - - ${JSON.stringify(event)}`;
}

function formatEvent(event: Record<string, any>, format: string): string {
  switch (format) {
    case 'cef': return formatCEF(event);
    case 'leef': return formatLEEF(event);
    case 'syslog': return formatSyslog(event);
    default: return JSON.stringify(event);
  }
}

export async function siemRoutes(fastify: FastifyInstance, opts: SiemRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — SIEM routes disabled');
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
    await ensureOrgColumn(pool, 'siem_config', 'siem_config');
    await ensureOrgColumn(pool, 'siem_export_log', 'siem_export_log');
    tableMigrated = true;
  }

  // ─── Helper: send event to SIEM endpoint ──────────────────────
  async function sendToSiem(config: any, eventData: Record<string, any>): Promise<{ success: boolean; status?: number; error?: string }> {
    const formatted = formatEvent(eventData, config.format || 'json');
    const headers: Record<string, string> = { 'Content-Type': config.format === 'json' ? 'application/json' : 'text/plain' };

    if (config.auth_type === 'bearer') {
      headers['Authorization'] = `Bearer ${config.auth_value}`;
    } else if (config.auth_type === 'basic') {
      headers['Authorization'] = `Basic ${Buffer.from(config.auth_value || '').toString('base64')}`;
    } else if (config.auth_type === 'api_key') {
      headers['Authorization'] = config.auth_value || '';
    }

    try {
      const resp = await fetch(config.endpoint_url, {
        method: 'POST',
        headers,
        body: formatted,
        signal: AbortSignal.timeout(10000),
      });
      return { success: resp.ok, status: resp.status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  // ─── POST /siem/configure — Configure SIEM export ─────────────
  fastify.post('/siem/configure', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.endpoint_url) {
      return reply.code(400).send({ error: 'endpoint_url is required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await pool.query(`
        INSERT INTO siem_config (id, org_id, name, endpoint_url, format, auth_type, auth_value, events, active, last_sent, failure_count, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
      `, [
        id,
        orgId,
        body.name || 'SIEM Export',
        body.endpoint_url,
        body.format || 'json',
        body.auth_type || 'none',
        body.auth_value || null,
        JSON.stringify(body.events || ['incident_created', 'alarm_triggered', 'access_denied', 'door_forced', 'panic_triggered', 'lockdown_initiated']),
        body.active !== undefined ? (body.active ? 1 : 0) : 1,
        null,
        0,
        now,
      ]);

      log.info({ id, orgId, url: body.endpoint_url, format: body.format }, 'SIEM configured');
      return reply.code(201).send({ id, name: body.name, endpoint_url: body.endpoint_url, format: body.format, active: true });
    } catch (err) {
      log.error({ err }, 'Failed to configure SIEM');
      return reply.code(500).send({ error: 'Failed to configure SIEM' });
    }
  });

  // ─── GET /siem/config — Get current SIEM configs (tenant-scoped) ──
  fastify.get('/siem/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { rows } = await pool.query(
        'SELECT * FROM siem_config WHERE COALESCE(org_id, $1) = $1 ORDER BY created_at DESC',
        [orgId]
      );
      // Mask auth values on list
      const configs = rows.map(r => ({ ...r, auth_value: r.auth_value ? '***' : null }));
      return reply.send({ configs, total: configs.length });
    } catch {
      return reply.send({ configs: [], total: 0 });
    }
  });

  // ─── PUT /siem/config — Update SIEM config (tenant-scoped) ─────
  fastify.put('/siem/config', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    const id = body?.id;
    if (!id) {
      return reply.code(400).send({ error: 'id is required' });
    }

    const now = new Date().toISOString();
    const fields: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    if (body.name !== undefined) { fields.push(`name = $${idx++}`); values.push(body.name); }
    if (body.endpoint_url !== undefined) { fields.push(`endpoint_url = $${idx++}`); values.push(body.endpoint_url); }
    if (body.format !== undefined) { fields.push(`format = $${idx++}`); values.push(body.format); }
    if (body.auth_type !== undefined) { fields.push(`auth_type = $${idx++}`); values.push(body.auth_type); }
    if (body.auth_value !== undefined) { fields.push(`auth_value = $${idx++}`); values.push(body.auth_value); }
    if (body.events !== undefined) { fields.push(`events = $${idx++}`); values.push(JSON.stringify(body.events)); }
    if (body.active !== undefined) { fields.push(`active = $${idx++}`); values.push(body.active ? 1 : 0); }

    values.push(id, orgId);
    try {
      const { rowCount } = await pool.query(
        `UPDATE siem_config SET ${fields.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
        values
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'SIEM config not found' });
      const { rows } = await pool.query(
        'SELECT * FROM siem_config WHERE id = $1 AND COALESCE(org_id, $2) = $2',
        [id, orgId]
      );
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to update SIEM config');
      return reply.code(500).send({ error: 'Failed to update SIEM config' });
    }
  });

  // ─── POST /siem/test — Send test event to SIEM (tenant-scoped) ──
  fastify.post('/siem/test', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    const configId = body?.config_id;

    try {
      let config;
      if (configId) {
        const { rows } = await pool.query(
          'SELECT * FROM siem_config WHERE id = $1 AND COALESCE(org_id, $2) = $2',
          [configId, orgId]
        );
        if (rows.length === 0) return reply.code(404).send({ error: 'SIEM config not found' });
        config = rows[0];
      } else {
        const { rows } = await pool.query(
          'SELECT * FROM siem_config WHERE COALESCE(org_id, $1) = $1 AND active = 1 ORDER BY created_at DESC LIMIT 1',
          [orgId]
        );
        if (rows.length === 0) return reply.code(404).send({ error: 'No active SIEM config found' });
        config = rows[0];
      }

      const testEvent = {
        id: crypto.randomUUID(),
        eventType: 'siem_test',
        title: 'SIEM Integration Test Event',
        description: 'This is a test event from EdgeRuntime to verify SIEM connectivity',
        priority: 'info',
        source: 'edgeruntime',
        timestamp: new Date().toISOString(),
        test: true,
      };

      const result = await sendToSiem(config, testEvent);

      // Log the test (tenant-scoped)
      try {
        await pool.query(`
          INSERT INTO siem_export_log (id, org_id, siem_config_id, event_type, event_id, status, status_code, error, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [crypto.randomUUID(), orgId, config.id, 'siem_test', testEvent.id, result.success ? 'sent' : 'failed', result.status || null, result.error || null, new Date().toISOString()]);
      } catch (err) { log.debug({ err }, 'Failed to write SIEM export log entry (table may not exist)'); }

      if (result.success) {
        await pool.query(
          'UPDATE siem_config SET last_sent = $1, failure_count = 0 WHERE id = $2 AND COALESCE(org_id, $3) = $3',
          [new Date().toISOString(), config.id, orgId]
        );
      } else {
        await pool.query(
          'UPDATE siem_config SET failure_count = failure_count + 1 WHERE id = $1 AND COALESCE(org_id, $2) = $2',
          [config.id, orgId]
        );
      }

      return reply.send({
        success: result.success,
        status: result.status,
        error: result.error,
        format: config.format,
        formatted_event: formatEvent(testEvent, config.format),
      });
    } catch (err) {
      log.error({ err }, 'Failed to send test event');
      return reply.code(500).send({ error: 'Failed to send test event' });
    }
  });

  // ─── GET /siem/log — Recent export log ─────────────────────────
  fastify.get('/siem/log', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);
      const { rows } = await pool.query(
        'SELECT * FROM siem_export_log WHERE COALESCE(org_id, $1) = $1 ORDER BY created_at DESC LIMIT $2',
        [orgId, limit]
      );
      return reply.send({ log: rows, total: rows.length });
    } catch {
      return reply.send({ log: [], total: 0 });
    }
  });

  log.info('SIEM export routes registered');
}
