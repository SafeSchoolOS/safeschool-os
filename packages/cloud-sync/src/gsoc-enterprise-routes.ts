// @ts-nocheck
/**
 * GSOC Enterprise Routes
 *
 * SafeSchool-specific enterprise features for large-scale security operations:
 *   - Region grouping (sites organized by geographic region)
 *   - Video wall configurations per operator
 *   - Command hierarchy (escalation chains, operator roles)
 *   - Cross-site event aggregation with region filtering
 *
 * Mount behind JWT auth at prefix '/api/v1/gsoc'.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import pg from 'pg';

const log = createLogger('cloud-sync:gsoc-enterprise');

export interface GsocEnterpriseRoutesOptions {
  connectionString?: string;
  getOrgId?: (request: FastifyRequest) => string | undefined;
  getUserId?: (request: FastifyRequest) => string | undefined;
}

export async function gsocEnterpriseRoutes(fastify: FastifyInstance, opts: GsocEnterpriseRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — GSOC enterprise routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  const { getOrgId, getUserId } = opts;

  // ─── Ensure GSOC tables ─────────────────────────────────────────
  async function ensureGsocTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gsoc_regions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        parent_region_id TEXT REFERENCES gsoc_regions(id) ON DELETE SET NULL,
        color TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gsoc_region_sites (
        region_id TEXT NOT NULL REFERENCES gsoc_regions(id) ON DELETE CASCADE,
        site_id TEXT NOT NULL,
        PRIMARY KEY (region_id, site_id)
      );

      CREATE TABLE IF NOT EXISTS gsoc_video_wall_configs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        owner_user_id TEXT,
        layout JSONB NOT NULL DEFAULT '{"cols": 2, "rows": 2}',
        panels JSONB NOT NULL DEFAULT '[]',
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gsoc_escalation_chains (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        trigger_type TEXT NOT NULL DEFAULT 'alarm',
        trigger_severity TEXT DEFAULT 'high',
        steps JSONB NOT NULL DEFAULT '[]',
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gsoc_operator_roles (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_level TEXT NOT NULL DEFAULT 'operator',
        region_ids JSONB DEFAULT '[]',
        site_ids JSONB DEFAULT '[]',
        permissions JSONB DEFAULT '{}',
        shift_schedule JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (org_id, user_id)
      );
    `);
  }

  try {
    await ensureGsocTables();
  } catch (err) {
    log.warn({ err }, 'Failed to create GSOC tables (may already exist)');
  }

  // ═══════════════════════════════════════════════════════════════════
  //  REGION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /regions — List all regions (with hierarchy) ────────────
  fastify.get('/regions', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    try {
      const { rows: regions } = await pool.query(
        `SELECT r.*, array_agg(rs.site_id) FILTER (WHERE rs.site_id IS NOT NULL) as site_ids
         FROM gsoc_regions r
         LEFT JOIN gsoc_region_sites rs ON rs.region_id = r.id
         WHERE r.org_id = $1
         GROUP BY r.id
         ORDER BY r.sort_order, r.name`,
        [orgId],
      );

      // Build tree structure
      const regionMap = new Map(regions.map((r: any) => [r.id, { ...r, children: [] }]));
      const roots: any[] = [];
      for (const region of regionMap.values()) {
        if (region.parent_region_id && regionMap.has(region.parent_region_id)) {
          regionMap.get(region.parent_region_id).children.push(region);
        } else {
          roots.push(region);
        }
      }

      return reply.send({ regions: roots, total: regions.length });
    } catch (err) {
      log.error({ err }, 'Failed to list regions');
      return reply.code(500).send({ error: 'Failed to list regions' });
    }
  });

  // ─── POST /regions — Create a region ────────────────────────────
  fastify.post('/regions', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const body = request.body as {
      name: string; description?: string; parent_region_id?: string;
      color?: string; sort_order?: number; site_ids?: string[];
    };

    if (!body.name) return reply.code(400).send({ error: 'name is required' });

    const id = crypto.randomUUID();
    try {
      await pool.query(
        `INSERT INTO gsoc_regions (id, org_id, name, description, parent_region_id, color, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, orgId, body.name, body.description || null, body.parent_region_id || null,
         body.color || null, body.sort_order ?? 0],
      );

      // Link sites
      if (body.site_ids?.length) {
        for (const siteId of body.site_ids) {
          await pool.query(
            'INSERT INTO gsoc_region_sites (region_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, siteId],
          );
        }
      }

      log.info({ orgId, regionId: id, name: body.name }, 'Region created');
      return reply.code(201).send({ id, name: body.name });
    } catch (err) {
      log.error({ err }, 'Failed to create region');
      return reply.code(500).send({ error: 'Failed to create region' });
    }
  });

  // ─── PUT /regions/:id — Update a region ─────────────────────────
  fastify.put('/regions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    try {
      const existing = await pool.query('SELECT id FROM gsoc_regions WHERE id = $1 AND org_id = $2', [id, orgId]);
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Region not found' });

      const allowed = ['name', 'description', 'parent_region_id', 'color', 'sort_order'];
      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let idx = 1;
      for (const f of allowed) {
        if (body[f] !== undefined) { sets.push(`${f} = $${idx++}`); params.push(body[f]); }
      }
      params.push(id, orgId);
      await pool.query(`UPDATE gsoc_regions SET ${sets.join(', ')} WHERE id = $${idx++} AND org_id = $${idx}`, params);

      // Update site assignments if provided
      if (Array.isArray(body.site_ids)) {
        await pool.query('DELETE FROM gsoc_region_sites WHERE region_id = $1', [id]);
        for (const siteId of body.site_ids as string[]) {
          await pool.query(
            'INSERT INTO gsoc_region_sites (region_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, siteId],
          );
        }
      }

      return reply.send({ ok: true, id });
    } catch (err) {
      log.error({ err }, 'Failed to update region');
      return reply.code(500).send({ error: 'Failed to update region' });
    }
  });

  // ─── DELETE /regions/:id — Delete a region ──────────────────────
  fastify.delete('/regions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const { id } = request.params as { id: string };
    try {
      const result = await pool.query('DELETE FROM gsoc_regions WHERE id = $1 AND org_id = $2', [id, orgId]);
      if (result.rowCount === 0) return reply.code(404).send({ error: 'Region not found' });
      return reply.send({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete region');
      return reply.code(500).send({ error: 'Failed to delete region' });
    }
  });

  // ─── GET /regions/:id/events — Cross-site events for a region ──
  fastify.get('/regions/:id/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const { id } = request.params as { id: string };
    const q = request.query as Record<string, string>;
    const limit = Math.min(parseInt(q.limit || '100', 10), 500);
    const since = q.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    try {
      // Get all site IDs in this region (including child regions)
      const { rows: siteRows } = await pool.query(`
        WITH RECURSIVE region_tree AS (
          SELECT id FROM gsoc_regions WHERE id = $1 AND org_id = $2
          UNION ALL
          SELECT r.id FROM gsoc_regions r JOIN region_tree rt ON r.parent_region_id = rt.id
        )
        SELECT DISTINCT rs.site_id
        FROM gsoc_region_sites rs
        JOIN region_tree rt ON rs.region_id = rt.id
      `, [id, orgId]);

      if (siteRows.length === 0) return reply.send({ events: [], total: 0 });

      const siteIds = siteRows.map((r: any) => r.site_id);

      // Query events across all sites in the region
      const { rows } = await pool.query(`
        SELECT * FROM sync_entities
        WHERE site_id = ANY($1)
          AND entity_type IN ('access_event', 'video_event', 'fire_event', 'intrusion_event', 'intercom_event')
          AND updated_at >= $2
        ORDER BY updated_at DESC
        LIMIT $3
      `, [siteIds, since, limit]);

      return reply.send({ events: rows, total: rows.length, region_sites: siteIds.length });
    } catch (err) {
      log.error({ err }, 'Failed to query region events');
      return reply.code(500).send({ error: 'Failed to query region events' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  VIDEO WALL CONFIGURATIONS
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /video-walls — List video wall configs ─────────────────
  fastify.get('/video-walls', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    try {
      const userId = getUserId?.(request);
      // Show org-wide configs + user's personal configs
      const { rows } = await pool.query(
        `SELECT * FROM gsoc_video_wall_configs
         WHERE org_id = $1 AND (owner_user_id IS NULL OR owner_user_id = $2)
         ORDER BY is_default DESC, name`,
        [orgId, userId || ''],
      );
      return reply.send({ configs: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to list video wall configs');
      return reply.code(500).send({ error: 'Failed to list video wall configs' });
    }
  });

  // ─── POST /video-walls — Create a video wall config ─────────────
  fastify.post('/video-walls', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const body = request.body as {
      name: string; description?: string; layout?: { cols: number; rows: number };
      panels?: Array<{ position: number; type: string; source?: string; siteId?: string; cameraId?: string; label?: string }>;
      is_default?: boolean;
    };

    if (!body.name) return reply.code(400).send({ error: 'name is required' });

    const id = crypto.randomUUID();
    const userId = getUserId?.(request);

    try {
      await pool.query(
        `INSERT INTO gsoc_video_wall_configs (id, org_id, name, description, owner_user_id, layout, panels, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, orgId, body.name, body.description || null, userId || null,
         JSON.stringify(body.layout || { cols: 2, rows: 2 }),
         JSON.stringify(body.panels || []),
         body.is_default || false],
      );

      log.info({ orgId, configId: id, name: body.name }, 'Video wall config created');
      const { rows } = await pool.query('SELECT * FROM gsoc_video_wall_configs WHERE id = $1', [id]);
      return reply.code(201).send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to create video wall config');
      return reply.code(500).send({ error: 'Failed to create video wall config' });
    }
  });

  // ─── PUT /video-walls/:id — Update a video wall config ──────────
  fastify.put('/video-walls/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    try {
      const existing = await pool.query(
        'SELECT id FROM gsoc_video_wall_configs WHERE id = $1 AND org_id = $2', [id, orgId],
      );
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Config not found' });

      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let idx = 1;

      for (const field of ['name', 'description', 'is_default']) {
        if (body[field] !== undefined) { sets.push(`${field} = $${idx++}`); params.push(body[field]); }
      }
      if (body.layout) { sets.push(`layout = $${idx++}`); params.push(JSON.stringify(body.layout)); }
      if (body.panels) { sets.push(`panels = $${idx++}`); params.push(JSON.stringify(body.panels)); }

      params.push(id, orgId);
      await pool.query(
        `UPDATE gsoc_video_wall_configs SET ${sets.join(', ')} WHERE id = $${idx++} AND org_id = $${idx}`,
        params,
      );

      const { rows } = await pool.query('SELECT * FROM gsoc_video_wall_configs WHERE id = $1', [id]);
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to update video wall config');
      return reply.code(500).send({ error: 'Failed to update video wall config' });
    }
  });

  // ─── DELETE /video-walls/:id — Delete a video wall config ───────
  fastify.delete('/video-walls/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const { id } = request.params as { id: string };
    try {
      const result = await pool.query(
        'DELETE FROM gsoc_video_wall_configs WHERE id = $1 AND org_id = $2', [id, orgId],
      );
      if (result.rowCount === 0) return reply.code(404).send({ error: 'Config not found' });
      return reply.send({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete video wall config');
      return reply.code(500).send({ error: 'Failed to delete video wall config' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  ESCALATION CHAINS (Command Hierarchy)
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /escalation-chains — List escalation chains ────────────
  fastify.get('/escalation-chains', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    try {
      const { rows } = await pool.query(
        `SELECT * FROM gsoc_escalation_chains WHERE org_id = $1 ORDER BY name`,
        [orgId],
      );
      return reply.send({ chains: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to list escalation chains');
      return reply.code(500).send({ error: 'Failed to list escalation chains' });
    }
  });

  // ─── POST /escalation-chains — Create an escalation chain ──────
  fastify.post('/escalation-chains', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const body = request.body as {
      name: string; description?: string;
      trigger_type?: string; trigger_severity?: string;
      steps?: Array<{
        order: number;
        action: 'notify' | 'escalate' | 'auto_lockdown' | 'dispatch';
        target_user_id?: string;
        target_role?: string;
        delay_seconds?: number;
        notify_method?: 'email' | 'sms' | 'push' | 'in_app';
      }>;
      enabled?: boolean;
    };

    if (!body.name) return reply.code(400).send({ error: 'name is required' });

    const id = crypto.randomUUID();
    try {
      await pool.query(
        `INSERT INTO gsoc_escalation_chains (id, org_id, name, description, trigger_type, trigger_severity, steps, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, orgId, body.name, body.description || null,
         body.trigger_type || 'alarm', body.trigger_severity || 'high',
         JSON.stringify(body.steps || []), body.enabled !== false],
      );

      log.info({ orgId, chainId: id, name: body.name }, 'Escalation chain created');
      const { rows } = await pool.query('SELECT * FROM gsoc_escalation_chains WHERE id = $1', [id]);
      return reply.code(201).send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to create escalation chain');
      return reply.code(500).send({ error: 'Failed to create escalation chain' });
    }
  });

  // ─── PUT /escalation-chains/:id — Update an escalation chain ───
  fastify.put('/escalation-chains/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    try {
      const existing = await pool.query(
        'SELECT id FROM gsoc_escalation_chains WHERE id = $1 AND org_id = $2', [id, orgId],
      );
      if (existing.rows.length === 0) return reply.code(404).send({ error: 'Chain not found' });

      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let idx = 1;

      for (const field of ['name', 'description', 'trigger_type', 'trigger_severity', 'enabled']) {
        if (body[field] !== undefined) { sets.push(`${field} = $${idx++}`); params.push(body[field]); }
      }
      if (body.steps) { sets.push(`steps = $${idx++}`); params.push(JSON.stringify(body.steps)); }

      params.push(id, orgId);
      await pool.query(
        `UPDATE gsoc_escalation_chains SET ${sets.join(', ')} WHERE id = $${idx++} AND org_id = $${idx}`,
        params,
      );

      const { rows } = await pool.query('SELECT * FROM gsoc_escalation_chains WHERE id = $1', [id]);
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to update escalation chain');
      return reply.code(500).send({ error: 'Failed to update escalation chain' });
    }
  });

  // ─── DELETE /escalation-chains/:id ──────────────────────────────
  fastify.delete('/escalation-chains/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const { id } = request.params as { id: string };
    try {
      const result = await pool.query(
        'DELETE FROM gsoc_escalation_chains WHERE id = $1 AND org_id = $2', [id, orgId],
      );
      if (result.rowCount === 0) return reply.code(404).send({ error: 'Chain not found' });
      return reply.send({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete escalation chain');
      return reply.code(500).send({ error: 'Failed to delete escalation chain' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  OPERATOR ROLES & PERMISSIONS
  // ═══════════════════════════════════════════════════════════════════

  // ─── GET /operators — List operator assignments ─────────────────
  fastify.get('/operators', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    try {
      const { rows } = await pool.query(
        `SELECT o.*, u.email, u.display_name
         FROM gsoc_operator_roles o
         LEFT JOIN sync_users u ON u.id = o.user_id
         WHERE o.org_id = $1
         ORDER BY o.role_level, u.display_name`,
        [orgId],
      );
      return reply.send({ operators: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to list operators');
      return reply.code(500).send({ error: 'Failed to list operators' });
    }
  });

  // ─── POST /operators — Assign operator role ─────────────────────
  fastify.post('/operators', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const body = request.body as {
      user_id: string;
      role_level?: 'supervisor' | 'operator' | 'monitor' | 'dispatcher';
      region_ids?: string[];
      site_ids?: string[];
      permissions?: Record<string, boolean>;
      shift_schedule?: { timezone: string; shifts: Array<{ day: string; start: string; end: string }> };
    };

    if (!body.user_id) return reply.code(400).send({ error: 'user_id is required' });

    const id = crypto.randomUUID();
    try {
      await pool.query(
        `INSERT INTO gsoc_operator_roles (id, org_id, user_id, role_level, region_ids, site_ids, permissions, shift_schedule)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (org_id, user_id) DO UPDATE SET
           role_level = EXCLUDED.role_level,
           region_ids = EXCLUDED.region_ids,
           site_ids = EXCLUDED.site_ids,
           permissions = EXCLUDED.permissions,
           shift_schedule = EXCLUDED.shift_schedule,
           updated_at = NOW()`,
        [id, orgId, body.user_id, body.role_level || 'operator',
         JSON.stringify(body.region_ids || []),
         JSON.stringify(body.site_ids || []),
         JSON.stringify(body.permissions || {}),
         body.shift_schedule ? JSON.stringify(body.shift_schedule) : null],
      );

      log.info({ orgId, userId: body.user_id, role: body.role_level }, 'Operator role assigned');
      return reply.code(201).send({ ok: true, user_id: body.user_id, role_level: body.role_level || 'operator' });
    } catch (err) {
      log.error({ err }, 'Failed to assign operator role');
      return reply.code(500).send({ error: 'Failed to assign operator role' });
    }
  });

  // ─── DELETE /operators/:userId — Remove operator role ───────────
  fastify.delete('/operators/:userId', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    if (!orgId) return reply.code(401).send({ error: 'No account context' });

    const { userId } = request.params as { userId: string };
    try {
      const result = await pool.query(
        'DELETE FROM gsoc_operator_roles WHERE user_id = $1 AND org_id = $2', [userId, orgId],
      );
      if (result.rowCount === 0) return reply.code(404).send({ error: 'Operator not found' });
      return reply.send({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to remove operator role');
      return reply.code(500).send({ error: 'Failed to remove operator role' });
    }
  });

  // ─── GET /my-scope — Get current operator's visible scope ───────
  // Returns which regions/sites/cameras the logged-in operator can see
  fastify.get('/my-scope', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = getOrgId?.(request);
    const userId = getUserId?.(request);
    if (!orgId || !userId) return reply.code(401).send({ error: 'No auth context' });

    try {
      const { rows } = await pool.query(
        'SELECT * FROM gsoc_operator_roles WHERE org_id = $1 AND user_id = $2',
        [orgId, userId],
      );

      if (rows.length === 0) {
        // No operator role = full access (admin/owner)
        return reply.send({ scope: 'all', role_level: 'admin', regions: [], sites: [] });
      }

      const role = rows[0];
      const regionIds = typeof role.region_ids === 'string' ? JSON.parse(role.region_ids) : (role.region_ids || []);
      const siteIds = typeof role.site_ids === 'string' ? JSON.parse(role.site_ids) : (role.site_ids || []);

      // Resolve region IDs to site IDs
      let resolvedSiteIds = [...siteIds];
      if (regionIds.length > 0) {
        const { rows: regionSites } = await pool.query(
          'SELECT DISTINCT site_id FROM gsoc_region_sites WHERE region_id = ANY($1)',
          [regionIds],
        );
        for (const rs of regionSites) {
          if (!resolvedSiteIds.includes(rs.site_id)) resolvedSiteIds.push(rs.site_id);
        }
      }

      return reply.send({
        scope: resolvedSiteIds.length > 0 || regionIds.length > 0 ? 'limited' : 'all',
        role_level: role.role_level,
        regions: regionIds,
        sites: resolvedSiteIds,
        permissions: typeof role.permissions === 'string' ? JSON.parse(role.permissions) : (role.permissions || {}),
        shift_schedule: typeof role.shift_schedule === 'string' ? JSON.parse(role.shift_schedule) : role.shift_schedule,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get operator scope');
      return reply.code(500).send({ error: 'Failed to get operator scope' });
    }
  });

  log.info('GSOC enterprise routes registered');
}
