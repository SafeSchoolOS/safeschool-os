import type { FastifyPluginAsync } from 'fastify';
import { BadgeGuardClient } from '@safeschool/access-control';
import { requireMinRole } from '../middleware/rbac.js';

const badgeguardAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Helper: get BadgeGuard client for a site ──────────────────────────

  async function getClientForSite(siteId: string): Promise<{
    client: BadgeGuardClient;
    integration: any;
  } | null> {
    const integration = await fastify.prisma.badgeGuardIntegration.findUnique({
      where: { siteId },
    });
    if (!integration || !integration.enabled) return null;

    const client = new BadgeGuardClient({
      apiUrl: integration.apiUrl,
      apiKey: integration.apiKey,
      siteId,
      deviceId: integration.deviceId || undefined,
    });
    return { client, integration };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Admin Config Routes (SITE_ADMIN+)
  // ══════════════════════════════════════════════════════════════════════

  // GET /config — Get BadgeGuard integration config
  fastify.get(
    '/config',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const integration = await fastify.prisma.badgeGuardIntegration.findUnique({
        where: { siteId },
      });

      if (!integration) {
        return { configured: false };
      }

      return {
        configured: true,
        id: integration.id,
        apiUrl: integration.apiUrl,
        apiKeyMasked: integration.apiKey.slice(0, 8) + '...' + integration.apiKey.slice(-4),
        enabled: integration.enabled,
        deviceId: integration.deviceId,
        pushInterval: integration.pushInterval,
        lastPushAt: integration.lastPushAt,
        lastAlertAt: integration.lastAlertAt,
        alertCount: integration.alertCount,
      };
    },
  );

  // PUT /config — Save/update BadgeGuard config + register with BadgeGuard
  fastify.put<{
    Body: {
      apiUrl?: string;
      apiKey?: string;
      enabled?: boolean;
      pushInterval?: number;
    };
  }>(
    '/config',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const { apiUrl, apiKey, enabled, pushInterval } = request.body;

      const existing = await fastify.prisma.badgeGuardIntegration.findUnique({ where: { siteId } });
      if (!apiKey && !existing) {
        return reply.code(400).send({ error: 'apiKey is required for initial setup' });
      }

      const data: any = {};
      if (apiUrl !== undefined) data.apiUrl = apiUrl;
      if (apiKey !== undefined) data.apiKey = apiKey;
      if (enabled !== undefined) data.enabled = enabled;
      if (pushInterval !== undefined) data.pushInterval = pushInterval;

      // If new setup, register with BadgeGuard to get a device ID
      let deviceId = existing?.deviceId;
      if (!deviceId && (apiKey || existing?.apiKey)) {
        try {
          const site = await fastify.prisma.site.findUnique({ where: { id: siteId } });
          if (site) {
            const client = new BadgeGuardClient({
              apiUrl: apiUrl || existing?.apiUrl || 'https://badgeguard-production.up.railway.app',
              apiKey: (apiKey || existing?.apiKey)!,
            });
            const reg = await client.register({
              siteName: site.name,
              district: site.district,
              address: site.address,
              city: site.city,
              state: site.state,
              timezone: site.timezone,
            });
            deviceId = reg.deviceId;
            data.deviceId = deviceId;
          }
        } catch (err: any) {
          fastify.log.warn({ err }, 'BadgeGuard registration failed — saving config without device ID');
        }
      }

      const integration = await fastify.prisma.badgeGuardIntegration.upsert({
        where: { siteId },
        update: data,
        create: {
          siteId,
          apiUrl: apiUrl || 'https://badgeguard-production.up.railway.app',
          apiKey: apiKey!,
          enabled: enabled ?? true,
          pushInterval: pushInterval ?? 300,
          deviceId: deviceId || null,
        },
      });

      await fastify.prisma.auditLog.create({
        data: {
          siteId,
          userId: request.jwtUser.id,
          action: 'BADGEGUARD_CONFIG_UPDATED',
          entity: 'BadgeGuardIntegration',
          entityId: integration.id,
          ipAddress: request.ip,
        },
      });

      return {
        id: integration.id,
        enabled: integration.enabled,
        deviceId: integration.deviceId,
        pushInterval: integration.pushInterval,
      };
    },
  );

  // POST /test — Test BadgeGuard API connection
  fastify.post(
    '/test',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) {
        return reply.code(404).send({ error: 'BadgeGuard integration not configured' });
      }

      return result.client.testConnection();
    },
  );

  // POST /push — Manually trigger event push (for testing)
  fastify.post(
    '/push',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) {
        return reply.code(404).send({ error: 'BadgeGuard integration not configured' });
      }

      // Read queued events from Redis
      const redisKey = `badgeguard:events:${siteId}`;
      const rawEvents = await fastify.redis.lrange(redisKey, 0, -1);

      if (rawEvents.length === 0) {
        return { pushed: 0, message: 'No events in queue' };
      }

      const events = rawEvents.map((e: string) => JSON.parse(e));
      const pushResult = await result.client.pushEvents(events);

      // Clear the queue on success
      await fastify.redis.del(redisKey);

      // Update last push time
      await fastify.prisma.badgeGuardIntegration.update({
        where: { siteId },
        data: { lastPushAt: new Date() },
      });

      return { pushed: events.length, ...pushResult };
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Analytics Display Routes (OPERATOR+)
  // ══════════════════════════════════════════════════════════════════════

  // GET /analytics — Proxy to BadgeGuard analytics endpoint
  fastify.get<{
    Querystring: { start?: string; end?: string };
  }>(
    '/analytics',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) {
        return reply.code(404).send({ error: 'BadgeGuard integration not configured' });
      }

      const { start, end } = request.query;
      return result.client.getAnalytics(
        start && end ? { start, end } : undefined,
      );
    },
  );

  // GET /alerts — Proxy to BadgeGuard alerts endpoint
  fastify.get<{
    Querystring: { severity?: string; type?: string; limit?: string; offset?: string };
  }>(
    '/alerts',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) {
        return reply.code(404).send({ error: 'BadgeGuard integration not configured' });
      }

      const { severity, type, limit, offset } = request.query;
      return result.client.getAlerts({
        severity,
        type,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });
    },
  );

  // GET /compliance — Proxy to BadgeGuard compliance report
  fastify.get<{
    Querystring: { start?: string; end?: string };
  }>(
    '/compliance',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) {
        return reply.code(404).send({ error: 'BadgeGuard integration not configured' });
      }

      const { start, end } = request.query;
      return result.client.getComplianceReport(
        start && end ? { start, end } : undefined,
      );
    },
  );
};

export default badgeguardAnalyticsRoutes;
