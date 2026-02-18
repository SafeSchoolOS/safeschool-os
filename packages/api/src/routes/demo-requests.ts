import type { FastifyPluginAsync } from 'fastify';
import { sanitizeText } from '../utils/sanitize.js';

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
};

export default demoRequestRoutes;
