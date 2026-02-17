import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

/** Account lockout: max failed attempts before temporary lock */
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 900; // 15 minutes

/** JWT access token expiry */
const ACCESS_TOKEN_EXPIRY = '1h';
/** Refresh token expiry */
const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 3600; // 7 days

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authProvider = process.env.AUTH_PROVIDER || 'dev';

  // ---------- Account lockout helpers (Redis-backed) ----------
  const lockoutKey = (email: string) => `login:attempts:${email.toLowerCase()}`;

  async function checkLockout(email: string): Promise<{ locked: boolean; attemptsLeft: number }> {
    try {
      const key = lockoutKey(email);
      const attempts = parseInt(await fastify.redis.get(key) || '0', 10);
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        return { locked: true, attemptsLeft: 0 };
      }
      return { locked: false, attemptsLeft: MAX_LOGIN_ATTEMPTS - attempts };
    } catch {
      // If Redis is down, don't block login
      return { locked: false, attemptsLeft: MAX_LOGIN_ATTEMPTS };
    }
  }

  async function recordFailedAttempt(email: string): Promise<void> {
    try {
      const key = lockoutKey(email);
      const attempts = await fastify.redis.incr(key);
      if (attempts === 1) {
        await fastify.redis.expire(key, LOCKOUT_DURATION_SECONDS);
      }
    } catch { /* If Redis is down, skip lockout tracking */ }
  }

  async function clearFailedAttempts(email: string): Promise<void> {
    try {
      await fastify.redis.del(lockoutKey(email));
    } catch { /* ignore */ }
  }

  // POST /api/v1/auth/login — email + password login
  // Route-specific rate limit: 10 attempts per minute to prevent brute-force
  fastify.post<{ Body: { email: string; password?: string } }>('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    if (authProvider === 'clerk') {
      return reply.code(404).send({ error: 'Password login is not available. Use Clerk authentication.' });
    }

    const { email, password } = request.body;
    if (!email) {
      return reply.code(400).send({ error: 'Email is required' });
    }

    // Check account lockout
    const { locked } = await checkLockout(email);
    if (locked) {
      return reply.code(429).send({
        error: 'Account temporarily locked due to too many failed login attempts. Try again in 15 minutes.',
      });
    }

    const user = await fastify.prisma.user.findUnique({
      where: { email },
      include: { sites: true },
    });

    if (!user || !user.isActive) {
      await recordFailedAttempt(email);
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Always require a password — reject users without a passwordHash set
    if (!user.passwordHash) {
      await recordFailedAttempt(email);
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    if (!password) {
      return reply.code(401).send({ error: 'Password is required' });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await recordFailedAttempt(email);
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Clear failed attempts on successful login
    await clearFailedAttempts(email);

    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      siteIds: user.sites.map((s) => s.siteId),
    };

    const token = fastify.jwt.sign(tokenPayload, { expiresIn: ACCESS_TOKEN_EXPIRY });

    // Generate refresh token (opaque, stored in Redis)
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const refreshKey = `refresh:${refreshToken}`;
    try {
      await fastify.redis.setex(refreshKey, REFRESH_TOKEN_EXPIRY_SECONDS, JSON.stringify({
        userId: user.id,
        email: user.email,
      }));
    } catch {
      // If Redis is unavailable, login still works — just no refresh token
    }

    return {
      token,
      refreshToken,
      expiresIn: 3600, // 1 hour in seconds
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        siteIds: user.sites.map((s) => s.siteId),
      },
    };
  });

  // POST /api/v1/auth/refresh — Exchange refresh token for new access token
  fastify.post<{ Body: { refreshToken: string } }>('/refresh', {
    config: {
      rateLimit: { max: 20, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const { refreshToken } = request.body;
    if (!refreshToken) {
      return reply.code(400).send({ error: 'refreshToken is required' });
    }

    const refreshKey = `refresh:${refreshToken}`;
    let stored: string | null = null;
    try {
      stored = await fastify.redis.get(refreshKey);
    } catch {
      return reply.code(503).send({ error: 'Token refresh temporarily unavailable' });
    }

    if (!stored) {
      return reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }

    const { userId } = JSON.parse(stored) as { userId: string; email: string };

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      include: { sites: true },
    });

    if (!user || !user.isActive) {
      // Revoke the refresh token
      await fastify.redis.del(refreshKey).catch(() => {});
      return reply.code(401).send({ error: 'User account is inactive' });
    }

    // Issue new access token
    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      siteIds: user.sites.map((s) => s.siteId),
    }, { expiresIn: ACCESS_TOKEN_EXPIRY });

    // Rotate refresh token (invalidate old, issue new)
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    try {
      await fastify.redis.del(refreshKey);
      await fastify.redis.setex(`refresh:${newRefreshToken}`, REFRESH_TOKEN_EXPIRY_SECONDS, JSON.stringify({
        userId: user.id,
        email: user.email,
      }));
    } catch { /* best effort */ }

    return {
      token,
      refreshToken: newRefreshToken,
      expiresIn: 3600,
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

  // Add raw body capture for webhook signature verification
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const json = JSON.parse(body as string);
        // Attach the raw body for HMAC verification
        (req as any).rawBody = body;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
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

    // Use raw body for HMAC verification (not re-serialized JSON)
    const rawBody = (request.raw as any).rawBody || JSON.stringify(request.body);
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const secretBytes = Buffer.from(webhookSecret.replace('whsec_', ''), 'base64');
    const expectedSignature = crypto
      .createHmac('sha256', secretBytes)
      .update(signedContent)
      .digest('base64');

    const signatures = svixSignature.split(' ').map((s) => s.split(',')[1]);
    const isValid = signatures.some((sig) => {
      try {
        const a = Buffer.from(sig || '');
        const b = Buffer.from(expectedSignature);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch {
        return false;
      }
    });

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
