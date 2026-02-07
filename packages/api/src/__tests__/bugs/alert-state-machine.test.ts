/**
 * Alert State Machine Bug Tests
 *
 * These tests expose REAL bugs in the alert routes and AlertEngine service:
 *   - packages/api/src/routes/alerts.ts
 *   - packages/api/src/services/alert-engine.ts
 *
 * All tests are expected to FAIL, proving the bugs exist.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from '../setup.js';
import { SEED, authenticateAs, createTestAlert } from '../helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestServer();
});

afterAll(async () => {
  await cleanupTestData(app);
  await app.close();
});

afterEach(async () => {
  await cleanupTestData(app);
  // Drain the alert queue so jobs don't leak between tests
  await app.alertQueue.drain();
});

describe('BUG: Invalid alert level not rejected with 400', () => {
  /**
   * Bug location: alerts.ts line 50, alert-engine.ts line 50
   *
   * The POST /alerts route accepts `level` as a plain `string` type.
   * There is no validation against the AlertLevel enum (MEDICAL, LOCKDOWN,
   * ACTIVE_THREAT, FIRE, WEATHER, ALL_CLEAR, CUSTOM).
   *
   * The code does `level: input.level as any` when creating the Prisma record,
   * which bypasses TypeScript checks. Prisma will throw a database-level error
   * for an invalid enum value, but the route doesn't catch this gracefully.
   *
   * Expected: 400 Bad Request with a meaningful error message
   * Actual: 500 Internal Server Error (Prisma enum validation failure)
   */
  it('should return 400 for an invalid alert level, not 500', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        level: 'INVALID_LEVEL',
        buildingId: SEED.buildings.mainId,
        source: 'DASHBOARD',
        message: 'Test with invalid level',
      },
    });

    // BUG: This FAILS -- the route returns 500 (Prisma error) instead of 400.
    // The `as any` cast allows any string through to Prisma, which then
    // throws P2003/P2006 for invalid enum value.
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });
});

describe('BUG: Invalid alert source not rejected with 400', () => {
  /**
   * Bug location: alerts.ts line 32-33, alert-engine.ts line 52
   *
   * Same issue as alert level. The `source` field is typed as `string` and
   * cast with `as any`. Invalid values like 'INVALID' pass through to Prisma.
   *
   * Valid sources: WEARABLE, MOBILE_APP, WALL_STATION, DASHBOARD, AUTOMATED
   */
  it('should return 400 for an invalid alert source, not 500', async () => {
    const token = await authenticateAs(app, 'admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        level: 'MEDICAL',
        buildingId: SEED.buildings.mainId,
        source: 'INVALID_SOURCE',
        message: 'Test with invalid source',
      },
    });

    // BUG: This FAILS -- returns 500 instead of 400
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });
});

describe('BUG: TRIGGERED -> RESOLVED without ACKNOWLEDGED first', () => {
  /**
   * Bug location: alert-engine.ts lines 167-189
   *
   * The resolveAlert method does a direct update to RESOLVED status without
   * checking the current status. A properly designed state machine should
   * enforce the transition: TRIGGERED -> ACKNOWLEDGED -> RESOLVED.
   *
   * Allowing direct TRIGGERED -> RESOLVED skips the acknowledgment step,
   * which means no one officially took responsibility for the alert.
   * This is a compliance issue for Alyssa's Law which requires documented
   * response chains.
   */
  it('should not allow resolving a TRIGGERED alert without acknowledging first', async () => {
    const { body: alert } = await createTestAlert(app, { level: 'MEDICAL' });
    expect(alert.status).toBe('TRIGGERED');

    const token = await authenticateAs(app, 'admin');

    // Try to directly resolve without acknowledging
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/alerts/${alert.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'RESOLVED' },
    });

    const updated = JSON.parse(res.body);

    // BUG: This FAILS -- the alert is directly resolved without acknowledgment.
    // Expected: 400 or 409 (must acknowledge before resolving)
    // Actual: 200 with status=RESOLVED
    expect(res.statusCode).toBe(400);

    // Even if we accept a 200, the status should NOT be RESOLVED
    // without an acknowledgment step
    if (res.statusCode === 200) {
      expect(updated.acknowledgedAt).not.toBeNull();
    }
  });
});

