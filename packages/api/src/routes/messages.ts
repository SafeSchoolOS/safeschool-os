import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const messageRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/messages — List messages for an incident
  fastify.get<{
    Querystring: {
      incidentId: string;
      threadId?: string;
      limit?: string;
      offset?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const { incidentId, threadId, limit, offset } = request.query;

    if (!incidentId) {
      return reply.code(400).send({ error: 'incidentId is required' });
    }

    // Verify the incident belongs to one of the user's sites
    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
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

    return { messages, total };
  });

  // POST /api/v1/messages — Send a message
  fastify.post<{
    Body: {
      incidentId: string;
      content: string;
      recipientType: 'RESPONDER' | 'BROADCAST';
      recipientId?: string;
      messageType?: string;
      threadId?: string;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const { incidentId, recipientType, recipientId, messageType } = request.body;
    const content = sanitizeText(request.body.content);

    if (!incidentId || !content || !recipientType) {
      return reply.code(400).send({ error: 'incidentId, content, and recipientType are required' });
    }

    if (!['RESPONDER', 'BROADCAST'].includes(recipientType)) {
      return reply.code(400).send({ error: 'recipientType must be RESPONDER or BROADCAST' });
    }

    // Verify the incident belongs to one of the user's sites
    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    const threadId = request.body.threadId || `incident-${incidentId}`;
    const senderName = request.jwtUser.email;

    const message = await fastify.prisma.secureMessage.create({
      data: {
        incidentId,
        threadId,
        senderType: 'STAFF',
        senderId: request.jwtUser.id,
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
        action: `Message sent by ${senderName}`,
        actionType: 'NOTE_ADDED',
        actorType: 'STAFF',
        actorId: request.jwtUser.id,
        metadata: {
          messageId: message.id,
          threadId,
          recipientType,
          messageType: message.messageType,
        },
      },
    });

    // Broadcast via WebSocket
    fastify.wsManager.broadcastToSite(incident.siteId, 'message.new', {
      incidentId,
      message,
    });

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId: incident.siteId,
        userId: request.jwtUser.id,
        action: 'MESSAGE_SENT',
        entity: 'SecureMessage',
        entityId: message.id,
        details: { incidentId, threadId, recipientType, messageType: message.messageType },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(message);
  });

  // PUT /api/v1/messages/:messageId/read — Mark message as read
  fastify.put<{
    Params: { messageId: string };
  }>('/:messageId/read', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { messageId } = request.params;

    const message = await fastify.prisma.secureMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return reply.code(404).send({ error: 'Message not found' });
    }

    // Verify the incident belongs to one of the user's sites
    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: message.incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!incident) {
      return reply.code(403).send({ error: 'No access to this message' });
    }

    // Only the intended recipient can mark it as read
    if (message.recipientType === 'STAFF' && message.recipientId && message.recipientId !== request.jwtUser.id) {
      return reply.code(403).send({ error: 'Only the recipient can mark this message as read' });
    }

    if (message.readAt) {
      return message; // Already marked as read
    }

    const updated = await fastify.prisma.secureMessage.update({
      where: { id: messageId },
      data: { readAt: new Date() },
    });

    return updated;
  });

  // GET /api/v1/messages/threads — List unique threads for an incident
  fastify.get<{
    Querystring: { incidentId: string };
  }>('/threads', { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] }, async (request, reply) => {
    const { incidentId } = request.query;

    if (!incidentId) {
      return reply.code(400).send({ error: 'incidentId is required' });
    }

    // Verify the incident belongs to one of the user's sites
    const incident = await fastify.prisma.incident.findFirst({
      where: {
        id: incidentId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    // Get all messages for the incident, grouped by thread
    const messages = await fastify.prisma.secureMessage.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'desc' },
    });

    // Build thread summaries
    const threadMap = new Map<string, {
      threadId: string;
      lastMessage: typeof messages[0];
      messageCount: number;
      unreadCount: number;
    }>();

    for (const msg of messages) {
      const existing = threadMap.get(msg.threadId);
      if (!existing) {
        threadMap.set(msg.threadId, {
          threadId: msg.threadId,
          lastMessage: msg,
          messageCount: 1,
          unreadCount: msg.readAt ? 0 : 1,
        });
      } else {
        existing.messageCount += 1;
        if (!msg.readAt) existing.unreadCount += 1;
      }
    }

    const threads = Array.from(threadMap.values()).map((t) => ({
      threadId: t.threadId,
      lastMessagePreview: t.lastMessage.content.substring(0, 100),
      lastMessageAt: t.lastMessage.createdAt,
      lastSenderName: t.lastMessage.senderName,
      lastSenderType: t.lastMessage.senderType,
      messageCount: t.messageCount,
      unreadCount: t.unreadCount,
    }));

    // Sort by most recent message first
    threads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    return threads;
  });
};

export default messageRoutes;
