import type { FastifyPluginAsync } from 'fastify';
import { VisitorService, ConsoleScreeningAdapter, BadgeKioskClient } from '@safeschool/visitor-mgmt';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText, isValidDateString } from '../utils/sanitize.js';
import { randomUUID } from 'crypto';

const visitorRoutes: FastifyPluginAsync = async (fastify) => {
  const screeningAdapter = new ConsoleScreeningAdapter();
  const visitorService = new VisitorService(fastify.prisma, screeningAdapter);

  // POST /api/v1/visitors — Pre-register a visitor
  fastify.post<{
    Body: {
      firstName: string;
      lastName: string;
      purpose: string;
      destination: string;
      hostUserId?: string;
      idType?: string;
      idNumberHash?: string;
      photo?: string;
      email?: string;
      phone?: string;
      visitorType?: string;
      scheduledAt?: string;
      companyName?: string;
      notes?: string;
      allowedZoneIds?: string[];
    };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const firstName = sanitizeText(request.body.firstName);
    const lastName = sanitizeText(request.body.lastName);
    const purpose = sanitizeText(request.body.purpose);
    const destination = sanitizeText(request.body.destination);
    const { hostUserId, idType, idNumberHash, photo, email, phone, visitorType, scheduledAt, companyName, notes, allowedZoneIds } = request.body;

    if (!firstName || !lastName || !purpose || !destination) {
      return reply.code(400).send({ error: 'firstName, lastName, purpose, and destination are required' });
    }

    // Check ban list
    const banMatch = await fastify.prisma.visitorBan.findFirst({
      where: {
        siteId,
        isActive: true,
        firstName: { equals: firstName, mode: 'insensitive' },
        lastName: { equals: lastName, mode: 'insensitive' },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    if (banMatch) {
      await fastify.prisma.auditLog.create({
        data: {
          siteId,
          userId: request.jwtUser.id,
          action: 'BANNED_VISITOR_ATTEMPT',
          entity: 'VisitorBan',
          entityId: banMatch.id,
          details: { firstName, lastName, reason: banMatch.reason },
          ipAddress: request.ip,
        },
      });
      fastify.wsManager.broadcastToSite(siteId, 'visitor:banned-attempt', {
        firstName,
        lastName,
        reason: banMatch.reason,
        banId: banMatch.id,
      });
      return reply.code(403).send({
        error: 'Visitor is on the ban list',
        reason: banMatch.reason,
        banId: banMatch.id,
      });
    }

    const qrToken = randomUUID();

    const visitor = await fastify.prisma.visitor.create({
      data: {
        siteId,
        firstName,
        lastName,
        purpose,
        destination,
        hostUserId,
        idType,
        idNumberHash,
        photo,
        email: email || null,
        phone: phone || null,
        visitorType: (visitorType as any) || 'VISITOR',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        companyName: companyName ? sanitizeText(companyName) : null,
        notes: notes ? sanitizeText(notes) : null,
        allowedZoneIds: allowedZoneIds || [],
        qrToken,
        status: 'PRE_REGISTERED',
      },
    });

    // Enqueue QR notification if email or phone provided
    if (email || phone) {
      try {
        const { Queue } = await import('bullmq');
        const ioredis = await import('ioredis');
        const Redis = (ioredis as any).default ?? ioredis;
        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        const conn = new Redis(redisUrl, { maxRetriesPerRequest: null });
        const queue = new Queue('alert-processing', { connection: conn as any });
        await queue.add('visitor-qr-notification', {
          visitorId: visitor.id,
          siteId,
          firstName,
          lastName,
          email,
          phone,
          qrToken,
          purpose,
          destination,
          scheduledAt,
        });
        await queue.close();
        conn.disconnect();
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to enqueue visitor QR notification');
      }
    }

    await fastify.prisma.auditLog.create({
      data: {
        siteId,
        userId: request.jwtUser.id,
        action: 'VISITOR_PRE_REGISTERED',
        entity: 'Visitor',
        entityId: visitor.id,
        details: { firstName, lastName, purpose, destination },
        ipAddress: request.ip,
      },
    });

    return reply.code(201).send(visitor);
  });

  // POST /api/v1/visitors/public-preregister — Public pre-registration (no auth)
  fastify.post<{
    Body: {
      siteId: string;
      firstName: string;
      lastName: string;
      purpose: string;
      destination: string;
      email?: string;
      phone?: string;
      visitorType?: string;
      scheduledAt?: string;
      companyName?: string;
    };
  }>(
    '/public-preregister',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { siteId } = request.body;
      if (!siteId) return reply.code(400).send({ error: 'siteId is required' });

      // Check site exists and public pre-reg is enabled
      const settings = await fastify.prisma.siteVisitorSettings.findUnique({ where: { siteId } });
      if (!settings?.publicPreRegEnabled) {
        return reply.code(403).send({ error: 'Public pre-registration is not enabled for this site' });
      }

      const firstName = sanitizeText(request.body.firstName);
      const lastName = sanitizeText(request.body.lastName);
      const purpose = sanitizeText(request.body.purpose);
      const destination = sanitizeText(request.body.destination);

      if (!firstName || !lastName || !purpose || !destination) {
        return reply.code(400).send({ error: 'firstName, lastName, purpose, and destination are required' });
      }

      const qrToken = randomUUID();
      const visitor = await fastify.prisma.visitor.create({
        data: {
          siteId,
          firstName,
          lastName,
          purpose,
          destination,
          email: request.body.email || null,
          phone: request.body.phone || null,
          visitorType: (request.body.visitorType as any) || 'VISITOR',
          scheduledAt: request.body.scheduledAt ? new Date(request.body.scheduledAt) : null,
          companyName: request.body.companyName ? sanitizeText(request.body.companyName) : null,
          qrToken,
          status: 'PRE_REGISTERED',
        },
      });

      // Enqueue QR notification
      if (request.body.email || request.body.phone) {
        try {
          const { Queue } = await import('bullmq');
          const ioredis = await import('ioredis');
        const Redis = (ioredis as any).default ?? ioredis;
          const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
          const conn = new Redis(redisUrl, { maxRetriesPerRequest: null });
          const queue = new Queue('alert-processing', { connection: conn as any });
          await queue.add('visitor-qr-notification', {
            visitorId: visitor.id,
            siteId,
            firstName,
            lastName,
            email: request.body.email,
            phone: request.body.phone,
            qrToken,
            purpose,
            destination,
            scheduledAt: request.body.scheduledAt,
          });
          await queue.close();
          conn.disconnect();
        } catch (err) {
          fastify.log.warn({ err }, 'Failed to enqueue visitor QR notification');
        }
      }

      return reply.code(201).send({ id: visitor.id, qrToken });
    },
  );

  // GET /api/v1/visitors/qr/:qrToken — Lookup by QR token (no auth, kiosk use)
  fastify.get<{ Params: { qrToken: string } }>('/qr/:qrToken', async (request, reply) => {
    const visitor = await fastify.prisma.visitor.findUnique({
      where: { qrToken: request.params.qrToken },
      include: { host: { select: { id: true, name: true } } },
    });

    if (!visitor) return reply.code(404).send({ error: 'Visitor not found' });
    if (visitor.status !== 'PRE_REGISTERED') {
      return reply.code(400).send({ error: 'Visitor already checked in or denied' });
    }

    return visitor;
  });

  // GET /api/v1/visitors/lookup — Find returning visitors by name
  fastify.get<{ Querystring: { q: string } }>(
    '/lookup',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request) => {
      const siteId = request.jwtUser.siteIds[0];
      if (!siteId || !request.query.q) return [];

      const query = request.query.q.trim();
      if (query.length < 2) return [];

      return fastify.prisma.visitor.findMany({
        where: {
          siteId,
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
          ],
        },
        distinct: ['firstName', 'lastName'],
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          companyName: true,
          visitorType: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    },
  );

  // POST /api/v1/visitors/:id/check-in
  fastify.post<{
    Params: { id: string };
    Body: {
      photo?: string;
      signature?: string;
      policyAckedAt?: string;
    };
  }>(
    '/:id/check-in',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      try {
        // Update photo/signature/policyAck before running check-in
        const extraData: any = {};
        if (request.body?.photo) extraData.photo = request.body.photo;
        if (request.body?.signature) extraData.signature = request.body.signature;
        if (request.body?.policyAckedAt) extraData.policyAckedAt = new Date(request.body.policyAckedAt);

        if (Object.keys(extraData).length > 0) {
          await fastify.prisma.visitor.update({
            where: { id: request.params.id },
            data: extraData,
          });
        }

        const visitor = await visitorService.checkIn(request.params.id, request.ip);
        fastify.wsManager.broadcastToSite(visitor.siteId, 'visitor:checked-in', visitor);

        // Host notification
        if (visitor.hostUserId) {
          try {
            const settings = await fastify.prisma.siteVisitorSettings.findUnique({
              where: { siteId: visitor.siteId },
            });
            if (settings?.hostNotificationEnabled) {
              const { Queue } = await import('bullmq');
              const ioredis = await import('ioredis');
        const Redis = (ioredis as any).default ?? ioredis;
              const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
              const conn = new Redis(redisUrl, { maxRetriesPerRequest: null });
              const queue = new Queue('alert-processing', { connection: conn as any });
              await queue.add('host-notify', {
                visitorId: visitor.id,
                siteId: visitor.siteId,
                hostUserId: visitor.hostUserId,
                visitorName: `${visitor.firstName} ${visitor.lastName}`,
                purpose: visitor.purpose,
                destination: visitor.destination,
                visitorType: visitor.visitorType,
              });
              await queue.close();
              conn.disconnect();
            }
          } catch (err) {
            fastify.log.warn({ err }, 'Failed to enqueue host notification');
          }
        }

        // BadgeKiosk integration: auto-sync and auto-print
        let badgePrinted = false;
        let printJobId: string | null = null;
        try {
          const bkIntegration = await fastify.prisma.badgeKioskIntegration.findUnique({
            where: { siteId: visitor.siteId },
          });

          if (bkIntegration?.enabled && visitor.status === 'CHECKED_IN') {
            const bkClient = new BadgeKioskClient({
              apiUrl: bkIntegration.apiUrl,
              apiKey: bkIntegration.apiKey,
            });

            if (bkIntegration.autoSync) {
              const cardholder = await bkClient.createCardholder({
                firstName: visitor.firstName,
                lastName: visitor.lastName,
                destination: visitor.destination,
                badgeNumber: visitor.badgeNumber || undefined,
                photo: visitor.photo || undefined,
              });

              if (
                bkIntegration.autoPrint &&
                bkIntegration.defaultTemplate &&
                bkIntegration.defaultPrinter
              ) {
                const printJob = await bkClient.submitPrintJob(
                  bkIntegration.defaultTemplate,
                  cardholder.id,
                  bkIntegration.defaultPrinter,
                );
                badgePrinted = true;
                printJobId = printJob.id;
              }
            }
          }
        } catch (bkErr) {
          fastify.log.warn({ err: bkErr, visitorId: visitor.id }, 'BadgeKiosk sync/print failed');
        }

        return { ...visitor, badgePrinted, printJobId };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Check-in failed';
        return reply.code(400).send({ error: message });
      }
    },
  );

  // POST /api/v1/visitors/:id/check-out
  fastify.post<{ Params: { id: string } }>(
    '/:id/check-out',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      try {
        const visitor = await visitorService.checkOut(request.params.id, request.ip);
        fastify.wsManager.broadcastToSite(visitor.siteId, 'visitor:checked-out', visitor);
        return visitor;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Check-out failed';
        return reply.code(400).send({ error: message });
      }
    },
  );

  // GET /api/v1/visitors — List visitors with filters
  fastify.get<{
    Querystring: { siteId?: string; status?: string; date?: string; limit?: string; groupId?: string };
  }>('/', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const { siteId, status, date, limit, groupId } = request.query;

    const where: any = {};
    if (siteId) where.siteId = siteId;
    else where.siteId = { in: request.jwtUser.siteIds };
    if (status) where.status = status;
    if (groupId) where.groupId = groupId;
    if (date) {
      if (!isValidDateString(date)) {
        return [];
      }
      const start = new Date(date);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);
      where.createdAt = { gte: start, lt: end };
    }

    return fastify.prisma.visitor.findMany({
      where,
      include: { screening: true, host: true, group: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit || '50'), 100),
    });
  });

  // GET /api/v1/visitors/active — Currently checked-in visitors
  fastify.get('/active', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return [];
    return visitorService.getActiveVisitors(siteId);
  });

  // POST /api/v1/visitors/group — Create visitor group
  fastify.post<{
    Body: {
      name: string;
      purpose?: string;
      hostUserId?: string;
      scheduledAt?: string;
      visitors: { firstName: string; lastName: string; visitorType?: string }[];
    };
  }>('/group', { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] }, async (request, reply) => {
    const siteId = request.jwtUser.siteIds[0];
    if (!siteId) return reply.code(403).send({ error: 'No site access' });

    const { name, purpose, hostUserId, scheduledAt, visitors } = request.body;
    if (!name || !visitors?.length) {
      return reply.code(400).send({ error: 'name and visitors array are required' });
    }

    const group = await fastify.prisma.visitorGroup.create({
      data: {
        siteId,
        name: sanitizeText(name),
        purpose: purpose ? sanitizeText(purpose) : null,
        hostUserId,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        totalCount: visitors.length,
      },
    });

    // Create individual visitors
    for (const v of visitors) {
      await fastify.prisma.visitor.create({
        data: {
          siteId,
          firstName: sanitizeText(v.firstName),
          lastName: sanitizeText(v.lastName),
          purpose: purpose || 'Group Visit',
          destination: name,
          visitorType: (v.visitorType as any) || 'VISITOR',
          groupId: group.id,
          hostUserId,
          qrToken: randomUUID(),
          status: 'PRE_REGISTERED',
        },
      });
    }

    const result = await fastify.prisma.visitorGroup.findUnique({
      where: { id: group.id },
      include: { visitors: true, host: true },
    });

    return reply.code(201).send(result);
  });

  // GET /api/v1/visitors/group/:groupId — Get group with visitors
  fastify.get<{ Params: { groupId: string } }>(
    '/group/:groupId',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const group = await fastify.prisma.visitorGroup.findUnique({
        where: { id: request.params.groupId },
        include: { visitors: { include: { screening: true } }, host: true },
      });
      if (!group) return reply.code(404).send({ error: 'Group not found' });
      return group;
    },
  );

  // POST /api/v1/visitors/group/:groupId/bulk-checkin — Bulk check-in group
  fastify.post<{ Params: { groupId: string }; Body: { visitorIds?: string[] } }>(
    '/group/:groupId/bulk-checkin',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const group = await fastify.prisma.visitorGroup.findUnique({
        where: { id: request.params.groupId },
        include: { visitors: true },
      });
      if (!group) return reply.code(404).send({ error: 'Group not found' });

      const targetIds = request.body?.visitorIds || group.visitors.map((v) => v.id);
      const results: { id: string; status: string; error?: string }[] = [];

      for (const visitorId of targetIds) {
        try {
          const visitor = await visitorService.checkIn(visitorId, request.ip);
          fastify.wsManager.broadcastToSite(visitor.siteId, 'visitor:checked-in', visitor);
          results.push({ id: visitor.id, status: visitor.status });
        } catch (err) {
          results.push({ id: visitorId, status: 'ERROR', error: err instanceof Error ? err.message : 'Failed' });
        }
      }

      return { groupId: group.id, results };
    },
  );

  // GET /api/v1/visitors/:id — Visitor detail + screening
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const visitor = await visitorService.getVisitor(request.params.id);
      if (!visitor) return reply.code(404).send({ error: 'Visitor not found' });
      return visitor;
    },
  );
  // PUT /api/v1/visitors/:id/zones — Set allowed zone IDs for a visitor
  fastify.put<{
    Params: { id: string };
    Body: { allowedZoneIds: string[] };
  }>(
    '/:id/zones',
    { preHandler: [fastify.authenticate, requireMinRole('OPERATOR')] },
    async (request, reply) => {
      const visitor = await fastify.prisma.visitor.findUnique({
        where: { id: request.params.id },
        select: { id: true, firstName: true, lastName: true, siteId: true },
      });
      if (!visitor) return reply.code(404).send({ error: 'Visitor not found' });

      const { allowedZoneIds } = request.body;
      if (!Array.isArray(allowedZoneIds)) {
        return reply.code(400).send({ error: 'allowedZoneIds must be an array' });
      }

      // Validate zone IDs exist
      if (allowedZoneIds.length > 0) {
        const zones = await fastify.prisma.accessZone.findMany({
          where: { id: { in: allowedZoneIds }, siteId: visitor.siteId },
          select: { id: true },
        });
        if (zones.length !== allowedZoneIds.length) {
          return reply.code(400).send({ error: 'One or more zone IDs are invalid' });
        }
      }

      const updated = await fastify.prisma.visitor.update({
        where: { id: request.params.id },
        data: { allowedZoneIds },
      });

      await fastify.prisma.auditLog.create({
        data: {
          siteId: visitor.siteId,
          userId: request.jwtUser.id,
          action: 'VISITOR_ZONES_UPDATED',
          entity: 'Visitor',
          entityId: visitor.id,
          details: {
            visitorName: `${visitor.firstName} ${visitor.lastName}`,
            zoneCount: allowedZoneIds.length,
            zoneIds: allowedZoneIds,
          },
          ipAddress: request.ip,
        },
      });

      return { id: updated.id, allowedZoneIds: updated.allowedZoneIds };
    },
  );
};

export default visitorRoutes;
