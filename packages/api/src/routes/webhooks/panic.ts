import type { FastifyPluginAsync } from 'fastify';
import { CentegixAdapter, RavePanicAdapter } from '@bwattendorf/adapters/panic-devices';
import type { PanicAlert } from '@bwattendorf/adapters/panic-devices';
import { AlertEngine } from '../../services/alert-engine.js';
import { getConfig } from '../../config.js';

/**
 * Panic Device Webhook Endpoints
 *
 * POST /webhooks/panic/centegix — Centegix CrisisAlert badge events
 * POST /webhooks/panic/rave     — Rave Panic Button app events
 *
 * Signature-verified (no JWT auth). On ACTIVE alerts, creates SafeSchool
 * alerts via AlertEngine which triggers lockdown + 911 dispatch + staff notify.
 */

// Alert level mapping: panic alert type → SafeSchool alert level
const LEVEL_MAP: Record<string, string> = {
  STAFF_ALERT: 'MEDICAL',
  MEDICAL: 'MEDICAL',
  SILENT_PANIC: 'LOCKDOWN',
  CAMPUS_WIDE: 'LOCKDOWN',
  ACTIVE_ASSAILANT: 'ACTIVE_THREAT',
};

let centegixAdapter: CentegixAdapter | null = null;
let raveAdapter: RavePanicAdapter | null = null;

function getCentegixAdapter(): CentegixAdapter {
  if (!centegixAdapter) {
    const config = getConfig();
    centegixAdapter = new CentegixAdapter({
      webhookSecret: config.panicDevices.centegixWebhookSecret,
    });
  }
  return centegixAdapter;
}

function getRaveAdapter(): RavePanicAdapter {
  if (!raveAdapter) {
    const config = getConfig();
    raveAdapter = new RavePanicAdapter({
      apiKey: config.panicDevices.raveApiKey,
    });
  }
  return raveAdapter;
}

/**
 * Resolve the user who triggered the panic alert.
 * 1. Match by wearableDeviceId (badge ID) — case-insensitive
 * 2. Fall back to site's first OPERATOR/SITE_ADMIN
 * 3. Return null if no user found (caller should skip alert creation)
 */
async function resolveUser(
  prisma: any,
  badgeId: string | undefined,
  siteId: string,
  log: any,
): Promise<{ id: string; name: string } | null> {
  // Try badge lookup first
  if (badgeId) {
    const byBadge = await prisma.user.findFirst({
      where: {
        wearableDeviceId: { equals: badgeId, mode: 'insensitive' },
        isActive: true,
      },
      select: { id: true, name: true },
    });
    if (byBadge) return byBadge;
    log.warn({ badgeId }, 'No user found for badge ID — falling back to site operator');
  }

  // Fallback: site's first operator/admin
  const fallback = await prisma.user.findFirst({
    where: {
      role: { in: ['OPERATOR', 'SITE_ADMIN', 'SUPER_ADMIN'] },
      isActive: true,
      sites: { some: { siteId } },
    },
    orderBy: { role: 'desc' },
    select: { id: true, name: true },
  });
  return fallback;
}

/**
 * Resolve site and building from the panic alert location data + user.
 */
async function resolveSiteAndBuilding(
  prisma: any,
  panicAlert: PanicAlert,
  userId: string,
): Promise<{ siteId: string; buildingId: string } | null> {
  // Try user's site first
  const userSite = await prisma.userSite.findFirst({
    where: { userId },
    select: { siteId: true },
  });
  let siteId = userSite?.siteId;

  // Fallback to first site
  if (!siteId) {
    const site = await prisma.site.findFirst({ select: { id: true } });
    siteId = site?.id;
  }
  if (!siteId) return null;

  // Try to match building by name
  let building = null;
  if (panicAlert.location.buildingName) {
    building = await prisma.building.findFirst({
      where: {
        siteId,
        name: { contains: panicAlert.location.buildingName, mode: 'insensitive' },
      },
      select: { id: true },
    });
  }

  // Fallback to first building at site
  if (!building) {
    building = await prisma.building.findFirst({
      where: { siteId },
      select: { id: true },
    });
  }
  if (!building) return null;

  return { siteId, buildingId: building.id };
}

/**
 * Shared handler for both Centegix and Rave webhooks.
 */
