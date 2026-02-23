import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import type { PrismaClient } from '@safeschool/db';
import { renderTemplate, STUDENT_SCAN_SMS, STUDENT_SCAN_PUSH, BUS_ARRIVAL_SMS, BUS_ARRIVAL_PUSH, WEATHER_ALERT_SMS, VISITOR_QR_EMAIL, VISITOR_HOST_SMS, VISITOR_HOST_EMAIL, VISITOR_HOST_PUSH } from '@safeschool/core';
import type { SocialMediaAdapter } from '@bwattendorf/adapters/social-media';
import type { WeatherAdapter } from '@bwattendorf/adapters/weather';

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
        case 'visitor-qr-notification':
          await handleVisitorQrNotification(job, deps);
          break;
        case 'host-notify':
          await handleHostNotify(job, deps);
          break;
        case 'auto-checkout':
          await handleAutoCheckout(job, deps);
          break;
        case 'event-unlock-doors':
          await handleEventUnlockDoors(job, deps);
          break;
        case 'event-lock-doors':
          await handleEventLockDoors(job, deps);
          break;
        case 'check-door-health':
          await handleCheckDoorHealth(job, deps);
          break;
        case 'system-heartbeat':
          await handleSystemHeartbeat(job, deps);
          break;
        case 'check-integration-health':
          await handleCheckIntegrationHealth(job, deps);
          break;
        case 'fire-pas-auto-escalate':
          await handleFirePasAutoEscalate(job, deps);
          break;
        case 'fire-pas-investigation-timeout':
          await handleFirePasInvestigationTimeout(job, deps);
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

async function handleVisitorQrNotification(job: Job, deps: WorkerDeps): Promise<void> {
  const { visitorId, siteId, firstName, lastName, email, phone, qrToken, purpose, destination, scheduledAt } = job.data;
  console.log(`[visitor-qr] Sending QR notification to ${email || phone} for ${firstName} ${lastName}`);

  const site = await deps.prisma.site.findUnique({ where: { id: siteId }, select: { name: true } });
  const siteName = site?.name || 'School';
  const qrCodeUrl = `${process.env.API_BASE_URL || 'https://api.safeschool.app'}/api/v1/visitors/qr/${qrToken}`;
  const scheduledDate = scheduledAt ? new Date(scheduledAt).toLocaleDateString() : 'your scheduled visit';

  const templateVars = {
    siteName,
    visitorName: `${firstName} ${lastName}`,
    scheduledDate,
    qrCodeUrl,
    purpose: purpose || '',
    destination: destination || '',
  };

  const rendered = renderTemplate(VISITOR_QR_EMAIL, templateVars);

  if (email) {
    await deps.notifyFn({
      alertId: `visitor-qr-${visitorId}`,
      siteId,
      level: 'CUSTOM',
      message: rendered.body,
      recipients: [{ name: `${firstName} ${lastName}`, email }],
      channels: ['EMAIL'],
      subject: rendered.subject,
    });
    console.log(`[visitor-qr] Sent QR email to ${email}`);
  }

  if (phone) {
    await deps.notifyFn({
      alertId: `visitor-qr-${visitorId}`,
      siteId,
      level: 'CUSTOM',
      message: `Your visit to ${siteName} is confirmed. Show this link at check-in: ${qrCodeUrl}`,
      recipients: [{ name: `${firstName} ${lastName}`, phone }],
      channels: ['SMS'],
    });
    console.log(`[visitor-qr] Sent QR SMS to ${phone}`);
  }
}