describe('BUG: Cancelled alert still has escalation job in queue', () => {
  /**
   * Bug location: alert-engine.ts lines 226-246 and 123-138
   *
   * When an alert is created, enqueueJobs adds an 'auto-escalate' job with
   * a delay (default 60s). When the alert is cancelled via cancelAlert(),
   * the method updates the DB status to CANCELLED but does NOT remove the
   * pending auto-escalate job from the BullMQ queue.
   *
   * The escalateAlert method does check `existing.status !== 'TRIGGERED'`
   * and returns null if cancelled, but the job still runs and hits the DB.
   * In a high-volume scenario, this creates unnecessary DB queries and
   * potential race conditions.
   *
   * More critically: between the cancel and the escalation check, there's a
   * window where someone could create a NEW alert that reuses timing, leading
   * to confusion.
   */
  it('should remove escalation job from queue when alert is cancelled', async () => {
    const { body: alert } = await createTestAlert(app, { level: 'MEDICAL' });
    expect(alert.status).toBe('TRIGGERED');

    // MEDICAL is in ESCALATION_PATH, so an auto-escalate job should exist
    const jobsBefore = await app.alertQueue.getDelayed();
    const escalationJobs = jobsBefore.filter(
      (j) => j.name === 'auto-escalate' && j.data.alertId === alert.id,
    );
    expect(escalationJobs.length).toBe(1);

    // Cancel the alert
    const token = await authenticateAs(app, 'admin');
    const cancelRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/alerts/${alert.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'CANCELLED' },
    });
    expect(cancelRes.statusCode).toBe(200);

    // BUG: The escalation job is still in the queue after cancellation.
    // cancelAlert() does not call alertQueue.remove() or similar.
    const jobsAfter = await app.alertQueue.getDelayed();
    const remainingEscalationJobs = jobsAfter.filter(
      (j) => j.name === 'auto-escalate' && j.data.alertId === alert.id,
    );

    // This FAILS -- the job remains in the queue
    expect(remainingEscalationJobs.length).toBe(0);
  });
});

