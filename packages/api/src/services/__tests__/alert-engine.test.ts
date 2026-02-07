import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestServer, cleanupTestData } from '../../__tests__/setup.js';
import { SEED } from '../../__tests__/helpers.js';
import { AlertEngine } from '../alert-engine.js';

describe('AlertEngine', () => {
  let app: FastifyInstance;
  let engine: AlertEngine;

  beforeAll(async () => {
    app = await buildTestServer();
    engine = new AlertEngine(app);
  });

  afterEach(async () => {
    await cleanupTestData(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('createAlert', () => {
    it('creates an alert with denormalized location', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: SEED.users.admin.id,
        buildingId: SEED.buildings.mainId,
        message: 'Test medical alert',
      });

      expect(alert.id).toBeTruthy();
      expect(alert.status).toBe('TRIGGERED');
      expect(alert.buildingName).toBe('Main Building');
      expect(alert.latitude).toBeTruthy();
      expect(alert.longitude).toBeTruthy();
      expect(alert.siteId).toBe(SEED.siteId);
    });

    it('includes room name when roomId is provided', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'LOCKDOWN',
        source: 'WEARABLE',
        triggeredById: SEED.users.teacher1.id,
        buildingId: SEED.buildings.mainId,
        roomId: SEED.rooms.room101,
        message: 'Lockdown in Room 101',
      });

      expect(alert.roomName).toBe('Room 101');
    });

    it('enqueues dispatch-911 job for ACTIVE_THREAT', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'ACTIVE_THREAT',
        source: 'MOBILE_APP',
        triggeredById: SEED.users.admin.id,
        buildingId: SEED.buildings.mainId,
      });

      // Check that the alert queue has jobs
      const waiting = await app.alertQueue.getWaiting();
      const delayed = await app.alertQueue.getDelayed();
      const allJobs = [...waiting, ...delayed];
      const dispatchJobs = allJobs.filter(
        (j) => j.name === 'dispatch-911' && j.data.alertId === alert.id,
      );
      expect(dispatchJobs.length).toBeGreaterThanOrEqual(1);
    });

    it('enqueues auto-lockdown for LOCKDOWN level', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'LOCKDOWN',
        source: 'DASHBOARD',
        triggeredById: SEED.users.admin.id,
        buildingId: SEED.buildings.mainId,
      });

      const waiting = await app.alertQueue.getWaiting();
      const lockdownJobs = waiting.filter(
        (j) => j.name === 'auto-lockdown' && j.data.alertId === alert.id,
      );
      expect(lockdownJobs.length).toBeGreaterThanOrEqual(1);
    });

    it('enqueues auto-escalation for MEDICAL level', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: SEED.users.admin.id,
        buildingId: SEED.buildings.mainId,
      });

      const delayed = await app.alertQueue.getDelayed();
      const escalateJobs = delayed.filter(
        (j) => j.name === 'auto-escalate' && j.data.alertId === alert.id,
      );
      expect(escalateJobs.length).toBeGreaterThanOrEqual(1);
      expect(escalateJobs[0].data.nextLevel).toBe('LOCKDOWN');
    });

    it('creates an audit log entry', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: SEED.users.admin.id,
        buildingId: SEED.buildings.mainId,
      });

      const logs = await app.prisma.auditLog.findMany({
        where: { entityId: alert.id, action: 'ALERT_CREATED' },
      });
      expect(logs.length).toBe(1);
    });
  });

  describe('acknowledgeAlert', () => {
    it('sets status to ACKNOWLEDGED', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: SEED.users.teacher1.id,
        buildingId: SEED.buildings.mainId,
      });

      const ack = await engine.acknowledgeAlert(alert.id, SEED.users.admin.id);
      expect(ack.status).toBe('ACKNOWLEDGED');
      expect(ack.acknowledgedById).toBe(SEED.users.admin.id);
      expect(ack.acknowledgedAt).toBeTruthy();
    });
  });

  describe('resolveAlert', () => {
    it('sets status to RESOLVED', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: SEED.users.admin.id,
        buildingId: SEED.buildings.mainId,
      });

      const resolved = await engine.resolveAlert(alert.id, SEED.users.admin.id);
      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.resolvedAt).toBeTruthy();
    });
  });

  describe('escalateAlert', () => {
    it('escalates MEDICAL to LOCKDOWN', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: SEED.users.admin.id,
        buildingId: SEED.buildings.mainId,
      });

      const escalated = await engine.escalateAlert(alert.id, 'LOCKDOWN');
      expect(escalated).not.toBeNull();
      expect(escalated!.level).toBe('LOCKDOWN');
      expect(escalated!.message).toContain('AUTO-ESCALATED from MEDICAL');
    });

    it('returns null if already acknowledged', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: SEED.users.admin.id,
        buildingId: SEED.buildings.mainId,
      });

      await engine.acknowledgeAlert(alert.id, SEED.users.admin.id);
      const escalated = await engine.escalateAlert(alert.id, 'LOCKDOWN');
      expect(escalated).toBeNull();
    });
  });

  describe('cancelAlert', () => {
    it('sets status to CANCELLED', async () => {
      const alert = await engine.createAlert({
        siteId: SEED.siteId,
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: SEED.users.admin.id,
        buildingId: SEED.buildings.mainId,
      });

      const cancelled = await engine.cancelAlert(alert.id, SEED.users.admin.id);
      expect(cancelled.status).toBe('CANCELLED');
    });
  });
});
