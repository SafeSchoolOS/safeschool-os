import { FastifyPluginAsync } from 'fastify';
import { requireRole, requireMinRole } from '../middleware/rbac.js';

const licenseRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/licenses/:siteId — get site license info
  app.get('/:siteId', {
    preHandler: [requireMinRole('OPERATOR')],
  }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const license = await app.prisma.siteLicense.findUnique({
      where: { siteId },
    });

    // If no license record, return free-tier defaults
    if (!license) {
      return {
        siteId,
        badgePrinting: false,
        guardConsole: false,
        maxKiosks: 1,
        tier: 'free',
      };
    }

    const isExpired = license.expiresAt && new Date(license.expiresAt) < new Date();

    return {
      siteId: license.siteId,
      badgePrinting: isExpired ? false : license.badgePrinting,
      guardConsole: isExpired ? false : license.guardConsole,
      maxKiosks: license.maxKiosks,
      expiresAt: license.expiresAt,
      tier: license.badgePrinting && license.guardConsole ? 'enterprise'
        : license.badgePrinting || license.guardConsole ? 'professional'
        : 'free',
    };
  });

  // GET /api/v1/licenses/:siteId/features — kiosk-friendly feature check
  app.get('/:siteId/features', async (request) => {
    const { siteId } = request.params as { siteId: string };
    const license = await app.prisma.siteLicense.findUnique({
      where: { siteId },
    });

    const isExpired = license?.expiresAt && new Date(license.expiresAt) < new Date();
    const active = license && !isExpired;

    return {
      visitorManagement: true, // Always free
      screening: true, // Always free
      visitorLogs: true, // Always free
      badgePrinting: active ? license.badgePrinting : false,
      guardConsole: active ? license.guardConsole : false,
    };
  });

  // PUT /api/v1/licenses/:siteId — update license (super admin only)
  app.put('/:siteId', {
    preHandler: [requireRole('SUPER_ADMIN')],
  }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const body = request.body as {
      badgePrinting?: boolean;
      guardConsole?: boolean;
      licenseKey?: string;
      expiresAt?: string;
      maxKiosks?: number;
    };

    const license = await app.prisma.siteLicense.upsert({
      where: { siteId },
      update: {
        badgePrinting: body.badgePrinting,
        guardConsole: body.guardConsole,
        licenseKey: body.licenseKey,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        maxKiosks: body.maxKiosks,
      },
      create: {
        siteId,
        badgePrinting: body.badgePrinting ?? false,
        guardConsole: body.guardConsole ?? false,
        licenseKey: body.licenseKey,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        maxKiosks: body.maxKiosks ?? 1,
      },
    });

    return license;
  });
};

export default licenseRoutes;
