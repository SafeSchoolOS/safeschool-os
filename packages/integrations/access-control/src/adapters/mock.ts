import type {
  AccessControlAdapter,
  AccessControlConfig,
  DoorCommandResult,
  DoorEvent,
  DoorStatus,
  LockdownResult,
} from '@safeschool/core';

/**
 * Mock Access Control Adapter for development.
 * Simulates door locking/unlocking with in-memory state.
 */
export class MockAccessControlAdapter implements AccessControlAdapter {
  name = 'Mock';
  vendor = 'Mock (Dev)';

  private doorStatuses = new Map<string, DoorStatus>();
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];
  private lockdownCounter = 0;

  async connect(_config: AccessControlConfig): Promise<void> {
    console.log('[MockAC] Connected (in-memory mock)');
  }

  async disconnect(): Promise<void> {
    this.doorStatuses.clear();
    console.log('[MockAC] Disconnected');
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async lockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    this.doorStatuses.set(doorId, 'LOCKED' as DoorStatus);
    this.emitEvent(doorId, 'LOCKED');
    console.log(`[MockAC] Door ${doorId} LOCKED`);
    return {
      success: true,
      doorId,
      newStatus: 'LOCKED' as DoorStatus,
      executionTimeMs: Date.now() - start,
    };
  }

  async unlockDoor(doorId: string): Promise<DoorCommandResult> {
    const start = Date.now();
    this.doorStatuses.set(doorId, 'UNLOCKED' as DoorStatus);
    this.emitEvent(doorId, 'UNLOCKED');
    console.log(`[MockAC] Door ${doorId} UNLOCKED`);
    return {
      success: true,
      doorId,
      newStatus: 'UNLOCKED' as DoorStatus,
      executionTimeMs: Date.now() - start,
    };
  }

  async lockdownBuilding(buildingId: string): Promise<LockdownResult> {
    const start = Date.now();
    const lockdownId = `mock-lockdown-${++this.lockdownCounter}`;
    console.log(`[MockAC] 🔒 BUILDING LOCKDOWN: ${buildingId} (${lockdownId})`);
    return {
      lockdownId,
      status: 'COMPLETE',
      doorsLocked: 8,
      doorsFailed: [],
      timeToCompleteMs: Date.now() - start,
      timestamp: new Date(),
    };
  }

  async lockdownZone(zoneId: string): Promise<LockdownResult> {
    const start = Date.now();
    const lockdownId = `mock-lockdown-${++this.lockdownCounter}`;
    console.log(`[MockAC] 🔒 ZONE LOCKDOWN: ${zoneId} (${lockdownId})`);
    return {
      lockdownId,
      status: 'COMPLETE',
      doorsLocked: 3,
      doorsFailed: [],
      timeToCompleteMs: Date.now() - start,
      timestamp: new Date(),
    };
  }

  async releaseLockdown(lockdownId: string): Promise<LockdownResult> {
    const start = Date.now();
    console.log(`[MockAC] 🔓 LOCKDOWN RELEASED: ${lockdownId}`);
    return {
      lockdownId,
      status: 'COMPLETE',
      doorsLocked: 0,
      doorsFailed: [],
      timeToCompleteMs: Date.now() - start,
      timestamp: new Date(),
    };
  }

  async getDoorStatus(doorId: string): Promise<DoorStatus> {
    return (this.doorStatuses.get(doorId) as DoorStatus) || ('LOCKED' as DoorStatus);
  }

  async getAllDoorStatuses(): Promise<Map<string, DoorStatus>> {
    return new Map(this.doorStatuses);
  }

  onDoorEvent(callback: (event: DoorEvent) => void): void {
    this.eventCallbacks.push(callback);
  }

  private emitEvent(doorId: string, eventType: string): void {
    const event: DoorEvent = {
      doorId,
      doorName: `Door ${doorId}`,
      eventType: eventType as any,
      timestamp: new Date(),
    };
    for (const cb of this.eventCallbacks) {
      cb(event);
    }
  }
}
