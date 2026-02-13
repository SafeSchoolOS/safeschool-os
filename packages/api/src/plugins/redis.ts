import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { Queue } from 'bullmq';

export default fp(async (fastify) => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  fastify.log.info(`Connecting to Redis: ${redisUrl.replace(/\/\/.*@/, '//***@')}`);

  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      const delay = Math.min(times * 500, 5000);
      fastify.log.warn(`Redis connection retry #${times}, next in ${delay}ms`);
      return delay;
    },
  });

  redis.on('error', (err) => {
    fastify.log.error(`Redis error: ${err.message}`);
  });

  redis.on('connect', () => {
    fastify.log.info('Redis connected');
  });

  const alertQueue = new Queue('alert-processing', {
    connection: redis as any,
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
