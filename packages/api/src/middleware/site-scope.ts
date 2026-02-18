import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Site-scoping middleware for multi-tenant data isolation.
 *
 * Ensures authenticated users can only access data belonging to sites
 * they are assigned to. SUPER_ADMIN users bypass all site restrictions.
 */

/**
 * Gets the user's siteIds from the request. Supports both patterns:
 * - request.jwtUser.siteIds (set by authenticate decorator)
 * - (request.user as any).siteIds (set by jwtVerify() in onRequest hooks)
 */
function getUserSiteIds(request: FastifyRequest): string[] {
  return request.jwtUser?.siteIds ?? (request as any).user?.siteIds ?? [];
}

/**
 * Gets the user's role from the request. Supports both patterns.
 */
function getUserRole(request: FastifyRequest): string | undefined {
  return request.jwtUser?.role ?? (request as any).user?.role;
}

/**
 * Checks if the user is a SUPER_ADMIN (bypasses all site restrictions).
 */
function isSuperAdmin(request: FastifyRequest): boolean {
  return getUserRole(request) === 'SUPER_ADMIN';
}

/**
 * Extracts a siteId from the request by checking (in order):
 * 1. request.params.siteId
 * 2. request.body.siteId
 * 3. request.query.siteId
 *
 * Returns undefined if no siteId is found in any location.
 */
function extractSiteId(request: FastifyRequest): string | undefined {
  const params = request.params as Record<string, unknown>;
  if (params?.siteId && typeof params.siteId === 'string') {
    return params.siteId;
  }

  const body = request.body as Record<string, unknown> | null;
  if (body?.siteId && typeof body.siteId === 'string') {
    return body.siteId;
  }

  const query = request.query as Record<string, unknown>;
  if (query?.siteId && typeof query.siteId === 'string') {
    return query.siteId;
  }

  return undefined;
}

/**
 * Pre-handler middleware that verifies the authenticated user has access
 * to the siteId specified in the request (params, body, or query).
 *
 * - If no siteId is found in the request, returns 400.
 * - If the user's siteIds array does not include the requested siteId, returns 403.
 * - SUPER_ADMIN users bypass this check entirely.
 *
 * Usage:
 *   { preHandler: [fastify.authenticate, requireSiteAccess()] }
 *
 * Or for routes using onRequest jwtVerify:
 *   { preHandler: [requireSiteAccess()] }
 */
export function requireSiteAccess() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // SUPER_ADMIN bypasses site restrictions
    if (isSuperAdmin(request)) return;

    const siteId = extractSiteId(request);
    if (!siteId) {
      return reply.code(400).send({
        error: 'siteId is required',
        code: 'SITE_ID_REQUIRED',
      });
    }

    const userSiteIds = getUserSiteIds(request);
    if (!userSiteIds.includes(siteId)) {
      return reply.code(403).send({
        error: 'Access denied: you do not have access to this site',
        code: 'SITE_ACCESS_DENIED',
      });
    }
  };
}

/**
 * Returns a Prisma `where` clause that filters records by the user's
 * authorized sites.
 *
 * - For SUPER_ADMIN: returns an empty object (no site filter — see all sites).
 * - For all other roles: returns `{ siteId: { in: [...userSiteIds] } }`.
 *
 * Usage in route handlers:
 *   const siteFilter = filterBySiteIds(request);
 *   const records = await prisma.alert.findMany({
 *     where: { ...siteFilter, ...otherFilters },
 *   });
 */
export function filterBySiteIds(request: FastifyRequest): Record<string, unknown> {
  if (isSuperAdmin(request)) {
    return {};
  }

  const userSiteIds = getUserSiteIds(request);
  return { siteId: { in: userSiteIds } };
}

/**
 * Validates that a user-supplied siteId (from query parameter) is within
 * the user's authorized sites. If the user provides a siteId, it must be
 * one they have access to. If they don't provide one, returns a filter
 * for all their sites.
 *
 * - For SUPER_ADMIN: accepts any siteId or returns no filter.
 * - For others: validates the supplied siteId or returns their site list.
 *
 * Returns `null` if the siteId is not authorized (caller should return 403).
 * Returns a Prisma `siteId` where clause otherwise.
 *
 * Usage:
 *   const siteFilter = validateSiteIdParam(request);
 *   if (siteFilter === null) return reply.code(403).send({ error: 'Site access denied' });
 *   const records = await prisma.model.findMany({ where: { ...siteFilter } });
 */
export function validateSiteIdParam(
  request: FastifyRequest,
): { siteId: string } | { siteId: { in: string[] } } | Record<string, never> | null {
  const query = request.query as Record<string, unknown>;
  const suppliedSiteId = typeof query?.siteId === 'string' ? query.siteId : undefined;

  if (isSuperAdmin(request)) {
    // SUPER_ADMIN can filter by any site or see all
    if (suppliedSiteId) return { siteId: suppliedSiteId };
    return {};
  }

  const userSiteIds = getUserSiteIds(request);

  if (suppliedSiteId) {
    // User supplied a siteId — verify they have access
    if (!userSiteIds.includes(suppliedSiteId)) {
      return null; // Not authorized
    }
    return { siteId: suppliedSiteId };
  }

  // No siteId supplied — filter to all of user's sites
  return { siteId: { in: userSiteIds } };
}

/**
 * Verifies that a fetched record belongs to one of the user's authorized sites.
 * Useful for single-record lookups (GET /:id, PATCH /:id) where the record
 * has already been fetched from the database.
 *
 * Returns true if the user has access, false otherwise.
 * SUPER_ADMIN always returns true.
 */
export function verifyRecordSiteAccess(
  request: FastifyRequest,
  recordSiteId: string,
): boolean {
  if (isSuperAdmin(request)) return true;

  const userSiteIds = getUserSiteIds(request);
  return userSiteIds.includes(recordSiteId);
}
