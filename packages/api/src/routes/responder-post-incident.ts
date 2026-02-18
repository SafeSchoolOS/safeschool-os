import type { FastifyPluginAsync } from 'fastify';
import { authenticateResponder, requireResponderPermission } from '../middleware/responder-auth.js';
import { sanitizeText } from '../utils/sanitize.js';

async function verifyIncidentAccess(prisma: any, agencyId: string, incidentId: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { site: true },
  });
  if (!incident) return null;

  const link = await prisma.schoolAgencyLink.findFirst({
    where: { agencyId, siteId: incident.siteId, status: 'ACTIVE_LINK' },
  });
  if (!link) return null;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;

  return { incident, link };
}

const responderPostIncidentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /incidents/:incidentId/report — Generate incident summary report
  fastify.get<{ Params: { incidentId: string } }>(
    '/incidents/:incidentId/report',
    { preHandler: [authenticateResponder] },
    async (request, reply) => {
      const responder = request.responderUser!;
      const { incidentId } = request.params;

      const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
      if (!access) {
        return reply.code(403).send({ error: 'No active access to this incident' });
      }

      const { incident } = access;

      const [timeline, respondingAgencies, doorCommands, messagesCount] = await Promise.all([
        fastify.prisma.incidentTimeline.findMany({
          where: { incidentId },
          orderBy: { timestamp: 'asc' },
        }),
        fastify.prisma.incidentAgency.findMany({
          where: { incidentId },
          include: {
            agency: { select: { id: true, name: true, type: true } },
          },
        }),
        fastify.prisma.doorCommand.findMany({
          where: { incidentId },
          orderBy: { createdAt: 'asc' },
        }),
        fastify.prisma.secureMessage.count({
          where: { incidentId },
        }),
      ]);

      const now = new Date();
      const triggeredAt = new Date(incident.triggeredAt);
      const resolvedAt = incident.resolvedAt ? new Date(incident.resolvedAt) : null;
      const endTime = resolvedAt || now;
      const durationMs = endTime.getTime() - triggeredAt.getTime();
      const durationMinutes = Math.round(durationMs / 60000);

      await fastify.prisma.responderAuditLog.create({
        data: {
          responderUserId: responder.id,
          action: 'VIEW_INCIDENT_REPORT',
          resourceType: 'Incident',
          resourceId: incidentId,
          siteId: incident.siteId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || '',
        },
      });

      return {
        incident: {
          id: incident.id,
          type: incident.type,
          severity: incident.severity,
          status: incident.status,
          triggeredAt: incident.triggeredAt,
          resolvedAt: incident.resolvedAt,
          site: {
            id: incident.site.id,
            name: incident.site.name,
          },
        },
        timeline,
        respondingAgencies: respondingAgencies.map((ra: any) => ({
          agencyId: ra.agency.id,
          agencyName: ra.agency.name,
          agencyType: ra.agency.type,
          respondedAt: ra.respondedAt,
          status: ra.status,
        })),
        doorCommands,
        messagesCount,
        duration: {
          minutes: durationMinutes,
          startedAt: incident.triggeredAt,
          endedAt: resolvedAt || null,
          isOngoing: !resolvedAt,
        },
      };
    },
  );

  // GET /incidents/:incidentId/logs — Access control event logs during the incident
  fastify.get<{ Params: { incidentId: string } }>(
    '/incidents/:incidentId/logs',
    { preHandler: [authenticateResponder] },
    async (request, reply) => {
      const responder = request.responderUser!;
      const { incidentId } = request.params;

      const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
      if (!access) {
        return reply.code(403).send({ error: 'No active access to this incident' });
      }

      const { incident } = access;
      const startTime = new Date(incident.triggeredAt);
      const endTime = incident.resolvedAt ? new Date(incident.resolvedAt) : new Date();

      const [doorCommands, auditLogs] = await Promise.all([
        fastify.prisma.doorCommand.findMany({
          where: { incidentId },
          orderBy: { createdAt: 'desc' },
        }),
        fastify.prisma.auditLog.findMany({
          where: {
            siteId: incident.siteId,
            createdAt: {
              gte: startTime,
              lte: endTime,
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      await fastify.prisma.responderAuditLog.create({
        data: {
          responderUserId: responder.id,
          action: 'VIEW_INCIDENT_LOGS',
          resourceType: 'Incident',
          resourceId: incidentId,
          siteId: incident.siteId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || '',
        },
      });

      return {
        doorCommands,
        auditLogs,
        total: doorCommands.length + auditLogs.length,
      };
    },
  );

  // GET /incidents/:incidentId/exports — Export incident data as JSON
  fastify.get<{ Params: { incidentId: string }; Querystring: { format?: string } }>(
    '/incidents/:incidentId/exports',
    { preHandler: [authenticateResponder, requireResponderPermission('EXPORT_DATA')] },
    async (request, reply) => {
      const responder = request.responderUser!;
      const { incidentId } = request.params;
      const format = request.query.format || 'json';

      if (format !== 'json') {
        return reply.code(400).send({ error: 'Only JSON format is currently supported' });
      }

      const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
      if (!access) {
        return reply.code(403).send({ error: 'No active access to this incident' });
      }

      const { incident } = access;

      const [timeline, respondingAgencies, doorCommands, messages, videoBookmarks] = await Promise.all([
        fastify.prisma.incidentTimeline.findMany({
          where: { incidentId },
          orderBy: { timestamp: 'asc' },
        }),
        fastify.prisma.incidentAgency.findMany({
          where: { incidentId },
          include: {
            agency: { select: { id: true, name: true, type: true } },
          },
        }),
        fastify.prisma.doorCommand.findMany({
          where: { incidentId },
          orderBy: { createdAt: 'asc' },
        }),
        fastify.prisma.secureMessage.findMany({
          where: { incidentId },
          orderBy: { createdAt: 'asc' },
        }),
        fastify.prisma.videoBookmark.findMany({
          where: { incidentId },
          orderBy: { bookmarkStart: 'asc' },
        }),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        exportedBy: {
          responderId: responder.id,
          email: responder.email,
          agencyId: responder.agencyId,
        },
        incident: {
          id: incident.id,
          type: incident.type,
          severity: incident.severity,
          status: incident.status,
          triggeredAt: incident.triggeredAt,
          resolvedAt: incident.resolvedAt,
          siteId: incident.siteId,
          siteName: incident.site.name,
        },
        timeline,
        respondingAgencies,
        doorCommands,
        messages,
        videoBookmarks,
      };

      await fastify.prisma.responderAuditLog.create({
        data: {
          responderUserId: responder.id,
          action: 'EXPORT_INCIDENT_DATA',
          resourceType: 'Incident',
          resourceId: incidentId,
          siteId: incident.siteId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || '',
        },
      });

      const filename = `incident-${incidentId}-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(exportData);
    },
  );

  // POST /incidents/:incidentId/video-bookmarks — Create video bookmark
  fastify.post<{
    Params: { incidentId: string };
    Body: {
      cameraId: string;
      cameraName?: string;
      bookmarkStart: string;
      bookmarkEnd?: string;
      label?: string;
      notes?: string;
    };
  }>(
    '/incidents/:incidentId/video-bookmarks',
    { preHandler: [authenticateResponder] },
    async (request, reply) => {
      const responder = request.responderUser!;
      const { incidentId } = request.params;
      const { cameraId, cameraName, bookmarkStart, bookmarkEnd, label, notes } = request.body;

      if (!cameraId || !bookmarkStart) {
        return reply.code(400).send({ error: 'cameraId and bookmarkStart are required' });
      }

      const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
      if (!access) {
        return reply.code(403).send({ error: 'No active access to this incident' });
      }

      const parsedStart = new Date(bookmarkStart);
      if (isNaN(parsedStart.getTime())) {
        return reply.code(400).send({ error: 'bookmarkStart must be a valid ISO date' });
      }

      let parsedEnd: Date | null = null;
      if (bookmarkEnd) {
        parsedEnd = new Date(bookmarkEnd);
        if (isNaN(parsedEnd.getTime())) {
          return reply.code(400).send({ error: 'bookmarkEnd must be a valid ISO date' });
        }
      }

      const bookmark = await fastify.prisma.videoBookmark.create({
        data: {
          incidentId,
          cameraId,
          cameraName: cameraName ? sanitizeText(cameraName) : null,
          bookmarkStart: parsedStart,
          bookmarkEnd: parsedEnd,
          label: label ? sanitizeText(label) : null,
          notes: notes ? sanitizeText(notes) : null,
          createdBy: responder.id,
        },
      });

      await fastify.prisma.responderAuditLog.create({
        data: {
          responderUserId: responder.id,
          action: 'CREATE_VIDEO_BOOKMARK',
          resourceType: 'VideoBookmark',
          resourceId: bookmark.id,
          siteId: access.incident.siteId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || '',
        },
      });

      return reply.code(201).send(bookmark);
    },
  );

  // GET /incidents/:incidentId/video-bookmarks — List video bookmarks for an incident
  fastify.get<{ Params: { incidentId: string } }>(
    '/incidents/:incidentId/video-bookmarks',
    { preHandler: [authenticateResponder] },
    async (request, reply) => {
      const responder = request.responderUser!;
      const { incidentId } = request.params;

      const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
      if (!access) {
        return reply.code(403).send({ error: 'No active access to this incident' });
      }

      const bookmarks = await fastify.prisma.videoBookmark.findMany({
        where: { incidentId },
        orderBy: { bookmarkStart: 'desc' },
      });

      await fastify.prisma.responderAuditLog.create({
        data: {
          responderUserId: responder.id,
          action: 'VIEW_VIDEO_BOOKMARKS',
          resourceType: 'VideoBookmark',
          resourceId: incidentId,
          siteId: access.incident.siteId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || '',
        },
      });

      return bookmarks;
    },
  );
};

export default responderPostIncidentRoutes;
