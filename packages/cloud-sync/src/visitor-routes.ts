// @ts-nocheck
/**
 * Visitor Pre-Registration & QR Check-In Routes
 *
 * Tenant-scoped: every visitor and watchlist entry carries `org_id`. The QR
 * check-in path additionally scopes by org so a guessed QR token from tenant A
 * cannot check in against tenant B. Watchlist is per-tenant.
 */

import crypto from 'node:crypto';
import { createLogger } from '@edgeruntime/core';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:visitors');

export interface VisitorRoutesOptions {
  connectionString?: string;
}

export async function visitorRoutes(fastify: FastifyInstance, opts: VisitorRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — visitor routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await ensureVisitorTables(pool);

  // ─── Visitor routes ────────────────────────────────────────────

  // POST /visitors/pre-register — Pre-register a visitor (tenant-scoped)
  fastify.post('/visitors/pre-register', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.first_name || !body?.last_name || !body?.host_name) {
      return reply.code(400).send({ error: 'first_name, last_name, and host_name are required' });
    }

    const id = crypto.randomUUID();
    const qrCode = crypto.randomUUID();
    const now = new Date().toISOString();

    const visitor = {
      id,
      org_id: orgId,
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email || null,
      phone: body.phone || null,
      company: body.company || null,
      photo_url: body.photo_url || null,
      host_name: body.host_name,
      host_email: body.host_email || null,
      purpose: body.purpose || 'meeting',
      visitor_type: body.visitor_type || 'visitor',
      status: 'pre_registered',
      qr_code: qrCode,
      badge_printed: 0,
      expected_arrival: body.expected_arrival || null,
      checked_in_at: null,
      checked_out_at: null,
      nda_signed: 0,
      nda_signed_at: null,
      notes: body.notes || null,
      device_id: body.device_id || null,
      created_at: now,
    };

    await pool.query(`
      INSERT INTO visitors (id, org_id, first_name, last_name, email, phone, company, photo_url,
        host_name, host_email, purpose, visitor_type, status, qr_code, badge_printed,
        expected_arrival, checked_in_at, checked_out_at, nda_signed, nda_signed_at,
        notes, device_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    `, [
      visitor.id, visitor.org_id, visitor.first_name, visitor.last_name, visitor.email, visitor.phone,
      visitor.company, visitor.photo_url, visitor.host_name, visitor.host_email,
      visitor.purpose, visitor.visitor_type, visitor.status, visitor.qr_code,
      visitor.badge_printed, visitor.expected_arrival, visitor.checked_in_at,
      visitor.checked_out_at, visitor.nda_signed, visitor.nda_signed_at,
      visitor.notes, visitor.device_id, visitor.created_at,
    ]);

    log.info({ visitorId: id, orgId, name: `${visitor.first_name} ${visitor.last_name}` }, 'Visitor pre-registered');

    return reply.send({
      success: true,
      visitor,
      qr_code: qrCode,
      qr_url: `/visitors/qr/${qrCode}`,
    });
  });

  // POST /visitors/check-in — Check in by QR token or manual entry (tenant-scoped)
  fastify.post('/visitors/check-in', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    const now = new Date().toISOString();

    let visitor: any;

    if (body?.qr_code) {
      // QR-based check-in — scoped by tenant so a QR from another tenant
      // cannot redeem here.
      const { rows } = await pool.query(
        'SELECT * FROM visitors WHERE qr_code = $1 AND COALESCE(org_id, $2) = $2',
        [body.qr_code, orgId]
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Invalid QR code' });
      }
      visitor = rows[0];
      if (visitor.status === 'checked_in') {
        return reply.code(409).send({ error: 'Visitor already checked in', visitor });
      }
    } else if (body?.first_name && body?.last_name) {
      const id = crypto.randomUUID();
      const qrCode = crypto.randomUUID();
      visitor = {
        id,
        org_id: orgId,
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email || null,
        phone: body.phone || null,
        company: body.company || null,
        photo_url: body.photo_url || null,
        host_name: body.host_name || '',
        host_email: body.host_email || null,
        purpose: body.purpose || 'meeting',
        visitor_type: body.visitor_type || 'visitor',
        qr_code: qrCode,
        badge_printed: 0,
        nda_signed: 0,
        nda_signed_at: null,
        notes: body.notes || null,
        device_id: body.device_id || null,
        created_at: now,
      };

      await pool.query(`
        INSERT INTO visitors (id, org_id, first_name, last_name, email, phone, company, photo_url,
          host_name, host_email, purpose, visitor_type, status, qr_code, badge_printed,
          expected_arrival, checked_in_at, checked_out_at, nda_signed, nda_signed_at,
          notes, device_id, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      `, [
        visitor.id, visitor.org_id, visitor.first_name, visitor.last_name, visitor.email, visitor.phone,
        visitor.company, visitor.photo_url, visitor.host_name, visitor.host_email,
        visitor.purpose, visitor.visitor_type, 'checked_in', visitor.qr_code,
        visitor.badge_printed, null, now, null, visitor.nda_signed, visitor.nda_signed_at,
        visitor.notes, visitor.device_id, visitor.created_at,
      ]);

      visitor.status = 'checked_in';
      visitor.checked_in_at = now;
    } else {
      return reply.code(400).send({ error: 'Provide qr_code or first_name + last_name' });
    }

    // Check tenant-scoped watchlist
    const watchlistMatch = await checkWatchlistMatch(pool, orgId, visitor.first_name, visitor.last_name);

    // Update status to checked_in if pre-registered
    if (visitor.status !== 'checked_in') {
      await pool.query(
        'UPDATE visitors SET status = $1, checked_in_at = $2 WHERE id = $3 AND COALESCE(org_id, $4) = $4',
        ['checked_in', now, visitor.id, orgId]
      );
      visitor.status = 'checked_in';
      visitor.checked_in_at = now;
    }

    if (watchlistMatch.length > 0 && watchlistMatch.some((m: any) => m.list_type === 'block')) {
      await pool.query(
        'UPDATE visitors SET status = $1 WHERE id = $2 AND COALESCE(org_id, $3) = $3',
        ['denied', visitor.id, orgId]
      );
      visitor.status = 'denied';
      log.warn({ visitorId: visitor.id, orgId, matches: watchlistMatch.length }, 'Visitor check-in DENIED — watchlist block match');
      return reply.code(403).send({
        success: false,
        error: 'Visitor is on the block list',
        visitor,
        watchlist_matches: watchlistMatch,
      });
    }

    log.info({ visitorId: visitor.id, orgId, name: `${visitor.first_name} ${visitor.last_name}` }, 'Visitor checked in');

    return reply.send({
      success: true,
      visitor,
      watchlist_alert: watchlistMatch.length > 0 ? watchlistMatch : undefined,
    });
  });

  // POST /visitors/:id/check-out (tenant-scoped)
  fastify.post('/visitors/:id/check-out', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const now = new Date().toISOString();

    const { rows } = await pool.query(
      'SELECT * FROM visitors WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Visitor not found' });
    }

    await pool.query(
      'UPDATE visitors SET status = $1, checked_out_at = $2 WHERE id = $3 AND COALESCE(org_id, $4) = $4',
      ['checked_out', now, id, orgId]
    );

    const visitor = { ...rows[0], status: 'checked_out', checked_out_at: now };
    log.info({ visitorId: id, orgId }, 'Visitor checked out');

    return reply.send({ success: true, visitor });
  });

  // GET /visitors — List (tenant-scoped)
  fastify.get('/visitors', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const query = request.query as {
      status?: string; host?: string; since?: string; until?: string;
      limit?: string; offset?: string; search?: string;
    };

    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (query.status) {
      conditions.push(`status = $${idx++}`);
      params.push(query.status);
    }
    if (query.host) {
      conditions.push(`host_name ILIKE $${idx++}`);
      params.push(`%${query.host}%`);
    }
    if (query.since) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(query.since);
    }
    if (query.until) {
      conditions.push(`created_at <= $${idx++}`);
      params.push(query.until);
    }
    if (query.search) {
      conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR company ILIKE $${idx})`);
      params.push(`%${query.search}%`);
      idx++;
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10), 1), 500);
    const offset = Math.max(parseInt(query.offset || '0', 10), 0);

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM visitors ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    const dataResult = await pool.query(
      `SELECT * FROM visitors ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return reply.send({ visitors: dataResult.rows, total, limit, offset });
  });

  // GET /visitors/active (tenant-scoped)
  fastify.get('/visitors/active', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { rows } = await pool.query(
        "SELECT * FROM visitors WHERE COALESCE(org_id, $1) = $1 AND status = 'checked_in' ORDER BY checked_in_at DESC",
        [orgId]
      );
      return reply.send({ visitors: rows, total: rows.length });
    } catch { return reply.send({ visitors: [], total: 0 }); }
  });

  // GET /visitors/active/count (tenant-scoped)
  fastify.get('/visitors/active/count', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { rows } = await pool.query(
        "SELECT COUNT(*) as count FROM visitors WHERE COALESCE(org_id, $1) = $1 AND status = 'checked_in'",
        [orgId]
      );
      return reply.send({ count: parseInt(rows[0]?.count || '0', 10) });
    } catch { return reply.send({ count: 0 }); }
  });

  // GET /visitors/today/count (tenant-scoped)
  fastify.get('/visitors/today/count', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { rows } = await pool.query(
        "SELECT COUNT(*) as count FROM visitors WHERE COALESCE(org_id, $1) = $1 AND checked_in_at >= CURRENT_DATE::text",
        [orgId]
      );
      return reply.send({ count: parseInt(rows[0]?.count || '0', 10) });
    } catch { return reply.send({ count: 0 }); }
  });

  // GET /visitors/qr/:token — Validate QR code (tenant-scoped — kiosk must pass JWT)
  fastify.get('/visitors/qr/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { token } = request.params as { token: string };
    const { rows } = await pool.query(
      'SELECT * FROM visitors WHERE qr_code = $1 AND COALESCE(org_id, $2) = $2',
      [token, orgId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Invalid QR code', valid: false });
    }
    const visitor = rows[0];
    return reply.send({
      valid: true,
      visitor,
      can_check_in: visitor.status === 'pre_registered',
      already_checked_in: visitor.status === 'checked_in',
    });
  });

  // GET /visitors/:id (tenant-scoped)
  fastify.get('/visitors/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      'SELECT * FROM visitors WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Visitor not found' });
    }
    return reply.send({ visitor: rows[0] });
  });

  // POST /visitors/:id/sign-nda (tenant-scoped)
  fastify.post('/visitors/:id/sign-nda', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const now = new Date().toISOString();

    const res = await pool.query(
      'UPDATE visitors SET nda_signed = 1, nda_signed_at = $1 WHERE id = $2 AND COALESCE(org_id, $3) = $3',
      [now, id, orgId]
    );
    if ((res.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Visitor not found' });

    log.info({ visitorId: id, orgId }, 'NDA signed');
    return reply.send({ success: true, nda_signed_at: now });
  });

  // DELETE /visitors/:id (tenant-scoped)
  fastify.delete('/visitors/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const result = await pool.query(
      'DELETE FROM visitors WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if ((result.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Visitor not found' });
    }
    return reply.send({ success: true, deleted: id });
  });

  // POST /visitors/check-watchlist (tenant-scoped)
  fastify.post('/visitors/check-watchlist', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.first_name || !body?.last_name) {
      return reply.code(400).send({ error: 'first_name and last_name required' });
    }
    const matches = await checkWatchlistMatch(pool, orgId, body.first_name, body.last_name);
    return reply.send({ matches, total: matches.length });
  });

  // POST /visitors/:id/notify-host (tenant-scoped)
  fastify.post('/visitors/:id/notify-host', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      'SELECT * FROM visitors WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Visitor not found' });
    }

    const visitor = rows[0];
    log.info({
      visitorId: id, orgId,
      hostName: visitor.host_name,
      hostEmail: visitor.host_email,
      visitorName: `${visitor.first_name} ${visitor.last_name}`,
    }, 'Host notification sent (placeholder)');

    return reply.send({
      success: true,
      message: 'Host notification logged',
      host_name: visitor.host_name,
      host_email: visitor.host_email,
      visitor_name: `${visitor.first_name} ${visitor.last_name}`,
    });
  });

  // ─── Watchlist routes (tenant-scoped) ──────────────────────────

  fastify.get('/watchlist', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const query = request.query as { active?: string; list_type?: string };
    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (query.active !== undefined) {
      conditions.push(`active = $${idx++}`);
      params.push(query.active === 'true' || query.active === '1' ? 1 : 0);
    }
    if (query.list_type) {
      conditions.push(`list_type = $${idx++}`);
      params.push(query.list_type);
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const { rows } = await pool.query(`SELECT * FROM watchlist ${where} ORDER BY created_at DESC`, params);
    return reply.send({ entries: rows, total: rows.length });
  });

  fastify.post('/watchlist', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const body = request.body as any;
    if (!body?.first_name || !body?.last_name || !body?.reason) {
      return reply.code(400).send({ error: 'first_name, last_name, and reason are required' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await pool.query(`
      INSERT INTO watchlist (id, org_id, first_name, last_name, reason, list_type, added_by, photo_url, active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      id, orgId,
      body.first_name,
      body.last_name,
      body.reason,
      body.list_type || 'alert',
      body.added_by || 'admin',
      body.photo_url || null,
      body.active !== undefined ? (body.active ? 1 : 0) : 1,
      now,
    ]);

    log.info({ watchlistId: id, orgId, name: `${body.first_name} ${body.last_name}`, type: body.list_type }, 'Watchlist entry added');

    return reply.send({
      success: true,
      entry: {
        id, org_id: orgId, first_name: body.first_name, last_name: body.last_name,
        reason: body.reason, list_type: body.list_type || 'alert',
        added_by: body.added_by || 'admin', photo_url: body.photo_url || null,
        active: 1, created_at: now,
      },
    });
  });

  fastify.put('/watchlist/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const { rows } = await pool.query(
      'SELECT * FROM watchlist WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Watchlist entry not found' });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const fields = ['first_name', 'last_name', 'reason', 'list_type', 'added_by', 'photo_url', 'active'];
    for (const field of fields) {
      if (body[field] !== undefined) {
        const val = field === 'active' ? (body[field] ? 1 : 0) : body[field];
        updates.push(`${field} = $${idx++}`);
        params.push(val);
      }
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    params.push(id, orgId);
    await pool.query(
      `UPDATE watchlist SET ${updates.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
      params
    );

    const { rows: updated } = await pool.query(
      'SELECT * FROM watchlist WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    return reply.send({ success: true, entry: updated[0] });
  });

  fastify.delete('/watchlist/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { id } = request.params as { id: string };
    const result = await pool.query(
      'DELETE FROM watchlist WHERE id = $1 AND COALESCE(org_id, $2) = $2',
      [id, orgId]
    );
    if ((result.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Watchlist entry not found' });
    }
    return reply.send({ success: true, deleted: id });
  });

  // ─── Cross-Site Visitor History (tenant-scoped) ────────────────

  fastify.get('/visitors/cross-site/:email', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const { email } = request.params as { email: string };
    const { rows } = await pool.query(
      'SELECT * FROM visitors WHERE COALESCE(org_id, $1) = $1 AND LOWER(email) = LOWER($2) ORDER BY created_at DESC',
      [orgId, email]
    );
    return reply.send({ visits: rows, total: rows.length, email });
  });

  fastify.get('/visitors/frequent', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const query = request.query as { limit?: string; since?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || '20', 10), 1), 200);
    const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
    const params: any[] = [orgId];
    let idx = 2;

    if (query.since) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(query.since);
    }

    const where = 'WHERE ' + conditions.join(' AND ');
    const { rows } = await pool.query(`
      SELECT first_name, last_name, email, company, COUNT(*) as visit_count,
        MAX(created_at) as last_visit, MIN(created_at) as first_visit
      FROM visitors ${where}
      GROUP BY first_name, last_name, email, company
      ORDER BY visit_count DESC
      LIMIT $${idx}
    `, [...params, limit]);

    return reply.send({ visitors: rows, total: rows.length });
  });

  fastify.get('/visitors/analytics', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId(request);
    const today = new Date().toISOString().slice(0, 10);

    const [byDay, byPurpose, avgDuration, totalToday, totalWeek, peakHours] = await Promise.all([
      pool.query(`
        SELECT EXTRACT(DOW FROM created_at::TIMESTAMPTZ) as dow, COUNT(*) as count
        FROM visitors WHERE COALESCE(org_id, $1) = $1 AND created_at >= (NOW() - INTERVAL '30 days')::TEXT
        GROUP BY dow ORDER BY dow
      `, [orgId]),
      pool.query('SELECT purpose, COUNT(*) as count FROM visitors WHERE COALESCE(org_id, $1) = $1 GROUP BY purpose ORDER BY count DESC', [orgId]),
      pool.query(`
        SELECT AVG(
          EXTRACT(EPOCH FROM (checked_out_at::TIMESTAMPTZ - checked_in_at::TIMESTAMPTZ))
        ) as avg_seconds
        FROM visitors WHERE COALESCE(org_id, $1) = $1 AND checked_in_at IS NOT NULL AND checked_out_at IS NOT NULL
      `, [orgId]),
      pool.query('SELECT COUNT(*) as count FROM visitors WHERE COALESCE(org_id, $1) = $1 AND created_at >= $2', [orgId, today]),
      pool.query("SELECT COUNT(*) as count FROM visitors WHERE COALESCE(org_id, $1) = $1 AND created_at >= (NOW() - INTERVAL '7 days')::TEXT", [orgId]),
      pool.query(`
        SELECT EXTRACT(HOUR FROM checked_in_at::TIMESTAMPTZ) as hour, COUNT(*) as count
        FROM visitors WHERE COALESCE(org_id, $1) = $1 AND checked_in_at IS NOT NULL
        GROUP BY hour ORDER BY count DESC LIMIT 5
      `, [orgId]),
    ]);

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const volumeByDay = {};
    byDay.rows.forEach(r => { volumeByDay[dayNames[parseInt(r.dow)]] = parseInt(r.count); });

    const purposeBreakdown = {};
    byPurpose.rows.forEach(r => { purposeBreakdown[r.purpose] = parseInt(r.count); });

    const avgDurationMin = avgDuration.rows[0]?.avg_seconds
      ? Math.round(parseFloat(avgDuration.rows[0].avg_seconds) / 60)
      : null;

    return reply.send({
      today: parseInt(totalToday.rows[0].count),
      this_week: parseInt(totalWeek.rows[0].count),
      avg_duration_minutes: avgDurationMin,
      volume_by_day: volumeByDay,
      purpose_breakdown: purposeBreakdown,
      peak_hours: peakHours.rows.map(r => ({ hour: parseInt(r.hour), count: parseInt(r.count) })),
    });
  });
}

