import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const VALID_ACTIONS = ['NOTIFY_ROLES', 'AUTO_LOCKDOWN', 'AUTO_DISPATCH', 'ESCALATE_LEVEL'];

export default async function escalationRoutes(app: FastifyInstance) {
  // All routes require authentication + SITE_ADMIN
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/escalation/rules/:siteId — list rules for a site
  app.get('/rules/:siteId', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { siteId } = request.params as { siteId: string };

    if (!user.siteIds.includes(siteId)) {
      return reply.status(403).send({ error: 'No access to this site' });
    }

    const rules = await app.prisma.escalationRule.findMany({
      where: { siteId },
      orderBy: [{ alertLevel: 'asc' }, { delayMinutes: 'asc' }],
    });

    return rules;
  });

  // POST /api/v1/escalation/rules/:siteId — create a rule
  app.post('/rules/:siteId', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { siteId } = request.params as { siteId: string };
    const body = request.body as {
      name: string;
      alertLevel: string;
      delayMinutes: number;
      action: string;
      targetRoles?: string[];
      targetLevel?: string;
      isActive?: boolean;
    };

    if (!user.siteIds.includes(siteId)) {
      return reply.status(403).send({ error: 'No access to this site' });
    }

    if (!body.name || !body.alertLevel || body.delayMinutes == null || !body.action) {
      return reply.status(400).send({ error: 'name, alertLevel, delayMinutes, and action are required' });
    }

    if (!VALID_ACTIONS.includes(body.action)) {
      return reply.status(400).send({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    if (body.action === 'ESCALATE_LEVEL' && !body.targetLevel) {
      return reply.status(400).send({ error: 'targetLevel is required for ESCALATE_LEVEL action' });
    }

    const rule = await app.prisma.escalationRule.create({
      data: {
        siteId,
        name: sanitizeText(body.name),
        alertLevel: body.alertLevel,
        delayMinutes: body.delayMinutes,
        action: body.action,
        targetRoles: body.targetRoles || [],
        targetLevel: body.targetLevel || null,
        isActive: body.isActive ?? true,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId,
        userId: user.id,
        action: 'ESCALATION_RULE_CREATED',
        entity: 'EscalationRule',
        entityId: rule.id,
        details: { name: body.name, alertLevel: body.alertLevel, action: body.action },
      },
    });

    return reply.status(201).send(rule);
  });

  // PUT /api/v1/escalation/rules/:ruleId — update a rule
  app.put('/rules/:ruleId', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { ruleId } = request.params as { ruleId: string };
    const body = request.body as {
      name?: string;
      alertLevel?: string;
      delayMinutes?: number;
      action?: string;
      targetRoles?: string[];
      targetLevel?: string;
      isActive?: boolean;
    };

    const existing = await app.prisma.escalationRule.findUnique({ where: { id: ruleId } });
    if (!existing) {
      return reply.status(404).send({ error: 'Rule not found' });
    }

    if (!user.siteIds.includes(existing.siteId)) {
      return reply.status(403).send({ error: 'No access to this site' });
    }

    if (body.action && !VALID_ACTIONS.includes(body.action)) {
      return reply.status(400).send({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    const effectiveAction = body.action ?? existing.action;
    if (effectiveAction === 'ESCALATE_LEVEL' && !body.targetLevel && !existing.targetLevel) {
      return reply.status(400).send({ error: 'targetLevel is required for ESCALATE_LEVEL action' });
    }

    const data: any = {};
    if (body.name !== undefined) data.name = sanitizeText(body.name);
    if (body.alertLevel !== undefined) data.alertLevel = body.alertLevel;
    if (body.delayMinutes !== undefined) data.delayMinutes = body.delayMinutes;
    if (body.action !== undefined) data.action = body.action;
    if (body.targetRoles !== undefined) data.targetRoles = body.targetRoles;
    if (body.targetLevel !== undefined) data.targetLevel = body.targetLevel;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const updated = await app.prisma.escalationRule.update({
      where: { id: ruleId },
      data,
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: user.id,
        action: 'ESCALATION_RULE_UPDATED',
        entity: 'EscalationRule',
        entityId: ruleId,
        details: data,
      },
    });

    return updated;
  });

  // DELETE /api/v1/escalation/rules/:ruleId — delete a rule
  app.delete('/rules/:ruleId', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { ruleId } = request.params as { ruleId: string };

    const existing = await app.prisma.escalationRule.findUnique({ where: { id: ruleId } });
    if (!existing) {
      return reply.status(404).send({ error: 'Rule not found' });
    }

    if (!user.siteIds.includes(existing.siteId)) {
      return reply.status(403).send({ error: 'No access to this site' });
    }

    await app.prisma.escalationRule.delete({ where: { id: ruleId } });

    await app.prisma.auditLog.create({
      data: {
        siteId: existing.siteId,
        userId: user.id,
        action: 'ESCALATION_RULE_DELETED',
        entity: 'EscalationRule',
        entityId: ruleId,
        details: { name: existing.name },
      },
    });

    return { success: true };
  });
}
