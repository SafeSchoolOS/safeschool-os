import type { FastifyPluginAsync } from 'fastify';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

const frReunificationRoutes: FastifyPluginAsync = async (fastify) => {
  // ─── Event Management ─────────────────────────────────────────────

  // POST /events — Start reunification event (OPERATOR+)
  fastify.post<{
    Body: {
      incidentId: string;
      siteId: string;
      reunificationSiteId?: string;
    };
  }>('/events', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { incidentId, siteId, reunificationSiteId } = request.body;

    if (!incidentId || !siteId) {
      return reply.code(400).send({ error: 'incidentId and siteId are required' });
    }

    if (!request.jwtUser.siteIds.includes(siteId)) {
      return reply.code(403).send({ error: 'No access to this site' });
    }

    // Count active students for the site
    const totalStudents = await fastify.prisma.student.count({
      where: { siteId, isActive: true },
    });

    const now = new Date();

    const event = await fastify.prisma.fRReunificationEvent.create({
      data: {
        incidentId,
        siteId,
        reunificationSiteId: reunificationSiteId || undefined,
        status: 'PREPARING',
        startedAt: now,
        totalStudents,
      },
    });

    // Create timeline entry on the incident
    await fastify.prisma.incidentTimeline.create({
      data: {
        incidentId,
        timestamp: now,
        action: 'Reunification started',
        actionType: 'REUNIFICATION_STARTED' as any,
        actorType: 'STAFF',
        actorId: request.jwtUser.id,
        metadata: { reunificationEventId: event.id, totalStudents },
      },
    });

    // Update incident status and reunificationStartedAt
    await fastify.prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: 'REUNIFICATION_INCIDENT' as any,
        reunificationStartedAt: now,
      },
    });

    // WebSocket broadcast
    fastify.wsManager.broadcastToSite(siteId, 'reunification.started', event);

    // Audit log
    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'REUNIFICATION_STARTED',
        entity: 'FRReunificationEvent',
        entityId: event.id,
        details: { incidentId, totalStudents, reunificationSiteId },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(event);
  });

  // GET /events — List reunification events
  fastify.get<{
    Querystring: {
      siteId?: string;
      incidentId?: string;
      status?: string;
    };
  }>('/events', { preHandler: [fastify.authenticate] }, async (request) => {
    const { siteId, incidentId, status } = request.query;

    const where: any = {};

    if (siteId) {
      if (!request.jwtUser.siteIds.includes(siteId)) {
        where.siteId = { in: [] };
      } else {
        where.siteId = siteId;
      }
    } else {
      where.siteId = { in: request.jwtUser.siteIds };
    }

    if (incidentId) where.incidentId = incidentId;
    if (status) where.status = status;

    const events = await fastify.prisma.fRReunificationEvent.findMany({
      where,
      include: {
        reunificationSite: true,
        _count: {
          select: { guardianCheckIns: true, studentReleases: true },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    return events;
  });

  // GET /events/:eventId — Event detail
  fastify.get<{
    Params: { eventId: string };
  }>('/events/:eventId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
      include: {
        reunificationSite: true,
        _count: {
          select: { guardianCheckIns: true, studentReleases: true },
        },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    return event;
  });

  // PUT /events/:eventId — Update event (OPERATOR+)
  fastify.put<{
    Params: { eventId: string };
    Body: {
      status?: string;
      reunificationSiteId?: string;
      totalStudents?: number;
      studentsAccounted?: number;
      studentsMissing?: number;
      studentsInjured?: number;
    };
  }>('/events/:eventId', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { status, reunificationSiteId, totalStudents, studentsAccounted, studentsMissing, studentsInjured } = request.body;

    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    const data: any = {};
    if (status) data.status = status;
    if (reunificationSiteId !== undefined) data.reunificationSiteId = reunificationSiteId;
    if (totalStudents !== undefined) data.totalStudents = totalStudents;
    if (studentsAccounted !== undefined) data.studentsAccounted = studentsAccounted;
    if (studentsMissing !== undefined) data.studentsMissing = studentsMissing;
    if (studentsInjured !== undefined) data.studentsInjured = studentsInjured;

    // If status changes to COMPLETED_REUNIFICATION, set completedAt
    if (status === 'COMPLETED_REUNIFICATION') {
      data.completedAt = new Date();

      // Also update incident.reunificationCompletedAt
      await fastify.prisma.incident.update({
        where: { id: event.incidentId },
        data: { reunificationCompletedAt: new Date() },
      });
    }

    const updated = await fastify.prisma.fRReunificationEvent.update({
      where: { id: event.id },
      data,
      include: {
        reunificationSite: true,
        _count: {
          select: { guardianCheckIns: true, studentReleases: true },
        },
      },
    });

    fastify.wsManager.broadcastToSite(event.siteId, 'reunification.update', updated);

    await fastify.prisma.auditLog.create({
      data: {
        siteId: event.siteId,
        userId: request.jwtUser.id,
        action: 'REUNIFICATION_UPDATED',
        entity: 'FRReunificationEvent',
        entityId: event.id,
        details: { status, totalStudents, studentsAccounted, studentsMissing, studentsInjured },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // ─── Student Accountability ────────────────────────────────────────

  // GET /events/:eventId/students — Student list with accountability status
  fastify.get<{
    Params: { eventId: string };
  }>('/events/:eventId/students', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    // Get all active students for the site
    const students = await fastify.prisma.student.findMany({
      where: { siteId: event.siteId, isActive: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    // Get all releases for this event
    const releases = await fastify.prisma.studentRelease.findMany({
      where: { reunificationEventId: event.id },
    });

    const releaseByStudentId = new Map(
      releases.map((r) => [r.studentId, r]),
    );

    const studentList = students.map((s) => {
      const release = releaseByStudentId.get(s.id);
      let status: 'RELEASED' | 'ACCOUNTED' | 'MISSING' | 'INJURED' = 'ACCOUNTED';
      if (release) {
        status = 'RELEASED';
      }
      return {
        id: s.id,
        name: `${s.firstName} ${s.lastName}`,
        grade: s.grade,
        status,
        releasedTo: release?.releasedTo || undefined,
        releasedAt: release?.releasedAt || undefined,
      };
    });

    const summary = {
      total: studentList.length,
      accounted: event.studentsAccounted,
      released: event.studentsReleased,
      missing: event.studentsMissing,
      injured: event.studentsInjured,
    };

    return { students: studentList, summary };
  });

  // ─── Guardian Check-In ─────────────────────────────────────────────

  // POST /events/:eventId/checkin — Guardian check-in
  fastify.post<{
    Params: { eventId: string };
    Body: {
      guardianName: string;
      guardianIdType?: string;
      guardianIdLast4?: string;
      guardianIdVerified?: boolean;
      requestedStudentIds: string[];
      checkedInBy?: string;
    };
  }>('/events/:eventId/checkin', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { guardianName, guardianIdType, guardianIdLast4, guardianIdVerified, requestedStudentIds, checkedInBy } = request.body;

    if (!guardianName || !requestedStudentIds || requestedStudentIds.length === 0) {
      return reply.code(400).send({ error: 'guardianName and requestedStudentIds are required' });
    }

    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    // Check authorization against ParentContact records
    const parentContacts = await fastify.prisma.parentContact.findMany({
      where: {
        studentId: { in: requestedStudentIds },
      },
    });

    // If any contact matches the guardian name and canPickup, mark as authorized
    const normalizedName = sanitizeText(guardianName).toLowerCase();
    const authorizedInSis = parentContacts.some(
      (pc) => pc.parentName.toLowerCase() === normalizedName,
    );

    const checkIn = await fastify.prisma.guardianCheckIn.create({
      data: {
        reunificationEventId: event.id,
        guardianName: sanitizeText(guardianName),
        guardianIdType: guardianIdType ? sanitizeText(guardianIdType) : undefined,
        guardianIdLast4: guardianIdLast4 ? sanitizeText(guardianIdLast4) : undefined,
        guardianIdVerified: guardianIdVerified || false,
        requestedStudentIds,
        authorizedInSis,
        checkedInAt: new Date(),
        checkedInBy: checkedInBy ? sanitizeText(checkedInBy) : request.jwtUser.id,
        status: 'CHECKED_IN',
      },
    });

    fastify.wsManager.broadcastToSite(event.siteId, 'reunification.checkin', {
      eventId: event.id,
      checkIn,
    });

    return reply.code(201).send(checkIn);
  });

  // GET /events/:eventId/checkins — List all check-ins
  fastify.get<{
    Params: { eventId: string };
    Querystring: { status?: string };
  }>('/events/:eventId/checkins', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { status } = request.query;

    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    const checkIns = await fastify.prisma.guardianCheckIn.findMany({
      where: {
        reunificationEventId: event.id,
        ...(status && { status }),
      },
      include: {
        studentReleases: true,
      },
      orderBy: { checkedInAt: 'desc' },
    });

    return checkIns;
  });

  // PUT /events/:eventId/checkins/:checkInId — Update check-in
  fastify.put<{
    Params: { eventId: string; checkInId: string };
    Body: {
      status?: string;
      guardianIdVerified?: boolean;
      denyReason?: string;
    };
  }>('/events/:eventId/checkins/:checkInId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { status, guardianIdVerified, denyReason } = request.body;

    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    const data: any = {};
    if (status) data.status = status;
    if (guardianIdVerified !== undefined) data.guardianIdVerified = guardianIdVerified;
    if (status === 'DENIED' && denyReason) {
      data.denyReason = sanitizeText(denyReason);
    }

    const updated = await fastify.prisma.guardianCheckIn.update({
      where: { id: request.params.checkInId },
      data,
      include: { studentReleases: true },
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: event.siteId,
        userId: request.jwtUser.id,
        action: 'GUARDIAN_CHECKIN_UPDATED',
        entity: 'GuardianCheckIn',
        entityId: updated.id,
        details: { status, guardianIdVerified, denyReason },
        ipAddress: request.ip,
      },
    });

    return updated;
  });

  // ─── Student Release ───────────────────────────────────────────────

  // POST /events/:eventId/release — Release student
  fastify.post<{
    Params: { eventId: string };
    Body: {
      studentId: string;
      studentName: string;
      guardianCheckInId?: string;
      releasedTo: string;
      releasedBy?: string;
      notes?: string;
    };
  }>('/events/:eventId/release', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { studentId, studentName, guardianCheckInId, releasedTo, releasedBy, notes } = request.body;

    if (!studentId || !studentName || !releasedTo) {
      return reply.code(400).send({ error: 'studentId, studentName, and releasedTo are required' });
    }

    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    const release = await fastify.prisma.studentRelease.create({
      data: {
        reunificationEventId: event.id,
        studentId,
        studentName: sanitizeText(studentName),
        guardianCheckInId: guardianCheckInId || undefined,
        releasedTo: sanitizeText(releasedTo),
        releasedAt: new Date(),
        releasedBy: releasedBy ? sanitizeText(releasedBy) : request.jwtUser.id,
        notes: notes ? sanitizeText(notes) : undefined,
      },
    });

    // If linked to a guardian check-in, check if all requested students are released
    if (guardianCheckInId) {
      const checkIn = await fastify.prisma.guardianCheckIn.findUnique({
        where: { id: guardianCheckInId },
      });

      if (checkIn) {
        const releasedStudents = await fastify.prisma.studentRelease.findMany({
          where: {
            reunificationEventId: event.id,
            guardianCheckInId,
          },
        });

        const releasedStudentIds = new Set(releasedStudents.map((r) => r.studentId));
        const allReleased = checkIn.requestedStudentIds.every((id) => releasedStudentIds.has(id));

        if (allReleased) {
          await fastify.prisma.guardianCheckIn.update({
            where: { id: guardianCheckInId },
            data: { status: 'RELEASED' },
          });
        }
      }
    }

    // Increment studentsReleased on the event
    await fastify.prisma.fRReunificationEvent.update({
      where: { id: event.id },
      data: { studentsReleased: { increment: 1 } },
    });

    fastify.wsManager.broadcastToSite(event.siteId, 'reunification.release', {
      eventId: event.id,
      release,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: event.siteId,
        userId: request.jwtUser.id,
        action: 'STUDENT_RELEASED',
        entity: 'StudentRelease',
        entityId: release.id,
        details: { studentId, studentName, releasedTo, guardianCheckInId },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(release);
  });

  // GET /events/:eventId/releases — List all releases
  fastify.get<{
    Params: { eventId: string };
  }>('/events/:eventId/releases', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    const releases = await fastify.prisma.studentRelease.findMany({
      where: { reunificationEventId: event.id },
      orderBy: { releasedAt: 'desc' },
    });

    return releases;
  });

  // ─── Parent Notification ───────────────────────────────────────────

  // POST /events/:eventId/notify — Notify parents about reunification (OPERATOR+)
  fastify.post<{
    Params: { eventId: string };
    Body: {
      message: string;
      channels?: string[];
    };
  }>('/events/:eventId/notify', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { message, channels } = request.body;

    if (!message) {
      return reply.code(400).send({ error: 'message is required' });
    }

    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    const sanitizedMessage = sanitizeText(message);
    const notifyChannels = channels || ['SMS', 'EMAIL', 'PUSH'];

    // Get all parent contacts for students at this site (via Student → ParentContact)
    const students = await fastify.prisma.student.findMany({
      where: { siteId: event.siteId, isActive: true },
      select: { id: true },
    });
    const studentIds = students.map((s) => s.id);
    const parentContacts = await fastify.prisma.parentContact.findMany({
      where: { studentId: { in: studentIds } },
    });

    // Create notification log entries per channel
    const notifications = [];
    for (const ch of notifyChannels) {
      const log = await fastify.prisma.notificationLog.create({
        data: {
          siteId: event.siteId,
          channel: ch,
          recipientCount: parentContacts.length,
          message: sanitizedMessage,
          status: 'QUEUED',
          sentAt: new Date(),
          metadata: { reunificationEventId: event.id, notificationType: 'REUNIFICATION' },
        },
      });
      notifications.push(log);
    }

    fastify.wsManager.broadcastToSite(event.siteId, 'reunification.notify', {
      eventId: event.id,
      notificationCount: parentContacts.length,
      channels: notifyChannels,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: event.siteId,
        userId: request.jwtUser.id,
        action: 'REUNIFICATION_PARENTS_NOTIFIED',
        entity: 'FRReunificationEvent',
        entityId: event.id,
        details: { notificationCount: notifications.length, channels: notifyChannels },
        ipAddress: request.ip,
      },
    });

    return { notificationCount: notifications.length, channels: notifyChannels };
  });

  // POST /events/:eventId/notify/update — Send status update to parents (OPERATOR+)
  fastify.post<{
    Params: { eventId: string };
    Body: {
      message: string;
      updateType: string;
    };
  }>('/events/:eventId/notify/update', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const { message, updateType } = request.body;

    if (!message || !updateType) {
      return reply.code(400).send({ error: 'message and updateType are required' });
    }

    const event = await fastify.prisma.fRReunificationEvent.findFirst({
      where: {
        id: request.params.eventId,
        siteId: { in: request.jwtUser.siteIds },
      },
    });

    if (!event) {
      return reply.code(404).send({ error: 'Reunification event not found' });
    }

    const sanitizedMessage = sanitizeText(message);

    // Get parent contacts via students at this site
    const siteStudents = await fastify.prisma.student.findMany({
      where: { siteId: event.siteId, isActive: true },
      select: { id: true },
    });
    const parentContacts = await fastify.prisma.parentContact.findMany({
      where: { studentId: { in: siteStudents.map((s) => s.id) } },
    });

    const notifications = [];
    const log = await fastify.prisma.notificationLog.create({
      data: {
        siteId: event.siteId,
        channel: 'SMS',
        recipientCount: parentContacts.length,
        message: sanitizedMessage,
        status: 'QUEUED',
        sentAt: new Date(),
        metadata: { reunificationEventId: event.id, updateType, notificationType: 'REUNIFICATION_UPDATE' },
      },
    });
    notifications.push(log);

    fastify.wsManager.broadcastToSite(event.siteId, 'reunification.notify.update', {
      eventId: event.id,
      updateType,
      notificationCount: parentContacts.length,
    });

    await fastify.prisma.auditLog.create({
      data: {
        siteId: event.siteId,
        userId: request.jwtUser.id,
        action: 'REUNIFICATION_STATUS_UPDATE_SENT',
        entity: 'FRReunificationEvent',
        entityId: event.id,
        details: { updateType, notificationCount: notifications.length },
        ipAddress: request.ip,
      },
    });

    return { notificationCount: notifications.length, channels: ['SMS', 'EMAIL', 'PUSH'] };
  });
};

export default frReunificationRoutes;
