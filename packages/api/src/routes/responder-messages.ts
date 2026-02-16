import type { FastifyPluginAsync } from 'fastify';
import { authenticateResponder } from '../middleware/responder-auth.js';
import { sanitizeText } from '../utils/sanitize.js';

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

const responderMessageRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /incidents/:incidentId/messages — List messages for an incident
  fastify.get<{
    Params: { incidentId: string };
    Querystring: {
      threadId?: string;
      limit?: string;
      offset?: string;
    };
  }>('/incidents/:incidentId/messages', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const { incidentId } = request.params;
    const { threadId, limit, offset } = request.query;
    const responder = request.responderUser!;

    const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this incident' });
    }

    const take = Math.min(parseInt(limit || '50', 10) || 50, 200);
    const skip = Math.max(parseInt(offset || '0', 10) || 0, 0);

    const where: any = { incidentId };
    if (threadId) where.threadId = threadId;

    const [messages, total] = await Promise.all([
      fastify.prisma.secureMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      fastify.prisma.secureMessage.count({ where }),
    ]);

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: responder.id,
        action: 'VIEW_MESSAGES',
        resourceType: 'SecureMessage',
        resourceId: incidentId,
        siteId: access.incident.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return { messages, total };
  });

  // POST /incidents/:incidentId/messages — Send a message
  fastify.post<{
    Params: { incidentId: string };
    Body: {
      content: string;
      recipientType: 'STAFF' | 'BROADCAST';
      recipientId?: string;
      messageType?: string;
      threadId?: string;
    };
  }>('/incidents/:incidentId/messages', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const { incidentId } = request.params;
    const { recipientType, recipientId, messageType } = request.body;
    const content = sanitizeText(request.body.content);
    const responder = request.responderUser!;

    if (!content || !recipientType) {
      return reply.code(400).send({ error: 'content and recipientType are required' });
    }

    if (!['STAFF', 'BROADCAST'].includes(recipientType)) {
      return reply.code(400).send({ error: 'recipientType must be STAFF or BROADCAST' });
    }

    const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this incident' });
    }

    // Look up responder's full name from the database
    const responderUser = await fastify.prisma.responderUser.findUnique({
      where: { id: responder.id },
      select: { firstName: true, lastName: true },
    });

    const senderName = responderUser
      ? `${responderUser.firstName} ${responderUser.lastName}`
      : responder.email;

    const threadId = request.body.threadId || `incident-${incidentId}`;

    const message = await fastify.prisma.secureMessage.create({
      data: {
        incidentId,
        threadId,
        senderType: 'RESPONDER',
        senderId: responder.id,
        senderName,
        recipientType,
        recipientId: recipientId || null,
        content,
        messageType: messageType || 'TEXT',
      },
    });

    // Create timeline entry
    await fastify.prisma.incidentTimeline.create({
      data: {
        incidentId,
        timestamp: new Date(),
        action: `Message sent by responder ${senderName}`,
        actionType: 'NOTE_ADDED',
        actorType: 'RESPONDER',
        actorId: responder.id,
        metadata: {
          messageId: message.id,
          threadId,
          recipientType,
          messageType: message.messageType,
        },
      },
    });

    // Broadcast via WebSocket
    fastify.wsManager.broadcastToSite(access.incident.siteId, 'message.new', {
      incidentId,
      message,
    });

    // Audit log
    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: responder.id,
        action: 'MESSAGE_SENT',
        resourceType: 'SecureMessage',
        resourceId: message.id,
        siteId: access.incident.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return reply.code(201).send(message);
  });

  // PUT /incidents/:incidentId/messages/:messageId/read — Mark message as read
  fastify.put<{
    Params: { incidentId: string; messageId: string };
  }>('/incidents/:incidentId/messages/:messageId/read', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const { incidentId, messageId } = request.params;
    const responder = request.responderUser!;

    const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this incident' });
    }

    const message = await fastify.prisma.secureMessage.findFirst({
      where: { id: messageId, incidentId },
    });

    if (!message) {
      return reply.code(404).send({ error: 'Message not found' });
    }

    // Only the intended recipient can mark it as read
    if (message.recipientType === 'RESPONDER' && message.recipientId && message.recipientId !== responder.id) {
      return reply.code(403).send({ error: 'Only the recipient can mark this message as read' });
    }

    if (message.readAt) {
      return message; // Already marked as read
    }

    const updated = await fastify.prisma.secureMessage.update({
      where: { id: messageId },
      data: { readAt: new Date() },
    });

    // Audit log
    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: responder.id,
        action: 'MESSAGE_READ',
        resourceType: 'SecureMessage',
        resourceId: messageId,
        siteId: access.incident.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return updated;
  });
};

export default responderMessageRoutes;
