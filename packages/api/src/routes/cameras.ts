import type { FastifyPluginAsync } from 'fastify';
import { createCameraAdapter, type CameraAdapter } from '@safeschool/cameras';
import { getConfig } from '../config.js';

let cameraAdapter: CameraAdapter | null = null;

function getAdapter(): CameraAdapter {
  if (!cameraAdapter) {
    const config = getConfig();
    if (config.cameras.adapter === 'none') {
      throw new Error('No camera adapter configured. Set CAMERA_ADAPTER env variable.');
    }
    cameraAdapter = createCameraAdapter(config.cameras.adapter, {
      type: config.cameras.adapter,
      host: config.cameras.genetecVmsUrl,
    });
  }
  return cameraAdapter;
}

const cameraRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/cameras — List all cameras
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    try {
      const adapter = getAdapter();
      const cameras = await adapter.getCameras();
      return cameras;
    } catch (err) {
      fastify.log.error(err, 'Failed to list cameras');
      return reply.code(503).send({
        error: 'Camera service unavailable',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // GET /api/v1/cameras/:id/stream — Get stream URL for a camera
  fastify.get<{ Params: { id: string } }>(
    '/:id/stream',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      try {
        const adapter = getAdapter();
        const stream = await adapter.getStream(request.params.id);
        return stream;
      } catch (err) {
        fastify.log.error(err, 'Failed to get camera stream');
        return reply.code(503).send({
          error: 'Camera stream unavailable',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
  );

  // GET /api/v1/cameras/:id/snapshot — Get snapshot image
  fastify.get<{ Params: { id: string } }>(
    '/:id/snapshot',
    { preHandler: [fastify.authenticate] },
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
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
  );
};

export default cameraRoutes;
