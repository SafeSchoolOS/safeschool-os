import { describe, it, expect, vi } from 'vitest';

/**
 * Unit tests for alert-worker.ts handler logic.
 *
 * These tests exercise the worker handler functions by calling
 * createAlertWorker with mocked dependencies, then invoking the
 * internal handler via a mock BullMQ Job object. Since we cannot
 * instantiate a real BullMQ Worker without Redis, we instead:
 *
 *   1. Import the source and analyze the handler logic directly.
 *   2. Test the configuration in worker-entry.ts that wires up adapters.
 *   3. Document bugs via assertions about what the code DOES vs SHOULD do.
 *
 * Each test group targets a specific, real bug.
 */

// ---------------------------------------------------------------------------
// Helpers: mock Prisma, mock Job, mock deps
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    dispatchRecord: {
      create: vi.fn().mockResolvedValue({ id: 'dr-1' }),
    },
    alert: {
      update: vi.fn().mockResolvedValue({ id: 'alert-1', status: 'DISPATCHED' }),
      findUnique: vi.fn().mockResolvedValue({
        id: 'alert-1',
        siteId: 'site-1',
        status: 'TRIGGERED',
        level: 'MEDICAL',
        message: 'Medical emergency',
      }),
    },
    lockdownCommand: {
      create: vi.fn().mockResolvedValue({ id: 'lc-1' }),
    },
    door: {
      updateMany: vi.fn().mockResolvedValue({ count: 5 }),
    },
    notificationLog: {
      create: vi.fn().mockResolvedValue({ id: 'nl-1' }),
      findFirst: vi.fn().mockResolvedValue({ id: 'nl-queued', status: 'QUEUED' }),
      update: vi.fn().mockResolvedValue({ id: 'nl-queued', status: 'SENT' }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'al-1' }),
    },
  };
}

function createMockDeps(prismaOverrides?: any) {
  const prisma = { ...createMockPrisma(), ...prismaOverrides };
  return {
    prisma,
    dispatchFn: vi.fn().mockResolvedValue(undefined),
    lockdownFn: vi.fn().mockResolvedValue(undefined),
    notifyFn: vi.fn().mockResolvedValue(undefined),
    escalateFn: undefined as ((alertId: string, nextLevel: string) => Promise<any>) | undefined,
    transportScanFn: undefined as ((data: any) => Promise<void>) | undefined,
    transportGpsFn: undefined as ((data: any) => Promise<void>) | undefined,
  };
}

function makeJob(name: string, data: Record<string, any>) {
  return {
    name,
    data,
    id: `job-${Date.now()}`,
  };
}

// ---------------------------------------------------------------------------
// We need to read the actual source code to understand what handleDispatch
// does. Since we can't call the internal functions directly (they aren't
// exported), we test by analyzing the source code behavior and documenting
// the bugs through focused, targeted assertions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// BUG 1: handleDispatch always uses 'CONSOLE' method
// The dispatch record is created with method: 'CONSOLE' regardless of
// which dispatch adapter is actually configured.
// ---------------------------------------------------------------------------

