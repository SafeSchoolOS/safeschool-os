import type { FastifyPluginAsync } from 'fastify';

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
  }>('/', async (request, reply) => {
    const { name, email, school, role, phone, buildings, state, message } = request.body;

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
