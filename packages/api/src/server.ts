import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
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
import auditLogRoutes from './routes/audit-log.js';
import licenseRoutes from './routes/licenses.js';
import badgePrintingRoutes from './routes/badge-printing.js';
import guardRoutes from './routes/guard.js';
import organizationRoutes from './routes/organizations.js';
import zeroeyesWebhookRoutes from './routes/webhooks/zeroeyes.js';
import wsHandler from './ws/handler.js';

// Side-effect: import types for augmentation
import './types.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      ...(process.env.NODE_ENV !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }),
      serializers: {
        req(req: any) {
          return {
            method: req.method,
            url: req.url,
            remoteAddress: req.ip,
          };
        },
      },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  // CORS — restrict to known origins in production, allow all only in dev
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : isProduction
      ? false // Block all cross-origin in production unless CORS_ORIGINS is set
      : true; // Allow all in dev
  await app.register(cors, {
    origin: allowedOrigins,
    credentials: isProduction ? false : true,
  });

  // Rate limiting — 100 req/min global, with stricter per-route overrides
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(websocket);

  // OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'SafeSchool OS API',
        description: "Alyssa's Law compliant school safety platform API",
        version: '0.5.0',
      },
      servers: [
        { url: process.env.API_BASE_URL || `http://localhost:${PORT}` },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Global error handler
  app.setErrorHandler((error: any, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    app.log.error({
      err: error,
      url: request.url,
      method: request.method,
      userId: (request as any).jwtUser?.id,
    });

    if (statusCode >= 500) {
      reply.code(statusCode).send({
        error: 'Internal Server Error',
        statusCode,
      });
    } else {
      reply.code(statusCode).send({
        error: error.message,
        statusCode,
      });
    }
  });

  // Plugins
  await app.register(prismaPlugin);
  await app.register(redisPlugin);

  // Auth — Clerk or JWT based on AUTH_PROVIDER env
  const authPlugin = await createAuthPlugin();
  await app.register(authPlugin);

  await app.register(wsManagerPlugin);

  // Health check endpoint (used by Railway and monitoring)
  // Minimal response — no operational data exposed without auth
  app.get('/health', async () => {
    return {
      status: 'ok',
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

  // API root — minimal info, no version disclosure
  app.get('/', async () => {
    return {
      status: 'ok',
      docs: '/docs',
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
  await app.register(auditLogRoutes, { prefix: '/api/v1/audit-log' });
  await app.register(licenseRoutes, { prefix: '/api/v1/licenses' });
  await app.register(badgePrintingRoutes, { prefix: '/api/v1/badges' });
  await app.register(guardRoutes, { prefix: '/api/v1/guard' });
  await app.register(organizationRoutes, { prefix: '/api/v1/organizations' });

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
