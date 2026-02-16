import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

export default async function fleetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/fleet/devices — list all edge devices
  app.get('/devices', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const devices = await app.prisma.edgeDevice.findMany({
      include: { site: { select: { id: true, name: true, district: true } } },
      orderBy: { lastHeartbeatAt: 'desc' },
    });
    return devices;
  });

  // GET /api/v1/fleet/devices/:id — single device detail
  app.get('/devices/:id', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.post('/devices/:id/upgrade', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  app.post('/upgrade-all', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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

  // GET /api/v1/fleet/releases — list available GitHub releases for upgrade
  app.get('/releases', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const GITHUB_REPO = 'bwattendorf/safeSchool';
    const token = process.env.GITHUB_TOKEN;
    try {
      const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`;
      const headers: Record<string, string> = {
        'User-Agent': 'SafeSchool-Edge',
        'Accept': 'application/vnd.github.v3+json',
      };
      if (token) headers['Authorization'] = `token ${token}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        const body = await res.text();
        return { releases: [], error: `GitHub API ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = await res.json() as any[];
      const releases = data.map((r: any) => ({
        tag: r.tag_name,
        name: r.name || r.tag_name,
        published: r.published_at,
        prerelease: r.prerelease,
        body: (r.body || '').slice(0, 500),
        assets: r.assets?.length || 0,
      }));
      return { releases };
    } catch (err: any) {
      reply.code(200);
      return { releases: [], error: err.message };
    }
  });

  // POST /api/v1/fleet/upgrade-selected — push upgrade to specific device IDs
  app.post('/upgrade-selected', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { deviceIds, targetVersion } = request.body as { deviceIds: string[]; targetVersion: string };

    if (!targetVersion || typeof targetVersion !== 'string') {
      return reply.code(400).send({ error: 'targetVersion is required' });
    }
    if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
      return reply.code(400).send({ error: 'deviceIds must be a non-empty array' });
    }

    const result = await app.prisma.edgeDevice.updateMany({
      where: {
        id: { in: deviceIds },
        upgradeStatus: { in: ['IDLE', 'FAILED'] },
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
  app.get('/summary', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
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
