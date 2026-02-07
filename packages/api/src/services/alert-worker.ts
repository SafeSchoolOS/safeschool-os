import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import type { PrismaClient } from '@safeschool/db';

interface WorkerDeps {
  prisma: PrismaClient;
  dispatchFn: (data: any) => Promise<void>;
  lockdownFn: (data: any) => Promise<void>;
  notifyFn: (data: any) => Promise<void>;
  escalateFn?: (alertId: string, nextLevel: string) => Promise<any>;
  transportScanFn?: (data: any) => Promise<void>;
  transportGpsFn?: (data: any) => Promise<void>;
}

export function createAlertWorker(deps: WorkerDeps): Worker {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(
    'alert-processing',
    async (job: Job) => {
      switch (job.name) {
        case 'dispatch-911':
          await handleDispatch(job, deps);
          break;
        case 'auto-lockdown':
          await handleAutoLockdown(job, deps);
          break;
        case 'notify-staff':
          await handleNotifyStaff(job, deps);
          break;
        case 'auto-escalate':
          await handleAutoEscalate(job, deps);
          break;
        case 'mass-notify':
          await handleMassNotify(job, deps);
          break;
        case 'process-rfid-scan':
          await handleRfidScan(job, deps);
          break;
        case 'process-gps-update':
          await handleGpsUpdate(job, deps);
          break;
        case 'transport-notify':
          await handleTransportNotify(job, deps);
          break;
        default:
          console.warn(`Unknown job type: ${job.name}`);
      }
    },
    { connection, concurrency: 5 },
  );

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.name}:${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.name}:${job?.id} failed:`, err.message);
  });

  return worker;
}

async function handleDispatch(job: Job, deps: WorkerDeps): Promise<void> {
  const { alertId, siteId, level, buildingName, roomName, floor, latitude, longitude } = job.data;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚨 911 DISPATCH — ${level}`);
  console.log(`   Alert ID: ${alertId}`);
  console.log(`   Location: ${buildingName}${roomName ? `, ${roomName}` : ''}${floor ? `, Floor ${floor}` : ''}`);
  if (latitude && longitude) {
    console.log(`   GPS: ${latitude}, ${longitude}`);
  }
  console.log(`${'='.repeat(60)}\n`);

  // Create dispatch record
  await deps.prisma.dispatchRecord.create({
    data: {
      alertId,
      method: 'CONSOLE',
      status: 'SENT',
      sentAt: new Date(),
      confirmedAt: new Date(),
      responseTimeMs: 50,
    },
  });

  // Update alert status
  await deps.prisma.alert.update({
    where: { id: alertId },
    data: { status: 'DISPATCHED' },
  });

  // Call external dispatch adapter
  await deps.dispatchFn(job.data);
}

async function handleAutoLockdown(job: Job, deps: WorkerDeps): Promise<void> {
  const { alertId, siteId, buildingId, triggeredById } = job.data;
  console.log(`\n🔒 AUTO-LOCKDOWN initiated for building ${buildingId} (alert: ${alertId})`);

  // Call lockdown adapter
  await deps.lockdownFn(job.data);

  // Create lockdown record
  await deps.prisma.lockdownCommand.create({
    data: {
      siteId,
      scope: 'BUILDING',
      targetId: buildingId,
      initiatedById: triggeredById,
      alertId,
    },
  });

  // Update all doors in building to LOCKED
  await deps.prisma.door.updateMany({
    where: { buildingId, isEmergencyExit: false },
    data: { status: 'LOCKED' },
  });

  console.log(`🔒 AUTO-LOCKDOWN complete for building ${buildingId}`);
}

async function handleNotifyStaff(job: Job, deps: WorkerDeps): Promise<void> {
  const { alertId, siteId, level, message } = job.data;
  console.log(`\n📢 STAFF NOTIFICATION — ${level}: ${message}`);

  await deps.notifyFn(job.data);

  // Create notification log
  await deps.prisma.notificationLog.create({
    data: {
      siteId,
      alertId,
      channel: 'ALL',
      recipientCount: 0,
      message: message || `${level} alert`,
      status: 'SENT',
      sentAt: new Date(),
      metadata: { jobType: 'notify-staff' },
    },
  });
}

async function handleAutoEscalate(job: Job, deps: WorkerDeps): Promise<void> {
  const { alertId, currentLevel, nextLevel } = job.data;

  // Check if alert is still in TRIGGERED state (not yet acknowledged)
  const alert = await deps.prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert || alert.status !== 'TRIGGERED') {
    console.log(`[escalation] Alert ${alertId} already ${alert?.status || 'gone'}, skipping escalation`);
    return;
  }

  console.log(`\n⚡ AUTO-ESCALATION — Alert ${alertId}: ${currentLevel} → ${nextLevel} (no acknowledgment within timeout)`);

  if (deps.escalateFn) {
    await deps.escalateFn(alertId, nextLevel);
  } else {
    // Fallback: update directly if no engine function provided
    await deps.prisma.alert.update({
      where: { id: alertId },
      data: {
        level: nextLevel as any,
        message: `${alert.message || ''} [AUTO-ESCALATED from ${currentLevel}]`.trim(),
      },
    });

    await deps.prisma.auditLog.create({
      data: {
        siteId: alert.siteId,
        action: 'ALERT_ESCALATED',
        entity: 'Alert',
        entityId: alertId,
        details: { from: currentLevel, to: nextLevel, reason: 'auto-escalation timeout' },
      },
    });
  }
}

async function handleMassNotify(job: Job, deps: WorkerDeps): Promise<void> {
  const { siteId, channels, message, recipientScope, recipientIds, alertId } = job.data;
  console.log(`\n📣 MASS NOTIFICATION — ${channels.join(',')} to ${recipientScope}`);
  console.log(`   Message: ${message}`);

  await deps.notifyFn({
    alertId: alertId || 'mass-notification',
    siteId,
    level: 'CUSTOM',
    message,
    recipients: recipientIds || [],
    channels,
  });

  // Update notification log status
  const log = await deps.prisma.notificationLog.findFirst({
    where: { siteId, message, status: 'QUEUED' },
    orderBy: { createdAt: 'desc' },
  });

  if (log) {
    await deps.prisma.notificationLog.update({
      where: { id: log.id },
      data: { status: 'SENT' },
    });
  }
}

async function handleRfidScan(job: Job, deps: WorkerDeps): Promise<void> {
  const { studentCardId, studentName, busId, busNumber, scanType } = job.data;
  console.log(`\n🪪 RFID SCAN — ${studentName} ${scanType} Bus #${busNumber}`);

  if (deps.transportScanFn) {
    await deps.transportScanFn(job.data);
  }
}

async function handleGpsUpdate(job: Job, deps: WorkerDeps): Promise<void> {
  const { busId, latitude, longitude } = job.data;
  console.log(`[GPS] Bus ${busId}: ${latitude}, ${longitude}`);

  if (deps.transportGpsFn) {
    await deps.transportGpsFn(job.data);
  }
}

async function handleTransportNotify(job: Job, deps: WorkerDeps): Promise<void> {
  const { siteId, message, recipients, channels } = job.data;
  console.log(`\n🚌 TRANSPORT NOTIFICATION: ${message}`);

  await deps.notifyFn({
    alertId: 'transport-notification',
    siteId,
    level: 'CUSTOM',
    message,
    recipients,
    channels,
  });
}