async function handleHostNotify(job: Job, deps: WorkerDeps): Promise<void> {
  const { visitorId, siteId, hostUserId, visitorName, purpose, destination, visitorType } = job.data;
  console.log(`[host-notify] Notifying host ${hostUserId} about visitor ${visitorName}`);

  const host = await deps.prisma.user.findUnique({
    where: { id: hostUserId },
    select: { name: true, email: true, phone: true },
  });
  if (!host) {
    console.log(`[host-notify] Host user ${hostUserId} not found`);
    return;
  }

  const site = await deps.prisma.site.findUnique({ where: { id: siteId }, select: { name: true } });
  const siteName = site?.name || 'School';
  const timestamp = new Date().toLocaleTimeString();

  const channels: string[] = [];
  if (host.phone) channels.push('SMS');
  if (host.email) channels.push('EMAIL');
  channels.push('PUSH');

  if (channels.includes('SMS') && host.phone) {
    const smsRendered = renderTemplate(VISITOR_HOST_SMS, { visitorName, siteName, purpose, destination });
    await deps.notifyFn({
      alertId: `host-notify-${visitorId}`,
      siteId,
      level: 'CUSTOM',
      message: smsRendered.body,
      recipients: [{ name: host.name, phone: host.phone }],
      channels: ['SMS'],
    });
  }

  if (channels.includes('EMAIL') && host.email) {
    const emailRendered = renderTemplate(VISITOR_HOST_EMAIL, {
      visitorName,
      siteName,
      visitorType: visitorType || 'VISITOR',
      purpose,
      destination,
      timestamp,
    });
    await deps.notifyFn({
      alertId: `host-notify-${visitorId}`,
      siteId,
      level: 'CUSTOM',
      message: emailRendered.body,
      recipients: [{ name: host.name, email: host.email }],
      channels: ['EMAIL'],
      subject: emailRendered.subject,
    });
  }

  console.log(`[host-notify] Notified ${host.name} via ${channels.join(',')} about ${visitorName}`);
}

async function handleAutoCheckout(job: Job, deps: WorkerDeps): Promise<void> {
  console.log('[auto-checkout] Running auto-checkout check...');

  const settings = await deps.prisma.siteVisitorSettings.findMany({
    where: { autoCheckoutEnabled: true },
    include: { site: { select: { id: true, name: true, timezone: true } } },
  });

  for (const setting of settings) {
    const siteId = setting.siteId;
    const timezone = setting.site.timezone || 'America/New_York';

    // Check if current time in site timezone is past the auto-checkout time
    const now = new Date();
    const siteTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const [hours, minutes] = setting.autoCheckoutTime.split(':').map(Number);
    const checkoutTime = new Date(siteTime);
    checkoutTime.setHours(hours, minutes, 0, 0);

    if (siteTime < checkoutTime) continue;

    // Check out all CHECKED_IN visitors
    const checkedInVisitors = await deps.prisma.visitor.findMany({
      where: { siteId, status: 'CHECKED_IN' },
      select: { id: true },
    });

    if (checkedInVisitors.length === 0) continue;

    const result = await deps.prisma.visitor.updateMany({
      where: { siteId, status: 'CHECKED_IN' },
      data: { status: 'CHECKED_OUT', checkedOutAt: now },
    });

    await deps.prisma.auditLog.create({
      data: {
        siteId,
        action: 'VISITOR_AUTO_CHECKOUT',
        entity: 'Visitor',
        details: { count: result.count, autoCheckoutTime: setting.autoCheckoutTime },
      },
    });

    console.log(`[auto-checkout] Checked out ${result.count} visitors at ${setting.site.name}`);
  }
}

// ---------------------------------------------------------------------------
// Event Door Grant Jobs
// ---------------------------------------------------------------------------

