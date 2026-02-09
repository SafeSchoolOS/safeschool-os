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
 * Order matters: child tables before parent tables (FK constraints).
 */
export async function cleanupTestData(app: FastifyInstance): Promise<void> {
  const prisma = app.prisma;
  const seedPrefix = '00000000-0000-4000-a000-';
  const nonSeed = { id: { not: { startsWith: seedPrefix } } };

  // Drain BullMQ queue to prevent job accumulation across tests
  try {
    await app.alertQueue.drain();
  } catch {
    // Queue may already be empty or closing
  }

  // Phase 4 tables (no FK to core tables, safe to delete first)
  await prisma.drillParticipant.deleteMany({ where: nonSeed });
  await prisma.drill.deleteMany({ where: nonSeed });
  await prisma.reunificationEntry.deleteMany({ where: nonSeed });
  await prisma.reunificationEvent.deleteMany({ where: nonSeed });
  await prisma.environmentalReading.deleteMany({ where: nonSeed });
  await prisma.environmentalSensor.deleteMany({ where: nonSeed });
  await prisma.anonymousTip.deleteMany({ where: nonSeed });
  await prisma.threatReport.deleteMany({ where: nonSeed });
  await prisma.socialMediaAlert.deleteMany({ where: nonSeed });

  // Core tables (child → parent order for FK constraints)
  await prisma.dispatchRecord.deleteMany({ where: nonSeed });
  await prisma.notificationLog.deleteMany({ where: nonSeed });
  await prisma.lockdownCommand.deleteMany({ where: nonSeed });
  await prisma.auditLog.deleteMany({ where: nonSeed });
  await prisma.alert.deleteMany({ where: nonSeed });
}
