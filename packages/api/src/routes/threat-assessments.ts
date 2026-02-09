import type { FastifyPluginAsync } from 'fastify';
import { scoreRisk, getAssessmentActions } from '@safeschool/threat-assessment';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const threatAssessmentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/threat-assessments — List reports
  fastify.get<{
    Querystring: { siteId?: string; status?: string; riskLevel?: string; limit?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, status, riskLevel, limit } = request.query;

    const where: any = {};
    if (siteId) where.siteId = siteId;
    else where.siteId = { in: request.jwtUser.siteIds };
    if (status) where.status = status;
    if (riskLevel) where.riskLevel = riskLevel;

    return fastify.prisma.threatReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 100),
    });
  });

  // POST /api/v1/threat-assessments — Submit a threat report
  fastify.post<{
    Body: {
      subjectName: string;
      subjectGrade?: string;
      subjectRole?: string;
      category: string;
      description: string;
      evidence?: Record<string, unknown>;
      riskFactors?: string[];
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { subjectGrade, subjectRole, evidence, riskFactors } = request.body;
    const subjectName = sanitizeText(request.body.subjectName);
    const category = sanitizeText(request.body.category);
    const description = sanitizeText(request.body.description);

    if (!subjectName || !category || !description) {
      return reply.code(400).send({ error: 'subjectName, category, and description are required' });
    }

    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) {
      return reply.code(403).send({ error: 'No site access' });
    }

    // Score risk if factors provided
    const risk = riskFactors ? scoreRisk(riskFactors) : scoreRisk([]);

    const report = await fastify.prisma.threatReport.create({
      data: {
        siteId,
        reportedById: request.jwtUser.id,
        subjectName,
        subjectGrade,
        subjectRole: subjectRole || 'student',
        category: category as any,
        description,
        evidence: (evidence || undefined) as any,
        riskLevel: risk.level as any,
        status: risk.level === 'IMMINENT' ? 'ESCALATED_TO_LE' : 'REPORTED',
        escalatedAt: risk.level === 'IMMINENT' ? new Date() : undefined,
      },
    });

    // Auto-create alert for IMMINENT threats
    if (risk.level === 'IMMINENT') {
      await fastify.alertQueue.add('notify-staff', {
        alertId: report.id,
        siteId,
        level: 'ACTIVE_THREAT',
        message: `IMMINENT threat report: ${subjectName} - ${category}. ${risk.recommendation}`,
      });
    } else if (risk.level === 'HIGH') {
      await fastify.alertQueue.add('notify-staff', {
        alertId: report.id,
        siteId,
        level: 'LOCKDOWN',
        message: `HIGH risk threat report: ${subjectName} - ${category}. Review within 24 hours.`,
      });
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'THREAT_REPORT_CREATED',
        entity: 'ThreatReport',
        entityId: report.id,
        details: { category, riskLevel: risk.level },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send({ report, assessment: getAssessmentActions(risk) });
  });

  // GET /api/v1/threat-assessments/:id — Report detail
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.threatReport.findUnique({
      where: { id: request.params.id },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Report not found' });
    }

    return report;
  });

  // PATCH /api/v1/threat-assessments/:id — Update report status/assignment
  fastify.patch<{
    Params: { id: string };
    Body: {
      status?: string;
      assignedToId?: string;
      riskLevel?: string;
      actionTaken?: string;
      notes?: string;
      riskFactors?: string[];
    };
  }>('/:id', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { status, assignedToId, riskLevel, actionTaken, riskFactors } = request.body;

    const existing = await fastify.prisma.threatReport.findUnique({
      where: { id: request.params.id },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Report not found' });
    }

    // Re-score risk if new factors provided
    let computedRiskLevel = riskLevel;
    if (riskFactors) {
      const risk = scoreRisk(riskFactors);
      computedRiskLevel = risk.level;
    }

    const data: any = {};
    if (status) data.status = status;
    if (assignedToId) data.assignedToId = assignedToId;
    if (computedRiskLevel) data.riskLevel = computedRiskLevel;
    if (actionTaken) data.actionTaken = actionTaken;

    if (status === 'RESOLVED' || status === 'CLOSED') {
      data.resolvedAt = new Date();
    }
    if (status === 'ESCALATED_TO_LE') {
      data.escalatedAt = new Date();
    }

    const updated = await fastify.prisma.threatReport.update({
      where: { id: request.params.id },
      data,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'THREAT_REPORT_UPDATED',
        entity: 'ThreatReport',
        entityId: existing.id,
        details: { status, riskLevel: computedRiskLevel },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // POST /api/v1/threat-assessments/:id/score — Re-score risk
  fastify.post<{
    Params: { id: string };
    Body: { riskFactors: string[] };
  }>('/:id/score', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { riskFactors } = request.body;

    if (!riskFactors || !Array.isArray(riskFactors)) {
      return reply.code(400).send({ error: 'riskFactors array is required' });
    }

    const existing = await fastify.prisma.threatReport.findUnique({
      where: { id: request.params.id },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Report not found' });
    }

    const risk = scoreRisk(riskFactors);
    const assessment = getAssessmentActions(risk);

    // Update the report with new risk level
    await fastify.prisma.threatReport.update({
      where: { id: request.params.id },
      data: { riskLevel: risk.level as any },
    });

    return { risk, assessment };
  });

  // GET /api/v1/threat-assessments/dashboard — Summary stats
  fastify.get('/dashboard', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];

    const [total, byStatus, byRiskLevel] = await Promise.all([
      fastify.prisma.threatReport.count({ where: { siteId } }),
      fastify.prisma.threatReport.groupBy({
        by: ['status'],
        where: { siteId },
        _count: true,
      }),
      fastify.prisma.threatReport.groupBy({
        by: ['riskLevel'],
        where: { siteId },
        _count: true,
      }),
    ]);

    const activeCount = byStatus
      .filter((s) => !['RESOLVED', 'CLOSED'].includes(s.status))
      .reduce((sum, s) => sum + s._count, 0);

    return {
      total,
      active: activeCount,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byRiskLevel: Object.fromEntries(byRiskLevel.map((r) => [r.riskLevel, r._count])),
    };
  });
};

export default threatAssessmentRoutes;
