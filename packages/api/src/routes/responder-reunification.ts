import type { FastifyPluginAsync } from 'fastify';
import { authenticateResponder } from '../middleware/responder-auth.js';

async function verifyEventAccess(prisma: any, agencyId: string, eventId: string) {
  const event = await prisma.fRReunificationEvent.findUnique({
    where: { id: eventId },
    include: { site: true },
  });
  if (!event) return null;

  const link = await prisma.schoolAgencyLink.findFirst({
    where: { agencyId, siteId: event.siteId, status: 'ACTIVE_LINK' },
  });
  if (!link) return null;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;

  return { event, link };
}

const responderReunificationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /reunification/events — List active reunification events for the responder's linked schools
  fastify.get('/reunification/events', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;

    // Get all active links for this agency
    const links = await fastify.prisma.schoolAgencyLink.findMany({
      where: {
        agencyId,
        status: 'ACTIVE_LINK',
      },
    });

    // Filter out expired links
    const activeLinks = links.filter(
      (link: any) => !link.expiresAt || new Date(link.expiresAt) >= new Date()
    );

    const linkedSiteIds = activeLinks.map((link: any) => link.siteId);

    const events = await fastify.prisma.fRReunificationEvent.findMany({
      where: {
        siteId: { in: linkedSiteIds },
      },
      include: {
        reunificationSite: true,
        _count: {
          select: {
            guardianCheckIns: true,
            studentReleases: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_REUNIFICATION_EVENTS',
        resourceType: 'FRReunificationEvent',
        resourceId: null,
        siteId: null,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return events;
  });

  // GET /reunification/events/:eventId — Event detail with stats and reunification site info
  fastify.get<{ Params: { eventId: string } }>('/reunification/events/:eventId', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { eventId } = request.params;

    const access = await verifyEventAccess(fastify.prisma, agencyId, eventId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this reunification event' });
    }

    const event = await fastify.prisma.fRReunificationEvent.findUnique({
      where: { id: eventId },
      include: {
        site: true,
        reunificationSite: true,
        _count: {
          select: {
            guardianCheckIns: true,
            studentReleases: true,
          },
        },
      },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_REUNIFICATION_DETAIL',
        resourceType: 'FRReunificationEvent',
        resourceId: eventId,
        siteId: access.event.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return event;
  });

  // GET /reunification/events/:eventId/students — Student accountability status
  fastify.get<{ Params: { eventId: string } }>('/reunification/events/:eventId/students', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { eventId } = request.params;

    const access = await verifyEventAccess(fastify.prisma, agencyId, eventId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this reunification event' });
    }

    // Get active students for the event's site
    const students = await fastify.prisma.student.findMany({
      where: { siteId: access.event.siteId, isActive: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    // Get all student releases for this event
    const releases = await fastify.prisma.studentRelease.findMany({
      where: { reunificationEventId: eventId },
    });

    const releasedStudentIds = new Set(releases.map((r: any) => r.studentId));

    const studentsWithStatus = students.map((student: any) => ({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      grade: student.grade,
      released: releasedStudentIds.has(student.id),
    }));

    const total = students.length;
    const released = releasedStudentIds.size;
    const accounted = access.event.studentsAccounted ?? 0;
    const missing = access.event.studentsMissing ?? 0;
    const injured = access.event.studentsInjured ?? 0;

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_REUNIFICATION_STUDENTS',
        resourceType: 'Student',
        resourceId: eventId,
        siteId: access.event.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return {
      students: studentsWithStatus,
      summary: {
        total,
        accounted,
        released,
        missing,
        injured,
      },
    };
  });

  // GET /reunification/events/:eventId/checkins — List guardian check-ins
  fastify.get<{ Params: { eventId: string }; Querystring: { status?: string } }>('/reunification/events/:eventId/checkins', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { eventId } = request.params;
    const { status } = request.query;

    const access = await verifyEventAccess(fastify.prisma, agencyId, eventId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this reunification event' });
    }

    const where: any = { reunificationEventId: eventId };
    if (status) {
      where.status = status;
    }

    const checkIns = await fastify.prisma.guardianCheckIn.findMany({
      where,
      include: {
        studentReleases: true,
      },
      orderBy: { checkedInAt: 'desc' },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_REUNIFICATION_CHECKINS',
        resourceType: 'GuardianCheckIn',
        resourceId: eventId,
        siteId: access.event.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return checkIns;
  });

  // GET /reunification/events/:eventId/releases — List student releases
  fastify.get<{ Params: { eventId: string } }>('/reunification/events/:eventId/releases', { preHandler: [authenticateResponder] }, async (request, reply) => {
    const agencyId = request.responderUser!.agencyId;
    const { eventId } = request.params;

    const access = await verifyEventAccess(fastify.prisma, agencyId, eventId);
    if (!access) {
      return reply.code(403).send({ error: 'No access to this reunification event' });
    }

    const releases = await fastify.prisma.studentRelease.findMany({
      where: { reunificationEventId: eventId },
      orderBy: { releasedAt: 'desc' },
    });

    await fastify.prisma.responderAuditLog.create({
      data: {
        responderUserId: request.responderUser!.id,
        action: 'VIEW_REUNIFICATION_RELEASES',
        resourceType: 'StudentRelease',
        resourceId: eventId,
        siteId: access.event.siteId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || '',
      },
    });

    return releases;
  });
};

export default responderReunificationRoutes;
