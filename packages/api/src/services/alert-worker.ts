import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import type { PrismaClient } from '@safeschool/db';
import { renderTemplate, STUDENT_SCAN_SMS, STUDENT_SCAN_PUSH, BUS_ARRIVAL_SMS, BUS_ARRIVAL_PUSH, WEATHER_ALERT_SMS } from '@safeschool/core';
import type { SocialMediaAdapter } from '@safeschool/social-media';
import type { WeatherAdapter } from '@safeschool/weather';

interface WorkerDeps {
  prisma: PrismaClient;
  dispatchFn: (data: any) => Promise<void>;
  lockdownFn: (data: any) => Promise<void>;
  notifyFn: (data: any) => Promise<void>;
  escalateFn?: (alertId: string, nextLevel: string) => Promise<any>;
  transportScanFn?: (data: any) => Promise<void>;
  transportGpsFn?: (data: any) => Promise<void>;
  socialMediaAdapter?: SocialMediaAdapter;
  weatherAdapter?: WeatherAdapter;
  geofenceRadiusMeters?: number;
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
        case 'poll-social-media':
          await handlePollSocialMedia(job, deps);
          break;
        case 'poll-weather':
          await handlePollWeather(job, deps);
          break;
        default:
          console.warn(`Unknown job type: ${job.name}`);
      }
    },
    { connection: connection as any, concurrency: 5 },
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
  const { studentCardId, studentName, busId, busNumber, scanType, scannedAt } = job.data;
  console.log(`\n🪪 RFID SCAN — ${studentName} ${scanType} Bus #${busNumber}`);

  // Look up parent contacts for this student card
  const parentContacts = await deps.prisma.parentContact.findMany({
    where: { studentCardId },
  });

  if (parentContacts.length === 0) {
    console.log(`[RFID] No parent contacts for student card ${studentCardId}`);
    return;
  }

  // Filter by notification preference (boardAlerts for BOARD, exitAlerts for EXIT)
  const eligibleParents = parentContacts.filter((p) =>
    scanType === 'BOARD' ? p.boardAlerts : p.exitAlerts,
  );

  if (eligibleParents.length === 0) {
    console.log(`[RFID] No parents opted in for ${scanType} alerts`);
    return;
  }

  // Get bus siteId for notification log
  const bus = await deps.prisma.bus.findUnique({ where: { id: busId } });
  const siteId = bus?.siteId || '';
  const scanTime = scannedAt ? new Date(scannedAt).toLocaleTimeString() : new Date().toLocaleTimeString();

  for (const parent of eligibleParents) {
    const channels: string[] = [];
    if (parent.smsEnabled && parent.phone) channels.push('SMS');
    if (parent.emailEnabled && parent.email) channels.push('EMAIL');
    if (parent.pushEnabled) channels.push('PUSH');

    if (channels.length === 0) continue;

    // Render templates based on channel
    const templateVars = {
      studentName: studentName || 'Student',
      busNumber: busNumber || '',
      scanTime,
      stopName: 'School',
      routeName: '',
    };

    let message: string;
    if (channels.includes('SMS')) {
      message = renderTemplate(STUDENT_SCAN_SMS, templateVars).body;
    } else {
      message = renderTemplate(STUDENT_SCAN_PUSH, templateVars).body;
    }

    await deps.notifyFn({
      alertId: 'transport-rfid-scan',
      siteId,
      level: 'CUSTOM',
      message,
      recipients: [{ name: parent.parentName, phone: parent.phone, email: parent.email }],
      channels,
    });

    console.log(`[RFID] Notified ${parent.parentName} via ${channels.join(',')} about ${studentName} ${scanType}`);
  }
}

