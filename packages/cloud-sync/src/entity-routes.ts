/**
 * Entity Query Routes
 *
 * Fastify plugin for querying synced entity data from the cloud dashboard.
 * Reads data already synced from edge devices — no edge proxy needed.
 *
 * Mount behind JWT auth at prefix '/api/v1/data'.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import type { SyncDatabaseAdapter } from './types.js';

const log = createLogger('cloud-sync:entity-routes');

/** All event entity types synced from edge modules */
const EVENT_TYPES = ['access_event', 'video_event', 'fire_event', 'intrusion_event', 'intercom_event'];
/** Camera-related entity types */
const CAMERA_TYPES = ['camera_status', 'camera'];
/** Door/reader status types */
const DOOR_TYPES = ['door_status'];

export interface EntityRoutesOptions {
  adapter: SyncDatabaseAdapter;
  getOrgId?: (request: FastifyRequest) => string | undefined;
}

export async function entityRoutes(fastify: FastifyInstance, options: EntityRoutesOptions) {
  const { adapter, getOrgId } = options;

  // ─── GET /events ──────────────────────────────────────────────

  fastify.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: EVENT_TYPES,
        orgId,
        siteId: q.siteId,
        since: q.since ? new Date(q.since) : undefined,
        until: q.until ? new Date(q.until) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['eventType', 'severity', 'accessGranted', 'userId']),
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'desc',
      });
      return reply.send({ events: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query events');
      return reply.code(500).send({ error: 'Failed to query events' });
    }
  });

  // ─── GET /events/recent ───────────────────────────────────────

  fastify.get('/events/recent', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const limit = q.limit ? parseInt(q.limit, 10) : 50;
      const result = await adapter.queryEntities({
        entityType: EVENT_TYPES,
        orgId,
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

  fastify.get('/events/failed', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: EVENT_TYPES,
        orgId,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
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

  fastify.get('/events/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const allEvents = await adapter.queryEntities({
        entityType: EVENT_TYPES,
        orgId,
        since: since24h,
        limit: 10000,
        offset: 0,
      });

      const allAlerts = await adapter.queryEntities({
        entityType: 'alert',
        orgId,
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

  fastify.get('/connectors', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: 'device_status',
        orgId,
        siteId: q.siteId,
        limit: q.limit ? parseInt(q.limit, 10) : 200,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
      });
      return reply.send({ connectors: result.entities, total: result.total });
    } catch (err) {
      log.error({ err }, 'Failed to query connectors');
      return reply.code(500).send({ error: 'Failed to query connectors' });
    }
  });

  // ─── GET /alerts ──────────────────────────────────────────────

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

  // ─── GET /visitors (SafeSchool visitor management) ───────────

  fastify.get('/visitors', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = getOrgId?.(request);
      const q = request.query as Record<string, string>;
      const result = await adapter.queryEntities({
        entityType: ['visitor', 'visitor_check_in', 'visitor_check_out'],
        orgId,
        siteId: q.siteId,
        since: q.since ? new Date(q.since) : undefined,
        until: q.until ? new Date(q.until) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 100,
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        filters: buildFilters(q, ['status', 'visitorType', 'screeningResult']),
        sortBy: q.sortBy || '_syncTimestamp',
        sortOrder: (q.sortOrder as 'asc' | 'desc') || 'desc',
      });
      return reply.send({ visitors: result.entities, total: result.total, limit: result.limit, offset: result.offset });
    } catch (err) {
      log.error({ err }, 'Failed to query visitors');
      return reply.code(500).send({ error: 'Failed to query visitors' });
    }
  });

  // ─── GET /emergencies (SafeSchool lockdowns/emergency alerts) ─

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

  // ─── GET /doors ─────────────────────────────────────────────

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

  // ─── GET /entities/:entityType (catch-all) ────────────────────

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
}

/** Build filters object from query params, only including specified keys that are present */
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
