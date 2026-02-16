/**
 * Worker entry point — starts the BullMQ alert worker with configured adapters.
 * Run alongside the API server (or in the same process for dev).
 */
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { prisma } from '@safeschool/db';
import { createAlertWorker } from './services/alert-worker.js';
import { getConfig } from './config.js';

const config = getConfig();

// Create adapter instances based on config
async function createDispatchFn() {
  const { ConsoleDispatchAdapter } = await import('@safeschool/dispatch');
  const adapter = new ConsoleDispatchAdapter();
  return async (data: any) => {
    await adapter.dispatch(data);
  };
}

async function createLockdownFn() {
  const { createAdapter } = await import('@safeschool/access-control');
  const adapter = createAdapter(config.accessControl.adapter);
  await adapter.connect({
    apiUrl: config.accessControl.apiUrl || 'mock://localhost',
    apiKey: config.accessControl.apiKey,
    username: config.accessControl.username,
    password: config.accessControl.password,
  });
  return async (data: any) => {
    await adapter.lockdownBuilding(data.buildingId);
  };
}

async function createNotifyFn() {
  const {
    NotificationRouter,
    ConsoleNotificationAdapter,
    TwilioSmsAdapter,
    SendGridEmailAdapter,
    FcmPushAdapter,
    PaIntercomAdapter,
  } = await import('@safeschool/notifications');

  const router = new NotificationRouter();

  if (config.notifications.adapter === 'console') {
    router.register(new ConsoleNotificationAdapter());
  } else {
    // Register channel-based adapters
    const smsAdapter = new TwilioSmsAdapter();
    const emailAdapter = new SendGridEmailAdapter();
    const pushAdapter = new FcmPushAdapter();
    const paAdapter = new PaIntercomAdapter();

    router.registerChannel('SMS', smsAdapter);
    router.registerChannel('EMAIL', emailAdapter);
    router.registerChannel('PUSH', pushAdapter);
    router.registerChannel('PA', paAdapter);

    // Also register console as fallback
    router.register(new ConsoleNotificationAdapter());
  }

  return async (data: any) => {
    await router.notify(data);
  };
}

async function createSocialMediaAdapterInstance() {
  if (config.socialMedia.adapter === 'console') return undefined;

  const { createSocialMediaAdapter } = await import('@safeschool/social-media');
  return createSocialMediaAdapter(config.socialMedia);
}

async function createWeatherAdapterInstance() {
  const adapterType = process.env.WEATHER_ADAPTER || 'nws';
  if (adapterType === 'console' || adapterType === 'none') return undefined;

  const { NWSAdapter } = await import('@safeschool/weather');
  return new NWSAdapter();
}

async function main() {
  console.log('[worker] Starting alert processing worker...');
  console.log(`[worker] Dispatch adapter: ${config.dispatch.adapter}`);
  console.log(`[worker] AC adapter: ${config.accessControl.adapter}`);
  console.log(`[worker] Notification adapter: ${config.notifications.adapter}`);
  console.log(`[worker] Transport enabled: ${config.transport.enabled}`);
  console.log(`[worker] Social media adapter: ${config.socialMedia.adapter}`);
  console.log(`[worker] Weather adapter: ${process.env.WEATHER_ADAPTER || 'nws'}`);

  const dispatchFn = await createDispatchFn();
  const lockdownFn = await createLockdownFn();
  const notifyFn = await createNotifyFn();
  const socialMediaAdapter = await createSocialMediaAdapterInstance();
  const weatherAdapter = await createWeatherAdapterInstance();

  const worker = createAlertWorker({
    prisma,
    dispatchFn,
    lockdownFn,
    notifyFn,
    socialMediaAdapter,
    weatherAdapter,
    geofenceRadiusMeters: config.transport.geofenceRadiusMeters,
  });

  // Schedule social media polling if adapter is not console
  if (socialMediaAdapter && config.socialMedia.adapter !== 'console') {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const alertQueue = new Queue('alert-processing', { connection: queueConnection as any });

    const intervalMs = config.socialMedia.pollingIntervalSeconds * 1000;
    await alertQueue.add(
      'poll-social-media',
      { lastPolledAt: new Date().toISOString() },
      {
        repeat: { every: intervalMs },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    );
    console.log(`[worker] Social media polling scheduled every ${config.socialMedia.pollingIntervalSeconds}s`);
  }

  // Schedule weather polling (every 5 minutes by default)
  if (weatherAdapter) {
    const weatherIntervalMs = parseInt(process.env.WEATHER_POLL_INTERVAL_MS || '300000', 10);
    const redisUrl2 = process.env.REDIS_URL || 'redis://localhost:6379';
    const weatherConn = new Redis(redisUrl2, { maxRetriesPerRequest: null });
    const weatherQueue = new Queue('alert-processing', { connection: weatherConn as any });

    await weatherQueue.add(
      'poll-weather',
      {},
      {
        repeat: { every: weatherIntervalMs },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    );
    console.log(`[worker] Weather polling scheduled every ${weatherIntervalMs / 1000}s`);
  }

  // Schedule auto-checkout (runs every minute)
  {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const autoCheckoutConn = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const autoCheckoutQueue = new Queue('alert-processing', { connection: autoCheckoutConn as any });
    await autoCheckoutQueue.add(
      'auto-checkout',
      {},
      {
        repeat: { every: 60000 }, // every minute
        removeOnComplete: 5,
        removeOnFail: 10,
      },
    );
    console.log('[worker] Auto-checkout scheduled every 60s');
  }

  console.log('[worker] Alert processing worker started. Waiting for jobs...');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[worker] Shutting down...');
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[worker] Failed to start:', err);
  process.exit(1);
});
