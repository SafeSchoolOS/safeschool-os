import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function buildServer() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Health check endpoint (used by Railway and monitoring)
  app.get('/health', async () => {
    return {
      status: 'ok',
      mode: process.env.OPERATING_MODE || 'cloud',
      siteId: process.env.SITE_ID || null,
      timestamp: new Date().toISOString(),
    };
  });

  // API info
  app.get('/', async () => {
    return {
      name: 'SafeSchool API',
      version: '0.1.0',
      description: "Alyssa's Law compliant school safety platform",
    };
  });

  // TODO: Register route modules
  // await app.register(alertRoutes, { prefix: '/api/v1/alerts' });
  // await app.register(lockdownRoutes, { prefix: '/api/v1/lockdown' });
  // await app.register(visitorRoutes, { prefix: '/api/v1/visitors' });
  // await app.register(dispatchRoutes, { prefix: '/api/v1/dispatch' });
  // await app.register(siteRoutes, { prefix: '/api/v1/sites' });
  // await app.register(syncRoutes, { prefix: '/api/v1/sync' });

  // WebSocket for real-time alerts
  app.get('/ws', { websocket: true }, (socket, req) => {
    app.log.info('WebSocket client connected');

    socket.on('message', (message: Buffer) => {
      const data = JSON.parse(message.toString());
      app.log.info({ data }, 'WebSocket message received');
    });

    socket.on('close', () => {
      app.log.info('WebSocket client disconnected');
    });
  });

  return app;
}

async function start() {
  const app = await buildServer();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`SafeSchool API running on ${HOST}:${PORT}`);
    app.log.info(`Operating mode: ${process.env.OPERATING_MODE || 'cloud'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
