import type { FastifyInstance, InjectOptions } from 'fastify';

// Seed user IDs from packages/db/src/seed.ts
const SEED_USERS = {
  admin: {
    id: '00000000-0000-4000-a000-000000001001',
    email: 'admin@lincoln.edu',
    role: 'SITE_ADMIN',
    siteIds: ['00000000-0000-4000-a000-000000000001'],
  },
  operator: {
    id: '00000000-0000-4000-a000-000000001002',
    email: 'operator@lincoln.edu',
    role: 'OPERATOR',
    siteIds: ['00000000-0000-4000-a000-000000000001'],
  },
  teacher1: {
    id: '00000000-0000-4000-a000-000000001003',
    email: 'teacher1@lincoln.edu',
    role: 'TEACHER',
    siteIds: ['00000000-0000-4000-a000-000000000001'],
  },
  responder: {
    id: '00000000-0000-4000-a000-000000001005',
    email: 'responder@lincoln.edu',
    role: 'FIRST_RESPONDER',
    siteIds: ['00000000-0000-4000-a000-000000000001'],
  },
} as const;

export const SEED = {
  siteId: '00000000-0000-4000-a000-000000000001',
  buildings: {
    mainId: '00000000-0000-4000-a000-000000000010',
    annexId: '00000000-0000-4000-a000-000000000011',
  },
  rooms: {
    office: '00000000-0000-4000-a000-000000000100',
    room101: '00000000-0000-4000-a000-000000000101',
  },
  doors: {
    mainEntrance: '00000000-0000-4000-a000-000000002001',
    mainExit: '00000000-0000-4000-a000-000000002002',
  },
  users: SEED_USERS,
};

/**
 * Get a JWT token for the given seed role.
 */
export async function authenticateAs(
  app: FastifyInstance,
  role: keyof typeof SEED_USERS = 'admin',
): Promise<string> {
  const user = SEED_USERS[role];
  const token = app.jwt.sign({
    id: user.id,
    email: user.email,
    role: user.role,
    siteIds: user.siteIds,
  });
  return token;
}

/**
 * Create inject options with auth header for the given role.
 */
export async function injectAuth(
  app: FastifyInstance,
  opts: InjectOptions,
  role: keyof typeof SEED_USERS = 'admin',
): Promise<InjectOptions> {
  const token = await authenticateAs(app, role);
  return {
    ...opts,
    headers: {
      ...opts.headers,
      authorization: `Bearer ${token}`,
    },
  };
}

/**
 * Create a test alert via the API and return the response.
 */
export async function createTestAlert(
  app: FastifyInstance,
  overrides: {
    level?: string;
    buildingId?: string;
    source?: string;
    message?: string;
    role?: keyof typeof SEED_USERS;
  } = {},
) {
  const role = overrides.role || 'admin';
  const token = await authenticateAs(app, role);

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/alerts',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      level: overrides.level || 'MEDICAL',
      buildingId: overrides.buildingId || SEED.buildings.mainId,
      source: overrides.source || 'DASHBOARD',
      message: overrides.message || 'Test alert',
    },
  });

  const body = JSON.parse(response.body);

  if (response.statusCode !== 201) {
    throw new Error(
      `createTestAlert failed: HTTP ${response.statusCode} — ${JSON.stringify(body)}`,
    );
  }

  return { response, body };
}
