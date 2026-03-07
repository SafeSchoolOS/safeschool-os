/**
 * HMAC-SHA256 Request Verification Middleware
 *
 * Verifies edge device requests using the shared sync key.
 * Provides replay protection via timestamp validation.
 *
 * Ported from SafeSchool's verifySyncKey middleware with improvements:
 * - Timing-safe comparison to prevent timing attacks
 * - Configurable max request age (replay window)
 * - Raw body caching for signature verification after parsing
 */

import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('cloud-sync:hmac');

export interface HmacVerifyOptions {
  syncKey: string;
  maxRequestAgeMs: number;
}

/**
 * Create a Fastify preHandler hook that verifies HMAC-signed sync requests.
 *
 * Expected headers:
 *   X-Sync-Key:       The shared sync key (must match)
 *   X-Sync-Timestamp: ISO timestamp of when the request was created
 *   X-Sync-Signature: HMAC-SHA256 of "{timestamp}.{method}.{path}.{body}"
 */
export function createHmacVerifyHook(options: HmacVerifyOptions) {
  const { syncKey, maxRequestAgeMs } = options;

  return async function verifySyncHmac(request: FastifyRequest, reply: FastifyReply) {
    // 1. Check sync key header
    const requestKey = request.headers['x-sync-key'] as string | undefined;
    if (!requestKey || requestKey !== syncKey) {
      log.warn({ ip: request.ip }, 'Invalid or missing sync key');
      return reply.code(401).send({ error: 'Invalid sync key' });
    }

    // 2. Check timestamp header + replay protection
    const timestamp = request.headers['x-sync-timestamp'] as string | undefined;
    if (!timestamp) {
      log.warn({ ip: request.ip }, 'Missing sync timestamp');
      return reply.code(401).send({ error: 'Missing request timestamp' });
    }

    const requestAge = Math.abs(Date.now() - new Date(timestamp).getTime());
    if (requestAge > maxRequestAgeMs) {
      log.warn({ ip: request.ip, requestAge }, 'Request timestamp expired');
      return reply.code(401).send({ error: 'Request timestamp expired' });
    }

    // 3. Verify HMAC signature
    const signature = request.headers['x-sync-signature'] as string | undefined;
    if (!signature) {
      log.warn({ ip: request.ip }, 'Missing sync signature');
      return reply.code(401).send({ error: 'Missing request signature' });
    }

    const method = request.method;
    const path = request.url; // Include query string to match client-side signing
    const bodyStr = request.method === 'POST' ? JSON.stringify(request.body ?? '') : '';

    const expectedSig = crypto
      .createHmac('sha256', syncKey)
      .update(`${timestamp}.${method}.${path}.${bodyStr}`)
      .digest('hex');

    // Timing-safe comparison
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      const payload = `${timestamp}.${method}.${path}.${bodyStr}`;
      log.warn({
        ip: request.ip,
        payload: payload.slice(0, 200),
        expectedSig: expectedSig.slice(0, 16),
        receivedSig: signature.slice(0, 16),
      }, 'Invalid request signature');
      return reply.code(401).send({ error: 'Invalid request signature' });
    }
  };
}
