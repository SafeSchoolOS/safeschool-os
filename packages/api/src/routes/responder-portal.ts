import type { FastifyPluginAsync } from 'fastify';
import { authenticateResponder, requireResponderPermission } from '../middleware/responder-auth.js';
import { sanitizeText } from '../utils/sanitize.js';

async function verifySchoolAccess(prisma: any, agencyId: string, siteId: string) {
  const link = await prisma.schoolAgencyLink.findFirst({
    where: { agencyId, siteId, status: 'ACTIVE_LINK' },
  });
  if (!link) return null;
  // Check if expired
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;
  return link;
}

async function verifyIncidentAccess(prisma: any, agencyId: string, incidentId: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
  });
  if (!incident) return null;

  const link = await prisma.schoolAgencyLink.findFirst({
    where: { agencyId, siteId: incident.siteId, status: 'ACTIVE_LINK' },
  });
  if (!link) return null;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;

  return { incident, link };
}

const responderPortalRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /schools — List schools this agency has access to
  fastify.get('/schools', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;

    const links = await fastify.prisma.schoolAgencyLink.findMany({
      where: {
        agencyId,
        status: 'ACTIVE_LINK',
      },
      include: {
        site: {
          select: {
            id: true,
            name: true,
            district: true,
            address: true,
            city: true,
            state: true,
            zip: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    });

    // Filter out expired links
    const activeLinks = links.filter(
      (link: any) => !link.expiresAt || new Date(link.expiresAt) >= new Date()
    );

    const schools = activeLinks.map((link: any) => ({
      ...link.site,
      accessLevel: link.accessLevel,
      linkStatus: link.status,
      mouSigned: link.mouSigned,
      expiresAt: link.expiresAt,
    }));

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_SCHOOLS',
        resourceType: 'SchoolAgencyLink',
        resourceId: null,
        siteId: null,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return schools;
  });

  // GET /schools/:siteId — School detail + facility info
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const site = await fastify.prisma.site.findUnique({
      where: { id: siteId },
      select: {
        id: true,
        name: true,
        district: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        latitude: true,
        longitude: true,
        timezone: true,
        _count: {
          select: {
            buildings: true,
            doors: true,
          },
        },
      },
    });

    if (!site) {
      return reply.code(404).send({ error: 'Site not found' });
    }

    const studentCount = await fastify.prisma.student.count({
      where: { siteId, isActive: true },
    });

    const staffCount = await fastify.prisma.userSite.count({
      where: { siteId },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_SCHOOL_DETAIL',
        resourceType: 'Site',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return {
      ...site,
      accessLevel: link.accessLevel,
      population: {
        students: studentCount,
        staff: staffCount,
        total: studentCount + staffCount,
      },
    };
  });

  // GET /schools/:siteId/buildings — Building list with details
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/buildings', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const buildings = await fastify.prisma.building.findMany({
      where: { siteId },
      include: {
        _count: {
          select: {
            rooms: true,
            doors: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_BUILDINGS',
        resourceType: 'Building',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return buildings;
  });

  // GET /schools/:siteId/floorplans — All floor plans with device overlays
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/floorplans', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const floorPlans = await fastify.prisma.floorPlan.findMany({
      where: { siteId },
      include: {
        devices: true,
        annotations: true,
      },
      orderBy: [{ buildingName: 'asc' }, { floor: 'asc' }],
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_FLOOR_PLANS',
        resourceType: 'FloorPlan',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return floorPlans;
  });

  // GET /schools/:siteId/floorplans/:floorId — Single floor plan
  fastify.get<{ Params: { siteId: string; floorId: string } }>('/schools/:siteId/floorplans/:floorId', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId, floorId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const floorPlan = await fastify.prisma.floorPlan.findFirst({
      where: { id: floorId, siteId },
      include: {
        devices: true,
        annotations: true,
      },
    });

    if (!floorPlan) {
      return reply.code(404).send({ error: 'Floor plan not found' });
    }

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_FLOOR_PLAN',
        resourceType: 'FloorPlan',
        resourceId: floorId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return floorPlan;
  });

  // GET /schools/:siteId/doors — Door inventory with lock status
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/doors', { preHandler: [authenticateResponder, requireResponderPermission('VIEW_DOOR_STATUS')] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const doors = await fastify.prisma.door.findMany({
      where: { siteId },
      orderBy: [{ buildingId: 'asc' }, { name: 'asc' }],
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_DOOR_STATUS',
        resourceType: 'Door',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return doors;
  });

  // GET /schools/:siteId/cameras — Camera inventory (placeholder)
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/cameras', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_CAMERAS',
        resourceType: 'Camera',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return [];
  });

  // GET /schools/:siteId/contacts — Key holders and emergency contacts
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/contacts', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const keyHolders = await fastify.prisma.keyHolder.findMany({
      where: { siteId },
      orderBy: { priority: 'asc' },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_CONTACTS',
        resourceType: 'KeyHolder',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return keyHolders;
  });

  // GET /schools/:siteId/reunification — Reunification site details
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/reunification', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const reunificationSites = await fastify.prisma.fRReunificationSite.findMany({
      where: { siteId },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_REUNIFICATION_SITES',
        resourceType: 'FRReunificationSite',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return reunificationSites;
  });

  // GET /schools/:siteId/staging — Staging areas
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/staging', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const stagingAreas = await fastify.prisma.stagingArea.findMany({
      where: { siteId },
      orderBy: { name: 'asc' },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_STAGING_AREAS',
        resourceType: 'StagingArea',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return stagingAreas;
  });

  // GET /schools/:siteId/hazards — Hazard locations
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/hazards', { preHandler: [authenticateResponder, requireResponderPermission('VIEW_FLOOR_PLANS')] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const hazards = await fastify.prisma.hazardLocation.findMany({
      where: { siteId },
      orderBy: [{ type: 'asc' }, { floor: 'asc' }],
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_HAZARDS',
        resourceType: 'HazardLocation',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return hazards;
  });

  // GET /schools/:siteId/population — Population data
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/population', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const students = await fastify.prisma.student.findMany({
      where: { siteId, isActive: true },
      select: { grade: true },
    });

    const gradeBreakdown: Record<string, number> = {};
    for (const student of students) {
      const grade = student.grade || 'Unknown';
      gradeBreakdown[grade] = (gradeBreakdown[grade] || 0) + 1;
    }

    const staffMembers = await fastify.prisma.userSite.findMany({
      where: { siteId },
      include: {
        user: {
          select: { role: true },
        },
      },
    });

    const roleBreakdown: Record<string, number> = {};
    for (const member of staffMembers) {
      const role = member.user.role;
      roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
    }

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_POPULATION',
        resourceType: 'Population',
        resourceId: siteId,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return {
      students: {
        total: students.length,
        byGrade: gradeBreakdown,
      },
      staff: {
        total: staffMembers.length,
        byRole: roleBreakdown,
      },
      grandTotal: students.length + staffMembers.length,
    };
  });

  // GET /schools/:siteId/data-package — Get latest data package
  fastify.get<{ Params: { siteId: string } }>('/schools/:siteId/data-package', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { siteId } = request.params;

    const link = await verifySchoolAccess(fastify.prisma, agencyId, siteId);
    if (!link) {
      return reply.code(403).send({ error: 'No active access to this school' });
    }

    const dataPackage = await fastify.prisma.dataPackage.findFirst({
      where: { siteId },
      orderBy: { generatedAt: 'desc' },
    });

    if (!dataPackage) {
      return reply.code(404).send({ error: 'No data package available for this site' });
    }

    await fastify.prisma.dataPackageDownload.create({
      data: {
        dataPackageId: dataPackage.id,
        downloadedBy: request.responderUser!.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_DATA_PACKAGE',
        resourceType: 'DataPackage',
        resourceId: dataPackage.id,
        siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return dataPackage;
  });

  // ========== Active Incident Routes ==========

  // GET /incidents — List active incidents for linked schools
  fastify.get<{ Querystring: { status?: string; siteId?: string } }>('/incidents', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { status, siteId } = request.query;

    // Get all active links for this agency
    const links = await fastify.prisma.schoolAgencyLink.findMany({
      where: {
        agencyId,
        status: 'ACTIVE_LINK',
      },
    });

    // Filter out expired links
    const activeLinks = links.filter(
      (link: any) => !link.expiresAt || new Date(link.expiresAt) >= new Date()
    );

    let linkedSiteIds = activeLinks.map((link: any) => link.siteId);

    // If siteId filter is provided, narrow down to that site only (if agency has access)
    if (siteId) {
      if (!linkedSiteIds.includes(siteId)) {
        return reply.code(403).send({ error: 'No active access to this school' });
      }
      linkedSiteIds = [siteId];
    }

    const where: any = {
      siteId: { in: linkedSiteIds },
    };

    // If status filter is explicitly set, use it; otherwise exclude resolved/false alarm
    if (status) {
      where.status = status;
    } else {
      where.status = { notIn: ['RESOLVED_INCIDENT', 'FALSE_ALARM'] };
    }

    const incidents = await fastify.prisma.incident.findMany({
      where,
      include: {
        respondingAgencies: {
          include: {
            agency: { select: { id: true, name: true } },
          },
        },
        site: { select: { id: true, name: true } },
      },
      orderBy: { triggeredAt: 'desc' },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_INCIDENTS',
        resourceType: 'Incident',
        resourceId: null,
        siteId: siteId || null,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return incidents;
  });

  // GET /incidents/:incidentId — Incident detail with timeline and responding agencies
  fastify.get<{ Params: { incidentId: string } }>('/incidents/:incidentId', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { incidentId } = request.params;

    const access = await verifyIncidentAccess(fastify.prisma, agencyId, incidentId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this incident' });
    }

    const incident = await fastify.prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        timeline: {
          orderBy: { timestamp: 'desc' },
          take: 50,
        },
        respondingAgencies: {
          include: {
            agency: { select: { id: true, name: true } },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            state: true,
            zip: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_INCIDENT_DETAIL',
        resourceType: 'Incident',
        resourceId: incidentId,
        siteId: access.incident.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return incident;
  });

  // GET /incidents/:incidentId/timeline — Full timeline with pagination
  fastify.get<{ Params: { incidentId: string }; Querystring: { limit?: string; offset?: string } }>('/incidents/:incidentId/timeline', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { incidentId } = request.params;
    const limit = Math.min(Math.max(parseInt(request.query.limit || '100', 10) || 100, 1), 500);
    const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);

    const access = await verifyIncidentAccess(fastify.prisma, agencyId, incidentId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this incident' });
    }

    const [timeline, total] = await Promise.all([
      fastify.prisma.incidentTimeline.findMany({
        where: { incidentId },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      fastify.prisma.incidentTimeline.count({
        where: { incidentId },
      }),
    ]);

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_INCIDENT_TIMELINE',
        resourceType: 'IncidentTimeline',
        resourceId: incidentId,
        siteId: access.incident.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return { timeline, total, limit, offset };
  });

  // POST /incidents/:incidentId/timeline — Add a note to timeline
  fastify.post<{ Params: { incidentId: string }; Body: { action: string; metadata?: Record<string, unknown> } }>('/incidents/:incidentId/timeline', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { incidentId } = request.params;
    const { action, metadata } = request.body;

    if (!action || typeof action !== 'string') {
      return reply.code(400).send({ error: 'action is required and must be a string' });
    }

    const access = await verifyIncidentAccess(fastify.prisma, agencyId, incidentId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this incident' });
    }

    const sanitizedAction = sanitizeText(action);

    const entry = await fastify.prisma.incidentTimeline.create({
      data: {
        incidentId,
        actionType: 'NOTE_ADDED',
        action: sanitizedAction,
        actorType: 'RESPONDER',
        actorId: request.responderUser!.id,
        metadata: metadata ? (metadata as any) : undefined,
      },
    });

    // Broadcast via WebSocket
    fastify.wsManager.broadcastToSite(access.incident.siteId, 'incident.timeline', {
      incidentId,
      entry,
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'ADD_TIMELINE_NOTE',
        resourceType: 'IncidentTimeline',
        resourceId: entry.id,
        siteId: access.incident.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return reply.code(201).send(entry);
  });

  // GET /incidents/:incidentId/doors — Doors with lock status for incident site
  fastify.get<{ Params: { incidentId: string } }>('/incidents/:incidentId/doors', { preHandler: [authenticateResponder, requireResponderPermission('VIEW_DOOR_STATUS')] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { incidentId } = request.params;

    const access = await verifyIncidentAccess(fastify.prisma, agencyId, incidentId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this incident' });
    }

    const doors = await fastify.prisma.door.findMany({
      where: { siteId: access.incident.siteId },
      orderBy: [{ buildingId: 'asc' }, { name: 'asc' }],
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_INCIDENT_DOORS',
        resourceType: 'Door',
        resourceId: incidentId,
        siteId: access.incident.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return doors;
  });

  // GET /incidents/:incidentId/visitors — Active visitors at incident site
  fastify.get<{ Params: { incidentId: string } }>('/incidents/:incidentId/visitors', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { incidentId } = request.params;

    const access = await verifyIncidentAccess(fastify.prisma, agencyId, incidentId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this incident' });
    }

    const visitors = await fastify.prisma.visitor.findMany({
      where: {
        siteId: access.incident.siteId,
        checkedOutAt: null,
      },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_INCIDENT_VISITORS',
        resourceType: 'Visitor',
        resourceId: incidentId,
        siteId: access.incident.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return visitors;
  });

  // GET /incidents/:incidentId/accountability — Accountability data (placeholder)
  fastify.get<{ Params: { incidentId: string } }>('/incidents/:incidentId/accountability', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { incidentId } = request.params;

    const access = await verifyIncidentAccess(fastify.prisma, agencyId, incidentId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this incident' });
    }

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_ACCOUNTABILITY',
        resourceType: 'Incident',
        resourceId: incidentId,
        siteId: access.incident.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return {
      classrooms: [],
      totalStudents: 0,
      accountedFor: 0,
      missing: 0,
    };
  });
};

export default responderPortalRoutes;
