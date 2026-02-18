import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Timing-safe API key comparison to prevent timing attacks.
 * Returns true if the provided key matches the expected key.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Compare against itself to burn the same time, then return false
    const buf = Buffer.from(a);
    crypto.timingSafeEqual(buf, buf);
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Pre-handler that validates the X-API-Key header against the DISPATCH_API_KEY env var.
 * Used for machine-to-machine PSAP/CAD integration endpoints.
 */
async function authenticateApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    return reply.code(401).send({ error: 'Missing X-API-Key header' });
  }

  const expectedKey = process.env.DISPATCH_API_KEY;
  if (!expectedKey) {
    request.log.error('DISPATCH_API_KEY environment variable is not configured');
    return reply.code(500).send({ error: 'Dispatch API key not configured' });
  }

  if (!timingSafeEqual(apiKey, expectedKey)) {
    return reply.code(401).send({ error: 'Invalid API key' });
  }
}

const dispatchRoutes: FastifyPluginAsync = async (fastify) => {

  // ============================================================================
  // PSAP Integration Routes (API key auth)
  // ============================================================================

  // POST /alerts — Receive/push a panic alert to PSAP
  fastify.post<{
    Body: {
      alertId: string;
      siteId: string;
      incidentType: string;
      severity: string;
      location: {
        buildingId?: string;
        floor?: number;
        room?: string;
        lat?: number;
        lng?: number;
      };
      description?: string;
    };
  }>('/alerts', {
    preHandler: [authenticateApiKey],
  }, async (request, reply) => {
    const { alertId, siteId, incidentType, severity, location } = request.body;
    const description = sanitizeText(request.body.description);

    if (!alertId || !siteId || !incidentType || !severity) {
      return reply.code(400).send({ error: 'alertId, siteId, incidentType, and severity are required' });
    }

    // Verify alert exists
    const alert = await fastify.prisma.alert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      return reply.code(404).send({ error: 'Alert not found' });
    }

    const now = new Date();

    // Create or update incident for this alert
    let incident = await fastify.prisma.incident.findFirst({
      where: {
        siteId,
        status: { in: ['TRIGGERED_INCIDENT', 'DISPATCHED_INCIDENT', 'RESPONDING_INCIDENT'] as any[] },
      },
      orderBy: { triggeredAt: 'desc' },
    });

    if (!incident) {
      incident = await fastify.prisma.incident.create({
        data: {
          siteId,
          type: (incidentType as any) || 'OTHER_INCIDENT',
          status: 'DISPATCHED_INCIDENT' as any,
          severity: (severity as any) || 'HIGH_INCIDENT',
          triggeredAt: now,
          dispatchedAt: now,
          triggerBuildingId: location?.buildingId,
          triggerFloor: location?.floor,
          triggerRoom: location?.room,
          triggerLat: location?.lat,
          triggerLng: location?.lng,
          notes: description || undefined,
        },
      });
    } else {
      incident = await fastify.prisma.incident.update({
        where: { id: incident.id },
        data: {
          status: 'DISPATCHED_INCIDENT' as any,
          dispatchedAt: incident.dispatchedAt ?? now,
        },
      });
    }

    // Create dispatch record
    const dispatchRecord = await fastify.prisma.dispatchRecord.create({
      data: {
        alertId,
        method: 'CONSOLE' as any,
        status: 'SENT' as any,
        sentAt: now,
        metadata: {
          incidentId: incident.id,
          incidentType,
          severity,
          location,
          description,
        },
      },
    });

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        action: 'DISPATCH_ALERT_PUSHED',
        entity: 'DispatchRecord',
        entityId: dispatchRecord.id,
        details: {
          alertId,
          incidentId: incident.id,
          incidentType,
          severity,
        },
        ipAddress: request.ip,
      },
    });

    // Real-time broadcast
    fastify.wsManager.broadcastToSite(siteId, 'dispatch.alert', {
      dispatchRecordId: dispatchRecord.id,
      alertId,
      incidentId: incident.id,
      status: 'SENT',
    });

    return reply.code(201).send({
      dispatchRecord,
      incident: {
        id: incident.id,
        status: incident.status,
      },
    });
  });

  // POST /alerts/:alertId/acknowledge — PSAP acknowledges receipt
  fastify.post<{
    Params: { alertId: string };
    Body: {
      dispatchRecordId?: string;
      acknowledgedBy?: string;
    };
  }>('/alerts/:alertId/acknowledge', {
    preHandler: [authenticateApiKey],
  }, async (request, reply) => {
    const { alertId } = request.params;
    const { dispatchRecordId } = request.body;
    const acknowledgedBy = sanitizeText(request.body.acknowledgedBy);

    const alert = await fastify.prisma.alert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      return reply.code(404).send({ error: 'Alert not found' });
    }

    const now = new Date();

    // Find dispatch record — by ID if provided, otherwise most recent for this alert
    let dispatchRecord;
    if (dispatchRecordId) {
      dispatchRecord = await fastify.prisma.dispatchRecord.findUnique({
        where: { id: dispatchRecordId },
      });
    } else {
      dispatchRecord = await fastify.prisma.dispatchRecord.findFirst({
        where: { alertId },
        orderBy: { sentAt: 'desc' },
      });
    }

    if (!dispatchRecord) {
      return reply.code(404).send({ error: 'Dispatch record not found' });
    }

    // Update dispatch record confirmedAt
    const updatedRecord = await fastify.prisma.dispatchRecord.update({
      where: { id: dispatchRecord.id },
      data: {
        confirmedAt: now,
        status: 'RECEIVED' as any,
        responseTimeMs: Math.round(now.getTime() - dispatchRecord.sentAt.getTime()),
      },
    });

    // Find active incident for this site and update dispatchedAt if not set
    const incident = await fastify.prisma.incident.findFirst({
      where: {
        siteId: alert.siteId,
        status: { notIn: ['RESOLVED_INCIDENT', 'FALSE_ALARM'] as any[] },
      },
      orderBy: { triggeredAt: 'desc' },
    });

    if (incident && !incident.dispatchedAt) {
      await fastify.prisma.incident.update({
        where: { id: incident.id },
        data: { dispatchedAt: now },
      });
    }

    // Create incident timeline entry
    if (incident) {
      await fastify.prisma.incidentTimeline.create({
        data: {
          incidentId: incident.id,
          timestamp: now,
          action: `Dispatch acknowledged${acknowledgedBy ? ` by ${acknowledgedBy}` : ''}`,
          actionType: 'DISPATCH_ACKNOWLEDGED' as any,
          actorType: 'SYSTEM',
          metadata: {
            dispatchRecordId: updatedRecord.id,
            acknowledgedBy,
            responseTimeMs: updatedRecord.responseTimeMs,
          },
        },
      });
    }

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        action: 'DISPATCH_ACKNOWLEDGED',
        entity: 'DispatchRecord',
        entityId: updatedRecord.id,
        details: {
          alertId,
          acknowledgedBy,
          responseTimeMs: updatedRecord.responseTimeMs,
        },
        ipAddress: request.ip,
      },
    });

    fastify.wsManager.broadcastToSite(alert.siteId, 'dispatch.acknowledged', {
      dispatchRecordId: updatedRecord.id,
      alertId,
      incidentId: incident?.id,
      acknowledgedBy,
    });

    return reply.code(200).send({
      dispatchRecord: updatedRecord,
      incidentId: incident?.id,
    });
  });

  // POST /alerts/:alertId/dispatch — Units dispatched
  fastify.post<{
    Params: { alertId: string };
    Body: {
      unitCount?: number;
      unitIds?: string[];
      estimatedArrival?: string;
    };
  }>('/alerts/:alertId/dispatch', {
    preHandler: [authenticateApiKey],
  }, async (request, reply) => {
    const { alertId } = request.params;
    const { unitCount, unitIds, estimatedArrival } = request.body;

    const alert = await fastify.prisma.alert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      return reply.code(404).send({ error: 'Alert not found' });
    }

    const now = new Date();

    // Find active incident and update status to RESPONDING_INCIDENT
    const incident = await fastify.prisma.incident.findFirst({
      where: {
        siteId: alert.siteId,
        status: { notIn: ['RESOLVED_INCIDENT', 'FALSE_ALARM'] as any[] },
      },
      orderBy: { triggeredAt: 'desc' },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'No active incident found for this alert' });
    }

    const updatedIncident = await fastify.prisma.incident.update({
      where: { id: incident.id },
      data: {
        status: 'RESPONDING_INCIDENT' as any,
      },
    });

    // Create timeline entry
    await fastify.prisma.incidentTimeline.create({
      data: {
        incidentId: incident.id,
        timestamp: now,
        action: `${unitCount || unitIds?.length || 'Unknown number of'} unit(s) dispatched${estimatedArrival ? `, ETA: ${estimatedArrival}` : ''}`,
        actionType: 'RESPONDER_EN_ROUTE' as any,
        actorType: 'SYSTEM',
        metadata: {
          unitCount,
          unitIds,
          estimatedArrival,
        },
      },
    });

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        action: 'DISPATCH_UNITS_DISPATCHED',
        entity: 'Incident',
        entityId: incident.id,
        details: { alertId, unitCount, unitIds, estimatedArrival },
        ipAddress: request.ip,
      },
    });

    fastify.wsManager.broadcastToSite(alert.siteId, 'dispatch.units_dispatched', {
      incidentId: incident.id,
      alertId,
      unitCount,
      unitIds,
      estimatedArrival,
    });

    return reply.code(200).send({
      incident: {
        id: updatedIncident.id,
        status: updatedIncident.status,
      },
      dispatched: {
        unitCount,
        unitIds,
        estimatedArrival,
      },
    });
  });

  // POST /alerts/:alertId/on-scene — First unit on scene
  fastify.post<{
    Params: { alertId: string };
    Body: {
      officerId?: string;
      officerName?: string;
    };
  }>('/alerts/:alertId/on-scene', {
    preHandler: [authenticateApiKey],
  }, async (request, reply) => {
    const { alertId } = request.params;
    const { officerId } = request.body;
    const officerName = sanitizeText(request.body.officerName);

    const alert = await fastify.prisma.alert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      return reply.code(404).send({ error: 'Alert not found' });
    }

    const now = new Date();

    // Find active incident
    const incident = await fastify.prisma.incident.findFirst({
      where: {
        siteId: alert.siteId,
        status: { notIn: ['RESOLVED_INCIDENT', 'FALSE_ALARM'] as any[] },
      },
      orderBy: { triggeredAt: 'desc' },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'No active incident found for this alert' });
    }

    // Update incident: first responder arrival + ON_SCENE status
    const updatedIncident = await fastify.prisma.incident.update({
      where: { id: incident.id },
      data: {
        firstResponderArrival: incident.firstResponderArrival ?? now,
        status: 'ON_SCENE' as any,
      },
    });

    // Calculate response time from trigger to on-scene
    const responseTimeMs = now.getTime() - incident.triggeredAt.getTime();

    // Create timeline entry
    await fastify.prisma.incidentTimeline.create({
      data: {
        incidentId: incident.id,
        timestamp: now,
        action: `First responder on scene${officerName ? `: ${officerName}` : ''}${officerId ? ` (${officerId})` : ''}`,
        actionType: 'RESPONDER_ON_SCENE' as any,
        actorType: 'SYSTEM',
        metadata: {
          officerId,
          officerName,
          responseTimeMs,
        },
      },
    });

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        action: 'DISPATCH_ON_SCENE',
        entity: 'Incident',
        entityId: incident.id,
        details: { alertId, officerId, officerName, responseTimeMs },
        ipAddress: request.ip,
      },
    });

    fastify.wsManager.broadcastToSite(alert.siteId, 'dispatch.on_scene', {
      incidentId: incident.id,
      alertId,
      officerId,
      officerName,
      responseTimeMs,
    });

    return reply.code(200).send({
      incident: {
        id: updatedIncident.id,
        status: updatedIncident.status,
        firstResponderArrival: updatedIncident.firstResponderArrival,
      },
      responseTimeMs,
    });
  });

  // GET /schools/:schoolId/facility-data — Facility data for CAD systems
  fastify.get<{
    Params: { schoolId: string };
  }>('/schools/:schoolId/facility-data', {
    preHandler: [authenticateApiKey],
  }, async (request, reply) => {
    const { schoolId } = request.params;

    const site = await fastify.prisma.site.findUnique({
      where: { id: schoolId },
      include: {
        buildings: {
          include: {
            rooms: true,
            floorPlans: {
              select: {
                id: true,
                floor: true,
                floorName: true,
                imageUrl: true,
                imageWidth: true,
                imageHeight: true,
              },
            },
          },
        },
      },
    });

    if (!site) {
      return reply.code(404).send({ error: 'School/site not found' });
    }

    // Door count and status summary
    const doors = await fastify.prisma.door.findMany({
      where: { siteId: schoolId },
      select: { id: true, status: true, name: true, buildingId: true, isExterior: true, isEmergencyExit: true },
    });

    const doorStatusSummary: Record<string, number> = {};
    for (const door of doors) {
      doorStatusSummary[door.status] = (doorStatusSummary[door.status] || 0) + 1;
    }

    // Key holders
    const keyHolders = await fastify.prisma.keyHolder.findMany({
      where: { siteId: schoolId },
      orderBy: { priority: 'asc' },
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        hasKeys: true,
        hasAccessCard: true,
        hasAlarmCode: true,
        priority: true,
      },
    });

    // Floor plans across all buildings
    const floorPlans = site.buildings.flatMap((b) =>
      b.floorPlans.map((fp) => ({
        ...fp,
        buildingId: b.id,
        buildingName: b.name,
      }))
    );

    // Population estimate: sum of room capacities
    const totalCapacity = site.buildings.reduce((sum, b) =>
      sum + b.rooms.reduce((rSum, r) => rSum + (r.capacity || 0), 0), 0
    );

    // Audit log for facility data access
    await fastify.prisma.auditLog.create({
      data: {
        siteId: schoolId,
        action: 'FACILITY_DATA_ACCESSED',
        entity: 'Site',
        entityId: schoolId,
        details: { source: 'dispatch_api' },
        ipAddress: request.ip,
      },
    });

    return reply.code(200).send({
      site: {
        id: site.id,
        name: site.name,
        district: site.district,
        address: site.address,
        city: site.city,
        state: site.state,
        zip: site.zip,
        latitude: site.latitude,
        longitude: site.longitude,
        timezone: site.timezone,
      },
      buildings: site.buildings.map((b) => ({
        id: b.id,
        name: b.name,
        floors: b.floors,
        roomCount: b.rooms.length,
      })),
      doors: {
        total: doors.length,
        statusSummary: doorStatusSummary,
        exteriorCount: doors.filter((d) => d.isExterior).length,
        emergencyExitCount: doors.filter((d) => d.isEmergencyExit).length,
      },
      floorPlans,
      keyHolders,
      stagingAreas: [], // placeholder — no model yet, returned empty for CAD schema compliance
      hazards: [], // placeholder — no model yet, returned empty for CAD schema compliance
      population: {
        estimatedCapacity: totalCapacity,
      },
    });
  });

  // ============================================================================
  // RapidSOS Integration Routes (API key auth)
  // ============================================================================

  // POST /rapidsos/alert — Push alert to RapidSOS
  fastify.post<{
    Body: {
      alertId: string;
      incidentId: string;
    };
  }>('/rapidsos/alert', {
    preHandler: [authenticateApiKey],
  }, async (request, reply) => {
    const { alertId, incidentId } = request.body;

    if (!alertId || !incidentId) {
      return reply.code(400).send({ error: 'alertId and incidentId are required' });
    }

    const alert = await fastify.prisma.alert.findUnique({
      where: { id: alertId },
      include: {
        site: true,
        triggeredBy: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    if (!alert) {
      return reply.code(404).send({ error: 'Alert not found' });
    }

    const incident = await fastify.prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const now = new Date();

    // Format RapidSOS-compatible payload
    const rapidSosPayload = {
      callerId: alert.triggeredBy?.phone || alert.triggeredBy?.email || 'unknown',
      callerName: alert.triggeredBy?.name || 'Unknown',
      location: {
        civic: {
          address: alert.site.address,
          city: alert.site.city,
          state: alert.site.state,
          zip: alert.site.zip,
          country: 'US',
        },
        coordinates: {
          latitude: alert.latitude || alert.site.latitude,
          longitude: alert.longitude || alert.site.longitude,
        },
        building: alert.buildingName,
        floor: alert.floor,
        room: alert.roomName,
      },
      incidentType: incident.type,
      severity: incident.severity,
      alertTime: alert.triggeredAt.toISOString(),
      additionalData: {
        schoolName: alert.site.name,
        district: alert.site.district,
        alertLevel: alert.level,
        alertSource: alert.source,
        message: alert.message,
        siteId: alert.siteId,
        incidentId: incident.id,
      },
    };

    // Create dispatch record for RapidSOS
    const dispatchRecord = await fastify.prisma.dispatchRecord.create({
      data: {
        alertId,
        method: 'RAPIDSОС' as any, // matches DispatchMethod enum
        status: 'SENT' as any,
        sentAt: now,
        metadata: {
          incidentId,
          rapidSosPayload,
        },
      },
    });

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        action: 'RAPIDSOS_ALERT_PUSHED',
        entity: 'DispatchRecord',
        entityId: dispatchRecord.id,
        details: { alertId, incidentId },
        ipAddress: request.ip,
      },
    });

    fastify.wsManager.broadcastToSite(alert.siteId, 'dispatch.rapidsos_alert', {
      dispatchRecordId: dispatchRecord.id,
      alertId,
      incidentId,
    });

    return reply.code(201).send({
      dispatchRecord,
      rapidSosPayload,
    });
  });

  // POST /rapidsos/location-update — Update location for active incident
  fastify.post<{
    Body: {
      incidentId: string;
      coordinates: {
        latitude: number;
        longitude: number;
      };
      buildingId?: string;
      floor?: number;
      room?: string;
    };
  }>('/rapidsos/location-update', {
    preHandler: [authenticateApiKey],
  }, async (request, reply) => {
    const { incidentId, coordinates, buildingId, floor, room } = request.body;

    if (!incidentId || !coordinates?.latitude || !coordinates?.longitude) {
      return reply.code(400).send({ error: 'incidentId and coordinates (latitude, longitude) are required' });
    }

    const incident = await fastify.prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    // Update incident trigger location
    const updatedIncident = await fastify.prisma.incident.update({
      where: { id: incidentId },
      data: {
        triggerLat: coordinates.latitude,
        triggerLng: coordinates.longitude,
        triggerBuildingId: buildingId ?? incident.triggerBuildingId,
        triggerFloor: floor ?? incident.triggerFloor,
        triggerRoom: room ?? incident.triggerRoom,
      },
    });

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId: incident.siteId,
        action: 'RAPIDSOS_LOCATION_UPDATED',
        entity: 'Incident',
        entityId: incidentId,
        details: { coordinates, buildingId, floor, room },
        ipAddress: request.ip,
      },
    });

    fastify.wsManager.broadcastToSite(incident.siteId, 'dispatch.location_update', {
      incidentId,
      coordinates,
      buildingId,
      floor,
      room,
    });

    return reply.code(200).send({
      incidentId: updatedIncident.id,
      location: {
        latitude: updatedIncident.triggerLat,
        longitude: updatedIncident.triggerLng,
        buildingId: updatedIncident.triggerBuildingId,
        floor: updatedIncident.triggerFloor,
        room: updatedIncident.triggerRoom,
      },
    });
  });

  // POST /rapidsos/supplemental — Push supplemental data for incident
  fastify.post<{
    Body: {
      incidentId: string;
    };
  }>('/rapidsos/supplemental', {
    preHandler: [authenticateApiKey],
  }, async (request, reply) => {
    const { incidentId } = request.body;

    if (!incidentId) {
      return reply.code(400).send({ error: 'incidentId is required' });
    }

    const incident = await fastify.prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        site: {
          include: {
            buildings: {
              include: {
                floorPlans: {
                  select: {
                    id: true,
                    floor: true,
                    floorName: true,
                    imageUrl: true,
                    buildingName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    // Floor plan URLs
    const floorPlanUrls = incident.site.buildings.flatMap((b) =>
      b.floorPlans.map((fp) => ({
        buildingName: fp.buildingName,
        floor: fp.floor,
        floorName: fp.floorName,
        url: fp.imageUrl,
      }))
    );

    // Camera count (count cameras registered at this site via environmental sensors or other means)
    // Using a simple count query — cameras are tracked in the Door/Building context
    // For now, count any devices on floor plans that are cameras
    let cameraCount = 0;
    for (const building of incident.site.buildings) {
      for (const floorPlan of building.floorPlans) {
        const devices = await fastify.prisma.floorPlanDevice.count({
          where: {
            planId: floorPlan.id,
            type: 'CAMERA' as any,
          },
        });
        cameraCount += devices;
      }
    }

    // Door status summary
    const doors = await fastify.prisma.door.findMany({
      where: { siteId: incident.siteId },
      select: { status: true },
    });

    const doorStatusSummary: Record<string, number> = {};
    for (const door of doors) {
      doorStatusSummary[door.status] = (doorStatusSummary[door.status] || 0) + 1;
    }

    // Key holders
    const keyHolders = await fastify.prisma.keyHolder.findMany({
      where: { siteId: incident.siteId },
      orderBy: { priority: 'asc' },
      select: {
        name: true,
        role: true,
        phone: true,
        hasKeys: true,
        hasAccessCard: true,
        priority: true,
      },
    });

    const supplementalPackage = {
      incidentId: incident.id,
      siteId: incident.siteId,
      siteName: incident.site.name,
      floorPlans: floorPlanUrls,
      cameras: {
        totalCount: cameraCount,
      },
      doors: {
        totalCount: doors.length,
        statusSummary: doorStatusSummary,
      },
      keyHolders,
    };

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId: incident.siteId,
        action: 'RAPIDSOS_SUPPLEMENTAL_PUSHED',
        entity: 'Incident',
        entityId: incidentId,
        details: { floorPlanCount: floorPlanUrls.length, cameraCount, doorCount: doors.length },
        ipAddress: request.ip,
      },
    });

    return reply.code(200).send(supplementalPackage);
  });
};

export default dispatchRoutes;
