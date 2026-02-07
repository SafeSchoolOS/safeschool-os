import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import type { FastifyRequest, FastifyReply } from 'fastify';

export default fp(async (fastify) => {
  await fastify.register(fjwt, {
    secret: process.env.JWT_SECRET || 'safeschool-dev-secret-change-in-production',
    sign: { expiresIn: '24h' },
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const decoded = await request.jwtVerify<{
        id: string;
        email: string;
        role: string;
        siteIds: string[];
      }>();
      request.jwtUser = decoded;
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}, { name: 'auth' });

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
