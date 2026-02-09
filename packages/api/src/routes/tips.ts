import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { requireMinRole } from '../middleware/rbac.js';
import { sanitizeText } from '../utils/sanitize.js';

export default async function tipRoutes(app: FastifyInstance) {
  // POST /api/v1/tips — submit anonymous tip (NO auth required)
  // Strict rate limit: 3 tips per minute per IP (unauthenticated endpoint)
  app.post('/', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      siteId: string;
      category: string;
      message: string;
      severity?: string;
      contactInfo?: string;
    };

    if (!body.siteId || !body.category || !body.message) {
      return reply.status(400).send({ error: 'siteId, category, and message are required' });
    }

    // Sanitize user inputs (unauthenticated endpoint — high XSS risk)
    const message = sanitizeText(body.message);
    const category = sanitizeText(body.category);

    if (message.length < 10) {
      return reply.status(400).send({ error: 'Message must be at least 10 characters' });
    }

    // Hash the IP for analytics without storing PII
    const ip = request.ip || 'unknown';
    const ipHash = createHash('sha256').update(ip + process.env.JWT_SECRET).digest('hex').slice(0, 16);

    const tip = await app.prisma.anonymousTip.create({
      data: {
        siteId: body.siteId,
        category: category as any,
        message,
        severity: (body.severity as any) || 'LOW',
        contactInfo: body.contactInfo,
        ipHash,
      },
    });

    // Notify site admins for HIGH/CRITICAL tips
    if (body.severity === 'HIGH' || body.severity === 'CRITICAL') {
      try {
        await app.alertQueue.add('tip-notification', {
          tipId: tip.id,
          siteId: body.siteId,
          severity: body.severity,
          category: body.category,
        });
      } catch {
        // Non-blocking — tip is saved even if notification fails
      }
    }

    await app.prisma.auditLog.create({
      data: {
        siteId: body.siteId,
        action: 'TIP_SUBMITTED',
        entity: 'AnonymousTip',
        entityId: tip.id,
        details: { category: body.category, severity: body.severity || 'LOW' },
      },
    });

    return reply.status(201).send({
      id: tip.id,
      message: 'Tip submitted successfully. Thank you for helping keep our school safe.',
    });
  });

  // ---- Below routes require auth ----
  app.register(async function authedRoutes(authedApp) {
    authedApp.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      await request.jwtVerify();
    });

    // GET /api/v1/tips — list tips (admin only)
    authedApp.get('/', { preHandler: [requireMinRole('OPERATOR')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { siteIds: string[]; role: string };

      if (!['SUPER_ADMIN', 'SITE_ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const { status, category, severity } = request.query as {
        status?: string;
        category?: string;
        severity?: string;
      };

      const tips = await app.prisma.anonymousTip.findMany({
        where: {
          siteId: { in: user.siteIds },
          ...(status && { status: status as any }),
          ...(category && { category: category as any }),
          ...(severity && { severity: severity as any }),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      return tips;
    });

    // GET /api/v1/tips/:id
    authedApp.get('/:id', { preHandler: [requireMinRole('OPERATOR')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { siteIds: string[]; role: string };
      const { id } = request.params as { id: string };

      if (!['SUPER_ADMIN', 'SITE_ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const tip = await app.prisma.anonymousTip.findFirst({
        where: { id, siteId: { in: user.siteIds } },
      });

      if (!tip) return reply.status(404).send({ error: 'Tip not found' });
      return tip;
    });

    // PATCH /api/v1/tips/:id — update tip status (review, investigate, resolve)
    authedApp.patch('/:id', { preHandler: [requireMinRole('OPERATOR')] }, async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as { id: string; siteIds: string[]; role: string };
      const { id } = request.params as { id: string };
      const body = request.body as { status?: string; notes?: string };

      if (!['SUPER_ADMIN', 'SITE_ADMIN'].includes(user.role)) {
        return reply.status(403).send({ error: 'Admin access required' });
      }

      const tip = await app.prisma.anonymousTip.findFirst({
        where: { id, siteId: { in: user.siteIds } },
      });

      if (!tip) return reply.status(404).send({ error: 'Tip not found' });

      const updated = await app.prisma.anonymousTip.update({
        where: { id },
        data: {
          ...(body.status && { status: body.status as any }),
          ...(body.notes !== undefined && { notes: body.notes }),
          reviewedById: user.id,
          reviewedAt: new Date(),
        },
      });

      await app.prisma.auditLog.create({
        data: {
          siteId: tip.siteId,
          userId: user.id,
          action: 'TIP_REVIEWED',
          entity: 'AnonymousTip',
          entityId: id,
          details: { newStatus: body.status },
        },
      });

      return updated;
    });
  });
}
