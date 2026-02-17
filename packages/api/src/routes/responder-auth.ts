import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { sanitizeText } from '../utils/sanitize.js';
import {
  authenticateResponder,
  signResponderToken,
} from '../middleware/responder-auth.js';

interface LoginBody {
  email: string;
  password: string;
}

interface MfaVerifyBody {
  token: string;
}

export default async function responderAuthRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /login — Responder login with email + password
  fastify.post<{ Body: LoginBody }>('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const email = sanitizeText(request.body.email).toLowerCase();
    const password = request.body.password;

    if (!email) {
      return reply.code(400).send({ error: 'Email is required' });
    }

    if (!password) {
      return reply.code(400).send({ error: 'Password is required' });
    }

    const responder = await fastify.prisma.responderUser.findUnique({
      where: { email },
      include: { agency: true },
    });

    if (!responder) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, responder.passwordHash);
    if (!validPassword) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    if (responder.status !== 'ACTIVE_RESPONDER') {
      return reply.code(403).send({ error: 'Account is not active', code: 'RESPONDER_INACTIVE' });
    }

    if (responder.agency.status !== 'ACTIVE_AGENCY') {
      return reply.code(403).send({ error: 'Agency is not active', code: 'AGENCY_INACTIVE' });
    }

    const permissions = responder.permissions as string[];

    const token = signResponderToken({
      id: responder.id,
      email: responder.email,
      role: responder.role,
      agencyId: responder.agencyId,
      permissions,
    });

    await fastify.prisma.responderUser.update({
      where: { id: responder.id },
      data: { lastLogin: new Date() },
    });

    return {
      token,
      user: {
        id: responder.id,
        email: responder.email,
        firstName: responder.firstName,
        lastName: responder.lastName,
        role: responder.role,
        agencyId: responder.agencyId,
        agencyName: responder.agency.name,
        permissions,
      },
    };
  });

  // POST /logout — Stateless JWT logout (client-side token removal)
  fastify.post('/logout', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return { success: true };
  });

  // POST /refresh — Issue a fresh token for an authenticated responder
  fastify.post('/refresh', {
    preHandler: [authenticateResponder],
  }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = request.responderUser!;

    const token = signResponderToken({
      id: user.id,
      email: user.email,
      role: user.role,
      agencyId: user.agencyId,
      permissions: user.permissions,
    });

    return { token };
  });

  // POST /mfa/verify — Verify TOTP code for MFA
  // MFA is not yet implemented. This endpoint returns 501 to prevent
  // callers from assuming a stub "verified: true" response is legitimate.
  fastify.post<{ Body: MfaVerifyBody }>('/mfa/verify', {
    preHandler: [authenticateResponder],
  }, async (_request: FastifyRequest<{ Body: MfaVerifyBody }>, reply: FastifyReply) => {
    return reply.code(501).send({
      error: 'MFA is not yet enabled. Contact your administrator.',
      code: 'MFA_NOT_IMPLEMENTED',
    });
  });
}
