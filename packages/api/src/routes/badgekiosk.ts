import type { FastifyPluginAsync } from 'fastify';
import { BadgeKioskClient } from '@safeschool/visitor-mgmt';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const badgekioskRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Helper: get BK client for a site ─────────────────────────────────

  async function getClientForSite(siteId: string): Promise<{
    client: BadgeKioskClient;
    integration: any;
  } | null> {
    const integration = await fastify.prisma.badgeKioskIntegration.findUnique({
      where: { siteId },
    });
    if (!integration || !integration.enabled) return null;

    const client = new BadgeKioskClient({
      apiUrl: integration.apiUrl,
      apiKey: integration.apiKey,
    });
    return { client, integration };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Admin Config Routes (SITE_ADMIN+)
  // ══════════════════════════════════════════════════════════════════════

  // GET /config — Get BadgeKiosk integration config for the current site
  fastify.get(
    '/config',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const integration = await fastify.prisma.badgeKioskIntegration.findUnique({
        where: { siteId },
      });

      if (!integration) {
        return { configured: false };
      }

      // Don't leak the full API key — mask it
      return {
        configured: true,
        id: integration.id,
        apiUrl: integration.apiUrl,
        apiKeyMasked: integration.apiKey.slice(0, 8) + '...' + integration.apiKey.slice(-4),
        enabled: integration.enabled,
        autoSync: integration.autoSync,
        autoPrint: integration.autoPrint,
        defaultTemplate: integration.defaultTemplate,
        defaultPrinter: integration.defaultPrinter,
        features: integration.features,
        lastSyncAt: integration.lastSyncAt,
      };
    },
  );

  // PUT /config — Save/update BadgeKiosk API key + settings
  fastify.put<{
    Body: {
      apiUrl?: string;
      apiKey?: string;
      enabled?: boolean;
      autoSync?: boolean;
      autoPrint?: boolean;
      defaultTemplate?: string;
      defaultPrinter?: string;
    };
  }>(
    '/config',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const { apiUrl, apiKey, enabled, autoSync, autoPrint, defaultTemplate, defaultPrinter } =
        request.body;

      if (!apiKey && !(await fastify.prisma.badgeKioskIntegration.findUnique({ where: { siteId } }))) {
        return reply.code(400).send({ error: 'apiKey is required for initial setup' });
      }

      const data: any = {};
      if (apiUrl !== undefined) data.apiUrl = apiUrl;
      if (apiKey !== undefined) data.apiKey = apiKey;
      if (enabled !== undefined) data.enabled = enabled;
      if (autoSync !== undefined) data.autoSync = autoSync;
      if (autoPrint !== undefined) data.autoPrint = autoPrint;
      if (defaultTemplate !== undefined) data.defaultTemplate = defaultTemplate;
      if (defaultPrinter !== undefined) data.defaultPrinter = defaultPrinter;

      const integration = await fastify.prisma.badgeKioskIntegration.upsert({
        where: { siteId },
        update: data,
        create: {
          siteId,
          apiUrl: apiUrl || 'https://backend-production-345e.up.railway.app',
          apiKey: apiKey!,
          enabled: enabled ?? true,
          autoSync: autoSync ?? true,
          autoPrint: autoPrint ?? false,
          defaultTemplate: defaultTemplate || null,
          defaultPrinter: defaultPrinter || null,
        },
      });

      await fastify.prisma.auditLog.create({
        data: {
          siteId,
          userId: request.jwtUser.id,
          action: 'BADGEKIOSK_CONFIG_UPDATED',
          entity: 'BadgeKioskIntegration',
          entityId: integration.id,
          ipAddress: request.ip,
        },
      });

      return {
        id: integration.id,
        enabled: integration.enabled,
        autoSync: integration.autoSync,
        autoPrint: integration.autoPrint,
      };
    },
  );

  // POST /test — Test BadgeKiosk API connection
  fastify.post(
    '/test',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) {
        return reply.code(404).send({ error: 'BadgeKiosk integration not configured' });
      }

      const testResult = await result.client.testConnection();

      // Cache feature flags if test succeeded
      if (testResult.ok && testResult.features) {
        await fastify.prisma.badgeKioskIntegration.update({
          where: { siteId },
          data: {
            features: testResult.features as any,
            lastSyncAt: new Date(),
          },
        });
      }

      return testResult;
    },
  );

  // GET /templates — List available badge templates from BadgeKiosk
  fastify.get(
    '/templates',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) return reply.code(404).send({ error: 'BadgeKiosk integration not configured' });

      return result.client.getTemplates();
    },
  );

  // GET /printers — List available print servers from BadgeKiosk
  fastify.get(
    '/printers',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) return reply.code(404).send({ error: 'BadgeKiosk integration not configured' });

      return result.client.getPrintServers();
    },
  );

  // GET /features — Get feature flags (what's enabled by subscription)
  fastify.get(
    '/features',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) return reply.code(404).send({ error: 'BadgeKiosk integration not configured' });

      const features = await result.client.getFeatureFlags();

      // Cache features
      await fastify.prisma.badgeKioskIntegration.update({
        where: { siteId },
        data: { features: features as any },
      });

      return features;
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Badge Printing Routes (OPERATOR+)
  // ══════════════════════════════════════════════════════════════════════

  // POST /print — Print badge for a SafeSchool visitor
  fastify.post<{
    Body: {
      visitorId: string;
      templateId?: string;
      serverId?: string;
    };
  }>(
    '/print',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const { visitorId, templateId, serverId } = request.body;
      if (!visitorId) return reply.code(400).send({ error: 'visitorId is required' });

      const result = await getClientForSite(siteId);
      if (!result) return reply.code(404).send({ error: 'BadgeKiosk integration not configured' });

      const { client, integration } = result;

      // Get the visitor from SafeSchool
      const visitor = await fastify.prisma.visitor.findUnique({
        where: { id: visitorId },
        include: { host: true },
      });
      if (!visitor) return reply.code(404).send({ error: 'Visitor not found' });
      if (visitor.siteId !== siteId) return reply.code(403).send({ error: 'Visitor not in your site' });

      // Sync visitor as cardholder to BadgeKiosk
      const cardholder = await client.createCardholder({
        firstName: visitor.firstName,
        lastName: visitor.lastName,
        destination: visitor.destination,
        hostName: visitor.host ? visitor.host.name : undefined,
        badgeNumber: visitor.badgeNumber || undefined,
        photo: visitor.photo || undefined,
      });

      // Determine template and printer
      const tplId = templateId || integration.defaultTemplate;
      const srvId = serverId || integration.defaultPrinter;
      if (!tplId || !srvId) {
        return reply.code(400).send({
          error: 'templateId and serverId are required (or set defaults in config)',
          cardholderId: cardholder.id,
        });
      }

      // Submit print job
      const printJob = await client.submitPrintJob(tplId, cardholder.id, srvId);

      await fastify.prisma.auditLog.create({
        data: {
          siteId,
          userId: request.jwtUser.id,
          action: 'BADGE_PRINT_SUBMITTED',
          entity: 'Visitor',
          entityId: visitorId,
          details: {
            printJobId: printJob.id,
            cardholderId: cardholder.id,
            templateId: tplId,
            serverId: srvId,
          },
          ipAddress: request.ip,
        },
      });

      return {
        printJobId: printJob.id,
        status: printJob.status,
        cardholderId: cardholder.id,
      };
    },
  );

  // GET /print/:jobId — Check print job status
  fastify.get<{ Params: { jobId: string } }>(
    '/print/:jobId',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const result = await getClientForSite(siteId);
      if (!result) return reply.code(404).send({ error: 'BadgeKiosk integration not configured' });

      return result.client.getPrintJobStatus(request.params.jobId);
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // Guard Console Proxy Routes (OPERATOR+ with guard feature)
  // ══════════════════════════════════════════════════════════════════════

  // Helper: check guard feature is available
  async function requireGuardFeature(siteId: string, reply: any) {
    const integration = await fastify.prisma.badgeKioskIntegration.findUnique({
      where: { siteId },
    });
    if (!integration || !integration.enabled) {
      reply.code(404).send({ error: 'BadgeKiosk integration not configured' });
      return null;
    }

    const features = integration.features as any;
    if (!features?.guardConsole) {
      reply.code(403).send({
        error: 'Guard console requires a BadgeKiosk subscription with guard features',
        upgradeUrl: 'https://badgekiosk.com/pricing',
      });
      return null;
    }

    return new BadgeKioskClient({
      apiUrl: integration.apiUrl,
      apiKey: integration.apiKey,
    });
  }

  // GET /guard/checkpoints — List guard checkpoints
  fastify.get(
    '/guard/checkpoints',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const client = await requireGuardFeature(siteId, reply);
      if (!client) return;

      return client.getCheckpoints();
    },
  );

  // POST /guard/validate — Validate a QR/badge scan
  fastify.post<{
    Body: { scanData: string; checkpointId?: string };
  }>(
    '/guard/validate',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const client = await requireGuardFeature(siteId, reply);
      if (!client) return;

      const { scanData, checkpointId } = request.body;
      if (!scanData) return reply.code(400).send({ error: 'scanData is required' });

      const result = await client.validateScan({
        scanData: sanitizeText(scanData),
        checkpointId,
      });

      await fastify.prisma.auditLog.create({
        data: {
          siteId,
          userId: request.jwtUser.id,
          action: 'GUARD_SCAN_VALIDATED',
          entity: 'BadgeKiosk',
          details: { valid: result.valid, checkpointId },
          ipAddress: request.ip,
        },
      });

      return result;
    },
  );

  // GET /guard/stats — Guard session statistics
  fastify.get(
    '/guard/stats',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const client = await requireGuardFeature(siteId, reply);
      if (!client) return;

      return client.getSessionStats();
    },
  );
};

export default badgekioskRoutes;
