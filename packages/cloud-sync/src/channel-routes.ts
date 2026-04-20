// @ts-nocheck
/**
 * Notification Channel Routes (SafeSchool + SafeSchool)
 *
 * Mass notification channel configuration and management. Each channel row
 * carries messaging-provider credentials (Twilio auth_token, SendGrid api_key,
 * Slack/Teams webhook_url, PA-system api_key) and MUST be tenant-scoped —
 * a tenant must not be able to read or overwrite another tenant's secrets.
 *
 * Routes:
 *   GET    /notifications/channels       — List configured channels (scoped)
 *   POST   /notifications/channels       — Add channel config (scoped)
 *   PUT    /notifications/channels/:id   — Update channel (scoped)
 *   DELETE /notifications/channels/:id   — Delete channel (scoped)
 *   POST   /notifications/test-channel/:id — Send test message (scoped)
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:channels');

const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

export interface ChannelRoutesOptions {
  connectionString?: string;
}

const VALID_CHANNEL_TYPES = ['twilio_sms', 'sendgrid_email', 'webhook', 'slack', 'teams', 'pa_system'];

const CHANNEL_CONFIG_TEMPLATES: Record<string, Record<string, string>> = {
  twilio_sms: { account_sid: '', auth_token: '', from_number: '' },
  sendgrid_email: { api_key: '', from_email: '', from_name: '' },
  webhook: { url: '', method: 'POST', headers: '{}' },
  slack: { webhook_url: '' },
  teams: { webhook_url: '' },
  pa_system: { endpoint: '', api_key: '', zone: 'all' },
};

async function ensureChannelsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
  await pool.query(`UPDATE notification_channels SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_channels_org ON notification_channels(org_id)`).catch(() => {});
}

export async function channelRoutes(fastify: FastifyInstance, opts: ChannelRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — channel routes disabled');
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
    await ensureChannelsTable(pool);
    tableMigrated = true;
  }

  // ─── GET /notifications/channels — List channels (tenant-scoped) ────
  fastify.get('/notifications/channels', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const res = await pool.query(
      'SELECT * FROM notification_channels WHERE COALESCE(org_id, $1) = $1 ORDER BY channel_type ASC, created_at DESC',
      [orgId]
    );
    return reply.send({ channels: res.rows, total: res.rows.length });
  });

  // ─── POST /notifications/channels — Add channel (tenant-scoped) ─────
  fastify.post('/notifications/channels', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.channel_type) {
      return reply.code(400).send({ error: 'channel_type is required' });
    }
    if (!VALID_CHANNEL_TYPES.includes(body.channel_type)) {
      return reply.code(400).send({ error: `Invalid channel_type. Valid: ${VALID_CHANNEL_TYPES.join(', ')}` });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const config = body.config || CHANNEL_CONFIG_TEMPLATES[body.channel_type] || {};

    try {
      await pool.query(
        `INSERT INTO notification_channels (id, org_id, channel_type, config, active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, orgId, body.channel_type, JSON.stringify(config), body.active !== undefined ? (body.active ? 1 : 0) : 1, now]
      );
    } catch (err) {
      log.error({ err }, 'Failed to create channel');
      return reply.code(500).send({ error: 'Failed to create channel' });
    }

    const res = await pool.query('SELECT * FROM notification_channels WHERE id = $1 AND org_id = $2', [id, orgId]);
    log.info({ id, orgId, type: body.channel_type }, 'Notification channel created');
    return reply.code(201).send(res.rows[0]);
  });

  // ─── PUT /notifications/channels/:id — Update channel (tenant-scoped) ─
  fastify.put('/notifications/channels/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const existing = await pool.query(
      'SELECT * FROM notification_channels WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Channel not found' });
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (body.config !== undefined) {
      fields.push(`config = $${idx++}`);
      values.push(JSON.stringify(body.config));
    }
    if (body.active !== undefined) {
      fields.push(`active = $${idx++}`);
      values.push(body.active ? 1 : 0);
    }
    if (body.channel_type !== undefined && VALID_CHANNEL_TYPES.includes(body.channel_type)) {
      fields.push(`channel_type = $${idx++}`);
      values.push(body.channel_type);
    }

    if (fields.length === 0) {
      return reply.send(existing.rows[0]);
    }

    values.push(id, orgId);
    await pool.query(
      `UPDATE notification_channels SET ${fields.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
      values
    );

    const updated = await pool.query(
      'SELECT * FROM notification_channels WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    return reply.send(updated.rows[0]);
  });

  // ─── DELETE /notifications/channels/:id — Delete (tenant-scoped) ────
  fastify.delete('/notifications/channels/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query(
      'DELETE FROM notification_channels WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Channel not found' });
    }
    return reply.send({ success: true, deleted: id });
  });

  // ─── POST /notifications/test-channel/:id — Test (tenant-scoped) ────
  fastify.post('/notifications/test-channel/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };

    const channelRes = await pool.query(
      'SELECT * FROM notification_channels WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (channelRes.rows.length === 0) {
      return reply.code(404).send({ error: 'Channel not found' });
    }

    const channel = channelRes.rows[0];
    const config = typeof channel.config === 'string' ? JSON.parse(channel.config) : channel.config;
    const testMessage = 'This is a test notification from EdgeRuntime. If you received this, the channel is working correctly.';

    let success = false;
    let details = '';

    try {
      switch (channel.channel_type) {
        case 'webhook':
        case 'slack':
        case 'teams': {
          const url = config.webhook_url || config.url;
          if (!url) {
            return reply.code(400).send({ error: 'Channel URL not configured' });
          }
          const payload = channel.channel_type === 'slack'
            ? { text: `[TEST] ${testMessage}` }
            : channel.channel_type === 'teams'
            ? { '@type': 'MessageCard', text: `[TEST] ${testMessage}` }
            : { test: true, message: testMessage, timestamp: new Date().toISOString() };

          const method = config.method || 'POST';
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (config.headers) {
            const extraHeaders = typeof config.headers === 'string' ? JSON.parse(config.headers) : config.headers;
            Object.assign(headers, extraHeaders);
          }

          const res = await fetch(url, {
            method,
            headers,
            body: JSON.stringify(payload),
          });
          success = res.ok;
          details = `HTTP ${res.status} ${res.statusText}`;
          break;
        }

        case 'twilio_sms': {
          if (!config.account_sid || !config.auth_token || !config.from_number) {
            return reply.code(400).send({ error: 'Twilio credentials not fully configured (need account_sid, auth_token, from_number)' });
          }
          success = true;
          details = 'Twilio SMS channel configured — test message simulated (connect Twilio SDK for live sends)';
          break;
        }

        case 'sendgrid_email': {
          if (!config.api_key || !config.from_email) {
            return reply.code(400).send({ error: 'SendGrid credentials not fully configured (need api_key, from_email)' });
          }
          success = true;
          details = 'SendGrid email channel configured — test email simulated (connect SendGrid SDK for live sends)';
          break;
        }

        case 'pa_system': {
          if (!config.endpoint) {
            return reply.code(400).send({ error: 'PA system endpoint not configured' });
          }
          success = true;
          details = 'PA system channel configured — test announcement simulated';
          break;
        }

        default:
          details = 'Unknown channel type';
      }
    } catch (err: any) {
      details = `Error: ${err.message || String(err)}`;
    }

    return reply.send({
      channel_id: id,
      channel_type: channel.channel_type,
      test_success: success,
      details,
      tested_at: new Date().toISOString(),
    });
  });

  log.info('Notification channel routes registered');
}
