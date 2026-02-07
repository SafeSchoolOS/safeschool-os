import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

/**
 * Build a test-ready Fastify server.
 * Uses the same setup as production (prisma, redis, auth, ws).
 * Each test suite should call this in beforeAll and close in afterAll.
 */
export async function buildTestServer(): Promise<FastifyInstance> {
  const app = await buildServer();
  await app.ready();
  return app;
}

/**
 * Clean up test data created during tests (not seed data).
 * Deletes records that don't match seed UUID prefix.
 */
export async function cleanupTestData(app: FastifyInstance): Promise<void> {
  const prisma = app.prisma;
  // Delete non-seed audit logs, dispatch records, notification logs, lockdown commands, alerts
  // Seed UUIDs start with 00000000-0000-4000-a000-
  const seedPrefix = '00000000-0000-4000-a000-';

  await prisma.dispatchRecord.deleteMany({
    where: { id: { not: { startsWith: seedPrefix } } },
  });
  await prisma.notificationLog.deleteMany({
    where: { id: { not: { startsWith: seedPrefix } } },
  });
  await prisma.lockdownCommand.deleteMany({
    where: { id: { not: { startsWith: seedPrefix } } },
  });
  await prisma.auditLog.deleteMany({
    where: { id: { not: { startsWith: seedPrefix } } },
  });
  await prisma.alert.deleteMany({
    where: { id: { not: { startsWith: seedPrefix } } },
  });
}
