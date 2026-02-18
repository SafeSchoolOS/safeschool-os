import type { FastifyPluginAsync } from 'fastify';
import { authenticateResponder, requireResponderPermission, requireResponderRole } from '../middleware/responder-auth.js';
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

function verifyFullResponseAccess(link: any): boolean {
  return link.accessLevel === 'FULL_RESPONSE';
}

const responderIncidentActionsRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /incidents/:incidentId/doors/:doorId/lock — Lock a specific door
  fastify.post<{ Params: { incidentId: string; doorId: string } }>(
    '/incidents/:incidentId/doors/:doorId/lock',
    { preHandler: [authenticateResponder, requireResponderPermission('CONTROL_DOORS')] },
    async (request, reply) => {
      const { incidentId, doorId } = request.params;
      const responder = request.responderUser!;

      const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
      if (!access) {
        return reply.code(403).send({ error: 'No active access to this incident' });
      }
      if (!verifyFullResponseAccess(access.link)) {
        return reply.code(403).send({ error: 'FULL_RESPONSE access level required' });
      }

      const door = await fastify.prisma.door.findUnique({ where: { id: doorId } });
      if (!door) {
        return reply.code(404).send({ error: 'Door not found' });
      }
      if (door.siteId !== access.incident.siteId) {
        return reply.code(403).send({ error: 'Door does not belong to incident site' });
      }

      const updated = await fastify.prisma.door.update({
        where: { id: doorId },
        data: { status: 'LOCKED' },
      });

      // Find a gateway for the site to issue the command through
      const gateway = await fastify.prisma.gateway.findFirst({
        where: { siteId: access.incident.siteId, status: 'ONLINE_GW' },
      });

      await fastify.prisma.doorCommand.create({
        data: {
          doorId,
          command: 'LOCK',
          issuedBy: responder.id,
          issuedByType: 'RESPONDER',
          incidentId,
          gatewayId: gateway?.id ?? 'no-gateway',
          status: 'PENDING',
          maxRetries: 3,
          timeoutAt: new Date(Date.now() + 30_000),
        },
      });

      await fastify.prisma.incidentTimeline.create({
        data: {
          incidentId,
          timestamp: new Date(),
          action: `Door "${door.name}" locked by responder ${responder.email}`,
          actionType: 'DOOR_LOCKED',
          actorType: 'RESPONDER',
          actorId: responder.id,
          metadata: { doorId, doorName: door.name },
        },
      });

      fastify.wsManager.broadcastToSite(access.incident.siteId, 'door:updated', updated);

      await fastify.prisma.responderAuditLog.create({
        data: {
          responderUserId: responder.id,
          action: 'DOOR_LOCKED',
          resourceType: 'Door',
          resourceId: doorId,
          siteId: access.incident.siteId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || '',
        },
      });

      return updated;
    },
  );

  // POST /incidents/:incidentId/doors/:doorId/unlock — Unlock a specific door
  fastify.post<{ Params: { incidentId: string; doorId: string } }>(
    '/incidents/:incidentId/doors/:doorId/unlock',
    { preHandler: [authenticateResponder, requireResponderPermission('CONTROL_DOORS')] },
    async (request, reply) => {
      const { incidentId, doorId } = request.params;
      const responder = request.responderUser!;

      const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
      if (!access) {
        return reply.code(403).send({ error: 'No active access to this incident' });
      }
      if (!verifyFullResponseAccess(access.link)) {
        return reply.code(403).send({ error: 'FULL_RESPONSE access level required' });
      }

      const door = await fastify.prisma.door.findUnique({ where: { id: doorId } });
      if (!door) {
        return reply.code(404).send({ error: 'Door not found' });
      }
      if (door.siteId !== access.incident.siteId) {
        return reply.code(403).send({ error: 'Door does not belong to incident site' });
      }

      const updated = await fastify.prisma.door.update({
        where: { id: doorId },
        data: { status: 'UNLOCKED' },
      });

      const gateway = await fastify.prisma.gateway.findFirst({
        where: { siteId: access.incident.siteId, status: 'ONLINE_GW' },
      });

      await fastify.prisma.doorCommand.create({
        data: {
          doorId,
          command: 'UNLOCK',
          issuedBy: responder.id,
          issuedByType: 'RESPONDER',
          incidentId,
          gatewayId: gateway?.id ?? 'no-gateway',
          status: 'PENDING',
          maxRetries: 3,
          timeoutAt: new Date(Date.now() + 30_000),
        },
      });

      await fastify.prisma.incidentTimeline.create({
        data: {
          incidentId,
          timestamp: new Date(),
          action: `Door "${door.name}" unlocked by responder ${responder.email}`,
          actionType: 'DOOR_UNLOCKED',
          actorType: 'RESPONDER',
          actorId: responder.id,
          metadata: { doorId, doorName: door.name },
        },
      });

      fastify.wsManager.broadcastToSite(access.incident.siteId, 'door:updated', updated);

      await fastify.prisma.responderAuditLog.create({
        data: {
          responderUserId: responder.id,
          action: 'DOOR_UNLOCKED',
          resourceType: 'Door',
          resourceId: doorId,
          siteId: access.incident.siteId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || '',
        },
      });

      return updated;
    },
  );

  // POST /incidents/:incidentId/lockdown — Campus-wide lockdown
  fastify.post<{ Params: { incidentId: string } }>(
    '/incidents/:incidentId/lockdown',
    { preHandler: [authenticateResponder, requireResponderRole('COMMAND'), requireResponderPermission('CONTROL_DOORS')] },
    async (request, reply) => {
      const { incidentId } = request.params;
      const responder = request.responderUser!;

      const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
      if (!access) {
        return reply.code(403).send({ error: 'No active access to this incident' });
      }
      if (!verifyFullResponseAccess(access.link)) {
        return reply.code(403).send({ error: 'FULL_RESPONSE access level required' });
      }

      const siteId = access.incident.siteId;

      // Lock all non-emergency-exit doors at the site
      const result = await fastify.prisma.door.updateMany({
        where: { siteId, isEmergencyExit: false },
        data: { status: 'LOCKED' },
      });

      const lockdown = await fastify.prisma.lockdownCommand.create({
        data: {
          siteId,
          scope: 'FULL_SITE',
          targetId: siteId,
          initiatedById: responder.id,
          alertId: null,
          doorsLocked: result.count,
          metadata: { initiatedByResponder: true, incidentId },
        },
      });

      await fastify.prisma.incidentTimeline.create({
        data: {
          incidentId,
          timestamp: new Date(),
          action: `Campus-wide lockdown initiated by responder ${responder.email} — ${result.count} doors locked`,
          actionType: 'LOCKDOWN_INITIATED',
          actorType: 'RESPONDER',
          actorId: responder.id,
          metadata: { lockdownId: lockdown.id, doorsLocked: result.count },
        },
      });

      // Update incident status to LOCKDOWN_ACTIVE if in an early stage
      const escalatableStatuses = [
        'TRIGGERED_INCIDENT',
        'DISPATCHED_INCIDENT',
        'RESPONDING_INCIDENT',
        'ON_SCENE',
      ];
      if (escalatableStatuses.includes(access.incident.status)) {
        await fastify.prisma.incident.update({
          where: { id: incidentId },
          data: { status: 'LOCKDOWN_ACTIVE' },
        });
      }

      fastify.wsManager.broadcastToSite(siteId, 'lockdown:initiated', lockdown);

      await fastify.prisma.responderAuditLog.create({
        data: {
          responderUserId: responder.id,
          action: 'LOCKDOWN_INITIATED',
          resourceType: 'LockdownCommand',
          resourceId: lockdown.id,
          siteId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || '',
        },
      });

      return { ...lockdown, doorsLocked: result.count };
    },
  );

  // POST /incidents/:incidentId/lockdown/release — Release lockdown
  fastify.post<{ Params: { incidentId: string } }>(
    '/incidents/:incidentId/lockdown/release',
    { preHandler: [authenticateResponder, requireResponderRole('COMMAND'), requireResponderPermission('CONTROL_DOORS')] },
    async (request, reply) => {
      const { incidentId } = request.params;
      const responder = request.responderUser!;

      const access = await verifyIncidentAccess(fastify.prisma, responder.agencyId, incidentId);
      if (!access) {
        return reply.code(403).send({ error: 'No active access to this incident' });
      }
      if (!verifyFullResponseAccess(access.link)) {
        return reply.code(403).send({ error: 'FULL_RESPONSE access level required' });
      }

      const siteId = access.incident.siteId;

      // Find active (unreleased) lockdown for the site
      const lockdown = await fastify.prisma.lockdownCommand.findFirst({
        where: { siteId, releasedAt: null },
        orderBy: { initiatedAt: 'desc' },
      });

      if (!lockdown) {
        return reply.code(404).send({ error: 'No active lockdown found for this site' });
      }

      // Unlock all doors at the site
      const result = await fastify.prisma.door.updateMany({
        where: { siteId },
        data: { status: 'UNLOCKED' },
      });

      const updated = await fastify.prisma.lockdownCommand.update({
        where: { id: lockdown.id },
        data: { releasedAt: new Date() },
      });

      await fastify.prisma.incidentTimeline.create({
        data: {
          incidentId,
          timestamp: new Date(),
          action: `Lockdown released by responder ${responder.email} — ${result.count} doors unlocked`,
          actionType: 'ALL_CLEAR_ACTION',
          actorType: 'RESPONDER',
          actorId: responder.id,
          metadata: { lockdownId: lockdown.id, doorsUnlocked: result.count },
        },
      });

      fastify.wsManager.broadcastToSite(siteId, 'lockdown:released', updated);

      await fastify.prisma.responderAuditLog.create({
        data: {
          responderUserId: responder.id,
          action: 'LOCKDOWN_RELEASED',
          resourceType: 'LockdownCommand',
          resourceId: lockdown.id,
          siteId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || '',
        },
      });

      return { ...updated, doorsUnlocked: result.count };
    },
  );
};

export default responderIncidentActionsRoutes;