// ─── Helper: tenant-scoped watchlist check ─────────────────────

async function checkWatchlistMatch(pool: pg.Pool, orgId: string, firstName: string, lastName: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT * FROM watchlist WHERE COALESCE(org_id, $1) = $1 AND active = 1
     AND (LOWER(first_name) = LOWER($2) AND LOWER(last_name) = LOWER($3))`,
    [orgId, firstName, lastName]
  );
  return rows;
}

// ─── Table migration ───────────────────────────────────────────

async function ensureVisitorTables(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS visitors (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        company TEXT,
        photo_url TEXT,
        host_name TEXT NOT NULL,
        host_email TEXT,
        purpose TEXT NOT NULL DEFAULT 'meeting',
        visitor_type TEXT NOT NULL DEFAULT 'visitor',
        status TEXT NOT NULL DEFAULT 'pre_registered',
        qr_code TEXT UNIQUE NOT NULL,
        badge_printed INTEGER NOT NULL DEFAULT 0,
        expected_arrival TEXT,
        checked_in_at TEXT,
        checked_out_at TEXT,
        nda_signed INTEGER NOT NULL DEFAULT 0,
        nda_signed_at TEXT,
        notes TEXT,
        device_id TEXT,
        created_at TEXT NOT NULL DEFAULT NOW()::TEXT
      );
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS company TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS photo_url TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS host_name TEXT DEFAULT '';
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS host_email TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'meeting';
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS visitor_type TEXT NOT NULL DEFAULT 'visitor';
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pre_registered';
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS qr_code TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS badge_printed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS expected_arrival TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS checked_in_at TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS checked_out_at TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS nda_signed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS nda_signed_at TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE visitors ADD COLUMN IF NOT EXISTS device_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_visitors_status ON visitors (status);
      CREATE INDEX IF NOT EXISTS idx_visitors_qr ON visitors (qr_code);
      CREATE INDEX IF NOT EXISTS idx_visitors_host ON visitors (host_name);
      CREATE INDEX IF NOT EXISTS idx_visitors_created ON visitors (created_at DESC);

      CREATE TABLE IF NOT EXISTS watchlist (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        list_type TEXT NOT NULL DEFAULT 'alert',
        added_by TEXT NOT NULL,
        photo_url TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT NOW()::TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_watchlist_active ON watchlist (active);
      CREATE INDEX IF NOT EXISTS idx_watchlist_name ON watchlist (LOWER(first_name), LOWER(last_name));
    `);
    await ensureOrgColumn({ query: (sql, params) => client.query(sql, params) } as any, 'visitors', 'visitors');
    await ensureOrgColumn({ query: (sql, params) => client.query(sql, params) } as any, 'watchlist', 'watchlist');
    log.info('Visitor and watchlist tables ensured');
  } finally {
    client.release();
  }
}
