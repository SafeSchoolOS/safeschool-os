import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const integrationHealthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /integration-health — List all integration health records
  fastify.get('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];

    return fastify.prisma.integrationHealth.findMany({
      where: { siteId },
      orderBy: { integrationName: 'asc' },
    });
  });

  // GET /integration-health/:name — Detail for specific integration
  fastify.get<{ Params: { name: string } }>(
    '/:name',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const health = await fastify.prisma.integrationHealth.findUnique({
        where: { siteId_integrationName: { siteId, integrationName: request.params.name } },
      });
      if (!health) return reply.code(404).send({ error: 'Integration not found' });
      return health;
    },
  );

  // POST /integration-health/:name/check — Force re-check an integration
  fastify.post<{ Params: { name: string } }>(
    '/:name/check',
    { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] },
    async (request, reply) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      // Queue a health check job
      try {
        const { Queue } = await import('bullmq');
        const ioredis = await import('ioredis');
        const Redis = (ioredis as any).default ?? ioredis;
        const conn = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
        const queue = new Queue('alert-processing', { connection: conn as any });
        await queue.add('check-integration-health', {
          siteId,
          integrationName: request.params.name,
        });
        await queue.close();
        conn.disconnect();
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to queue integration health check');
      }

      // Update last check timestamp
      const health = await fastify.prisma.integrationHealth.upsert({
        where: { siteId_integrationName: { siteId, integrationName: request.params.name } },
        update: { lastCheckAt: new Date() },
        create: {
          siteId,
          integrationName: request.params.name,
          integrationType: 'ACCESS_CONTROL_INT' as any,
          lastCheckAt: new Date(),
        },
      });

      return { message: 'Health check queued', integration: health };
    },
  );
};

export default integrationHealthRoutes;
