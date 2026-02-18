import fp from 'fastify-plugin';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Clerk authentication plugin.
 * Verifies Clerk session tokens via @clerk/backend and populates request.jwtUser.
 * Falls back to user lookup by email if clerkId not yet synced.
 */
export default fp(async (fastify) => {
  const { createClerkClient } = await import('@clerk/backend');

  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY!,
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const token = authHeader.slice(7);

      // Verify the Clerk session token
      const payload = await (clerk as any).verifyToken(token);

      // Look up user by clerkId first, then by email
      let user = await fastify.prisma.user.findFirst({
        where: { clerkId: payload.sub },
        include: { sites: true },
      });

      if (!user) {
        // Try by email (for users created before Clerk migration)
        const clerkUser = await clerk.users.getUser(payload.sub);
        const email = clerkUser.emailAddresses[0]?.emailAddress;
        if (email) {
          user = await fastify.prisma.user.findFirst({
            where: { email },
            include: { sites: true },
          });

          // Link clerkId for future lookups
          if (user) {
            await fastify.prisma.user.update({
              where: { id: user.id },
              data: { clerkId: payload.sub },
            });
          }
        }
      }

      if (!user || !user.isActive) {
        return reply.code(401).send({ error: 'User not found or inactive' });
      }

      request.jwtUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        siteIds: user.sites.map((s: any) => s.siteId),
      };
    } catch (err) {
      request.log.error(err, 'Clerk auth failed');
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}, { name: 'clerk-auth' });
