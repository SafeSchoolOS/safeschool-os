import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Role hierarchy (higher index = more access):
 * PARENT < TEACHER < FIRST_RESPONDER < OPERATOR < SITE_ADMIN < SUPER_ADMIN
 */
const ROLE_HIERARCHY: Record<string, number> = {
  PARENT: 0,
  TEACHER: 1,
  FIRST_RESPONDER: 2,
  OPERATOR: 3,
  SITE_ADMIN: 4,
  SUPER_ADMIN: 5,
};

/**
 * Gets the user role from the request. Supports both patterns:
 * - request.jwtUser.role (set by authenticate decorator)
 * - (request.user as any).role (set by jwtVerify() in onRequest hooks)
 */
function getUserRole(request: FastifyRequest): string | undefined {
  return request.jwtUser?.role ?? (request as any).user?.role;
}

/**
 * Creates a Fastify preHandler that checks if the authenticated user
 * has one of the allowed roles.
 *
 * Usage:
 *   { preHandler: [fastify.authenticate, requireRole('SITE_ADMIN', 'OPERATOR')] }
 */
export function requireRole(...allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userRole = getUserRole(request);
    if (!userRole) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // SUPER_ADMIN always has access
    if (userRole === 'SUPER_ADMIN') return;

    if (!allowedRoles.includes(userRole)) {
      return reply.code(403).send({
        error: 'Insufficient permissions',
        code: 'ROLE_REQUIRED',
        requiredRoles: allowedRoles,
      });
    }
  };
}

/**
 * Requires at minimum a certain role level in the hierarchy.
 * E.g., requireMinRole('OPERATOR') allows OPERATOR, SITE_ADMIN, SUPER_ADMIN.
 */
export function requireMinRole(minRole: string) {
  const minLevel = ROLE_HIERARCHY[minRole] ?? 0;
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const userRole = getUserRole(request);
    if (!userRole) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const userLevel = ROLE_HIERARCHY[userRole] ?? -1;
    if (userLevel < minLevel) {
      return reply.code(403).send({
        error: 'Insufficient permissions',
        code: 'ROLE_LEVEL_REQUIRED',
        requiredMinRole: minRole,
      });
    }
  };
}