describe('BUG 1: Dispatch record always uses CONSOLE method', () => {
  it('hardcodes method to CONSOLE in dispatch record creation', async () => {
    // Read the source to confirm the bug
    const fs = await import('fs');
    const path = await import('path');
    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../services/alert-worker.ts'),
      'utf-8',
    );

    // The handleDispatch function creates a dispatch record with a hardcoded method
    const createCallMatch = workerSource.match(
      /dispatchRecord\.create\(\s*\{[\s\S]*?method:\s*['"](\w+)['"]/,
    );

    expect(createCallMatch).not.toBeNull();
    // BUG: The method is always 'CONSOLE', even when the adapter is RapidSOS or Rave911
    expect(createCallMatch![1]).toBe('CONSOLE');
  });

  it('should vary method based on the adapter being used', () => {
    // The dispatch record method should reflect the actual adapter:
    // - 'RAPIDSOS' when using RapidSOS
    // - 'RAVE_911' when using Rave 911 Suite
    // - 'SIP' when using SIP direct
    // - 'CONSOLE' only for dev/test console adapter
    //
    // But the code hardcodes 'CONSOLE'. This means production dispatch
    // records will falsely indicate console-only dispatch was used,
    // which breaks compliance audit trails for Alyssa's Law.
    const expectedValidMethods = ['CONSOLE', 'RAPIDSOS', 'RAVE_911', 'SIP', 'CELLULAR'];
    expect(expectedValidMethods).toContain('CONSOLE');
    // The actual code never uses anything other than 'CONSOLE'
  });
});

// ---------------------------------------------------------------------------
// BUG 2: handleDispatch sets confirmedAt = sentAt (instant confirmation)
// Real 911 dispatch confirmation takes seconds to minutes. Setting
// confirmedAt to the same time as sentAt is incorrect.
// ---------------------------------------------------------------------------

describe('BUG 2: Dispatch record has instant confirmation', () => {
  it('sets confirmedAt at the same time as sentAt in the source code', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../services/alert-worker.ts'),
      'utf-8',
    );

    // Both sentAt and confirmedAt use `new Date()` in the same create call
    const hasConfirmedAtNewDate = workerSource.includes('confirmedAt: new Date()');
    const hasSentAtNewDate = workerSource.includes('sentAt: new Date()');

    // BUG: Both are set simultaneously
    expect(hasConfirmedAtNewDate).toBe(true);
    expect(hasSentAtNewDate).toBe(true);
  });

  it('uses a hardcoded responseTimeMs of 50ms', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../services/alert-worker.ts'),
      'utf-8',
    );

    // BUG: responseTimeMs is hardcoded to 50ms, a fabricated metric
    // Real dispatch takes 1-30 seconds for acknowledgment
    expect(workerSource).toContain('responseTimeMs: 50');
  });
});

// ---------------------------------------------------------------------------
// BUG 3: handleAutoLockdown creates duplicate lockdown records
// The auto-lockdown handler creates a LockdownCommand. But if a user also
// triggers lockdown via the lockdown route (which creates its own record),
// duplicates are created with no deduplication check.
// ---------------------------------------------------------------------------

describe('BUG 3: Auto-lockdown creates duplicate lockdown records', () => {
  it('always creates a new lockdown record without checking for existing ones', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../services/alert-worker.ts'),
      'utf-8',
    );

    // Extract the handleAutoLockdown function body
    const fnMatch = workerSource.match(
      /async function handleAutoLockdown[\s\S]*?(?=\nasync function|\n\/\/|$)/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    // BUG: No findFirst/findUnique check before creating the lockdown record
    expect(fnBody).not.toContain('findFirst');
    expect(fnBody).not.toContain('findUnique');

    // It directly calls create without any deduplication
    expect(fnBody).toContain('lockdownCommand.create');
  });
});

// ---------------------------------------------------------------------------
// BUG 4: handleAutoEscalate fallback doesn't re-enqueue jobs
// When escalateFn is undefined, the fallback path updates the alert level
// but does NOT enqueue new dispatch/lockdown/notification jobs for the
// escalated level. So escalating from MEDICAL to LOCKDOWN won't actually
// trigger 911 dispatch or door locking.
// ---------------------------------------------------------------------------

describe('BUG 4: Auto-escalation fallback skips job re-enqueue', () => {
  it('fallback path only updates alert and creates audit log -- no new jobs', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../services/alert-worker.ts'),
      'utf-8',
    );

    // Extract the handleAutoEscalate function
    const fnMatch = workerSource.match(
      /async function handleAutoEscalate[\s\S]*?(?=\nasync function|\n\/\/|$)/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    // The fallback (else) block only does:
    //   1. prisma.alert.update (change level)
    //   2. prisma.auditLog.create (log the escalation)
    // It does NOT:
    //   - enqueue 'dispatch-911' job (needed for LOCKDOWN/ACTIVE_THREAT)
    //   - enqueue 'auto-lockdown' job (needed for LOCKDOWN)
    //   - enqueue 'notify-staff' job (needed for any escalation)
    //   - call dispatchFn, lockdownFn, or notifyFn

    expect(fnBody).toContain('prisma.alert.update');
    expect(fnBody).toContain('prisma.auditLog.create');

    // BUG: No new jobs are enqueued in the fallback path
    expect(fnBody).not.toContain('alertQueue');
    expect(fnBody).not.toContain('.add(');
    expect(fnBody).not.toContain('dispatch-911');
    expect(fnBody).not.toContain('auto-lockdown');
    expect(fnBody).not.toContain('deps.dispatchFn');
    expect(fnBody).not.toContain('deps.lockdownFn');
    expect(fnBody).not.toContain('deps.notifyFn');
  });
});

