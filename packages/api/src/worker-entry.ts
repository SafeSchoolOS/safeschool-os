/**
 * Worker entry point — starts the BullMQ alert worker with configured adapters.
 * Run alongside the API server (or in the same process for dev).
 */
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

async function main() {
  console.log('[worker] Starting alert processing worker...');
  console.log(`[worker] Dispatch adapter: ${config.dispatch.adapter}`);
  console.log(`[worker] AC adapter: ${config.accessControl.adapter}`);
  console.log(`[worker] Notification adapter: ${config.notifications.adapter}`);
  console.log(`[worker] Transport enabled: ${config.transport.enabled}`);

  const dispatchFn = await createDispatchFn();
  const lockdownFn = await createLockdownFn();
  const notifyFn = await createNotifyFn();

  const worker = createAlertWorker({
    prisma,
    dispatchFn,
    lockdownFn,
    notifyFn,
  });

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