async function handleEventUnlockDoors(job: Job, deps: WorkerDeps): Promise<void> {
  const { eventId, grantId } = job.data;
  console.log(`[event-unlock] Processing unlock for event ${eventId}, grant ${grantId}`);

  const grant = await deps.prisma.eventDoorGrant.findUnique({
    where: { id: grantId },
    include: { event: true, door: true },
  });

  if (!grant || !grant.event || !grant.door) {
    console.log(`[event-unlock] Grant ${grantId} not found or missing relations`);
    return;
  }

  if (grant.event.status === 'CANCELLED_EVENT') {
    console.log(`[event-unlock] Event ${eventId} cancelled, skipping unlock`);
    return;
  }

  // School hours failsafe: block unlock during school hours unless override is set
  if (!grant.event.schoolHoursOverride) {
    try {
      // Inline school hours check: Mon-Fri 7:00-15:30
      const now = new Date();
      const day = now.getDay();
      const hours = now.getHours() * 60 + now.getMinutes();
      const isSchoolTime = day >= 1 && day <= 5 && hours >= 420 && hours <= 930; // 7:00-15:30
      if (isSchoolTime) {
        console.log(`[event-unlock] BLOCKED — school hours active and no override for event ${eventId}`);
        await deps.prisma.eventDoorGrant.update({
          where: { id: grantId },
          data: { failedAt: new Date(), failReason: 'Blocked by school hours failsafe' },
        });
        await deps.prisma.auditLog.create({
          data: {
            siteId: grant.event.siteId,
            action: 'EVENT_UNLOCK_BLOCKED',
            entity: 'EventDoorGrant',
            entityId: grantId,
            details: { eventId, doorId: grant.doorId, reason: 'school_hours_failsafe' },
          },
        });
        return;
      }
    } catch {
      // If school-hours module unavailable, proceed with caution
    }
  }

  // Execute unlock
  try {
    await deps.prisma.door.update({
      where: { id: grant.doorId },
      data: { status: 'UNLOCKED' },
    });

    await deps.prisma.eventDoorGrant.update({
      where: { id: grantId },
      data: { executed: true },
    });

    await deps.prisma.auditLog.create({
      data: {
        siteId: grant.event.siteId,
        action: 'EVENT_DOOR_UNLOCKED',
        entity: 'Door',
        entityId: grant.doorId,
        details: { eventId, grantId, eventName: grant.event.name },
      },
    });

    console.log(`[event-unlock] Door "${grant.door.name}" unlocked for event "${grant.event.name}"`);
  } catch (err) {
    await deps.prisma.eventDoorGrant.update({
      where: { id: grantId },
      data: { failedAt: new Date(), failReason: String(err) },
    });
    console.error(`[event-unlock] Failed to unlock door ${grant.doorId}:`, err);
  }
}

