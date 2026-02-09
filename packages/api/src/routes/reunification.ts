import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export default async function reunificationRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/reunification — list reunification events
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { status } = request.query as { status?: string };

    const events = await app.prisma.reunificationEvent.findMany({
      where: {
        siteId: { in: user.siteIds },
        ...(status && { status: status as any }),
      },
      include: { _count: { select: { entries: true } } },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });

    return events;
  });

  // POST /api/v1/reunification — start a reunification event
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const body = request.body as {
      location: string;
      alertId?: string;
      totalStudents?: number;
    };

    if (!body.location) {
      return reply.status(400).send({ error: 'location is required' });
    }

    const event = await app.prisma.reunificationEvent.create({
      data: {
        siteId: user.siteIds[0],
        location: body.location,
        alertId: body.alertId,
        totalStudents: body.totalStudents || 0,
      },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: user.siteIds[0],
        userId: user.id,
        action: 'REUNIFICATION_STARTED',
        entity: 'ReunificationEvent',
        entityId: event.id,
        details: { location: body.location },
      },
    });

    return reply.status(201).send(event);
  });

  // GET /api/v1/reunification/:id — get event detail with entries
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { id } = request.params as { id: string };

    const event = await app.prisma.reunificationEvent.findFirst({
      where: { id, siteId: { in: user.siteIds } },
      include: {
        entries: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!event) return reply.status(404).send({ error: 'Event not found' });
    return event;
  });

  // POST /api/v1/reunification/:id/entries — add student to reunification
  app.post('/:id/entries', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { id } = request.params as { id: string };
    const body = request.body as {
      studentName: string;
      studentGrade?: string;
    };

    if (!body.studentName) {
      return reply.status(400).send({ error: 'studentName is required' });
    }

    const event = await app.prisma.reunificationEvent.findFirst({
      where: { id, siteId: { in: user.siteIds } },
    });

    if (!event) return reply.status(404).send({ error: 'Event not found' });

    const entry = await app.prisma.reunificationEntry.create({
      data: {
        eventId: id,
        studentName: body.studentName,
        studentGrade: body.studentGrade,
      },
    });

    return reply.status(201).send(entry);
  });

  // PATCH /api/v1/reunification/:eventId/entries/:entryId/release — release student to guardian
  app.patch('/:eventId/entries/:entryId/release', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { eventId, entryId } = request.params as { eventId: string; entryId: string };
    const body = request.body as {
      guardianName: string;
      guardianIdType?: string;
      guardianIdCheck?: boolean;
    };

    if (!body.guardianName) {
      return reply.status(400).send({ error: 'guardianName is required' });
    }

    const entry = await app.prisma.reunificationEntry.update({
      where: { id: entryId },
      data: {
        guardianName: body.guardianName,
        guardianIdType: body.guardianIdType,
        guardianIdCheck: body.guardianIdCheck || false,
        releasedAt: new Date(),
        releasedById: user.id,
        status: 'RELEASED',
      },
    });

    // Update reunified count
    await app.prisma.reunificationEvent.update({
      where: { id: eventId },
      data: { reunifiedCount: { increment: 1 } },
    });

    return entry;
  });

  // PATCH /api/v1/reunification/:id — complete/cancel event
  app.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[] };
    const { id } = request.params as { id: string };
    const body = request.body as { status: string };

    const event = await app.prisma.reunificationEvent.findFirst({
      where: { id, siteId: { in: user.siteIds } },
    });

    if (!event) return reply.status(404).send({ error: 'Event not found' });

    const data: any = { status: body.status };
    if (body.status === 'COMPLETED') data.completedAt = new Date();

    const updated = await app.prisma.reunificationEvent.update({
      where: { id },
      data,
      include: { _count: { select: { entries: true } } },
    });

    await app.prisma.auditLog.create({
      data: {
        siteId: event.siteId,
        userId: user.id,
        action: `REUNIFICATION_${body.status}`,
        entity: 'ReunificationEvent',
        entityId: id,
      },
    });

    return updated;
  });
}