/** Haversine distance in meters between two lat/lng points */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function handleGpsUpdate(job: Job, deps: WorkerDeps): Promise<void> {
  const { busId, latitude, longitude } = job.data;
  console.log(`[GPS] Bus ${busId}: ${latitude}, ${longitude}`);

  const geofenceRadius = deps.geofenceRadiusMeters || 200;

  // Look up bus with active route assignments and stops
  const bus = await deps.prisma.bus.findUnique({
    where: { id: busId },
    include: {
      routeAssignments: {
        include: {
          route: {
            include: {
              stops: {
                orderBy: { stopOrder: 'asc' },
                include: {
                  studentAssignments: {
                    include: { studentCard: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!bus || bus.routeAssignments.length === 0) {
    console.log(`[GPS] No active route for bus ${busId}`);
    return;
  }

  const route = bus.routeAssignments[0].route;
  if (!route) return;

  for (const stop of route.stops) {
    if (stop.latitude == null || stop.longitude == null) continue;

    const distance = haversineDistance(latitude, longitude, stop.latitude, stop.longitude);

    if (distance <= geofenceRadius) {
      console.log(`[GPS] Bus ${bus.busNumber} within ${Math.round(distance)}m of stop "${stop.name}"`);

      // Find students assigned to this stop
      const studentCardIds = stop.studentAssignments.map((sa: any) => sa.studentCardId);
      if (studentCardIds.length === 0) continue;

      // Find parents with ETA alerts enabled
      const parents = await deps.prisma.parentContact.findMany({
        where: {
          studentCardId: { in: studentCardIds },
          etaAlerts: true,
        },
        include: { studentCard: true },
      });

      for (const parent of parents) {
        const channels: string[] = [];
        if (parent.smsEnabled && parent.phone) channels.push('SMS');
        if (parent.emailEnabled && parent.email) channels.push('EMAIL');
        if (parent.pushEnabled) channels.push('PUSH');

        if (channels.length === 0) continue;

        const templateVars = {
          busNumber: bus.busNumber,
          routeName: route.name,
          stopName: stop.name,
          studentName: parent.studentCard?.studentName || 'your child',
        };

        let message: string;
        if (channels.includes('SMS')) {
          message = renderTemplate(BUS_ARRIVAL_SMS, templateVars).body;
        } else {
          message = renderTemplate(BUS_ARRIVAL_PUSH, templateVars).body;
        }

        await deps.notifyFn({
          alertId: 'transport-gps-arrival',
          siteId: bus.siteId,
          level: 'CUSTOM',
          message,
          recipients: [{ name: parent.parentName, phone: parent.phone, email: parent.email }],
          channels,
        });

        console.log(`[GPS] Notified ${parent.parentName} about bus ${bus.busNumber} arriving at ${stop.name}`);
      }
    }
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

async function handlePollSocialMedia(job: Job, deps: WorkerDeps): Promise<void> {
  if (!deps.socialMediaAdapter) {
    console.log('[poll-social-media] No social media adapter configured');
    return;
  }

  const adapter = deps.socialMediaAdapter;
  const since = job.data.lastPolledAt
    ? new Date(job.data.lastPolledAt)
    : new Date(Date.now() - 5 * 60 * 1000); // Default to 5 min ago

  console.log(`[poll-social-media] Polling ${adapter.name} since ${since.toISOString()}`);

  try {
    const events = await adapter.pollAlerts(since);
    console.log(`[poll-social-media] Found ${events.length} new alerts from ${adapter.name}`);

    // Determine site for alert storage
    const defaultSiteId = process.env.DEFAULT_SITE_ID;
    if (!defaultSiteId && events.length > 0) {
      const site = await deps.prisma.site.findFirst();
      if (!site) {
        console.warn('[poll-social-media] No site found, cannot store alerts');
        return;
      }
    }

    const siteId = defaultSiteId || (await deps.prisma.site.findFirst())?.id;
    if (!siteId) return;

    for (const event of events) {
      // Check for duplicate by externalId
      const existing = await deps.prisma.socialMediaAlert.findFirst({
        where: { externalId: event.id },
      });
      if (existing) continue;

      const alert = await deps.prisma.socialMediaAlert.create({
        data: {
          siteId,
          source: event.source.toUpperCase() as any,
          platform: event.platform,
          contentType: event.contentType || 'text',
          flaggedContent: event.content,
          category: event.category as any,
          severity: (event.severity || 'LOW') as any,
          studentName: event.studentName,
          studentGrade: event.studentGrade,
          externalId: event.id,
        },
      });

      // Auto-notify for HIGH/CRITICAL
      if (event.severity === 'HIGH' || event.severity === 'CRITICAL') {
        await deps.notifyFn({
          alertId: alert.id,
          siteId,
          level: event.severity === 'CRITICAL' ? 'ACTIVE_THREAT' : 'LOCKDOWN',
          message: `Social media alert (${event.source}/${event.platform}): ${event.category} - ${event.studentName || 'Unknown'}`,
        });
      }
    }
  } catch (err) {
    console.error(`[poll-social-media] Error polling ${adapter.name}:`, err);
  }
}

async function handlePollWeather(job: Job, deps: WorkerDeps): Promise<void> {
  if (!deps.weatherAdapter) {
    console.log('[poll-weather] No weather adapter configured');
    return;
  }

  // Fetch all sites with coordinates
  const sites = await deps.prisma.site.findMany({
    select: { id: true, name: true, latitude: true, longitude: true },
  });

  if (sites.length === 0) {
    console.log('[poll-weather] No sites to poll weather for');
    return;
  }

  console.log(`[poll-weather] Polling NWS for ${sites.length} sites`);

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const alertQueue = new Queue('alert-processing', { connection: redis as any });

  try {
    for (const site of sites) {
      try {
        const alerts = await deps.weatherAdapter.getActiveAlerts(site.latitude, site.longitude);
        const severeAlerts = alerts.filter(
          (a) => a.severity === 'Extreme' || a.severity === 'Severe',
        );

        if (severeAlerts.length === 0) continue;

        // Get a system user for triggeredBy (first SITE_ADMIN or SUPER_ADMIN)
        const systemUser = await deps.prisma.user.findFirst({
          where: {
            role: { in: ['SUPER_ADMIN', 'SITE_ADMIN'] },
            sites: { some: { siteId: site.id } },
          },
        });
        if (!systemUser) continue;

        const building = await deps.prisma.building.findFirst({
          where: { siteId: site.id },
          select: { id: true, name: true },
        });

        for (const weatherAlert of severeAlerts) {
          // Deduplicate by NWS alert ID
          const existing = await deps.prisma.alert.findFirst({
            where: {
              siteId: site.id,
              level: 'WEATHER',
              status: 'TRIGGERED',
              metadata: { path: ['nwsAlertId'], equals: weatherAlert.id },
            },
          });

          if (existing) continue;

          const alert = await deps.prisma.alert.create({
            data: {
              siteId: site.id,
              level: 'WEATHER',
              status: 'TRIGGERED',
              source: 'AUTOMATED',
              triggeredById: systemUser.id,
              buildingId: building?.id ?? 'CAMPUS',
              buildingName: building?.name ?? 'Campus-Wide',
              message: `NWS ${weatherAlert.severity}: ${weatherAlert.headline}`,
              metadata: {
                nwsAlertId: weatherAlert.id,
                severity: weatherAlert.severity,
                event: weatherAlert.event,
                onset: weatherAlert.onset,
                expires: weatherAlert.expires,
              },
            },
          });

          // Queue mass notification
          const templateVars = {
            siteName: site.name,
            event: weatherAlert.event,
            severity: weatherAlert.severity,
            headline: weatherAlert.headline,
          };
          const rendered = renderTemplate(WEATHER_ALERT_SMS, templateVars);

          await alertQueue.add('mass-notify', {
            siteId: site.id,
            channels: ['SMS', 'EMAIL', 'PUSH', 'PA'],
            message: rendered.body,
            recipientScope: 'all-staff',
            alertId: alert.id,
          });

          console.log(
            `[poll-weather] Created WEATHER alert for ${site.name}: ${weatherAlert.headline}`,
          );
        }
      } catch (err) {
        console.error(`[poll-weather] Error polling weather for site ${site.name}:`, err);
      }
    }
  } finally {
    await alertQueue.close();
    redis.disconnect();
  }
}
