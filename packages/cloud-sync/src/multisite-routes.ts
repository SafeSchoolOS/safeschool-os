// @ts-nocheck
/**
 * Multi-Site Management Routes
 *
 * Aggregated views, map data, cross-site commands, and comparison
 * analytics for organizations managing multiple physical locations.
 *
 * Routes:
 *   GET  /multisite/overview       — Aggregated view of all sites
 *   GET  /multisite/sites/:siteId  — Detail view for a specific site
 *   GET  /multisite/map            — Map data with lat/lng for all sites
 *   POST /multisite/command        — Send command to specific site(s)
 *   GET  /multisite/commands       — List recent cross-site commands
 *   GET  /multisite/compare        — Compare metrics across sites
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import { getOrgId } from './route-helpers.js';
import pg from 'pg';

const log = createLogger('cloud-sync:multisite');

export interface MultisiteRoutesOptions {
  connectionString?: string;
}

const VALID_COMMANDS = ['lockdown', 'unlock', 'reboot', 'sync', 'test_alarm'] as const;
type SiteCommand = typeof VALID_COMMANDS[number];

function deriveSiteStatus(onlineCount: number, deviceCount: number): string {
  if (deviceCount === 0) return 'unknown';
  const ratio = onlineCount / deviceCount;
  if (ratio >= 0.9) return 'healthy';
  if (ratio >= 0.5) return 'degraded';
  return 'offline';
}

function parsePeriodMs(period: string): number {
  switch (period) {
    case '7d': return 7 * 86400000;
    case '30d': return 30 * 86400000;
    case '90d': return 90 * 86400000;
    default: return 30 * 86400000;
  }
}

export async function multisiteRoutes(fastify: FastifyInstance, opts: MultisiteRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — multisite routes disabled');
    return;
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 5,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // ─── GET /multisite/overview — Aggregated view of all sites (tenant-scoped) ────
  fastify.get('/multisite/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      // Devices grouped by site, filtered to this tenant only.
      let devicesResult;
      try {
        devicesResult = await pool.query(`
          SELECT
            COALESCE(site_id, 'default') as site_id,
            COALESCE(site_name, 'Default Site') as site_name,
            COUNT(*) as device_count,
            COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '10 minutes') as online_count,
            MAX(last_heartbeat_at) as last_event_at
          FROM sync_devices
          WHERE COALESCE(org_id, $1) = $1
          GROUP BY COALESCE(site_id, 'default'), COALESCE(site_name, 'Default Site')
          ORDER BY site_name
        `, [orgId]);
      } catch (err) {
        log.debug({ err }, 'sync_devices query failed (table may not exist or missing columns)');
        return reply.send({ sites: [], total_sites: 0, total_devices: 0, total_online: 0 });
      }

      const sites = [];
      let totalDevices = 0;
      let totalOnline = 0;

      for (const row of devicesResult.rows) {
        const deviceCount = parseInt(row.device_count || '0', 10);
        const onlineCount = parseInt(row.online_count || '0', 10);
        totalDevices += deviceCount;
        totalOnline += onlineCount;

        // Open incidents for this site (tenant-scoped)
        let openIncidents = 0;
        try {
          const incResult = await pool.query(
            `SELECT COUNT(*) as cnt FROM incidents WHERE site_id = $1 AND org_id = $2 AND status IN ('open', 'investigating')`,
            [row.site_id, orgId]
          );
          openIncidents = parseInt(incResult.rows[0]?.cnt || '0', 10);
        } catch (err) { log.debug({ err, siteId: row.site_id }, 'Failed to query open incidents for site (table may not exist)'); }

        // Pending alarms for this site (tenant-scoped)
        let pendingAlarms = 0;
        try {
          const alarmResult = await pool.query(
            `SELECT COUNT(*) as cnt FROM alarms WHERE site_id = $1 AND org_id = $2 AND acknowledged_at IS NULL`,
            [row.site_id, orgId]
          );
          pendingAlarms = parseInt(alarmResult.rows[0]?.cnt || '0', 10);
        } catch (err) { log.debug({ err, siteId: row.site_id }, 'Failed to query pending alarms for site (table may not exist)'); }

        sites.push({
          site_id: row.site_id,
          site_name: row.site_name,
          device_count: deviceCount,
          online_count: onlineCount,
          open_incidents: openIncidents,
          pending_alarms: pendingAlarms,
          last_event_at: row.last_event_at,
          status: deriveSiteStatus(onlineCount, deviceCount),
        });
      }

      return reply.send({
        sites,
        total_sites: sites.length,
        total_devices: totalDevices,
        total_online: totalOnline,
      });
    } catch (err) {
      log.error({ err }, 'Failed to fetch multisite overview');
      return reply.code(500).send({ error: 'Failed to fetch multisite overview' });
    }
  });

  // ─── GET /multisite/sites/:siteId — Detail view for a site (tenant-scoped) ────
  fastify.get('/multisite/sites/:siteId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const { siteId } = request.params as { siteId: string };

      // All devices at this site (tenant-scoped)
      const devicesResult = await pool.query(
        `SELECT * FROM sync_devices WHERE COALESCE(org_id, $1) = $1 AND COALESCE(site_id, 'default') = $2 ORDER BY device_name`,
        [orgId, siteId]
      );

      // Recent events for this site (tenant-scoped)
      let recentEvents: any[] = [];
      try {
        const eventsResult = await pool.query(
          `SELECT * FROM sync_entities
           WHERE COALESCE(org_id, $1) = $1 AND site_id = $2 AND entity_type IN ('access_event', 'event')
           ORDER BY updated_at DESC LIMIT 50`,
          [orgId, siteId]
        );
        recentEvents = eventsResult.rows;
      } catch (err) { log.debug({ err, siteId }, 'Failed to query recent events for site (sync_entities may not have site_id column)'); }

      // Open incidents (tenant-scoped)
      let openIncidents: any[] = [];
      try {
        const incResult = await pool.query(
          `SELECT * FROM incidents WHERE org_id = $1 AND site_id = $2 AND status IN ('open', 'investigating') ORDER BY created_at DESC`,
          [orgId, siteId]
        );
        openIncidents = incResult.rows;
      } catch (err) { log.debug({ err, siteId }, 'Failed to query open incidents for site detail (table may not exist)'); }

      // Alarm stats for the last 30 days (tenant-scoped)
      let alarmStats = { total: 0, pending: 0, acknowledged: 0 };
      try {
        const alarmResult = await pool.query(
          `SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE acknowledged_at IS NULL) as pending,
            COUNT(*) FILTER (WHERE acknowledged_at IS NOT NULL) as acknowledged
           FROM alarms WHERE org_id = $1 AND site_id = $2 AND created_at >= NOW() - INTERVAL '30 days'`,
          [orgId, siteId]
        );
        const r = alarmResult.rows[0];
        alarmStats = {
          total: parseInt(r?.total || '0', 10),
          pending: parseInt(r?.pending || '0', 10),
          acknowledged: parseInt(r?.acknowledged || '0', 10),
        };
      } catch (err) { log.debug({ err, siteId }, 'Failed to query alarm stats for site detail (table may not exist)'); }

      const deviceCount = devicesResult.rows.length;
      const onlineCount = devicesResult.rows.filter(
        (d: any) => d.last_heartbeat_at && new Date(d.last_heartbeat_at).getTime() > Date.now() - 600000
      ).length;

      return reply.send({
        site_id: siteId,
        devices: devicesResult.rows,
        device_count: deviceCount,
        online_count: onlineCount,
        status: deriveSiteStatus(onlineCount, deviceCount),
        recent_events: recentEvents,
        open_incidents: openIncidents,
        alarm_stats: alarmStats,
      });
    } catch (err) {
      log.error({ err }, 'Failed to fetch site detail');
      return reply.code(500).send({ error: 'Failed to fetch site detail' });
    }
  });

  // ─── GET /multisite/map — Map data for all sites (tenant-scoped) ──
  fastify.get('/multisite/map', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      // Pull site coordinates from sync_devices grouped by site (tenant-scoped)
      let sitesResult;
      try {
        sitesResult = await pool.query(`
        SELECT
          COALESCE(site_id, 'default') as site_id,
          COALESCE(site_name, 'Default Site') as name,
          AVG(CAST(NULLIF(lat, '') AS DOUBLE PRECISION)) as lat,
          AVG(CAST(NULLIF(lng, '') AS DOUBLE PRECISION)) as lng,
          COUNT(*) as device_count,
          COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '10 minutes') as online_count
        FROM sync_devices
        WHERE COALESCE(org_id, $1) = $1 AND lat IS NOT NULL AND lng IS NOT NULL
        GROUP BY COALESCE(site_id, 'default'), COALESCE(site_name, 'Default Site')
      `, [orgId]);
      } catch (err) {
        log.debug({ err }, 'sync_devices map query failed (table may not exist or missing columns)');
        return reply.send({ sites: [], bounds: { north: 50, south: 25, east: -65, west: -125 } });
      }

      const sites = [];
      let north = -90, south = 90, east = -180, west = 180;

      for (const row of sitesResult.rows) {
        const lat = parseFloat(row.lat);
        const lng = parseFloat(row.lng);
        if (isNaN(lat) || isNaN(lng)) continue;

        const deviceCount = parseInt(row.device_count || '0', 10);
        const onlineCount = parseInt(row.online_count || '0', 10);

        // Unacknowledged alarm count for this site (tenant-scoped)
        let alertCount = 0;
        try {
          const alertResult = await pool.query(
            `SELECT COUNT(*) as cnt FROM alarms WHERE org_id = $1 AND site_id = $2 AND acknowledged_at IS NULL`,
            [orgId, row.site_id]
          );
          alertCount = parseInt(alertResult.rows[0]?.cnt || '0', 10);
        } catch (err) { log.debug({ err, siteId: row.site_id }, 'Failed to query alarm count for site map (table may not exist)'); }

        if (lat > north) north = lat;
        if (lat < south) south = lat;
        if (lng > east) east = lng;
        if (lng < west) west = lng;

        sites.push({
          site_id: row.site_id,
          name: row.name,
          lat,
          lng,
          status: deriveSiteStatus(onlineCount, deviceCount),
          device_count: deviceCount,
          alert_count: alertCount,
        });
      }

      // Default bounds (continental US) when no sites have coordinates
      if (sites.length === 0) {
        north = 50; south = 25; east = -65; west = -125;
      }

      return reply.send({
        sites,
        bounds: { north, south, east, west },
      });
    } catch (err) {
      log.error({ err }, 'Failed to fetch map data');
      return reply.code(500).send({ error: 'Failed to fetch map data' });
    }
  });

  // ─── POST /multisite/command — Send command to site(s) (tenant-scoped) ──
  fastify.post('/multisite/command', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const body = request.body as { site_ids?: string[]; command?: string; params?: Record<string, any> };

      if (!body.site_ids || !Array.isArray(body.site_ids) || body.site_ids.length === 0) {
        return reply.code(400).send({ error: 'site_ids array is required' });
      }
      if (!body.command || !VALID_COMMANDS.includes(body.command as SiteCommand)) {
        return reply.code(400).send({ error: `command must be one of: ${VALID_COMMANDS.join(', ')}` });
      }

      const commandId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Ensure multisite_commands table exists with tenant scoping
      await pool.query(`
        CREATE TABLE IF NOT EXISTS multisite_commands (
          id TEXT PRIMARY KEY,
          org_id TEXT,
          command TEXT NOT NULL,
          site_ids JSONB NOT NULL,
          params JSONB,
          status TEXT NOT NULL DEFAULT 'queued',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await pool.query(`ALTER TABLE multisite_commands ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_multisite_commands_org ON multisite_commands (org_id)`).catch(() => {});

      await pool.query(
        `INSERT INTO multisite_commands (id, org_id, command, site_ids, params, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'queued', $6, $6)`,
        [commandId, orgId, body.command, JSON.stringify(body.site_ids), JSON.stringify(body.params || {}), now]
      );

      log.info({ commandId, orgId, command: body.command, sites: body.site_ids.length }, 'Multi-site command queued');

      return reply.code(201).send({
        command_id: commandId,
        sites_targeted: body.site_ids.length,
        status: 'queued',
      });
    } catch (err) {
      log.error({ err }, 'Failed to queue multisite command');
      return reply.code(500).send({ error: 'Failed to queue command' });
    }
  });

  // ─── GET /multisite/commands — List recent cross-site commands (tenant-scoped) ──
  fastify.get('/multisite/commands', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const limit = Math.min(Math.max(parseInt(q.limit || '50', 10), 1), 200);
      const status = q.status;

      const params: any[] = [orgId];
      let query = 'SELECT * FROM multisite_commands WHERE COALESCE(org_id, $1) = $1';

      if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
      }

      query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const { rows } = await pool.query(query, params);

      // Get total count (tenant-scoped)
      const totalParams: any[] = [orgId];
      let totalQuery = 'SELECT COUNT(*) as cnt FROM multisite_commands WHERE COALESCE(org_id, $1) = $1';
      if (status) {
        totalQuery += ` AND status = $${totalParams.length + 1}`;
        totalParams.push(status);
      }
      const totalResult = await pool.query(totalQuery, totalParams);
      const total = parseInt(totalResult.rows[0]?.cnt || '0', 10);

      return reply.send({
        commands: rows.map((r: any) => ({
          ...r,
          site_ids: typeof r.site_ids === 'string' ? JSON.parse(r.site_ids) : r.site_ids,
          params: typeof r.params === 'string' ? JSON.parse(r.params) : r.params,
        })),
        total,
      });
    } catch (err) {
      // Table may not exist yet
      return reply.send({ commands: [], total: 0 });
    }
  });

  // ─── GET /multisite/compare — Compare metrics across sites (tenant-scoped) ────
  fastify.get('/multisite/compare', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId(request);
      const q = request.query as Record<string, string>;
      const metric = q.metric || 'incidents';
      const period = q.period || '30d';
      const periodMs = parsePeriodMs(period);
      const since = new Date(Date.now() - periodMs).toISOString();

      // Get all distinct sites (tenant-scoped)
      const sitesResult = await pool.query(`
        SELECT DISTINCT
          COALESCE(site_id, 'default') as site_id,
          COALESCE(site_name, 'Default Site') as site_name
        FROM sync_devices
        WHERE COALESCE(org_id, $1) = $1
        ORDER BY site_name
      `, [orgId]);

      const comparison: Array<{
        site_id: string;
        site_name: string;
        value: number;
        detail: string;
      }> = [];

      for (const site of sitesResult.rows) {
        let value = 0;
        let detail = '';

        try {
          switch (metric) {
            case 'incidents': {
              const result = await pool.query(
                `SELECT COUNT(*) as cnt FROM incidents WHERE org_id = $1 AND site_id = $2 AND created_at >= $3`,
                [orgId, site.site_id, since]
              );
              value = parseInt(result.rows[0]?.cnt || '0', 10);
              detail = `${value} incidents in ${period}`;
              break;
            }
            case 'alarms': {
              const result = await pool.query(
                `SELECT COUNT(*) as cnt FROM alarms WHERE org_id = $1 AND site_id = $2 AND created_at >= $3`,
                [orgId, site.site_id, since]
              );
              value = parseInt(result.rows[0]?.cnt || '0', 10);
              detail = `${value} alarms in ${period}`;
              break;
            }
            case 'events': {
              const result = await pool.query(
                `SELECT COUNT(*) as cnt FROM sync_entities
                 WHERE COALESCE(org_id, $1) = $1 AND site_id = $2 AND entity_type IN ('access_event', 'event') AND updated_at >= $3`,
                [orgId, site.site_id, since]
              );
              value = parseInt(result.rows[0]?.cnt || '0', 10);
              detail = `${value} events in ${period}`;
              break;
            }
            case 'uptime': {
              const result = await pool.query(
                `SELECT COUNT(*) as total,
                   COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '10 minutes') as online
                 FROM sync_devices WHERE COALESCE(org_id, $1) = $1 AND COALESCE(site_id, 'default') = $2`,
                [orgId, site.site_id]
              );
              const total = parseInt(result.rows[0]?.total || '0', 10);
              const online = parseInt(result.rows[0]?.online || '0', 10);
              value = total > 0 ? Math.round((online / total) * 100) : 0;
              detail = `${online}/${total} devices online (${value}%)`;
              break;
            }
            default:
              detail = 'Unknown metric';
          }
        } catch {
          detail = 'Unable to calculate';
        }

        comparison.push({
          site_id: site.site_id,
          site_name: site.site_name,
          value,
          detail,
        });
      }

      // Sort by value descending
      comparison.sort((a, b) => b.value - a.value);

      return reply.send({
        metric,
        period,
        sites: comparison,
        total_sites: comparison.length,
      });
    } catch (err) {
      log.error({ err }, 'Failed to compare sites');
      return reply.code(500).send({ error: 'Failed to compare sites' });
    }
  });

  log.info('Multi-site command routes registered');
}
