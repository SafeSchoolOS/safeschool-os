/**
 * Shared route helper utilities for cloud-sync route files.
 *
 * Centralises common request-extraction logic that was previously
 * duplicated across 9+ route files.
 */

import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * Constant-time secret comparison. Returns false for any mismatch, missing
 * value, or length mismatch without leaking timing. Use this anywhere you
 * compare a device key, API token, or other server-known secret against a
 * caller-supplied value.
 */
export function safeEqualSecret(expected: string | undefined | null, provided: unknown): boolean {
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Return the full user object attached by the JWT auth hook. */
export function getUser(request: FastifyRequest): Record<string, any> {
  return (request as any).user || {};
}

/** Return the username string (falls back to JWT `sub`, then 'system'). */
export function getUsername(request: FastifyRequest): string {
  return (request as any).user?.username || (request as any).user?.sub || 'system';
}

/** Return the user's role (falls back to 'unknown'). */
export function getUserRole(request: FastifyRequest): string {
  return (request as any).user?.role || 'unknown';
}

/**
 * Return the org ID from the authenticated user.
 *
 * **Behavior change (2026-04):** previously silently returned the string
 * `'default'` when no user object was attached. That turned a bug in upstream
 * JWT handling into a cross-tenant data leak into the `'default'` bucket.
 * We now:
 *   - Return `user.orgId` when the JWT is present and carries it.
 *   - Return the deployment-wide default (DASHBOARD_ADMIN_ORG or 'default')
 *     when the user IS attached but the JWT didn't include `orgId` — this
 *     preserves single-tenant deploys where the admin account has no orgId
 *     claim but the data lives under the default org.
 *   - Return `'__unattached__'` when no user object is attached at all. This
 *     is an intentionally impossible real orgId so any query filtered by
 *     `org_id = $1` returns zero rows — fail-safe for cross-tenant queries
 *     even if a route accidentally skipped the JWT preHandler.
 *
 * Routes that should fail loudly when there's no user should call
 * `requireOrgId(request)` instead.
 */
export function getOrgId(request: FastifyRequest): string {
  const user = (request as any).user;
  if (!user) return '__unattached__';
  return user.orgId || process.env.DASHBOARD_ADMIN_ORG || 'default';
}

/**
 * Strict variant: throws a 401-shaped error when no user is attached.
 * Use in handlers where tenant isolation is load-bearing and a silent
 * fallback would be a bug (e.g. GET /reports list, audit exports, etc.).
 */
export function requireOrgId(request: FastifyRequest): string {
  const user = (request as any).user;
  if (!user) {
    const err: any = new Error('Authentication required (no orgId on request)');
    err.statusCode = 401;
    throw err;
  }
  return user.orgId || process.env.DASHBOARD_ADMIN_ORG || 'default';
}

/** Return the client IP, respecting X-Forwarded-For from reverse proxies. */
export function getIpAddress(request: FastifyRequest): string {
  return (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || 'unknown';
}

/** Deployment-wide default tenant id for legacy rows + single-tenant deploys. */
export const DEFAULT_ORG = process.env.DASHBOARD_ADMIN_ORG || 'default';

/**
 * Idempotent migration: add `org_id TEXT` to `tableName`, backfill nulls to
 * DEFAULT_ORG, create an `idx_<alias>_org` index. Wrapped in `.catch(() => {})`
 * so a missing table on a fresh boot doesn't break the route; the underlying
 * adapter's ensureTables pass is the canonical creator.
 *
 * Call at plugin registration OR lazily on first request via a `tableMigrated`
 * flag. Idempotent, so calling twice is a no-op.
 */
export async function ensureOrgColumn(
  pool: { query: (sql: string, params?: any[]) => Promise<any> },
  tableName: string,
  indexAlias?: string,
): Promise<void> {
  // Only accept strict identifiers — never interpolate caller input here.
  if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) {
    throw new Error(`ensureOrgColumn: refusing non-identifier table name "${tableName}"`);
  }
  const alias = indexAlias || tableName;
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`ensureOrgColumn: refusing non-identifier alias "${alias}"`);
  }
  await pool.query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS org_id TEXT`).catch(() => {});
  await pool.query(`UPDATE ${tableName} SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG]).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${alias}_org ON ${tableName}(org_id)`).catch(() => {});
}