describe('BUG: Double acknowledgment overwrites first acknowledger', () => {
  /**
   * Bug location: alert-engine.ts lines 141-165
   *
   * The acknowledgeAlert method does an unconditional update:
   *   data: {
   *     status: 'ACKNOWLEDGED',
   *     acknowledgedById: userId,
   *     acknowledgedAt: new Date(),
   *   }
   *
   * It does NOT check if the alert is already ACKNOWLEDGED. If called twice,
   * it overwrites acknowledgedById and acknowledgedAt with the second caller's
   * info, losing the audit trail of who FIRST acknowledged the alert.
   *
   * For Alyssa's Law compliance, the first responder's identity and timestamp
   * are critical evidence.
   */
  it('should not overwrite the first acknowledger when acknowledged again', async () => {
    const { body: alert } = await createTestAlert(app, { level: 'MEDICAL' });

    // First acknowledgment by admin
    const adminToken = await authenticateAs(app, 'admin');
    const ack1Res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/alerts/${alert.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'ACKNOWLEDGED' },
    });
    expect(ack1Res.statusCode).toBe(200);
    const ack1 = JSON.parse(ack1Res.body);
    const firstAcknowledgerId = ack1.acknowledgedById;
    const firstAcknowledgedAt = ack1.acknowledgedAt;
    expect(firstAcknowledgerId).toBe(SEED.users.admin.id);

    // Second acknowledgment by operator (should be rejected or no-op)
    const operatorToken = await authenticateAs(app, 'operator');
    const ack2Res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/alerts/${alert.id}`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { status: 'ACKNOWLEDGED' },
    });

    // BUG: This FAILS in one of two ways:
    // 1. The route returns 200 instead of 400/409 (already acknowledged)
    // 2. If 200, the acknowledgedById was overwritten to the operator
    if (ack2Res.statusCode === 200) {
      const ack2 = JSON.parse(ack2Res.body);
      // The first acknowledger should be preserved
      expect(ack2.acknowledgedById).toBe(firstAcknowledgerId);
      expect(ack2.acknowledgedAt).toBe(firstAcknowledgedAt);
    } else {
      // Ideally it should reject the duplicate acknowledgment
      expect(ack2Res.statusCode).toBe(409);
    }
  });
});

describe('BUG: Escalation re-enqueues all jobs (duplicate dispatch)', () => {
  /**
   * Bug location: alert-engine.ts lines 200-223
   *
   * When escalateAlert() fires (MEDICAL -> LOCKDOWN), it calls enqueueJobs()
   * with the updated alert. enqueueJobs() creates:
   *   - dispatch-911 (because LOCKDOWN is in dispatchLevels)
   *   - auto-lockdown (because LOCKDOWN is in lockdownLevels)
   *   - notify-staff (always)
   *   - auto-escalate (because LOCKDOWN -> ACTIVE_THREAT is in ESCALATION_PATH)
   *
   * This means:
   * 1. LOCKDOWN will ALSO try to escalate to ACTIVE_THREAT (chain escalation)
   * 2. If the original MEDICAL already had a notify-staff job, there's now a
   *    duplicate notify-staff for the same alert
   * 3. The dispatch-911 job fires for the escalated level, but there's no
   *    deduplication -- if the alert escalates again, dispatch-911 fires AGAIN
   */
  it('should not create a second auto-escalate job when escalating MEDICAL to LOCKDOWN', async () => {
    const { body: alert } = await createTestAlert(app, { level: 'MEDICAL' });

    // Check initial jobs: MEDICAL creates notify-staff + auto-escalate (no dispatch, no lockdown)
    const initialJobs = await app.alertQueue.getJobs(['waiting', 'delayed']);
    const initialEscalateJobs = initialJobs.filter(
      (j) => j.name === 'auto-escalate' && j.data.alertId === alert.id,
    );
    expect(initialEscalateJobs.length).toBe(1);
    expect(initialEscalateJobs[0]!.data.nextLevel).toBe('LOCKDOWN');

    // Simulate escalation (normally triggered by the worker after timeout)
    const { AlertEngine } = await import('../../services/alert-engine.js');
    const engine = new AlertEngine(app);
    const escalated = await engine.escalateAlert(alert.id, 'LOCKDOWN');
    expect(escalated).not.toBeNull();
    expect(escalated!.level).toBe('LOCKDOWN');

    // Now check jobs again: escalateAlert calls enqueueJobs which adds MORE jobs
    const afterJobs = await app.alertQueue.getJobs(['waiting', 'delayed']);
    const allEscalateJobs = afterJobs.filter(
      (j) => j.name === 'auto-escalate' && j.data.alertId === alert.id,
    );

    // BUG: This FAILS -- there are now TWO auto-escalate jobs:
    // 1. The original MEDICAL -> LOCKDOWN (already fired but still in queue)
    // 2. A NEW LOCKDOWN -> ACTIVE_THREAT job from the re-enqueue
    // A properly implemented escalation should not create cascading escalation jobs,
    // or should at minimum remove the old one first.
    expect(allEscalateJobs.length).toBeLessThanOrEqual(1);

    // Also check for duplicate dispatch jobs
    const dispatchJobs = afterJobs.filter(
      (j) => j.name === 'dispatch-911' && j.data.alertId === alert.id,
    );
    // LOCKDOWN level triggers dispatch-911, but this is the first dispatch for this alert
    // However, if it escalates AGAIN to ACTIVE_THREAT, there will be a second dispatch
    // For now, verify there's exactly 1 dispatch (this part may pass)
    expect(dispatchJobs.length).toBe(1);
  });

  it('should not create duplicate notify-staff jobs on escalation', async () => {
    const { body: alert } = await createTestAlert(app, { level: 'MEDICAL' });

    // MEDICAL creates 1 notify-staff job
    const initialJobs = await app.alertQueue.getJobs(['waiting', 'delayed']);
    const initialNotifyJobs = initialJobs.filter(
      (j) => j.name === 'notify-staff' && j.data.alertId === alert.id,
    );
    expect(initialNotifyJobs.length).toBe(1);

    // Escalate to LOCKDOWN
    const { AlertEngine } = await import('../../services/alert-engine.js');
    const engine = new AlertEngine(app);
    await engine.escalateAlert(alert.id, 'LOCKDOWN');

    // Check notify-staff jobs after escalation
    const afterJobs = await app.alertQueue.getJobs(['waiting', 'delayed']);
    const allNotifyJobs = afterJobs.filter(
      (j) => j.name === 'notify-staff' && j.data.alertId === alert.id,
    );

    // BUG: This FAILS -- there are now 2 notify-staff jobs for the same alert.
    // enqueueJobs() unconditionally adds notify-staff every time it's called.
    expect(allNotifyJobs.length).toBe(1);
  });
});

describe('BUG: FIRE level does not have unintended escalation', () => {
  /**
   * Verification test: FIRE is NOT in ESCALATION_PATH, so it should not escalate.
   * FIRE IS in dispatchLevels, so it should dispatch 911.
   *
   * This test verifies the correct behavior -- FIRE should dispatch but not escalate.
   * If this test FAILS, it means FIRE has an unintended escalation path.
   */
  it('should dispatch 911 for FIRE but not create an auto-escalate job', async () => {
    const { body: alert } = await createTestAlert(app, { level: 'FIRE' });
    expect(alert.level).toBe('FIRE');

    const jobs = await app.alertQueue.getJobs(['waiting', 'delayed']);

    // FIRE should have a dispatch-911 job
    const dispatchJobs = jobs.filter(
      (j) => j.name === 'dispatch-911' && j.data.alertId === alert.id,
    );
    expect(dispatchJobs.length).toBe(1);

    // FIRE should NOT have an auto-escalate job (it's not in ESCALATION_PATH)
    const escalateJobs = jobs.filter(
      (j) => j.name === 'auto-escalate' && j.data.alertId === alert.id,
    );
    // This should PASS -- FIRE correctly has no escalation path
    expect(escalateJobs.length).toBe(0);

    // FIRE should NOT trigger auto-lockdown (FIRE is not in lockdownLevels)
    const lockdownJobs = jobs.filter(
      (j) => j.name === 'auto-lockdown' && j.data.alertId === alert.id,
    );
    // This should PASS -- FIRE is not in lockdownLevels
    expect(lockdownJobs.length).toBe(0);
  });
});

describe('BUG: Alert with nonexistent buildingId returns 500 not 400', () => {
  /**
   * Bug location: alert-engine.ts line 31
   *
   * createAlert calls `building.findUniqueOrThrow({ where: { id: input.buildingId } })`.
   * When the buildingId doesn't exist, Prisma throws a NotFoundError (P2025).
   * This bubbles up as a 500 Internal Server Error rather than being caught
   * and returned as a 400 Bad Request with a helpful error message.
   */
  it('should return 400 for a nonexistent buildingId, not 500', async () => {
    const token = await authenticateAs(app, 'admin');
    const fakeBuildingId = '00000000-0000-0000-0000-000000000000';

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        level: 'MEDICAL',
        buildingId: fakeBuildingId,
        source: 'DASHBOARD',
        message: 'Test with nonexistent building',
      },
    });

    // BUG: This FAILS -- returns 500 (Prisma NotFoundError) instead of 400.
    // findUniqueOrThrow is not caught and translated to a user-friendly error.
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.error).toMatch(/building/i);
  });
});
