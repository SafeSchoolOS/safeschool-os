import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authProvider = process.env.AUTH_PROVIDER || 'dev';

  // POST /api/v1/auth/login — email + password login
  fastify.post<{ Body: { email: string; password?: string } }>('/login', async (request, reply) => {
    if (authProvider === 'clerk') {
      return reply.code(404).send({ error: 'Password login is not available. Use Clerk authentication.' });
    }

    const { email, password } = request.body;
    if (!email) {
      return reply.code(400).send({ error: 'Email is required' });
    }

    const user = await fastify.prisma.user.findUnique({
      where: { email },
      include: { sites: true },
    });

    if (!user || !user.isActive) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Verify password if user has one set
    if (user.passwordHash) {
      if (!password) {
        return reply.code(401).send({ error: 'Password is required' });
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }
    }

    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      siteIds: user.sites.map((s) => s.siteId),
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        siteIds: user.sites.map((s) => s.siteId),
      },
    };
  });

  // GET /api/v1/auth/me — current user info
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request) => {
    const user = await fastify.prisma.user.findUnique({
      where: { id: request.jwtUser.id },
      include: { sites: true },
    });

    if (!user) {
      throw { statusCode: 404, message: 'User not found' };
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      siteIds: user.sites.map((s) => s.siteId),
      isActive: user.isActive,
    };
  });

  // POST /api/v1/auth/push-token — Register push notification token (mobile app)
  fastify.post<{ Body: { token: string } }>(
    '/push-token',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { token } = request.body;
      if (!token) return reply.code(400).send({ error: 'token is required' });

      // Store as audit log for now — in production, store in a device_tokens table
      await fastify.prisma.auditLog.create({
        data: {
          siteId: request.jwtUser.siteIds[0] || '',
          userId: request.jwtUser.id,
          action: 'PUSH_TOKEN_REGISTERED',
          entity: 'User',
          entityId: request.jwtUser.id,
          details: { token: token.substring(0, 20) + '...' },
          ipAddress: request.ip,
        },
      });

      return { success: true };
    },
  );

  // POST /api/v1/auth/clerk-webhook — Clerk webhook for user.created / user.updated
  fastify.post<{ Body: any }>('/clerk-webhook', async (request, reply) => {
    if (authProvider !== 'clerk') {
      return reply.code(404).send({ error: 'Clerk webhooks not enabled' });
    }

    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return reply.code(500).send({ error: 'CLERK_WEBHOOK_SECRET not configured' });
    }

    // Verify webhook signature (svix)
    const svixId = request.headers['svix-id'] as string;
    const svixTimestamp = request.headers['svix-timestamp'] as string;
    const svixSignature = request.headers['svix-signature'] as string;

    if (!svixId || !svixTimestamp || !svixSignature) {
      return reply.code(400).send({ error: 'Missing svix headers' });
    }

    // Verify timestamp is within 5 minutes
    const timestampSeconds = parseInt(svixTimestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestampSeconds) > 300) {
      return reply.code(400).send({ error: 'Webhook timestamp too old' });
    }

    // Verify HMAC signature
    const rawBody = JSON.stringify(request.body);
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const secretBytes = Buffer.from(webhookSecret.replace('whsec_', ''), 'base64');
    const expectedSignature = crypto
      .createHmac('sha256', secretBytes)
      .update(signedContent)
      .digest('base64');

    const signatures = svixSignature.split(' ').map((s) => s.split(',')[1]);
    const isValid = signatures.some((sig) => sig === expectedSignature);

    if (!isValid) {
      return reply.code(401).send({ error: 'Invalid webhook signature' });
    }

    const { type, data } = request.body as { type: string; data: any };
    const email = data.email_addresses?.[0]?.email_address;
    const name = `${data.first_name || ''} ${data.last_name || ''}`.trim();

    if (type === 'user.created' || type === 'user.updated') {
      if (!email) {
        return { received: true, action: 'skipped', reason: 'no email' };
      }

      // Try to find existing user by email
      const existingUser = await fastify.prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        // Link clerkId to existing user
        await fastify.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            clerkId: data.id,
            name: name || existingUser.name,
          },
        });
        return { received: true, action: 'linked', userId: existingUser.id };
      }

      // For new users from Clerk — they'll need to be assigned a role/site by admin
      return { received: true, action: 'pending', reason: 'User not in system. Admin must create user first.' };
    }

    return { received: true, action: 'ignored', type };
  });
};

export default authRoutes;
