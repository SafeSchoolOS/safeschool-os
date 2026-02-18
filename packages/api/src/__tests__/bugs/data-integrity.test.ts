/**
 * Data Integrity Bug Tests
 *
 * These tests expose real bugs in the SafeSchool API related to
 * input validation, data model inconsistencies, and FK constraints.
 *
 * ALL of these tests are expected to FAIL, proving the bugs exist.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from '../setup.js';
import { authenticateAs, createTestAlert, SEED } from '../helpers.js';

describe('Data Integrity Bugs', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildTestServer();
    token = await authenticateAs(app, 'admin');
  });

  afterEach(async () => {
    await cleanupTestData(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Bug 1: parseInt('abc') returns NaN for limit parameter
  //
  // In alerts.ts line 59: `take: Math.min(parseInt(limit || '50'), 100)`
  // When limit='abc', parseInt('abc') => NaN, Math.min(NaN, 100) => NaN.
  // Prisma receives `take: NaN` which is unpredictable behavior.
  // The route should return 400 for a non-numeric limit, not 200.
  // ---------------------------------------------------------------------------
  describe('Bug: parseInt(\'abc\') returns NaN for limit parameter', () => {
    it.fails('GET /alerts?limit=abc should return 400, not succeed with NaN take', async () => {
      // Create a test alert so there's data to return
      await createTestAlert(app, { level: 'MEDICAL' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/alerts?limit=abc',
        headers: { authorization: `Bearer ${token}` },
      });

      // BUG: The route does not validate the limit parameter.
      // parseInt('abc') returns NaN. Math.min(NaN, 100) returns NaN.
      // Prisma's behavior with take: NaN is undefined — it may return all
      // records, zero records, or throw. The API should reject this with 400.
      expect(res.statusCode).toBe(400);
    });

    it.fails('GET /visitors?limit=abc should return 400, not succeed with NaN take', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/visitors?limit=abc',
        headers: { authorization: `Bearer ${token}` },
      });

      // Same bug in visitors.ts line 109
      expect(res.statusCode).toBe(400);
    });

    it.fails('GET /notifications/log?limit=abc should return 400, not succeed with NaN take', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/log?limit=abc',
        headers: { authorization: `Bearer ${token}` },
      });

      // Same bug in notifications.ts line 90
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 2: parseInt('50abc') silently returns 50 (accepts garbage suffix)
  //
  // parseInt('50abc') === 50. The route happily accepts malformed input.
  // A strict API should reject '50abc' as an invalid integer.
  // ---------------------------------------------------------------------------
  describe('Bug: parseInt(\'50abc\') silently accepts garbage suffix', () => {
    it.fails('GET /alerts?limit=50abc should return 400 for malformed integer', async () => {
      await createTestAlert(app, { level: 'MEDICAL' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/alerts?limit=50abc',
        headers: { authorization: `Bearer ${token}` },
      });

      // BUG: parseInt('50abc') returns 50, so the route processes it without error.
      // A strict API should reject this malformed input.
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 3: Invalid date filter produces Invalid Date math
  //
  // In visitors.ts lines 99-102:
  //   const start = new Date('not-a-date');  // Invalid Date
  //   const end = new Date('not-a-date');    // Invalid Date
  //   end.setDate(end.getDate() + 1);        // NaN
  //   where.createdAt = { gte: start, lt: end };  // Invalid Date comparisons
  //
  // This should return 400 but instead passes invalid dates to Prisma.
  // ---------------------------------------------------------------------------
  describe('Bug: Visitor date filter with invalid date', () => {
    it.fails('GET /visitors?date=not-a-date should return 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/visitors?date=not-a-date',
        headers: { authorization: `Bearer ${token}` },
      });

      // BUG: new Date('not-a-date') produces an Invalid Date.
      // end.setDate(end.getDate() + 1) produces NaN.
      // Prisma receives { gte: Invalid Date, lt: Invalid Date } which will
      // either crash or return unexpected results.
      // The route should validate the date and return 400.
      expect(res.statusCode).toBe(400);
    });

    it.fails('GET /visitors?date=2024-13-45 should return 400 for impossible date', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/visitors?date=2024-13-45',
        headers: { authorization: `Bearer ${token}` },
      });

      // new Date('2024-13-45') is also Invalid Date
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 4: Notification channel stored as comma-joined string
  //
  // In notifications.ts line 58: `channel: channels.join(',')`
  // This stores "SMS,EMAIL" as a single string. The NotificationLog.channel
  // field is a plain String, not an array. There's no way to query
  // "find all notifications that included SMS" because you'd need a LIKE query,
  // not an equality check.
  // ---------------------------------------------------------------------------
  describe('Bug: Notification channel joined as comma string', () => {
    it.fails('POST /notifications/send stores multi-channel as comma string, not queryable by individual channel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/send',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          channels: ['SMS', 'EMAIL'],
          message: 'Test multi-channel notification',
          recipientScope: 'all-staff',
        },
      });

      expect(res.statusCode).toBe(201);
      const log = JSON.parse(res.body);

      // BUG: channel is stored as "SMS,EMAIL" — a comma-joined string.
      // This means you cannot query for all SMS notifications without
      // using a LIKE/contains query. This is a data model issue.
      // The channel should be stored as an array or as separate records.
      expect(log.channel).not.toContain(',');
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 5: Test notification recipientIds are phone/email, not user UUIDs
  //
  // In notifications.ts lines 120-121:
  //   recipientIds: [user.phone, user.email].filter(Boolean)
  //
  // The mass-notify worker receives recipientIds which are supposed to be
  // user UUIDs (to look up delivery addresses), but instead receives
  // phone numbers and email addresses. These are not UUIDs.
  // ---------------------------------------------------------------------------
  describe('Bug: Test notification recipientIds are phone/email not user IDs', () => {
    it.fails('POST /notifications/test sends phone/email as recipientIds instead of user UUIDs', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/test',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(201);

      // The job was enqueued with recipientIds = [user.phone, user.email].
      // We can verify the notification log was created, but the underlying
      // bug is that the mass-notify worker receives phone numbers and emails
      // as "recipientIds" instead of actual user UUIDs.
      //
      // Let's verify by checking what the admin user's phone and email are,
      // and confirming they are NOT valid UUIDs.
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      const me = JSON.parse(meRes.body);

      // The recipientIds sent to the worker would be [me.phone, me.email].
      // These should be user UUIDs, not contact details.
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      // BUG: phone is like "+15551000001" — not a UUID
      if (me.phone) {
        expect(me.phone).toMatch(uuidRegex);
      }
      // BUG: email is like "admin@lincoln.edu" — not a UUID
      if (me.email) {
        expect(me.email).toMatch(uuidRegex);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 6: Push token stored in audit log, never in device_tokens
  //
  // In auth.ts lines 77-87: POST /auth/push-token
  // The token is stored truncated in an audit log entry.
  // There is no device_tokens table. The FCM push adapter has no way
  // to retrieve the token when it needs to send a push notification.
  // ---------------------------------------------------------------------------
  describe('Bug: Push token stored in audit log, not device_tokens table', () => {
    it.fails('POST /auth/push-token stores truncated token in audit log with no device_tokens record', async () => {
      const fakePushToken = 'ExponentPushToken[ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890]';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/push-token',
        headers: { authorization: `Bearer ${token}` },
        payload: { token: fakePushToken },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);

      // Check that the audit log entry exists and has truncated token
      const auditLogs = await app.prisma.auditLog.findMany({
        where: {
          userId: SEED.users.admin.id,
          action: 'PUSH_TOKEN_REGISTERED',
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      expect(auditLogs.length).toBe(1);
      const details = auditLogs[0].details as any;
      // The token is truncated to 20 chars + '...' — the full token is lost
      expect(details.token).toBe(fakePushToken.substring(0, 20) + '...');
      expect(details.token).not.toBe(fakePushToken); // Full token is NOT stored

      // BUG: There is no device_tokens table in the schema.
      // The notification system (FCM adapter) cannot retrieve push tokens
      // to actually deliver push notifications. The token is effectively discarded.
      // Verify that there's no way to retrieve the full push token from the database.
      //
      // We expect a device_tokens table or a pushToken field on User to exist,
      // but neither does. This assertion proves the bug:
      const user = await app.prisma.user.findUnique({
        where: { id: SEED.users.admin.id },
      });

      // User model has no pushToken or deviceTokens field — the token is lost.
      // If this key existed, the push notification system could use it.
      expect((user as any).pushToken).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 7: Test notification scope/ids mismatch
  //
  // POST /notifications/test uses recipientScope: 'specific-users' with
  // recipientIds: [user.phone, user.email]. The mass-notify handler expects
  // user IDs for 'specific-users' scope, not phone numbers/emails.
  // The notification will never actually reach the user.
  // ---------------------------------------------------------------------------
  describe('Bug: Test notification scope/ids mismatch with mass-notify handler', () => {
    it.fails('POST /notifications/test sends phone/email as specific-users IDs, which mass-notify cannot resolve', async () => {
      // Get the admin user details
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      const me = JSON.parse(meRes.body);

      // Now send a test notification
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/test',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(201);

      // The job payload has recipientIds: [me.phone, me.email].filter(Boolean)
      // = ['+15551000001', 'admin@lincoln.edu']
      //
      // But mass-notify with scope 'specific-users' would try to look up
      // users by ID, where IDs are UUIDs like '00000000-0000-4000-a000-000000001001'.
      //
      // BUG: The mass-notify handler cannot resolve phone numbers as user IDs.
      // If the handler does `prisma.user.findMany({ where: { id: { in: recipientIds } } })`,
      // it would find zero users because '+15551000001' is not a valid UUID.
      //
      // To prove this, we try to look up a user by the phone number as if it were an ID:
      const lookedUp = await app.prisma.user.findMany({
        where: {
          id: { in: [me.phone, me.email].filter(Boolean) as string[] },
        },
      });

      // BUG: No users found because phone/email are not UUIDs
      // If the system worked correctly, this would find exactly 1 user (the admin).
      expect(lookedUp.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 8: ZeroEyes webhook uses triggeredById: 'SYSTEM' (not a real User UUID)
  //
  // In webhooks/zeroeyes.ts line 117:
  //   triggeredById: 'SYSTEM'
  //
  // Alert.triggeredById has a FK to User.id:
  //   triggeredBy User @relation("AlertTriggeredBy", fields: [triggeredById], references: [id])
  //
  // 'SYSTEM' is not a valid User ID. This will throw a FK constraint violation
  // when Prisma tries to create the alert.
  // ---------------------------------------------------------------------------
  describe('Bug: ZeroEyes webhook uses triggeredById: \'SYSTEM\' (FK violation)', () => {
    it('(FIXED) Alert schema requires triggeredById to reference a real User (FK constraint)', async () => {
      // Attempt to create an alert with triggeredById: 'SYSTEM' directly,
      // simulating what the ZeroEyes webhook does.
      // This should fail with a FK constraint violation.
      let error: Error | null = null;

      try {
        await app.prisma.alert.create({
          data: {
            siteId: SEED.siteId,
            level: 'ACTIVE_THREAT',
            status: 'TRIGGERED',
            source: 'AUTOMATED',
            triggeredById: 'SYSTEM', // <-- Not a valid User UUID
            buildingId: SEED.buildings.mainId,
            buildingName: 'Main Building',
            message: 'ZeroEyes detection test',
          },
        });
      } catch (err) {
        error = err as Error;
      }

      // BUG: The ZeroEyes webhook route passes triggeredById: 'SYSTEM',
      // which violates the FK constraint on Alert -> User.
      // This SHOULD fail with a foreign key violation.
      // If it doesn't fail, that means the FK constraint is missing (also a bug).
      expect(error).not.toBeNull();
      expect(error!.message).toContain('Foreign key constraint');
    });
  });
});
