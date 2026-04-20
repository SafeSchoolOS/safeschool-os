// @ts-nocheck
/**
 * Guard Tour Management Routes — tenant-scoped.
 * guard_tours, guard_checkpoints, guard_shifts all carry org_id.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getUser, getOrgId, ensureOrgColumn } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:guards');

export interface GuardRoutesOptions {
  connectionString?: string;
}

export async function guardRoutes(fastify: FastifyInstance, opts: GuardRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — guard routes disabled');
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
    await ensureOrgColumn(pool, 'guard_tours', 'guard_tours');
    await ensureOrgColumn(pool, 'guard_checkpoints', 'guard_checkpoints');
    await ensureOrgColumn(pool, 'guard_shifts', 'guard_shifts');
    tableMigrated = true;
  }

  // ─── Tour CRUD (tenant-scoped) ─────────────────────────────────

  fastify.post('/tours', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const id = body.id || crypto.randomUUID();
      const now = new Date().toISOString();
      const route = body.route || [];
      const checkpointsTotal = route.length;

      await pool.query(`
        INSERT INTO guard_tours (id, org_id, tour_name, description, route, frequency, assigned_guard, status,
          scheduled_start, checkpoints_total, checkpoints_completed, notes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `, [
        id, orgId,
        body.tour_name || 'Untitled Tour',
        body.description || null,
        JSON.stringify(route),
        body.frequency || 'per_shift',
        body.assigned_guard || null,
        'scheduled',
        body.scheduled_start || null,
        checkpointsTotal,
        0,
        body.notes || null,
        now,
      ]);

      for (let i = 0; i < route.length; i++) {
        const cp = route[i];
        const cpId = crypto.randomUUID();
        await pool.query(`
          INSERT INTO guard_checkpoints (id, org_id, tour_id, checkpoint_name, checkpoint_code, order_index,
            status, latitude, longitude, expected_scan_time, notes, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `, [
          cpId, orgId, id,
          cp.name || 'Checkpoint ' + (i + 1),
          cp.code || 'CP-' + String(i + 1).padStart(3, '0'),
          i,
          'pending',
          cp.latitude || null,
          cp.longitude || null,
          cp.expected_scan_time || null,
          cp.notes || null,
          now,
        ]);
      }

      log.info({ id, orgId, tour_name: body.tour_name, checkpoints: checkpointsTotal }, 'Tour created');
      return reply.code(201).send({ id, tour_name: body.tour_name, status: 'scheduled', checkpoints_total: checkpointsTotal });
    } catch (err) {
      log.error({ err }, 'Failed to create tour');
      return reply.code(500).send({ error: 'Failed to create tour' });
    }
  });

  fastify.get('/tours', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
      if (q.assigned_guard) { conditions.push(`assigned_guard = $${idx++}`); params.push(q.assigned_guard); }
      if (q.frequency) { conditions.push(`frequency = $${idx++}`); params.push(q.frequency); }
      if (q.since) { conditions.push(`created_at >= $${idx++}`); params.push(q.since); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);
      const offset = Math.max(parseInt(q.offset || '0', 10), 0);

      const countRes = await pool.query(`SELECT COUNT(*) as total FROM guard_tours ${where}`, params);
      const total = parseInt(countRes.rows[0].total, 10);

      const dataRes = await pool.query(
        `SELECT * FROM guard_tours ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return reply.send({ tours: dataRes.rows, total, limit, offset });
    } catch (err) {
      log.error({ err }, 'Failed to list tours');
      return reply.code(500).send({ error: 'Failed to list tours' });
    }
  });

  fastify.get('/tours/active', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { rows } = await pool.query(`
        SELECT t.*, json_agg(c.* ORDER BY c.order_index) as checkpoints
        FROM guard_tours t
        LEFT JOIN guard_checkpoints c ON c.tour_id = t.id
        WHERE COALESCE(t.org_id, $1) = $1 AND t.status = 'in_progress'
        GROUP BY t.id
        ORDER BY t.actual_start DESC
      `, [orgId]);
      return reply.send({ tours: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to get active tours');
      return reply.code(500).send({ error: 'Failed to get active tours' });
    }
  });

  fastify.get('/tours/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const todayRes = await pool.query(`
        SELECT COUNT(*) as count FROM guard_tours
        WHERE COALESCE(org_id, $1) = $1 AND status = 'completed' AND completed_at >= CURRENT_DATE
      `, [orgId]);
      const toursCompletedToday = parseInt(todayRes.rows[0]?.count || '0', 10);

      const hitRateRes = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE c.status = 'completed') as completed,
          COUNT(*) as total
        FROM guard_checkpoints c
        JOIN guard_tours t ON t.id = c.tour_id
        WHERE COALESCE(t.org_id, $1) = $1 AND t.created_at >= NOW() - INTERVAL '7 days'
      `, [orgId]);
      const hitCompleted = parseInt(hitRateRes.rows[0]?.completed || '0', 10);
      const hitTotal = parseInt(hitRateRes.rows[0]?.total || '0', 10);
      const checkpointHitRate = hitTotal > 0 ? Math.round((hitCompleted / hitTotal) * 100) : 100;

      const onDutyRes = await pool.query(`
        SELECT COUNT(*) as count FROM guard_shifts
        WHERE COALESCE(org_id, $1) = $1 AND status = 'active'
      `, [orgId]);
      const guardsOnDuty = parseInt(onDutyRes.rows[0]?.count || '0', 10);

      const durationRes = await pool.query(`
        SELECT AVG(duration_seconds) as avg_duration
        FROM guard_tours
        WHERE COALESCE(org_id, $1) = $1 AND status = 'completed'
          AND completed_at >= NOW() - INTERVAL '7 days'
          AND duration_seconds IS NOT NULL
      `, [orgId]);
      const avgDurationSeconds = Math.round(parseFloat(durationRes.rows[0]?.avg_duration || '0'));

      const missedRes = await pool.query(`
        SELECT COUNT(*) as count FROM guard_tours
        WHERE COALESCE(org_id, $1) = $1 AND status = 'missed' AND created_at >= NOW() - INTERVAL '7 days'
      `, [orgId]);
      const missedTours = parseInt(missedRes.rows[0]?.count || '0', 10);

      const activeRes = await pool.query(`
        SELECT COUNT(*) as count FROM guard_tours WHERE COALESCE(org_id, $1) = $1 AND status = 'in_progress'
      `, [orgId]);
      const activeTours = parseInt(activeRes.rows[0]?.count || '0', 10);

      const missedCpRes = await pool.query(`
        SELECT COUNT(*) as count FROM guard_checkpoints c
        JOIN guard_tours t ON t.id = c.tour_id
        WHERE COALESCE(t.org_id, $1) = $1 AND c.status = 'missed' AND t.created_at >= CURRENT_DATE
      `, [orgId]);
      const missedCheckpointsToday = parseInt(missedCpRes.rows[0]?.count || '0', 10);

      return reply.send({
        toursCompletedToday,
        checkpointHitRate,
        guardsOnDuty,
        avgDurationSeconds,
        missedTours,
        activeTours,
        missedCheckpointsToday,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get tour stats');
      return reply.code(500).send({ error: 'Failed to get tour stats' });
    }
  });

  fastify.get('/tours/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const tourRes = await pool.query('SELECT * FROM guard_tours WHERE id = $1 AND COALESCE(org_id, $2) = $2', [id, orgId]);
      if (tourRes.rows.length === 0) return reply.code(404).send({ error: 'Tour not found' });

      const cpRes = await pool.query(
        'SELECT * FROM guard_checkpoints WHERE tour_id = $1 ORDER BY order_index ASC', [id]
      );

      return reply.send({ ...tourRes.rows[0], checkpoints: cpRes.rows });
    } catch (err) {
      log.error({ err }, 'Failed to get tour');
      return reply.code(500).send({ error: 'Failed to get tour' });
    }
  });

  fastify.put('/tours/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;

      const fields: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (body.tour_name !== undefined) { fields.push(`tour_name = $${idx++}`); params.push(body.tour_name); }
      if (body.description !== undefined) { fields.push(`description = $${idx++}`); params.push(body.description); }
      if (body.frequency !== undefined) { fields.push(`frequency = $${idx++}`); params.push(body.frequency); }
      if (body.assigned_guard !== undefined) { fields.push(`assigned_guard = $${idx++}`); params.push(body.assigned_guard); }
      if (body.scheduled_start !== undefined) { fields.push(`scheduled_start = $${idx++}`); params.push(body.scheduled_start); }
      if (body.notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(body.notes); }

      if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });

      const { rowCount } = await pool.query(
        `UPDATE guard_tours SET ${fields.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
        [...params, id, orgId]
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Tour not found' });

      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to update tour');
      return reply.code(500).send({ error: 'Failed to update tour' });
    }
  });

  fastify.delete('/tours/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const tourCheck = await pool.query('SELECT id FROM guard_tours WHERE id = $1 AND COALESCE(org_id, $2) = $2', [id, orgId]);
      if (tourCheck.rows.length === 0) return reply.code(404).send({ error: 'Tour not found' });
      await pool.query('DELETE FROM guard_checkpoints WHERE tour_id = $1', [id]);
      await pool.query('DELETE FROM guard_tours WHERE id = $1 AND COALESCE(org_id, $2) = $2', [id, orgId]);
      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete tour');
      return reply.code(500).send({ error: 'Failed to delete tour' });
    }
  });

  // ─── Tour Lifecycle ─────────────────────────────────────────────

  fastify.post('/tours/:id/start', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const user = getUser(request);
      const now = new Date().toISOString();

      const { rowCount } = await pool.query(`
        UPDATE guard_tours SET status = 'in_progress', actual_start = $1
        WHERE id = $2 AND COALESCE(org_id, $3) = $3 AND status = 'scheduled'
      `, [now, id, orgId]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Tour not found or not in scheduled status' });

      log.info({ id, orgId, by: user.username }, 'Tour started');
      return reply.send({ success: true, status: 'in_progress', started_at: now });
    } catch (err) {
      log.error({ err }, 'Failed to start tour');
      return reply.code(500).send({ error: 'Failed to start tour' });
    }
  });

  fastify.post('/tours/:id/checkpoints/:checkpointId/scan', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id, checkpointId } = request.params as { id: string; checkpointId: string };
      const body = request.body as any;
      const user = getUser(request);
      const now = new Date().toISOString();

      // Verify tour belongs to caller's tenant
      const tourCheck = await pool.query('SELECT id FROM guard_tours WHERE id = $1 AND COALESCE(org_id, $2) = $2', [id, orgId]);
      if (tourCheck.rows.length === 0) return reply.code(404).send({ error: 'Tour not found' });

      const { rowCount } = await pool.query(`
        UPDATE guard_checkpoints SET
          scanned_at = $1,
          scanned_by = $2,
          status = 'completed',
          notes = COALESCE($3, notes),
          photo_url = COALESCE($4, photo_url)
        WHERE id = $5 AND tour_id = $6
      `, [
        now,
        body.scanned_by || user.username || user.sub || 'guard',
        body.notes || null,
        body.photo_url || null,
        checkpointId,
        id,
      ]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Checkpoint not found' });

      const countRes = await pool.query(
        `SELECT COUNT(*) as completed FROM guard_checkpoints WHERE tour_id = $1 AND status = 'completed'`,
        [id]
      );
      const completed = parseInt(countRes.rows[0].completed, 10);
      await pool.query(
        'UPDATE guard_tours SET checkpoints_completed = $1 WHERE id = $2',
        [completed, id]
      );

      log.info({ tourId: id, orgId, checkpointId, by: user.username }, 'Checkpoint scanned');
      return reply.send({ success: true, checkpoints_completed: completed, scanned_at: now });
    } catch (err) {
      log.error({ err }, 'Failed to scan checkpoint');
      return reply.code(500).send({ error: 'Failed to scan checkpoint' });
    }
  });

  fastify.post('/tours/:id/complete', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const user = getUser(request);
      const now = new Date().toISOString();

      const tourRes = await pool.query('SELECT * FROM guard_tours WHERE id = $1 AND COALESCE(org_id, $2) = $2', [id, orgId]);
      if (tourRes.rows.length === 0) return reply.code(404).send({ error: 'Tour not found' });
      const tour = tourRes.rows[0];

      if (tour.status !== 'in_progress') {
        return reply.code(400).send({ error: 'Tour is not in progress' });
      }

      const startTime = new Date(tour.actual_start).getTime();
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);

      await pool.query(
        `UPDATE guard_checkpoints SET status = 'missed' WHERE tour_id = $1 AND status = 'pending'`,
        [id]
      );

      const countRes = await pool.query(
        `SELECT COUNT(*) as completed FROM guard_checkpoints WHERE tour_id = $1 AND status = 'completed'`,
        [id]
      );
      const completedCount = parseInt(countRes.rows[0].completed, 10);
      const finalStatus = completedCount === tour.checkpoints_total ? 'completed' : 'partial';

      await pool.query(`
        UPDATE guard_tours SET
          status = $1,
          completed_at = $2,
          duration_seconds = $3,
          checkpoints_completed = $4,
          notes = COALESCE($5, notes)
        WHERE id = $6 AND COALESCE(org_id, $7) = $7
      `, [finalStatus, now, durationSeconds, completedCount, body.notes || null, id, orgId]);

      log.info({ id, orgId, status: finalStatus, duration: durationSeconds, by: user.username }, 'Tour completed');
      return reply.send({
        success: true,
        status: finalStatus,
        duration_seconds: durationSeconds,
        checkpoints_completed: completedCount,
        checkpoints_total: tour.checkpoints_total,
      });
    } catch (err) {
      log.error({ err }, 'Failed to complete tour');
      return reply.code(500).send({ error: 'Failed to complete tour' });
    }
  });

  // ─── Shift CRUD (tenant-scoped) ─────────────────────────────────

  fastify.post('/shifts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const body = request.body as any;
      const id = body.id || crypto.randomUUID();
      const now = new Date().toISOString();

      await pool.query(`
        INSERT INTO guard_shifts (id, org_id, guard_name, guard_id, shift_start, shift_end, status,
          post_location, notes, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [
        id, orgId,
        body.guard_name || 'Unknown Guard',
        body.guard_id || null,
        body.shift_start || now,
        body.shift_end || null,
        body.status || 'scheduled',
        body.post_location || null,
        body.notes || null,
        now,
      ]);

      log.info({ id, orgId, guard: body.guard_name }, 'Shift created');
      return reply.code(201).send({ id, guard_name: body.guard_name, status: body.status || 'scheduled' });
    } catch (err) {
      log.error({ err }, 'Failed to create shift');
      return reply.code(500).send({ error: 'Failed to create shift' });
    }
  });

  fastify.get('/shifts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const conditions: string[] = ['COALESCE(org_id, $1) = $1'];
      const params: any[] = [orgId];
      let idx = 2;

      if (q.status) { conditions.push(`status = $${idx++}`); params.push(q.status); }
      if (q.guard_name) { conditions.push(`guard_name ILIKE $${idx++}`); params.push('%' + q.guard_name + '%'); }
      if (q.since) { conditions.push(`shift_start >= $${idx++}`); params.push(q.since); }

      const where = 'WHERE ' + conditions.join(' AND ');
      const limit = Math.min(Math.max(parseInt(q.limit || '100', 10), 1), 500);
      const offset = Math.max(parseInt(q.offset || '0', 10), 0);

      const countRes = await pool.query(`SELECT COUNT(*) as total FROM guard_shifts ${where}`, params);
      const total = parseInt(countRes.rows[0].total, 10);

      const dataRes = await pool.query(
        `SELECT * FROM guard_shifts ${where} ORDER BY shift_start DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return reply.send({ shifts: dataRes.rows, total, limit, offset });
    } catch (err) {
      log.error({ err }, 'Failed to list shifts');
      return reply.code(500).send({ error: 'Failed to list shifts' });
    }
  });

  fastify.put('/shifts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;

      const fields: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (body.guard_name !== undefined) { fields.push(`guard_name = $${idx++}`); params.push(body.guard_name); }
      if (body.guard_id !== undefined) { fields.push(`guard_id = $${idx++}`); params.push(body.guard_id); }
      if (body.shift_start !== undefined) { fields.push(`shift_start = $${idx++}`); params.push(body.shift_start); }
      if (body.shift_end !== undefined) { fields.push(`shift_end = $${idx++}`); params.push(body.shift_end); }
      if (body.status !== undefined) { fields.push(`status = $${idx++}`); params.push(body.status); }
      if (body.post_location !== undefined) { fields.push(`post_location = $${idx++}`); params.push(body.post_location); }
      if (body.notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(body.notes); }

      if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });

      const { rowCount } = await pool.query(
        `UPDATE guard_shifts SET ${fields.join(', ')} WHERE id = $${idx} AND COALESCE(org_id, $${idx + 1}) = $${idx + 1}`,
        [...params, id, orgId]
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Shift not found' });

      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to update shift');
      return reply.code(500).send({ error: 'Failed to update shift' });
    }
  });

  fastify.delete('/shifts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const { rowCount } = await pool.query(
        'DELETE FROM guard_shifts WHERE id = $1 AND COALESCE(org_id, $2) = $2',
        [id, orgId]
      );
      if (rowCount === 0) return reply.code(404).send({ error: 'Shift not found' });
      return reply.send({ success: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete shift');
      return reply.code(500).send({ error: 'Failed to delete shift' });
    }
  });

  // ─── Guard Status & Dispatch (tenant-scoped) ────────────────────

  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { rows } = await pool.query(`
        SELECT
          s.id as shift_id,
          s.guard_name,
          s.guard_id,
          s.status as shift_status,
          s.post_location,
          s.shift_start,
          s.shift_end,
          s.notes,
          t.id as active_tour_id,
          t.tour_name as active_tour_name,
          t.checkpoints_completed,
          t.checkpoints_total
        FROM guard_shifts s
        LEFT JOIN guard_tours t ON t.assigned_guard = s.guard_name AND t.status = 'in_progress' AND COALESCE(t.org_id, $1) = $1
        WHERE COALESCE(s.org_id, $1) = $1 AND s.status = 'active'
        ORDER BY s.guard_name
      `, [orgId]);

      return reply.send({ guards: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to get guard status');
      return reply.code(500).send({ error: 'Failed to get guard status' });
    }
  });

  fastify.post('/:id/dispatch', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await ensureTable();
      const orgId = getOrgId(request);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const user = getUser(request);

      const { rowCount } = await pool.query(`
        UPDATE guard_shifts SET
          post_location = $1,
          notes = COALESCE(notes, '') || E'\n[Dispatched: ' || $2 || ' by ' || $3 || ']'
        WHERE id = $4 AND COALESCE(org_id, $5) = $5 AND status = 'active'
      `, [
        body.location || body.post_location,
        body.reason || 'Dispatch',
        user.username || user.sub || 'operator',
        id,
        orgId,
      ]);
      if (rowCount === 0) return reply.code(404).send({ error: 'Active shift not found' });

      log.info({ shiftId: id, orgId, location: body.location, by: user.username }, 'Guard dispatched');
      return reply.send({ success: true, dispatched_to: body.location || body.post_location });
    } catch (err) {
      log.error({ err }, 'Failed to dispatch guard');
      return reply.code(500).send({ error: 'Failed to dispatch guard' });
    }
  });
}
