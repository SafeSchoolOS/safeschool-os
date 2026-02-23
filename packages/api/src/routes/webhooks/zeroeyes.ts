import type { FastifyPluginAsync } from 'fastify';
import { ZeroEyesAdapter } from '@bwattendorf/adapters/threat-intel';
import type { ZeroEyesDetection } from '@bwattendorf/adapters/threat-intel';
import { AlertEngine } from '../../services/alert-engine.js';
import { getConfig } from '../../config.js';

/**
 * ZeroEyes Webhook Endpoint
 *
 * POST /webhooks/zeroeyes
 *
 * Receives weapon detection events from ZeroEyes. The request body is
 * verified using HMAC SHA-256 signature in the X-Signature header.
 * No JWT authentication is required — webhook signature is used instead.
 *
 * On high-confidence detections (>= threshold), the route automatically:
 * 1. Creates an ACTIVE_THREAT alert via AlertEngine
 * 2. Triggers lockdown + 911 dispatch via the AlertEngine job queue
 */

let zeroEyesAdapter: ZeroEyesAdapter | null = null;

function getZeroEyesAdapter(): ZeroEyesAdapter {
  if (!zeroEyesAdapter) {
    const config = getConfig();
    zeroEyesAdapter = new ZeroEyesAdapter({
      type: 'zeroeyes',
      apiUrl: config.threatIntel.zeroEyesApiUrl,
      apiKey: config.threatIntel.zeroEyesApiKey,
      webhookSecret: config.threatIntel.zeroEyesWebhookSecret,
    });
  }
  return zeroEyesAdapter;
}

const zeroeyesWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Ensure raw body is available for signature verification
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const json = JSON.parse(body as string);
        // Attach raw body for HMAC verification
        (req as any).rawBody = body;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // POST /webhooks/zeroeyes — Receive detection events
  fastify.post('/', async (request, reply) => {
    const adapter = getZeroEyesAdapter();

    // -----------------------------------------------------------------------
    // 1. Verify HMAC signature
    // -----------------------------------------------------------------------
    const signature = request.headers['x-signature'] as string | undefined;
    const rawBody = (request as any).rawBody as string | undefined;

    if (!signature || !rawBody) {
      return reply.code(401).send({ error: 'Missing X-Signature header' });
    }

    if (!adapter.verifyWebhookSignature(rawBody, signature)) {
      fastify.log.warn('ZeroEyes webhook signature verification failed');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    // -----------------------------------------------------------------------
    // 2. Parse detection payload
    // -----------------------------------------------------------------------
    const detection = request.body as ZeroEyesDetection;
    const threatEvent = adapter.parseWebhookPayload(detection);

    if (!threatEvent) {
      return reply.code(400).send({ error: 'Invalid detection payload' });
    }

    fastify.log.info(
      { eventId: threatEvent.id, type: threatEvent.type, confidence: threatEvent.confidence },
      'ZeroEyes detection received',
    );

    // -----------------------------------------------------------------------
    // 3. Auto-create ACTIVE_THREAT alert on high confidence
    // -----------------------------------------------------------------------
    if (adapter.shouldAutoAlert(threatEvent)) {
      fastify.log.warn(
        { eventId: threatEvent.id, confidence: threatEvent.confidence },
        'HIGH CONFIDENCE THREAT — auto-creating ACTIVE_THREAT alert',
      );

      try {
        const alertEngine = new AlertEngine(fastify);

        // Look up a site to associate the alert with.
        // In production the camera-to-site mapping would come from the DB.
        // For now, use the first site or fall back to env.
        const site = await fastify.prisma.site.findFirst();
        const siteId = site?.id || process.env.SITE_ID || '';

        // Try to find a building associated with the camera
        // (camera IDs may be stored as metadata in the building/room records)
        const building = await fastify.prisma.building.findFirst({
          where: { siteId },
        });

        if (siteId && building) {
          const alert = await alertEngine.createAlert({
            siteId,
            level: 'ACTIVE_THREAT',
            source: 'AUTOMATED',
            triggeredById: 'SYSTEM',
            buildingId: building.id,
            message: `ZeroEyes ${threatEvent.type} detection (confidence: ${(threatEvent.confidence * 100).toFixed(0)}%) on camera ${threatEvent.cameraId}`,
            ipAddress: request.ip,
          });

          fastify.log.info({ alertId: alert.id }, 'ACTIVE_THREAT alert created from ZeroEyes detection');

          return {
            received: true,
            alertCreated: true,
            alertId: alert.id,
            threatEvent: {
              id: threatEvent.id,
              type: threatEvent.type,
              confidence: threatEvent.confidence,
            },
          };
        } else {
          fastify.log.error('Cannot create alert: no site/building found');
        }
      } catch (err) {
        fastify.log.error(err, 'Failed to create ACTIVE_THREAT alert from ZeroEyes detection');
      }
    }

    // -----------------------------------------------------------------------
    // 4. Acknowledge receipt
    // -----------------------------------------------------------------------
    return {
      received: true,
      alertCreated: false,
      threatEvent: {
        id: threatEvent.id,
        type: threatEvent.type,
        confidence: threatEvent.confidence,
      },
    };
  });
};

export default zeroeyesWebhookRoutes;
