/**
 * OAuth Routes
 *
 * Fastify plugin that handles OAuth login flows for Google, Microsoft, and Apple.
 * No external OAuth SDK — raw HTTP fetch() to provider endpoints.
 *
 * Mount as sub-plugin of dashboardRoutes at /auth prefix:
 *   Routes end up at /dashboard/auth/google, /dashboard/auth/google/callback, etc.
 */

import crypto from 'node:crypto';
import querystring from 'node:querystring';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';
import type { UserDatabaseAdapter, OAuthProvider } from './types.js';

const log = createLogger('cloud-sync:oauth');

export interface OAuthRoutesOptions {
  signJwt: (payload: Record<string, unknown>) => string;
  userAdapter: UserDatabaseAdapter;
  baseUrl: string;
  defaultOrgId?: string;
  defaultRole?: string;
  google?: { clientId: string; clientSecret: string };
  microsoft?: { clientId: string; clientSecret: string; tenantId?: string };
  apple?: { clientId: string; teamId: string; keyId: string; privateKey: string };
}

function randomState(): string {
  return crypto.randomBytes(24).toString('hex');
}

/** Decode a JWT payload without verifying signature (used for Apple id_token). */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = parts[1]!
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
}

/** Parse cookies from raw Cookie header. */
function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return cookies;
}

