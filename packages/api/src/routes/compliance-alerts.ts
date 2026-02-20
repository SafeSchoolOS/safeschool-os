import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const complianceAlertRoutes: FastifyPluginAsync = async (fastify) => {
  // ── List alerts ───────────────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId?: string; status?: string; severity?: string; type?: string; category?: string; limit?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, status, severity, type, category, limit } = request.query;
    const where: any = { siteId: { in: request.jwtUser.siteIds } };
    if (siteId) where.siteId = siteId;
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (type) where.type = type;
    if (category) where.category = category;

    return fastify.prisma.complianceAlert.findMany({
      where,
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(parseInt(limit || '50'), 200),
    });
  });

  // ── Acknowledge alert ─────────────────────────────────────────────────
  fastify.patch<{
    Params: { alertId: string };
    Body: { status?: string };
  }>('/:alertId/acknowledge', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const alert = await fastify.prisma.complianceAlert.findFirst({
      where: { id: request.params.alertId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!alert) return reply.code(404).send({ error: 'Alert not found' });

    return fastify.prisma.complianceAlert.update({
      where: { id: alert.id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedById: request.jwtUser.id,
        acknowledgedAt: new Date(),
      },
    });
  });

  // ── Resolve alert ─────────────────────────────────────────────────────
  fastify.patch<{
    Params: { alertId: string };
  }>('/:alertId/resolve', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const alert = await fastify.prisma.complianceAlert.findFirst({
      where: { id: request.params.alertId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!alert) return reply.code(404).send({ error: 'Alert not found' });

    return fastify.prisma.complianceAlert.update({
      where: { id: alert.id },
      data: {
        status: 'RESOLVED',
        resolvedById: request.jwtUser.id,
        resolvedAt: new Date(),
      },
    });
  });

  // ── Snooze alert ──────────────────────────────────────────────────────
  fastify.patch<{
    Params: { alertId: string };
  }>('/:alertId/snooze', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const alert = await fastify.prisma.complianceAlert.findFirst({
      where: { id: request.params.alertId, siteId: { in: request.jwtUser.siteIds } },
    });
    if (!alert) return reply.code(404).send({ error: 'Alert not found' });

    return fastify.prisma.complianceAlert.update({
      where: { id: alert.id },
      data: { status: 'SNOOZED' },
    });
  });

  // ── Run compliance checks (scheduler endpoint) ────────────────────────
  fastify.post<{
    Body: { siteId: string };
  }>('/run-checks', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const alerts: any[] = [];
    const now = new Date();

    // ── Check 1: Drill quotas ──
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const recentDrillCount = await fastify.prisma.drill.count({
      where: { siteId, status: 'COMPLETED', completedAt: { gte: thirtyDaysAgo } },
    });
    if (recentDrillCount === 0) {
      alerts.push({
        siteId,
        type: 'DRILL_OVERDUE',
        severity: 'URGENT',
        title: 'No drills completed in the last 30 days',
        description: 'At least one safety drill should be conducted monthly to maintain compliance.',
        category: 'DRILL',
        metadata: { lastDrillCount30d: 0 },
      });
    }

    const quarterlyDrillCount = await fastify.prisma.drill.count({
      where: { siteId, status: 'COMPLETED', completedAt: { gte: ninetyDaysAgo } },
    });
    if (quarterlyDrillCount < 2) {
      alerts.push({
        siteId,
        type: 'DRILL_QUOTA_AT_RISK',
        severity: 'WARNING',
        title: 'Drill quota at risk for this quarter',
        description: `Only ${quarterlyDrillCount} drills completed in the last 90 days. Most states require 2+ per quarter.`,
        category: 'DRILL',
        metadata: { quarterlyCount: quarterlyDrillCount },
      });
    }

    // ── Check 2: Panic devices offline ──
    // Note: PanicDevice model not yet in schema; skip this check until added

    // ── Check 3: Expired certifications ──
    const expiredCerts = await fastify.prisma.staffCertification.count({
      where: { siteId, status: 'EXPIRED' },
    });
    if (expiredCerts > 0) {
      alerts.push({
        siteId,
        type: 'CERT_EXPIRED',
        severity: 'WARNING',
        title: `${expiredCerts} staff certification(s) expired`,
        description: 'Staff members have expired certifications that need renewal.',
        category: 'CERTIFICATION',
        metadata: { expiredCount: expiredCerts },
      });
    }

    // ── Check 4: Expiring certifications ──
    const sixtyDays = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const expiringCerts = await fastify.prisma.staffCertification.count({
      where: { siteId, status: 'ACTIVE', expiresAt: { lte: sixtyDays, gt: now } },
    });
    if (expiringCerts > 0) {
      alerts.push({
        siteId,
        type: 'CERT_EXPIRING',
        severity: 'INFO',
        title: `${expiringCerts} certification(s) expiring within 60 days`,
        description: 'Staff certifications are approaching expiration and should be renewed.',
        category: 'CERTIFICATION',
        metadata: { expiringCount: expiringCerts },
      });
    }

    // ── Check 5: Emergency supply expirations ──
    const expiredSupplies = await fastify.prisma.emergencySupply.count({
      where: { siteId, isActive: true, expiresAt: { lte: now } },
    });
    if (expiredSupplies > 0) {
      alerts.push({
        siteId,
        type: 'SUPPLY_EXPIRED',
        severity: 'URGENT',
        title: `${expiredSupplies} emergency supply(ies) expired`,
        description: 'Expired supplies (AEDs, first aid kits, etc.) must be replaced immediately.',
        category: 'SYSTEM',
        metadata: { expiredCount: expiredSupplies },
      });
    }

    // ── Check 6: Overdue supply inspections ──
    const overdueInspections = await fastify.prisma.emergencySupply.count({
      where: { siteId, isActive: true, nextInspectionDue: { lte: now } },
    });
    if (overdueInspections > 0) {
      alerts.push({
        siteId,
        type: 'AED_INSPECTION_OVERDUE',
        severity: 'WARNING',
        title: `${overdueInspections} supply inspection(s) overdue`,
        description: 'Emergency supplies have overdue inspection dates.',
        category: 'SYSTEM',
        metadata: { overdueCount: overdueInspections },
      });
    }

    // ── Check 7: Door health degradation ──
    const faultyDoors = await fastify.prisma.door.count({
      where: { siteId, status: { in: ['UNKNOWN', 'FORCED', 'HELD'] } },
    });
    if (faultyDoors > 0) {
      alerts.push({
        siteId,
        type: 'DOOR_HEALTH_DEGRADED',
        severity: faultyDoors > 5 ? 'CRITICAL' : 'WARNING',
        title: `${faultyDoors} door(s) in degraded state`,
        description: 'Doors are in abnormal state (forced, held open, or unknown). Review immediately.',
        category: 'SYSTEM',
        metadata: { faultyCount: faultyDoors },
      });
    }

    // Create alerts (skip duplicates for active/acknowledged alerts of same type)
    let created = 0;
    for (const alertData of alerts) {
      const existing = await fastify.prisma.complianceAlert.findFirst({
        where: { siteId, type: alertData.type as any, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
      });
      if (!existing) {
        await fastify.prisma.complianceAlert.create({ data: alertData });
        created++;
      }
    }

    return { checksRun: 7, alertsGenerated: alerts.length, alertsCreated: created };
  });

  // ── Check schedules CRUD ──────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/schedules', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    return fastify.prisma.complianceCheckSchedule.findMany({ where: { siteId }, orderBy: { checkType: 'asc' } });
  });

  fastify.put<{
    Body: {
      siteId: string;
      checkType: string;
      frequency: string;
      isEnabled?: boolean;
      config?: Record<string, unknown>;
    };
  }>('/schedules', { preHandler: [fastify.authenticate, requireMinRole('SITE_ADMIN')] }, async (request, reply) => {
    const { siteId, checkType, ...rest } = request.body;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const scheduleData = {
      ...rest,
      config: rest.config as Prisma.InputJsonValue | undefined,
    };
    return fastify.prisma.complianceCheckSchedule.upsert({
      where: { siteId_checkType: { siteId, checkType } },
      create: { siteId, checkType, ...scheduleData },
      update: scheduleData,
    });
  });

  // ── Dashboard summary ─────────────────────────────────────────────────
  fastify.get<{
    Querystring: { siteId: string };
  }>('/dashboard', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { siteId } = request.query;
    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    const [bySeverity, byStatus, byCategory, critical] = await Promise.all([
      fastify.prisma.complianceAlert.groupBy({
        by: ['severity'],
        where: { siteId, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        _count: true,
      }),
      fastify.prisma.complianceAlert.groupBy({
        by: ['status'],
        where: { siteId },
        _count: true,
      }),
      fastify.prisma.complianceAlert.groupBy({
        by: ['category'],
        where: { siteId, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        _count: true,
      }),
      fastify.prisma.complianceAlert.findMany({
        where: { siteId, severity: 'CRITICAL', status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      bySeverity: bySeverity.map((s) => ({ severity: s.severity, count: s._count })),
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byCategory: byCategory.map((c) => ({ category: c.category, count: c._count })),
      criticalAlerts: critical,
    };
  });
};

export default complianceAlertRoutes;
