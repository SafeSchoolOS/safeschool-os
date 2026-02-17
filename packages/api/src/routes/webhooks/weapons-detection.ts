import type { FastifyPluginAsync } from 'fastify';
import { EvolvAdapter, CeiaAdapter, XtractOneAdapter } from '@safeschool/weapons-detection';
import type { WeaponDetectionEvent } from '@safeschool/weapons-detection';
import { AlertEngine } from '../../services/alert-engine.js';
import { getConfig } from '../../config.js';

/**
 * Weapons Detection Webhook Endpoints
 *
 * POST /webhooks/weapons-detection/evolv      — Evolv Express events
 * POST /webhooks/weapons-detection/ceia       — CEIA OPENGATE events (via VMS bridge)
 * POST /webhooks/weapons-detection/xtract-one — Xtract One Gateway events
 *
 * Signature-verified (no JWT auth). On ACTIVE threat detections, creates
 * SafeSchool alerts via AlertEngine which triggers lockdown + 911 dispatch + staff notify.
 */

// Threat level → SafeSchool alert level mapping
const LEVEL_MAP: Record<string, string> = {
  FIREARM: 'ACTIVE_THREAT',
  MASS_CASUALTY: 'ACTIVE_THREAT',
  KNIFE: 'LOCKDOWN',
  ANOMALY: 'MEDICAL',
};

let evolvAdapter: EvolvAdapter | null = null;
let ceiaAdapter: CeiaAdapter | null = null;
let xtractOneAdapter: XtractOneAdapter | null = null;

function getEvolvAdapter(): EvolvAdapter {
  if (!evolvAdapter) {
    const config = getConfig();
    evolvAdapter = new EvolvAdapter({
      apiKey: config.weaponsDetection.evolvApiKey,
      webhookSecret: config.weaponsDetection.evolvWebhookSecret,
      apiUrl: config.weaponsDetection.evolvApiUrl,
    });
  }
  return evolvAdapter;
}

function getCeiaAdapter(): CeiaAdapter {
  if (!ceiaAdapter) {
    const config = getConfig();
    ceiaAdapter = new CeiaAdapter({
      webhookSecret: config.weaponsDetection.ceiaWebhookSecret,
    });
  }
  return ceiaAdapter;
}

function getXtractOneAdapter(): XtractOneAdapter {
  if (!xtractOneAdapter) {
    const config = getConfig();
    xtractOneAdapter = new XtractOneAdapter({
      apiKey: config.weaponsDetection.xtractOneApiKey,
      webhookSecret: config.weaponsDetection.xtractOneWebhookSecret,
    });
  }
  return xtractOneAdapter;
}

/**
 * Resolve site and building from detection event location data.
 */
async function resolveSiteAndBuilding(
  prisma: any,
  event: WeaponDetectionEvent,
): Promise<{ siteId: string; buildingId: string } | null> {
  let site = null;

  // Try to match site by name
  if (event.location.siteName) {
    site = await prisma.site.findFirst({
      where: { name: { contains: event.location.siteName, mode: 'insensitive' } },
      select: { id: true },
    });
  }

  // Fallback to first site
  if (!site) {
    site = await prisma.site.findFirst({ select: { id: true } });
  }
  if (!site) return null;

  // Try to match building by name
  let building = null;
  if (event.location.buildingName) {
    building = await prisma.building.findFirst({
      where: {
        siteId: site.id,
        name: { contains: event.location.buildingName, mode: 'insensitive' },
      },
      select: { id: true },
    });
  }

  // Fallback to first building at site
  if (!building) {
    building = await prisma.building.findFirst({
      where: { siteId: site.id },
      select: { id: true },
    });
  }
  if (!building) return null;

  return { siteId: site.id, buildingId: building.id };
}

/**
 * Resolve a system user to attribute automated alerts to.
 */
async function resolveSystemUser(prisma: any, siteId: string): Promise<{ id: string; name: string } | null> {
  const user = await prisma.user.findFirst({
    where: {
      role: { in: ['OPERATOR', 'SITE_ADMIN', 'SUPER_ADMIN'] },
      isActive: true,
      sites: { some: { siteId } },
    },
    orderBy: { role: 'desc' },
    select: { id: true, name: true },
  });
  return user;
}

/**
 * Shared handler for all weapons detection webhooks.
 */
