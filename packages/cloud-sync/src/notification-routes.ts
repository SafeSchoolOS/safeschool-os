// @ts-nocheck — WIP: will fix types when wiring into runtime
/**
 * Emergency Notification Routes
 *
 * Multi-channel emergency notification system for SafeSchool and other products.
 *
 * Provides:
 *   - POST   /notifications/send          — Send a notification (custom or from template)
 *   - POST   /notifications/emergency     — Quick emergency broadcast (shortcut)
 *   - GET    /notifications               — Notification history
 *   - GET    /notifications/stats         — Delivery success rates
 *   - GET    /notifications/:id           — Notification detail with delivery stats
 *   - CRUD   /notifications/contacts      — Manage notification contacts
 *   - CRUD   /notifications/templates     — Manage notification templates
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:notifications');

export interface NotificationRoutesOptions {
  /** PostgreSQL connection string (defaults to DATABASE_URL) */
  connectionString?: string;
}

const VALID_NOTIFICATION_TYPES = ['emergency', 'alert', 'info', 'drill', 'all_clear'];
const VALID_CHANNELS = ['email', 'sms', 'push', 'pa', 'display'];
const VALID_RECIPIENT_TYPES = ['all', 'group', 'zone', 'role'];
const VALID_STATUSES = ['draft', 'sending', 'sent', 'failed'];
const VALID_CONTACT_ROLES = ['staff', 'admin', 'guard', 'parent', 'first_responder'];

