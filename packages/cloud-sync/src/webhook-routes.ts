// @ts-nocheck
/**
 * Webhook & API Documentation Routes
 *
 * Webhook management and OpenAPI spec for all products.
 * Supports CRUD, test delivery, delivery logs, and embedded OpenAPI JSON.
 *
 * Mount behind JWT auth at prefix '/api/v1/webhooks'.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:webhooks');

export interface WebhookRoutesOptions {
  connectionString?: string;
}

/** OpenAPI 3.0 specification covering major endpoints */
const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'EdgeRuntime API',
    version: '1.0.0',
    description: 'Unified API for SafeSchool, SafeSchool, and SafeSchool products. Provides access control event management, visitor management, incident response, alarm triage, and fleet management.',
    contact: { name: 'EdgeRuntime Support' },
  },
  servers: [{ url: '/api/v1', description: 'API v1' }],
  security: [{ BearerAuth: [] }],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      HMACAuth: { type: 'apiKey', in: 'header', name: 'X-Sync-Signature' },
      DeviceKey: { type: 'apiKey', in: 'header', name: 'X-Device-Key' },
    },
    schemas: {
      Event: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['access_granted', 'access_denied', 'door_forced_open', 'door_held_open', 'alarm', 'panic'] },
          timestamp: { type: 'string', format: 'date-time' },
          doorName: { type: 'string' },
          cardholderName: { type: 'string' },
          location: { type: 'string' },
        },
      },
      Visitor: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          company: { type: 'string' },
          host: { type: 'string' },
          status: { type: 'string', enum: ['pre_registered', 'checked_in', 'checked_out', 'denied'] },
          check_in_time: { type: 'string', format: 'date-time' },
        },
      },
      Incident: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          incident_number: { type: 'string' },
          title: { type: 'string' },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          status: { type: 'string', enum: ['open', 'acknowledged', 'investigating', 'resolved', 'closed'] },
        },
      },
      Alarm: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          alarm_number: { type: 'string' },
          title: { type: 'string' },
          priority: { type: 'string' },
          status: { type: 'string' },
          source_system: { type: 'string' },
        },
      },
      Webhook: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          active: { type: 'integer', enum: [0, 1] },
          secret: { type: 'string' },
        },
      },
      Device: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          hostname: { type: 'string' },
          version: { type: 'string' },
          mode: { type: 'string' },
          lastHeartbeatAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/data/events': {
      get: { summary: 'List access events', tags: ['Events'], parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        { name: 'type', in: 'query', schema: { type: 'string' } },
      ], responses: { '200': { description: 'List of events' } } },
    },
    '/data/events/stats': {
      get: { summary: 'Event statistics', tags: ['Events'], responses: { '200': { description: 'Event counts and breakdowns' } } },
    },
    '/visitors': {
      get: { summary: 'List visitors', tags: ['Visitors'], responses: { '200': { description: 'Visitor list' } } },
      post: { summary: 'Pre-register visitor', tags: ['Visitors'], requestBody: { content: { 'application/json': { schema: { '$ref': '#/components/schemas/Visitor' } } } }, responses: { '201': { description: 'Visitor created' } } },
    },
    '/visitors/{id}/check-in': {
      post: { summary: 'Check in visitor', tags: ['Visitors'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Visitor checked in' } } },
    },
    '/visitors/{id}/check-out': {
      post: { summary: 'Check out visitor', tags: ['Visitors'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Visitor checked out' } } },
    },
    '/incidents': {
      get: { summary: 'List incidents', tags: ['Incidents'], responses: { '200': { description: 'Incident list' } } },
      post: { summary: 'Create incident', tags: ['Incidents'], responses: { '201': { description: 'Incident created' } } },
    },
    '/incidents/{id}': {
      get: { summary: 'Get incident details', tags: ['Incidents'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Incident details' } } },
    },
    '/alarms': {
      get: { summary: 'List alarms', tags: ['Alarms'], responses: { '200': { description: 'Alarm list' } } },
      post: { summary: 'Create alarm', tags: ['Alarms'], responses: { '201': { description: 'Alarm created' } } },
    },
    '/alarms/queue': {
      get: { summary: 'Active alarm queue (priority-sorted)', tags: ['Alarms'], responses: { '200': { description: 'Priority-sorted alarm queue' } } },
    },
    '/alarms/{id}/acknowledge': {
      post: { summary: 'Acknowledge alarm', tags: ['Alarms'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Alarm acknowledged' } } },
    },
    '/alarms/{id}/resolve': {
      post: { summary: 'Resolve alarm', tags: ['Alarms'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Alarm resolved' } } },
    },
    '/panic/trigger': {
      post: { summary: 'Trigger panic alert', tags: ['Panic'], responses: { '201': { description: 'Panic alert triggered' } } },
    },
    '/panic/alerts': {
      get: { summary: 'List panic alerts', tags: ['Panic'], responses: { '200': { description: 'Panic alert list' } } },
    },
    '/fleet/devices': {
      get: { summary: 'List edge devices', tags: ['Fleet'], responses: { '200': { description: 'Device list' } } },
    },
    '/fleet/summary': {
      get: { summary: 'Fleet summary', tags: ['Fleet'], responses: { '200': { description: 'Fleet overview' } } },
    },
    '/webhooks': {
      get: { summary: 'List webhooks', tags: ['Webhooks'], responses: { '200': { description: 'Webhook list' } } },
      post: { summary: 'Create webhook', tags: ['Webhooks'], requestBody: { content: { 'application/json': { schema: { '$ref': '#/components/schemas/Webhook' } } } }, responses: { '201': { description: 'Webhook created' } } },
    },
    '/webhooks/{id}': {
      put: { summary: 'Update webhook', tags: ['Webhooks'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Webhook updated' } } },
      delete: { summary: 'Delete webhook', tags: ['Webhooks'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Webhook deleted' } } },
    },
    '/webhooks/{id}/test': {
      post: { summary: 'Send test webhook event', tags: ['Webhooks'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Test event sent' } } },
    },
    '/pass/score': {
      get: { summary: 'PASS compliance score per tier', tags: ['Compliance'], responses: { '200': { description: 'Compliance scores' } } },
    },
    '/building-systems': {
      get: { summary: 'List building systems', tags: ['Building'], responses: { '200': { description: 'Building systems list' } } },
    },
    '/agencies': {
      get: { summary: 'List agencies', tags: ['Agencies'], responses: { '200': { description: 'Agency list' } } },
    },
  },
};

export async function webhookRoutes(fastify: FastifyInstance, opts: WebhookRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — webhook routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // ─── GET / — List webhooks ─────────────────────────────────────
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { rows } = await pool.query('SELECT * FROM webhooks ORDER BY created_at DESC');
      return reply.send({ webhooks: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to list webhooks');
      return reply.code(500).send({ error: 'Failed to list webhooks' });
    }
  });

  // ─── GET /:id — Get webhook details ────────────────────────────
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { rows } = await pool.query('SELECT * FROM webhooks WHERE id = $1', [id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Webhook not found' });
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to get webhook');
      return reply.code(500).send({ error: 'Failed to get webhook' });
    }
  });

  // ─── POST / — Create webhook ──────────────────────────────────
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const now = new Date().toISOString();
      const id = body.id || crypto.randomUUID();
      const secret = body.secret || crypto.randomBytes(32).toString('hex');

      await pool.query(`
        INSERT INTO webhooks (id, name, url, events, secret, active, last_triggered, last_status, failure_count, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, 0, $7, $7)
      `, [
        id,
        body.name || 'Untitled Webhook',
        body.url || '',
        JSON.stringify(body.events || []),
        secret,
        body.active !== undefined ? (body.active ? 1 : 0) : 1,
        now,
      ]);

      log.info({ id, name: body.name, url: body.url }, 'Webhook created');
      return reply.code(201).send({ id, name: body.name, secret });
    } catch (err) {
      log.error({ err }, 'Failed to create webhook');
      return reply.code(500).send({ error: 'Failed to create webhook' });
    }
  });

  // ─── PUT /:id — Update webhook ─────────────────────────────────
  fastify.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const now = new Date().toISOString();

      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (body.name) { updates.push(`name = $${idx++}`); params.push(body.name); }
      if (body.url) { updates.push(`url = $${idx++}`); params.push(body.url); }
      if (body.events) { updates.push(`events = $${idx++}`); params.push(JSON.stringify(body.events)); }
      if (body.secret) { updates.push(`secret = $${idx++}`); params.push(body.secret); }
      if (body.active !== undefined) { updates.push(`active = $${idx++}`); params.push(body.active ? 1 : 0); }

      if (updates.length === 0) return reply.code(400).send({ error: 'No fields to update' });

      updates.push(`updated_at = $${idx++}`); params.push(now);
      params.push(id);

      const { rowCount } = await pool.query(
        `UPDATE webhooks SET ${updates.join(', ')} WHERE id = $${idx}`, params
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Webhook not found' });

      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to update webhook');
      return reply.code(500).send({ error: 'Failed to update webhook' });
    }
  });

  // ─── DELETE /:id — Delete webhook ──────────────────────────────
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { rowCount } = await pool.query('DELETE FROM webhooks WHERE id = $1', [id]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Webhook not found' });
      log.info({ id }, 'Webhook deleted');
      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete webhook');
      return reply.code(500).send({ error: 'Failed to delete webhook' });
    }
  });

  // ─── POST /:id/test — Send test event ─────────────────────────
  fastify.post('/:id/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { rows } = await pool.query('SELECT * FROM webhooks WHERE id = $1', [id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Webhook not found' });

      const webhook = rows[0];
      const now = new Date().toISOString();
      const testPayload = {
        event: 'webhook.test',
        webhook_id: id,
        timestamp: now,
        data: { message: 'This is a test webhook delivery from EdgeRuntime' },
      };

      // Sign the payload with HMAC
      const hmac = crypto.createHmac('sha256', webhook.secret || 'test');
      hmac.update(JSON.stringify(testPayload));
      const signature = hmac.digest('hex');

      let statusCode = 0;
      let responseBody = '';
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': 'webhook.test',
            'X-Webhook-Id': id,
          },
          body: JSON.stringify(testPayload),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        statusCode = res.status;
        responseBody = await res.text().catch(() => '');
      } catch (fetchErr) {
        statusCode = 0;
        responseBody = String(fetchErr);
      }

      // Update webhook with last delivery info
      const success = statusCode >= 200 && statusCode < 300;
      await pool.query(
        `UPDATE webhooks SET last_triggered = $1, last_status = $2, failure_count = CASE WHEN $3 THEN 0 ELSE failure_count + 1 END, updated_at = $1 WHERE id = $4`,
        [now, statusCode, success, id]
      );

      // Log delivery in audit (tenant-scoped)
      try {
        const orgId = getOrgId(request);
        await pool.query(`
          INSERT INTO audit_log (id, org_id, action, actor, target_type, target_id, target_name, details, created_at)
          VALUES ($1, $2, 'webhook_test', 'system', 'webhook', $3, $4, $5, $6)
        `, [crypto.randomUUID(), orgId, id, webhook.name, JSON.stringify({ status: statusCode, success, response_preview: responseBody.slice(0, 500) }), now]);
      } catch (err) { log.debug({ err }, 'Failed to write webhook test audit log (table may not exist)'); }

      log.info({ id, statusCode, success }, 'Webhook test delivered');
      return reply.send({ success, status_code: statusCode, response_preview: responseBody.slice(0, 500) });
    } catch (err) {
      log.error({ err }, 'Failed to test webhook');
      return reply.code(500).send({ error: 'Failed to test webhook' });
    }
  });

  // ─── GET /:id/logs — Recent delivery logs (tenant-scoped) ─────
  fastify.get('/:id/logs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      // Pull from audit_log for webhook deliveries (caller's tenant only)
      const { rows } = await pool.query(`
        SELECT * FROM audit_log
        WHERE COALESCE(org_id, $1) = $1 AND target_type = 'webhook' AND target_id = $2
        ORDER BY created_at DESC LIMIT 50
      `, [orgId, id]);
      return reply.send({ logs: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to get webhook logs');
      return reply.code(500).send({ error: 'Failed to get webhook logs' });
    }
  });
}

/** OpenAPI docs endpoint — mounted separately so it can be public */
export async function apiDocsRoute(fastify: FastifyInstance) {
  fastify.get('/api/v1/api-docs', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(OPENAPI_SPEC);
  });
}
