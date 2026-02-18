import type {
  AccessControlAdapter,
  AccessControlConfig,
  CardholderData,
  CredentialData,
  CredentialManagementAdapter,
  DoorCommandResult,
  DoorEvent,
  DoorStatus,
  ImportedCardholder,
  LockdownResult,
  ProvisionedCredential,
} from '@safeschool/core';

/**
 * Mock Access Control Adapter for development.
 * Simulates door locking/unlocking and credential management with in-memory state.
 */
export class MockAccessControlAdapter implements AccessControlAdapter, CredentialManagementAdapter {
  name = 'Mock';
  vendor = 'Mock (Dev)';
  supportsCredentialManagement = true as const;

  private doorStatuses = new Map<string, DoorStatus>();
  private eventCallbacks: ((event: DoorEvent) => void)[] = [];
  private lockdownCounter = 0;

  // In-memory credential management stores
  private cardholders = new Map<string, CardholderData & { externalId: string }>();
  private credentials = new Map<string, { externalId: string; cardholderId: string; type: string; zones: string[]; expiresAt?: Date }>();
  private idCounter = 0;

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
    console.log(`[MockAC] BUILDING LOCKDOWN: ${buildingId} (${lockdownId})`);
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
    console.log(`[MockAC] ZONE LOCKDOWN: ${zoneId} (${lockdownId})`);
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
    console.log(`[MockAC] LOCKDOWN RELEASED: ${lockdownId}`);
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

  // ---- CredentialManagementAdapter implementation ----

  async createCardholder(data: CardholderData): Promise<{ externalId: string }> {
    const externalId = `mock-ch-${++this.idCounter}`;
    this.cardholders.set(externalId, { ...data, externalId });
    console.log(`[MockAC] Cardholder created: ${data.firstName} ${data.lastName} (${externalId})`);
    return { externalId };
  }

  async updateCardholder(externalId: string, data: Partial<CardholderData>): Promise<void> {
    const existing = this.cardholders.get(externalId);
    if (existing) {
      this.cardholders.set(externalId, { ...existing, ...data });
    }
    console.log(`[MockAC] Cardholder updated: ${externalId}`);
  }

  async deleteCardholder(externalId: string): Promise<void> {
    this.cardholders.delete(externalId);
    console.log(`[MockAC] Cardholder deleted: ${externalId}`);
  }

  async importCardholders(): Promise<ImportedCardholder[]> {
    console.log('[MockAC] Import cardholders (returning mock data)');
    return Array.from(this.cardholders.values()).map((ch) => ({
      externalId: ch.externalId,
      firstName: ch.firstName,
      lastName: ch.lastName,
      email: ch.email,
      phone: ch.phone,
      company: ch.company,
      title: ch.title,
      personType: ch.personType,
      credentials: [],
    }));
  }

  async provisionCredential(data: CredentialData): Promise<ProvisionedCredential> {
    const externalId = `mock-cred-${++this.idCounter}`;
    this.credentials.set(externalId, {
      externalId,
      cardholderId: data.cardholderExternalId,
      type: data.credentialType,
      zones: data.accessZoneIds,
      expiresAt: data.expiresAt,
    });
    console.log(`[MockAC] Credential provisioned: ${data.credentialType} for ${data.cardholderExternalId} (${externalId})`);
    return {
      externalId,
      cardNumber: data.cardNumber || `MC-${this.idCounter}`,
      credentialType: data.credentialType,
      issuedAt: new Date(),
      expiresAt: data.expiresAt,
    };
  }

  async revokeCredential(externalCredentialId: string, reason?: string): Promise<void> {
    this.credentials.delete(externalCredentialId);
    console.log(`[MockAC] Credential revoked: ${externalCredentialId} (${reason || 'no reason'})`);
  }

  async revokeAllTemporaryCredentials(_siteId?: string): Promise<{ revokedCount: number }> {
    let count = 0;
    for (const [id, cred] of this.credentials) {
      if (cred.type === 'TEMPORARY_CARD' || cred.type === 'MOBILE') {
        this.credentials.delete(id);
        count++;
      }
    }
    console.log(`[MockAC] Revoked ${count} temporary credentials`);
    return { revokedCount: count };
  }

  async listAccessZones(): Promise<Array<{ externalId: string; name: string; doorCount: number }>> {
    console.log('[MockAC] List access zones (returning mock data)');
    return [
      { externalId: 'mock-zone-all', name: 'All Doors', doorCount: 8 },
      { externalId: 'mock-zone-admin', name: 'Admin Wing', doorCount: 2 },
      { externalId: 'mock-zone-visitor', name: 'Visitor Access', doorCount: 3 },
    ];
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
