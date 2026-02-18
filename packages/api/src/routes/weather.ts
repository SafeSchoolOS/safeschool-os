import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { renderTemplate, WEATHER_ALERT_SMS } from '@safeschool/core';
import { NWSAdapter, type WeatherAlert } from '@safeschool/weather';

const CACHE_TTL_SECONDS = 300; // 5 minutes
const adapter = new NWSAdapter();

export default async function weatherRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/weather/:siteId/alerts — fetch active NWS alerts for a site
  app.get(
    '/:siteId/alerts',
    { preHandler: [requireMinRole('TEACHER')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { siteId } = request.params as { siteId: string };
      const user = request.user as { id: string; siteIds: string[] };

      // Verify the user has access to this site
      if (!user.siteIds.includes(siteId)) {
        return reply.status(403).send({ error: 'No access to this site' });
      }

      // Check Redis cache first
      const cacheKey = `weather:${siteId}`;
      try {
        const cached = await app.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch {
        // Redis miss or error — fall through to fetch
      }

      // Look up site coordinates
      const site = await app.prisma.site.findUnique({
        where: { id: siteId },
        select: { latitude: true, longitude: true, name: true },
      });

      if (!site) {
        return reply.status(404).send({ error: 'Site not found' });
      }

      // Fetch from NWS
      let alerts: WeatherAlert[];
      try {
        alerts = await adapter.getActiveAlerts(site.latitude, site.longitude);
      } catch (err) {
        app.log.error(err, 'Failed to fetch NWS alerts');
        return reply.status(502).send({ error: 'Unable to fetch weather alerts' });
      }

      // Cache the result in Redis
      try {
        await app.redis.set(cacheKey, JSON.stringify(alerts), 'EX', CACHE_TTL_SECONDS);
      } catch {
        // Non-blocking — cache write failure shouldn't break the response
      }

      // Auto-create system alert for Extreme or Severe weather
      const severeAlerts = alerts.filter(
        (a) => a.severity === 'Extreme' || a.severity === 'Severe',
      );

      for (const weatherAlert of severeAlerts) {
        // Deduplicate: only create if no active WEATHER alert with this NWS id exists
        const existing = await app.prisma.alert.findFirst({
          where: {
            siteId,
            level: 'WEATHER',
            status: 'TRIGGERED',
            metadata: { path: ['nwsAlertId'], equals: weatherAlert.id },
          },
        });

        if (!existing) {
          // Grab the first building for the denormalized location fields
          const building = await app.prisma.building.findFirst({
            where: { siteId },
            select: { id: true, name: true },
          });

          const alert = await app.prisma.alert.create({
            data: {
              siteId,
              level: 'WEATHER',
              status: 'TRIGGERED',
              source: 'AUTOMATED',
              triggeredById: user.id,
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

          // Broadcast via WebSocket
          try {
            app.wsManager?.broadcastToSite(siteId, 'alert:created', alert);
          } catch {
            // Non-blocking
          }

          // Queue mass notification for severe weather
          try {
            const templateVars = {
              siteName: site.name,
              event: weatherAlert.event,
              severity: weatherAlert.severity,
              headline: weatherAlert.headline,
            };
            const rendered = renderTemplate(WEATHER_ALERT_SMS, templateVars);

            await app.alertQueue.add('mass-notify', {
              siteId,
              channels: ['SMS', 'EMAIL', 'PUSH', 'PA'],
              message: rendered.body,
              recipientScope: 'all-staff',
              alertId: alert.id,
            });
          } catch {
            // Non-blocking — notification failure shouldn't break weather response
          }

          app.log.warn(
            { alertId: alert.id, nwsId: weatherAlert.id, severity: weatherAlert.severity },
            `Auto-created WEATHER alert: ${weatherAlert.headline}`,
          );
        }
      }

      return alerts;
    },
  );
}
