import type { FastifyPluginAsync } from 'fastify';
import { sanitizeText } from '../utils/sanitize.js';
import { requireMinRole } from '../middleware/rbac.js';

const demoRequestRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/demo-requests — Submit a demo request (no auth, rate-limited)
  fastify.post<{
    Body: {
      name: string;
      email: string;
      school: string;
      role: string;
      phone?: string;
      buildings?: number;
      state?: string;
      message?: string;
    };
  }>('/', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const name = sanitizeText(request.body.name);
    const email = sanitizeText(request.body.email).toLowerCase();
    const school = sanitizeText(request.body.school);
    const role = sanitizeText(request.body.role);
    const phone = request.body.phone ? sanitizeText(request.body.phone) : undefined;
    const message = request.body.message ? sanitizeText(request.body.message) : undefined;
    const { buildings, state } = request.body;

    if (!name || !email || !school || !role) {
      return reply.code(400).send({ error: 'name, email, school, and role are required' });
    }

    const demoRequest = await fastify.prisma.demoRequest.create({
      data: { name, email, school, role, phone, buildings, state, message },
    });

    fastify.log.info({ email, school }, 'Demo request submitted');

    return reply.code(201).send({
      success: true,
      id: demoRequest.id,
      message: 'Thank you! Our team will reach out within 24 hours.',
    });
  });

  // GET /api/v1/demo-requests — List all requests (SUPER_ADMIN only)
  fastify.get('/', {
    preHandler: [fastify.authenticate, requireMinRole('SUPER_ADMIN')],
  }, async (request) => {
    const { status, page, limit } = request.query as { status?: string; page?: string; limit?: string };
    const take = Math.min(parseInt(limit || '50', 10), 100);
    const skip = (Math.max(parseInt(page || '1', 10), 1) - 1) * take;
    const where: any = {};
    if (status) where.status = status.toUpperCase();

    const [requests, total] = await Promise.all([
      fastify.prisma.demoRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      fastify.prisma.demoRequest.count({ where }),
    ]);
    return { requests, total, page: Math.floor(skip / take) + 1, pages: Math.ceil(total / take) };
  });

  // GET /api/v1/demo-requests/stats — Summary counts (SUPER_ADMIN only)
  fastify.get('/stats', {
    preHandler: [fastify.authenticate, requireMinRole('SUPER_ADMIN')],
  }, async () => {
    const [pending, approved, rejected, total] = await Promise.all([
      fastify.prisma.demoRequest.count({ where: { status: 'PENDING' } }),
      fastify.prisma.demoRequest.count({ where: { status: 'APPROVED' } }),
      fastify.prisma.demoRequest.count({ where: { status: 'REJECTED' } }),
      fastify.prisma.demoRequest.count(),
    ]);
    return { pending, approved, rejected, total };
  });

  // PUT /api/v1/demo-requests/:id — Update status (SUPER_ADMIN only)
  fastify.put<{ Params: { id: string } }>('/:id', {
    preHandler: [fastify.authenticate, requireMinRole('SUPER_ADMIN')],
  }, async (request, reply) => {
    const { status, notes } = request.body as { status: string; notes?: string };
    if (!['APPROVED', 'REJECTED', 'ARCHIVED'].includes(status?.toUpperCase())) {
      return reply.code(400).send({ error: 'status must be APPROVED, REJECTED, or ARCHIVED' });
    }
    const existing = await fastify.prisma.demoRequest.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.code(404).send({ error: 'Request not found' });

    const updated = await fastify.prisma.demoRequest.update({
      where: { id: request.params.id },
      data: {
        status: status.toUpperCase(),
        reviewedBy: request.jwtUser.id,
        reviewedAt: new Date(),
        ...(notes !== undefined && { notes: sanitizeText(notes) }),
      },
    });
    return updated;
  });
};

export default demoRequestRoutes;
