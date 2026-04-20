// @ts-nocheck
/**
 * Entity Query Routes
 *
 * Fastify plugin providing the primary REST API for the cloud dashboard to query
 * and mutate synced entity data. This is the largest route file in the system (~50+
 * endpoints) covering: events, cameras, doors, cardholders, credentials, connectors,
 * alerts, emergencies, incidents, threats, detector events, lockdown (Alyssa's Law
 * compliant), anti-passback zones, access schedules, access levels, and timezone
 * settings.
 *
 * Data flow:
 *   Edge device -> sync-engine -> sync_entities table (or access_events table)
 *   Dashboard -> this file -> adapter.queryEntities() -> sync_entities / access_events
 *
 * Most read endpoints query the SyncDatabaseAdapter (which abstracts Postgres or
 * SQLite). Write endpoints use adapter.processPush() to create sync operations that
 * will propagate back to edge devices. Some endpoints (events, schedules, access
 * levels, timezone) query Postgres directly via pg.Pool for performance or because
 * they use dedicated tables outside the sync_entities abstraction.
 *
 * Mount behind JWT auth at prefix '/api/v1/data'.
 *
 * @module entity-routes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import crypto from 'node:crypto';
import pg from 'pg';
import type { SyncDatabaseAdapter } from './types.js';
import type { RealtimeChannel, RealtimeCommand } from './realtime-channel.js';

const log = createLogger('cloud-sync:entity-routes');

/**
 * All event entity types synced from edge modules.
 * Used as the entityType filter when querying unified event streams.
 * Each type corresponds to a different connector category on the edge device:
 * - access_event: door/reader badge swipes, granted/denied
 * - video_event: camera motion, analytics triggers
 * - fire_event: fire alarm panel activations
 * - intrusion_event: intrusion panel zone alerts
 * - intercom_event: intercom call/answer/deny events
 */
const EVENT_TYPES = ['access_event', 'video_event', 'fire_event', 'intrusion_event', 'intercom_event'];

/**
 * Camera-related entity types for querying camera inventory and live status.
 * 'camera_status' is pushed periodically by edge connectors; 'camera' is the
 * static configuration record synced from the PAC system.
 */
const CAMERA_TYPES = ['camera_status', 'camera'];

/**
 * Door/reader status entity types. These are real-time status updates pushed
 * from edge PAC connectors indicating lock state, alarm conditions, etc.
 */
const DOOR_TYPES = ['door_status'];

/**
 * Configuration options for the entity routes plugin.
 *
 * @property adapter - The database adapter (Postgres or SQLite) used for all entity queries
 * @property getOrgId - Optional function to extract the org_id from a JWT-authenticated request,
 *   enabling multi-tenant data isolation
 * @property realtimeChannel - Direct reference to the WebSocket realtime channel for
 *   sending commands (lockdown, door control) to edge devices
 * @property getRealtimeChannel - Lazy getter for the realtime channel, used when the channel
 *   is initialized after route registration (deferred init pattern)
 */
export interface EntityRoutesOptions {
  adapter: SyncDatabaseAdapter;
  getOrgId?: (request: FastifyRequest) => string | undefined;
  /** Realtime channel for dispatching commands to edge devices (or lazy getter) */
  realtimeChannel?: RealtimeChannel;
  getRealtimeChannel?: () => RealtimeChannel | undefined;
}

/**
 * Fastify plugin that registers all entity data routes.
 *
 * Registered at prefix '/api/v1/data' by the runtime API server. All routes
 * are org-scoped when a getOrgId function is provided (multi-tenant mode).
 *
 * Route categories:
 * - **Events**: GET /events, /events/recent, /events/failed, /events/stats
 * - **Cameras**: GET /cameras, GET /cameras/:cameraId
 * - **Connectors**: GET /connectors, GET /connectors/capabilities, POST /connectors/command
 * - **Alerts**: GET /alerts, POST /alerts/:alertId/acknowledge, POST /alerts/:alertId/resolve
 * - **Emergencies**: GET /emergencies (lockdown/emergency_alert entities)
 * - **Incidents**: GET /incidents
 * - **Threats**: GET /threats (analytics entities)
 * - **Detector Events**: GET /detector-events (fire/intrusion/intercom)
 * - **Cardholders**: CRUD at /cardholders, plus /cardholders/:id/credentials
 * - **Credentials**: CRUD at /credentials, plus /credentials/:id/state, /credentials/generate-pin
 * - **Anti-Passback**: /apb/config, /apb/zones CRUD
 * - **Doors**: GET /doors, POST /doors/:doorId/lock, POST /doors/:doorId/unlock
 * - **Lockdown**: POST /lockdown, POST /lockdown/end, GET /lockdown/status
 * - **Catch-all**: GET /entities/:entityType
 * - **Schedules**: CRUD at /schedules (direct Postgres)
 * - **Access Levels**: CRUD at /access-levels (direct Postgres)
 * - **Timezone**: GET/PUT /settings/timezone (direct Postgres)
 *
 * @param fastify - The Fastify instance to register routes on
 * @param options - Plugin configuration (adapter, org resolution, realtime channel)
 */
