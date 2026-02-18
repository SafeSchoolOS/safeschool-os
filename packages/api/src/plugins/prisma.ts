import fp from 'fastify-plugin';
import { prisma } from '@safeschool/db';

export default fp(async (fastify) => {
  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}, { name: 'prisma' });
