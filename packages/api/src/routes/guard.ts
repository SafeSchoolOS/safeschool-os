import { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Guard Console API — PAID FEATURE
 *
 * Provides security guard functionality:
 * - Real-time visitor dashboard with active counts
 * - Manual check-in/out for non-kiosk entries
 * - Watchlist management (custom blocked visitors)
 * - Lockdown awareness and door status
 * - Activity log for the current shift
 */
const guardRoutes: FastifyPluginAsync = async (app) => {

  // Middleware: check guard console license
  const requireGuardLicense = async (request: any, reply: any) => {
    const siteId = request.params?.siteId || request.query?.siteId;
    if (!siteId) {
      return reply.code(400).send({ error: 'siteId required' });
    }

    const license = await app.prisma.siteLicense.findUnique({
      where: { siteId },
    });

    const isExpired = license?.expiresAt && new Date(license.expiresAt) < new Date();
    if (!license?.guardConsole || isExpired) {
      return reply.code(403).send({
        error: 'Guard Console requires a BadgeKiosk Professional license',
        feature: 'guardConsole',
        upgrade: true,
      });
    }
  };

  // GET /api/v1/guard/:siteId/dashboard — guard overview
  app.get('/:siteId/dashboard', {
    preHandler: [requireMinRole('OPERATOR'), requireGuardLicense],
  }, async (request) => {
    const { siteId } = request.params as { siteId: string };

    const [activeVisitors, todayCheckIns, todayCheckOuts, flaggedVisitors, activeLockdowns, doors] = await Promise.all([
      app.prisma.visitor.count({ where: { siteId, status: 'CHECKED_IN' } }),
      app.prisma.visitor.count({
        where: {
          siteId,
          checkedInAt: { gte: startOfDay() },
        },
      }),
      app.prisma.visitor.count({
        where: {
          siteId,
          checkedOutAt: { gte: startOfDay() },
        },
      }),
      app.prisma.visitor.count({
        where: { siteId, status: 'FLAGGED' },
      }),
      app.prisma.lockdownCommand.count({
        where: { siteId, releasedAt: null },
      }),
      app.prisma.door.findMany({
        where: { siteId, isExterior: true },
        select: { id: true, name: true, status: true, buildingId: true },
      }),
    ]);

    return {
      activeVisitors,
      todayCheckIns,
      todayCheckOuts,
      flaggedVisitors,
      activeLockdowns,
      exteriorDoors: doors,
      isLockdown: activeLockdowns > 0,
      timestamp: new Date().toISOString(),
    };
  });

  // GET /api/v1/guard/:siteId/visitors — active visitors with details
  app.get('/:siteId/visitors', {
    preHandler: [requireMinRole('OPERATOR'), requireGuardLicense],
  }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const query = (request.query as any) || {};
    const status = query.status || 'CHECKED_IN';

    const visitors = await app.prisma.visitor.findMany({
      where: { siteId, status },
      include: { screening: true, host: true },
      orderBy: { checkedInAt: 'desc' },
      take: 100,
    });

    return visitors.map(v => ({
      id: v.id,
      firstName: v.firstName,
      lastName: v.lastName,
      photo: v.photo,
      badgeNumber: v.badgeNumber,
      purpose: v.purpose,
      destination: v.destination,
      host: v.host?.name,
      checkedInAt: v.checkedInAt,
      status: v.status,
      screeningStatus: v.screening
        ? (v.screening.sexOffenderCheck === 'FLAGGED' || v.screening.watchlistCheck === 'FLAGGED' ? 'FLAGGED' : 'CLEAR')
        : 'PENDING',
      duration: v.checkedInAt
        ? Math.round((Date.now() - new Date(v.checkedInAt).getTime()) / 60000)
        : null,
    }));
  });

  // POST /api/v1/guard/:siteId/manual-checkin — guard manually checks in a visitor
  app.post('/:siteId/manual-checkin', {
    preHandler: [requireMinRole('OPERATOR'), requireGuardLicense],
  }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const body = request.body as {
      firstName: string;
      lastName: string;
      purpose: string;
      destination: string;
      idType?: string;
      idVerified?: boolean;
      notes?: string;
    };

    const visitor = await app.prisma.visitor.create({
      data: {
        siteId,
        firstName: sanitizeText(body.firstName),
        lastName: sanitizeText(body.lastName),
        purpose: sanitizeText(body.purpose),
        destination: sanitizeText(body.destination),
        idType: body.idType,
        status: 'CHECKED_IN',
        checkedInAt: new Date(),
        badgeNumber: `G-${Date.now().toString(36).toUpperCase()}`,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId,
        userId: (request as any).jwtUser?.id,
        action: 'GUARD_MANUAL_CHECKIN',
        entity: 'Visitor',
        entityId: visitor.id,
        details: {
          idType: body.idType,
          idVerified: body.idVerified,
          notes: body.notes,
          badgeNumber: visitor.badgeNumber,
        },
      },
    });

    return visitor;
  });

  // POST /api/v1/guard/:siteId/manual-checkout/:visitorId — guard manually checks out
  app.post('/:siteId/manual-checkout/:visitorId', {
    preHandler: [requireMinRole('OPERATOR'), requireGuardLicense],
  }, async (request) => {
    const { siteId, visitorId } = request.params as { siteId: string; visitorId: string };

    const visitor = await app.prisma.visitor.update({
      where: { id: visitorId },
      data: {
        status: 'CHECKED_OUT',
        checkedOutAt: new Date(),
      },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId,
        userId: (request as any).jwtUser?.id,
        action: 'GUARD_MANUAL_CHECKOUT',
        entity: 'Visitor',
        entityId: visitorId,
        details: { badgeNumber: visitor.badgeNumber },
      },
    });

    return visitor;
  });

  // GET /api/v1/guard/:siteId/activity — recent activity log
  app.get('/:siteId/activity', {
    preHandler: [requireMinRole('OPERATOR'), requireGuardLicense],
  }, async (request) => {
    const { siteId } = request.params as { siteId: string };

    const logs = await app.prisma.auditLog.findMany({
      where: {
        siteId,
        action: {
          in: [
            'VISITOR_CHECKED_IN', 'VISITOR_CHECKED_OUT', 'VISITOR_DENIED',
            'GUARD_MANUAL_CHECKIN', 'GUARD_MANUAL_CHECKOUT',
            'BADGE_PRINTED', 'LOCKDOWN_INITIATED', 'LOCKDOWN_RELEASED',
          ],
        },
        createdAt: { gte: startOfDay() },
      },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return logs;
  });

  // POST /api/v1/guard/:siteId/alert — guard-initiated silent alert
  app.post('/:siteId/alert', {
    preHandler: [requireMinRole('OPERATOR'), requireGuardLicense],
  }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const body = request.body as {
      type: 'SUSPICIOUS_PERSON' | 'UNAUTHORIZED_ENTRY' | 'DISTURBANCE' | 'OTHER';
      description: string;
      visitorId?: string;
      location?: string;
    };

    const alert = await app.prisma.alert.create({
      data: {
        siteId,
        level: 'CUSTOM',
        status: 'TRIGGERED',
        source: 'DASHBOARD',
        triggeredById: (request as any).jwtUser.id,
        buildingId: 'MAIN',
        buildingName: 'Main Entrance',
        message: `Guard Alert: ${sanitizeText(body.type)} - ${sanitizeText(body.description)}`,
        metadata: {
          guardAlert: true,
          alertType: body.type,
          visitorId: body.visitorId,
          location: body.location,
        },
      },
    });

    // Broadcast via WebSocket
    app.wsManager?.broadcast(siteId, {
      type: 'GUARD_ALERT',
      alert,
    });

    await app.prisma.auditLog.create({
      data: {
        siteId,
        userId: (request as any).jwtUser?.id,
        action: 'GUARD_ALERT_TRIGGERED',
        entity: 'Alert',
        entityId: alert.id,
        details: { type: body.type, description: body.description, visitorId: body.visitorId },
      },
    });

    return alert;
  });
};

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default guardRoutes;
