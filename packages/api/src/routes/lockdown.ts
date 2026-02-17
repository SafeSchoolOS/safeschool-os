import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole, requireRole } from '../middleware/rbac.js';

const lockdownRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/lockdown — Initiate lockdown (FIRST_RESPONDER+)
  fastify.post<{
    Body: {
      scope: string;
      targetId: string;
      alertId?: string;
      trainingMode?: boolean;
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] }, async (request, reply) => {

    const { scope, targetId, alertId } = request.body;
    const trainingMode = request.body.trainingMode === true || request.headers['x-training-mode'] === 'true';
    const siteId = request.jwtUser.siteIds[0];

    if (!scope || !targetId) {
      return reply.code(400).send({ error: 'scope and targetId are required' });
    }

    // Update doors based on scope (doors still lock in training mode)
    const doorFilter: any = { siteId, isEmergencyExit: false };
    if (scope === 'BUILDING') doorFilter.buildingId = targetId;
    if (scope === 'FLOOR') {
      doorFilter.buildingId = targetId;
      doorFilter.floor = parseInt(targetId.split(':')[1] || '1', 10);
    }
    if (scope === 'ZONE') {
      // Lock only doors assigned to this zone via DoorZoneAssignment
      doorFilter.zoneAssignments = {
        some: { zoneId: targetId },
      };
    }

    const result = await fastify.prisma.door.updateMany({
      where: doorFilter,
      data: { status: 'LOCKED' },
    });

    const lockdown = await fastify.prisma.lockdownCommand.create({
      data: {
        siteId,
        scope: scope as any,
        targetId,
        initiatedById: request.jwtUser.id,
        alertId,
        doorsLocked: result.count,
        metadata: trainingMode ? { trainingMode: true } : undefined,
      },
    });

    fastify.wsManager.broadcastToSite(siteId, 'lockdown:initiated', lockdown);

    if (trainingMode) {
      fastify.log.info({ lockdownId: lockdown.id }, 'Training mode: skipping dispatch for lockdown');
    }

    // Revoke all temporary/mobile credentials for VISITOR cardholders (non-blocking)
    try {
      const revokeResult = await fastify.prisma.cardholderCredential.updateMany({
        where: {
          cardholder: { siteId, personType: 'VISITOR' },
          credentialType: { in: ['TEMPORARY_CARD', 'MOBILE'] },
          status: 'ACTIVE',
        },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedReason: `Lockdown: ${lockdown.id}`,
        },
      });
      if (revokeResult.count > 0) {
        fastify.log.info({ lockdownId: lockdown.id, revokedCount: revokeResult.count }, 'Revoked visitor temporary credentials during lockdown');
      }
    } catch (err) {
      fastify.log.error(err, 'Failed to revoke visitor credentials during lockdown (non-blocking)');
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'LOCKDOWN_INITIATED',
        entity: 'LockdownCommand',
        entityId: lockdown.id,
        details: { scope, targetId, doorsLocked: result.count, trainingMode },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(lockdown);
  });

  // DELETE /api/v1/lockdown/:id — Release lockdown (OPERATOR+, edge only)
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    // Guard: Only allow lockdown release from edge devices
    const operatingMode = process.env.OPERATING_MODE || 'cloud';
    if (operatingMode === 'cloud') {
      return reply.code(403).send({
        error: 'Lockdown release must be performed from the on-site edge device',
        code: 'EDGE_ONLY_OPERATION',
      });
    }

    const lockdown = await fastify.prisma.lockdownCommand.findUnique({
      where: { id: request.params.id },
    });

    if (!lockdown) {
      return reply.code(404).send({ error: 'Lockdown not found' });
    }

    // IDOR protection: verify user has access to this lockdown's site
    if (!request.jwtUser.siteIds.includes(lockdown.siteId)) {
      return reply.code(404).send({ error: 'Lockdown not found' });
    }

    if (lockdown.releasedAt) {
      return reply.code(400).send({ error: 'Lockdown already released' });
    }

    // Unlock doors based on scope
    const doorFilter: any = { siteId: lockdown.siteId };
    if (lockdown.scope === 'BUILDING') doorFilter.buildingId = lockdown.targetId;
    if (lockdown.scope === 'ZONE') {
      doorFilter.zoneAssignments = { some: { zoneId: lockdown.targetId } };
    }

    await fastify.prisma.door.updateMany({
      where: doorFilter,
      data: { status: 'UNLOCKED' },
    });

    const updated = await fastify.prisma.lockdownCommand.update({
      where: { id: lockdown.id },
      data: { releasedAt: new Date() },
    });

    fastify.wsManager.broadcastToSite(lockdown.siteId, 'lockdown:released', updated);

    await fastify.prisma.auditLog.create({
      data: {
        siteId: lockdown.siteId,
        userId: request.jwtUser.id,
        action: 'LOCKDOWN_RELEASED',
        entity: 'LockdownCommand',
        entityId: lockdown.id,
        details: { operatingMode, releasedBy: request.jwtUser.email },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // GET /api/v1/lockdown/active — Active lockdowns for site
  fastify.get('/active', { preHandler: [fastify.authenticate] }, async (request) => {
    const lockdowns = await fastify.prisma.lockdownCommand.findMany({
      where: {
        siteId: { in: request.jwtUser.siteIds },
        releasedAt: null,
      },
      orderBy: { initiatedAt: 'desc' },
    });
    return {
      lockdowns,
      operatingMode: process.env.OPERATING_MODE || 'cloud',
    };
  });
};

export default lockdownRoutes;
