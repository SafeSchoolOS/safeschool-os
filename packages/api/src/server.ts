import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';

// Plugins
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import sentryPlugin from './plugins/sentry.js';
import { createAuthPlugin } from './plugins/auth-provider.js';
import wsManagerPlugin from './plugins/ws-manager.js';

// Routes
import authRoutes from './routes/auth.js';
import alertRoutes from './routes/alerts.js';
import lockdownRoutes from './routes/lockdown.js';
import doorRoutes from './routes/doors.js';
import siteRoutes from './routes/sites.js';
import grantRoutes from './routes/grants.js';
import visitorRoutes from './routes/visitors.js';
import visitorSettingsRoutes from './routes/visitor-settings.js';
import visitorAnalyticsRoutes from './routes/visitor-analytics.js';
import transportationRoutes from './routes/transportation.js';
import notificationRoutes from './routes/notifications.js';
import demoRequestRoutes from './routes/demo-requests.js';
import cameraRoutes from './routes/cameras.js';
import drillRoutes from './routes/drills.js';
import tipRoutes from './routes/tips.js';
import reunificationRoutes from './routes/reunification.js';
import environmentalRoutes from './routes/environmental.js';
import threatAssessmentRoutes from './routes/threat-assessments.js';
import socialMediaRoutes from './routes/social-media.js';
import complianceRoutes from './routes/compliance.js';
import auditLogRoutes from './routes/audit-log.js';
import organizationRoutes from './routes/organizations.js';
import onboardingRoutes from './routes/onboarding.js';
import parentRoutes from './routes/parent.js';
import escalationRoutes from './routes/escalation.js';
import notificationPreferenceRoutes from './routes/notification-preferences.js';
import weatherRoutes from './routes/weather.js';
import fleetRoutes from './routes/fleet.js';
import cardholderRoutes from './routes/cardholders.js';
import studentRoutes from './routes/students.js';
import userRoutes from './routes/users.js';
import agencyRoutes from './routes/agencies.js';
import responderAuthRoutes from './routes/responder-auth.js';
import responderPortalRoutes from './routes/responder-portal.js';
import gatewayRoutes from './routes/gateways.js';
import incidentRoutes from './routes/incidents.js';
import responderIncidentActionRoutes from './routes/responder-incident-actions.js';
import messageRoutes from './routes/messages.js';
import responderMessageRoutes from './routes/responder-messages.js';
import dispatchRoutes from './routes/dispatch.js';
import responderPostIncidentRoutes from './routes/responder-post-incident.js';
import incidentNotificationRoutes from './routes/incident-notifications.js';
import frReunificationRoutes from './routes/fr-reunification.js';
import responderReunificationRoutes from './routes/responder-reunification.js';
import frTipsPublicRoutes from './routes/fr-tips-public.js';
import frTipsAdminRoutes from './routes/fr-tips-admin.js';
import frTipsIntegrationsRoutes from './routes/fr-tips-integrations.js';
import zeroeyesWebhookRoutes from './routes/webhooks/zeroeyes.js';
import panicWebhookRoutes from './routes/webhooks/panic.js';
import weaponsDetectionWebhookRoutes from './routes/webhooks/weapons-detection.js';
import busFleetWebhookRoutes from './routes/webhooks/bus-fleet.js';
import panicDeviceRoutes from './routes/panic-devices.js';
import weaponsDetectorRoutes from './routes/weapons-detectors.js';
import zoneRoutes from './routes/zones.js';
import eventRoutes from './routes/events.js';
import doorHealthRoutes from './routes/door-health.js';
import systemHealthRoutes from './routes/system-health.js';
import rollCallRoutes from './routes/roll-call.js';
import integrationHealthRoutes from './routes/integration-health.js';
import visitorBanRoutes from './routes/visitor-bans.js';
import fireAlarmRoutes from './routes/fire-alarm.js';
import badgekioskRoutes from './routes/badgekiosk.js';
import badgeguardAnalyticsRoutes from './routes/badgeguard-analytics.js';
import threatAssessmentWorkflowRoutes from './routes/threat-assessment-workflow.js';
import drillManagementRoutes from './routes/drill-management.js';
import substituteTrackingRoutes from './routes/substitute-tracking.js';
import wellnessCheckInRoutes from './routes/wellness-checkins.js';
import attendanceRoutes from './routes/attendance.js';
import afterActionReportRoutes from './routes/after-action-reports.js';
import reunificationQRRoutes from './routes/reunification-qr.js';
import audioMonitoringRoutes from './routes/audio-monitoring.js';
import speechDetectionRoutes from './routes/speech-detection.js';
import doorScheduleRoutes from './routes/door-schedules.js';
import audioDetectionWebhookRoutes from './routes/webhooks/audio-detection.js';
import speechDetectionWebhookRoutes from './routes/webhooks/speech-detection.js';
import audioAnalyticsVendorRoutes from './routes/webhooks/audio-analytics-vendors.js';
import emergencySupplyRoutes from './routes/emergency-supplies.js';
import staffCertificationRoutes from './routes/staff-certifications.js';
import complianceAlertRoutes from './routes/compliance-alerts.js';
import intercomRoutes from './routes/intercom.js';
import perimeterSecurityRoutes from './routes/perimeter-security.js';
import bleTrackingRoutes from './routes/ble-tracking.js';
import videoAnalyticsRoutes from './routes/video-analytics.js';
import wsHandler from './ws/handler.js';

