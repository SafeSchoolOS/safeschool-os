import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const CHANNELS = ['SMS', 'EMAIL', 'PUSH'] as const;
const ALERT_LEVELS = ['MEDICAL', 'LOCKDOWN', 'ACTIVE_THREAT', 'FIRE', 'WEATHER', 'ALL_CLEAR'] as const;

type Channel = (typeof CHANNELS)[number];
type AlertLevel = (typeof ALERT_LEVELS)[number];

interface PreferenceBody {
  channel: Channel;
  alertLevel: AlertLevel;
  enabled: boolean;
}

const notificationPreferenceRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/notification-preferences — returns user's prefs for their first siteId
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request, reply) => {
      const userId = request.jwtUser.id;
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const prefs = await fastify.prisma.notificationPreference.findMany({
        where: { userId, siteId },
        orderBy: [{ alertLevel: 'asc' }, { channel: 'asc' }],
      });

      // If user has no preferences yet, return defaults (all enabled)
      if (prefs.length === 0) {
        const defaults: Array<{
          channel: Channel;
          alertLevel: AlertLevel;
          enabled: boolean;
        }> = [];
        for (const alertLevel of ALERT_LEVELS) {
          for (const channel of CHANNELS) {
            defaults.push({ channel, alertLevel, enabled: true });
          }
        }
        return { preferences: defaults, isDefault: true };
      }

      return {
        preferences: prefs.map((p) => ({
          id: p.id,
          channel: p.channel,
          alertLevel: p.alertLevel,
          enabled: p.enabled,
        })),
        isDefault: false,
      };
    },
  );

  // PUT /api/v1/notification-preferences — bulk upsert array of {channel, alertLevel, enabled}
  fastify.put<{ Body: { preferences: PreferenceBody[] } }>(
    '/',
    { preHandler: [fastify.authenticate, requireMinRole('TEACHER')] },
    async (request, reply) => {
      const userId = request.jwtUser.id;
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return reply.code(403).send({ error: 'No site access' });

      const { preferences } = request.body;
      if (!Array.isArray(preferences)) {
        return reply.code(400).send({ error: 'preferences must be an array' });
      }

      // Validate each preference
      for (const pref of preferences) {
        if (!CHANNELS.includes(pref.channel as Channel)) {
          return reply.code(400).send({
            error: `Invalid channel: ${pref.channel}. Must be one of: ${CHANNELS.join(', ')}`,
          });
        }
        if (!ALERT_LEVELS.includes(pref.alertLevel as AlertLevel)) {
          return reply.code(400).send({
            error: `Invalid alertLevel: ${pref.alertLevel}. Must be one of: ${ALERT_LEVELS.join(', ')}`,
          });
        }
        if (typeof pref.enabled !== 'boolean') {
          return reply.code(400).send({ error: 'enabled must be a boolean' });
        }
      }

      // Use a transaction for bulk upsert
      const results = await fastify.prisma.$transaction(
        preferences.map((pref) =>
          fastify.prisma.notificationPreference.upsert({
            where: {
              userId_siteId_channel_alertLevel: {
                userId,
                siteId,
                channel: pref.channel,
                alertLevel: pref.alertLevel,
              },
            },
            update: { enabled: pref.enabled },
            create: {
              userId,
              siteId,
              channel: pref.channel,
              alertLevel: pref.alertLevel,
              enabled: pref.enabled,
            },
          }),
        ),
      );

      return {
        preferences: results.map((p) => ({
          id: p.id,
          channel: p.channel,
          alertLevel: p.alertLevel,
          enabled: p.enabled,
        })),
        updated: results.length,
      };
    },
  );
};

export default notificationPreferenceRoutes;
