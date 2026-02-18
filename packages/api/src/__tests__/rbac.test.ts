/**
 * RBAC Middleware Tests (Unit — no DB required)
 *
 * Tests requireRole() and requireMinRole() with mocked request/reply objects.
 */

import { describe, it, expect, vi } from 'vitest';
import { requireRole, requireMinRole } from '../middleware/rbac.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRequest(role?: string) {
  return {
    jwtUser: role ? { role } : undefined,
    user: undefined,
  } as any;
}

function mockReply() {
  const reply: any = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply;
}

// ---------------------------------------------------------------------------
// requireRole tests
// ---------------------------------------------------------------------------

describe('requireRole', () => {
  it('allows matching role', async () => {
    const handler = requireRole('SITE_ADMIN', 'OPERATOR');
    const request = mockRequest('SITE_ADMIN');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('allows SUPER_ADMIN for any role', async () => {
    const handler = requireRole('TEACHER');
    const request = mockRequest('SUPER_ADMIN');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('rejects non-matching role with 403', async () => {
    const handler = requireRole('SITE_ADMIN');
    const request = mockRequest('TEACHER');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ROLE_REQUIRED' }),
    );
  });

  it('returns 401 when no user role found', async () => {
    const handler = requireRole('OPERATOR');
    const request = mockRequest(undefined);
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('reads role from request.user when jwtUser is absent', async () => {
    const handler = requireRole('OPERATOR');
    const request = { jwtUser: undefined, user: { role: 'OPERATOR' } } as any;
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireMinRole tests
// ---------------------------------------------------------------------------

describe('requireMinRole', () => {
  it('allows role at the minimum level', async () => {
    const handler = requireMinRole('OPERATOR');
    const request = mockRequest('OPERATOR');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('allows role above the minimum level', async () => {
    const handler = requireMinRole('OPERATOR');
    const request = mockRequest('SITE_ADMIN');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('allows SUPER_ADMIN for any minimum', async () => {
    const handler = requireMinRole('SITE_ADMIN');
    const request = mockRequest('SUPER_ADMIN');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('rejects role below the minimum level with 403', async () => {
    const handler = requireMinRole('OPERATOR');
    const request = mockRequest('TEACHER');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ROLE_LEVEL_REQUIRED', requiredMinRole: 'OPERATOR' }),
    );
  });

  it('rejects PARENT for TEACHER minimum', async () => {
    const handler = requireMinRole('TEACHER');
    const request = mockRequest('PARENT');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('allows FIRST_RESPONDER for TEACHER minimum', async () => {
    const handler = requireMinRole('TEACHER');
    const request = mockRequest('FIRST_RESPONDER');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 401 when no user role found', async () => {
    const handler = requireMinRole('OPERATOR');
    const request = mockRequest(undefined);
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('rejects unknown role (not in hierarchy)', async () => {
    const handler = requireMinRole('OPERATOR');
    const request = mockRequest('UNKNOWN_ROLE');
    const reply = mockReply();

    await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('full role hierarchy order', async () => {
    const roles = ['PARENT', 'TEACHER', 'FIRST_RESPONDER', 'OPERATOR', 'SITE_ADMIN', 'SUPER_ADMIN'];

    for (let minIdx = 0; minIdx < roles.length; minIdx++) {
      for (let userIdx = 0; userIdx < roles.length; userIdx++) {
        const handler = requireMinRole(roles[minIdx]);
        const request = mockRequest(roles[userIdx]);
        const reply = mockReply();

        await handler(request, reply);

        if (userIdx >= minIdx) {
          expect(reply.code).not.toHaveBeenCalled();
        } else {
          expect(reply.code).toHaveBeenCalledWith(403);
        }
      }
    }
  });
});