async function handleDetectionEvent(
  fastify: any,
  request: any,
  event: WeaponDetectionEvent,
  vendorName: string,
): Promise<{ received: boolean; alertCreated: boolean; alertId?: string }> {
  // Skip non-active and CLEAR events
  if (event.status !== 'ACTIVE') {
    fastify.log.info(
      { eventId: event.eventId, status: event.status },
      `${vendorName} detection skipped — status is ${event.status}`,
    );
    return { received: true, alertCreated: false };
  }

  if (event.threatLevel === 'CLEAR') {
    fastify.log.info(
      { eventId: event.eventId },
      `${vendorName} detection skipped — threat level is CLEAR`,
    );
    return { received: true, alertCreated: false };
  }

  // Resolve location
  const location = await resolveSiteAndBuilding(fastify.prisma, event);
  if (!location) {
    fastify.log.error(
      { eventId: event.eventId },
      `Cannot create alert from ${vendorName}: no site/building found`,
    );
    return { received: true, alertCreated: false };
  }

  // Resolve user to attribute alert to
  const user = await resolveSystemUser(fastify.prisma, location.siteId);
  if (!user) {
    fastify.log.error(
      { eventId: event.eventId },
      `Cannot create alert from ${vendorName}: no operator user found`,
    );
    return { received: true, alertCreated: false };
  }

  const alertLevel = LEVEL_MAP[event.threatLevel] || 'LOCKDOWN';

  const locationParts = [
    event.location.buildingName,
    event.location.entrance,
    event.location.lane != null ? `Lane ${event.location.lane}` : null,
  ].filter(Boolean);
  const locationStr = locationParts.length > 0 ? ` at ${locationParts.join(', ')}` : '';

  const confidenceStr = event.confidence != null ? ` (${Math.round(event.confidence * 100)}% confidence)` : '';
  const detectorStr = event.detectorName ? ` by ${event.detectorName}` : '';

  try {
    const alertEngine = new AlertEngine(fastify);
    const alert = await alertEngine.createAlert({
      siteId: location.siteId,
      level: alertLevel,
      source: 'AUTOMATED',
      triggeredById: user.id,
      buildingId: location.buildingId,
      message: `${vendorName} weapons detection: ${event.threatLevel} detected${detectorStr}${locationStr}${confidenceStr}`,
      ipAddress: request.ip,
    });

    fastify.log.info(
      { alertId: alert.id, eventId: event.eventId, level: alertLevel, vendor: vendorName },
      `${vendorName} weapons detection alert created`,
    );

    return { received: true, alertCreated: true, alertId: alert.id };
  } catch (err) {
    fastify.log.error(err, `Failed to create alert from ${vendorName} weapons detection`);
    return { received: true, alertCreated: false };
  }
}

const weaponsDetectionWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Raw body capture for HMAC signature verification
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const json = JSON.parse(body as string);
        (req as any).rawBody = body;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // POST /webhooks/weapons-detection/evolv — Evolv Express webhook
  fastify.post('/evolv', async (request, reply) => {
    const adapter = getEvolvAdapter();
    const rawBody = (request as any).rawBody as string | undefined;
    const headers = request.headers as Record<string, string>;

    if (!rawBody) {
      return reply.code(400).send({ error: 'Missing request body' });
    }

    if (!adapter.verifySignature(headers, rawBody)) {
      fastify.log.warn('Evolv webhook signature verification failed');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const event = adapter.parseWebhook(headers, request.body);
    if (!event) {
      return reply.code(400).send({ error: 'Invalid Evolv payload' });
    }

    fastify.log.info(
      { eventId: event.eventId, threatLevel: event.threatLevel, status: event.status },
      'Evolv weapons detection event received',
    );

    return handleDetectionEvent(fastify, request, event, 'Evolv');
  });

  // POST /webhooks/weapons-detection/ceia — CEIA OPENGATE webhook (via VMS bridge)
  fastify.post('/ceia', async (request, reply) => {
    const adapter = getCeiaAdapter();
    const rawBody = (request as any).rawBody as string | undefined;
    const headers = request.headers as Record<string, string>;

    if (!rawBody) {
      return reply.code(400).send({ error: 'Missing request body' });
    }

    if (!adapter.verifySignature(headers, rawBody)) {
      fastify.log.warn('CEIA webhook signature verification failed');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const event = adapter.parseWebhook(headers, request.body);
    if (!event) {
      return reply.code(400).send({ error: 'Invalid CEIA payload' });
    }

    fastify.log.info(
      { eventId: event.eventId, threatLevel: event.threatLevel, status: event.status },
      'CEIA weapons detection event received',
    );

    return handleDetectionEvent(fastify, request, event, 'CEIA');
  });

  // POST /webhooks/weapons-detection/xtract-one — Xtract One Gateway webhook
  fastify.post('/xtract-one', async (request, reply) => {
    const adapter = getXtractOneAdapter();
    const rawBody = (request as any).rawBody as string | undefined;
    const headers = request.headers as Record<string, string>;

    if (!rawBody) {
      return reply.code(400).send({ error: 'Missing request body' });
    }

    if (!adapter.verifySignature(headers, rawBody)) {
      fastify.log.warn('Xtract One webhook signature verification failed');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const event = adapter.parseWebhook(headers, request.body);
    if (!event) {
      return reply.code(400).send({ error: 'Invalid Xtract One payload' });
    }

    fastify.log.info(
      { eventId: event.eventId, threatLevel: event.threatLevel, status: event.status },
      'Xtract One weapons detection event received',
    );

    return handleDetectionEvent(fastify, request, event, 'Xtract One');
  });
};

export default weaponsDetectionWebhookRoutes;
