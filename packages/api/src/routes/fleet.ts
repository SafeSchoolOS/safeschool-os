import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

export default async function fleetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/fleet/devices — list all edge devices
  app.get('/devices', { preHandler: [requireMinRole('SUPER_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const devices = await app.prisma.edgeDevice.findMany({
      include: { site: { select: { id: true, name: true, district: true } } },
      orderBy: { lastHeartbeatAt: 'desc' },
    });
    return devices;
  });

  // GET /api/v1/fleet/devices/:id — single device detail
  app.get('/devices/:id', { preHandler: [requireMinRole('SUPER_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const device = await app.prisma.edgeDevice.findUnique({
      where: { id },
      include: { site: { select: { id: true, name: true, district: true, address: true, city: true, state: true } } },
    });
    if (!device) {
      return reply.code(404).send({ error: 'Edge device not found' });
    }
    return device;
  });

  // POST /api/v1/fleet/devices/:id/upgrade — push upgrade to single device
  app.post('/devices/:id/upgrade', { preHandler: [requireMinRole('SUPER_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { targetVersion } = request.body as { targetVersion: string };

    if (!targetVersion || typeof targetVersion !== 'string') {
      return reply.code(400).send({ error: 'targetVersion is required' });
    }

    const device = await app.prisma.edgeDevice.findUnique({ where: { id } });
    if (!device) {
      return reply.code(404).send({ error: 'Edge device not found' });
    }

    if (device.upgradeStatus === 'IN_PROGRESS' || device.upgradeStatus === 'PENDING') {
      return reply.code(409).send({ error: `Upgrade already ${device.upgradeStatus.toLowerCase()}` });
    }

    const updated = await app.prisma.edgeDevice.update({
      where: { id },
      data: {
        targetVersion,
        upgradeStatus: 'PENDING',
        upgradeError: null,
      },
    });

    return updated;
  });

  // POST /api/v1/fleet/upgrade-all — push upgrade to all IDLE devices
  app.post('/upgrade-all', { preHandler: [requireMinRole('SUPER_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { targetVersion } = request.body as { targetVersion: string };

    if (!targetVersion || typeof targetVersion !== 'string') {
      return reply.code(400).send({ error: 'targetVersion is required' });
    }

    const result = await app.prisma.edgeDevice.updateMany({
      where: {
        upgradeStatus: 'IDLE',
        OR: [
          { currentVersion: { not: targetVersion } },
          { currentVersion: null },
        ],
      },
      data: {
        targetVersion,
        upgradeStatus: 'PENDING',
        upgradeError: null,
      },
    });

    return { updated: result.count, targetVersion };
  });

  // GET /api/v1/fleet/summary — fleet overview stats
  app.get('/summary', { preHandler: [requireMinRole('SUPER_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const devices = await app.prisma.edgeDevice.findMany({
      select: {
        currentVersion: true,
        upgradeStatus: true,
        lastHeartbeatAt: true,
      },
    });

    const total = devices.length;
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

    // Count by version
    const versionCounts: Record<string, number> = {};
    let onlineCount = 0;
    let staleCount = 0;

    for (const d of devices) {
      const ver = d.currentVersion || 'unknown';
      versionCounts[ver] = (versionCounts[ver] || 0) + 1;
      if (d.lastHeartbeatAt > staleThreshold) {
        onlineCount++;
      } else {
        staleCount++;
      }
    }

    // Count by upgrade status
    const statusCounts: Record<string, number> = {};
    for (const d of devices) {
      statusCounts[d.upgradeStatus] = (statusCounts[d.upgradeStatus] || 0) + 1;
    }

    return {
      total,
      online: onlineCount,
      stale: staleCount,
      versionCounts,
      statusCounts,
    };
  });
}
