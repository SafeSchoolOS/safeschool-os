// @ts-nocheck
/**
 * Telephony / IVR Routes (Twilio Webhooks)
 *
 * Handles Twilio voice webhooks for IVR door release:
 *   - Incoming call → greet caller, gather unit number via DTMF
 *   - Gather callback → verify caller phone vs tenant record, release door
 *   - Status callback → log call completion
 *
 * Also provides JWT-protected endpoints for call log and config.
 *
 * Routes (PUBLIC — Twilio webhooks, no JWT):
 *   POST /voice/incoming  — Twilio voice webhook (incoming call)
 *   POST /voice/gather    — Twilio gather callback (unit number entered)
 *   POST /voice/status    — Twilio status callback
 *
 * Routes (JWT-protected):
 *   GET  /calls           — Call log
 *   POST /test-call       — Trigger test call
 *   GET  /config          — Get Twilio config status
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:telephony');

/** The Twilio phone number → tenant binding. Each tenant must have its own
 *  Twilio number; we pin the org via TELEPHONY_ORG env var on the deployment
 *  that owns that number (single-tenant-per-Twilio-number model). Falls back
 *  to DASHBOARD_ADMIN_ORG for single-tenant deploys. */
const TELEPHONY_ORG = process.env.TELEPHONY_ORG || process.env.DASHBOARD_ADMIN_ORG || 'default';

// ─── TwiML Helpers ──────────────────────────────────────────────────────────

function twiml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${body}\n</Response>`;
}

function say(text: string, voice = 'Polly.Joanna'): string {
  return `  <Say voice="${voice}">${escapeXml(text)}</Say>`;
}

function gather(opts: { numDigits: number; action: string; method?: string }, inner: string): string {
  return `  <Gather numDigits="${opts.numDigits}" action="${escapeXml(opts.action)}" method="${opts.method || 'POST'}">\n${inner}\n  </Gather>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Config ─────────────────────────────────────────────────────────────────

const TWILIO_PHONE_NUMBER = () => process.env.TWILIO_PHONE_NUMBER || '';
const TWILIO_ACCOUNT_SID = () => process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = () => process.env.TWILIO_AUTH_TOKEN || '';
const DOOR_RELEASE_DOOR_ID = () => process.env.TWILIO_DOOR_RELEASE_DOOR_ID || 'main-lobby-door-1';

const BUILDING_NAME = () => {
  if (process.env.TWILIO_BUILDING_NAME) return process.env.TWILIO_BUILDING_NAME;
  const product = (process.env.DASHBOARD_PRODUCT || '').toLowerCase();
  const names: Record<string, string> = {
    'safeschool': 'The Grand at Harbor Point',
    safeschool: 'Lincoln High School',
    safeschool: 'Meridian Tower',
    'safeschool': 'GSOC Command Center',
    safeschool: 'Nexus Data Center',
  };
  return names[product] || 'Your Building';
};

// ─── Exports ────────────────────────────────────────────────────────────────

