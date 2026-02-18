import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { AlertEngine } from '../services/alert-engine.js';

/**
 * Weapons Detector Management Routes
 *
 * RBAC: All routes require OPERATOR or above.
 * Provides detector status and recent detection events from alert metadata.
 */
export default async function weaponsDetectorRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/weapons-detectors — List configured detectors derived from recent alerts
  app.get('/', { preHandler: [requireMinRole('OPERATOR')] }, async (request) => {
    const user = (request as any).user || (request as any).jwtUser;
    const siteId = user?.siteIds?.[0];

    // Find distinct detectors from recent weapons detection alerts
    const recentAlerts = await app.prisma.alert.findMany({
      where: {
        source: 'AUTOMATED',
        message: { contains: 'weapons detection' },
        ...(siteId ? { siteId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        message: true,
        createdAt: true,
        metadata: true,
      },
    });

    // Extract unique detectors from alert metadata
    const detectorMap = new Map<string, {
      detectorId: string;
      detectorName: string;
      vendor: string;
      entrance: string;
      lastSeen: string;
      eventCount: number;
    }>();

    for (const alert of recentAlerts) {
      const meta = (alert.metadata as Record<string, any>) || {};
      const detectorId = meta.detectorId || 'unknown';
      const existing = detectorMap.get(detectorId);

      if (!existing) {
        detectorMap.set(detectorId, {
          detectorId,
          detectorName: meta.detectorName || detectorId,
          vendor: meta.vendor || extractVendorFromMessage(alert.message || ''),
          entrance: meta.entrance || '',
          lastSeen: alert.createdAt.toISOString(),
          eventCount: 1,
        });
      } else {
        existing.eventCount++;
      }
    }

    return Array.from(detectorMap.values());
  });

  // GET /api/v1/weapons-detectors/events — Recent detection events
  app.get('/events', { preHandler: [requireMinRole('OPERATOR')] }, async (request) => {
    const user = (request as any).user || (request as any).jwtUser;
    const siteId = user?.siteIds?.[0];

    const alerts = await app.prisma.alert.findMany({
      where: {
        source: 'AUTOMATED',
        message: { contains: 'weapons detection' },
        ...(siteId ? { siteId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        level: true,
        status: true,
        message: true,
        createdAt: true,
        buildingName: true,
        metadata: true,
      },
    });

    return alerts.map((a) => {
      const meta = (a.metadata as Record<string, any>) || {};
      return {
        alertId: a.id,
        level: a.level,
        status: a.status,
        message: a.message,
        timestamp: a.createdAt,
        buildingName: a.buildingName,
        vendor: meta.vendor || extractVendorFromMessage(a.message || ''),
        threatLevel: meta.threatLevel || extractThreatFromMessage(a.message || ''),
        confidence: meta.confidence,
        detectorName: meta.detectorName,
        operatorAction: meta.operatorAction,
        imageUrl: meta.imageUrl,
      };
    });
  });

  // POST /api/v1/weapons-detectors/test — Send a test detection event (training mode)
  app.post('/test', { preHandler: [requireMinRole('OPERATOR')] }, async (request, reply) => {
    const user = (request as any).user || (request as any).jwtUser;
    const siteId = user?.siteIds?.[0];

    if (!siteId) {
      return reply.code(400).send({ error: 'User has no assigned site' });
    }

    const building = await app.prisma.building.findFirst({
      where: { siteId },
      select: { id: true, name: true },
    });

    if (!building) {
      return reply.code(400).send({ error: 'No building found at site' });
    }

    try {
      const alertEngine = new AlertEngine(app);
      const alert = await alertEngine.createAlert({
        siteId,
        level: 'LOCKDOWN',
        source: 'AUTOMATED',
        triggeredById: user.id,
        buildingId: building.id,
        message: `[TEST] Weapons detection test alert at ${building.name} — training mode verification`,
        ipAddress: request.ip,
        trainingMode: true,
      });

      return { alertId: alert.id, message: 'Test detection event created in training mode' };
    } catch (err) {
      app.log.error(err, 'Failed to create test weapons detection alert');
      return reply.code(500).send({ error: 'Failed to create test alert' });
    }
  });
}

function extractVendorFromMessage(message: string): string {
  if (message.includes('Evolv')) return 'Evolv';
  if (message.includes('CEIA')) return 'CEIA';
  if (message.includes('Xtract One')) return 'Xtract One';
  return 'Unknown';
}

function extractThreatFromMessage(message: string): string {
  if (message.includes('FIREARM')) return 'FIREARM';
  if (message.includes('MASS_CASUALTY')) return 'MASS_CASUALTY';
  if (message.includes('KNIFE')) return 'KNIFE';
  if (message.includes('ANOMALY')) return 'ANOMALY';
  return 'UNKNOWN';
}
