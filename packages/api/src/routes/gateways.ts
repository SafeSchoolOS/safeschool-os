import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

declare module 'fastify' {
  interface FastifyRequest {
    gateway?: any;
  }
}

/**
 * Authenticate a gateway by its Bearer token.
 * Hashes the provided token with SHA-256 and compares against authTokenHash in DB.
 */
async function authenticateGateway(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const gateway = await (request.server as any).prisma.gateway.findFirst({
    where: { authTokenHash: tokenHash },
  });

  if (!gateway) {
    return reply.code(401).send({ error: 'Invalid gateway token' });
  }

  request.gateway = gateway;
}

const gatewayRoutes: FastifyPluginAsync = async (fastify) => {
  // ===================================================================
  // Admin Routes (require SITE_ADMIN+, use fastify.authenticate)
  // ===================================================================

  // GET / - List gateways for a site
  fastify.get<{
    Querystring: { siteId: string };
  }>('/', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { siteId } = request.query;

    if (!siteId) {
      return reply.code(400).send({ error: 'siteId is required' });
    }

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const gateways = await fastify.prisma.gateway.findMany({
      where: { siteId },
      include: {
        partner: { select: { id: true, name: true, status: true, clusterRole: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return gateways;
  });

  // POST / - Register new gateway
  fastify.post<{
    Body: {
      siteId: string;
      name: string;
      hostname?: string;
      ipAddress?: string;
      macAddress?: string;
      hardwareModel?: string;
      primaryConnection?: string;
    };
  }>('/', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { siteId } = request.body;
    const name = sanitizeText(request.body.name);
    const hostname = sanitizeText(request.body.hostname);
    const ipAddress = sanitizeText(request.body.ipAddress);
    const macAddress = sanitizeText(request.body.macAddress);
    const hardwareModel = sanitizeText(request.body.hardwareModel);
    const primaryConnection = sanitizeText(request.body.primaryConnection) || 'ETHERNET';

    if (!siteId || !name) {
      return reply.code(400).send({ error: 'siteId and name are required' });
    }

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const provisioningToken = crypto.randomBytes(32).toString('hex');

    const gateway = await fastify.prisma.gateway.create({
      data: {
        siteId,
        name,
        hostname: hostname || null,
        ipAddress: ipAddress || null,
        macAddress: macAddress || null,
        hardwareModel: hardwareModel || null,
        primaryConnection,
        status: 'PROVISIONING_GW',
        clusterRole: 'SINGLE',
        clusterMode: 'STANDALONE',
        provisioningToken,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'GATEWAY_REGISTERED',
        entity: 'Gateway',
        entityId: gateway.id,
        ipAddress: request.ip,
        details: JSON.stringify({ name, hardwareModel }),
      },
    });

    return reply.code(201).send({ ...gateway, provisioningToken });
  });

  // GET /:gatewayId - Gateway detail + health
  fastify.get<{
    Params: { gatewayId: string };
  }>('/:gatewayId', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: request.params.gatewayId },
      include: {
        heartbeats: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
        partner: { select: { id: true, name: true, status: true, clusterRole: true } },
      },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    return gateway;
  });

  // PUT /:gatewayId - Update gateway config
  fastify.put<{
    Params: { gatewayId: string };
    Body: {
      name?: string;
      hostname?: string;
      ipAddress?: string;
      primaryConnection?: string;
      hasBackupCellular?: boolean;
    };
  }>('/:gatewayId', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const existing = await fastify.prisma.gateway.findUnique({
      where: { id: request.params.gatewayId },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(existing.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const data: any = {};
    if (request.body.name !== undefined) data.name = sanitizeText(request.body.name);
    if (request.body.hostname !== undefined) data.hostname = sanitizeText(request.body.hostname) || null;
    if (request.body.ipAddress !== undefined) data.ipAddress = sanitizeText(request.body.ipAddress) || null;
    if (request.body.primaryConnection !== undefined) data.primaryConnection = sanitizeText(request.body.primaryConnection);
    if (request.body.hasBackupCellular !== undefined) data.hasBackupCellular = request.body.hasBackupCellular;

    const updated = await fastify.prisma.gateway.update({
      where: { id: request.params.gatewayId },
      data,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'GATEWAY_UPDATED',
        entity: 'Gateway',
        entityId: existing.id,
        ipAddress: request.ip,
        details: JSON.stringify(data),
      },
    });

    return updated;
  });

  // DELETE /:gatewayId - Decommission gateway
  fastify.delete<{
    Params: { gatewayId: string };
  }>('/:gatewayId', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const existing = await fastify.prisma.gateway.findUnique({
      where: { id: request.params.gatewayId },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(existing.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    await fastify.prisma.gateway.update({
      where: { id: request.params.gatewayId },
      data: { status: 'OFFLINE_GW' },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'GATEWAY_DECOMMISSIONED',
        entity: 'Gateway',
        entityId: existing.id,
        ipAddress: request.ip,
      },
    });

    return { success: true };
  });

  // GET /:gatewayId/health - Current health metrics
  fastify.get<{
    Params: { gatewayId: string };
  }>('/:gatewayId/health', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: request.params.gatewayId },
      select: {
        id: true,
        status: true,
        cpuUsage: true,
        memoryUsage: true,
        diskUsage: true,
        uptimeSeconds: true,
        bleDevicesConnected: true,
        networkLatencyMs: true,
        primaryConnection: true,
        hasBackupCellular: true,
        cellularSignalStrength: true,
        lastHeartbeatAt: true,
        firmwareVersion: true,
      },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    const latestHeartbeat = await fastify.prisma.gatewayHeartbeat.findFirst({
      where: { gatewayId: request.params.gatewayId },
      orderBy: { timestamp: 'desc' },
    });

    return { ...gateway, latestHeartbeat };
  });

  // GET /:gatewayId/health/history - Health history
  fastify.get<{
    Params: { gatewayId: string };
    Querystring: { period?: string };
  }>('/:gatewayId/health/history', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { gatewayId } = request.params;
    const period = request.query.period || '24h';

    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: gatewayId },
      select: { id: true, siteId: true },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    let hoursAgo: number;
    switch (period) {
      case '7d':
        hoursAgo = 7 * 24;
        break;
      case '30d':
        hoursAgo = 30 * 24;
        break;
      case '24h':
      default:
        hoursAgo = 24;
        break;
    }

    const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    const heartbeats = await fastify.prisma.gatewayHeartbeat.findMany({
      where: {
        gatewayId,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
    });

    return heartbeats;
  });

  // GET /cluster/status - Cluster health overview for a site
  fastify.get<{
    Querystring: { siteId: string };
  }>('/cluster/status', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { siteId } = request.query;

    if (!siteId) {
      return reply.code(400).send({ error: 'siteId is required' });
    }

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const gateways = await fastify.prisma.gateway.findMany({
      where: { siteId },
      include: {
        partner: { select: { id: true, name: true, status: true, clusterRole: true } },
        heartbeats: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const clusterState = gateways.length > 0
      ? gateways[0].clusterState
      : null;

    return {
      siteId,
      gateways,
      clusterState,
      gatewayCount: gateways.length,
      onlineCount: gateways.filter(g => g.status === 'ONLINE_GW').length,
    };
  });

  // POST /:gatewayId/pair - Pair two gateways
  fastify.post<{
    Params: { gatewayId: string };
    Body: { partnerId: string; clusterMode: 'ACTIVE_PASSIVE' | 'ACTIVE_ACTIVE' };
  }>('/:gatewayId/pair', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { gatewayId } = request.params;
    const { partnerId, clusterMode } = request.body;

    if (!partnerId || !clusterMode) {
      return reply.code(400).send({ error: 'partnerId and clusterMode are required' });
    }

    if (!['ACTIVE_PASSIVE', 'ACTIVE_ACTIVE'].includes(clusterMode)) {
      return reply.code(400).send({ error: 'clusterMode must be ACTIVE_PASSIVE or ACTIVE_ACTIVE' });
    }

    if (gatewayId === partnerId) {
      return reply.code(400).send({ error: 'A gateway cannot be paired with itself' });
    }

    const [gateway, partner] = await Promise.all([
      fastify.prisma.gateway.findUnique({ where: { id: gatewayId } }),
      fastify.prisma.gateway.findUnique({ where: { id: partnerId } }),
    ]);

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!partner) {
      return reply.code(404).send({ error: 'Partner gateway not found' });
    }

    if (gateway.siteId !== partner.siteId) {
      return reply.code(400).send({ error: 'Both gateways must belong to the same site' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    if (gateway.partnerId) {
      return reply.code(409).send({ error: 'Gateway is already paired' });
    }

    if (partner.partnerId) {
      return reply.code(409).send({ error: 'Partner gateway is already paired' });
    }

    const primaryRole = clusterMode === 'ACTIVE_ACTIVE' ? 'PRIMARY_GW' : 'PRIMARY_GW';
    const secondaryRole = clusterMode === 'ACTIVE_ACTIVE' ? 'PRIMARY_GW' : 'SECONDARY_GW';

    const [updatedGateway, updatedPartner] = await Promise.all([
      fastify.prisma.gateway.update({
        where: { id: gatewayId },
        data: {
          partnerId,
          clusterMode,
          clusterRole: primaryRole,
          clusterState: 'HEALTHY_GW',
        },
        include: {
          partner: { select: { id: true, name: true, status: true, clusterRole: true } },
        },
      }),
      fastify.prisma.gateway.update({
        where: { id: partnerId },
        data: {
          partnerId: gatewayId,
          clusterMode,
          clusterRole: secondaryRole,
          clusterState: 'HEALTHY_GW',
        },
        include: {
          partner: { select: { id: true, name: true, status: true, clusterRole: true } },
        },
      }),
    ]);

    await fastify.prisma.auditLog.create({
      data: {
        siteId: gateway.siteId,
        userId: request.jwtUser.id,
        action: 'GATEWAY_PAIRED',
        entity: 'Gateway',
        entityId: gatewayId,
        ipAddress: request.ip,
        details: JSON.stringify({ partnerId, clusterMode }),
      },
    });

    if (fastify.wsManager) {
      fastify.wsManager.broadcastToSite(gateway.siteId, 'gateway:paired', {
        gatewayId,
        partnerId,
        clusterMode,
        timestamp: new Date().toISOString(),
      });
    }

    return { gateway: updatedGateway, partner: updatedPartner };
  });

  // DELETE /:gatewayId/pair - Unpair gateways
  fastify.delete<{
    Params: { gatewayId: string };
  }>('/:gatewayId/pair', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: request.params.gatewayId },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    if (!gateway.partnerId) {
      return reply.code(400).send({ error: 'Gateway is not paired' });
    }

    const partnerId = gateway.partnerId;

    await Promise.all([
      fastify.prisma.gateway.update({
        where: { id: request.params.gatewayId },
        data: {
          partnerId: null,
          clusterRole: 'SINGLE',
          clusterMode: 'STANDALONE',
          clusterState: 'SINGLE_GW',
        },
      }),
      fastify.prisma.gateway.update({
        where: { id: partnerId },
        data: {
          partnerId: null,
          clusterRole: 'SINGLE',
          clusterMode: 'STANDALONE',
          clusterState: 'SINGLE_GW',
        },
      }),
    ]);

    await fastify.prisma.auditLog.create({
      data: {
        siteId: gateway.siteId,
        userId: request.jwtUser.id,
        action: 'GATEWAY_UNPAIRED',
        entity: 'Gateway',
        entityId: request.params.gatewayId,
        ipAddress: request.ip,
        details: JSON.stringify({ partnerId }),
      },
    });

    if (fastify.wsManager) {
      fastify.wsManager.broadcastToSite(gateway.siteId, 'gateway:unpaired', {
        gatewayId: request.params.gatewayId,
        partnerId,
        timestamp: new Date().toISOString(),
      });
    }

    return { success: true };
  });

  // PUT /:gatewayId/cluster-mode - Switch cluster mode
  fastify.put<{
    Params: { gatewayId: string };
    Body: { clusterMode: 'ACTIVE_PASSIVE' | 'ACTIVE_ACTIVE' };
  }>('/:gatewayId/cluster-mode', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { gatewayId } = request.params;
    const { clusterMode } = request.body;

    if (!clusterMode || !['ACTIVE_PASSIVE', 'ACTIVE_ACTIVE'].includes(clusterMode)) {
      return reply.code(400).send({ error: 'clusterMode must be ACTIVE_PASSIVE or ACTIVE_ACTIVE' });
    }

    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: gatewayId },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    if (!gateway.partnerId) {
      return reply.code(400).send({ error: 'Gateway must be paired to change cluster mode' });
    }

    const roleUpdates: { gatewayRole: string; partnerRole: string } =
      clusterMode === 'ACTIVE_ACTIVE'
        ? { gatewayRole: 'PRIMARY_GW', partnerRole: 'PRIMARY_GW' }
        : { gatewayRole: gateway.clusterRole as string, partnerRole: 'SECONDARY_GW' };

    // If switching to ACTIVE_PASSIVE and current gateway is SECONDARY, keep roles as-is
    if (clusterMode === 'ACTIVE_PASSIVE') {
      if (gateway.clusterRole === 'SECONDARY_GW') {
        roleUpdates.gatewayRole = 'SECONDARY_GW';
        roleUpdates.partnerRole = 'PRIMARY_GW';
      } else {
        roleUpdates.gatewayRole = 'PRIMARY_GW';
        roleUpdates.partnerRole = 'SECONDARY_GW';
      }
    }

    const [updatedGateway, updatedPartner] = await Promise.all([
      fastify.prisma.gateway.update({
        where: { id: gatewayId },
        data: {
          clusterMode,
          clusterRole: roleUpdates.gatewayRole as any,
        },
        include: {
          partner: { select: { id: true, name: true, status: true, clusterRole: true } },
        },
      }),
      fastify.prisma.gateway.update({
        where: { id: gateway.partnerId },
        data: {
          clusterMode,
          clusterRole: roleUpdates.partnerRole as any,
        },
        include: {
          partner: { select: { id: true, name: true, status: true, clusterRole: true } },
        },
      }),
    ]);

    await fastify.prisma.auditLog.create({
      data: {
        siteId: gateway.siteId,
        userId: request.jwtUser.id,
        action: 'CLUSTER_MODE_CHANGED',
        entity: 'Gateway',
        entityId: gatewayId,
        ipAddress: request.ip,
        details: JSON.stringify({ clusterMode, previousMode: gateway.clusterMode }),
      },
    });

    if (fastify.wsManager) {
      fastify.wsManager.broadcastToSite(gateway.siteId, 'gateway:cluster-mode-changed', {
        gatewayId,
        partnerId: gateway.partnerId,
        clusterMode,
        timestamp: new Date().toISOString(),
      });
    }

    return { gateway: updatedGateway, partner: updatedPartner };
  });

  // GET /failover/history - Failover events
  fastify.get<{
    Querystring: { siteId: string; limit?: string };
  }>('/failover/history', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { siteId } = request.query;
    const limit = Math.min(parseInt(request.query.limit || '20', 10), 100);

    if (!siteId) {
      return reply.code(400).send({ error: 'siteId is required' });
    }

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const events = await fastify.prisma.gatewayFailoverEvent.findMany({
      where: { siteId },
      include: {
        failedGateway: { select: { id: true, name: true } },
        assumingGateway: { select: { id: true, name: true } },
      },
      orderBy: { failoverStartedAt: 'desc' },
      take: limit,
    });

    return events;
  });

  // ===================================================================
  // Gateway-to-Cloud Routes (use gateway auth token, not JWT)
  // ===================================================================

  // POST /cloud/heartbeat - Gateway reports health
  fastify.post<{
    Body: {
      gatewayId: string;
      status: string;
      cpuUsage: number;
      memoryUsage: number;
      bleDevicesConnected: number;
      pendingCommands: number;
      activeIncidentId?: string;
      firmwareVersion: string;
    };
  }>('/cloud/heartbeat', {
    preHandler: [authenticateGateway],
  }, async (request, reply) => {
    const {
      gatewayId,
      status,
      cpuUsage,
      memoryUsage,
      bleDevicesConnected,
      pendingCommands,
      activeIncidentId,
      firmwareVersion,
    } = request.body;

    if (!gatewayId || !status) {
      return reply.code(400).send({ error: 'gatewayId and status are required' });
    }

    if (request.gateway.id !== gatewayId) {
      return reply.code(403).send({ error: 'Token does not match gatewayId' });
    }

    await fastify.prisma.gatewayHeartbeat.create({
      data: {
        gatewayId,
        status,
        cpuUsage,
        memoryUsage,
        bleDevicesConnected,
        pendingCommands,
        activeIncidentId: activeIncidentId || null,
        firmwareVersion,
      },
    });

    await fastify.prisma.gateway.update({
      where: { id: gatewayId },
      data: {
        lastHeartbeatAt: new Date(),
        cpuUsage,
        memoryUsage,
        bleDevicesConnected,
        firmwareVersion,
        status: status as any,
      },
    });

    return { ok: true };
  });

  // POST /cloud/sync - Gateway pushes state sync
  fastify.post<{
    Body: {
      sourceGatewayId: string;
      targetGatewayId: string;
      syncType: string;
      payloadSizeBytes?: number;
      syncDurationMs?: number;
      success: boolean;
      errorMessage?: string;
    };
  }>('/cloud/sync', {
    preHandler: [authenticateGateway],
  }, async (request, reply) => {
    const {
      sourceGatewayId,
      targetGatewayId,
      syncType,
      payloadSizeBytes,
      syncDurationMs,
      success,
      errorMessage,
    } = request.body;

    if (!sourceGatewayId || !targetGatewayId || !syncType) {
      return reply.code(400).send({ error: 'sourceGatewayId, targetGatewayId, and syncType are required' });
    }

    if (request.gateway.id !== sourceGatewayId) {
      return reply.code(403).send({ error: 'Token does not match sourceGatewayId' });
    }

    await fastify.prisma.gatewayStateSync.create({
      data: {
        sourceGatewayId,
        targetGatewayId,
        syncType,
        payloadSizeBytes: payloadSizeBytes ?? null,
        syncDurationMs: syncDurationMs ?? null,
        success,
        errorMessage: errorMessage ? sanitizeText(errorMessage) : null,
      },
    });

    await fastify.prisma.gateway.update({
      where: { id: sourceGatewayId },
      data: { lastCloudSyncAt: new Date() },
    });

    return { ok: true };
  });

  // POST /cloud/events - Gateway pushes device events (placeholder)
  fastify.post<{
    Body: {
      gatewayId: string;
      events: any[];
    };
  }>('/cloud/events', {
    preHandler: [authenticateGateway],
  }, async (request, reply) => {
    const { gatewayId, events } = request.body;

    if (!gatewayId || !Array.isArray(events)) {
      return reply.code(400).send({ error: 'gatewayId and events array are required' });
    }

    if (request.gateway.id !== gatewayId) {
      return reply.code(403).send({ error: 'Token does not match gatewayId' });
    }

    return { ok: true, received: events.length };
  });

  // POST /cloud/failover/notify - Gateway notifies cloud of failover
  fastify.post<{
    Body: {
      siteId: string;
      failedGatewayId: string;
      assumingGatewayId: string;
      reason: string;
      devicesTransferred: number;
      incidentActiveAtTime: boolean;
    };
  }>('/cloud/failover/notify', {
    preHandler: [authenticateGateway],
  }, async (request, reply) => {
    const {
      siteId,
      failedGatewayId,
      assumingGatewayId,
      reason,
      devicesTransferred,
      incidentActiveAtTime,
    } = request.body;

    if (!siteId || !failedGatewayId || !assumingGatewayId || !reason) {
      return reply.code(400).send({ error: 'siteId, failedGatewayId, assumingGatewayId, and reason are required' });
    }

    if (request.gateway.id !== assumingGatewayId && request.gateway.id !== failedGatewayId) {
      return reply.code(403).send({ error: 'Token does not match either gateway in failover' });
    }

    const failoverEvent = await fastify.prisma.gatewayFailoverEvent.create({
      data: {
        siteId,
        failedGatewayId,
        assumingGatewayId,
        failoverType: 'AUTOMATIC',
        reason: reason as any,
        devicesTransferred: devicesTransferred || 0,
        incidentActiveAtTime: incidentActiveAtTime || false,
      },
    });

    await fastify.prisma.gateway.update({
      where: { id: failedGatewayId },
      data: { status: 'OFFLINE_GW' },
    });

    await fastify.prisma.gateway.update({
      where: { id: assumingGatewayId },
      data: { clusterRole: 'ASSUMED_PRIMARY' },
    });

    if (fastify.wsManager) {
      fastify.wsManager.broadcastToSite(siteId, 'gateway.failover', {
        failoverEventId: failoverEvent.id,
        failedGatewayId,
        assumingGatewayId,
        reason,
        devicesTransferred,
        incidentActiveAtTime,
        timestamp: new Date().toISOString(),
      });
    }

    return { ok: true };
  });

  // ===================================================================
  // Device Assignment & Door Command Queue (Admin)
  // ===================================================================

  // PUT /:gatewayId/devices - Assign devices to a gateway
  fastify.put<{
    Params: { gatewayId: string };
    Body: { deviceIds: string[] };
  }>('/:gatewayId/devices', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { gatewayId } = request.params;
    const { deviceIds } = request.body;

    if (!Array.isArray(deviceIds)) {
      return reply.code(400).send({ error: 'deviceIds must be an array' });
    }

    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: gatewayId },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    // Verify all device IDs are valid doors at this site
    if (deviceIds.length > 0) {
      const doors = await fastify.prisma.door.findMany({
        where: { id: { in: deviceIds }, siteId: gateway.siteId },
        select: { id: true },
      });
      if (doors.length !== deviceIds.length) {
        return reply.code(400).send({ error: 'Some device IDs are invalid or do not belong to this site' });
      }
    }

    // In ACTIVE_ACTIVE mode, ensure no overlap with partner's devices
    if (gateway.clusterMode === 'ACTIVE_ACTIVE' && gateway.partnerId) {
      const partner = await fastify.prisma.gateway.findUnique({
        where: { id: gateway.partnerId },
        select: { assignedDevices: true },
      });
      if (partner) {
        const overlap = deviceIds.filter(d => partner.assignedDevices.includes(d));
        if (overlap.length > 0) {
          return reply.code(409).send({ error: 'Devices already assigned to partner gateway', overlapping: overlap });
        }
      }
    }

    const updated = await fastify.prisma.gateway.update({
      where: { id: gatewayId },
      data: { assignedDevices: deviceIds },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: gateway.siteId,
        userId: request.jwtUser.id,
        action: 'DEVICES_ASSIGNED',
        entity: 'Gateway',
        entityId: gatewayId,
        ipAddress: request.ip,
        details: JSON.stringify({ deviceCount: deviceIds.length }),
      },
    });

    return updated;
  });

  // PUT /:gatewayId/zones - Assign zones to a gateway
  fastify.put<{
    Params: { gatewayId: string };
    Body: { zones: string[] };
  }>('/:gatewayId/zones', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { gatewayId } = request.params;
    const { zones } = request.body;

    if (!Array.isArray(zones)) {
      return reply.code(400).send({ error: 'zones must be an array' });
    }

    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: gatewayId },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    // In ACTIVE_ACTIVE mode, ensure no zone overlap with partner
    if (gateway.clusterMode === 'ACTIVE_ACTIVE' && gateway.partnerId) {
      const partner = await fastify.prisma.gateway.findUnique({
        where: { id: gateway.partnerId },
        select: { assignedZones: true },
      });
      if (partner) {
        const overlap = zones.filter(z => partner.assignedZones.includes(z));
        if (overlap.length > 0) {
          return reply.code(409).send({ error: 'Zones already assigned to partner gateway', overlapping: overlap });
        }
      }
    }

    const updated = await fastify.prisma.gateway.update({
      where: { id: gatewayId },
      data: { assignedZones: zones },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: gateway.siteId,
        userId: request.jwtUser.id,
        action: 'ZONES_ASSIGNED',
        entity: 'Gateway',
        entityId: gatewayId,
        ipAddress: request.ip,
        details: JSON.stringify({ zones }),
      },
    });

    return updated;
  });

  // POST /commands - Queue a door command routed to correct gateway
  fastify.post<{
    Body: {
      doorId: string;
      command: string;
      siteId: string;
      incidentId?: string;
      issuedBy: string;
    };
  }>('/commands', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
  }, async (request, reply) => {
    const { doorId, command, siteId, incidentId, issuedBy } = request.body;

    if (!doorId || !command || !siteId) {
      return reply.code(400).send({ error: 'doorId, command, and siteId are required' });
    }

    if (!['LOCK', 'UNLOCK'].includes(command)) {
      return reply.code(400).send({ error: 'command must be LOCK or UNLOCK' });
    }

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    // Find which gateway owns this door
    let targetGateway = await fastify.prisma.gateway.findFirst({
      where: {
        siteId,
        assignedDevices: { has: doorId },
        status: 'ONLINE_GW',
      },
    });

    // Fallback: any online gateway at the site
    if (!targetGateway) {
      targetGateway = await fastify.prisma.gateway.findFirst({
        where: { siteId, status: 'ONLINE_GW' },
      });
    }

    if (!targetGateway) {
      return reply.code(503).send({ error: 'No online gateway available at this site' });
    }

    const doorCommand = await fastify.prisma.doorCommand.create({
      data: {
        doorId,
        command,
        incidentId: incidentId || null,
        gatewayId: targetGateway.id,
        issuedBy: issuedBy || request.jwtUser.id,
        issuedByType: 'STAFF',
        status: 'PENDING',
        retryCount: 0,
        maxRetries: 3,
      },
    });

    if (fastify.wsManager) {
      fastify.wsManager.broadcastToSite(siteId, 'gateway:command-queued', {
        commandId: doorCommand.id,
        doorId,
        command,
        gatewayId: targetGateway.id,
        timestamp: new Date().toISOString(),
      });
    }

    return reply.code(201).send(doorCommand);
  });

  // GET /commands - List door commands
  fastify.get<{
    Querystring: { gatewayId?: string; siteId?: string; status?: string; limit?: string };
  }>('/commands', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
  }, async (request, reply) => {
    const { gatewayId, siteId, status, limit } = request.query;
    const take = Math.min(parseInt(limit || '50', 10) || 50, 200);

    const where: any = {};
    if (gatewayId) where.gatewayId = gatewayId;
    if (siteId) {
      if (!request.jwtUser.siteIds.includes(siteId)) {
        return reply.code(403).send({ error: 'No access to this site' });
      }
      where.gateway = { siteId };
    }
    if (status) where.status = status;

    const commands = await fastify.prisma.doorCommand.findMany({
      where,
      include: {
        gateway: { select: { id: true, name: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return commands;
  });

  // POST /commands/:commandId/retry - Retry a failed command
  fastify.post<{
    Params: { commandId: string };
  }>('/commands/:commandId/retry', {
    preHandler: [fastify.authenticate, requireMinRole('OPERATOR')],
  }, async (request, reply) => {
    const { commandId } = request.params;

    const cmd = await fastify.prisma.doorCommand.findUnique({
      where: { id: commandId },
      include: { gateway: true },
    });

    if (!cmd) {
      return reply.code(404).send({ error: 'Command not found' });
    }

    if (!['FAILED', 'TIMEOUT'].includes(cmd.status)) {
      return reply.code(400).send({ error: 'Only FAILED or TIMEOUT commands can be retried' });
    }

    if (cmd.retryCount >= cmd.maxRetries) {
      return reply.code(400).send({ error: 'Maximum retries exceeded' });
    }

    // If original gateway is offline, try to route to its partner
    let newGatewayId = cmd.gatewayId;
    if (cmd.gateway.status !== 'ONLINE_GW' && cmd.gateway.partnerId) {
      const partner = await fastify.prisma.gateway.findUnique({
        where: { id: cmd.gateway.partnerId },
      });
      if (partner && partner.status === 'ONLINE_GW') {
        newGatewayId = partner.id;
      }
    }

    const updated = await fastify.prisma.doorCommand.update({
      where: { id: commandId },
      data: {
        status: 'PENDING',
        failureReason: null,
        retryCount: { increment: 1 },
        gatewayId: newGatewayId,
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: cmd.gateway.siteId,
        userId: request.jwtUser.id,
        action: 'COMMAND_RETRIED',
        entity: 'DoorCommand',
        entityId: commandId,
        ipAddress: request.ip,
        details: JSON.stringify({ retryCount: cmd.retryCount + 1, rerouted: newGatewayId !== cmd.gatewayId }),
      },
    });

    return updated;
  });

  // ===================================================================
  // Recovery, Planned Failover & Health Check (Admin + Cloud)
  // ===================================================================

  // POST /:gatewayId/planned-failover - Initiate planned failover
  fastify.post<{
    Params: { gatewayId: string };
    Body: { reason?: string };
  }>('/:gatewayId/planned-failover', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { gatewayId } = request.params;
    const reason = request.body.reason ? sanitizeText(request.body.reason) : 'Planned maintenance';

    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: gatewayId },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    if (!gateway.partnerId) {
      return reply.code(400).send({ error: 'Gateway must be paired for planned failover' });
    }

    const partner = await fastify.prisma.gateway.findUnique({
      where: { id: gateway.partnerId },
    });

    if (!partner || partner.status !== 'ONLINE_GW') {
      return reply.code(400).send({ error: 'Partner gateway must be online for planned failover' });
    }

    // Transfer devices to partner
    const mergedDevices = [...new Set([...partner.assignedDevices, ...gateway.assignedDevices])];

    const failoverEvent = await fastify.prisma.gatewayFailoverEvent.create({
      data: {
        siteId: gateway.siteId,
        failedGatewayId: gatewayId,
        assumingGatewayId: partner.id,
        failoverType: 'MANUAL',
        reason: 'PLANNED_MAINTENANCE',
        devicesTransferred: gateway.assignedDevices.length,
        incidentActiveAtTime: false,
      },
    });

    await Promise.all([
      fastify.prisma.gateway.update({
        where: { id: gatewayId },
        data: {
          status: 'OFFLINE_GW',
          clusterState: 'FAILOVER_GW',
          assignedDevices: [],
        },
      }),
      fastify.prisma.gateway.update({
        where: { id: partner.id },
        data: {
          clusterRole: 'ASSUMED_PRIMARY',
          clusterState: 'FAILOVER_GW',
          assignedDevices: mergedDevices,
        },
      }),
    ]);

    await fastify.prisma.auditLog.create({
      data: {
        siteId: gateway.siteId,
        userId: request.jwtUser.id,
        action: 'PLANNED_FAILOVER_INITIATED',
        entity: 'Gateway',
        entityId: gatewayId,
        ipAddress: request.ip,
        details: JSON.stringify({ partnerId: partner.id, devicesTransferred: gateway.assignedDevices.length, reason }),
      },
    });

    if (fastify.wsManager) {
      fastify.wsManager.broadcastToSite(gateway.siteId, 'gateway:planned-failover', {
        failoverEventId: failoverEvent.id,
        gatewayId,
        assumingGatewayId: partner.id,
        devicesTransferred: gateway.assignedDevices.length,
        timestamp: new Date().toISOString(),
      });
    }

    return reply.code(201).send(failoverEvent);
  });

  // POST /:gatewayId/planned-failover/complete - Complete planned failover (bring gateway back)
  fastify.post<{
    Params: { gatewayId: string };
  }>('/:gatewayId/planned-failover/complete', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { gatewayId } = request.params;

    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: gatewayId },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    if (!gateway.partnerId) {
      return reply.code(400).send({ error: 'Gateway is not paired' });
    }

    const partner = await fastify.prisma.gateway.findUnique({
      where: { id: gateway.partnerId },
    });

    if (!partner) {
      return reply.code(404).send({ error: 'Partner gateway not found' });
    }

    // Find the open failover event
    const failoverEvent = await fastify.prisma.gatewayFailoverEvent.findFirst({
      where: {
        failedGatewayId: gatewayId,
        recoveredAt: null,
      },
      orderBy: { failoverStartedAt: 'desc' },
    });

    // Rebalance: split devices back evenly or restore original assignment
    const allDevices = partner.assignedDevices;
    const half = Math.ceil(allDevices.length / 2);
    const gatewayDevices = allDevices.slice(0, half);
    const partnerDevices = allDevices.slice(half);

    const originalRole = gateway.clusterMode === 'ACTIVE_ACTIVE' ? 'PRIMARY_GW' : 'PRIMARY_GW';
    const partnerRole = gateway.clusterMode === 'ACTIVE_ACTIVE' ? 'PRIMARY_GW' : 'SECONDARY_GW';

    await Promise.all([
      fastify.prisma.gateway.update({
        where: { id: gatewayId },
        data: {
          status: 'ONLINE_GW',
          clusterState: 'HEALTHY_GW',
          clusterRole: originalRole,
          assignedDevices: gatewayDevices,
        },
      }),
      fastify.prisma.gateway.update({
        where: { id: partner.id },
        data: {
          clusterState: 'HEALTHY_GW',
          clusterRole: partnerRole,
          assignedDevices: partnerDevices,
        },
      }),
    ]);

    if (failoverEvent) {
      await fastify.prisma.gatewayFailoverEvent.update({
        where: { id: failoverEvent.id },
        data: {
          recoveredAt: new Date(),
          durationMs: Date.now() - failoverEvent.failoverStartedAt.getTime(),
        },
      });
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId: gateway.siteId,
        userId: request.jwtUser.id,
        action: 'PLANNED_FAILOVER_COMPLETED',
        entity: 'Gateway',
        entityId: gatewayId,
        ipAddress: request.ip,
      },
    });

    if (fastify.wsManager) {
      fastify.wsManager.broadcastToSite(gateway.siteId, 'gateway:planned-failover-completed', {
        gatewayId,
        partnerId: partner.id,
        timestamp: new Date().toISOString(),
      });
    }

    return { ok: true };
  });

  // GET /cluster/health-check - Detect stale heartbeats
  fastify.get<{
    Querystring: { siteId: string };
  }>('/cluster/health-check', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { siteId } = request.query;

    if (!siteId) {
      return reply.code(400).send({ error: 'siteId is required' });
    }

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const gateways = await fastify.prisma.gateway.findMany({
      where: { siteId, status: { not: 'OFFLINE_GW' } },
    });

    const now = Date.now();
    const HEARTBEAT_TIMEOUT_MS = 5000;
    const results = [];

    for (const gw of gateways) {
      const lastHb = gw.lastHeartbeatAt ? new Date(gw.lastHeartbeatAt).getTime() : 0;
      const isStale = (now - lastHb) > HEARTBEAT_TIMEOUT_MS;

      if (isStale && gw.status === 'ONLINE_GW') {
        await fastify.prisma.gateway.update({
          where: { id: gw.id },
          data: { status: 'DEGRADED_STATUS_GW' },
        });

        // Mark cluster as degraded if paired
        if (gw.partnerId) {
          await Promise.all([
            fastify.prisma.gateway.update({
              where: { id: gw.id },
              data: { clusterState: 'DEGRADED_GW' },
            }),
            fastify.prisma.gateway.update({
              where: { id: gw.partnerId },
              data: { clusterState: 'DEGRADED_GW' },
            }),
          ]);
        }
      }

      results.push({
        id: gw.id,
        name: gw.name,
        status: isStale ? 'DEGRADED_STATUS_GW' : gw.status,
        lastHeartbeatAt: gw.lastHeartbeatAt,
        isStale,
        msSinceHeartbeat: gw.lastHeartbeatAt ? now - lastHb : null,
      });
    }

    return results;
  });

  // GET /:gatewayId/sync-history - State sync history
  fastify.get<{
    Params: { gatewayId: string };
    Querystring: { limit?: string };
  }>('/:gatewayId/sync-history', {
    preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')],
  }, async (request, reply) => {
    const { gatewayId } = request.params;
    const take = Math.min(parseInt(request.query.limit || '20', 10), 100);

    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: gatewayId },
      select: { id: true, siteId: true },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Gateway not found' });
    }

    if (!request.jwtUser.siteIds.includes(gateway.siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    const syncs = await fastify.prisma.gatewayStateSync.findMany({
      where: {
        OR: [
          { sourceGatewayId: gatewayId },
          { targetGatewayId: gatewayId },
        ],
      },
      include: {
        sourceGateway: { select: { id: true, name: true } },
        targetGateway: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return syncs;
  });

  // ===================================================================
  // Gateway-to-Cloud: Recovery + Command Pull/Report
  // ===================================================================

  // POST /cloud/recovery - Gateway reports it's back online
  fastify.post('/cloud/recovery', {
    preHandler: [authenticateGateway],
  }, async (request) => {
    const gateway = request.gateway;

    // Update gateway status
    await fastify.prisma.gateway.update({
      where: { id: gateway.id },
      data: {
        status: 'ONLINE_GW',
        lastHeartbeatAt: new Date(),
      },
    });

    // Close any open failover events for this gateway
    const openFailover = await fastify.prisma.gatewayFailoverEvent.findFirst({
      where: {
        failedGatewayId: gateway.id,
        recoveredAt: null,
      },
      orderBy: { failoverStartedAt: 'desc' },
    });

    let rebalanced = false;

    if (openFailover) {
      await fastify.prisma.gatewayFailoverEvent.update({
        where: { id: openFailover.id },
        data: {
          recoveredAt: new Date(),
          durationMs: Date.now() - openFailover.failoverStartedAt.getTime(),
        },
      });
    }

    // Rebalance devices if paired
    if (gateway.partnerId) {
      const partner = await fastify.prisma.gateway.findUnique({
        where: { id: gateway.partnerId },
      });

      if (partner) {
        if (gateway.clusterMode === 'ACTIVE_PASSIVE') {
          // Restore original roles: split devices back
          const allDevices = partner.assignedDevices;
          const half = Math.ceil(allDevices.length / 2);
          await Promise.all([
            fastify.prisma.gateway.update({
              where: { id: gateway.id },
              data: {
                clusterState: 'HEALTHY_GW',
                clusterRole: gateway.clusterRole === 'ASSUMED_PRIMARY' ? 'PRIMARY_GW' : gateway.clusterRole,
                assignedDevices: allDevices.slice(0, half),
              },
            }),
            fastify.prisma.gateway.update({
              where: { id: partner.id },
              data: {
                clusterState: 'HEALTHY_GW',
                clusterRole: partner.clusterRole === 'ASSUMED_PRIMARY' ? 'SECONDARY_GW' : partner.clusterRole,
                assignedDevices: allDevices.slice(half),
              },
            }),
          ]);
          rebalanced = true;
        } else {
          // ACTIVE_ACTIVE: just mark both healthy
          await Promise.all([
            fastify.prisma.gateway.update({
              where: { id: gateway.id },
              data: { clusterState: 'HEALTHY_GW' },
            }),
            fastify.prisma.gateway.update({
              where: { id: partner.id },
              data: { clusterState: 'HEALTHY_GW' },
            }),
          ]);
        }
      }
    }

    if (fastify.wsManager) {
      fastify.wsManager.broadcastToSite(gateway.siteId, 'gateway:recovered', {
        gatewayId: gateway.id,
        rebalanced,
        timestamp: new Date().toISOString(),
      });
    }

    return { ok: true, rebalanced };
  });

  // POST /cloud/failover/complete - Gateway reports failover completion
  fastify.post<{
    Body: {
      failoverEventId: string;
      durationMs: number;
      devicesAssumed: number;
    };
  }>('/cloud/failover/complete', {
    preHandler: [authenticateGateway],
  }, async (request, reply) => {
    const { failoverEventId, durationMs, devicesAssumed } = request.body;

    if (!failoverEventId) {
      return reply.code(400).send({ error: 'failoverEventId is required' });
    }

    const failoverEvent = await fastify.prisma.gatewayFailoverEvent.findUnique({
      where: { id: failoverEventId },
    });

    if (!failoverEvent) {
      return reply.code(404).send({ error: 'Failover event not found' });
    }

    await fastify.prisma.gatewayFailoverEvent.update({
      where: { id: failoverEventId },
      data: {
        failoverCompletedAt: new Date(),
        durationMs: durationMs || null,
        devicesTransferred: devicesAssumed || failoverEvent.devicesTransferred,
      },
    });

    return { ok: true };
  });

  // GET /cloud/commands - Gateway pulls its pending commands
  fastify.get('/cloud/commands', {
    preHandler: [authenticateGateway],
  }, async (request) => {
    const commands = await fastify.prisma.doorCommand.findMany({
      where: {
        gatewayId: request.gateway.id,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'asc' },
    });

    return { commands };
  });

  // PUT /cloud/commands/:commandId - Gateway reports command result
  fastify.put<{
    Params: { commandId: string };
    Body: {
      status: 'EXECUTED' | 'FAILED' | 'TIMEOUT';
      failureReason?: string;
    };
  }>('/cloud/commands/:commandId', {
    preHandler: [authenticateGateway],
  }, async (request, reply) => {
    const { commandId } = request.params;
    const { status, failureReason } = request.body;

    if (!status || !['EXECUTED', 'FAILED', 'TIMEOUT'].includes(status)) {
      return reply.code(400).send({ error: 'status must be EXECUTED, FAILED, or TIMEOUT' });
    }

    const cmd = await fastify.prisma.doorCommand.findUnique({
      where: { id: commandId },
    });

    if (!cmd) {
      return reply.code(404).send({ error: 'Command not found' });
    }

    if (cmd.gatewayId !== request.gateway.id) {
      return reply.code(403).send({ error: 'Command does not belong to this gateway' });
    }

    const data: any = { status };

    if (status === 'EXECUTED') {
      data.executedAt = new Date();
    } else if (status === 'FAILED' || status === 'TIMEOUT') {
      data.failureReason = failureReason ? sanitizeText(failureReason) : status;
      // Auto-retry if under max retries
      if (cmd.retryCount < cmd.maxRetries) {
        data.status = 'PENDING';
        data.retryCount = cmd.retryCount + 1;
        data.failureReason = null;
      }
    }

    const updated = await fastify.prisma.doorCommand.update({
      where: { id: commandId },
      data,
    });

    if (fastify.wsManager) {
      fastify.wsManager.broadcastToSite(request.gateway.siteId, 'gateway:command-result', {
        commandId,
        doorId: cmd.doorId,
        command: cmd.command,
        status: updated.status,
        gatewayId: request.gateway.id,
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
  });

  // POST /cloud/activate - Gateway activates using provisioning token (no auth)
  fastify.post<{
    Body: {
      provisioningToken: string;
      hostname: string;
      ipAddress: string;
      macAddress?: string;
      firmwareVersion?: string;
      serialNumber?: string;
    };
  }>('/cloud/activate', {
    config: {
      rateLimit: { max: 3, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const { provisioningToken, hostname, ipAddress, macAddress, firmwareVersion, serialNumber } = request.body;

    if (!provisioningToken || !hostname || !ipAddress) {
      return reply.code(400).send({ error: 'provisioningToken, hostname, and ipAddress are required' });
    }

    const gateway = await fastify.prisma.gateway.findFirst({
      where: { provisioningToken },
    });

    if (!gateway) {
      return reply.code(404).send({ error: 'Invalid provisioning token' });
    }

    if (gateway.status !== 'PROVISIONING_GW') {
      return reply.code(409).send({ error: 'Gateway has already been activated' });
    }

    // Generate permanent auth token
    const authToken = crypto.randomBytes(32).toString('hex');
    const authTokenHash = crypto.createHash('sha256').update(authToken).digest('hex');

    const activated = await fastify.prisma.gateway.update({
      where: { id: gateway.id },
      data: {
        status: 'ONLINE_GW',
        hostname: sanitizeText(hostname),
        ipAddress: sanitizeText(ipAddress),
        macAddress: macAddress ? sanitizeText(macAddress) : gateway.macAddress,
        firmwareVersion: firmwareVersion ? sanitizeText(firmwareVersion) : null,
        serialNumber: serialNumber ? sanitizeText(serialNumber) : null,
        authTokenHash,
        provisioningToken: null,
        lastHeartbeatAt: new Date(),
      },
      include: {
        site: { select: { id: true, name: true } },
      },
    });

    return reply.code(200).send({
      gateway: {
        id: activated.id,
        name: activated.name,
        siteId: activated.siteId,
        siteName: activated.site.name,
        clusterMode: activated.clusterMode,
        clusterRole: activated.clusterRole,
      },
      authToken, // One-time display — gateway must store this securely
    });
  });

  // GET /cloud/config - Gateway pulls latest config
  fastify.get('/cloud/config', {
    preHandler: [authenticateGateway],
  }, async (request) => {
    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: request.gateway.id },
      include: {
        site: { select: { id: true, name: true } },
        partner: { select: { id: true, name: true, status: true, clusterRole: true } },
      },
    });

    return {
      id: gateway!.id,
      name: gateway!.name,
      siteId: gateway!.siteId,
      siteName: gateway!.site.name,
      hostname: gateway!.hostname,
      ipAddress: gateway!.ipAddress,
      hardwareModel: gateway!.hardwareModel,
      firmwareVersion: gateway!.firmwareVersion,
      assignedDevices: gateway!.assignedDevices,
      assignedZones: gateway!.assignedZones,
      clusterMode: gateway!.clusterMode,
      clusterRole: gateway!.clusterRole,
      clusterState: gateway!.clusterState,
      partnerId: gateway!.partnerId,
      partner: gateway!.partner,
      primaryConnection: gateway!.primaryConnection,
      hasBackupCellular: gateway!.hasBackupCellular,
    };
  });

  // GET /cloud/devices - Gateway pulls assigned device list
  fastify.get('/cloud/devices', {
    preHandler: [authenticateGateway],
  }, async (request) => {
    const gateway = await fastify.prisma.gateway.findUnique({
      where: { id: request.gateway.id },
      select: { assignedDevices: true, siteId: true },
    });

    if (!gateway || gateway.assignedDevices.length === 0) {
      return { devices: [] };
    }

    const doors = await fastify.prisma.door.findMany({
      where: {
        id: { in: gateway.assignedDevices },
        siteId: gateway.siteId,
      },
      orderBy: { name: 'asc' },
    });

    return { devices: doors };
  });
};

export default gatewayRoutes;