async function handlePanicAlert(
  fastify: any,
  request: any,
  panicAlert: PanicAlert,
  vendorName: string,
): Promise<{ received: boolean; alertCreated: boolean; alertId?: string }> {
  // Only create alerts for ACTIVE status
  if (panicAlert.status !== 'ACTIVE') {
    fastify.log.info(
      { alertId: panicAlert.alertId, status: panicAlert.status },
      `${vendorName} alert skipped — status is ${panicAlert.status}`,
    );
    return { received: true, alertCreated: false };
  }

  // Determine site first (needed for user resolution)
  const tempSite = await fastify.prisma.site.findFirst({ select: { id: true } });
  const tempSiteId = tempSite?.id || '';

  // Resolve triggering user
  const user = await resolveUser(
    fastify.prisma,
    panicAlert.initiator.badgeId,
    tempSiteId,
    fastify.log,
  );

  if (!user) {
    fastify.log.error(
      { alertId: panicAlert.alertId, vendorName },
      'Cannot create alert: no valid user found for panic device',
    );
    return { received: true, alertCreated: false };
  }

  // Resolve site + building
  const location = await resolveSiteAndBuilding(fastify.prisma, panicAlert, user.id);
  if (!location) {
    fastify.log.error(
      { alertId: panicAlert.alertId },
      'Cannot create alert: no site/building found',
    );
    return { received: true, alertCreated: false };
  }

  const alertLevel = LEVEL_MAP[panicAlert.alertType] || 'LOCKDOWN';

  const locationParts = [
    panicAlert.location.buildingName,
    panicAlert.location.room,
    panicAlert.location.floor != null ? `Floor ${panicAlert.location.floor}` : null,
  ].filter(Boolean);
  const locationStr = locationParts.length > 0 ? ` in ${locationParts.join(', ')}` : '';

  try {
    const alertEngine = new AlertEngine(fastify);
    const alert = await alertEngine.createAlert({
      siteId: location.siteId,
      level: alertLevel,
      source: 'WEARABLE',
      triggeredById: user.id,
      buildingId: location.buildingId,
      floor: panicAlert.location.floor,
      message: `${vendorName} ${panicAlert.alertType} panic alert from ${user.name}${locationStr}`,
      ipAddress: request.ip,
    });

    fastify.log.info(
      { alertId: alert.id, panicAlertId: panicAlert.alertId, level: alertLevel },
      `${vendorName} panic alert created`,
    );

    return { received: true, alertCreated: true, alertId: alert.id };
  } catch (err) {
    fastify.log.error(err, `Failed to create alert from ${vendorName} panic device`);
    return { received: true, alertCreated: false };
  }
}

const panicWebhookRoutes: FastifyPluginAsync = async (fastify) => {
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

  // POST /webhooks/panic/centegix — Centegix CrisisAlert webhook
  fastify.post('/centegix', async (request, reply) => {
    const adapter = getCentegixAdapter();
    const rawBody = (request as any).rawBody as string | undefined;
    const headers = request.headers as Record<string, string>;

    if (!rawBody) {
      return reply.code(400).send({ error: 'Missing request body' });
    }

    // Verify HMAC signature
    if (!adapter.verifySignature(headers, rawBody)) {
      fastify.log.warn('Centegix webhook signature verification failed');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    // Parse payload
    const panicAlert = adapter.parseWebhook(headers, request.body);
    if (!panicAlert) {
      return reply.code(400).send({ error: 'Invalid Centegix payload' });
    }

    fastify.log.info(
      { alertId: panicAlert.alertId, type: panicAlert.alertType, status: panicAlert.status },
      'Centegix panic alert received',
    );

    return handlePanicAlert(fastify, request, panicAlert, 'Centegix');
  });

  // POST /webhooks/panic/rave — Rave Panic Button webhook
  fastify.post('/rave', async (request, reply) => {
    const adapter = getRaveAdapter();
    const rawBody = (request as any).rawBody as string | undefined;
    const headers = request.headers as Record<string, string>;

    if (!rawBody) {
      return reply.code(400).send({ error: 'Missing request body' });
    }

    // Verify HMAC signature
    if (!adapter.verifySignature(headers, rawBody)) {
      fastify.log.warn('Rave webhook signature verification failed');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    // Parse payload — Rave is app-based, no badgeId
    const panicAlert = adapter.parseWebhook(headers, request.body);
    if (!panicAlert) {
      return reply.code(400).send({ error: 'Invalid Rave payload' });
    }

    fastify.log.info(
      { alertId: panicAlert.alertId, type: panicAlert.alertType, status: panicAlert.status },
      'Rave panic alert received',
    );

    return handlePanicAlert(fastify, request, panicAlert, 'Rave');
  });
};

export default panicWebhookRoutes;
