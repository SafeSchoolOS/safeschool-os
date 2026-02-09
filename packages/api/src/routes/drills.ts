import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

export default async function drillRoutes(app: FastifyInstance) {
  // All routes require authentication
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/drills — list drills for user's site
  app.get('/', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { status, type } = request.query as { status?: string; type?: string };

    const drills = await app.prisma.drill.findMany({
      where: {
        siteId: { in: user.siteIds },
        ...(status && { status: status as any }),
        ...(type && { type: type as any }),
      },
      include: { _count: { select: { participants: true } } },
      orderBy: { scheduledAt: 'desc' },
      take: 50,
    });

    return drills;
  });

  // POST /api/v1/drills — schedule a new drill
  app.post('/', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[]; role: string };
    const body = request.body as {
      type: string;
      scheduledAt: string;
      buildingId?: string;
      notes?: string;
    };

    if (!body.type || !body.scheduledAt) {
      return reply.status(400).send({ error: 'type and scheduledAt are required' });
    }

    const drill = await app.prisma.drill.create({
      data: {
        siteId: user.siteIds[0],
        type: body.type as any,
        scheduledAt: new Date(body.scheduledAt),
        initiatedById: user.id,
        buildingId: body.buildingId,
        notes: sanitizeText(body.notes),
      },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: user.siteIds[0],
        userId: user.id,
        action: 'DRILL_SCHEDULED',
        entity: 'Drill',
        entityId: drill.id,
        details: { type: body.type, scheduledAt: body.scheduledAt },
      },
    });

    return reply.status(201).send(drill);
  });

  // PATCH /api/v1/drills/:id — update drill status (start, complete, cancel)
  app.patch('/:id', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { id } = request.params as { id: string };
    const body = request.body as {
      status?: string;
      evacuationTimeS?: number;
      headCount?: number;
      issues?: any;
      complianceMet?: boolean;
      notes?: string;
    };

    const drill = await app.prisma.drill.findFirst({
      where: { id, siteId: { in: user.siteIds } },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });

    const data: any = {};
    if (body.status === 'IN_PROGRESS') data.startedAt = new Date();
    if (body.status === 'COMPLETED') data.completedAt = new Date();
    if (body.status) data.status = body.status;
    if (body.evacuationTimeS !== undefined) data.evacuationTimeS = body.evacuationTimeS;
    if (body.headCount !== undefined) data.headCount = body.headCount;
    if (body.issues !== undefined) data.issues = body.issues;
    if (body.complianceMet !== undefined) data.complianceMet = body.complianceMet;
    if (body.notes !== undefined) data.notes = sanitizeText(body.notes);

    const updated = await app.prisma.drill.update({
      where: { id },
      data,
      include: { participants: true },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: drill.siteId,
        userId: user.id,
        action: `DRILL_${body.status || 'UPDATED'}`,
        entity: 'Drill',
        entityId: id,
      },
    });

    return updated;
  });

  // GET /api/v1/drills/:id — get drill detail
  app.get('/:id', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { id } = request.params as { id: string };

    const drill = await app.prisma.drill.findFirst({
      where: { id, siteId: { in: user.siteIds } },
      include: { participants: true },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });
    return drill;
  });

  // POST /api/v1/drills/:id/participants — add participant to drill
  app.post('/:id/participants', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { id } = request.params as { id: string };
    const body = request.body as { name: string; role: string };

    const drill = await app.prisma.drill.findFirst({
      where: { id, siteId: { in: user.siteIds } },
    });

    if (!drill) return reply.status(404).send({ error: 'Drill not found' });

    const participant = await app.prisma.drillParticipant.create({
      data: { drillId: id, name: sanitizeText(body.name), role: sanitizeText(body.role) },
    });

    return reply.status(201).send(participant);
  });

  // PATCH /api/v1/drills/:drillId/participants/:participantId/checkin
  app.patch('/:drillId/participants/:participantId/checkin', { preHandler: [requireMinRole('SITE_ADMIN')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { drillId, participantId } = request.params as { drillId: string; participantId: string };

    const participant = await app.prisma.drillParticipant.update({
      where: { id: participantId },
      data: { checkedIn: true, checkedAt: new Date() },
    });

    return participant;
  });

  // GET /api/v1/drills/compliance/report — compliance summary
  app.get('/compliance/report', { preHandler: [requireMinRole('TEACHER')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { year } = request.query as { year?: string };
    const targetYear = parseInt(year || new Date().getFullYear().toString());

    const drills = await app.prisma.drill.findMany({
      where: {
        siteId: { in: user.siteIds },
        status: 'COMPLETED',
        completedAt: {
          gte: new Date(`${targetYear}-01-01`),
          lt: new Date(`${targetYear + 1}-01-01`),
        },
      },
      orderBy: { completedAt: 'asc' },
    });

    // Alyssa's Law minimum requirements
    const requirements = {
      LOCKDOWN: { required: 2, label: 'Lockdown Drills' },
      FIRE: { required: 2, label: 'Fire Drills' },
      EVACUATION: { required: 1, label: 'Evacuation Drills' },
      ACTIVE_THREAT: { required: 1, label: 'Active Threat Drills' },
    };

    const summary = Object.entries(requirements).map(([type, req]) => {
      const completed = drills.filter((d) => d.type === type).length;
      return {
        type,
        label: req.label,
        required: req.required,
        completed,
        compliant: completed >= req.required,
      };
    });

    return {
      year: targetYear,
      totalDrills: drills.length,
      requirements: summary,
      overallCompliant: summary.every((s) => s.compliant),
    };
  });
}
