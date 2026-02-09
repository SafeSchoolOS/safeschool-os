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
import drillRoutes from './routes/drills.js';
import tipRoutes from './routes/tips.js';
import reunificationRoutes from './routes/reunification.js';
import environmentalRoutes from './routes/environmental.js';
import threatAssessmentRoutes from './routes/threat-assessments.js';
import socialMediaRoutes from './routes/social-media.js';
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
    let activeLockdowns = 0;
    try {
      activeLockdowns = await app.prisma.lockdownCommand.count({
        where: { releasedAt: null },
      });
    } catch { /* ignore if DB not ready */ }

    return {
      status: 'ok',
      mode: process.env.OPERATING_MODE || 'cloud',
      siteId: process.env.SITE_ID || null,
      activeLockdowns,
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
      name: 'SafeSchool OS API',
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
  await app.register(drillRoutes, { prefix: '/api/v1/drills' });
  await app.register(tipRoutes, { prefix: '/api/v1/tips' });
  await app.register(reunificationRoutes, { prefix: '/api/v1/reunification' });
  await app.register(environmentalRoutes, { prefix: '/api/v1/environmental' });
  await app.register(threatAssessmentRoutes, { prefix: '/api/v1/threat-assessments' });
  await app.register(socialMediaRoutes, { prefix: '/api/v1/social-media' });

  // Webhooks (no JWT auth — signature-verified)
  await app.register(zeroeyesWebhookRoutes, { prefix: '/webhooks/zeroeyes' });

  // Sync routes (cloud mode only)
  if (process.env.OPERATING_MODE === 'cloud') {
    const syncModule = await import('./routes/sync.js');
    await app.register(syncModule.default as any, { prefix: '/api/v1/sync' });
  }

  // Admin routes (edge mode only)
  if (process.env.OPERATING_MODE === 'edge') {
    const adminModule = await import('./routes/admin.js');
    await app.register(adminModule.default as any, { prefix: '/api/v1/admin' });
  }

  // WebSocket handler
  await app.register(wsHandler);

  return app;
}

async function start() {
  console.log('=== SafeSchool OS API Starting ===');
  console.log(`PORT=${PORT}, HOST=${HOST}`);
  console.log(`NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`OPERATING_MODE=${process.env.OPERATING_MODE || 'cloud'}`);
  console.log(`AUTH_PROVIDER=${process.env.AUTH_PROVIDER || 'dev'}`);
  console.log(`DATABASE_URL set: ${!!process.env.DATABASE_URL}`);
  console.log(`REDIS_URL set: ${!!process.env.REDIS_URL}`);

  try {
    const app = await buildServer();
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`SafeSchool OS API running on ${HOST}:${PORT}`);
    app.log.info(`Operating mode: ${process.env.OPERATING_MODE || 'cloud'}`);
    app.log.info(`Auth provider: ${process.env.AUTH_PROVIDER || 'dev'}`);
  } catch (err) {
    console.error('=== STARTUP FAILED ===');
    console.error(err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
