import type { FastifyPluginAsync } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  createBusFleetAdapter,
  type BusFleetVendor,
} from '@safeschool/transportation';
import { getConfig } from '../../config.js';

/**
 * Verify HMAC-SHA256 webhook signature.
 * Returns true if signature matches, false otherwise.
 */
function verifyWebhookSignature(
  payload: string | Buffer,
  secret: string,
  signature: string,
): boolean {
  try {
    const expected = createHmac('sha256', secret)
      .update(typeof payload === 'string' ? payload : payload)
      .digest('hex');

    const sigHex = signature.startsWith('sha256=')
      ? signature.slice(7)
      : signature;

    if (expected.length !== sigHex.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sigHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Bus Fleet Webhook Endpoints
 *
 * POST /webhooks/bus-fleet/:vendor — Receive real-time data from bus fleet systems
 *
 * Supported vendors: zonar, samsara, synovia, versatrans, seon, buspatrol
 *
 * Signature-verified via vendor-specific webhook secrets (no JWT auth).
 * Processes GPS updates, RFID scans, and driver events into the
 * transportation pipeline (BullMQ jobs).
 */

const adapterCache = new Map<string, ReturnType<typeof createBusFleetAdapter>>();

function getAdapter(vendor: BusFleetVendor) {
  if (!adapterCache.has(vendor)) {
    adapterCache.set(vendor, createBusFleetAdapter(vendor));
  }
  return adapterCache.get(vendor)!;
}

const busFleetWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  const config = getConfig();

  /**
   * POST /webhooks/bus-fleet/:vendor
   * Receives webhook payloads from bus fleet vendors.
   * Parses into normalized GPS, RFID, and driver events, then enqueues BullMQ jobs.
   */
  fastify.post<{ Params: { vendor: string } }>('/:vendor', async (request, reply) => {
    const vendor = request.params.vendor as BusFleetVendor;

    // Validate vendor
    const validVendors: BusFleetVendor[] = ['zonar', 'samsara', 'synovia', 'versatrans', 'seon', 'buspatrol'];
    if (!validVendors.includes(vendor)) {
      return reply.status(400).send({ error: `Unknown vendor: ${vendor}` });
    }

    // Verify webhook HMAC-SHA256 signature — required when secret is configured
    const webhookSecret = (config as any)[`BUS_FLEET_${vendor.toUpperCase()}_WEBHOOK_SECRET`];
    if (!webhookSecret && process.env.NODE_ENV === 'production') {
      fastify.log.error({ vendor }, 'Bus fleet webhook secret not configured in production');
      return reply.status(503).send({ error: 'Webhook endpoint not configured' });
    }
    if (webhookSecret) {
      const signature = (request.headers['x-webhook-signature'] || request.headers['x-signature']) as string | undefined;
      if (!signature) {
        return reply.status(401).send({ error: 'Missing webhook signature' });
      }

      const rawBody = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);

      if (!verifyWebhookSignature(rawBody, webhookSecret, signature)) {
        fastify.log.warn({ vendor }, 'Bus fleet webhook signature verification failed');
        return reply.status(401).send({ error: 'Invalid webhook signature' });
      }
    }

    try {
      const adapter = getAdapter(vendor);
      const parsed = adapter.parseWebhook(request.body, request.headers as Record<string, string>);

      let gpsCount = 0;
      let rfidCount = 0;
      let eventCount = 0;

      // Enqueue GPS updates
      for (const gps of parsed.gpsUpdates) {
        await fastify.alertQueue.add('process-gps-update', {
          busId: gps.vehicleId,
          position: {
            latitude: gps.latitude,
            longitude: gps.longitude,
            speed: gps.speed,
            heading: gps.heading,
            timestamp: gps.timestamp,
          },
          source: vendor,
        });
        gpsCount++;
      }

      // Enqueue RFID scans
      for (const scan of parsed.rfidScans) {
        await fastify.alertQueue.add('process-rfid-scan', {
          cardId: scan.studentCardId,
          busId: scan.vehicleId,
          scanType: scan.scanType,
          timestamp: scan.timestamp,
          source: vendor,
        });
        rfidCount++;
      }

      // Enqueue driver events (safety alerts)
      for (const event of parsed.driverEvents) {
        await fastify.alertQueue.add('process-driver-event', {
          vehicleId: event.vehicleId,
          busNumber: event.busNumber,
          eventType: event.eventType,
          severity: event.severity,
          timestamp: event.timestamp,
          latitude: event.latitude,
          longitude: event.longitude,
          description: event.description,
          mediaUrl: event.mediaUrl,
          source: vendor,
        });
        eventCount++;
      }

      fastify.log.info(
        { vendor, gpsCount, rfidCount, eventCount },
        'Bus fleet webhook processed',
      );

      return reply.status(200).send({
        ok: true,
        processed: { gps: gpsCount, rfid: rfidCount, events: eventCount },
      });
    } catch (err) {
      fastify.log.error({ err, vendor }, 'Bus fleet webhook processing failed');
      return reply.status(500).send({ error: 'Webhook processing failed' });
    }
  });

  /**
   * GET /webhooks/bus-fleet/health
   * Quick health check for webhook endpoint availability.
   */
  fastify.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', vendors: ['zonar', 'samsara', 'synovia', 'versatrans', 'seon', 'buspatrol'] });
  });
};

export default busFleetWebhookRoutes;