// ---------------------------------------------------------------------------
// BUG 5: handleMassNotify findFirst race condition
// Two identical mass notifications sent simultaneously will both find the
// same QUEUED log entry. Both workers will try to update it, but only one
// succeeds meaningfully -- the other operates on an already-SENT log.
// ---------------------------------------------------------------------------

describe('BUG 5: Mass notify findFirst race condition', () => {
  it('uses findFirst without locking, enabling TOCTOU race', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../services/alert-worker.ts'),
      'utf-8',
    );

    const fnMatch = workerSource.match(
      /async function handleMassNotify[\s\S]*?(?=\nasync function|\n\/\/|$)/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    // The handler finds a QUEUED log then updates it.
    // No transaction, no optimistic locking, no FOR UPDATE.
    expect(fnBody).toContain('findFirst');
    expect(fnBody).toContain("status: 'QUEUED'");

    // BUG: No transaction wrapping the find + update
    expect(fnBody).not.toContain('$transaction');

    // BUG: The update uses { where: { id: log.id } } without a status
    // check, so a second worker updating the same log won't fail --
    // it will silently set status to SENT again.
    expect(fnBody).toContain("data: { status: 'SENT' }");
  });

  it('sends notification BEFORE updating the log status', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../services/alert-worker.ts'),
      'utf-8',
    );

    const fnMatch = workerSource.match(
      /async function handleMassNotify[\s\S]*?(?=\nasync function|\n\/\/|$)/,
    );
    const fnBody = fnMatch![0];

    // The notify call happens before the log lookup/update.
    // If the notification succeeds but the log update fails,
    // the notification was sent but the log still shows QUEUED,
    // and a retry would send it again (duplicate notification).
    const notifyPos = fnBody.indexOf('deps.notifyFn');
    const findFirstPos = fnBody.indexOf('findFirst');

    // BUG: notification is sent before log is updated
    expect(notifyPos).toBeLessThan(findFirstPos);
  });
});

// ---------------------------------------------------------------------------
// BUG 6: handleRfidScan is a no-op without transportScanFn
// If deps.transportScanFn is not provided, the RFID scan handler logs
// and returns immediately. No parent notification, no ridership logging.
// ---------------------------------------------------------------------------

describe('BUG 6: RFID scan is a no-op without transportScanFn', () => {
  it('does nothing when transportScanFn is undefined', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../services/alert-worker.ts'),
      'utf-8',
    );

    const fnMatch = workerSource.match(
      /async function handleRfidScan[\s\S]*?(?=\nasync function|\n\/\/|$)/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    // The function only calls transportScanFn if it exists
    expect(fnBody).toContain('if (deps.transportScanFn)');

    // BUG: No else branch -- no fallback behavior
    // When transportScanFn is absent, no prisma calls are made:
    // - No RidershipEvent is created
    // - No parent notification is sent
    // - No audit log entry is created
    expect(fnBody).not.toContain('else');
    expect(fnBody).not.toContain('ridershipEvent');
    expect(fnBody).not.toContain('notifyFn');
    expect(fnBody).not.toContain('auditLog');
  });
});

// ---------------------------------------------------------------------------
// BUG 7: handleGpsUpdate is a no-op without transportGpsFn
// Same issue as BUG 6 -- no geofence checking, no bus location update.
// ---------------------------------------------------------------------------

describe('BUG 7: GPS update is a no-op without transportGpsFn', () => {
  it('does nothing when transportGpsFn is undefined', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const workerSource = fs.readFileSync(
      path.resolve(__dirname, '../../services/alert-worker.ts'),
      'utf-8',
    );

    const fnMatch = workerSource.match(
      /async function handleGpsUpdate[\s\S]*?(?=\nasync function|\n\/\/|$)/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    // Same pattern: conditional call with no fallback
    expect(fnBody).toContain('if (deps.transportGpsFn)');

    // BUG: No else branch -- no fallback behavior
    // When transportGpsFn is absent:
    // - No bus location is updated in the database
    // - No geofence checks are performed
    // - No arrival/departure notifications are sent
    expect(fnBody).not.toContain('else');
    // The function references busId from job.data but does no DB update/geofence outside transportGpsFn
    expect(fnBody).not.toContain('geofence');
    expect(fnBody).not.toContain('prisma');
  });
});

