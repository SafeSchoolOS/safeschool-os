import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { Queue } from 'bullmq';

export default fp(async (fastify) => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const alertQueue = new Queue('alert-processing', {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    },
  });

  fastify.decorate('redis', redis);
  fastify.decorate('alertQueue', alertQueue);

  fastify.addHook('onClose', async () => {
    await alertQueue.close();
    redis.disconnect();
  });
}, { name: 'redis' });