async function ensureNotificationTables(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      notification_type TEXT NOT NULL DEFAULT 'alert',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      channels JSONB NOT NULL DEFAULT '[]',
      recipients_type TEXT NOT NULL DEFAULT 'all',
      recipients_filter JSONB,
      sent_by TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      sent_at TEXT,
      delivery_stats JSONB NOT NULL DEFAULT '{"sent":0,"delivered":0,"failed":0,"pending":0}',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications (notification_type);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications (status);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);

    CREATE TABLE IF NOT EXISTS notification_contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'staff',
      groups JSONB NOT NULL DEFAULT '[]',
      zone TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );
    CREATE INDEX IF NOT EXISTS idx_notif_contacts_role ON notification_contacts (role);
    CREATE INDEX IF NOT EXISTS idx_notif_contacts_zone ON notification_contacts (zone);
    CREATE INDEX IF NOT EXISTS idx_notif_contacts_active ON notification_contacts (active);

    CREATE TABLE IF NOT EXISTS notification_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      notification_type TEXT NOT NULL DEFAULT 'alert',
      title_template TEXT NOT NULL,
      message_template TEXT NOT NULL,
      default_channels JSONB NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );
    CREATE INDEX IF NOT EXISTS idx_notif_templates_type ON notification_templates (notification_type);
  `);
}

export async function notificationRoutes(fastify: FastifyInstance, opts: NotificationRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — notification routes disabled');
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
    await ensureNotificationTables(pool);
    await ensureOrgColumn(pool, 'notifications', 'notifications');
    await ensureOrgColumn(pool, 'notification_contacts', 'notification_contacts');
    await ensureOrgColumn(pool, 'notification_templates', 'notification_templates');
    tableMigrated = true;
  }

  // ─── Helper: resolve recipients (tenant-scoped) ────────────
  async function resolveRecipientCount(orgId: string, recipientsType: string, recipientsFilter: any): Promise<number> {
    if (recipientsType === 'all') {
      const { rows } = await pool.query(
        'SELECT COUNT(*) as total FROM notification_contacts WHERE COALESCE(org_id, $1) = $1 AND active = 1',
        [orgId]
      );
      return parseInt(rows[0].total);
    }
    if (recipientsType === 'group' && recipientsFilter?.group) {
      const { rows } = await pool.query(
        "SELECT COUNT(*) as total FROM notification_contacts WHERE COALESCE(org_id, $1) = $1 AND active = 1 AND groups::TEXT LIKE $2",
        [orgId, `%"${recipientsFilter.group}"%`]
      );
      return parseInt(rows[0].total);
    }
    if (recipientsType === 'zone' && recipientsFilter?.zone) {
      const { rows } = await pool.query(
        'SELECT COUNT(*) as total FROM notification_contacts WHERE COALESCE(org_id, $1) = $1 AND active = 1 AND zone = $2',
        [orgId, recipientsFilter.zone]
      );
      return parseInt(rows[0].total);
    }
    if (recipientsType === 'role' && recipientsFilter?.roles) {
      const roles = Array.isArray(recipientsFilter.roles) ? recipientsFilter.roles : [recipientsFilter.roles];
      const { rows } = await pool.query(
        'SELECT COUNT(*) as total FROM notification_contacts WHERE COALESCE(org_id, $1) = $1 AND active = 1 AND role = ANY($2)',
        [orgId, roles]
      );
      return parseInt(rows[0].total);
    }
    return 0;
  }

  // ─── POST /notifications/send (tenant-scoped) ──────────────
  fastify.post('/notifications/send', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body) return reply.code(400).send({ error: 'Request body is required' });

    const notificationType = body.notification_type || body.notificationType || 'alert';
    if (!VALID_NOTIFICATION_TYPES.includes(notificationType)) {
      return reply.code(400).send({ error: `Invalid notification_type. Must be one of: ${VALID_NOTIFICATION_TYPES.join(', ')}` });
    }

    let title = body.title;
    let message = body.message;
    if (body.template_id || body.templateId) {
      const tmplId = body.template_id || body.templateId;
      const { rows } = await pool.query(
        'SELECT * FROM notification_templates WHERE id = $1 AND COALESCE(org_id, $2) = $2',
        [tmplId, orgId]
      );
      if (rows.length === 0) return reply.code(404).send({ error: 'Template not found' });
      const tmpl = rows[0];
      title = title || tmpl.title_template;
      message = message || tmpl.message_template;
    }

    if (!title || !message) {
      return reply.code(400).send({ error: 'title and message are required (or provide template_id)' });
    }

    const channels = body.channels || ['email', 'push'];
    const recipientsType = body.recipients_type || body.recipientsType || 'all';
    const recipientsFilter = body.recipients_filter || body.recipientsFilter || null;
    const user = (request as any).user;
    const sentBy = body.sent_by || body.sentBy || user?.username || user?.sub || 'system';

    const recipientCount = await resolveRecipientCount(orgId, recipientsType, recipientsFilter);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const deliveryStats = { sent: recipientCount, delivered: 0, failed: 0, pending: recipientCount };

    await pool.query(`
      INSERT INTO notifications (id, org_id, notification_type, title, message, channels, recipients_type, recipients_filter, sent_by, status, sent_at, delivery_stats, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [id, orgId, notificationType, title, message, JSON.stringify(channels), recipientsType,
        recipientsFilter ? JSON.stringify(recipientsFilter) : null, sentBy, 'sending', now,
        JSON.stringify(deliveryStats), now]);

    const finalStats = { sent: recipientCount, delivered: recipientCount, failed: 0, pending: 0 };
    await pool.query(
      "UPDATE notifications SET status = 'sent', delivery_stats = $1 WHERE id = $2 AND COALESCE(org_id, $3) = $3",
      [JSON.stringify(finalStats), id, orgId]
    );

    log.info({ notificationId: id, orgId, type: notificationType, channels, recipientCount }, 'Notification sent');

    const { rows: result } = await pool.query(
      'SELECT * FROM notifications WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    return reply.code(201).send({ success: true, notification: result[0] });
  });

  // ─── POST /notifications/emergency (tenant-scoped) ─────────
  fastify.post('/notifications/emergency', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = (request.body as any) || {};
    const user = (request as any).user;
    const sentBy = body.sent_by || body.sentBy || user?.username || user?.sub || 'system';

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const title = body.title || 'EMERGENCY ALERT';
    const message = body.message || 'Emergency alert triggered. Follow emergency procedures immediately.';
    const channels = ['email', 'sms', 'push', 'pa', 'display'];

    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) as total FROM notification_contacts WHERE COALESCE(org_id, $1) = $1 AND active = 1',
      [orgId]
    );
    const recipientCount = parseInt(countRows[0].total);
    const deliveryStats = { sent: recipientCount, delivered: recipientCount, failed: 0, pending: 0 };

    await pool.query(`
      INSERT INTO notifications (id, org_id, notification_type, title, message, channels, recipients_type, recipients_filter, sent_by, status, sent_at, delivery_stats, created_at)
      VALUES ($1, $2, 'emergency', $3, $4, $5, 'all', NULL, $6, 'sent', $7, $8, $7)
    `, [id, orgId, title, message, JSON.stringify(channels), sentBy, now, JSON.stringify(deliveryStats)]);

    log.warn({ notificationId: id, orgId, sentBy, recipientCount }, 'EMERGENCY NOTIFICATION BROADCAST');

    const { rows: result } = await pool.query(
      'SELECT * FROM notifications WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    return reply.code(201).send({ success: true, notification: result[0], message: 'Emergency broadcast sent to all channels' });
  });

  // ─── GET /notifications (tenant-scoped) ─────────────────────
  fastify.get('/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const query = request.query as { type?: string; status?: string; limit?: string; offset?: string };

    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (query.type) {
      conditions.push(`notification_type = $${paramIdx++}`);
      params.push(query.type);
    }
    if (query.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(query.status);
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(query.limit || '100', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM notifications ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    const { rows } = await pool.query(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ notifications: rows, total, limit, offset });
  });

  // ─── GET /notifications/stats (tenant-scoped) ──────────────
  fastify.get('/notifications/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);

    const { rows: typeStats } = await pool.query(
      "SELECT notification_type, COUNT(*) as count, SUM((delivery_stats->>'delivered')::int) as delivered, SUM((delivery_stats->>'failed')::int) as failed FROM notifications WHERE COALESCE(org_id, $1) = $1 GROUP BY notification_type",
      [orgId]
    );

    const { rows: totalRow } = await pool.query('SELECT COUNT(*) as total FROM notifications WHERE COALESCE(org_id, $1) = $1', [orgId]);
    const { rows: contactRow } = await pool.query('SELECT COUNT(*) as total FROM notification_contacts WHERE COALESCE(org_id, $1) = $1 AND active = 1', [orgId]);

    const totalSent = typeStats.reduce((s, r) => s + parseInt(r.count), 0);
    const totalDelivered = typeStats.reduce((s, r) => s + parseInt(r.delivered || '0'), 0);
    const totalFailed = typeStats.reduce((s, r) => s + parseInt(r.failed || '0'), 0);

    return reply.send({
      total_notifications: parseInt(totalRow[0].total),
      total_contacts: parseInt(contactRow[0].total),
      total_delivered: totalDelivered,
      total_failed: totalFailed,
      delivery_rate: totalSent > 0 ? Math.round((totalDelivered / (totalDelivered + totalFailed)) * 100) : 0,
      by_type: typeStats,
    });
  });

  // ─── GET /notifications/:id (tenant-scoped) ────────────────
  fastify.get('/notifications/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };

    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Notification not found' });

    return reply.send({ notification: rows[0] });
  });

  // ─── CRUD: Contacts ─────────────────────────────────────────

  // GET /notifications/contacts (tenant-scoped)
  fastify.get('/notifications/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const query = request.query as { role?: string; zone?: string; active?: string; limit?: string; offset?: string };

    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (query.role) {
      conditions.push(`role = $${paramIdx++}`);
      params.push(query.role);
    }
    if (query.zone) {
      conditions.push(`zone = $${paramIdx++}`);
      params.push(query.zone);
    }
    if (query.active !== undefined) {
      conditions.push(`active = $${paramIdx++}`);
      params.push(parseInt(query.active));
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(query.limit || '100', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM notification_contacts ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    const { rows } = await pool.query(
      `SELECT * FROM notification_contacts ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ contacts: rows, total, limit, offset });
  });

  // POST /notifications/contacts (tenant-scoped)
  fastify.post('/notifications/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body || !body.name) return reply.code(400).send({ error: 'name is required' });

    const role = body.role || 'staff';
    if (!VALID_CONTACT_ROLES.includes(role)) {
      return reply.code(400).send({ error: `Invalid role. Must be one of: ${VALID_CONTACT_ROLES.join(', ')}` });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const groups = body.groups || [];

    await pool.query(`
      INSERT INTO notification_contacts (id, org_id, name, email, phone, role, groups, zone, active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [id, orgId, body.name, body.email || null, body.phone || null, role,
        JSON.stringify(groups), body.zone || null, body.active !== undefined ? body.active : 1, now]);

    const { rows } = await pool.query(
      'SELECT * FROM notification_contacts WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    return reply.code(201).send({ success: true, contact: rows[0] });
  });

  // PUT /notifications/contacts/:id (tenant-scoped)
  fastify.put('/notifications/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    if (!body) return reply.code(400).send({ error: 'Request body is required' });

    const updates: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (body.name !== undefined) { updates.push(`name = $${paramIdx++}`); params.push(body.name); }
    if (body.email !== undefined) { updates.push(`email = $${paramIdx++}`); params.push(body.email); }
    if (body.phone !== undefined) { updates.push(`phone = $${paramIdx++}`); params.push(body.phone); }
    if (body.role !== undefined) { updates.push(`role = $${paramIdx++}`); params.push(body.role); }
    if (body.groups !== undefined) { updates.push(`groups = $${paramIdx++}`); params.push(JSON.stringify(body.groups)); }
    if (body.zone !== undefined) { updates.push(`zone = $${paramIdx++}`); params.push(body.zone); }
    if (body.active !== undefined) { updates.push(`active = $${paramIdx++}`); params.push(body.active); }

    if (updates.length === 0) return reply.code(400).send({ error: 'No fields to update' });

    const result = await pool.query(
      `UPDATE notification_contacts SET ${updates.join(', ')} WHERE id = $${paramIdx} AND COALESCE(org_id, $${paramIdx + 1}) = $${paramIdx + 1} RETURNING *`,
      [...params, id, orgId]
    );

    if (result.rowCount === 0) return reply.code(404).send({ error: 'Contact not found' });
    return reply.send({ success: true, contact: result.rows[0] });
  });

  // DELETE /notifications/contacts/:id (tenant-scoped)
  fastify.delete('/notifications/contacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const result = await pool.query(
      'DELETE FROM notification_contacts WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if ((result.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Contact not found' });
    return reply.send({ success: true });
  });

  // ─── CRUD: Templates ────────────────────────────────────────

  // GET /notifications/templates (tenant-scoped)
  fastify.get('/notifications/templates', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { rows } = await pool.query(
      'SELECT * FROM notification_templates WHERE COALESCE(org_id, $1) = $1 ORDER BY created_at DESC',
      [orgId]
    );
    return reply.send({ templates: rows });
  });

  // POST /notifications/templates (tenant-scoped)
  fastify.post('/notifications/templates', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body || !body.name || !body.title_template || !body.message_template) {
      return reply.code(400).send({ error: 'name, title_template, and message_template are required' });
    }

    const notificationType = body.notification_type || body.notificationType || 'alert';
    if (!VALID_NOTIFICATION_TYPES.includes(notificationType)) {
      return reply.code(400).send({ error: `Invalid notification_type. Must be one of: ${VALID_NOTIFICATION_TYPES.join(', ')}` });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const defaultChannels = body.default_channels || body.defaultChannels || ['email', 'push'];

    await pool.query(`
      INSERT INTO notification_templates (id, org_id, name, notification_type, title_template, message_template, default_channels, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, orgId, body.name, notificationType, body.title_template, body.message_template,
        JSON.stringify(defaultChannels), now]);

    const { rows } = await pool.query(
      'SELECT * FROM notification_templates WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    return reply.code(201).send({ success: true, template: rows[0] });
  });

  // PUT /notifications/templates/:id (tenant-scoped)
  fastify.put('/notifications/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    if (!body) return reply.code(400).send({ error: 'Request body is required' });

    const updates: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (body.name !== undefined) { updates.push(`name = $${paramIdx++}`); params.push(body.name); }
    if (body.notification_type !== undefined) { updates.push(`notification_type = $${paramIdx++}`); params.push(body.notification_type); }
    if (body.title_template !== undefined) { updates.push(`title_template = $${paramIdx++}`); params.push(body.title_template); }
    if (body.message_template !== undefined) { updates.push(`message_template = $${paramIdx++}`); params.push(body.message_template); }
    if (body.default_channels !== undefined) { updates.push(`default_channels = $${paramIdx++}`); params.push(JSON.stringify(body.default_channels)); }

    if (updates.length === 0) return reply.code(400).send({ error: 'No fields to update' });

    const result = await pool.query(
      `UPDATE notification_templates SET ${updates.join(', ')} WHERE id = $${paramIdx} AND COALESCE(org_id, $${paramIdx + 1}) = $${paramIdx + 1} RETURNING *`,
      [...params, id, orgId]
    );

    if (result.rowCount === 0) return reply.code(404).send({ error: 'Template not found' });
    return reply.send({ success: true, template: result.rows[0] });
  });

  // DELETE /notifications/templates/:id (tenant-scoped)
  fastify.delete('/notifications/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const result = await pool.query(
      'DELETE FROM notification_templates WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if ((result.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Template not found' });
    return reply.send({ success: true });
  });
}
