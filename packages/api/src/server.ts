import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';

// Plugins
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import { createAuthPlugin } from './plugins/auth-provider.js';
import wsManagerPlugin from './plugins/ws-manager.js';

// Routes
import authRoutes from './routes/auth.js';
import alertRoutes from './routes/alerts.js';
import lockdownRoutes from './routes/lockdown.js';
import doorRoutes from './routes/doors.js';
import siteRoutes from './routes/sites.js';
import grantRoutes from './routes/grants.js';
import visitorRoutes from './routes/visitors.js';
import transportationRoutes from './routes/transportation.js';
import notificationRoutes from './routes/notifications.js';
import demoRequestRoutes from './routes/demo-requests.js';
import cameraRoutes from './routes/cameras.js';
import zeroeyesWebhookRoutes from './routes/webhooks/zeroeyes.js';
import wsHandler from './ws/handler.js';

// Side-effect: import types for augmentation
import './types.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

export async function buildServer() {
  const app = Fastify({
    logger: true,
  });

  // Core middleware
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Plugins
  await app.register(prismaPlugin);
  await app.register(redisPlugin);

  // Auth — Clerk or JWT based on AUTH_PROVIDER env
  const authPlugin = await createAuthPlugin();
  await app.register(authPlugin);

  await app.register(wsManagerPlugin);

  // Health check endpoint (used by Railway and monitoring)
  app.get('/health', async () => {
    return {
      status: 'ok',
      mode: process.env.OPERATING_MODE || 'cloud',
      siteId: process.env.SITE_ID || null,
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness check (confirms DB + Redis connectivity)
  app.get('/ready', async () => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      await app.redis.ping();
      return { status: 'ready' };
    } catch (err) {
      app.log.error(err, 'Readiness check failed');
      throw { statusCode: 503, message: 'Not ready' };
    }
  });

  // API info
  app.get('/', async () => {
    return {
      name: 'SafeSchool API',
      version: '0.3.0',
      description: "Alyssa's Law compliant school safety platform",
    };
  });

  // Routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(alertRoutes, { prefix: '/api/v1/alerts' });
  await app.register(lockdownRoutes, { prefix: '/api/v1/lockdown' });
  await app.register(doorRoutes, { prefix: '/api/v1/doors' });
  await app.register(siteRoutes, { prefix: '/api/v1/sites' });
  await app.register(grantRoutes, { prefix: '/api/v1/grants' });
  await app.register(visitorRoutes, { prefix: '/api/v1/visitors' });
  await app.register(transportationRoutes, { prefix: '/api/v1/transportation' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await app.register(demoRequestRoutes, { prefix: '/api/v1/demo-requests' });
  await app.register(cameraRoutes, { prefix: '/api/v1/cameras' });

  // Webhooks (no JWT auth — signature-verified)
  await app.register(zeroeyesWebhookRoutes, { prefix: '/webhooks/zeroeyes' });

  // Sync routes (cloud mode only)
  if (process.env.OPERATING_MODE === 'cloud') {
    const { default: syncRoutes } = await import('./routes/sync.js');
    await app.register(syncRoutes, { prefix: '/api/v1/sync' });
  }

  // WebSocket handler
  await app.register(wsHandler);

  return app;
}

async function start() {
  const app = await buildServer();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`SafeSchool API running on ${HOST}:${PORT}`);
    app.log.info(`Operating mode: ${process.env.OPERATING_MODE || 'cloud'}`);
    app.log.info(`Auth provider: ${process.env.AUTH_PROVIDER || 'dev'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
