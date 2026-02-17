import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';

declare module 'fastify' {
  interface FastifyRequest {
    responderUser?: {
      id: string;
      email: string;
      role: string;
      agencyId: string;
      permissions: string[];
    };
  }
}

function getFrJwtSecret(): string {
  const secret = process.env.FR_JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: FR_JWT_SECRET not set — first-responder auth will use fallback secret');
  }
  return secret || 'fr-dev-secret-DO-NOT-USE-IN-PRODUCTION';
}

function base64UrlEncode(data: Buffer): string {
  return data.toString('base64url');
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

interface ResponderJwtPayload {
  id: string;
  email: string;
  role: string;
  agencyId: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export function signResponderToken(
  payload: Omit<ResponderJwtPayload, 'iat' | 'exp'>,
  expiresIn?: string,
): string {
  const expiry = expiresIn || process.env.FR_JWT_EXPIRY || '8h';
  const now = Math.floor(Date.now() / 1000);
  let expiresAt: number;

  const match = expiry.match(/^(\d+)([smhd])$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    expiresAt = now + value * (multipliers[unit] || 3600);
  } else {
    expiresAt = now + 8 * 3600;
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload = { ...payload, iat: now, exp: expiresAt };

  const headerEncoded = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadEncoded = base64UrlEncode(Buffer.from(JSON.stringify(fullPayload)));
  const signature = crypto
    .createHmac('sha256', getFrJwtSecret())
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest();
  const signatureEncoded = base64UrlEncode(signature);

  return `${headerEncoded}.${payloadEncoded}.${signatureEncoded}`;
}

export function verifyResponderToken(token: string): ResponderJwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', getFrJwtSecret())
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest();
  const expectedEncoded = base64UrlEncode(expectedSignature);

  if (!crypto.timingSafeEqual(Buffer.from(signatureEncoded), Buffer.from(expectedEncoded))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded).toString('utf8')) as ResponderJwtPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function authenticateResponder(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Missing or invalid authorization header' });
  }

  const token = authHeader.substring(7);
  const payload = verifyResponderToken(token);

  if (!payload) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }

  request.responderUser = {
    id: payload.id,
    email: payload.email,
    role: payload.role,
    agencyId: payload.agencyId,
    permissions: payload.permissions,
  };
}

export function requireResponderRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.responderUser) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'No responder authentication found' });
    }

    if (!roles.includes(request.responderUser.role)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Insufficient role privileges',
        requiredRoles: roles,
      });
    }
  };
}

export function requireResponderPermission(...perms: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.responderUser) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'No responder authentication found' });
    }

    const userPermissions = request.responderUser.permissions;
    const missing = perms.filter((p) => !userPermissions.includes(p));

    if (missing.length > 0) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Insufficient permissions',
        requiredPermissions: perms,
        missingPermissions: missing,
      });
    }
  };
}