export interface TelephonyRoutesOptions {
  connectionString?: string;
  /** Fastify auth hook — applied to JWT-protected routes only */
  authHook?: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/**
 * telephonyVoiceRoutes — PUBLIC Twilio webhook endpoints (no JWT).
 * Mount at prefix '/api/v1/telephony'.
 */
export async function telephonyVoiceRoutes(fastify: FastifyInstance, opts: TelephonyRoutesOptions) {
  // Twilio sends webhooks as application/x-www-form-urlencoded
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    try {
      const parsed: Record<string, string> = {};
      String(body).split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) parsed[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — telephony voice routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 3,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Ensure telephony_calls table exists
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telephony_calls (
        id TEXT PRIMARY KEY,
        call_sid TEXT,
        from_number TEXT,
        to_number TEXT,
        unit_number TEXT,
        status TEXT DEFAULT 'ringing',
        result TEXT,
        duration_seconds INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    log.info('telephony_calls table ensured');
  } catch (err) {
    log.error({ err }, 'Failed to create telephony_calls table');
  }

  // ─── POST /voice/incoming — Twilio voice webhook ──────────────────────
  // Twilio calls this URL when someone dials the Twilio number.
  // Responds with TwiML: greet the caller and gather unit number via DTMF.
  fastify.post('/voice/incoming', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string> || {};
    const callSid = body.CallSid || crypto.randomUUID();
    const from = body.From || 'unknown';
    const to = body.To || TWILIO_PHONE_NUMBER();

    log.info({ callSid, from, to }, 'Incoming voice call');

    // Log the incoming call (pinned to this deployment's tenant)
    try {
      await ensureOrgColumn(pool, 'telephony_calls', 'telephony_calls').catch(() => {});
      await pool.query(
        `INSERT INTO telephony_calls (id, org_id, call_sid, from_number, to_number, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'ringing', NOW())
         ON CONFLICT (id) DO NOTHING`,
        [crypto.randomUUID(), TELEPHONY_ORG, callSid, from, to]
      );
    } catch (err) {
      log.error({ err }, 'Failed to log incoming call');
    }

    const buildingName = BUILDING_NAME();
    const xml = twiml([
      say(`Welcome to ${buildingName}. Please enter your unit number followed by the pound sign.`),
      gather(
        { numDigits: 4, action: '/api/v1/telephony/voice/gather' },
        `    ${say('Enter your unit number now.')}`
      ),
      say("We didn't receive any input. Goodbye."),
    ].join('\n'));

    reply.type('text/xml').send(xml);
  });

  // ─── POST /voice/gather — Twilio gather callback ─────────────────────
  // Twilio calls this after the caller enters DTMF digits.
  // Looks up unit → tenant, verifies caller phone, releases door.
  fastify.post('/voice/gather', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string> || {};
    const digits = body.Digits || '';
    const callSid = body.CallSid || '';
    const callerPhone = body.From || '';

    log.info({ callSid, digits, callerPhone }, 'Gather callback — unit number entered');

    if (!digits) {
      const xml = twiml(say("No unit number received. Goodbye."));
      return reply.type('text/xml').send(xml);
    }

    // Update call record with unit number
    try {
      await pool.query(
        `UPDATE telephony_calls SET unit_number = $1, status = 'in_progress' WHERE call_sid = $2`,
        [digits, callSid]
      );
    } catch (err) {
      log.error({ err }, 'Failed to update call with unit number');
    }

    // Look up tenant by unit number
    // Check sync_entities for entity_type = 'tenant' or 'cardholder' with matching unit
    let tenant: any = null;
    try {
      // Try tenant entity type first
      const { rows } = await pool.query(
        `SELECT * FROM sync_entities
         WHERE entity_type IN ('tenant', 'cardholder')
           AND (
             data->>'unit_number' = $1
             OR data->>'unitNumber' = $1
             OR data->>'suite' = $1
           )
         LIMIT 1`,
        [digits]
      );
      if (rows.length > 0) {
        tenant = rows[0];
      }
    } catch (err) {
      log.error({ err }, 'Failed to look up tenant by unit number');
    }

    // Also check the tenants table (tenant-routes creates this)
    if (!tenant) {
      try {
        const { rows } = await pool.query(
          `SELECT * FROM tenants WHERE suite = $1 OR tenant_name LIKE $2 LIMIT 1`,
          [digits, `%Unit ${digits}%`]
        );
        if (rows.length > 0) {
          tenant = rows[0];
        }
      } catch {
        // tenants table may not exist — that's fine
      }
    }

    if (!tenant) {
      log.warn({ digits, callerPhone }, 'No tenant found for unit number');
      await updateCallResult(pool, callSid, 'denied', 'unit_not_found');
      const xml = twiml(say(`Unit ${digits} was not found. Please try again or contact the front desk. Goodbye.`));
      return reply.type('text/xml').send(xml);
    }

    // Verify caller phone matches tenant record
    const tenantData = tenant.data ? (typeof tenant.data === 'string' ? JSON.parse(tenant.data) : tenant.data) : tenant;
    const tenantPhone = tenantData.phone || tenantData.contact_phone || tenantData.phoneNumber || '';
    const normalizedCaller = normalizePhone(callerPhone);
    const normalizedTenant = normalizePhone(tenantPhone);

    if (!normalizedTenant) {
      // No phone on record — allow the release (building may not require phone verification)
      log.info({ digits, callerPhone }, 'No phone on tenant record — allowing door release');
    } else if (normalizedCaller !== normalizedTenant) {
      log.warn({ digits, callerPhone, tenantPhone }, 'Caller phone does not match tenant record');
      await updateCallResult(pool, callSid, 'denied', 'phone_mismatch');
      const xml = twiml(say(`Verification failed. The calling number does not match unit ${digits}. Goodbye.`));
      return reply.type('text/xml').send(xml);
    }

    // Release the door
    const doorId = DOOR_RELEASE_DOOR_ID();
    let doorReleased = false;
    try {
      // Try to call the door unlock API internally via the same Fastify instance
      // This works because the door control endpoints are registered on the same server
      const injectResult = await fastify.inject({
        method: 'POST',
        url: '/api/v1/connectors/command',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          command: 'door_unlock',
          doorId,
          source: 'telephony-ivr',
          callerPhone,
          unitNumber: digits,
        }),
      });
      doorReleased = injectResult.statusCode >= 200 && injectResult.statusCode < 300;
      if (!doorReleased) {
        log.warn({ statusCode: injectResult.statusCode, body: injectResult.body }, 'Door unlock command failed');
      }
    } catch (err) {
      log.error({ err, doorId }, 'Failed to call door unlock API');
    }

