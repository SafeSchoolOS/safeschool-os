import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';

const visitorAnalyticsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/visitor-analytics/summary — Totals today/week/month, avg duration, by type
  fastify.get('/summary', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return {};

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(todayStart);
    monthStart.setDate(monthStart.getDate() - 30);

    const [todayCount, weekCount, monthCount, currentlyIn, byType] = await Promise.all([
      fastify.prisma.visitor.count({
        where: { siteId, checkedInAt: { gte: todayStart } },
      }),
      fastify.prisma.visitor.count({
        where: { siteId, checkedInAt: { gte: weekStart } },
      }),
      fastify.prisma.visitor.count({
        where: { siteId, checkedInAt: { gte: monthStart } },
      }),
      fastify.prisma.visitor.count({
        where: { siteId, status: 'CHECKED_IN' },
      }),
      fastify.prisma.visitor.groupBy({
        by: ['visitorType'],
        where: { siteId, checkedInAt: { gte: monthStart } },
        _count: true,
      }),
    ]);

    // Avg visit duration for completed visits this month
    const completedVisits = await fastify.prisma.visitor.findMany({
      where: {
        siteId,
        status: 'CHECKED_OUT',
        checkedInAt: { gte: monthStart },
        checkedOutAt: { not: null },
      },
      select: { checkedInAt: true, checkedOutAt: true },
    });

    let avgDurationMinutes = 0;
    if (completedVisits.length > 0) {
      const totalMs = completedVisits.reduce((sum, v) => {
        if (v.checkedInAt && v.checkedOutAt) {
          return sum + (v.checkedOutAt.getTime() - v.checkedInAt.getTime());
        }
        return sum;
      }, 0);
      avgDurationMinutes = Math.round(totalMs / completedVisits.length / 60000);
    }

    return {
      today: todayCount,
      week: weekCount,
      month: monthCount,
      currentlyIn,
      avgDurationMinutes,
      byType: byType.map((t) => ({ type: t.visitorType, count: t._count })),
    };
  });

  // GET /api/v1/visitor-analytics/peak-times — Hourly check-in counts for date range
  fastify.get<{ Querystring: { days?: string } }>(
    '/peak-times',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return [];

      const days = Math.min(parseInt(request.query.days || '30'), 90);
      const since = new Date();
      since.setDate(since.getDate() - days);

      const visitors = await fastify.prisma.visitor.findMany({
        where: { siteId, checkedInAt: { gte: since } },
        select: { checkedInAt: true },
      });

      // Aggregate by hour of day (0-23)
      const hourCounts: number[] = new Array(24).fill(0);
      for (const v of visitors) {
        if (v.checkedInAt) {
          hourCounts[v.checkedInAt.getHours()]++;
        }
      }

      return hourCounts.map((count, hour) => ({ hour, count }));
    },
  );

  // GET /api/v1/visitor-analytics/frequent — Top N most frequent visitors
  fastify.get<{ Querystring: { limit?: string } }>(
    '/frequent',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return [];

      const take = Math.min(parseInt(request.query.limit || '20'), 50);
      const since = new Date();
      since.setDate(since.getDate() - 90);

      const results = await fastify.prisma.visitor.groupBy({
        by: ['firstName', 'lastName'],
        where: { siteId, checkedInAt: { gte: since } },
        _count: true,
        orderBy: { _count: { firstName: 'desc' } },
        take,
      });

      return results.map((r) => ({
        firstName: r.firstName,
        lastName: r.lastName,
        visitCount: r._count,
      }));
    },
  );

  // GET /api/v1/visitor-analytics/duration — Avg duration by type/purpose
  fastify.get(
    '/duration',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId) return {};

      const since = new Date();
      since.setDate(since.getDate() - 30);

      const completedVisits = await fastify.prisma.visitor.findMany({
        where: {
          siteId,
          status: 'CHECKED_OUT',
          checkedInAt: { gte: since },
          checkedOutAt: { not: null },
        },
        select: { visitorType: true, purpose: true, checkedInAt: true, checkedOutAt: true },
      });

      // By visitor type
      const byType: Record<string, { total: number; count: number }> = {};
      // By purpose
      const byPurpose: Record<string, { total: number; count: number }> = {};

      for (const v of completedVisits) {
        if (!v.checkedInAt || !v.checkedOutAt) continue;
        const durationMs = v.checkedOutAt.getTime() - v.checkedInAt.getTime();

        if (!byType[v.visitorType]) byType[v.visitorType] = { total: 0, count: 0 };
        byType[v.visitorType].total += durationMs;
        byType[v.visitorType].count++;

        if (!byPurpose[v.purpose]) byPurpose[v.purpose] = { total: 0, count: 0 };
        byPurpose[v.purpose].total += durationMs;
        byPurpose[v.purpose].count++;
      }

      return {
        byType: Object.entries(byType).map(([type, d]) => ({
          type,
          avgMinutes: Math.round(d.total / d.count / 60000),
          count: d.count,
        })),
        byPurpose: Object.entries(byPurpose).map(([purpose, d]) => ({
          purpose,
          avgMinutes: Math.round(d.total / d.count / 60000),
          count: d.count,
        })),
      };
    },
  );
};

export default visitorAnalyticsRoutes;