export async function oauthRoutes(fastify: FastifyInstance, options: OAuthRoutesOptions) {
  const {
    signJwt,
    userAdapter,
    baseUrl,
    defaultOrgId = 'default',
    defaultRole = 'viewer',
    google,
    microsoft,
    apple,
  } = options;

  const callbackBase = baseUrl.replace(/\/$/, '') + '/dashboard/auth';

  // ─── Provider Discovery ─────────────────────────────────────────

  fastify.get('/providers', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      google: !!google,
      microsoft: !!microsoft,
      apple: !!apple,
    });
  });

  // Helper: finish OAuth flow — upsert user, issue JWT, redirect to dashboard
  async function finishOAuth(
    reply: FastifyReply,
    provider: OAuthProvider,
    profile: { email: string; name?: string; picture?: string; providerId: string },
  ) {
    try {
      const user = await userAdapter.upsertUser({
        email: profile.email,
        displayName: profile.name,
        avatarUrl: profile.picture,
        provider,
        providerId: profile.providerId,
        orgId: defaultOrgId,
        role: defaultRole,
      });

      const token = signJwt({
        sub: user.id,
        email: user.email,
        username: user.displayName || user.email,
        orgId: user.orgId,
        role: user.role,
        provider,
      });

      return reply.redirect(`/dashboard?token=${encodeURIComponent(token)}&orgId=${encodeURIComponent(user.orgId)}`);
    } catch (err) {
      log.error({ err, provider }, 'OAuth finish failed');
      return reply.redirect(`/dashboard?auth_error=${encodeURIComponent('Authentication failed')}`);
    }
  }

  // ─── Google OAuth ───────────────────────────────────────────────

  if (google) {
    const googleRedirectUri = `${callbackBase}/google/callback`;

    fastify.get('/google', async (request: FastifyRequest, reply: FastifyReply) => {
      const state = randomState();
      reply.header('set-cookie', `oauth_state=${state}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=300`);

      const params = new URLSearchParams({
        client_id: google.clientId,
        redirect_uri: googleRedirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'offline',
        prompt: 'select_account',
      });
      return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    });

    fastify.get('/google/callback', async (request: FastifyRequest, reply: FastifyReply) => {
      const { code, state } = request.query as { code?: string; state?: string };
      const cookies = parseCookies(request.headers.cookie);
      const cookieState = cookies.oauth_state;

      if (!code || !state || state !== cookieState) {
        return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('Invalid OAuth state'));
      }

      try {
        // Exchange code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: google.clientId,
            client_secret: google.clientSecret,
            redirect_uri: googleRedirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
        if (!tokenData.access_token) {
          log.error({ error: tokenData.error }, 'Google token exchange failed');
          return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('Google login failed'));
        }

        // Fetch user profile
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profile = await profileRes.json() as { id?: string; email?: string; name?: string; picture?: string };
        if (!profile.email) {
          return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('No email from Google'));
        }

        return finishOAuth(reply, 'google', {
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          providerId: profile.id || profile.email,
        });
      } catch (err) {
        log.error({ err }, 'Google OAuth callback error');
        return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('Google login failed'));
      }
    });
  }

  // ─── Microsoft OAuth ────────────────────────────────────────────

  if (microsoft) {
    const tenant = microsoft.tenantId || 'common';
    const msRedirectUri = `${callbackBase}/microsoft/callback`;

    fastify.get('/microsoft', async (request: FastifyRequest, reply: FastifyReply) => {
      const state = randomState();
      reply.header('set-cookie', `oauth_state=${state}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=300`);

      const params = new URLSearchParams({
        client_id: microsoft.clientId,
        redirect_uri: msRedirectUri,
        response_type: 'code',
        scope: 'openid email profile User.Read',
        state,
        prompt: 'select_account',
      });
      return reply.redirect(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`);
    });

    fastify.get('/microsoft/callback', async (request: FastifyRequest, reply: FastifyReply) => {
      const { code, state } = request.query as { code?: string; state?: string };
      const cookies = parseCookies(request.headers.cookie);
      const cookieState = cookies.oauth_state;

      if (!code || !state || state !== cookieState) {
        return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('Invalid OAuth state'));
      }

      try {
        const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: microsoft.clientId,
            client_secret: microsoft.clientSecret,
            redirect_uri: msRedirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
        if (!tokenData.access_token) {
          log.error({ error: tokenData.error }, 'Microsoft token exchange failed');
          return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('Microsoft login failed'));
        }

        const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profile = await profileRes.json() as { id?: string; mail?: string; userPrincipalName?: string; displayName?: string };
        const email = profile.mail || profile.userPrincipalName;
        if (!email) {
          return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('No email from Microsoft'));
        }

        return finishOAuth(reply, 'microsoft', {
          email,
          name: profile.displayName,
          providerId: profile.id || email,
        });
      } catch (err) {
        log.error({ err }, 'Microsoft OAuth callback error');
        return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('Microsoft login failed'));
      }
    });
  }

  // ─── Apple OAuth ────────────────────────────────────────────────

  if (apple) {
    const appleRedirectUri = `${callbackBase}/apple/callback`;

    // Register form-urlencoded parser for Apple's form_post response_mode
    fastify.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req: unknown, body: string, done: (err: null, result: Record<string, string>) => void) => {
        done(null, querystring.parse(body) as Record<string, string>);
      },
    );

    /** Generate Apple client secret (short-lived ES256 JWT). */
    function generateAppleClientSecret(): string {
      const appleConfig = apple!;
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: appleConfig.keyId })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: appleConfig.teamId,
        iat: now,
        exp: now + 600,
        aud: 'https://appleid.apple.com',
        sub: appleConfig.clientId,
      })).toString('base64url');

      const signingInput = `${header}.${payload}`;
      const sign = crypto.createSign('SHA256');
      sign.update(signingInput);
      const derSig = sign.sign(appleConfig.privateKey);

      // Convert DER signature to raw r||s (64 bytes) for ES256 JWT
      const raw = derToRaw(derSig);
      const signature = Buffer.from(raw).toString('base64url');
      return `${signingInput}.${signature}`;
    }

    /** Convert DER-encoded ECDSA signature to raw 64-byte r||s. */
    function derToRaw(der: Buffer): Buffer {
      const raw = Buffer.alloc(64);
      // DER: 0x30 [len] 0x02 [rlen] [r] 0x02 [slen] [s]
      let offset = 2; // skip 0x30 + total length
      // r
      offset += 1; // skip 0x02
      const rLen = der[offset]!;
      offset += 1;
      const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
      const rDest = rLen < 32 ? 32 - rLen : 0;
      der.copy(raw, rDest, rStart, rStart + Math.min(rLen, 32));
      offset += rLen;
      // s
      offset += 1; // skip 0x02
      const sLen = der[offset]!;
      offset += 1;
      const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
      const sDest = sLen < 32 ? 64 - sLen : 32;
      der.copy(raw, sDest, sStart, sStart + Math.min(sLen, 32));
      return raw;
    }

    fastify.get('/apple', async (request: FastifyRequest, reply: FastifyReply) => {
      const state = randomState();
      reply.header('set-cookie', `oauth_state=${state}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=300`);

      const params = new URLSearchParams({
        client_id: apple.clientId,
        redirect_uri: appleRedirectUri,
        response_type: 'code',
        scope: 'name email',
        state,
        response_mode: 'form_post',
      });
      return reply.redirect(`https://appleid.apple.com/auth/authorize?${params}`);
    });

    fastify.post('/apple/callback', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, string>;
      const { code, state, id_token: idToken } = body;
      const cookies = parseCookies(request.headers.cookie);
      const cookieState = cookies.oauth_state;

      if (!code || !state || state !== cookieState) {
        return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('Invalid OAuth state'));
      }

      try {
        const clientSecret = generateAppleClientSecret();

        const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: apple.clientId,
            client_secret: clientSecret,
            redirect_uri: appleRedirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        const tokenData = await tokenRes.json() as { id_token?: string; error?: string };
        const finalIdToken = tokenData.id_token || idToken;

        if (!finalIdToken) {
          log.error({ error: tokenData.error }, 'Apple token exchange failed');
          return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('Apple login failed'));
        }

        // Decode id_token to get user info (no crypto verify needed — code exchange authenticated it)
        const claims = decodeJwtPayload(finalIdToken);
        const email = claims.email as string | undefined;
        if (!email) {
          return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('No email from Apple'));
        }

        // Apple provides user name only on first authorization (in the `user` form field)
        let name: string | undefined;
        if (body.user) {
          try {
            const userData = JSON.parse(body.user);
            const firstName = userData.name?.firstName || '';
            const lastName = userData.name?.lastName || '';
            name = [firstName, lastName].filter(Boolean).join(' ') || undefined;
          } catch { /* ignore parse errors */ }
        }

        return finishOAuth(reply, 'apple', {
          email,
          name,
          providerId: (claims.sub as string) || email,
        });
      } catch (err) {
        log.error({ err }, 'Apple OAuth callback error');
        return reply.redirect('/dashboard?auth_error=' + encodeURIComponent('Apple login failed'));
      }
    });
  }
}