    // Even if the internal call failed, record the event and respond
    // In many deployments, the edge device handles the actual unlock via connector
    const tenantName = tenantData.firstName
      ? `${tenantData.firstName} ${tenantData.lastName || ''}`
      : (tenantData.tenant_name || tenantData.contact_name || `Unit ${digits}`);

    await updateCallResult(pool, callSid, 'released', doorReleased ? 'door_unlocked' : 'unlock_requested');

    // Log an access event
    try {
      await pool.query(
        `INSERT INTO sync_entities (id, site_id, entity_type, data, updated_at, version, is_deleted)
         VALUES ($1, 'cloud', 'event', $2, NOW(), 1, false)
         ON CONFLICT (id) DO NOTHING`,
        [
          crypto.randomUUID(),
          JSON.stringify({
            type: 'DOOR_RELEASE_IVR',
            doorId,
            unitNumber: digits,
            callerPhone,
            tenantName: tenantName.trim(),
            method: 'telephony-ivr',
            timestamp: new Date().toISOString(),
          }),
        ]
      );
    } catch (err) {
      log.error({ err }, 'Failed to log IVR door release event');
    }

    log.info({ digits, callerPhone, doorId, tenantName }, 'Door released via IVR');

    const xml = twiml(say(`Door released for unit ${digits}. Welcome home. Goodbye.`));
    return reply.type('text/xml').send(xml);
  });

  // ─── POST /voice/status — Twilio status callback ─────────────────────
  // Twilio calls this when the call ends.
  fastify.post('/voice/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, string> || {};
    const callSid = body.CallSid || '';
    const callStatus = body.CallStatus || 'completed';
    const duration = parseInt(body.CallDuration || '0', 10);

    log.info({ callSid, callStatus, duration }, 'Call status update');

    try {
      await pool.query(
        `UPDATE telephony_calls
         SET status = $1, duration_seconds = $2
         WHERE call_sid = $3`,
        [callStatus, duration, callSid]
      );
    } catch (err) {
      log.error({ err }, 'Failed to update call status');
    }

    // Twilio expects 200 OK with empty or TwiML response
    return reply.code(200).send('');
  });
}

/**
 * telephonyRoutes — JWT-protected telephony management endpoints.
 * Mount behind fleetAuthHook at prefix '/api/v1/telephony'.
 */
