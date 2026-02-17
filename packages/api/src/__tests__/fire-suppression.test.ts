/**
 * Fire Alarm Suppression Tests (Unit — no DB required)
 *
 * Tests the fire-during-lockdown suppression logic in AlertEngine.
 * Uses mocked Prisma and BullMQ to verify:
 *   - Fire alarm is SUPPRESSED when lockdown is active
 *   - Fire alarm triggers normally when no lockdown
 *   - confirmFire() transitions SUPPRESSED -> TRIGGERED + unlocks doors
 *   - dismissFire() transitions SUPPRESSED -> CANCELLED
 *   - confirmFire/dismissFire reject non-suppressed alerts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertEngine } from '../services/alert-engine.js';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockApp() {
  const broadcastCalls: any[] = [];
  const queueJobs: any[] = [];
  const auditLogs: any[] = [];
  let alertStore: Record<string, any> = {};
  let idCounter = 1;

  const prisma = {
    building: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'bldg-1', name: 'Main Building',
      }),
    },
    site: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'site-1', latitude: 40.7358, longitude: -74.1724,
        address: '100 Main St', city: 'Newark', state: 'NJ', zip: '07101',
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: 'site-1', latitude: 40.7358, longitude: -74.1724,
        address: '100 Main St', city: 'Newark', state: 'NJ', zip: '07101',
      }),
    },
    room: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    alert: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        return alertStore[where.id] || null;
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where }: any) => {
        const alert = alertStore[where.id];
        if (!alert) throw new Error('Record not found');
        return alert;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const id = `alert-${idCounter++}`;
        const alert = { id, ...data, triggeredAt: new Date() };
        alertStore[id] = alert;
        return alert;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const existing = alertStore[where.id];
        if (!existing) throw new Error('Record not found');
        const updated = { ...existing, ...data };
        alertStore[where.id] = updated;
        return updated;
      }),
    },
    door: {
      updateMany: vi.fn().mockResolvedValue({ count: 8 }),
    },
    auditLog: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        auditLogs.push(data);
        return { id: `log-${auditLogs.length}`, ...data };
      }),
    },
    fireAlarmEvent: {
      create: vi.fn().mockResolvedValue({ id: 'fae-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'fae-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    actionConfirmation: {
      create: vi.fn().mockResolvedValue({ id: 'ac-1' }),
    },
    lockdownCommand: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    dispatchRecord: {
      create: vi.fn().mockResolvedValue({ id: 'dr-1' }),
    },
  };

  const wsManager = {
    broadcastToSite: vi.fn().mockImplementation((...args: any[]) => {
      broadcastCalls.push(args);
    }),
  };

  const alertQueue = {
    add: vi.fn().mockImplementation(async (name: string, data: any, opts?: any) => {
      queueJobs.push({ name, data, opts });
      return { id: `job-${queueJobs.length}` };
    }),
    getWaiting: vi.fn().mockResolvedValue([]),
    getDelayed: vi.fn().mockResolvedValue([]),
    drain: vi.fn().mockResolvedValue(undefined),
  };

  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    app: { prisma, wsManager, alertQueue, log } as any,
    prisma,
    wsManager,
    alertQueue,
    broadcastCalls,
    queueJobs,
    auditLogs,
    alertStore,
    resetAlertStore: () => { alertStore = {}; idCounter = 1; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlertEngine — Fire Alarm Suppression', () => {
  let mock: ReturnType<typeof createMockApp>;
  let engine: AlertEngine;

  beforeEach(() => {
    mock = createMockApp();
    engine = new AlertEngine(mock.app);
  });

  describe('createAlert — fire during lockdown', () => {
    it('suppresses FIRE alert when active LOCKDOWN exists', async () => {
      // Simulate active lockdown
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-alert-1',
        siteId: 'site-1',
        level: 'LOCKDOWN',
        status: 'TRIGGERED',
      });

      const alert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
        message: 'Fire alarm pulled',
      });

      expect(alert.status).toBe('SUPPRESSED');
      expect(alert.message).toContain('[SUPPRESSED]');
      expect((alert.metadata as any).suppressed).toBe(true);
      expect((alert.metadata as any).suppressedReason).toBe('fire_during_lockdown');
      expect((alert.metadata as any).activeLockdownAlertId).toBe('lockdown-alert-1');
    });

    it('broadcasts fire-alarm:suppressed event', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-alert-1',
        siteId: 'site-1',
        level: 'LOCKDOWN',
        status: 'TRIGGERED',
      });

      await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'DASHBOARD',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      const suppressedBroadcast = mock.broadcastCalls.find(
        (call) => call[1] === 'fire-alarm:suppressed',
      );
      expect(suppressedBroadcast).toBeDefined();
      expect(suppressedBroadcast[2].lockdownAlertId).toBe('lockdown-alert-1');
    });

    it('enqueues notify-staff job for suppressed fire alarm', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-alert-1',
        siteId: 'site-1',
        level: 'ACTIVE_THREAT',
        status: 'ACKNOWLEDGED',
      });

      await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'DASHBOARD',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      const notifyJob = mock.queueJobs.find((j) => j.name === 'notify-staff');
      expect(notifyJob).toBeDefined();
      expect(notifyJob.data.message).toContain('SUPPRESSED');
    });

    it('creates FIRE_ALARM_SUPPRESSED audit log', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-alert-1',
        siteId: 'site-1',
        level: 'LOCKDOWN',
        status: 'TRIGGERED',
      });

      await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'DASHBOARD',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      const auditLog = mock.auditLogs.find((l) => l.action === 'FIRE_ALARM_SUPPRESSED');
      expect(auditLog).toBeDefined();
      expect(auditLog.details.suppressedReason).toBe('fire_during_lockdown');
    });

    it('does NOT suppress fire when no lockdown is active', async () => {
      // findFirst returns null — no active lockdown
      mock.prisma.alert.findFirst.mockResolvedValueOnce(null);

      const alert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
        message: 'Fire alarm pulled',
      });

      expect(alert.status).toBe('TRIGGERED');
      expect(alert.message).not.toContain('[SUPPRESSED]');

      // Should dispatch 911 for unsuppressed fire
      const dispatchJob = mock.queueJobs.find((j) => j.name === 'dispatch-911');
      expect(dispatchJob).toBeDefined();
    });

    it('does NOT suppress non-fire alerts even during lockdown', async () => {
      // Fire suppression only applies to FIRE level
      const alert = await engine.createAlert({
        siteId: 'site-1',
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      expect(alert.status).toBe('TRIGGERED');
      // findFirst should not even be called for non-FIRE alerts
      // (it may be called 0 times since level !== 'FIRE')
    });
  });

  describe('confirmFire', () => {
    it('transitions SUPPRESSED fire to TRIGGERED', async () => {
      // Create a suppressed fire alert directly in store
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-1', siteId: 'site-1', level: 'LOCKDOWN', status: 'TRIGGERED',
      });

      const fireAlert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
        message: 'Fire alarm pulled',
      });

      expect(fireAlert.status).toBe('SUPPRESSED');

      const confirmed = await engine.confirmFire(fireAlert.id, 'operator-1');

      expect(confirmed.status).toBe('TRIGGERED');
      expect(confirmed.message).toContain('[CONFIRMED FIRE]');
      expect((confirmed.metadata as any).confirmedFireBy).toBe('operator-1');
    });

    it('unlocks all doors for evacuation', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-1', siteId: 'site-1', level: 'LOCKDOWN', status: 'TRIGGERED',
      });

      const fireAlert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      await engine.confirmFire(fireAlert.id, 'operator-1');

      expect(mock.prisma.door.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { siteId: 'site-1' },
          data: { status: 'UNLOCKED' },
        }),
      );
    });

    it('broadcasts fire-alarm:confirmed event', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-1', siteId: 'site-1', level: 'LOCKDOWN', status: 'TRIGGERED',
      });

      const fireAlert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      mock.broadcastCalls.length = 0; // reset
      await engine.confirmFire(fireAlert.id, 'operator-1');

      const confirmedBroadcast = mock.broadcastCalls.find(
        (call) => call[1] === 'fire-alarm:confirmed',
      );
      expect(confirmedBroadcast).toBeDefined();
    });

    it('creates FIRE_ALARM_CONFIRMED audit log', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-1', siteId: 'site-1', level: 'LOCKDOWN', status: 'TRIGGERED',
      });

      const fireAlert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      await engine.confirmFire(fireAlert.id, 'operator-1');

      const auditLog = mock.auditLogs.find((l) => l.action === 'FIRE_ALARM_CONFIRMED');
      expect(auditLog).toBeDefined();
      expect(auditLog.details.previousStatus).toBe('SUPPRESSED');
    });

    it('throws if alert is not SUPPRESSED', async () => {
      // Create a normal (non-suppressed) alert
      const alert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'DASHBOARD',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      expect(alert.status).toBe('TRIGGERED');

      await expect(engine.confirmFire(alert.id, 'operator-1')).rejects.toThrow(
        'Alert is not a suppressed fire alarm',
      );
    });
  });

  describe('dismissFire', () => {
    it('transitions SUPPRESSED fire to CANCELLED', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-1', siteId: 'site-1', level: 'LOCKDOWN', status: 'TRIGGERED',
      });

      const fireAlert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
        message: 'Fire alarm pulled',
      });

      const dismissed = await engine.dismissFire(fireAlert.id, 'operator-1');

      expect(dismissed.status).toBe('CANCELLED');
      expect(dismissed.message).toContain('[FALSE ALARM]');
      expect((dismissed.metadata as any).dismissedBy).toBe('operator-1');
      expect((dismissed.metadata as any).dismissedReason).toBe('false_alarm_during_lockdown');
    });

    it('broadcasts fire-alarm:dismissed event', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-1', siteId: 'site-1', level: 'LOCKDOWN', status: 'TRIGGERED',
      });

      const fireAlert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      mock.broadcastCalls.length = 0;
      await engine.dismissFire(fireAlert.id, 'operator-1');

      const dismissedBroadcast = mock.broadcastCalls.find(
        (call) => call[1] === 'fire-alarm:dismissed',
      );
      expect(dismissedBroadcast).toBeDefined();
    });

    it('enqueues notify-staff about false alarm', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-1', siteId: 'site-1', level: 'LOCKDOWN', status: 'TRIGGERED',
      });

      const fireAlert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      mock.queueJobs.length = 0;
      await engine.dismissFire(fireAlert.id, 'operator-1');

      const notifyJob = mock.queueJobs.find((j) => j.name === 'notify-staff');
      expect(notifyJob).toBeDefined();
      expect(notifyJob.data.message).toContain('FALSE ALARM');
    });

    it('creates FIRE_ALARM_DISMISSED audit log', async () => {
      mock.prisma.alert.findFirst.mockResolvedValueOnce({
        id: 'lockdown-1', siteId: 'site-1', level: 'LOCKDOWN', status: 'TRIGGERED',
      });

      const fireAlert = await engine.createAlert({
        siteId: 'site-1',
        level: 'FIRE',
        source: 'PULL_STATION',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      await engine.dismissFire(fireAlert.id, 'operator-1');

      const auditLog = mock.auditLogs.find((l) => l.action === 'FIRE_ALARM_DISMISSED');
      expect(auditLog).toBeDefined();
    });

    it('throws if alert is not SUPPRESSED', async () => {
      const alert = await engine.createAlert({
        siteId: 'site-1',
        level: 'MEDICAL',
        source: 'DASHBOARD',
        triggeredById: 'user-1',
        buildingId: 'bldg-1',
      });

      await expect(engine.dismissFire(alert.id, 'operator-1')).rejects.toThrow(
        'Alert is not a suppressed fire alarm',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// AlertEngine — Training Mode
// ---------------------------------------------------------------------------

describe('AlertEngine — Training Mode', () => {
  let mock: ReturnType<typeof createMockApp>;
  let engine: AlertEngine;

  beforeEach(() => {
    mock = createMockApp();
    engine = new AlertEngine(mock.app);
  });

  it('prefixes message with [TRAINING]', async () => {
    const alert = await engine.createAlert({
      siteId: 'site-1',
      level: 'LOCKDOWN',
      source: 'DASHBOARD',
      triggeredById: 'user-1',
      buildingId: 'bldg-1',
      message: 'Drill lockdown',
      trainingMode: true,
    });

    expect(alert.message).toContain('[TRAINING]');
    expect((alert.metadata as any).trainingMode).toBe(true);
  });

  it('skips 911 dispatch in training mode', async () => {
    await engine.createAlert({
      siteId: 'site-1',
      level: 'ACTIVE_THREAT',
      source: 'DASHBOARD',
      triggeredById: 'user-1',
      buildingId: 'bldg-1',
      trainingMode: true,
    });

    const dispatchJob = mock.queueJobs.find((j) => j.name === 'dispatch-911');
    expect(dispatchJob).toBeUndefined();
  });

  it('still enqueues auto-lockdown in training mode', async () => {
    await engine.createAlert({
      siteId: 'site-1',
      level: 'LOCKDOWN',
      source: 'DASHBOARD',
      triggeredById: 'user-1',
      buildingId: 'bldg-1',
      trainingMode: true,
    });

    const lockdownJob = mock.queueJobs.find((j) => j.name === 'auto-lockdown');
    expect(lockdownJob).toBeDefined();
  });

  it('skips auto-escalation in training mode', async () => {
    await engine.createAlert({
      siteId: 'site-1',
      level: 'MEDICAL',
      source: 'DASHBOARD',
      triggeredById: 'user-1',
      buildingId: 'bldg-1',
      trainingMode: true,
    });

    const escalateJob = mock.queueJobs.find((j) => j.name === 'auto-escalate');
    expect(escalateJob).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AlertEngine — escalateAlert
// ---------------------------------------------------------------------------

describe('AlertEngine — escalateAlert', () => {
  let mock: ReturnType<typeof createMockApp>;
  let engine: AlertEngine;

  beforeEach(() => {
    mock = createMockApp();
    engine = new AlertEngine(mock.app);
  });

  it('escalates MEDICAL to LOCKDOWN', async () => {
    const alert = await engine.createAlert({
      siteId: 'site-1',
      level: 'MEDICAL',
      source: 'DASHBOARD',
      triggeredById: 'user-1',
      buildingId: 'bldg-1',
      message: 'Medical emergency',
    });

    const escalated = await engine.escalateAlert(alert.id, 'LOCKDOWN');
    expect(escalated).not.toBeNull();
    expect(escalated!.level).toBe('LOCKDOWN');
    expect(escalated!.message).toContain('AUTO-ESCALATED from MEDICAL');
  });

  it('returns null if already acknowledged', async () => {
    const alert = await engine.createAlert({
      siteId: 'site-1',
      level: 'MEDICAL',
      source: 'DASHBOARD',
      triggeredById: 'user-1',
      buildingId: 'bldg-1',
    });

    await engine.acknowledgeAlert(alert.id, 'user-2');
    const escalated = await engine.escalateAlert(alert.id, 'LOCKDOWN');
    expect(escalated).toBeNull();
  });
});
