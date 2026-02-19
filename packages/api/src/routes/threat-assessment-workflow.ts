import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

/**
 * Threat Assessment Workflow routes — case management, team collaboration,
 * interviews, safety plans, and tip linking.
 *
 * All endpoints require OPERATOR+ and are scoped to the user's sites.
 */
const threatAssessmentWorkflowRoutes: FastifyPluginAsync = async (fastify) => {
  // ---------------------------------------------------------------------------
  // Team Members
  // ---------------------------------------------------------------------------

  // GET /api/v1/threat-assessment-workflow/:reportId/team — list team members
  fastify.get<{
    Params: { reportId: string };
  }>('/:reportId/team', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    return fastify.prisma.threatAssessmentTeamMember.findMany({
      where: { threatReportId: report.id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { assignedAt: 'asc' },
    });
  });

  // POST /api/v1/threat-assessment-workflow/:reportId/team — assign team member
  fastify.post<{
    Params: { reportId: string };
    Body: { userId: string; role: string };
  }>('/:reportId/team', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { userId, role } = request.body;

    if (!userId || !role) {
      return reply.code(400).send({ error: 'userId and role are required' });
    }

    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    const member = await fastify.prisma.threatAssessmentTeamMember.create({
      data: {
        siteId: report.siteId,
        threatReportId: report.id,
        userId,
        role: role as any,
      },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: report.siteId,
        userId: request.jwtUser.id,
        action: 'THREAT_TEAM_MEMBER_ASSIGNED',
        entity: 'ThreatAssessmentTeamMember',
        entityId: member.id,
        details: { threatReportId: report.id, assignedUserId: userId, teamRole: role },
        ipAddress: request.ip,
      },
    });

    // Notify the assigned team member
    await fastify.alertQueue.add('notify-staff', {
      alertId: report.id,
      siteId: report.siteId,
      level: 'INFO',
      message: `You have been assigned to threat assessment case for ${report.subjectName} as ${role}.`,
      targetUserIds: [userId],
    });

    return reply.code(201).send(member);
  });

  // DELETE /api/v1/threat-assessment-workflow/:reportId/team/:memberId — remove team member
  fastify.delete<{
    Params: { reportId: string; memberId: string };
  }>('/:reportId/team/:memberId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    await fastify.prisma.threatAssessmentTeamMember.delete({
      where: { id: request.params.memberId },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: report.siteId,
        userId: request.jwtUser.id,
        action: 'THREAT_TEAM_MEMBER_REMOVED',
        entity: 'ThreatAssessmentTeamMember',
        entityId: request.params.memberId,
        details: { threatReportId: report.id },
        ipAddress: request.ip,
      },
    });

    return reply.code(204).send();
  });

  // PATCH /api/v1/threat-assessment-workflow/:reportId/team/:memberId/acknowledge
  fastify.patch<{
    Params: { reportId: string; memberId: string };
  }>('/:reportId/team/:memberId/acknowledge', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    return fastify.prisma.threatAssessmentTeamMember.update({
      where: { id: request.params.memberId },
      data: { acknowledgedAt: new Date() },
    });
  });

  // ---------------------------------------------------------------------------
  // Case Notes / Timeline
  // ---------------------------------------------------------------------------

  // GET /api/v1/threat-assessment-workflow/:reportId/notes — list notes
  fastify.get<{
    Params: { reportId: string };
    Querystring: { noteType?: string };
  }>('/:reportId/notes', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    const where: any = { threatReportId: report.id };
    if (request.query.noteType) where.noteType = request.query.noteType;

    // Only show confidential notes to SITE_ADMIN+
    const userRole = request.jwtUser.role;
    if (userRole !== 'SITE_ADMIN' && userRole !== 'SUPER_ADMIN') {
      where.isConfidential = false;
    }

    return fastify.prisma.threatAssessmentNote.findMany({
      where,
      include: { author: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  // POST /api/v1/threat-assessment-workflow/:reportId/notes — add note
  fastify.post<{
    Params: { reportId: string };
    Body: {
      content: string;
      noteType?: string;
      isConfidential?: boolean;
      attachmentUrls?: string[];
    };
  }>('/:reportId/notes', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { noteType, isConfidential, attachmentUrls } = request.body;
    const content = sanitizeText(request.body.content);

    if (!content) {
      return reply.code(400).send({ error: 'content is required' });
    }

    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    const note = await fastify.prisma.threatAssessmentNote.create({
      data: {
        siteId: report.siteId,
        threatReportId: report.id,
        authorId: request.jwtUser.id,
        noteType: (noteType as any) || 'GENERAL',
        content,
        isConfidential: isConfidential || false,
        attachmentUrls: attachmentUrls || [],
      },
      include: { author: { select: { id: true, name: true, role: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: report.siteId,
        userId: request.jwtUser.id,
        action: 'THREAT_NOTE_ADDED',
        entity: 'ThreatAssessmentNote',
        entityId: note.id,
        details: { threatReportId: report.id, noteType: note.noteType },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(note);
  });

  // ---------------------------------------------------------------------------
  // Interviews
  // ---------------------------------------------------------------------------

  // GET /api/v1/threat-assessment-workflow/:reportId/interviews — list interviews
  fastify.get<{
    Params: { reportId: string };
  }>('/:reportId/interviews', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    return fastify.prisma.threatAssessmentInterview.findMany({
      where: { threatReportId: report.id },
      include: { conductedBy: { select: { id: true, name: true, role: true } } },
      orderBy: { scheduledAt: 'asc' },
    });
  });

  // POST /api/v1/threat-assessment-workflow/:reportId/interviews — schedule interview
  fastify.post<{
    Params: { reportId: string };
    Body: {
      intervieweeType: string;
      intervieweeName: string;
      scheduledAt?: string;
      questions?: Record<string, unknown>;
    };
  }>('/:reportId/interviews', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { intervieweeType, scheduledAt, questions } = request.body;
    const intervieweeName = sanitizeText(request.body.intervieweeName);

    if (!intervieweeType || !intervieweeName) {
      return reply.code(400).send({ error: 'intervieweeType and intervieweeName are required' });
    }

    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    const interview = await fastify.prisma.threatAssessmentInterview.create({
      data: {
        siteId: report.siteId,
        threatReportId: report.id,
        conductedById: request.jwtUser.id,
        intervieweeType: intervieweeType as any,
        intervieweeName,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        questions: (questions || undefined) as any,
      },
      include: { conductedBy: { select: { id: true, name: true, role: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: report.siteId,
        userId: request.jwtUser.id,
        action: 'THREAT_INTERVIEW_SCHEDULED',
        entity: 'ThreatAssessmentInterview',
        entityId: interview.id,
        details: { threatReportId: report.id, intervieweeType, intervieweeName },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(interview);
  });

  // PATCH /api/v1/threat-assessment-workflow/:reportId/interviews/:interviewId — update interview
  fastify.patch<{
    Params: { reportId: string; interviewId: string };
    Body: {
      status?: string;
      conductedAt?: string;
      responses?: Record<string, unknown>;
      summary?: string;
      riskIndicators?: string[];
    };
  }>('/:reportId/interviews/:interviewId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { status, conductedAt, responses, summary, riskIndicators } = request.body;

    const existing = await fastify.prisma.threatAssessmentInterview.findFirst({
      where: { id: request.params.interviewId, threatReportId: request.params.reportId },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Interview not found' });
    }

    const data: any = {};
    if (status) data.status = status;
    if (conductedAt) data.conductedAt = new Date(conductedAt);
    if (responses) data.responses = responses;
    if (summary) data.summary = sanitizeText(summary);
    if (riskIndicators) data.riskIndicators = riskIndicators;

    return fastify.prisma.threatAssessmentInterview.update({
      where: { id: request.params.interviewId },
      data,
      include: { conductedBy: { select: { id: true, name: true, role: true } } },
    });
  });

  // ---------------------------------------------------------------------------
  // Safety Plans
  // ---------------------------------------------------------------------------

  // GET /api/v1/threat-assessment-workflow/:reportId/safety-plans — list safety plans
  fastify.get<{
    Params: { reportId: string };
  }>('/:reportId/safety-plans', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    return fastify.prisma.safetyPlan.findMany({
      where: { threatReportId: report.id },
      include: { createdBy: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  // POST /api/v1/threat-assessment-workflow/:reportId/safety-plans — create safety plan
  fastify.post<{
    Params: { reportId: string };
    Body: {
      planType: string;
      objectives: unknown[];
      interventions: unknown[];
      monitoringPlan?: Record<string, unknown>;
      restrictions?: Record<string, unknown>;
      supportServices?: Record<string, unknown>;
      reviewDate?: string;
      expiresAt?: string;
    };
  }>('/:reportId/safety-plans', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { planType, objectives, interventions, monitoringPlan, restrictions, supportServices, reviewDate, expiresAt } = request.body;

    if (!planType || !objectives || !interventions) {
      return reply.code(400).send({ error: 'planType, objectives, and interventions are required' });
    }

    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    const plan = await fastify.prisma.safetyPlan.create({
      data: {
        siteId: report.siteId,
        threatReportId: report.id,
        createdById: request.jwtUser.id,
        planType: planType as any,
        objectives: objectives as any,
        interventions: interventions as any,
        monitoringPlan: (monitoringPlan || undefined) as any,
        restrictions: (restrictions || undefined) as any,
        supportServices: (supportServices || undefined) as any,
        reviewDate: reviewDate ? new Date(reviewDate) : undefined,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      },
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: report.siteId,
        userId: request.jwtUser.id,
        action: 'SAFETY_PLAN_CREATED',
        entity: 'SafetyPlan',
        entityId: plan.id,
        details: { threatReportId: report.id, planType },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(plan);
  });

  // PATCH /api/v1/threat-assessment-workflow/:reportId/safety-plans/:planId — update safety plan
  fastify.patch<{
    Params: { reportId: string; planId: string };
    Body: {
      status?: string;
      objectives?: unknown[];
      interventions?: unknown[];
      monitoringPlan?: Record<string, unknown>;
      restrictions?: Record<string, unknown>;
      supportServices?: Record<string, unknown>;
      parentNotified?: boolean;
      reviewDate?: string;
      expiresAt?: string;
    };
  }>('/:reportId/safety-plans/:planId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { status, objectives, interventions, monitoringPlan, restrictions, supportServices, parentNotified, reviewDate, expiresAt } = request.body;

    const existing = await fastify.prisma.safetyPlan.findFirst({
      where: { id: request.params.planId, threatReportId: request.params.reportId },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Safety plan not found' });
    }

    const data: any = {};
    if (status) data.status = status;
    if (objectives) data.objectives = objectives;
    if (interventions) data.interventions = interventions;
    if (monitoringPlan) data.monitoringPlan = monitoringPlan;
    if (restrictions) data.restrictions = restrictions;
    if (supportServices) data.supportServices = supportServices;
    if (parentNotified !== undefined) {
      data.parentNotified = parentNotified;
      if (parentNotified) data.parentNotifiedAt = new Date();
    }
    if (reviewDate) data.reviewDate = new Date(reviewDate);
    if (expiresAt) data.expiresAt = new Date(expiresAt);

    if (status === 'ACTIVE' && !existing.approvedAt) {
      data.approvedAt = new Date();
      data.approvedById = request.jwtUser.id;
    }

    const updated = await fastify.prisma.safetyPlan.update({
      where: { id: request.params.planId },
      data,
      include: { createdBy: { select: { id: true, name: true, role: true } } },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: request.jwtUser.id,
        action: 'SAFETY_PLAN_UPDATED',
        entity: 'SafetyPlan',
        entityId: existing.id,
        details: { status, threatReportId: request.params.reportId },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // ---------------------------------------------------------------------------
  // Tip Linking
  // ---------------------------------------------------------------------------

  // GET /api/v1/threat-assessment-workflow/:reportId/linked-tips — list linked tips
  fastify.get<{
    Params: { reportId: string };
  }>('/:reportId/linked-tips', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    return fastify.prisma.threatReportTipLink.findMany({
      where: { threatReportId: report.id },
      orderBy: { linkedAt: 'desc' },
    });
  });

  // POST /api/v1/threat-assessment-workflow/:reportId/linked-tips — link a tip
  fastify.post<{
    Params: { reportId: string };
    Body: { tipId: string; tipSource: string; notes?: string };
  }>('/:reportId/linked-tips', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { tipId, tipSource, notes } = request.body;

    if (!tipId || !tipSource) {
      return reply.code(400).send({ error: 'tipId and tipSource are required' });
    }

    if (!['anonymous_tip', 'fr_tip'].includes(tipSource)) {
      return reply.code(400).send({ error: 'tipSource must be "anonymous_tip" or "fr_tip"' });
    }

    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    const link = await fastify.prisma.threatReportTipLink.create({
      data: {
        threatReportId: report.id,
        tipId,
        tipSource,
        linkedById: request.jwtUser.id,
        notes: sanitizeText(notes),
      },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: report.siteId,
        userId: request.jwtUser.id,
        action: 'THREAT_TIP_LINKED',
        entity: 'ThreatReportTipLink',
        entityId: link.id,
        details: { threatReportId: report.id, tipId, tipSource },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(link);
  });

  // DELETE /api/v1/threat-assessment-workflow/:reportId/linked-tips/:linkId — unlink tip
  fastify.delete<{
    Params: { reportId: string; linkId: string };
  }>('/:reportId/linked-tips/:linkId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    await fastify.prisma.threatReportTipLink.delete({
      where: { id: request.params.linkId },
    });

    return reply.code(204).send();
  });

  // ---------------------------------------------------------------------------
  // Full Case Timeline — aggregated view of all activity
  // ---------------------------------------------------------------------------

  // GET /api/v1/threat-assessment-workflow/:reportId/timeline — full case timeline
  fastify.get<{
    Params: { reportId: string };
  }>('/:reportId/timeline', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const report = await fastify.prisma.threatReport.findFirst({
      where: { id: request.params.reportId, siteId: { in: request.jwtUser.siteIds } },
      include: {
        teamMembers: { include: { user: { select: { id: true, name: true } } } },
        notes: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
        interviews: { include: { conductedBy: { select: { id: true, name: true } } }, orderBy: { scheduledAt: 'asc' } },
        safetyPlans: { include: { createdBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
        linkedTips: { orderBy: { linkedAt: 'asc' } },
      },
    });

    if (!report) {
      return reply.code(404).send({ error: 'Threat report not found' });
    }

    // Filter confidential notes for non-admin users
    const userRole = request.jwtUser.role;
    const filteredNotes = (userRole === 'SITE_ADMIN' || userRole === 'SUPER_ADMIN')
      ? report.notes
      : report.notes.filter((n) => !n.isConfidential);

    // Build chronological timeline
    const timeline: Array<{ timestamp: Date; type: string; summary: string; details: unknown }> = [];

    // Report creation
    timeline.push({
      timestamp: report.createdAt,
      type: 'REPORT_CREATED',
      summary: `Threat report created: ${report.subjectName} — ${report.category}`,
      details: { riskLevel: report.riskLevel, status: report.status },
    });

    // Team assignments
    for (const member of report.teamMembers) {
      timeline.push({
        timestamp: member.assignedAt,
        type: 'TEAM_MEMBER_ASSIGNED',
        summary: `${member.user.name} assigned as ${member.role}`,
        details: { userId: member.userId, teamRole: member.role },
      });
    }

    // Notes
    for (const note of filteredNotes) {
      timeline.push({
        timestamp: note.createdAt,
        type: 'NOTE_ADDED',
        summary: `${note.author.name} added ${note.noteType} note`,
        details: { noteId: note.id, noteType: note.noteType, isConfidential: note.isConfidential },
      });
    }

    // Interviews
    for (const interview of report.interviews) {
      if (interview.scheduledAt) {
        timeline.push({
          timestamp: interview.scheduledAt,
          type: 'INTERVIEW_SCHEDULED',
          summary: `Interview scheduled with ${interview.intervieweeName} (${interview.intervieweeType})`,
          details: { interviewId: interview.id, status: interview.status },
        });
      }
      if (interview.conductedAt) {
        timeline.push({
          timestamp: interview.conductedAt,
          type: 'INTERVIEW_CONDUCTED',
          summary: `Interview conducted with ${interview.intervieweeName} by ${interview.conductedBy.name}`,
          details: { interviewId: interview.id, riskIndicators: interview.riskIndicators },
        });
      }
    }

    // Safety plans
    for (const plan of report.safetyPlans) {
      timeline.push({
        timestamp: plan.createdAt,
        type: 'SAFETY_PLAN_CREATED',
        summary: `${plan.planType} safety plan created by ${plan.createdBy.name}`,
        details: { planId: plan.id, status: plan.status },
      });
    }

    // Linked tips
    for (const link of report.linkedTips) {
      timeline.push({
        timestamp: link.linkedAt,
        type: 'TIP_LINKED',
        summary: `${link.tipSource} tip linked to case`,
        details: { tipId: link.tipId, tipSource: link.tipSource },
      });
    }

    // Status changes from audit log
    const auditEntries = await fastify.prisma.auditLog.findMany({
      where: {
        entity: 'ThreatReport',
        entityId: report.id,
        action: { in: ['THREAT_REPORT_UPDATED', 'THREAT_REPORT_CREATED'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const entry of auditEntries) {
      if (entry.action === 'THREAT_REPORT_UPDATED') {
        timeline.push({
          timestamp: entry.createdAt,
          type: 'STATUS_CHANGE',
          summary: `Report updated`,
          details: entry.details,
        });
      }
    }

    // Sort chronologically
    timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      report: {
        id: report.id,
        subjectName: report.subjectName,
        category: report.category,
        riskLevel: report.riskLevel,
        status: report.status,
        createdAt: report.createdAt,
      },
      timeline,
      summary: {
        teamMemberCount: report.teamMembers.length,
        noteCount: filteredNotes.length,
        interviewCount: report.interviews.length,
        safetyPlanCount: report.safetyPlans.length,
        linkedTipCount: report.linkedTips.length,
      },
    };
  });
};

export default threatAssessmentWorkflowRoutes;
