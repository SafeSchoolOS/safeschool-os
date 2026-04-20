// @ts-nocheck
/**
 * Custom Sign-in Flow Routes — tenant-scoped.
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:signin-flows');

export interface SigninFlowRoutesOptions {
  connectionString?: string;
}

export async function signinFlowRoutes(fastify: FastifyInstance, opts: SigninFlowRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — signin flow routes disabled');
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
    await ensureOrgColumn(pool, 'signin_flows', 'signin_flows');
    tableMigrated = true;
  }

  const VALID_VISITOR_TYPES = ['visitor', 'contractor', 'vendor', 'interview', 'vip', 'delivery'];
  const VALID_STEP_TYPES = ['form_field', 'nda', 'photo', 'badge', 'host_notify', 'watchlist_check', 'id_scan'];

  fastify.get('/signin-flows', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const q = request.query as Record<string, string>;
    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (q.active !== undefined) {
      conditions.push(`active = $${idx++}`);
      params.push(parseInt(q.active));
    }
    if (q.visitor_type) {
      conditions.push(`visitor_type = $${idx++}`);
      params.push(q.visitor_type);
    }

    const query = `SELECT * FROM signin_flows WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
    const res = await pool.query(query, params);
    return reply.send({ flows: res.rows, total: res.rows.length });
  });

  fastify.post('/signin-flows', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.flow_name) return reply.code(400).send({ error: 'flow_name is required' });

    const visitorType = body.visitor_type || 'visitor';
    if (!VALID_VISITOR_TYPES.includes(visitorType)) {
      return reply.code(400).send({ error: 'Invalid visitor_type. Valid types: ' + VALID_VISITOR_TYPES.join(', ') });
    }

    const steps = body.steps || [];
    for (const step of steps) {
      if (!step.type || !VALID_STEP_TYPES.includes(step.type)) {
        return reply.code(400).send({
          error: 'Invalid step type: ' + (step.type || 'undefined') + '. Valid types: ' + VALID_STEP_TYPES.join(', '),
        });
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await pool.query(
        `INSERT INTO signin_flows (id, org_id, flow_name, visitor_type, steps, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [id, orgId, body.flow_name, visitorType, JSON.stringify(steps),
         body.active !== undefined ? (body.active ? 1 : 0) : 1, now]
      );
    } catch (err) {
      log.error({ err }, 'Failed to create signin flow');
      return reply.code(500).send({ error: 'Failed to create signin flow' });
    }

    const res = await pool.query('SELECT * FROM signin_flows WHERE id = $1 AND COALESCE(org_id, $2) = $2', [id, orgId]);
    log.info({ orgId, flowName: body.flow_name, visitorType }, 'Sign-in flow created');
    return reply.code(201).send(res.rows[0]);
  });

  fastify.get('/signin-flows/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query(
      'SELECT * FROM signin_flows WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (res.rows.length === 0) return reply.code(404).send({ error: 'Sign-in flow not found' });
    return reply.send(res.rows[0]);
  });

  fastify.put('/signin-flows/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const now = new Date().toISOString();

    const existing = await pool.query(
      'SELECT id FROM signin_flows WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (existing.rows.length === 0) return reply.code(404).send({ error: 'Sign-in flow not found' });

    if (body.visitor_type && !VALID_VISITOR_TYPES.includes(body.visitor_type)) {
      return reply.code(400).send({ error: 'Invalid visitor_type. Valid types: ' + VALID_VISITOR_TYPES.join(', ') });
    }

    if (body.steps) {
      for (const step of body.steps) {
        if (!step.type || !VALID_STEP_TYPES.includes(step.type)) {
          return reply.code(400).send({
            error: 'Invalid step type: ' + (step.type || 'undefined') + '. Valid types: ' + VALID_STEP_TYPES.join(', '),
          });
        }
      }
    }

    const fields: string[] = ['updated_at = $1'];
    const values: any[] = [now];
    let idx = 2;

    if (body.flow_name !== undefined) { fields.push(`flow_name = $${idx++}`); values.push(body.flow_name); }
    if (body.visitor_type !== undefined) { fields.push(`visitor_type = $${idx++}`); values.push(body.visitor_type); }
    if (body.steps !== undefined) { fields.push(`steps = $${idx++}`); values.push(JSON.stringify(body.steps)); }
    if (body.active !== undefined) { fields.push(`active = $${idx++}`); values.push(body.active ? 1 : 0); }

    values.push(id, orgId);
    await pool.query(
      `UPDATE signin_flows SET ${fields.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
      values
    );

    const res = await pool.query(
      'SELECT * FROM signin_flows WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    return reply.send(res.rows[0]);
  });

  fastify.delete('/signin-flows/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const res = await pool.query(
      'DELETE FROM signin_flows WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Sign-in flow not found' });
    return reply.send({ success: true, deleted: id });
  });

  fastify.get('/signin-flows/by-type/:visitor_type', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureTable();
    const orgId = getOrgId(request);
    const { visitor_type } = request.params as { visitor_type: string };
    const res = await pool.query(
      'SELECT * FROM signin_flows WHERE COALESCE(org_id, $1) = $1 AND visitor_type = $2 AND active = 1 ORDER BY updated_at DESC LIMIT 1',
      [orgId, visitor_type]
    );
    if (res.rows.length === 0) {
      return reply.code(404).send({ error: 'No active sign-in flow found for visitor type: ' + visitor_type });
    }
    return reply.send(res.rows[0]);
  });

  log.info('Sign-in flow routes registered');
}
