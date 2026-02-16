import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const incidentNotificationRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /incidents/:incidentId/notify-parents — Send notification to parents
  fastify.post<{
    Params: { incidentId: string };
    Body: {
      message: string;
      channels?: ('SMS' | 'EMAIL' | 'PUSH')[];
      templateId?: string;
    };
  }>(
    '/incidents/:incidentId/notify-parents',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const { incidentId } = request.params;
      const { message, channels, templateId } = request.body;

      if (!message || typeof message !== 'string') {
        return reply.code(400).send({ error: 'message is required and must be a string' });
      }

      const sanitizedMessage = sanitizeText(message);
      const selectedChannels = channels && channels.length > 0 ? channels : ['SMS', 'EMAIL', 'PUSH'] as const;

      // Verify incident exists and belongs to user's sites
      const incident = await fastify.prisma.incident.findUnique({
        where: { id: incidentId },
        include: { site: true },
      });

      if (!incident) {
        return reply.code(404).send({ error: 'Incident not found' });
      }

      if (!request.jwtUser.siteIds.includes(incident.siteId)) {
        return reply.code(403).send({ error: 'No access to this incident site' });
      }

      // Find all parent contacts for students at this site
      const parentContacts = await fastify.prisma.parentContact.findMany({
        where: { studentCard: { siteId: incident.siteId } },
      });

      if (parentContacts.length === 0) {
        return reply.code(200).send({ notificationCount: 0, channels: selectedChannels, message: 'No parent contacts found for this site' });
      }

      // Create NotificationLog entries for each channel and parent
      const notificationLogs = [];
      for (const contact of parentContacts) {
        for (const channel of selectedChannels) {
          let recipient: string | null = null;
          if (channel === 'SMS' && contact.phone) {
            recipient = contact.phone;
          } else if (channel === 'EMAIL' && contact.email) {
            recipient = contact.email;
          } else if (channel === 'PUSH') {
            recipient = contact.email || contact.phone || contact.id;
          }

          if (!recipient) continue;

          const log = await fastify.prisma.notificationLog.create({
            data: {
              siteId: incident.siteId,
              channel,
              recipientCount: 1,
              message: sanitizedMessage,
              status: 'QUEUED',
              sentAt: new Date(),
              metadata: {
                incidentId,
                parentContactId: contact.id,
                parentName: contact.parentName,
                templateId: templateId || null,
                notificationType: 'PARENT_ALERT',
              },
            },
          });
          notificationLogs.push(log);
        }
      }

      // Create IncidentTimeline entry
      await fastify.prisma.incidentTimeline.create({
        data: {
          incidentId,
          timestamp: new Date(),
          action: `Parent notification sent to ${parentContacts.length} contacts via ${selectedChannels.join(', ')}`,
          actionType: 'NOTIFICATION_SENT',
          actorType: 'USER',
          actorId: request.jwtUser.id,
          metadata: {
            channels: selectedChannels,
            recipientCount: parentContacts.length,
            notificationLogCount: notificationLogs.length,
            templateId: templateId || null,
          },
        },
      });

      // Enqueue mass notification job
      await fastify.alertQueue.add('mass-notify', {
        siteId: incident.siteId,
        channels: selectedChannels,
        message: sanitizedMessage,
        recipientScope: 'all-parents',
        incidentId,
        initiatedBy: request.jwtUser.id,
      });

      // Broadcast via WebSocket
      fastify.wsManager.broadcastToSite(incident.siteId, 'incident:notification-sent', {
        incidentId,
        channels: selectedChannels,
        notificationCount: notificationLogs.length,
      });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId: request.jwtUser.id,
          action: 'NOTIFY_PARENTS',
          entity: 'Incident',
          entityId: incidentId,
          siteId: incident.siteId,
          details: {
            channels: selectedChannels,
            parentContactCount: parentContacts.length,
            notificationCount: notificationLogs.length,
          },
          ipAddress: request.ip,
        },
      });

      return reply.code(201).send({
        notificationCount: notificationLogs.length,
        channels: selectedChannels,
      });
    },
  );

  // POST /incidents/:incidentId/notify-parents/update — Send follow-up update to parents
  fastify.post<{
    Params: { incidentId: string };
    Body: {
      message: string;
      channels?: ('SMS' | 'EMAIL' | 'PUSH')[];
      templateId?: string;
      updateType: 'STATUS_UPDATE' | 'ALL_CLEAR' | 'REUNIFICATION_INFO';
    };
  }>(
    '/incidents/:incidentId/notify-parents/update',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const { incidentId } = request.params;
      const { message, channels, templateId, updateType } = request.body;

      if (!message || typeof message !== 'string') {
        return reply.code(400).send({ error: 'message is required and must be a string' });
      }

      if (!updateType || !['STATUS_UPDATE', 'ALL_CLEAR', 'REUNIFICATION_INFO'].includes(updateType)) {
        return reply.code(400).send({ error: 'updateType is required and must be STATUS_UPDATE, ALL_CLEAR, or REUNIFICATION_INFO' });
      }

      const sanitizedMessage = sanitizeText(message);
      const selectedChannels = channels && channels.length > 0 ? channels : ['SMS', 'EMAIL', 'PUSH'] as const;

      // Verify incident exists and belongs to user's sites
      const incident = await fastify.prisma.incident.findUnique({
        where: { id: incidentId },
        include: { site: true },
      });

      if (!incident) {
        return reply.code(404).send({ error: 'Incident not found' });
      }

      if (!request.jwtUser.siteIds.includes(incident.siteId)) {
        return reply.code(403).send({ error: 'No access to this incident site' });
      }

      // Find all parent contacts for students at this site
      const parentContacts = await fastify.prisma.parentContact.findMany({
        where: { studentCard: { siteId: incident.siteId } },
      });

      if (parentContacts.length === 0) {
        return reply.code(200).send({ notificationCount: 0, channels: selectedChannels, message: 'No parent contacts found for this site' });
      }

      // Create NotificationLog entries for each channel and parent
      const notificationLogs = [];
      for (const contact of parentContacts) {
        for (const channel of selectedChannels) {
          let recipient: string | null = null;
          if (channel === 'SMS' && contact.phone) {
            recipient = contact.phone;
          } else if (channel === 'EMAIL' && contact.email) {
            recipient = contact.email;
          } else if (channel === 'PUSH') {
            recipient = contact.email || contact.phone || contact.id;
          }

          if (!recipient) continue;

          const log = await fastify.prisma.notificationLog.create({
            data: {
              siteId: incident.siteId,
              channel,
              recipientCount: 1,
              message: sanitizedMessage,
              status: 'QUEUED',
              sentAt: new Date(),
              metadata: {
                incidentId,
                parentContactId: contact.id,
                parentName: contact.parentName,
                templateId: templateId || null,
                updateType,
                notificationType: 'PARENT_UPDATE',
              },
            },
          });
          notificationLogs.push(log);
        }
      }

      // Create IncidentTimeline entry
      await fastify.prisma.incidentTimeline.create({
        data: {
          incidentId,
          timestamp: new Date(),
          action: `Parent ${updateType.toLowerCase().replace(/_/g, ' ')} sent to ${parentContacts.length} contacts via ${selectedChannels.join(', ')}`,
          actionType: 'NOTIFICATION_SENT',
          actorType: 'USER',
          actorId: request.jwtUser.id,
          metadata: {
            channels: selectedChannels,
            recipientCount: parentContacts.length,
            notificationLogCount: notificationLogs.length,
            updateType,
            templateId: templateId || null,
          },
        },
      });

      // Enqueue mass notification job
      await fastify.alertQueue.add('mass-notify', {
        siteId: incident.siteId,
        channels: selectedChannels,
        message: sanitizedMessage,
        recipientScope: 'all-parents',
        incidentId,
        updateType,
        initiatedBy: request.jwtUser.id,
      });

      // Broadcast via WebSocket
      fastify.wsManager.broadcastToSite(incident.siteId, 'incident:notification-sent', {
        incidentId,
        channels: selectedChannels,
        notificationCount: notificationLogs.length,
        updateType,
      });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          userId: request.jwtUser.id,
          action: `NOTIFY_PARENTS_${updateType}`,
          entity: 'Incident',
          entityId: incidentId,
          siteId: incident.siteId,
          details: {
            channels: selectedChannels,
            parentContactCount: parentContacts.length,
            notificationCount: notificationLogs.length,
            updateType,
          },
          ipAddress: request.ip,
        },
      });

      return reply.code(201).send({
        notificationCount: notificationLogs.length,
        channels: selectedChannels,
        updateType,
      });
    },
  );

  // GET /incidents/:incidentId/notifications — List notifications sent for this incident
  fastify.get<{
    Params: { incidentId: string };
    Querystring: { limit?: string; offset?: string };
  }>(
    '/incidents/:incidentId/notifications',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const { incidentId } = request.params;
      const limit = Math.min(Math.max(parseInt(request.query.limit || '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);

      // Verify incident exists and belongs to user's sites
      const incident = await fastify.prisma.incident.findUnique({
        where: { id: incidentId },
      });

      if (!incident) {
        return reply.code(404).send({ error: 'Incident not found' });
      }

      if (!request.jwtUser.siteIds.includes(incident.siteId)) {
        return reply.code(403).send({ error: 'No access to this incident site' });
      }

      // Query NotificationLog where metadata contains the incidentId
      // Prisma JSON filter: metadata path contains incidentId
      const [notifications, total] = await Promise.all([
        fastify.prisma.notificationLog.findMany({
          where: {
            siteId: incident.siteId,
            metadata: {
              path: ['incidentId'],
              equals: incidentId,
            },
          },
          orderBy: { sentAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        fastify.prisma.notificationLog.count({
          where: {
            siteId: incident.siteId,
            metadata: {
              path: ['incidentId'],
              equals: incidentId,
            },
          },
        }),
      ]);

      return {
        notifications,
        total,
        limit,
        offset,
      };
    },
  );
};

export default incidentNotificationRoutes;