async function handleEventLockDoors(job: Job, deps: WorkerDeps): Promise<void> {
  const { eventId, grantId } = job.data;
  console.log(`[event-lock] Processing lock for event ${eventId}, grant ${grantId}`);

  const grant = await deps.prisma.eventDoorGrant.findUnique({
    where: { id: grantId },
    include: { event: true, door: true },
  });

  if (!grant || !grant.door) {
    console.log(`[event-lock] Grant ${grantId} not found`);
    return;
  }

  try {
    await deps.prisma.door.update({
      where: { id: grant.doorId },
      data: { status: 'LOCKED' },
    });

    await deps.prisma.auditLog.create({
      data: {
        siteId: grant.event!.siteId,
        action: 'EVENT_DOOR_LOCKED',
        entity: 'Door',
        entityId: grant.doorId,
        details: { eventId, grantId, eventName: grant.event?.name },
      },
    });

    console.log(`[event-lock] Door "${grant.door.name}" re-locked after event`);
  } catch (err) {
    console.error(`[event-lock] Failed to lock door ${grant.doorId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Door Health Check (runs every 60s)
// ---------------------------------------------------------------------------

async function handleCheckDoorHealth(job: Job, deps: WorkerDeps): Promise<void> {
  console.log('[check-door-health] Running door health check...');

  const doors = await deps.prisma.door.findMany({
    select: { id: true, name: true, siteId: true, status: true, updatedAt: true },
  });

  const now = new Date();
  const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const HELD_WARNING_MS = 30 * 1000; // 30 seconds
  const HELD_CRITICAL_MS = 5 * 60 * 1000; // 5 minutes

  for (const door of doors) {
    const ageMs = now.getTime() - new Date(door.updatedAt).getTime();

    // Check for doors not reporting (offline)
    if (ageMs > OFFLINE_THRESHOLD_MS && door.status !== 'UNKNOWN') {
      const existing = await deps.prisma.doorHealthEvent.findFirst({
        where: { doorId: door.id, eventType: 'OFFLINE' as any, resolvedAt: null },
      });
      if (!existing) {
        await deps.prisma.doorHealthEvent.create({
          data: {
            doorId: door.id,
            siteId: door.siteId,
            eventType: 'OFFLINE' as any,
            severity: 'WARNING',
            detectedAt: now,
            autoWorkOrder: false,
          },
        });
        console.log(`[check-door-health] Door "${door.name}" marked OFFLINE (last update ${Math.round(ageMs / 1000)}s ago)`);
      }
    }

    // Check FORCED doors
    if (door.status === 'FORCED') {
      const existing = await deps.prisma.doorHealthEvent.findFirst({
        where: { doorId: door.id, eventType: 'FORCED_OPEN' as any, resolvedAt: null },
      });
      if (!existing) {
        const event = await deps.prisma.doorHealthEvent.create({
          data: {
            doorId: door.id,
            siteId: door.siteId,
            eventType: 'FORCED_OPEN' as any,
            severity: 'CRITICAL',
            detectedAt: now,
            autoWorkOrder: true,
          },
        });
        await deps.prisma.workOrder.create({
          data: {
            siteId: door.siteId,
            doorId: door.id,
            healthEventId: event.id,
            title: `Forced entry: ${door.name} — immediate inspection required`,
            description: `Door "${door.name}" was forced open. Inspect for damage and verify security.`,
            priority: 'URGENT_WO' as any,
          },
        });
        console.log(`[check-door-health] CRITICAL: Door "${door.name}" forced open — work order created`);
      }
    }

    // Check HELD (propped) doors
    if (door.status === 'HELD') {
      const existing = await deps.prisma.doorHealthEvent.findFirst({
        where: { doorId: door.id, eventType: 'HELD_OPEN' as any, resolvedAt: null },
      });
      if (existing) {
        // Escalate if held > 5 min
        const heldMs = now.getTime() - new Date(existing.detectedAt).getTime();
        if (heldMs > HELD_CRITICAL_MS && existing.severity !== 'CRITICAL') {
          await deps.prisma.doorHealthEvent.update({
            where: { id: existing.id },
            data: { severity: 'CRITICAL', autoWorkOrder: true },
          });
          await deps.prisma.workOrder.create({
            data: {
              siteId: door.siteId,
              doorId: door.id,
              healthEventId: existing.id,
              title: `Propped door: ${door.name} — held open > 5 min`,
              description: `Door "${door.name}" has been held open for over 5 minutes. Needs maintenance check.`,
              priority: 'HIGH_WO' as any,
            },
          });
          console.log(`[check-door-health] ESCALATED: Door "${door.name}" held open > 5 min`);
        }
      } else if (ageMs > HELD_WARNING_MS) {
        await deps.prisma.doorHealthEvent.create({
          data: {
            doorId: door.id,
            siteId: door.siteId,
            eventType: 'HELD_OPEN' as any,
            severity: 'WARNING',
            detectedAt: now,
            autoWorkOrder: false,
          },
        });
        console.log(`[check-door-health] WARNING: Door "${door.name}" held open > 30s`);
      }
    }

    // Auto-resolve health events for doors back in normal state
    if (door.status === 'LOCKED' || door.status === 'UNLOCKED') {
      const resolved = await deps.prisma.doorHealthEvent.updateMany({
        where: { doorId: door.id, resolvedAt: null },
        data: { resolvedAt: now },
      });
      if (resolved.count > 0) {
        console.log(`[check-door-health] Resolved ${resolved.count} health event(s) for "${door.name}"`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// System Heartbeat (runs every 60s)
// ---------------------------------------------------------------------------

async function handleSystemHeartbeat(job: Job, deps: WorkerDeps): Promise<void> {
  console.log('[system-heartbeat] Running heartbeat check...');

  // Check for stale edge devices (> 5 min)
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

  try {
    const staleEdgeDevices = await deps.prisma.edgeDevice.findMany({
      where: { lastHeartbeatAt: { lt: staleThreshold } },
      select: { id: true, hostname: true, siteId: true, lastHeartbeatAt: true },
    });

    for (const device of staleEdgeDevices) {
      console.log(`[system-heartbeat] Stale edge device: ${device.hostname || device.id} (last heartbeat: ${device.lastHeartbeatAt?.toISOString()})`);
    }
  } catch {
    // EdgeDevice model may not exist in all environments
  }

  // Check for timed-out action confirmations
  const timedOutConfirmations = await deps.prisma.actionConfirmation.findMany({
    where: {
      status: 'PENDING_CONFIRMATION' as any,
      timeoutAt: { lt: new Date() },
    },
  });

  for (const confirmation of timedOutConfirmations) {
    await deps.prisma.actionConfirmation.update({
      where: { id: confirmation.id },
      data: { status: 'TIMED_OUT_CONFIRMATION' as any },
    });

    console.log(`[system-heartbeat] Action confirmation ${confirmation.id} timed out (${confirmation.actionType})`);

    // For 911 dispatch timeouts, attempt failover
    if (confirmation.actionType === 'DISPATCH_911') {
      const dispatchRecord = await deps.prisma.dispatchRecord.findFirst({
        where: { alertId: confirmation.actionId, confirmedAt: null },
        orderBy: { sentAt: 'desc' },
      });

      if (dispatchRecord) {
        console.log(`[system-heartbeat] CRITICAL: 911 dispatch ${dispatchRecord.id} unconfirmed — failover needed`);
        // Queue a re-dispatch via cellular backup
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
        const queue = new Queue('alert-processing', { connection: redis as any });
        try {
          await queue.add('dispatch-911', {
            alertId: confirmation.actionId,
            siteId: confirmation.siteId,
            level: 'ACTIVE_THREAT',
            method: 'CELLULAR_FAILOVER',
          });
        } finally {
          await queue.close();
          redis.disconnect();
        }
      }
    }
  }

  // Check pending confirmations for lockdowns
  const pendingLockdowns = await deps.prisma.actionConfirmation.findMany({
    where: {
      status: 'PENDING_CONFIRMATION' as any,
      actionType: 'LOCKDOWN' as any,
    },
  });

  for (const lockdown of pendingLockdowns) {
    // Check if all doors in the building are actually locked
    const command = await deps.prisma.lockdownCommand.findUnique({
      where: { id: lockdown.actionId },
    });
    if (!command) continue;

    const unlockedDoors = await deps.prisma.door.findMany({
      where: {
        siteId: command.siteId,
        ...(command.scope === 'BUILDING' ? { buildingId: command.targetId } : {}),
        status: { not: 'LOCKED' },
        isEmergencyExit: false,
      },
      select: { id: true, name: true },
    });

    if (unlockedDoors.length === 0) {
      await deps.prisma.actionConfirmation.update({
        where: { id: lockdown.id },
        data: { status: 'CONFIRMED_ACTION' as any, confirmedAt: new Date() },
      });
      console.log(`[system-heartbeat] Lockdown ${lockdown.actionId} confirmed — all doors locked`);
    } else {
      const elapsed = new Date().getTime() - new Date(lockdown.initiatedAt).getTime();
      if (elapsed > 30000) {
        await deps.prisma.actionConfirmation.update({
          where: { id: lockdown.id },
          data: {
            status: 'PARTIAL_CONFIRMATION' as any,
            escalationMsg: `${unlockedDoors.length} door(s) not locked: ${unlockedDoors.map(d => d.name).join(', ')}`,
            escalatedAt: new Date(),
          },
        });
        console.log(`[system-heartbeat] Lockdown ${lockdown.actionId} PARTIAL — ${unlockedDoors.length} doors still unlocked`);
      }
    }
  }

  // Check BullMQ queue health
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue('alert-processing', { connection: redis as any });
    const failedCount = await queue.getFailedCount();
    if (failedCount > 10) {
      console.warn(`[system-heartbeat] WARNING: ${failedCount} failed jobs in alert-processing queue`);
    }
    await queue.close();
    redis.disconnect();
  } catch {
    // Queue check is best-effort
  }
}

// ---------------------------------------------------------------------------
// Integration Health Check (runs every 120s)
// ---------------------------------------------------------------------------

async function handleCheckIntegrationHealth(job: Job, deps: WorkerDeps): Promise<void> {
  console.log('[check-integration-health] Running integration health check...');

  const integrations = await deps.prisma.integrationHealth.findMany({
    where: { status: { not: 'DISABLED_INTEGRATION' as any } },
  });

  for (const integration of integrations) {
    const oldStatus = integration.status;
    let newStatus: string = oldStatus;
    const lastError: string | null = null;

    try {
      switch (integration.integrationType) {
        case 'NOTIFICATIONS_INT': {
          // Check recent notification failure rate
          const recentLogs = await deps.prisma.notificationLog.findMany({
            where: { siteId: integration.siteId, createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) } },
            select: { status: true },
            take: 50,
          });
          if (recentLogs.length === 0) {
            newStatus = 'UNKNOWN_INTEGRATION';
          } else {
            const failRate = recentLogs.filter(l => l.status === 'FAILED').length / recentLogs.length;
            newStatus = failRate > 0.5 ? 'DOWN_INTEGRATION' : failRate > 0.1 ? 'DEGRADED_INTEGRATION' : 'HEALTHY_INTEGRATION';
          }
          break;
        }
        case 'DISPATCH_911_INT': {
          // Check recent dispatch success rate
          const recentDispatches = await deps.prisma.dispatchRecord.findMany({
            where: { sentAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
            select: { status: true, confirmedAt: true },
            take: 20,
          });
          if (recentDispatches.length === 0) {
            newStatus = 'UNKNOWN_INTEGRATION';
          } else {
            const failRate = recentDispatches.filter(d => d.status === 'FAILED').length / recentDispatches.length;
            newStatus = failRate > 0.3 ? 'DOWN_INTEGRATION' : failRate > 0 ? 'DEGRADED_INTEGRATION' : 'HEALTHY_INTEGRATION';
          }
          break;
        }
        case 'ACCESS_CONTROL_INT': {
          // Check if doors have reported recently
          const doorsForSite = await deps.prisma.door.findMany({
            where: { siteId: integration.siteId },
            select: { updatedAt: true },
          });
          if (doorsForSite.length === 0) {
            newStatus = 'UNKNOWN_INTEGRATION';
          } else {
            const stale = doorsForSite.filter(d => Date.now() - new Date(d.updatedAt).getTime() > 10 * 60 * 1000);
            const staleRate = stale.length / doorsForSite.length;
            newStatus = staleRate > 0.5 ? 'DOWN_INTEGRATION' : staleRate > 0.2 ? 'DEGRADED_INTEGRATION' : 'HEALTHY_INTEGRATION';
          }
          break;
        }
        default:
          // For other types, just mark as checked
          newStatus = oldStatus === 'UNKNOWN_INTEGRATION' ? 'UNKNOWN_INTEGRATION' : oldStatus;
          break;
      }

      await deps.prisma.integrationHealth.update({
        where: { id: integration.id },
        data: {
          status: newStatus as any,
          lastCheckAt: new Date(),
          ...(newStatus.includes('HEALTHY') ? { lastSuccessAt: new Date() } : {}),
          ...(lastError ? { lastErrorAt: new Date(), lastError } : {}),
        },
      });

      if (oldStatus !== newStatus) {
        console.log(`[check-integration-health] ${integration.integrationName}: ${oldStatus} → ${newStatus}`);
      }
    } catch (err) {
      await deps.prisma.integrationHealth.update({
        where: { id: integration.id },
        data: {
          status: 'DOWN_INTEGRATION' as any,
          lastCheckAt: new Date(),
          lastErrorAt: new Date(),
          lastError: String(err),
        },
      });
      console.error(`[check-integration-health] Error checking ${integration.integrationName}:`, err);
    }
  }
}

// ============================================================================
// Fire Alarm PAS Timeout Handlers
// ============================================================================

async function handleFirePasAutoEscalate(job: Job, deps: WorkerDeps): Promise<void> {
  const { alertId, siteId, reason } = job.data;
  console.log(`[fire-pas-auto-escalate] Checking alert ${alertId} — ${reason}`);

  try {
    const alert = await deps.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert || alert.status !== 'SUPPRESSED') {
      console.log(`[fire-pas-auto-escalate] Alert ${alertId} already handled (status: ${alert?.status})`);
      return;
    }

    const metadata = (alert.metadata as any) || {};
    const pasProtocol = metadata.pasProtocol || {};

    // If already acknowledged (investigation started), don't auto-escalate on the 15s timer
    if (pasProtocol.acknowledged) {
      console.log(`[fire-pas-auto-escalate] Alert ${alertId} already acknowledged, skipping 15s escalation`);
      return;
    }

    // Not acknowledged within 15 seconds — NFPA 72 PAS requires full alarm activation
    await deps.prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'TRIGGERED',
        message: `[AUTO-ESCALATED] PAS: Not acknowledged within 15 seconds. Full fire alarm activated.`,
        metadata: {
          ...metadata,
          suppressed: false,
          awaitingDecision: false,
          autoEscalatedAt: new Date().toISOString(),
          autoEscalationReason: 'PAS 15-second acknowledgment timeout',
        },
      },
    });

    await deps.prisma.fireAlarmEvent.updateMany({
      where: { alertId, status: { in: ['ALARM_ACTIVE'] } },
      data: { status: 'AUTO_ESCALATED' },
    });

    console.warn(`[fire-pas-auto-escalate] Alert ${alertId} auto-escalated — PAS 15s acknowledgment timeout`);
  } catch (err) {
    console.error('[fire-pas-auto-escalate] Error:', err);
  }
}

async function handleFirePasInvestigationTimeout(job: Job, deps: WorkerDeps): Promise<void> {
  const { alertId, siteId } = job.data;
  console.log(`[fire-pas-investigation-timeout] Checking alert ${alertId}`);

  try {
    const alert = await deps.prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert || alert.status !== 'SUPPRESSED') {
      console.log(`[fire-pas-investigation-timeout] Alert ${alertId} already handled (status: ${alert?.status})`);
      return;
    }

    const metadata = (alert.metadata as any) || {};
    const pasProtocol = metadata.pasProtocol || {};

    // If investigation has been extended, don't auto-escalate
    if (pasProtocol.extended) {
      console.log(`[fire-pas-investigation-timeout] Alert ${alertId} investigation extended, skipping timeout`);
      return;
    }

    // 3-minute investigation window expired — NFPA 72 requires full alarm unless threat verified
    await deps.prisma.alert.update({
      where: { id: alertId },
      data: {
        status: 'TRIGGERED',
        message: `[AUTO-ESCALATED] PAS: 3-minute investigation window expired. Full fire alarm activated. If active threat is verified, operator must extend.`,
        metadata: {
          ...metadata,
          suppressed: false,
          awaitingDecision: false,
          autoEscalatedAt: new Date().toISOString(),
          autoEscalationReason: 'PAS 3-minute investigation timeout',
        },
      },
    });

    await deps.prisma.fireAlarmEvent.updateMany({
      where: { alertId, status: { in: ['INVESTIGATING'] } },
      data: { status: 'AUTO_ESCALATED' },
    });

    console.warn(`[fire-pas-investigation-timeout] Alert ${alertId} auto-escalated — 3-minute investigation window expired`);
  } catch (err) {
    console.error('[fire-pas-investigation-timeout] Error:', err);
  }
}
