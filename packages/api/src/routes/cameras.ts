import type { FastifyPluginAsync } from 'fastify';
import { createCameraAdapter, discoverOnvifDevices, type CameraAdapter } from '@safeschool/cameras';
import { getConfig } from '../config.js';
import { requireMinRole } from '../middleware/rbac.js';

const isProduction = process.env.NODE_ENV === 'production';

/** Sanitize error details — hide internal messages in production */
function safeErrorMessage(err: unknown): string {
  if (!isProduction && err instanceof Error) return err.message;
  return 'Internal error — check server logs for details';
}

let cameraAdapter: CameraAdapter | null = null;

function getAdapter(): CameraAdapter {
  if (!cameraAdapter) {
    const config = getConfig();
    if (config.cameras.adapter === 'none') {
      throw new Error('No camera adapter configured. Set CAMERA_ADAPTER env variable.');
    }
    cameraAdapter = createCameraAdapter(config.cameras.adapter, {
      type: config.cameras.adapter,
      host: config.cameras.genetecVmsUrl || config.cameras.milestoneVmsUrl || config.cameras.avigilonUrl,
      username: config.cameras.username,
      password: config.cameras.password,
      clientId: config.cameras.clientId,
      clientSecret: config.cameras.clientSecret,
    });
  }
  return cameraAdapter;
}

const cameraRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/cameras — List all cameras
  fastify.get('/', { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] }, async (request, reply) => {
    try {
      const adapter = getAdapter();
      const cameras = await adapter.getCameras();
      return cameras;
    } catch (err) {
      fastify.log.error(err, 'Failed to list cameras');
      return reply.code(503).send({
        error: 'Camera service unavailable',
        message: safeErrorMessage(err),
      });
    }
  });

  // GET /api/v1/cameras/:id/stream — Get stream URL for a camera
  fastify.get<{ Params: { id: string } }>(
    '/:id/stream',
    { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] },
    async (request, reply) => {
      try {
        const adapter = getAdapter();
        const stream = await adapter.getStream(request.params.id);
        return stream;
      } catch (err) {
        fastify.log.error(err, 'Failed to get camera stream');
        return reply.code(503).send({
          error: 'Camera stream unavailable',
          message: safeErrorMessage(err),
        });
      }
    },
  );

  // GET /api/v1/cameras/:id/snapshot — Get snapshot image
  fastify.get<{ Params: { id: string } }>(
    '/:id/snapshot',
    { preHandler: [fastify.authenticate, requireMinRole('FIRST_RESPONDER')] },
    async (request, reply) => {
      try {
        const adapter = getAdapter();
        const snapshot = await adapter.getSnapshot(request.params.id);
        return reply
          .header('Content-Type', 'image/jpeg')
          .header('Cache-Control', 'no-cache')
          .send(snapshot);
      } catch (err) {
        fastify.log.error(err, 'Failed to get camera snapshot');
        return reply.code(503).send({
          error: 'Camera snapshot unavailable',
          message: safeErrorMessage(err),
        });
      }
    },
  );

  // POST /api/v1/cameras/:id/ptz — PTZ control
  fastify.post<{
    Params: { id: string };
    Body: { pan?: number; tilt?: number; zoom?: number };
  }>(
    '/:id/ptz',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const { pan, tilt, zoom } = request.body;

      if (pan === undefined && tilt === undefined && zoom === undefined) {
        return reply.code(400).send({ error: 'At least one of pan, tilt, or zoom is required' });
      }

      // Clamp values to -1.0 to 1.0
      const clamp = (v: number | undefined) => v !== undefined ? Math.max(-1, Math.min(1, v)) : undefined;

      try {
        const adapter = getAdapter();
        await adapter.ptzControl(request.params.id, {
          pan: clamp(pan),
          tilt: clamp(tilt),
          zoom: clamp(zoom),
        });
        return { success: true };
      } catch (err) {
        fastify.log.error(err, 'Failed to execute PTZ command');
        return reply.code(503).send({
          error: 'PTZ control unavailable',
          message: safeErrorMessage(err),
        });
      }
    },
  );

  // POST /api/v1/cameras/discover — ONVIF camera discovery on local network
  fastify.post<{ Body: { timeoutMs?: number } }>(
    '/discover',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const config = getConfig();
      if (!config.cameras.onvifDiscovery) {
        return reply.code(400).send({ error: 'ONVIF discovery is disabled. Set ONVIF_DISCOVERY_ENABLED=true.' });
      }

      try {
        const timeout = request.body?.timeoutMs || 5000;
        const devices = await discoverOnvifDevices(timeout);

        await fastify.prisma.auditLog.create({
          data: {
            siteId: request.jwtUser.siteIds[0],
            userId: request.jwtUser.id,
            action: 'CAMERA_DISCOVERY_RAN',
            entity: 'Camera',
            entityId: 'discovery',
            details: { devicesFound: devices.length },
            ipAddress: request.ip,
          },
        });

        return { devices, count: devices.length };
      } catch (err) {
        fastify.log.error(err, 'ONVIF discovery failed');
        return reply.code(503).send({
          error: 'Camera discovery failed',
          message: safeErrorMessage(err),
        });
      }
    },
  );

  // POST /api/v1/cameras/:id/motion — Receive motion event from camera/VMS webhook
  fastify.post<{
    Params: { id: string };
    Body: {
      timestamp?: string;
      region?: string;
      confidence?: number;
    };
  }>(
    '/:id/motion',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const { id } = request.params;
      const { timestamp, region, confidence } = request.body;

      fastify.log.info(
        { cameraId: id, region, confidence },
        'Camera motion event received',
      );

      // Broadcast to dashboard via WebSocket
      const siteId = request.jwtUser.siteIds[0];
      if (siteId) {
        fastify.wsManager.broadcastToSite(siteId, 'camera:motion', {
          cameraId: id,
          timestamp: timestamp || new Date().toISOString(),
          region: region || 'unknown',
          confidence: confidence ?? 0.5,
        });
      }

      return { received: true };
    },
  );

  // GET /api/v1/cameras/:id/recordings — List recording clips for a camera
  fastify.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string; limit?: string };
  }>(
    '/:id/recordings',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const { id } = request.params;
      const { from, to, limit } = request.query;

      // Recording retrieval depends on the VMS/NVR backend.
      // For ONVIF: use GetRecordingSearchResults SOAP call
      // For Genetec/Milestone/Avigilon: use their REST recording APIs
      // This route provides the abstraction layer.
      try {
        const adapter = getAdapter();
        // Check if adapter supports recordings (duck-type check)
        const adapterAny = adapter as any;
        if (typeof adapterAny.getRecordings === 'function') {
          const recordings = await adapterAny.getRecordings(id, {
            from: from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            to: to || new Date().toISOString(),
            limit: parseInt(limit || '50', 10),
          });
          return recordings;
        }

        // Fallback: return placeholder for adapters that don't support recording queries
        return {
          cameraId: id,
          recordings: [],
          message: `Recording retrieval not yet supported for ${adapter.name} adapter. Recordings are stored on your NVR/VMS and accessible via their native UI.`,
          nvrAccess: {
            note: 'Connect to your NVR/VMS directly for clip export',
            genetec: 'Security Desk → Archives → Export',
            milestone: 'XProtect Smart Client → Sequence Explorer',
            avigilon: 'ACC Client → Search & Export',
          },
        };
      } catch (err) {
        fastify.log.error(err, 'Failed to query recordings');
        return reply.code(503).send({
          error: 'Recording service unavailable',
          message: safeErrorMessage(err),
        });
      }
    },
  );

  // GET /api/v1/cameras/health — Camera system health summary
  fastify.get(
    '/health',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (_request, reply) => {
      try {
        const adapter = getAdapter();
        const cameras = await adapter.getCameras();

        const online = cameras.filter((c) => c.status === 'ONLINE').length;
        const offline = cameras.filter((c) => c.status === 'OFFLINE').length;
        const error = cameras.filter((c) => c.status === 'ERROR').length;

        return {
          total: cameras.length,
          online,
          offline,
          error,
          ptzCapable: cameras.filter((c) => c.capabilities.ptz).length,
          analyticsEnabled: cameras.filter((c) => c.capabilities.analytics).length,
          adapter: adapter.name,
        };
      } catch (err) {
        return reply.code(503).send({
          error: 'Camera service unavailable',
          total: 0, online: 0, offline: 0, errorCount: 0,
        });
      }
    },
  );
};

export default cameraRoutes;