export async function telephonyRoutes(fastify: FastifyInstance, opts: TelephonyRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — telephony routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 3,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Ensure table exists (idempotent)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telephony_calls (
        id TEXT PRIMARY KEY,
        call_sid TEXT,
        from_number TEXT,
        to_number TEXT,
        unit_number TEXT,
        status TEXT DEFAULT 'ringing',
        result TEXT,
        duration_seconds INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) { log.debug({ err }, 'Failed to create call_log table (may already exist from voice routes)'); }

  // ─── GET /calls — Call log ────────────────────────────────────────────
  fastify.get('/calls', async (request: FastifyRequest, reply: FastifyReply) => {
    await ensureOrgColumn(pool, 'telephony_calls', 'telephony_calls').catch(() => {});
    const orgId = getOrgId(request);
    const query = request.query as { limit?: string; offset?: string; since?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10), 1), 200);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);

    try {
      const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
      const params: any[] = [orgId];

      if (query.since) {
        conditions.push(`created_at >= $${params.length + 1}`);
        params.push(query.since);
      }

      const where = 'WHERE ' + conditions.join(' AND ');
      let sql = `SELECT * FROM telephony_calls ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const { rows } = await pool.query(sql, params);

      const countSql = query.since
        ? `SELECT COUNT(*) FROM telephony_calls WHERE COALESCE(org_id, $1) = $1 AND created_at >= $2`
        : `SELECT COUNT(*) FROM telephony_calls WHERE COALESCE(org_id, $1) = $1`;
      const countParams = query.since ? [orgId, query.since] : [orgId];
      const { rows: countRows } = await pool.query(countSql, countParams);
      const total = parseInt(countRows[0]?.count || '0', 10);

      return { calls: rows, total, limit, offset };
    } catch (err) {
      log.error({ err }, 'Failed to query call log');
      return reply.code(500).send({ error: 'Failed to query call log' });
    }
  });

  // ─── POST /test-call — Trigger test call ──────────────────────────────
  fastify.post('/test-call', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { to?: string } | null;
    const accountSid = TWILIO_ACCOUNT_SID();
    const authToken = TWILIO_AUTH_TOKEN();
    const twilioNumber = TWILIO_PHONE_NUMBER();

    if (!accountSid || !authToken || !twilioNumber) {
      return reply.code(400).send({
        error: 'Twilio not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.',
      });
    }

    const toNumber = body?.to;
    if (!toNumber) {
      return reply.code(400).send({ error: 'Missing "to" phone number' });
    }

    try {
      // Use Twilio REST API to initiate an outbound call
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
      const baseUrl = process.env.BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : 'http://localhost:3000';

      const params = new URLSearchParams({
        To: toNumber,
        From: twilioNumber,
        Url: `${baseUrl}/api/v1/telephony/voice/incoming`,
        StatusCallback: `${baseUrl}/api/v1/telephony/voice/status`,
        StatusCallbackMethod: 'POST',
      });

      const resp = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        log.error({ status: resp.status, body: errBody }, 'Twilio API error');
        return reply.code(502).send({ error: 'Twilio API call failed', details: errBody });
      }

      const result = await resp.json();
      log.info({ callSid: result.sid, to: toNumber }, 'Test call initiated');

      return {
        success: true,
        callSid: result.sid,
        to: toNumber,
        from: twilioNumber,
        status: result.status,
      };
    } catch (err) {
      log.error({ err }, 'Failed to initiate test call');
      return reply.code(500).send({ error: 'Failed to initiate test call' });
    }
  });

  // ─── GET /config — Twilio config status ───────────────────────────────
  fastify.get('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const accountSid = TWILIO_ACCOUNT_SID();
    const authToken = TWILIO_AUTH_TOKEN();
    const phoneNumber = TWILIO_PHONE_NUMBER();
    const doorId = DOOR_RELEASE_DOOR_ID();
    const buildingName = BUILDING_NAME();

    const baseUrl = process.env.BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'http://localhost:3000';

    return {
      configured: !!(accountSid && authToken && phoneNumber),
      phoneNumber: phoneNumber ? maskPhone(phoneNumber) : null,
      accountSid: accountSid ? `${accountSid.slice(0, 6)}...${accountSid.slice(-4)}` : null,
      doorId,
      buildingName,
      webhookUrls: {
        voiceIncoming: `${baseUrl}/api/v1/telephony/voice/incoming`,
        voiceGather: `${baseUrl}/api/v1/telephony/voice/gather`,
        voiceStatus: `${baseUrl}/api/v1/telephony/voice/status`,
      },
      instructions: !accountSid
        ? 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER environment variables. Then configure your Twilio phone number webhook to point to the voiceIncoming URL.'
        : null,
    };
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  if (!phone) return '';
  // Strip everything except digits and leading +
  const stripped = phone.replace(/[^\d+]/g, '');
  // Normalize US numbers: +1XXXXXXXXXX
  if (stripped.length === 10) return `+1${stripped}`;
  if (stripped.length === 11 && stripped.startsWith('1')) return `+${stripped}`;
  return stripped;
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
}

async function updateCallResult(pool: pg.Pool, callSid: string, result: string, detail?: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE telephony_calls SET result = $1, status = COALESCE(status, 'completed') WHERE call_sid = $2`,
      [detail ? `${result}:${detail}` : result, callSid]
    );
  } catch (err) {
    log.error({ err }, 'Failed to update call result');
  }
}