export async function entityRoutes(fastify: FastifyInstance, options: EntityRoutesOptions) {
  const { adapter, getOrgId } = options;
  // Support both direct reference and lazy getter (for deferred init)
  const getRtChannel = () => options.realtimeChannel || options.getRealtimeChannel?.();

  // ─── Helpers: query access_events table directly ───────────────

  /**
   * Creates a short-lived Postgres connection pool for querying the access_events
   * table directly. Returns null if DATABASE_URL is not configured (e.g., SQLite mode).
   * The pool is configured with max 2 connections and auto-detects Railway SSL requirements.
   *
   * @returns A pg.Pool instance or null if no DATABASE_URL is set
   */
  function makeEventsPool() {
    const connStr = process.env.DATABASE_URL;
    if (!connStr) return null;
    return new pg.Pool({ connectionString: connStr, max: 2, ssl: connStr.includes('railway.app') ? { rejectUnauthorized: false } : undefined });
  }

  /**
   * Queries the access_events Postgres table directly, bypassing the sync_entities
   * abstraction. This is the preferred path for event queries because access_events
   * has proper indexes and is populated by the PAC emulator and demo seed data.
   *
   * The function builds a parameterized SQL query dynamically based on the provided
   * filter options, executes both a COUNT and a SELECT, then maps snake_case DB columns
   * to the camelCase format expected by the dashboard UI.
   *
   * Severity is computed on the fly:
   * - 'medium' for denied events
   * - 'high' for forced/held/alarm/tailgate events
   * - 'low' for granted events
   *
   * @param opts - Query options (limit, offset, date range, denied filter, etc.)
   * @returns Object with { events, total, limit, offset } or null if no DB connection
   */
  async function queryAccessEvents(opts: { limit?: number; offset?: number; since?: string; until?: string; denied?: boolean; eventType?: string; sortOrder?: 'asc' | 'desc'; orgId?: string; siteId?: string }) {
    const pool = makeEventsPool();
    if (!pool) return null;
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      // Build parameterized WHERE clause dynamically. Each filter increments
      // the parameter index ($1, $2, ...) to prevent SQL injection.
      let idx = 1;
      if (opts.orgId) { conditions.push(`org_id = $${idx++}`); params.push(opts.orgId); }
      if (opts.siteId) { conditions.push(`site_id = $${idx++}`); params.push(opts.siteId); }
      if (opts.since) { conditions.push(`timestamp >= $${idx++}`); params.push(opts.since); }
      if (opts.until) { conditions.push(`timestamp <= $${idx++}`); params.push(opts.until); }
      // Denied filter matches both result='denied' and event_type containing 'denied'
      // because different PAC systems use different conventions for denial events
      if (opts.denied) { conditions.push(`(result = 'denied' OR event_type LIKE '%denied%')`); }
      if (opts.eventType) { conditions.push(`event_type = $${idx++}`); params.push(opts.eventType); }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      const order = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
      const limit = opts.limit || 100;
      const offset = opts.offset || 0;
      // Two queries: COUNT for pagination total, then SELECT for the page of results.
      // LIMIT/OFFSET are appended as additional parameters after the WHERE params.
      const countRes = await pool.query(`SELECT COUNT(*) as total FROM access_events ${where}`, params);
      const total = parseInt(countRes.rows[0]?.total || '0', 10);
      const { rows } = await pool.query(
        `SELECT * FROM access_events ${where} ORDER BY timestamp ${order} LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );
      // Map snake_case DB columns to camelCase expected by the dashboard UI.
      // Several fields are duplicated under alternative names (e.g., eventType/type,
      // userName/user, doorName/door) because different dashboard components use
      // different property names historically.
      const events = rows.map((r: any) => ({
        id: r.id,
        eventType: r.event_type,
        type: r.event_type,
        timestamp: r.timestamp,
        _syncTimestamp: r.timestamp,
        userName: r.cardholder_name,
        user: r.cardholder_name,
        userId: r.cardholder_id,
        doorName: r.door_name,
        door: r.door_name,
        doorId: r.door_id,
        location: r.location,
        building: r.building,
        floor: r.floor,
        zone: r.zone,
        result: r.result,
        // Normalize PAC-vendor-specific result strings to a boolean
        accessGranted: r.result === 'access_granted' || r.result === 'granted',
        source: r.source_system,
        connectorType: r.source_system,
        credentialType: r.credential_type,
        readerName: r.reader_name,
        // Compute severity from event result/type for dashboard color coding:
        //   denied => medium (yellow), forced/held/alarm/tailgate => high (red),
        //   granted => low (green), unknown => undefined (no badge)
        severity: r.result === 'access_denied' || r.result === 'denied' ? 'medium'
          : /forced|held|alarm|tailgat/i.test(r.event_type) ? 'high'
          : r.result === 'access_granted' ? 'low' : undefined,
        // metadata may be stored as a JSON string or already parsed JSONB
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : r.metadata,
      }));
      return { events, total, limit, offset };
    } catch (err) {
      log.error({ err }, 'Failed to query access_events directly');
      return null;
    } finally {
      await pool.end();
    }
  }

  // ─── Stub endpoints for dashboard cards ────────────────────────

  /**
   * GET /doors/health
   *
   * Returns door fleet health summary for the dashboard overview card.
   * Counts online vs offline doors and computes a percentage health score.
   *
   * @query siteId - Optional site filter
   * @returns { online: number, offline: number, total: number, healthScore: number }
   */
  fastify.get('/doors/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const result = await adapter.queryEntities({ entityType: ['door'], orgId, limit: 500 });
      const doors = result?.entities || [];
      const online = doors.filter((d: any) => (d.data?.status || 'LOCKED') !== 'OFFLINE').length;
      const offline = doors.length - online;
      return reply.send({ online, offline, total: doors.length, healthScore: doors.length > 0 ? Math.round((online / doors.length) * 100) : 100 });
    } catch { return reply.send({ online: 0, offline: 0, total: 0, healthScore: 100 }); }
  });

  /**
   * GET /compliance/score
   *
   * Returns a compliance score for the dashboard overview card.
   * Currently returns stub data. In production, this would be computed from
   * door health percentage, audit trail completeness, access policy coverage,
   * and visitor management compliance.
   *
   * @returns { score: number, grade: string, areas: Record<string, number> }
   */
  fastify.get('/compliance/score', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Stub compliance score — computed from door health + audit trail + access policy coverage
    return reply.send({ score: 94, grade: 'A', areas: { accessControl: 96, auditTrail: 92, doorHealth: 95, visitorMgmt: 93 } });
  });

  // ─── GET /events ──────────────────────────────────────────────

  /**
   * GET /events
   *
   * Primary event listing endpoint. Tries the direct access_events Postgres table
   * first (fastest path, populated by PAC emulator + demo seed). Falls back to
   * sync_entities if the direct table is empty or unavailable.
   *
   * @query limit - Max results (default: 100)
   * @query offset - Pagination offset (default: 0)
   * @query sortOrder - 'asc' | 'desc' (default: 'desc')
   * @query since - ISO timestamp lower bound
   * @query until - ISO timestamp upper bound
   * @query eventType - Filter by specific event type
   * @query siteId - Filter by site
   * @query severity - Filter by severity level
   * @query accessGranted - Filter by grant/deny status
   * @query userId - Filter by cardholder ID
   * @query sortBy - Sort field (default: '_syncTimestamp')
   * @returns { events: Event[], total: number, limit: number, offset: number }
   */
  fastify.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as Record<string, string>;
      const limit = q.limit ? parseInt(q.limit, 10) : 100;
      const offset = q.offset ? parseInt(q.offset, 10) : 0;
      const order = (q.sortOrder as 'asc' | 'desc') || 'desc';
      // Try direct access_events table first (PAC emulator + demo seed data)
      const orgId = getOrgId?.(request);
      const direct = await queryAccessEvents({ limit, offset, since: q.since, until: q.until, eventType: q.eventType, sortOrder: order, orgId, siteId: q.siteId });
      if (direct && direct.total > 0) {
        return reply.send(direct);
      }
      // Fallback to sync_entities
      const result = await adapter.queryEntities({
        entityType: EVENT_TYPES,
        orgId,
        siteId: q.siteId,
        since: q.since ? new Date(q.since) : undefined,
        until: q.until ? new Date(q.until) : undefined,
        limit,
        offset,
        filters: buildFilters(q, ['eventType', 'severity', 'accessGranted', 'userId']),
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: order,
      });
      return reply.send({ events: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query events');
      return reply.code(500).send({ error: 'Failed to query events' });
    }
  });

  // ─── GET /events/recent ───────────────────────────────────────

  /**
   * GET /events/recent
   *
   * Returns the most recent events, sorted descending by timestamp.
   * Convenience endpoint for the dashboard live-feed widget.
   * Same dual-path strategy as GET /events (direct table first, then sync_entities).
   *
   * @query limit - Max results (default: 50)
   * @query siteId - Filter by site
   * @returns { events: Event[], total: number }
   */
  fastify.get('/events/recent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as Record<string, string>;
      const limit = q.limit ? parseInt(q.limit, 10) : 50;
      const orgId = getOrgId?.(request);
      const direct = await queryAccessEvents({ limit, offset: 0, sortOrder: 'desc', orgId, siteId: q.siteId });
      if (direct && direct.total > 0) {
        return reply.send(direct);
      }
      const result = await adapter.queryEntities({
        entityType: EVENT_TYPES,
        orgId,
        siteId: q.siteId,
        limit,
        offset: 0,
        sortBy: '_syncTimestamp',
        sortOrder: 'desc',
      });
      return reply.send({ events: result.entities, total: result.total });
    } catch (err) {
      log.error({ err }, 'Failed to query recent events');
      return reply.code(500).send({ error: 'Failed to query recent events' });
    }
  });

  // ─── GET /events/failed ───────────────────────────────────────

  /**
   * GET /events/failed
   *
   * Returns only denied/failed access events. Used by the "Access Denied" dashboard
   * panel. Queries direct access_events table with denied filter first, falls back
   * to sync_entities with accessGranted=false filter.
   *
   * @query limit - Max results (default: 100)
   * @query offset - Pagination offset (default: 0)
   * @query siteId - Filter by site
   * @returns { events: Event[], total: number, limit: number, offset: number }
   */
  fastify.get('/events/failed', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as Record<string, string>;
      const limit = q.limit ? parseInt(q.limit, 10) : 100;
      const offset = q.offset ? parseInt(q.offset, 10) : 0;
      const orgId = getOrgId?.(request);
      const direct = await queryAccessEvents({ limit, offset, denied: true, sortOrder: 'desc', orgId, siteId: q.siteId });
      if (direct && direct.total > 0) {
        return reply.send(direct);
      }
      const result = await adapter.queryEntities({
        entityType: EVENT_TYPES,
        orgId,
        siteId: q.siteId,
        limit,
        offset,
        filters: { accessGranted: false },
        sortBy: '_syncTimestamp',
        sortOrder: 'desc',
      });
      return reply.send({ events: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query failed events');
      return reply.code(500).send({ error: 'Failed to query failed events' });
    }
  });

  // ─── GET /events/stats ────────────────────────────────────────

  /**
   * GET /events/stats
   *
   * Computes aggregate event statistics for the last 24 hours. Used by the
   * dashboard summary cards (total events, granted, denied, active alerts,
   * events by source connector).
   *
   * Tries direct Postgres query first (fast aggregation via SQL COUNT/GROUP BY),
   * then falls back to in-memory aggregation over sync_entities.
   *
   * @query siteId - Filter by site
   * @returns { total: number, granted: number, denied: number, activeAlerts: number, bySource: Record<string, number> }
   */
  fastify.get('/events/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const pool = makeEventsPool();
      if (pool) {
        try {
          const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const totalRes = await pool.query(`SELECT COUNT(*) as total FROM access_events WHERE timestamp >= $1`, [since24h]);
          const grantedRes = await pool.query(`SELECT COUNT(*) as c FROM access_events WHERE timestamp >= $1 AND result = 'granted'`, [since24h]);
          const deniedRes = await pool.query(`SELECT COUNT(*) as c FROM access_events WHERE timestamp >= $1 AND (result = 'denied' OR event_type LIKE '%denied%')`, [since24h]);
          const srcRes = await pool.query(`SELECT COALESCE(source_system, 'connector') as src, COUNT(*) as c FROM access_events WHERE timestamp >= $1 GROUP BY src`, [since24h]);
          const bySource: Record<string, number> = {};
          for (const r of srcRes.rows) bySource[r.src] = parseInt(r.c, 10);
          const total = parseInt(totalRes.rows[0]?.total || '0', 10);
          if (total > 0) {
            await pool.end();
            return reply.send({
              total,
              granted: parseInt(grantedRes.rows[0]?.c || '0', 10),
              denied: parseInt(deniedRes.rows[0]?.c || '0', 10),
              activeAlerts: 0,
              bySource,
            });
          }
        } finally { await pool.end(); }
      }

      // Fallback to sync_entities
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const allEvents = await adapter.queryEntities({
        entityType: EVENT_TYPES,
        orgId,
        siteId: q.siteId,
        since: since24h,
        limit: 10000,
        offset: 0,
      });

      const allAlerts = await adapter.queryEntities({
        entityType: 'alert',
        orgId,
        siteId: q.siteId,
        filters: { status: 'new' },
        limit: 10000,
        offset: 0,
      });

      let granted = 0;
      let denied = 0;
      const bySource: Record<string, number> = {};

      for (const evt of allEvents.entities) {
        if (evt.accessGranted === true) granted++;
        else if (evt.accessGranted === false) denied++;
        const src = (evt.source as string) || (evt.connectorType as string) || 'unknown';
        bySource[src] = (bySource[src] || 0) + 1;
      }

      return reply.send({
        total: allEvents.total,
        granted,
        denied,
        activeAlerts: allAlerts.total,
        bySource,
      });
    } catch (err) {
      log.error({ err }, 'Failed to compute event stats');
      return reply.code(500).send({ error: 'Failed to compute event stats' });
    }
  });

  // ─── GET /cameras ─────────────────────────────────────────────

  /**
   * GET /cameras
   *
   * Lists all cameras synced from edge devices (vendor, Milestone, vendor, etc.).
   * Queries both 'camera_status' (live state) and 'camera' (config) entity types.
   *
   * @query limit - Max results (default: 200)
   * @query offset - Pagination offset (default: 0)
   * @query siteId - Filter by site
   * @returns { cameras: Camera[], total: number }
   */
  fastify.get('/cameras', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: CAMERA_TYPES,
        orgId,
        siteId: q.siteId,
        limit: q.limit ? parseInt(q.limit, 10) : 200,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
      });
      return reply.send({ cameras: result.entities, total: result.total });
    } catch (err) {
      log.error({ err }, 'Failed to query cameras');
      return reply.code(500).send({ error: 'Failed to query cameras' });
    }
  });

  // ─── GET /cameras/:cameraId ───────────────────────────────────

  /**
   * GET /cameras/:cameraId
   *
   * Returns a single camera by ID. Returns 404 if not found.
   *
   * @param cameraId - The camera entity ID
   * @returns Camera object or { error: string } with 404
   */
  fastify.get('/cameras/:cameraId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { cameraId } = request.params as { cameraId: string };
      const result = await adapter.queryEntities({
        entityType: CAMERA_TYPES,
        orgId,
        filters: { id: cameraId },
        limit: 1,
        offset: 0,
      });
      if (result.entities.length === 0) {
        return reply.code(404).send({ error: 'Camera not found' });
      }
      return reply.send(result.entities[0]);
    } catch (err) {
      log.error({ err }, 'Failed to get camera');
      return reply.code(500).send({ error: 'Failed to get camera' });
    }
  });

  // ─── GET /connectors ──────────────────────────────────────────

  /**
   * Emulated PACS connector definitions used in demo mode.
   * Each product has a realistic set of vendor connectors that would be deployed
   * at a typical customer site. These are returned by GET /connectors when no
   * real edge device connectors are synced and DEMO_MODE is enabled.
   */
  const DEMO_CONNECTORS: Record<string, Array<{ id: string; name: string; type: string; vendor: string; siteId: string }>> = {
    safeschool: [
      { id: 'lenel-onguard-school', name: 'Lenel OnGuard (School)', type: 'lenel-onguard', vendor: 'Lenel/UTC', siteId: 'Main Campus' },
      { id: 'verkada-cameras', name: 'vendor Camera System', type: 'verkada', vendor: 'vendor', siteId: 'Main Campus' },
      { id: 'fire-alarm-panel', name: 'Notifier Fire Alarm Panel', type: 'fire-alarm', vendor: 'Honeywell/Notifier', siteId: 'Main Campus' },
      { id: 'intercom-system', name: 'Aiphone Intercom', type: 'intercom', vendor: 'Aiphone', siteId: 'Main Campus' },
    ],
    safeschool: [
      { id: 'sicunet-acs', name: 'Sicunet Access Control', type: 'sicunet', vendor: 'Sicunet', siteId: 'Corporate HQ' },
      { id: 'brivo-cloud', name: 'vendor Cloud Access', type: 'brivo', vendor: 'vendor', siteId: 'Corporate HQ' },
      { id: 'hid-readers', name: 'HID iCLASS Readers', type: 'hid', vendor: 'HID Global', siteId: 'Corporate HQ' },
    ],
    'safeschool': [
      { id: 'genetec-security-center', name: 'vendor Security Center', type: 'genetec', vendor: 'vendor', siteId: 'GSOC Campus' },
      { id: 'lenel-onguard-gsoc', name: 'Lenel OnGuard Enterprise', type: 'lenel-onguard', vendor: 'Lenel/UTC', siteId: 'GSOC Campus' },
      { id: 'milestone-xprotect', name: 'Milestone XProtect VMS', type: 'milestone', vendor: 'Milestone', siteId: 'GSOC Campus' },
      { id: 'vendor-aperio', name: 'vendor Aperio', type: 'vendor', vendor: 'vendor', siteId: 'GSOC Campus' },
      { id: 'vendor', name: 'vendor', type: 'vendor', vendor: 'vendor', siteId: 'GSOC Campus' },
      { id: 'intrusion-panel', name: 'DSC PowerSeries Neo', type: 'intrusion-panel', vendor: 'DSC/Tyco', siteId: 'GSOC Campus' },
    ],
  };

  /**
   * GET /connectors
   *
   * Lists PAC system connectors. Three-tier data strategy:
   * 1. Real connector data from edge device_status entities (production)
   * 2. Emulated PACS connectors when DEMO_MODE is active (demo)
   * 3. Empty list if neither is available
   *
   * Demo connectors include randomized eventsReceived counts and a 'connected' status
   * to simulate a live deployment.
   *
   * @query limit - Max results (default: 200)
   * @query offset - Pagination offset (default: 0)
   * @query siteId - Filter by site
   * @returns { connectors: Connector[], total: number }
   */
  fastify.get('/connectors', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // First check sync_entities for real connector data from edge devices
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: 'device_status',
        orgId,
        siteId: q.siteId,
        limit: q.limit ? parseInt(q.limit, 10) : 200,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
      });
      if (result.total > 0) {
        return reply.send({ connectors: result.entities, total: result.total });
      }

      // No real connectors — if demo mode, return emulated PACS connectors
      const isDemoMode = process.env.DEMO_MODE === 'true' || process.env.DEMO_MODE === '1';
      if (isDemoMode) {
        const demoProduct = (process.env.DASHBOARD_PRODUCT || process.env.DEMO_PRODUCT || 'all').toLowerCase();
        const products = demoProduct === 'all' ? ['safeschool', 'safeschool', 'safeschool'] : [demoProduct];
        const now = new Date().toISOString();
        const connectors = products.flatMap(p => (DEMO_CONNECTORS[p] || []).map(c => ({
          ...c,
          connected: true,
          status: 'connected',
          eventsReceived: Math.floor(Math.random() * 5000) + 2000,
          eventCount: Math.floor(Math.random() * 5000) + 2000,
          errors: Math.floor(Math.random() * 3),
          errorCount: 0,
          lastSeen: now,
        })));
        return reply.send({ connectors, total: connectors.length });
      }

      return reply.send({ connectors: result.entities, total: result.total });
    } catch (err) {
      log.error({ err }, 'Failed to query connectors');
      return reply.code(500).send({ error: 'Failed to query connectors' });
    }
  });

  // ─── GET /alerts ──────────────────────────────────────────────

  /**
   * GET /alerts
   *
   * Lists alert entities with optional status/severity filtering.
   * Alerts are generated by edge connectors (forced door, tailgating, etc.)
   * and synced to the cloud.
   *
   * @query limit - Max results (default: 100)
   * @query offset - Pagination offset (default: 0)
   * @query status - Filter by status ('new', 'acknowledged', 'resolved')
   * @query severity - Filter by severity ('low', 'medium', 'high', 'critical')
   * @query sortBy - Sort field (default: '_syncTimestamp')
   * @query sortOrder - 'asc' | 'desc' (default: 'desc')
   * @query siteId - Filter by site
   * @returns { alerts: Alert[], total: number, limit: number, offset: number }
   */
  fastify.get('/alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: 'alert',
        orgId,
        siteId: q.siteId,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['status', 'severity']),
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'desc',
      });
      return reply.send({ alerts: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query alerts');
      return reply.code(500).send({ error: 'Failed to query alerts' });
    }
  });

  // ─── POST /alerts/:alertId/acknowledge ────────────────────────

  /**
   * POST /alerts/:alertId/acknowledge
   *
   * Marks an alert as acknowledged. Updates the alert entity via the sync push
   * mechanism so the state change propagates back to edge devices.
   *
   * @param alertId - The alert entity ID
   * @returns { ok: true, alertId: string, status: 'acknowledged' }
   */
  fastify.post('/alerts/:alertId/acknowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { alertId } = request.params as { alertId: string };

      // Update alert via push (simulating a status change)
      await adapter.processPush('cloud', [{
        type: 'alert',
        action: 'update',
        data: { id: alertId, status: 'acknowledged', acknowledgedAt: new Date().toISOString(), ...(orgId ? { orgId } : {}) },
        timestamp: new Date().toISOString(),
      }], orgId);

      return reply.send({ ok: true, alertId, status: 'acknowledged' });
    } catch (err) {
      log.error({ err }, 'Failed to acknowledge alert');
      return reply.code(500).send({ error: 'Failed to acknowledge alert' });
    }
  });

  // ─── POST /alerts/:alertId/resolve ────────────────────────────

  /**
   * POST /alerts/:alertId/resolve
   *
   * Marks an alert as resolved. Sets resolvedAt timestamp and updates via sync push.
   *
   * @param alertId - The alert entity ID
   * @returns { ok: true, alertId: string, status: 'resolved' }
   */
  fastify.post('/alerts/:alertId/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { alertId } = request.params as { alertId: string };

      await adapter.processPush('cloud', [{
        type: 'alert',
        action: 'update',
        data: { id: alertId, status: 'resolved', resolvedAt: new Date().toISOString(), ...(orgId ? { orgId } : {}) },
        timestamp: new Date().toISOString(),
      }], orgId);

      return reply.send({ ok: true, alertId, status: 'resolved' });
    } catch (err) {
      log.error({ err }, 'Failed to resolve alert');
      return reply.code(500).send({ error: 'Failed to resolve alert' });
    }
  });

  // GET /visitors moved to visitor-routes.ts (full visitor management lifecycle)

  // ─── GET /emergencies (SafeSchool lockdowns/emergency alerts) ─

  /**
   * GET /emergencies
   *
   * Lists lockdown and emergency alert entities. Primary endpoint for the
   * SafeSchool emergency management panel. Supports date range filtering
   * and status/type/severity filters.
   *
   * @query limit - Max results (default: 100)
   * @query offset - Pagination offset (default: 0)
   * @query since - ISO timestamp lower bound
   * @query until - ISO timestamp upper bound
   * @query status - Filter by status
   * @query type - Filter by emergency type
   * @query severity - Filter by severity
   * @query siteId - Filter by site
   * @returns { emergencies: Emergency[], total: number, limit: number, offset: number }
   */
  fastify.get('/emergencies', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: ['lockdown', 'emergency_alert'],
        orgId,
        siteId: q.siteId,
        since: q.since ? new Date(q.since) : undefined,
        until: q.until ? new Date(q.until) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['status', 'type', 'severity']),
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'desc',
      });
      return reply.send({ emergencies: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query emergencies');
      return reply.code(500).send({ error: 'Failed to query emergencies' });
    }
  });

  // ─── GET /incidents (SafeSchool incident management) ──────────

  /**
   * GET /incidents
   *
   * Lists incident and incident_update entities. Used by the SafeSchool and
   * SafeSchool incident management panels. Supports full filtering by status,
   * severity, type, and incidentType.
   *
   * @query limit - Max results (default: 100)
   * @query offset - Pagination offset (default: 0)
   * @query since - ISO timestamp lower bound
   * @query until - ISO timestamp upper bound
   * @query status - Filter by incident status
   * @query severity - Filter by severity
   * @query type - Filter by type
   * @query incidentType - Filter by incident classification
   * @query siteId - Filter by site
   * @returns { incidents: Incident[], total: number, limit: number, offset: number }
   */
  fastify.get('/incidents', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: ['incident', 'incident_update'],
        orgId,
        siteId: q.siteId,
        since: q.since ? new Date(q.since) : undefined,
        until: q.until ? new Date(q.until) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['status', 'severity', 'type', 'incidentType']),
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'desc',
      });
      return reply.send({ incidents: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query incidents');
      return reply.code(500).send({ error: 'Failed to query incidents' });
    }
  });

  // ─── GET /threats (SafeSchool analytics/threat data) ─────────

  /**
   * GET /threats
   *
   * Lists analytics/threat entities. Used by the SafeSchool threat intelligence
   * panel. Queries the 'analytics' entity type with severity/category filtering.
   *
   * @query limit - Max results (default: 100)
   * @query offset - Pagination offset (default: 0)
   * @query since - ISO timestamp lower bound
   * @query until - ISO timestamp upper bound
   * @query severity - Filter by severity
   * @query category - Filter by threat category
   * @query sourceProduct - Filter by originating product
   * @query siteId - Filter by site
   * @returns { threats: Threat[], total: number, limit: number, offset: number }
   */
  fastify.get('/threats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: 'analytics',
        orgId,
        siteId: q.siteId,
        since: q.since ? new Date(q.since) : undefined,
        until: q.until ? new Date(q.until) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['severity', 'category', 'sourceProduct']),
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'desc',
      });
      return reply.send({ threats: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query threats');
      return reply.code(500).send({ error: 'Failed to query threats' });
    }
  });

  // ─── GET /detector-events (fire/intrusion/intercom) ─────────

  /**
   * GET /detector-events
   *
   * Lists detector event entities from fire alarm panels, intrusion panels,
   * and intercom systems. These are distinct from access_events and come from
   * specialized connector types.
   *
   * @query limit - Max results (default: 100)
   * @query offset - Pagination offset (default: 0)
   * @query since - ISO timestamp lower bound
   * @query until - ISO timestamp upper bound
   * @query detectorType - Filter by detector type (fire, intrusion, intercom)
   * @query severity - Filter by severity
   * @query zone - Filter by detection zone
   * @query siteId - Filter by site
   * @returns { detectorEvents: DetectorEvent[], total: number, limit: number, offset: number }
   */
  fastify.get('/detector-events', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: 'detector_event',
        orgId,
        siteId: q.siteId,
        since: q.since ? new Date(q.since) : undefined,
        until: q.until ? new Date(q.until) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['detectorType', 'severity', 'zone']),
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'desc',
      });
      return reply.send({ detectorEvents: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query detector events');
      return reply.code(500).send({ error: 'Failed to query detector events' });
    }
  });

  // ─── GET /cardholders ────────────────────────────────────────

  /**
   * GET /cardholders
   *
   * Lists cardholder entities synced from PAC systems. Supports filtering by
   * active status, person type (STAFF, VISITOR, CONTRACTOR, etc.), and external ID.
   * Default sort is by lastName ascending for alphabetical listing.
   *
   * @query limit - Max results (default: 200)
   * @query offset - Pagination offset (default: 0)
   * @query isActive - Filter by active status (true/false)
   * @query personType - Filter by person type
   * @query externalId - Filter by external system ID
   * @query sortBy - Sort field (default: 'lastName')
   * @query sortOrder - 'asc' | 'desc' (default: 'asc')
   * @query siteId - Filter by site
   * @returns { cardholders: Cardholder[], total: number, limit: number, offset: number }
   */
  fastify.get('/cardholders', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: ['cardholder'],
        orgId,
        siteId: q.siteId,
        limit: q.limit ? parseInt(q.limit, 10) : 200,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['isActive', 'personType', 'externalId']),
        sortBy: q.sortBy || 'lastName',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'asc',
      });
      return reply.send({ cardholders: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query cardholders');
      return reply.code(500).send({ error: 'Failed to query cardholders' });
    }
  });

  // ─── POST /cardholders ──────────────────────────────────────

  /**
   * POST /cardholders
   *
   * Creates a new cardholder via the sync push mechanism. The cardholder entity
   * will propagate to edge devices on next sync. Generates a unique ID if not
   * provided in the request body.
   *
   * @body firstName - Required
   * @body lastName - Required
   * @body personType - Optional (default: 'STAFF')
   * @body badgeNumber - Optional
   * @body isActive - Optional (default: true)
   * @body externalId - Optional
   * @body accessLevels - Optional array of access level IDs
   * @returns 201 with created cardholder object
   */
  fastify.post('/cardholders', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const body = request.body as Record<string, unknown>;
      if (!body?.firstName || !body?.lastName) {
        return reply.code(400).send({ error: 'firstName and lastName are required' });
      }

      const id = (body.id as string) || `ch-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      await adapter.processPush('cloud', [{
        type: 'cardholder',
        action: 'create',
        data: {
          id,
          firstName: body.firstName,
          lastName: body.lastName,
          personType: body.personType || 'STAFF',
          badgeNumber: body.badgeNumber || '',
          isActive: body.isActive !== false,
          externalId: body.externalId || '',
          accessLevels: body.accessLevels || [],
          ...(orgId ? { orgId } : {}),
        },
        timestamp: now,
      }], orgId);

      log.info({ id, orgId }, 'Cardholder created via cloud API');
      return reply.code(201).send({
        id, firstName: body.firstName, lastName: body.lastName,
        personType: body.personType || 'STAFF', isActive: body.isActive !== false,
        badgeNumber: body.badgeNumber || '', createdAt: now,
      });
    } catch (err) {
      log.error({ err }, 'Failed to create cardholder');
      return reply.code(500).send({ error: 'Failed to create cardholder' });
    }
  });

  // ─── PUT /cardholders/:id ───────────────────────────────────

  /**
   * PUT /cardholders/:id
   *
   * Updates an existing cardholder. Merges the request body with the existing
   * entity data (preserving fields not included in the update). Returns 404
   * if the cardholder does not exist.
   *
   * @param id - The cardholder entity ID
   * @body Any cardholder fields to update
   * @returns Updated cardholder object with updatedAt timestamp
   */
  fastify.put('/cardholders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const now = new Date().toISOString();

      // Verify the cardholder exists
      const existing = await adapter.queryEntities({
        entityType: 'cardholder', orgId, filters: { id }, limit: 1, offset: 0,
      });
      if (existing.entities.length === 0) {
        return reply.code(404).send({ error: 'Cardholder not found' });
      }

      const merged = { ...existing.entities[0], ...body, id };

      await adapter.processPush('cloud', [{
        type: 'cardholder',
        action: 'update',
        data: { ...merged, ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      log.info({ id, orgId }, 'Cardholder updated via cloud API');
      return reply.send({ ...merged, updatedAt: now });
    } catch (err) {
      log.error({ err }, 'Failed to update cardholder');
      return reply.code(500).send({ error: 'Failed to update cardholder' });
    }
  });

  // ─── DELETE /cardholders/:id ────────────────────────────────

  /**
   * DELETE /cardholders/:id
   *
   * Deletes a cardholder via sync push. The delete propagates to edge devices.
   *
   * @param id - The cardholder entity ID
   * @returns { success: true, id: string }
   */
  fastify.delete('/cardholders/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { id } = request.params as { id: string };
      const now = new Date().toISOString();

      await adapter.processPush('cloud', [{
        type: 'cardholder',
        action: 'delete',
        data: { id, ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      log.info({ id, orgId }, 'Cardholder deleted via cloud API');
      return reply.send({ success: true, id });
    } catch (err) {
      log.error({ err }, 'Failed to delete cardholder');
      return reply.code(500).send({ error: 'Failed to delete cardholder' });
    }
  });

  // ─── Credential CRUD ───────────────────────────────────────

  /**
   * GET /credentials
   *
   * Lists all credential entities with optional filtering. Credentials represent
   * physical badges, PINs, mobile credentials, etc. linked to cardholders.
   *
   * @query limit - Max results (default: 500)
   * @query offset - Pagination offset (default: 0)
   * @query cardholderId - Filter by owning cardholder
   * @query credentialType - Filter by type (CARD, PIN, CARD_PIN, MOBILE, BIOMETRIC)
   * @query state - Filter by state (ACTIVE, SUSPENDED, LOST, STOLEN, EXPIRED, RETURNED)
   * @query cardFormat - Filter by card format
   * @query isTrace - Filter traced credentials
   * @query isTemporary - Filter temporary credentials
   * @query sortBy - Sort field (default: '_syncTimestamp')
   * @query sortOrder - 'asc' | 'desc' (default: 'desc')
   * @returns { credentials: Credential[], total: number, limit: number, offset: number }
   */
  fastify.get('/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: ['credential'],
        orgId,
        limit: q.limit ? parseInt(q.limit, 10) : 500,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['cardholderId', 'credentialType', 'state', 'cardFormat', 'isTrace', 'isTemporary']),
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'desc',
      });
      return reply.send({ credentials: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query credentials');
      return reply.code(500).send({ error: 'Failed to query credentials' });
    }
  });

  /**
   * GET /cardholders/:id/credentials
   *
   * Lists all credentials belonging to a specific cardholder.
   *
   * @param id - The cardholder entity ID
   * @returns { credentials: Credential[], total: number }
   */
  fastify.get('/cardholders/:id/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { id } = request.params as { id: string };
      const result = await adapter.queryEntities({
        entityType: ['credential'],
        orgId,
        limit: 200,
        offset: 0,
        filters: { cardholderId: id },
        sortBy: '_syncTimestamp',
        sortOrder: 'desc',
      });
      return reply.send({ credentials: result.entities, total: result.total });
    } catch (err) {
      log.error({ err }, 'Failed to query cardholder credentials');
      return reply.code(500).send({ error: 'Failed to query cardholder credentials' });
    }
  });

  /**
   * POST /credentials
   *
   * Creates a new credential entity. Auto-generates a 4-digit PIN if the
   * credentialType is PIN or CARD_PIN and no pinCode is provided.
   * Generates a unique ID if not provided.
   *
   * @body cardholderId - Required: owning cardholder ID
   * @body credentialType - Required: CARD, PIN, CARD_PIN, MOBILE, BIOMETRIC
   * @body cardFormat - Optional card format (e.g., HID 26-bit)
   * @body cardNumber - Optional card number
   * @body facilityCode - Optional facility code
   * @body pinCode - Optional PIN (auto-generated for PIN types if omitted)
   * @body state - Optional initial state (default: 'ACTIVE')
   * @body isTrace - Optional trace flag for security monitoring
   * @body escortRequired - Optional escort requirement flag
   * @body activationDate - Optional activation date
   * @body expirationDate - Optional expiration date
   * @body isTemporary - Optional temporary credential flag
   * @returns 201 with created credential summary
   */
  fastify.post('/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const body = request.body as Record<string, unknown>;
      if (!body?.cardholderId || !body?.credentialType) {
        return reply.code(400).send({ error: 'cardholderId and credentialType are required' });
      }

      const id = (body.id as string) || `cred-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      // Auto-generate PIN if needed
      let pinCode = body.pinCode as string || '';
      if ((body.credentialType === 'PIN' || body.credentialType === 'CARD_PIN') && !pinCode) {
        pinCode = String(Math.floor(1000 + Math.random() * 9000));
      }

      await adapter.processPush('cloud', [{
        type: 'credential',
        action: 'create',
        data: {
          id,
          cardholderId: body.cardholderId,
          credentialType: body.credentialType,
          cardFormat: body.cardFormat || '',
          cardNumber: body.cardNumber || '',
          facilityCode: body.facilityCode || '',
          pinCode,
          duressCode: body.duressCode || '',
          state: body.state || 'ACTIVE',
          isTrace: body.isTrace === true,
          escortRequired: body.escortRequired === true,
          escortCardholderId: body.escortCardholderId || '',
          activationDate: body.activationDate || now,
          expirationDate: body.expirationDate || '',
          isTemporary: body.isTemporary === true,
          antiPassbackExempt: body.antiPassbackExempt === true,
          notes: body.notes || '',
          ...(orgId ? { orgId } : {}),
        },
        timestamp: now,
      }], orgId);

      log.info({ id, cardholderId: body.cardholderId, credentialType: body.credentialType, orgId }, 'Credential created via cloud API');
      return reply.code(201).send({ id, cardholderId: body.cardholderId, credentialType: body.credentialType, state: body.state || 'ACTIVE', pinCode, createdAt: now });
    } catch (err) {
      log.error({ err }, 'Failed to create credential');
      return reply.code(500).send({ error: 'Failed to create credential' });
    }
  });

  /**
   * PUT /credentials/:id
   *
   * Updates an existing credential. Merges request body with existing data.
   * Returns 404 if the credential does not exist.
   *
   * @param id - The credential entity ID
   * @body Any credential fields to update
   * @returns Updated credential object with updatedAt timestamp
   */
  fastify.put('/credentials/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const now = new Date().toISOString();

      const existing = await adapter.queryEntities({
        entityType: 'credential', orgId, filters: { id }, limit: 1, offset: 0,
      });
      if (existing.entities.length === 0) {
        return reply.code(404).send({ error: 'Credential not found' });
      }

      const merged = { ...existing.entities[0], ...body, id };

      await adapter.processPush('cloud', [{
        type: 'credential',
        action: 'update',
        data: { ...merged, ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      log.info({ id, orgId }, 'Credential updated via cloud API');
      return reply.send({ ...merged, updatedAt: now });
    } catch (err) {
      log.error({ err }, 'Failed to update credential');
      return reply.code(500).send({ error: 'Failed to update credential' });
    }
  });

  /**
   * DELETE /credentials/:id
   *
   * Deletes a credential via sync push.
   *
   * @param id - The credential entity ID
   * @returns { success: true, id: string }
   */
  fastify.delete('/credentials/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { id } = request.params as { id: string };
      const now = new Date().toISOString();

      await adapter.processPush('cloud', [{
        type: 'credential',
        action: 'delete',
        data: { id, ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      log.info({ id, orgId }, 'Credential deleted via cloud API');
      return reply.send({ success: true, id });
    } catch (err) {
      log.error({ err }, 'Failed to delete credential');
      return reply.code(500).send({ error: 'Failed to delete credential' });
    }
  });

  /**
   * POST /credentials/:id/state
   *
   * Changes the state of a credential with a full audit trail. Valid states are
   * ACTIVE, SUSPENDED, LOST, STOLEN, EXPIRED, RETURNED. Creates both a credential
   * update and an audit_log entry recording the state transition.
   *
   * This is used instead of a generic PUT when the dashboard needs to track
   * credential lifecycle transitions (e.g., reporting a badge as lost/stolen).
   *
   * @param id - The credential entity ID
   * @body state - Required: target state (one of ACTIVE, SUSPENDED, LOST, STOLEN, EXPIRED, RETURNED)
   * @returns { id, state, previousState, updatedAt }
   */
  fastify.post('/credentials/:id/state', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const validStates = ['ACTIVE', 'SUSPENDED', 'LOST', 'STOLEN', 'EXPIRED', 'RETURNED'];
      if (!body?.state || !validStates.includes(body.state as string)) {
        return reply.code(400).send({ error: 'state must be one of: ' + validStates.join(', ') });
      }
      const now = new Date().toISOString();

      const existing = await adapter.queryEntities({
        entityType: 'credential', orgId, filters: { id }, limit: 1, offset: 0,
      });
      if (existing.entities.length === 0) {
        return reply.code(404).send({ error: 'Credential not found' });
      }

      const prev = existing.entities[0];
      const merged = { ...prev, state: body.state, id };

      await adapter.processPush('cloud', [{
        type: 'credential',
        action: 'update',
        data: { ...merged, ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      // Audit trail entry
      await adapter.processPush('cloud', [{
        type: 'audit_log',
        action: 'create',
        data: {
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          action: 'credential.state_change',
          details: `Credential ${id} state changed: ${prev.state || 'ACTIVE'} → ${body.state}`,
          user: 'cloud-api',
          timestamp: now,
          ...(orgId ? { orgId } : {}),
        },
        timestamp: now,
      }], orgId);

      log.info({ id, from: prev.state, to: body.state, orgId }, 'Credential state changed');
      return reply.send({ id, state: body.state, previousState: prev.state || 'ACTIVE', updatedAt: now });
    } catch (err) {
      log.error({ err }, 'Failed to change credential state');
      return reply.code(500).send({ error: 'Failed to change credential state' });
    }
  });

  /**
   * POST /credentials/generate-pin
   *
   * Generates a unique 4-digit PIN that does not collide with any existing
   * credential PINs in the system. Fetches all existing PINs and retries
   * random generation up to 100 times to avoid duplicates.
   *
   * @returns { pin: string } - A unique 4-digit PIN (1000-9999)
   */
  fastify.post('/credentials/generate-pin', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(_request);
      // Fetch existing PINs to avoid duplicates
      const existing = await adapter.queryEntities({
        entityType: ['credential'], orgId, limit: 10000, offset: 0,
      });
      const usedPins = new Set(existing.entities.map((c: any) => c.pinCode).filter(Boolean));
      let pin: string;
      let tries = 0;
      do {
        pin = String(Math.floor(1000 + Math.random() * 9000));
        tries++;
      } while (usedPins.has(pin) && tries < 100);
      return reply.send({ pin });
    } catch (err) {
      log.error({ err }, 'Failed to generate PIN');
      return reply.code(500).send({ error: 'Failed to generate PIN' });
    }
  });

  // ─── Anti-Passback Config ─────────────────────────────────

  /**
   * GET /apb/config
   *
   * Returns the anti-passback (APB) configuration. APB prevents a cardholder
   * from entering a zone twice without first exiting (prevents tailgating/badge sharing).
   * Returns sensible defaults if no config entity exists yet.
   *
   * Default config: mode=SOFT (warn only), 15-min timed reset, EXECUTIVE and GUARD exempt.
   *
   * @returns { config: { mode, timedResetMinutes, globalEnabled, exemptPersonTypes } }
   */
  fastify.get('/apb/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const result = await adapter.queryEntities({
        entityType: ['apb_config'], orgId, limit: 1, offset: 0,
      });
      const config = result.entities[0] || { id: 'apb-config-default', mode: 'SOFT', timedResetMinutes: 15, globalEnabled: true, exemptPersonTypes: ['EXECUTIVE', 'GUARD'] };
      return reply.send({ config });
    } catch (err) {
      log.error({ err }, 'Failed to get APB config');
      return reply.code(500).send({ error: 'Failed to get APB config' });
    }
  });

  /**
   * PUT /apb/config
   *
   * Updates the anti-passback configuration. Supports SOFT (warn only) and
   * HARD (deny entry) modes, timed reset interval, and exempt person types.
   *
   * @body mode - APB mode: 'SOFT' (log violation) or 'HARD' (deny access)
   * @body timedResetMinutes - Minutes before APB state auto-resets (default: 15)
   * @body globalEnabled - Whether APB is globally enabled (default: true)
   * @body exemptPersonTypes - Array of person types exempt from APB rules
   * @returns { success: true, mode: string }
   */
  fastify.put('/apb/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const body = request.body as Record<string, unknown>;
      const now = new Date().toISOString();
      const id = 'apb-config-default';

      await adapter.processPush('cloud', [{
        type: 'apb_config',
        action: 'update',
        data: {
          id,
          mode: body.mode || 'SOFT',
          timedResetMinutes: body.timedResetMinutes || 15,
          globalEnabled: body.globalEnabled !== false,
          exemptPersonTypes: body.exemptPersonTypes || [],
          ...(orgId ? { orgId } : {}),
        },
        timestamp: now,
      }], orgId);

      log.info({ mode: body.mode, orgId }, 'APB config updated');
      return reply.send({ success: true, mode: body.mode });
    } catch (err) {
      log.error({ err }, 'Failed to update APB config');
      return reply.code(500).send({ error: 'Failed to update APB config' });
    }
  });

  /**
   * GET /apb/zones
   *
   * Lists all anti-passback zones. Each zone defines entry/exit door pairs
   * that enforce APB rules.
   *
   * @returns { zones: ApbZone[], total: number }
   */
  fastify.get('/apb/zones', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const result = await adapter.queryEntities({
        entityType: ['apb_zone'], orgId, limit: 200, offset: 0,
      });
      return reply.send({ zones: result.entities, total: result.total });
    } catch (err) {
      log.error({ err }, 'Failed to list APB zones');
      return reply.code(500).send({ error: 'Failed to list APB zones' });
    }
  });

  /**
   * POST /apb/zones
   *
   * Creates a new anti-passback zone with entry/exit door assignments.
   *
   * @body name - Required: zone name
   * @body entryDoorIds - Optional array of entry door IDs
   * @body exitDoorIds - Optional array of exit door IDs
   * @body mode - Optional zone-level APB mode override ('SOFT' | 'HARD')
   * @body timedResetMinutes - Optional zone-level reset interval override
   * @returns 201 with { id, name }
   */
  fastify.post('/apb/zones', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const body = request.body as Record<string, unknown>;
      if (!body?.name) return reply.code(400).send({ error: 'name is required' });
      const id = (body.id as string) || `apb-zone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      await adapter.processPush('cloud', [{
        type: 'apb_zone',
        action: 'create',
        data: {
          id,
          name: body.name,
          entryDoorIds: body.entryDoorIds || [],
          exitDoorIds: body.exitDoorIds || [],
          mode: body.mode || 'SOFT',
          timedResetMinutes: body.timedResetMinutes || 15,
          ...(orgId ? { orgId } : {}),
        },
        timestamp: now,
      }], orgId);

      log.info({ id, orgId }, 'APB zone created');
      return reply.code(201).send({ id, name: body.name });
    } catch (err) {
      log.error({ err }, 'Failed to create APB zone');
      return reply.code(500).send({ error: 'Failed to create APB zone' });
    }
  });

  /**
   * PUT /apb/zones/:id
   *
   * Updates an existing APB zone. Merges with existing data. Returns 404 if not found.
   *
   * @param id - The APB zone entity ID
   * @body Any APB zone fields to update
   * @returns Updated zone object with updatedAt timestamp
   */
  fastify.put('/apb/zones/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const now = new Date().toISOString();

      const existing = await adapter.queryEntities({
        entityType: 'apb_zone', orgId, filters: { id }, limit: 1, offset: 0,
      });
      if (existing.entities.length === 0) return reply.code(404).send({ error: 'APB zone not found' });

      const merged = { ...existing.entities[0], ...body, id };
      await adapter.processPush('cloud', [{
        type: 'apb_zone', action: 'update',
        data: { ...merged, ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      return reply.send({ ...merged, updatedAt: now });
    } catch (err) {
      log.error({ err }, 'Failed to update APB zone');
      return reply.code(500).send({ error: 'Failed to update APB zone' });
    }
  });

  /**
   * DELETE /apb/zones/:id
   *
   * Deletes an APB zone via sync push.
   *
   * @param id - The APB zone entity ID
   * @returns { success: true, id: string }
   */
  fastify.delete('/apb/zones/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { id } = request.params as { id: string };
      const now = new Date().toISOString();
      await adapter.processPush('cloud', [{
        type: 'apb_zone', action: 'delete',
        data: { id, ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);
      return reply.send({ success: true, id });
    } catch (err) {
      log.error({ err }, 'Failed to delete APB zone');
      return reply.code(500).send({ error: 'Failed to delete APB zone' });
    }
  });

  // ─── GET /doors ─────────────────────────────────────────────

  /**
   * GET /doors
   *
   * Lists all doors and their current status. Queries both 'door_status' (live
   * state from edge) and 'door' (static configuration) entity types.
   *
   * @query limit - Max results (default: 200)
   * @query offset - Pagination offset (default: 0)
   * @query status - Filter by door status (LOCKED, UNLOCKED, ALARM, etc.)
   * @query buildingId - Filter by building
   * @query sortBy - Sort field (default: 'name')
   * @query sortOrder - 'asc' | 'desc' (default: 'asc')
   * @query siteId - Filter by site
   * @returns { doors: Door[], total: number, limit: number, offset: number }
   */
  fastify.get('/doors', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: ['door_status', 'door'],
        orgId,
        siteId: q.siteId,
        limit: q.limit ? parseInt(q.limit, 10) : 200,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['status', 'buildingId']),
        sortBy: q.sortBy || 'name',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'asc',
      });
      return reply.send({ doors: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query doors');
      return reply.code(500).send({ error: 'Failed to query doors' });
    }
  });

  // ─── POST /doors/:doorId/lock ───────────────────────────────

  /**
   * POST /doors/:doorId/lock
   *
   * Issues a lock command for a specific door. Creates both a door_command entity
   * (audit trail) and updates the door_status entity to reflect the new state.
   * The command propagates to edge devices via sync.
   *
   * @param doorId - The door entity ID
   * @returns { ok: true, doorId: string, command: 'lock' }
   */
  fastify.post('/doors/:doorId/lock', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { doorId } = request.params as { doorId: string };
      const now = new Date().toISOString();

      await adapter.processPush('cloud', [{
        type: 'door_command',
        action: 'create',
        data: { id: `cmd-${Date.now()}`, doorId, command: 'lock', issuedAt: now, ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      // Also update door_status entity
      await adapter.processPush('cloud', [{
        type: 'door_status',
        action: 'update',
        data: { id: doorId, status: 'LOCKED', ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      log.info({ doorId, orgId }, 'Door lock command issued via cloud');
      return reply.send({ ok: true, doorId, command: 'lock' });
    } catch (err) {
      log.error({ err }, 'Failed to lock door');
      return reply.code(500).send({ error: 'Failed to lock door' });
    }
  });

  // ─── POST /doors/:doorId/unlock ─────────────────────────────

  /**
   * POST /doors/:doorId/unlock
   *
   * Issues an unlock command for a specific door. Creates both a door_command entity
   * (audit trail) and updates the door_status entity to UNLOCKED.
   *
   * @param doorId - The door entity ID
   * @returns { ok: true, doorId: string, command: 'unlock' }
   */
  fastify.post('/doors/:doorId/unlock', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { doorId } = request.params as { doorId: string };
      const now = new Date().toISOString();

      await adapter.processPush('cloud', [{
        type: 'door_command',
        action: 'create',
        data: { id: `cmd-${Date.now()}`, doorId, command: 'unlock', issuedAt: now, ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      await adapter.processPush('cloud', [{
        type: 'door_status',
        action: 'update',
        data: { id: doorId, status: 'UNLOCKED', ...(orgId ? { orgId } : {}) },
        timestamp: now,
      }], orgId);

      log.info({ doorId, orgId }, 'Door unlock command issued via cloud');
      return reply.send({ ok: true, doorId, command: 'unlock' });
    } catch (err) {
      log.error({ err }, 'Failed to unlock door');
      return reply.code(500).send({ error: 'Failed to unlock door' });
    }
  });

  // ─── GET /connectors/capabilities — PAC system capabilities per site ──

  /**
   * GET /connectors/capabilities
   *
   * Returns PAC system capabilities for connected edge sites. If a specific siteId
   * is provided and that site is currently connected via WebSocket, the endpoint
   * sends a real-time 'report_capabilities' command to the edge device and returns
   * the live response. Otherwise, returns stored capabilities from synced
   * connector_status/connector_capabilities entities.
   *
   * Also returns the list of currently connected site IDs for the dashboard to
   * show online/offline status.
   *
   * @query siteId - Optional: query a specific site's capabilities in real-time
   * @returns { connectedSites: string[], connectedCount: number, capabilities: Capability[] }
   *          or { siteId, online: true, capabilities: ... } for single-site queries
   */
  fastify.get('/connectors/capabilities', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const siteId = q.siteId;

      // If a specific siteId is given and it's connected, ask edge device directly
      const rtChannel = getRtChannel();
      if (siteId && rtChannel?.isConnected(siteId)) {
        try {
          const cmdId = `caps-${crypto.randomUUID()}`;
          const ack = await rtChannel!.sendCommand(siteId, {
            id: cmdId,
            command: 'report_capabilities',
            payload: {},
            priority: 'normal',
            timestamp: new Date().toISOString(),
            ackTimeoutMs: 5000,
          });
          if (ack.status === 'completed' && ack.detail) {
            const caps = JSON.parse(ack.detail);
            return reply.send({ siteId, online: true, capabilities: caps });
          }
        } catch {
          // Fall through to stored capabilities
        }
      }

      // Return stored capabilities from synced connector_status entities
      const result = await adapter.queryEntities({
        entityType: ['connector_status', 'connector_capabilities'], orgId,
        ...(siteId ? { siteId } : {}),
        limit: 1000, offset: 0,
      });

      // Also return which sites are currently online
      const connectedSites = getRtChannel()?.getConnectedSites() || [];

      return reply.send({
        connectedSites,
        connectedCount: connectedSites.length,
        capabilities: result.entities || [],
      });
    } catch (err) {
      log.error({ err }, 'Failed to get connector capabilities');
      return reply.code(500).send({ error: 'Failed to get connector capabilities' });
    }
  });

  // ─── POST /connectors/command — Send command to specific edge connector ──

  /**
   * POST /connectors/command
   *
   * Sends a command to an edge device connector via the realtime WebSocket channel.
   * If siteId is provided, sends to that specific site (returns 404 if not connected).
   * If siteId is omitted, broadcasts to all connected sites.
   *
   * Lockdown commands automatically get 'critical' priority; all others get 'high'.
   * Commands have a 10-second ack timeout.
   *
   * @body command - Required: the command name (e.g., 'door_lock', 'lockdown', 'report_status')
   * @body siteId - Optional: target site ID (omit for broadcast)
   * @body payload - Optional: command-specific payload data
   * @body connectorName - Optional: target specific connector on the edge device
   * @returns { ok: true, siteId?, commandId, ack? } or { ok: true, broadcast: true, devicesReached, commandId }
   */
  fastify.post('/connectors/command', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const { siteId, command, payload: cmdPayload, connectorName } = body as {
        siteId?: string; command?: string; payload?: Record<string, unknown>; connectorName?: string;
      };

      if (!command) {
        return reply.code(400).send({ error: 'command is required' });
      }

      const rtChan = getRtChannel();
      if (!rtChan) {
        return reply.code(503).send({ error: 'Realtime channel not available' });
      }

      const cmdId = `cmd-${crypto.randomUUID()}`;
      // Lockdown commands get 'critical' priority (processed immediately by edge,
      // bypasses any command queue). All other commands get 'high' priority.
      const realtimeCmd: RealtimeCommand = {
        id: cmdId,
        command,
        payload: { ...cmdPayload, connectorName },
        priority: command.startsWith('lockdown') ? 'critical' : 'high',
        timestamp: new Date().toISOString(),
        ackTimeoutMs: 10000,
      };

      if (siteId) {
        if (!rtChan.isConnected(siteId)) {
          return reply.code(404).send({ error: `Site ${siteId} is not connected` });
        }
        const ack = await rtChan.sendCommand(siteId, realtimeCmd);
        return reply.send({ ok: true, siteId, commandId: cmdId, ack });
      } else {
        // Broadcast to all connected sites
        const sent = rtChan.broadcast(realtimeCmd);
        return reply.send({ ok: true, broadcast: true, devicesReached: sent, commandId: cmdId });
      }
    } catch (err: any) {
      log.error({ err }, 'Failed to send connector command');
      return reply.code(500).send({ error: err.message || 'Failed to send command' });
    }
  });

  // ─── POST /lockdown — Emergency lockdown (lock all doors) ────

  /**
   * Alyssa's Law SLA threshold in milliseconds. Lockdown must complete within
   * this window. All timing is recorded in the compliance audit log for
   * regulatory verification. Named after Alyssa's Law (NJ A1618) which
   * mandates silent panic alarm systems in schools with measurable response times.
   */
  const LOCKDOWN_SLA_MS = 5000;

  /**
   * POST /lockdown
   *
   * Initiates an emergency lockdown. This is the most critical endpoint in the system.
   * Implements a 3-phase approach optimized for minimum latency:
   *
   * **Phase 1 - Edge dispatch (time-critical):** Sends 'lockdown' command to all
   * connected edge devices in parallel via WebSocket. This triggers the physical
   * PAC hardware lockdown at the door controller level. All acks are collected
   * with per-site timing data.
   *
   * **Phase 2 - Cloud state update:** Updates door_status entities to 'locked' and
   * optionally suspends all active credentials (preserving pre-lockdown state for
   * later restoration). Uses batch processPush for speed.
   *
   * **Phase 3 - Compliance audit:** Records a lockdown_initiated event with full
   * Alyssa's Law compliance data including edge dispatch time, total time, SLA
   * compliance status, and per-site ack results. Logs at WARN level if SLA met,
   * ERROR level if SLA exceeded.
   *
   * @body type - Lockdown type: 'full', 'partial', 'shelter_in_place' (default: 'full')
   * @body disableCredentials - If true, suspends all active credentials (default: false)
   * @returns { ok, lockdownId, lockdownType, doorsLocked, credentialsDisabled,
   *            edgeDevicesNotified, edgeResults, initiatedAt, compliance: { law, slaMs,
   *            edgeDispatchMs, totalTimeMs, slaCompliant } }
   */
  fastify.post('/lockdown', async (request: FastifyRequest, reply: FastifyReply) => {
    const lockdownStartMs = Date.now();
    try {
      const orgId = getOrgId?.(request);
      const body = request.body as Record<string, unknown>;
      const lockdownType = (body?.type as string) || 'full';
      const disableCredentials = body?.disableCredentials === true;
      const now = new Date().toISOString();
      const lockdownId = `lockdown-${crypto.randomUUID()}`;

      // PHASE 1: Dispatch to edge devices FIRST (PAC hardware lockdown is time-critical)
      // This goes directly to the physical access control system via WebSocket
      let edgeDevicesNotified = 0;
      const edgeResults: Record<string, unknown> = {};
      const rtChan1 = getRtChannel();
      if (rtChan1) {
        const command: RealtimeCommand = {
          id: lockdownId,
          command: 'lockdown',
          payload: { type: lockdownType, disableCredentials, timestamp: now, lockdownId },
          priority: 'critical',
          timestamp: now,
          ackTimeoutMs: LOCKDOWN_SLA_MS,
        };
        const connectedSites = rtChan1.getConnectedSites();
        edgeDevicesNotified = connectedSites.length;

        // Send to all edge devices in parallel for minimum latency
        const ackPromises = connectedSites.map(async (siteId) => {
          try {
            const ack = await rtChan1.sendCommand(siteId, { ...command, id: `${lockdownId}-${siteId}` });
            edgeResults[siteId] = { status: ack.status, detail: ack.detail, ackTimeMs: Date.now() - lockdownStartMs };
          } catch (err: any) {
            edgeResults[siteId] = { status: 'failed', detail: err.message, ackTimeMs: Date.now() - lockdownStartMs };
          }
        });
        await Promise.all(ackPromises);
      }
      const edgeDispatchMs = Date.now() - lockdownStartMs;

      // PHASE 2: Update cloud database state (can happen after edge dispatch)
      const doorsResult = await adapter.queryEntities({
        entityType: ['door'], orgId, limit: 10000, offset: 0,
      });
      const doors = doorsResult.entities || [];
      let doorsLocked = 0;

      // Batch all door updates together for speed
      const doorPushBatch = [];
      for (const door of doors) {
        const doorId = door.id || door.doorId;
        if (!doorId) continue;
        doorPushBatch.push(
          { type: 'door_command', action: 'create' as const, data: { id: `cmd-lockdown-${Date.now()}-${doorId}`, doorId, command: 'lock', issuedAt: now, lockdownType, ...(orgId ? { orgId } : {}) }, timestamp: now },
          { type: 'door_status', action: 'update' as const, data: { id: doorId, doorId, status: 'locked', lockMode: 'lockdown', lockdownType, lockedAt: now, ...(orgId ? { orgId } : {}) }, timestamp: now },
        );
        doorsLocked++;
      }
      if (doorPushBatch.length > 0) {
        await adapter.processPush('cloud', doorPushBatch, orgId);
      }

      // Optionally disable all active credentials to prevent any badge access during lockdown.
      // Each credential's pre-lockdown state is preserved in preLockdownState so that
      // POST /lockdown/end can restore each credential to its original state rather than
      // blindly setting all to ACTIVE (some may have been SUSPENDED for other reasons).
      let credentialsDisabled = 0;
      if (disableCredentials) {
        const credsResult = await adapter.queryEntities({
          entityType: ['credential'], orgId, limit: 50000, offset: 0,
          filters: { state: 'ACTIVE' },
        });
        const creds = credsResult.entities || [];
        const credBatch = [];
        for (const cred of creds) {
          if (!cred.id) continue;
          credBatch.push({
            type: 'credential', action: 'update' as const,
            data: { ...cred, state: 'SUSPENDED', suspendedReason: 'LOCKDOWN', suspendedAt: now, preLockdownState: cred.state || 'ACTIVE' },
            timestamp: now,
          });
          credentialsDisabled++;
        }
        if (credBatch.length > 0) {
          await adapter.processPush('cloud', credBatch, orgId);
        }
      }

      const totalTimeMs = Date.now() - lockdownStartMs;
      const slaCompliant = totalTimeMs <= LOCKDOWN_SLA_MS;

      // PHASE 3: Compliance audit log — Alyssa's Law requires proof of response time
      await adapter.processPush('cloud', [{
        type: 'event', action: 'create',
        data: {
          id: lockdownId,
          type: 'lockdown_initiated',
          description: `Emergency ${lockdownType} lockdown initiated. ${doorsLocked} doors locked.${disableCredentials ? ` ${credentialsDisabled} credentials suspended.` : ''}`,
          severity: 'critical',
          timestamp: now,
          lockdownType,
          doorsLocked,
          credentialsDisabled: disableCredentials ? credentialsDisabled : 0,
          // Alyssa's Law compliance fields
          compliance: {
            law: 'alyssas_law',
            slaMs: LOCKDOWN_SLA_MS,
            edgeDispatchMs,
            totalTimeMs,
            slaCompliant,
            edgeDevicesNotified,
            edgeResults,
          },
          ...(orgId ? { orgId } : {}),
        },
        timestamp: now,
      }], orgId);

      // Log compliance status with structured data for auditing
      if (slaCompliant) {
        log.warn({
          lockdownId, lockdownType, doorsLocked, credentialsDisabled,
          edgeDispatchMs, totalTimeMs, slaCompliant, slaMs: LOCKDOWN_SLA_MS,
          edgeDevicesNotified, orgId,
        }, 'LOCKDOWN INITIATED — Alyssa\'s Law SLA MET (%dms < %dms)', totalTimeMs, LOCKDOWN_SLA_MS);
      } else {
        log.error({
          lockdownId, lockdownType, doorsLocked, credentialsDisabled,
          edgeDispatchMs, totalTimeMs, slaCompliant, slaMs: LOCKDOWN_SLA_MS,
          edgeDevicesNotified, edgeResults, orgId,
        }, 'LOCKDOWN INITIATED — WARNING: Alyssa\'s Law SLA EXCEEDED (%dms > %dms)', totalTimeMs, LOCKDOWN_SLA_MS);
      }

      return reply.send({
        ok: true,
        lockdownId,
        lockdownType,
        doorsLocked,
        credentialsDisabled: disableCredentials ? credentialsDisabled : 0,
        edgeDevicesNotified,
        edgeResults,
        initiatedAt: now,
        // Alyssa's Law compliance
        compliance: {
          law: 'alyssas_law',
          slaMs: LOCKDOWN_SLA_MS,
          edgeDispatchMs,
          totalTimeMs,
          slaCompliant,
        },
      });
    } catch (err) {
      const failTimeMs = Date.now() - lockdownStartMs;
      log.error({ err, failTimeMs, slaMs: LOCKDOWN_SLA_MS }, 'LOCKDOWN FAILED — Alyssa\'s Law SLA VIOLATION');
      return reply.code(500).send({ error: 'Failed to initiate lockdown', failTimeMs });
    }
  });

  // ─── POST /lockdown/end — End lockdown (unlock doors, restore credentials) ──

  /**
   * POST /lockdown/end
   *
   * Ends an active lockdown. Mirrors the 3-phase approach of POST /lockdown:
   *
   * **Phase 1:** Sends 'lockdown_end' command to all connected edge devices via WebSocket.
   * **Phase 2:** Updates all door_status entities to 'normal' mode, and restores
   *   credentials that were suspended by the lockdown (uses preLockdownState to
   *   restore each credential to its previous state rather than blindly setting ACTIVE).
   * **Phase 3:** Records a lockdown_ended event with timing data.
   *
   * @returns { ok, doorsUnlocked, credentialsRestored, edgeDevicesNotified, edgeResults, totalTimeMs, endedAt }
   */
  fastify.post('/lockdown/end', async (request: FastifyRequest, reply: FastifyReply) => {
    const endStartMs = Date.now();
    try {
      const orgId = getOrgId?.(request);
      const now = new Date().toISOString();

      // PHASE 1: Dispatch lockdown-end to edge devices FIRST (release PAC hardware)
      let edgeDevicesNotified = 0;
      const edgeResults: Record<string, unknown> = {};
      const rtChan2 = getRtChannel();
      if (rtChan2) {
        const cmdId = `lockdown-end-${crypto.randomUUID()}`;
        const command: RealtimeCommand = {
          id: cmdId,
          command: 'lockdown_end',
          payload: { timestamp: now },
          priority: 'critical',
          timestamp: now,
          ackTimeoutMs: LOCKDOWN_SLA_MS,
        };
        const connectedSites = rtChan2.getConnectedSites();
        edgeDevicesNotified = connectedSites.length;
        const ackPromises = connectedSites.map(async (siteId) => {
          try {
            const ack = await rtChan2.sendCommand(siteId, { ...command, id: `${cmdId}-${siteId}` });
            edgeResults[siteId] = { status: ack.status, detail: ack.detail, ackTimeMs: Date.now() - endStartMs };
          } catch (err: any) {
            edgeResults[siteId] = { status: 'failed', detail: err.message, ackTimeMs: Date.now() - endStartMs };
          }
        });
        await Promise.all(ackPromises);
      }

      // PHASE 2: Update cloud database state
      const doorsResult = await adapter.queryEntities({
        entityType: ['door'], orgId, limit: 10000, offset: 0,
      });
      const doors = doorsResult.entities || [];
      let doorsUnlocked = 0;

      const doorBatch = [];
      for (const door of doors) {
        const doorId = door.id || door.doorId;
        if (!doorId) continue;
        doorBatch.push(
          { type: 'door_command', action: 'create' as const, data: { id: `cmd-endlockdown-${Date.now()}-${doorId}`, doorId, command: 'unlock', issuedAt: now, ...(orgId ? { orgId } : {}) }, timestamp: now },
          { type: 'door_status', action: 'update' as const, data: { id: doorId, doorId, status: 'normal', lockMode: 'normal', lockedAt: null, lockdownType: null, ...(orgId ? { orgId } : {}) }, timestamp: now },
        );
        doorsUnlocked++;
      }
      if (doorBatch.length > 0) {
        await adapter.processPush('cloud', doorBatch, orgId);
      }

      // Restore credentials that were suspended by lockdown
      const suspendedResult = await adapter.queryEntities({
        entityType: ['credential'], orgId, limit: 50000, offset: 0,
        filters: { suspendedReason: 'LOCKDOWN' },
      });
      const suspendedCreds = suspendedResult.entities || [];
      let credentialsRestored = 0;
      const credBatch = [];
      for (const cred of suspendedCreds) {
        if (!cred.id) continue;
        const restoreState = cred.preLockdownState || 'ACTIVE';
        credBatch.push({
          type: 'credential', action: 'update' as const,
          data: { ...cred, state: restoreState, suspendedReason: null, suspendedAt: null, preLockdownState: null },
          timestamp: now,
        });
        credentialsRestored++;
      }
      if (credBatch.length > 0) {
        await adapter.processPush('cloud', credBatch, orgId);
      }

      const totalTimeMs = Date.now() - endStartMs;

      // Record end-lockdown event with compliance data
      await adapter.processPush('cloud', [{
        type: 'event', action: 'create',
        data: {
          id: `lockdown-end-${Date.now()}`,
          type: 'lockdown_ended',
          description: `Lockdown ended. ${doorsUnlocked} doors unlocked. ${credentialsRestored} credentials restored.`,
          severity: 'high',
          timestamp: now,
          doorsUnlocked,
          credentialsRestored,
          totalTimeMs,
          edgeDevicesNotified,
          ...(orgId ? { orgId } : {}),
        },
        timestamp: now,
      }], orgId);

      log.warn({ doorsUnlocked, credentialsRestored, totalTimeMs, edgeDevicesNotified, orgId }, 'LOCKDOWN ENDED');

      return reply.send({
        ok: true,
        doorsUnlocked,
        credentialsRestored,
        edgeDevicesNotified,
        edgeResults,
        totalTimeMs,
        endedAt: now,
      });
    } catch (err) {
      log.error({ err }, 'Failed to end lockdown');
      return reply.code(500).send({ error: 'Failed to end lockdown' });
    }
  });

  // ─── GET /lockdown/status — Current lockdown state ──────────

  /**
   * GET /lockdown/status
   *
   * Returns the current lockdown state by comparing the timestamps of the most
   * recent lockdown_initiated and lockdown_ended events. Also counts doors
   * currently in lockdown mode and credentials suspended by lockdown.
   *
   * Returns { active: false } gracefully on error to avoid blocking the dashboard
   * lockdown status indicator.
   *
   * @returns { active: boolean, type: string|null, since: string|null,
   *            doorsLocked: number, credentialsSuspended: number,
   *            compliance: object|null }
   */
  fastify.get('/lockdown/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      // Check for recent lockdown event
      const result = await adapter.queryEntities({
        entityType: ['event'], orgId, limit: 1, offset: 0,
        filters: { type: 'lockdown_initiated' },
        sortBy: '_syncTimestamp', sortOrder: 'desc',
      });
      const lastLockdown = result.entities[0];

      // Check if it was ended
      const endResult = await adapter.queryEntities({
        entityType: ['event'], orgId, limit: 1, offset: 0,
        filters: { type: 'lockdown_ended' },
        sortBy: '_syncTimestamp', sortOrder: 'desc',
      });
      const lastEnd = endResult.entities[0];

      // Lockdown is active if a lockdown_initiated event exists and either:
      // (a) no lockdown_ended event exists, or
      // (b) the initiated event is newer than the ended event
      const lockdownActive = lastLockdown &&
        (!lastEnd || (lastLockdown.timestamp || lastLockdown._syncTimestamp) > (lastEnd.timestamp || lastEnd._syncTimestamp));

      // Count doors in lockdown state
      const doorsResult = await adapter.queryEntities({
        entityType: ['door'], orgId, limit: 10000, offset: 0,
      });
      const lockedDoors = (doorsResult.entities || []).filter((d: any) => d.lockMode === 'lockdown').length;

      // Count credentials suspended by lockdown
      const suspResult = await adapter.queryEntities({
        entityType: ['credential'], orgId, limit: 50000, offset: 0,
        filters: { suspendedReason: 'LOCKDOWN' },
      });
      const suspendedCredentials = suspResult.total || suspResult.entities?.length || 0;

      return reply.send({
        active: !!lockdownActive,
        type: lockdownActive ? (lastLockdown.lockdownType || 'full') : null,
        since: lockdownActive ? (lastLockdown.timestamp || lastLockdown._syncTimestamp) : null,
        doorsLocked: lockedDoors,
        credentialsSuspended: suspendedCredentials,
        // Alyssa's Law compliance data from last lockdown
        compliance: lockdownActive && lastLockdown.compliance ? lastLockdown.compliance : null,
      });
    } catch (err) {
      log.error({ err }, 'Failed to get lockdown status');
      return reply.send({ active: false, type: null, since: null, doorsLocked: 0, credentialsSuspended: 0 });
    }
  });

  // ─── GET /entities/:entityType (catch-all) ────────────────────

  /**
   * GET /entities/:entityType
   *
   * Generic catch-all endpoint for querying any entity type from the sync store.
   * Used by the dashboard for entity types that do not have a dedicated endpoint
   * (e.g., 'schedule', 'access_level', 'badge_design', etc.).
   *
   * @param entityType - The entity type string to query
   * @query limit - Max results (default: 100)
   * @query offset - Pagination offset (default: 0)
   * @query since - ISO timestamp lower bound
   * @query until - ISO timestamp upper bound
   * @query sortBy - Sort field (default: '_syncTimestamp')
   * @query sortOrder - 'asc' | 'desc' (default: 'desc')
   * @query siteId - Filter by site
   * @returns { entities: Entity[], total: number, limit: number, offset: number }
   */
  fastify.get('/entities/:entityType', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const { entityType } = request.params as { entityType: string };
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType,
        orgId,
        siteId: q.siteId,
        since: q.since ? new Date(q.since) : undefined,
        until: q.until ? new Date(q.until) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'desc',
      });
      return reply.send({ entities: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query entities');
      return reply.code(500).send({ error: 'Failed to query entities' });
    }
  });

  // ─── Access Schedule CRUD ────────────────────────────────────

  /**
   * DDL for access_schedules and access_levels tables. Executed lazily before
   * each schedule/access-level query (CREATE TABLE IF NOT EXISTS is idempotent).
   * These tables live in Postgres directly rather than in the sync_entities
   * abstraction because they have relational structure (access_levels reference
   * schedules via schedule_id, and the dashboard needs JOINs for display).
   *
   * access_schedules: Weekly/custom time blocks defining when access is allowed.
   *   - blocks: JSONB array of { day, startTime, endTime } objects
   *   - holidays: JSONB array of holiday date overrides
   *   - first_person_in: requires first authorized person before schedule activates
   *
   * access_levels: Named groupings that bind schedules to sets of doors and cardholders.
   *   - schedule_id: FK to access_schedules
   *   - doors: JSONB array of door IDs this level grants access to
   *   - cardholders: JSONB array of cardholder IDs assigned this level
   *   - priority: higher priority levels override lower ones on conflict
   */
  const ENSURE_SCHEDULES_SQL = `
    CREATE TABLE IF NOT EXISTS access_schedules (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      schedule_type TEXT NOT NULL DEFAULT 'weekly', blocks JSONB NOT NULL DEFAULT '[]',
      holidays JSONB NOT NULL DEFAULT '[]', first_person_in INTEGER NOT NULL DEFAULT 0,
      is_template INTEGER NOT NULL DEFAULT 0, color TEXT DEFAULT '#22c55e',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      org_id TEXT NOT NULL DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS access_levels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      schedule_id TEXT, doors JSONB NOT NULL DEFAULT '[]', cardholders JSONB NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      org_id TEXT NOT NULL DEFAULT 'default'
    );
  `;

  /**
   * Creates a short-lived Postgres pool for schedule/access-level queries.
   * Same pattern as makeEventsPool() — returns null if no DATABASE_URL.
   */
  function makeSchedPool() {
    const connStr = process.env.DATABASE_URL;
    if (!connStr) return null;
    return new pg.Pool({ connectionString: connStr, max: 2, ssl: connStr.includes('railway.app') ? { rejectUnauthorized: false } : undefined });
  }

  /**
   * GET /schedules
   *
   * Lists all access schedules. Optionally filter to templates only.
   * Returns empty list if no database is configured.
   *
   * @query templates - If 'true', returns only template schedules
   * @returns { schedules: Schedule[], total: number }
   */
  fastify.get('/schedules', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeSchedPool();
    if (!pool) return reply.send({ schedules: [], total: 0 });
    try {
      await pool.query(ENSURE_SCHEDULES_SQL);
      const q = _request.query as Record<string, string>;
      const templatesOnly = q.templates === 'true';
      const where = templatesOnly ? 'WHERE is_template = 1' : '';
      const { rows } = await pool.query(`SELECT * FROM access_schedules ${where} ORDER BY name`);
      return reply.send({ schedules: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to list schedules');
      return reply.code(500).send({ error: 'Failed to list schedules' });
    } finally { await pool.end(); }
  });

  /**
   * GET /schedules/:id
   *
   * Returns a single access schedule by ID. Returns 404 if not found.
   *
   * @param id - The schedule ID
   * @returns Schedule object or { error } with 404
   */
  fastify.get('/schedules/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeSchedPool();
    if (!pool) return reply.code(500).send({ error: 'No database' });
    try {
      await pool.query(ENSURE_SCHEDULES_SQL);
      const { id } = request.params as { id: string };
      const { rows } = await pool.query('SELECT * FROM access_schedules WHERE id = $1', [id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Schedule not found' });
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to get schedule');
      return reply.code(500).send({ error: 'Failed to get schedule' });
    } finally { await pool.end(); }
  });

  /**
   * POST /schedules
   *
   * Creates a new access schedule. Generates a unique ID with 'sched_' prefix.
   * Stores time blocks and holidays as JSONB arrays.
   *
   * @body name - Schedule name (default: 'Untitled')
   * @body description - Optional description
   * @body schedule_type - 'weekly' or 'custom' (default: 'weekly')
   * @body blocks - Array of { day, startTime, endTime } time blocks
   * @body holidays - Array of holiday date strings
   * @body first_person_in - Boolean: require first authorized entry
   * @body is_template - Boolean: mark as reusable template
   * @body color - Display color hex (default: '#22c55e')
   * @returns 201 with created schedule row
   */
  fastify.post('/schedules', async (request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeSchedPool();
    if (!pool) return reply.code(500).send({ error: 'No database' });
    try {
      await pool.query(ENSURE_SCHEDULES_SQL);
      const body = request.body as any;
      const id = 'sched_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      await pool.query(`
        INSERT INTO access_schedules (id, name, description, schedule_type, blocks, holidays, first_person_in, is_template, color, org_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'default')
      `, [id, body.name || 'Untitled', body.description || '', body.schedule_type || 'weekly',
          JSON.stringify(body.blocks || []), JSON.stringify(body.holidays || []),
          body.first_person_in ? 1 : 0, body.is_template ? 1 : 0, body.color || '#22c55e']);
      const { rows } = await pool.query('SELECT * FROM access_schedules WHERE id = $1', [id]);
      return reply.code(201).send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to create schedule');
      return reply.code(500).send({ error: 'Failed to create schedule' });
    } finally { await pool.end(); }
  });

  /**
   * PUT /schedules/:id
   *
   * Updates an existing access schedule. Uses COALESCE for partial updates —
   * only provided fields are changed; null/omitted fields keep existing values.
   *
   * @param id - The schedule ID
   * @body Any schedule fields to update (all optional)
   * @returns Updated schedule row or 404
   */
  fastify.put('/schedules/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeSchedPool();
    if (!pool) return reply.code(500).send({ error: 'No database' });
    try {
      await pool.query(ENSURE_SCHEDULES_SQL);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      await pool.query(`
        UPDATE access_schedules SET name = COALESCE($2, name), description = COALESCE($3, description),
        schedule_type = COALESCE($4, schedule_type), blocks = COALESCE($5, blocks),
        holidays = COALESCE($6, holidays), first_person_in = COALESCE($7, first_person_in),
        is_template = COALESCE($8, is_template), color = COALESCE($9, color), updated_at = NOW()
        WHERE id = $1
      `, [id, body.name, body.description, body.schedule_type,
          body.blocks ? JSON.stringify(body.blocks) : null,
          body.holidays ? JSON.stringify(body.holidays) : null,
          body.first_person_in !== undefined ? (body.first_person_in ? 1 : 0) : null,
          body.is_template !== undefined ? (body.is_template ? 1 : 0) : null,
          body.color || null]);
      const { rows } = await pool.query('SELECT * FROM access_schedules WHERE id = $1', [id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Schedule not found' });
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to update schedule');
      return reply.code(500).send({ error: 'Failed to update schedule' });
    } finally { await pool.end(); }
  });

  /**
   * DELETE /schedules/:id
   *
   * Deletes an access schedule. Returns 404 if not found (rowCount === 0).
   * Note: does not cascade-delete access_levels referencing this schedule.
   *
   * @param id - The schedule ID
   * @returns { ok: true } or 404
   */
  fastify.delete('/schedules/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeSchedPool();
    if (!pool) return reply.code(500).send({ error: 'No database' });
    try {
      await pool.query(ENSURE_SCHEDULES_SQL);
      const { id } = request.params as { id: string };
      const result = await pool.query('DELETE FROM access_schedules WHERE id = $1', [id]);
      if (result.rowCount === 0) return reply.code(404).send({ error: 'Schedule not found' });
      return reply.send({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete schedule');
      return reply.code(500).send({ error: 'Failed to delete schedule' });
    } finally { await pool.end(); }
  });

  // ─── Access Level CRUD ─────────────────────────────────────────

  /**
   * GET /access-levels
   *
   * Lists all access levels with their associated schedule names (via LEFT JOIN).
   * Sorted by priority descending, then name ascending.
   *
   * @returns { levels: AccessLevel[], total: number }
   */
  fastify.get('/access-levels', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeSchedPool();
    if (!pool) return reply.send({ levels: [], total: 0 });
    try {
      await pool.query(ENSURE_SCHEDULES_SQL);
      const { rows } = await pool.query(`
        SELECT al.*, s.name as schedule_name FROM access_levels al
        LEFT JOIN access_schedules s ON al.schedule_id = s.id
        ORDER BY al.priority DESC, al.name
      `);
      return reply.send({ levels: rows, total: rows.length });
    } catch (err) {
      log.error({ err }, 'Failed to list access levels');
      return reply.code(500).send({ error: 'Failed to list access levels' });
    } finally { await pool.end(); }
  });

  /**
   * POST /access-levels
   *
   * Creates a new access level. Generates a unique ID with 'alvl_' prefix.
   * Links to a schedule via schedule_id and stores door/cardholder assignments as JSONB.
   *
   * @body name - Level name (default: 'Untitled')
   * @body description - Optional description
   * @body schedule_id - Optional: linked access schedule ID
   * @body doors - Array of door IDs this level grants access to
   * @body cardholders - Array of cardholder IDs assigned this level
   * @body priority - Numeric priority (higher wins on conflict, default: 0)
   * @body active - Boolean active flag (default: true)
   * @returns 201 with created access level row
   */
  fastify.post('/access-levels', async (request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeSchedPool();
    if (!pool) return reply.code(500).send({ error: 'No database' });
    try {
      await pool.query(ENSURE_SCHEDULES_SQL);
      const body = request.body as any;
      const id = 'alvl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      await pool.query(`
        INSERT INTO access_levels (id, name, description, schedule_id, doors, cardholders, priority, active, org_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'default')
      `, [id, body.name || 'Untitled', body.description || '', body.schedule_id || null,
          JSON.stringify(body.doors || []), JSON.stringify(body.cardholders || []),
          body.priority || 0, body.active !== undefined ? (body.active ? 1 : 0) : 1]);
      const { rows } = await pool.query('SELECT * FROM access_levels WHERE id = $1', [id]);
      return reply.code(201).send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to create access level');
      return reply.code(500).send({ error: 'Failed to create access level' });
    } finally { await pool.end(); }
  });

  /**
   * PUT /access-levels/:id
   *
   * Updates an existing access level. Uses COALESCE for partial updates.
   *
   * @param id - The access level ID
   * @body Any access level fields to update (all optional)
   * @returns Updated access level row or 404
   */
  fastify.put('/access-levels/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeSchedPool();
    if (!pool) return reply.code(500).send({ error: 'No database' });
    try {
      await pool.query(ENSURE_SCHEDULES_SQL);
      const { id } = request.params as { id: string };
      const body = request.body as any;
      await pool.query(`
        UPDATE access_levels SET name = COALESCE($2, name), description = COALESCE($3, description),
        schedule_id = COALESCE($4, schedule_id), doors = COALESCE($5, doors),
        cardholders = COALESCE($6, cardholders), priority = COALESCE($7, priority),
        active = COALESCE($8, active), updated_at = NOW()
        WHERE id = $1
      `, [id, body.name, body.description, body.schedule_id,
          body.doors ? JSON.stringify(body.doors) : null,
          body.cardholders ? JSON.stringify(body.cardholders) : null,
          body.priority !== undefined ? body.priority : null,
          body.active !== undefined ? (body.active ? 1 : 0) : null]);
      const { rows } = await pool.query('SELECT * FROM access_levels WHERE id = $1', [id]);
      if (rows.length === 0) return reply.code(404).send({ error: 'Access level not found' });
      return reply.send(rows[0]);
    } catch (err) {
      log.error({ err }, 'Failed to update access level');
      return reply.code(500).send({ error: 'Failed to update access level' });
    } finally { await pool.end(); }
  });

  /**
   * DELETE /access-levels/:id
   *
   * Deletes an access level. Returns 404 if not found.
   *
   * @param id - The access level ID
   * @returns { ok: true } or 404
   */
  fastify.delete('/access-levels/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeSchedPool();
    if (!pool) return reply.code(500).send({ error: 'No database' });
    try {
      await pool.query(ENSURE_SCHEDULES_SQL);
      const { id } = request.params as { id: string };
      const result = await pool.query('DELETE FROM access_levels WHERE id = $1', [id]);
      if (result.rowCount === 0) return reply.code(404).send({ error: 'Access level not found' });
      return reply.send({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to delete access level');
      return reply.code(500).send({ error: 'Failed to delete access level' });
    } finally { await pool.end(); }
  });

  // ─── Timezone settings helpers ───────────────────────────────

  /** Default timezone/locale settings returned when no database is configured or no row exists. */
  const TZ_DEFAULTS = { timezone: 'America/New_York', locale: 'en-US', date_format: 'MM/DD/YYYY', time_format: '12h' };

  /**
   * DDL for the org_settings table, which stores per-org timezone and locale preferences.
   * Inserts a 'default' row on first run. Used by the dashboard to format all timestamps
   * in the user's preferred timezone.
   */
  const ENSURE_TZ_SQL = `
    CREATE TABLE IF NOT EXISTS org_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      locale TEXT NOT NULL DEFAULT 'en-US',
      date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
      time_format TEXT NOT NULL DEFAULT '12h',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO org_settings (id) VALUES ('default') ON CONFLICT DO NOTHING;
  `;

  /**
   * Creates a short-lived Postgres pool for timezone settings queries.
   * Same pattern as makeEventsPool() / makeSchedPool().
   */
  function makeTzPool() {
    const connStr = process.env.DATABASE_URL;
    if (!connStr) return null;
    return new pg.Pool({ connectionString: connStr, max: 2, ssl: connStr.includes('railway.app') ? { rejectUnauthorized: false } : undefined });
  }

  // ─── GET /settings/timezone — Get org timezone settings ─────

  /**
   * GET /settings/timezone
   *
   * Returns the organization's timezone, locale, and date/time format preferences.
   * Falls back to US Eastern defaults if no database or no settings row exists.
   *
   * @returns { timezone: string, locale: string, date_format: string, time_format: string }
   */
  fastify.get('/settings/timezone', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pool = makeTzPool();
    if (!pool) return reply.send(TZ_DEFAULTS);
    try {
      await pool.query(ENSURE_TZ_SQL);
      const { rows } = await pool.query('SELECT timezone, locale, date_format, time_format FROM org_settings WHERE id = $1', ['default']);
      return reply.send(rows[0] || TZ_DEFAULTS);
    } catch (err) {
      log.error({ err }, 'Failed to get timezone settings');
      return reply.send(TZ_DEFAULTS);
    } finally { await pool.end(); }
  });

  // ─── PUT /settings/timezone — Update org timezone settings ──

  /**
   * PUT /settings/timezone
   *
   * Updates the organization's timezone settings. Validates the timezone string
   * against the IANA timezone database using Intl.DateTimeFormat. Uses upsert
   * (INSERT ... ON CONFLICT DO UPDATE) to handle both first-time set and updates.
   *
   * @body timezone - Required: IANA timezone string (e.g., 'America/New_York')
   * @body locale - Optional locale (default: 'en-US')
   * @body date_format - Optional date format (default: 'MM/DD/YYYY')
   * @body time_format - Optional time format: '12h' | '24h' (default: '12h')
   * @returns { success: true, timezone, locale, date_format, time_format }
   */
  fastify.put('/settings/timezone', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, string>;
      const timezone = body.timezone;
      if (!timezone) return reply.code(400).send({ error: 'timezone is required' });

      // Validate IANA timezone by attempting to construct a DateTimeFormat with it.
      // Invalid timezone strings cause Intl.DateTimeFormat to throw a RangeError.
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch {
        return reply.code(400).send({ error: 'Invalid timezone: ' + timezone });
      }

      const locale = body.locale || 'en-US';
      const dateFormat = body.date_format || 'MM/DD/YYYY';
      const timeFormat = body.time_format || '12h';

      const pool = makeTzPool();
      if (!pool) return reply.code(500).send({ error: 'No database configured' });
      try {
        await pool.query(ENSURE_TZ_SQL);
        await pool.query(`
          INSERT INTO org_settings (id, timezone, locale, date_format, time_format, updated_at)
          VALUES ('default', $1, $2, $3, $4, NOW())
          ON CONFLICT (id) DO UPDATE SET timezone = $1, locale = $2, date_format = $3, time_format = $4, updated_at = NOW()
        `, [timezone, locale, dateFormat, timeFormat]);
        return reply.send({ success: true, timezone, locale, date_format: dateFormat, time_format: timeFormat });
      } finally { await pool.end(); }
    } catch (err) {
      log.error({ err }, 'Failed to update timezone settings');
      return reply.code(500).send({ error: 'Failed to update timezone settings' });
    }
  });
}

/**
 * Builds a filters object from URL query parameters for use with adapter.queryEntities().
 * Only includes the specified keys if they are present and non-empty in the query string.
 * Automatically coerces 'true'/'false' strings to boolean values, which is needed
 * because query params are always strings but the adapter expects typed filter values.
 *
 * @param query - The parsed query string record from the Fastify request
 * @param keys - Array of allowed filter key names to extract
 * @returns A filters object with present keys, or undefined if no filters matched
 *
 * @example
 * // URL: /events?severity=high&accessGranted=true&limit=100
 * buildFilters(query, ['severity', 'accessGranted'])
 * // => { severity: 'high', accessGranted: true }
 */
function buildFilters(query: Record<string, string>, keys: string[]): Record<string, unknown> | undefined {
  const filters: Record<string, unknown> = {};
  let hasAny = false;
  for (const key of keys) {
    if (query[key] !== undefined && query[key] !== '') {
      // Handle boolean-like values
      if (query[key] === 'true') filters[key] = true;
      else if (query[key] === 'false') filters[key] = false;
      else filters[key] = query[key];
      hasAny = true;
    }
  }
  return hasAny ? filters : undefined;
}