// Side-effect: import types for augmentation
import './types.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      ...(process.env.NODE_ENV === 'development' && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }),
      serializers: {
        req(req: any) {
          return {
            method: req.method,
            url: req.url,
            remoteAddress: req.ip,
          };
        },
      },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  // CORS — restrict to known origins in production, allow all only in dev
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : isProduction
      ? false // Block all cross-origin in production unless CORS_ORIGINS is set
      : true; // Allow all in dev
  await app.register(cors, {
    origin: allowedOrigins,
    credentials: isProduction ? false : true,
  });

  // Security headers — CSP, X-Frame-Options, HSTS, etc.
  await app.register(helmet, {
    contentSecurityPolicy: isProduction ? undefined : false, // Disable CSP in dev for Swagger UI
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  // Rate limiting — 100 req/min global, with stricter per-route overrides
  // Disabled in test environment to prevent flaky test failures
  if (process.env.NODE_ENV !== 'test') {
    await app.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
    });
  }

  await app.register(websocket);

  // Multipart file uploads (10 MB limit)
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'SafeSchool OS API',
        description: "Alyssa's Law compliant school safety platform API",
        version: '0.5.0',
      },
      servers: [
        { url: process.env.API_BASE_URL || `http://localhost:${PORT}` },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });
  // Only expose Swagger UI in non-production (prevents full API surface disclosure)
  if (!isProduction) {
    await app.register(swaggerUi, {
      routePrefix: '/docs',
    });
  }

  // Global error handler
  app.setErrorHandler((error: any, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    app.log.error({
      err: error,
      url: request.url,
      method: request.method,
      userId: (request as any).jwtUser?.id,
    });

    if (statusCode >= 500) {
      reply.code(statusCode).send({
        error: 'Internal Server Error',
        statusCode,
      });
    } else {
      reply.code(statusCode).send({
        error: error.message,
        statusCode,
      });
    }
  });

  // Plugins
  await app.register(prismaPlugin);
  await app.register(sentryPlugin);
  await app.register(redisPlugin);

  // Auth — Clerk or JWT based on AUTH_PROVIDER env
  const authPlugin = await createAuthPlugin();
  await app.register(authPlugin);

  await app.register(wsManagerPlugin);

  // Health check endpoint (used by Railway and monitoring)
  // Minimal response — no operational data exposed without auth
  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness check (confirms DB + Redis connectivity)
  app.get('/ready', async () => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      await app.redis.ping();
      return { status: 'ready' };
    } catch (err) {
      app.log.error(err, 'Readiness check failed');
      throw { statusCode: 503, message: 'Not ready' };
    }
  });

  // API root — minimal info, no version disclosure
  app.get('/', async () => {
    return {
      status: 'ok',
      docs: '/docs',
    };
  });

  // Routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(alertRoutes, { prefix: '/api/v1/alerts' });
  await app.register(lockdownRoutes, { prefix: '/api/v1/lockdown' });
  await app.register(doorRoutes, { prefix: '/api/v1/doors' });
  await app.register(siteRoutes, { prefix: '/api/v1/sites' });
  await app.register(grantRoutes, { prefix: '/api/v1/grants' });
  await app.register(visitorRoutes, { prefix: '/api/v1/visitors' });
  await app.register(visitorSettingsRoutes, { prefix: '/api/v1/visitor-settings' });
  await app.register(visitorAnalyticsRoutes, { prefix: '/api/v1/visitor-analytics' });
  await app.register(transportationRoutes, { prefix: '/api/v1/transportation' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await app.register(demoRequestRoutes, { prefix: '/api/v1/demo-requests' });
  await app.register(cameraRoutes, { prefix: '/api/v1/cameras' });
  await app.register(drillRoutes, { prefix: '/api/v1/drills' });
  await app.register(tipRoutes, { prefix: '/api/v1/tips' });
  await app.register(reunificationRoutes, { prefix: '/api/v1/reunification' });
  await app.register(environmentalRoutes, { prefix: '/api/v1/environmental' });
  await app.register(threatAssessmentRoutes, { prefix: '/api/v1/threat-assessments' });
  await app.register(socialMediaRoutes, { prefix: '/api/v1/social-media' });
  await app.register(complianceRoutes, { prefix: '/api/v1/compliance' });
  await app.register(auditLogRoutes, { prefix: '/api/v1/audit-log' });
  await app.register(organizationRoutes, { prefix: '/api/v1/organizations' });
  await app.register(onboardingRoutes, { prefix: '/api/v1/onboarding' });
  await app.register(parentRoutes, { prefix: '/api/v1/parent' });
  await app.register(escalationRoutes, { prefix: '/api/v1/escalation' });
  await app.register(notificationPreferenceRoutes, { prefix: '/api/v1/notification-preferences' });
  await app.register(weatherRoutes, { prefix: '/api/v1/weather' });
  await app.register(fleetRoutes, { prefix: '/api/v1/fleet' });
  await app.register(cardholderRoutes, { prefix: '/api/v1/cardholders' });
  await app.register(studentRoutes, { prefix: '/api/v1/students' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(agencyRoutes, { prefix: '/api/v1/agencies' });
  await app.register(responderAuthRoutes, { prefix: '/api/responder/auth' });
  await app.register(responderPortalRoutes, { prefix: '/api/responder' });
  await app.register(gatewayRoutes, { prefix: '/api/v1/gateways' });
  await app.register(incidentRoutes, { prefix: '/api/v1/incidents' });
  await app.register(responderIncidentActionRoutes, { prefix: '/api/responder' });
  await app.register(messageRoutes, { prefix: '/api/v1/messages' });
  await app.register(responderMessageRoutes, { prefix: '/api/responder' });
  await app.register(dispatchRoutes, { prefix: '/api/dispatch' });
  await app.register(responderPostIncidentRoutes, { prefix: '/api/responder' });
  await app.register(incidentNotificationRoutes, { prefix: '/api/v1' });
  await app.register(frReunificationRoutes, { prefix: '/api/v1/reunification' });
  await app.register(responderReunificationRoutes, { prefix: '/api/responder' });
  await app.register(frTipsPublicRoutes, { prefix: '/api/v1/tips/public' });
  await app.register(frTipsAdminRoutes, { prefix: '/api/v1/tips/admin' });
  await app.register(frTipsIntegrationsRoutes, { prefix: '/api/v1/tips/integrations' });
  // Optional proprietary plugins (installed as npm package at deploy time)
  try {
    // @ts-expect-error — module only exists when proprietary package is installed
    const { register } = await import('@safeschool/proprietary');
    await register(app);
  } catch { /* @safeschool/proprietary not installed — skip */ }

  // Panic device management
  await app.register(panicDeviceRoutes, { prefix: '/api/v1/panic-devices' });

  // Weapons detector management
  await app.register(weaponsDetectorRoutes, { prefix: '/api/v1/weapons-detectors' });

  // Zone management
  await app.register(zoneRoutes, { prefix: '/api/v1/zones' });

  // Feature expansion routes
  await app.register(eventRoutes, { prefix: '/api/v1/events' });
  await app.register(doorHealthRoutes, { prefix: '/api/v1/door-health' });
  await app.register(systemHealthRoutes, { prefix: '/api/v1/system-health' });
  await app.register(rollCallRoutes, { prefix: '/api/v1/roll-call' });
  await app.register(integrationHealthRoutes, { prefix: '/api/v1/integration-health' });
  await app.register(visitorBanRoutes, { prefix: '/api/v1/visitor-bans' });
  await app.register(fireAlarmRoutes, { prefix: '/api/v1/fire-alarm' });
  await app.register(badgekioskRoutes, { prefix: '/api/v1/badgekiosk' });
  await app.register(badgeguardAnalyticsRoutes, { prefix: '/api/v1/badgeguard' });

  // Threat Assessment Workflow, Drill Management, Substitute Tracking
  await app.register(threatAssessmentWorkflowRoutes, { prefix: '/api/v1/threat-assessment-workflow' });
  await app.register(drillManagementRoutes, { prefix: '/api/v1/drill-management' });
  await app.register(substituteTrackingRoutes, { prefix: '/api/v1/substitute-tracking' });

  // Student Wellness, Attendance, AAR, Reunification QR, Audio Monitoring, Door Schedules
  await app.register(wellnessCheckInRoutes, { prefix: '/api/v1/wellness' });
  await app.register(attendanceRoutes, { prefix: '/api/v1/attendance' });
  await app.register(afterActionReportRoutes, { prefix: '/api/v1/after-action-reports' });
  await app.register(reunificationQRRoutes, { prefix: '/api/v1/reunification' });
  await app.register(audioMonitoringRoutes, { prefix: '/api/v1/audio-monitoring' });
  await app.register(speechDetectionRoutes, { prefix: '/api/v1/speech-detection' });
  await app.register(doorScheduleRoutes, { prefix: '/api/v1/door-schedules' });

  // Emergency Supplies, Staff Certifications, Compliance Alerts, Intercom, Perimeter, BLE, Video Analytics
  await app.register(emergencySupplyRoutes, { prefix: '/api/v1/emergency-supplies' });
  await app.register(staffCertificationRoutes, { prefix: '/api/v1/staff-certifications' });
  await app.register(complianceAlertRoutes, { prefix: '/api/v1/compliance-alerts' });
  await app.register(intercomRoutes, { prefix: '/api/v1/intercom' });
  await app.register(perimeterSecurityRoutes, { prefix: '/api/v1/perimeter' });
  await app.register(bleTrackingRoutes, { prefix: '/api/v1/ble-tracking' });
  await app.register(videoAnalyticsRoutes, { prefix: '/api/v1/video-analytics' });

  // Webhooks (no JWT auth — signature-verified)
  await app.register(zeroeyesWebhookRoutes, { prefix: '/webhooks/zeroeyes' });
  await app.register(panicWebhookRoutes, { prefix: '/webhooks/panic' });
  await app.register(weaponsDetectionWebhookRoutes, { prefix: '/webhooks/weapons-detection' });
  await app.register(busFleetWebhookRoutes, { prefix: '/webhooks/bus-fleet' });
  await app.register(audioDetectionWebhookRoutes, { prefix: '/webhooks/audio-detection' });
  await app.register(speechDetectionWebhookRoutes, { prefix: '/webhooks/speech-detection' });
  await app.register(audioAnalyticsVendorRoutes, { prefix: '/webhooks/audio-vendors' });

  // Sync routes (cloud mode only) — powered by @edgeruntime/cloud-sync
  // Uses dynamic import so SafeSchool can build without @edgeruntime/cloud-sync installed.
  // The package is only needed at runtime when OPERATING_MODE=cloud.
  if (process.env.OPERATING_MODE === 'cloud') {
    try {
      const cloudSyncPkg = '@edgeruntime/cloud-sync';
      const cloudSync = await import(cloudSyncPkg) as any;
      const { SafeSchoolSyncAdapter } = await import('./adapters/edgeruntime-sync-adapter.js');
      const syncAdapter = new SafeSchoolSyncAdapter(app.prisma);
      await app.register(cloudSync.syncRoutes, {
        prefix: '/api/v1/sync',
        syncKey: process.env.CLOUD_SYNC_KEY!,
        adapter: syncAdapter,
        allowedEntityTypes: ['alert', 'visitor', 'door', 'audit_log', 'lockdown_command'],
        redactFields: ['passwordHash'],
      });
    } catch (err) {
      app.log.warn('EdgeRuntime cloud-sync not available, sync routes disabled. Install @edgeruntime/cloud-sync to enable.');
    }
  }

  // Admin routes (edge mode only)
  if (process.env.OPERATING_MODE === 'edge') {
    const adminModule = await import('./routes/admin.js');
    await app.register(adminModule.default as any, { prefix: '/api/v1/admin' });
  }

  // WebSocket handler
  await app.register(wsHandler);

  return app;
}

async function start() {
  console.log('=== SafeSchool OS API Starting ===');
  console.log(`PORT=${PORT}, HOST=${HOST}`);
  console.log(`NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`OPERATING_MODE=${process.env.OPERATING_MODE || 'cloud'}`);
  console.log(`AUTH_PROVIDER=${process.env.AUTH_PROVIDER || 'dev'}`);
  console.log(`DATABASE_URL set: ${!!process.env.DATABASE_URL}`);
  console.log(`REDIS_URL set: ${!!process.env.REDIS_URL}`);

  try {
    const app = await buildServer();
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`SafeSchool OS API running on ${HOST}:${PORT}`);
    app.log.info(`Operating mode: ${process.env.OPERATING_MODE || 'cloud'}`);
    app.log.info(`Auth provider: ${process.env.AUTH_PROVIDER || 'dev'}`);
  } catch (err) {
    console.error('=== STARTUP FAILED ===');
    console.error(err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