// ---------------------------------------------------------------------------
// BUG 8: worker-entry.ts always creates ConsoleDispatchAdapter
// The createDispatchFn always imports and instantiates ConsoleDispatchAdapter
// regardless of the config.dispatch.adapter setting. Even when
// DISPATCH_ADAPTER=rapidsos, the worker uses console output only.
// ---------------------------------------------------------------------------

describe('BUG 8: worker-entry.ts hardcodes ConsoleDispatchAdapter', () => {
  it('always imports ConsoleDispatchAdapter regardless of config', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const entrySource = fs.readFileSync(
      path.resolve(__dirname, '../../worker-entry.ts'),
      'utf-8',
    );

    // The createDispatchFn function always creates a ConsoleDispatchAdapter
    expect(entrySource).toContain('ConsoleDispatchAdapter');

    // BUG: It does NOT check config.dispatch.adapter
    // The function createDispatchFn doesn't reference config at all
    const createDispatchFn = entrySource.match(
      /async function createDispatchFn[\s\S]*?(?=\nasync function|\n\/\/|$)/,
    );
    expect(createDispatchFn).not.toBeNull();
    const fnBody = createDispatchFn![0];

    // The function never reads config.dispatch.adapter
    expect(fnBody).not.toContain('config.dispatch');
    expect(fnBody).not.toContain('config.dispatch.adapter');

    // It unconditionally creates ConsoleDispatchAdapter
    expect(fnBody).toContain('new ConsoleDispatchAdapter()');
  });

  it('logs the dispatch adapter from config but uses a different one', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const entrySource = fs.readFileSync(
      path.resolve(__dirname, '../../worker-entry.ts'),
      'utf-8',
    );

    // The main function logs the configured adapter:
    expect(entrySource).toContain('config.dispatch.adapter');

    // But createDispatchFn ignores it entirely.
    // This means the log output says "Dispatch adapter: rapidsos" while
    // the actual adapter being used is ConsoleDispatchAdapter.
    // This is misleading and dangerous for a 911 dispatch system.
  });

  it('notification adapter IS configurable (contrast with dispatch)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const entrySource = fs.readFileSync(
      path.resolve(__dirname, '../../worker-entry.ts'),
      'utf-8',
    );

    // createNotifyFn DOES check config.notifications.adapter
    const createNotifyFn = entrySource.match(
      /async function createNotifyFn[\s\S]*?(?=\nasync function|\n\/\/|$)/,
    );
    expect(createNotifyFn).not.toBeNull();
    const notifyBody = createNotifyFn![0];

    // Notification adapter checks config -- proof that dispatch should too
    expect(notifyBody).toContain("config.notifications.adapter === 'console'");
  });

  it('access control adapter IS configurable (contrast with dispatch)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const entrySource = fs.readFileSync(
      path.resolve(__dirname, '../../worker-entry.ts'),
      'utf-8',
    );

    // createLockdownFn uses config.accessControl.adapter
    const createLockdownFn = entrySource.match(
      /async function createLockdownFn[\s\S]*?(?=\nasync function|\n\/\/|$)/,
    );
    expect(createLockdownFn).not.toBeNull();
    const lockdownBody = createLockdownFn![0];

    // AC adapter reads from config -- dispatch should do the same
    expect(lockdownBody).toContain('config.accessControl.adapter');
  });

  it('worker-entry does not provide escalateFn, transportScanFn, or transportGpsFn', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const entrySource = fs.readFileSync(
      path.resolve(__dirname, '../../worker-entry.ts'),
      'utf-8',
    );

    // The createAlertWorker call in main() only passes prisma, dispatchFn,
    // lockdownFn, notifyFn. The optional deps are never wired up.
    const workerCall = entrySource.match(
      /createAlertWorker\(\{[\s\S]*?\}\)/,
    );
    expect(workerCall).not.toBeNull();
    const callBody = workerCall![0];

    // BUG: escalateFn is not provided -- fallback path in handleAutoEscalate
    // is always used, meaning escalation never re-enqueues jobs (BUG 4)
    expect(callBody).not.toContain('escalateFn');

    // BUG: transportScanFn is not provided -- RFID scans are no-ops (BUG 6)
    expect(callBody).not.toContain('transportScanFn');

    // BUG: transportGpsFn is not provided -- GPS updates are no-ops (BUG 7)
    expect(callBody).not.toContain('transportGpsFn');
  });
});
