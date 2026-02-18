import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

// Status ordering for transition validation (no going backwards past RESOLVED)
const STATUS_ORDER: Record<string, number> = {
  TRIGGERED_INCIDENT: 0,
  DISPATCHED_INCIDENT: 1,
  RESPONDING_INCIDENT: 2,
  ON_SCENE_INCIDENT: 3,
  LOCKDOWN_ACTIVE_INCIDENT: 4,
  ALL_CLEAR_INCIDENT: 5,
  REUNIFICATION_INCIDENT: 6,
  RESOLVED_INCIDENT: 7,
  FALSE_ALARM: 7,
};

const incidentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/incidents — List incidents for user's sites
  fastify.get<{
    Querystring: {
      siteId?: string;
      status?: string;
      type?: string;
      limit?: string;
      offset?: string;
    };
  }>('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { siteId, status, type, limit, offset } = request.query;

    const where: any = {};
    if (siteId) {
      if (!request.jwtUser.siteIds.includes(siteId)) {
        where.siteId = { in: [] }; // no results for unauthorized site
      } else {
        where.siteId = siteId;
      }
    } else {
      where.siteId = { in: request.jwtUser.siteIds };
    }
    if (status) where.status = status;
    if (type) where.type = type;

    const take = Math.min(parseInt(limit || '50', 10) || 50, 100);
    const skip = parseInt(offset || '0', 10) || 0;

    const incidents = await fastify.prisma.incident.findMany({
      where,
      include: {
        respondingAgencies: {
          include: { agency: { select: { id: true, name: true } } },
        },
      },
      orderBy: { triggeredAt: 'desc' },
      take,
      skip,
    });

    return incidents;
  });

  // GET /api/v1/incidents/:incidentId — Incident detail
  fastify.get<{
    Params: { incidentId: string };
  }>('/:incidentId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: request.params.incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
      include: {
        timeline: {
          orderBy: { timestamp: 'desc' },
          take: 50,
        },
        respondingAgencies: {
          include: { agency: true },
        },
        _count: {
          select: { messages: true, doorCommands: true },
        },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    return incident;
  });

  // POST /api/v1/incidents — Create incident (FIRST_RESPONDER+)
  fastify.post<{
    Body: {
      siteId: string;
      type: string;
      severity: string;
      triggerBuildingId?: string;
      triggerFloor?: string;
      triggerRoom?: string;
      notes?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] }, async (request, reply) => {
    const { siteId, type, severity, triggerBuildingId, triggerFloor, triggerRoom } = request.body;
    const notes = sanitizeText(request.body.notes);

    if (!siteId || !type || !severity) {
      return reply.code(400).send({ error: 'siteId, type, and severity are required' });
    }

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const now = new Date();

    const incident = await fastify.prisma.incident.create({
      data: {
        siteId,
        type: type as any,
        status: 'TRIGGERED_INCIDENT' as any,
        severity: severity as any,
        triggeredBy: request.jwtUser.id,
        triggeredAt: now,
        triggerBuildingId,
        triggerFloor: triggerFloor ? parseInt(String(triggerFloor), 10) : undefined,
        triggerRoom,
        notes,
        timeline: {
          create: {
            timestamp: now,
            action: `Incident created by ${request.jwtUser.email}`,
            actionType: 'PANIC_ACTIVATED' as any,
            actorType: 'STAFF',
            actorId: request.jwtUser.id,
            metadata: { type, severity },
          },
        },
      },
      include: {
        timeline: true,
      },
    });

    fastify.wsManager.broadcastToSite(siteId, 'incident.created', incident);

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'INCIDENT_CREATED',
        entity: 'Incident',
        entityId: incident.id,
        details: { type, severity, triggerBuildingId, triggerFloor, triggerRoom },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(incident);
  });

  // PUT /api/v1/incidents/:incidentId/status — Update incident status (FIRST_RESPONDER+)
  fastify.put<{
    Params: { incidentId: string };
    Body: { status: string; notes?: string };
  }>('/:incidentId/status', { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] }, async (request, reply) => {
    const { status } = request.body;
    const notes = sanitizeText(request.body.notes);

    if (!status) {
      return reply.code(400).send({ error: 'status is required' });
    }

    if (STATUS_ORDER[status] === undefined) {
      return reply.code(400).send({ error: `Invalid status: ${status}` });
    }

    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: request.params.incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    // Prevent going backwards past RESOLVED/FALSE_ALARM
    const currentOrder = STATUS_ORDER[incident.status] ?? 0;
    if (currentOrder >= STATUS_ORDER['RESOLVED_INCIDENT'] && status !== incident.status) {
      return reply.code(400).send({ error: 'Cannot change status of a resolved or false-alarm incident' });
    }

    const now = new Date();
    const data: any = { status: status as any };

    // Auto-set timestamp fields based on new status
    switch (status) {
      case 'DISPATCHED_INCIDENT':
        data.dispatchedAt = now;
        break;
      case 'ON_SCENE_INCIDENT':
        data.firstResponderArrival = now;
        break;
      case 'ALL_CLEAR_INCIDENT':
        data.allClearAt = now;
        break;
      case 'REUNIFICATION_INCIDENT':
        data.reunificationStartedAt = now;
        break;
      case 'RESOLVED_INCIDENT':
        data.resolvedAt = now;
        data.resolvedBy = request.jwtUser.id;
        break;
      case 'FALSE_ALARM':
        data.resolvedAt = now;
        data.resolvedBy = request.jwtUser.id;
        break;
    }

    if (notes) data.notes = notes;

    const updated = await fastify.prisma.incident.update({
      where: { id: incident.id },
      data,
    });

    // Create STATUS_CHANGE timeline entry
    await fastify.prisma.incidentTimeline.create({
      data: {
        incidentId: incident.id,
        timestamp: now,
        action: `Status changed from ${incident.status} to ${status}`,
        actionType: 'STATUS_CHANGE',
        actorType: 'STAFF',
        actorId: request.jwtUser.id,
        metadata: { previousStatus: incident.status, newStatus: status, notes },
      },
    });

    fastify.wsManager.broadcastToSite(updated.siteId, 'incident.status', {
      incidentId: updated.id,
      previousStatus: incident.status,
      status: updated.status,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: updated.siteId,
        userId: request.jwtUser.id,
        action: 'INCIDENT_STATUS_UPDATED',
        entity: 'Incident',
        entityId: updated.id,
        details: { previousStatus: incident.status, newStatus: status },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // POST /api/v1/incidents/:incidentId/timeline — Add manual timeline entry (any authenticated)
  fastify.post<{
    Params: { incidentId: string };
    Body: { action: string; metadata?: Record<string, any> };
  }>('/:incidentId/timeline', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { metadata } = request.body;
    const action = sanitizeText(request.body.action);

    if (!action) {
      return reply.code(400).send({ error: 'action is required' });
    }

    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: request.params.incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const isNote = !metadata;
    const entry = await fastify.prisma.incidentTimeline.create({
      data: {
        incidentId: incident.id,
        timestamp: new Date(),
        action,
        actionType: isNote ? 'NOTE_ADDED' : 'MANUAL_ENTRY',
        actorType: 'STAFF',
        actorId: request.jwtUser.id,
        metadata: metadata ?? undefined,
      },
    });

    fastify.wsManager.broadcastToSite(incident.siteId, 'incident.timeline', {
      incidentId: incident.id,
      entry,
    });

    return reply.code(201).send(entry);
  });

  // POST /api/v1/incidents/:incidentId/agencies — Add responding agency (SITE_ADMIN+)
  fastify.post<{
    Params: { incidentId: string };
    Body: { agencyId: string };
  }>('/:incidentId/agencies', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { agencyId } = request.body;

    if (!agencyId) {
      return reply.code(400).send({ error: 'agencyId is required' });
    }

    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: request.params.incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const incidentAgency = await fastify.prisma.incidentAgency.create({
      data: {
        incidentId: incident.id,
        agencyId,
        notifiedAt: new Date(),
      },
      include: { agency: true },
    });

    // Timeline entry
    await fastify.prisma.incidentTimeline.create({
      data: {
        incidentId: incident.id,
        timestamp: new Date(),
        action: `Agency ${incidentAgency.agency?.name || agencyId} added to incident`,
        actionType: 'DISPATCH_SENT' as any,
        actorType: 'ADMIN',
        actorId: request.jwtUser.id,
        metadata: { agencyId },
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: incident.siteId,
        userId: request.jwtUser.id,
        action: 'INCIDENT_AGENCY_ADDED',
        entity: 'IncidentAgency',
        entityId: `${incident.id}:${agencyId}`,
        details: { incidentId: incident.id, agencyId },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(incidentAgency);
  });

  // PUT /api/v1/incidents/:incidentId/agencies/:agencyId — Update agency status (SITE_ADMIN+)
  fastify.put<{
    Params: { incidentId: string; agencyId: string };
    Body: { acknowledgedAt?: string; onSceneAt?: string };
  }>('/:incidentId/agencies/:agencyId', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { incidentId, agencyId } = request.params;
    const { acknowledgedAt, onSceneAt } = request.body;

    // Verify incident belongs to user's sites
    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const data: any = {};
    if (acknowledgedAt) data.acknowledgedAt = new Date(acknowledgedAt);
    if (onSceneAt) data.onSceneAt = new Date(onSceneAt);

    const updated = await fastify.prisma.incidentAgency.update({
      where: {
        incidentId_agencyId: { incidentId, agencyId },
      },
      data,
      include: { agency: true },
    });

    return updated;
  });

  // GET /api/v1/incidents/:incidentId/timeline — Full timeline
  fastify.get<{
    Params: { incidentId: string };
    Querystring: { limit?: string; offset?: string };
  }>('/:incidentId/timeline', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { limit, offset } = request.query;

    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: request.params.incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const take = Math.min(parseInt(limit || '100', 10) || 100, 500);
    const skip = parseInt(offset || '0', 10) || 0;

    const entries = await fastify.prisma.incidentTimeline.findMany({
      where: { incidentId: incident.id },
      orderBy: { timestamp: 'desc' },
      take,
      skip,
    });

    return entries;
  });
};

export default incidentRoutes;
