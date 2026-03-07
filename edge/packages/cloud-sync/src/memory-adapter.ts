/**
 * In-Memory Sync Database Adapter
 *
 * Reference implementation for testing and development.
 * Stores everything in memory — resets on restart.
 *
 * Production adapters should implement SyncDatabaseAdapter
 * backed by Prisma, Drizzle, raw SQL, etc.
 */

import crypto from 'node:crypto';
import type { SyncDatabaseAdapter, LicenseDatabaseAdapter, UserDatabaseAdapter, SyncEntity, EdgeDevice, FleetSummary, OrgLicense, DashboardUser, OAuthProvider, EntityQueryParams, EntityQueryResult, DeviceConfigRecord, DeviceConfigPayload } from './types.js';

export class MemoryAdapter implements SyncDatabaseAdapter, LicenseDatabaseAdapter, UserDatabaseAdapter {
  /** Stored entities: type -> array of records */
  private entities: Map<string, Map<string, Record<string, unknown>>> = new Map();
  /** Device registry: siteId -> device */
  private devices: Map<string, EdgeDevice> = new Map();
  /** License registry: orgId -> license */
  private licenses: Map<string, OrgLicense> = new Map();
  /** User registry: id -> user */
  private users: Map<string, DashboardUser> = new Map();
  /** Device config registry: siteId -> config record */
  private deviceConfigs: Map<string, DeviceConfigRecord> = new Map();

  async processPush(siteId: string, entities: SyncEntity[], orgId?: string): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    for (const entity of entities) {
      try {
        if (!this.entities.has(entity.type)) {
          this.entities.set(entity.type, new Map());
        }
        const store = this.entities.get(entity.type)!;

        const id = (entity.data.id as string) ?? `${siteId}_${Date.now()}_${synced}`;

        if (entity.action === 'delete') {
          store.delete(id);
        } else {
          store.set(id, {
            ...entity.data,
            id,
            siteId,
            ...(orgId ? { orgId } : {}),
            _syncAction: entity.action,
            _syncTimestamp: entity.timestamp,
            updatedAt: entity.timestamp,
          });
        }
        synced++;
      } catch {
        errors++;
      }
    }

    return { synced, errors };
  }

  async processPull(siteId: string, since: Date, entityTypes: string[], orgId?: string): Promise<Record<string, unknown[]>> {
    const result: Record<string, unknown[]> = {};
    const sinceMs = since.getTime();

    const types = entityTypes.length > 0
      ? entityTypes
      : Array.from(this.entities.keys());

    for (const type of types) {
      const store = this.entities.get(type);
      if (!store) {
        result[type] = [];
        continue;
      }

      result[type] = Array.from(store.values()).filter(record => {
        // Filter by org — records from a different org are never returned
        if (orgId && record.orgId && record.orgId !== orgId) return false;
        // Filter by site
        if (record.siteId && record.siteId !== siteId) return false;
        // Filter by timestamp
        const ts = record._syncTimestamp ?? record.updatedAt;
        if (ts) {
          return new Date(ts as string).getTime() >= sinceMs;
        }
        return true;
      });
    }

    return result;
  }

  async upsertDevice(device: {
    siteId: string;
    orgId?: string;
    hostname?: string;
    ipAddress?: string;
    apiPort?: number;
    version?: string;
    nodeVersion?: string;
    mode: string;
    pendingChanges: number;
    diskUsagePercent?: number;
    memoryUsageMb?: number;
    upgradeStatus?: string;
    upgradeError?: string;
  }): Promise<EdgeDevice> {
    const existing = this.devices.get(device.siteId);
    const now = new Date();

    const updated: EdgeDevice = {
      id: existing?.id ?? device.siteId,
      siteId: device.siteId,
      orgId: device.orgId ?? existing?.orgId,
      hostname: device.hostname ?? existing?.hostname,
      ipAddress: device.ipAddress ?? existing?.ipAddress,
      apiPort: device.apiPort ?? existing?.apiPort,
      version: device.version ?? existing?.version,
      nodeVersion: device.nodeVersion ?? existing?.nodeVersion,
      mode: device.mode,
      pendingChanges: device.pendingChanges,
      diskUsagePercent: device.diskUsagePercent ?? existing?.diskUsagePercent,
      memoryUsageMb: device.memoryUsageMb ?? existing?.memoryUsageMb,
      lastHeartbeatAt: now,
      targetVersion: existing?.targetVersion,
      upgradeStatus: (device.upgradeStatus as EdgeDevice['upgradeStatus']) ?? existing?.upgradeStatus ?? 'IDLE',
      upgradeError: device.upgradeError ?? existing?.upgradeError,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    // Clear upgrade state on success
    if (device.upgradeStatus === 'SUCCESS' && updated.targetVersion === device.version) {
      updated.targetVersion = undefined;
      updated.upgradeStatus = 'IDLE';
      updated.upgradeError = undefined;
    }

    this.devices.set(device.siteId, updated);
    return updated;
  }

  async getDevice(siteId: string): Promise<EdgeDevice | null> {
    return this.devices.get(siteId) ?? null;
  }

  async listDevices(orgId?: string): Promise<EdgeDevice[]> {
    const devices = Array.from(this.devices.values());
    if (orgId) {
      return devices.filter(d => d.orgId === orgId);
    }
    return devices;
  }

  async setDeviceTargetVersion(siteId: string, targetVersion: string): Promise<void> {
    const device = this.devices.get(siteId);
    if (device) {
      device.targetVersion = targetVersion;
      device.upgradeStatus = 'PENDING';
      device.upgradeError = undefined;
      device.updatedAt = new Date();
    }
  }

  async setAllDevicesTargetVersion(targetVersion: string, orgId?: string): Promise<number> {
    let count = 0;
    for (const device of this.devices.values()) {
      if (orgId && device.orgId !== orgId) continue;
      if (device.upgradeStatus === 'IDLE' || !device.upgradeStatus) {
        device.targetVersion = targetVersion;
        device.upgradeStatus = 'PENDING';
        device.upgradeError = undefined;
        device.updatedAt = new Date();
        count++;
      }
    }
    return count;
  }

  async getFleetSummary(offlineThresholdMs: number, orgId?: string): Promise<FleetSummary> {
    const now = Date.now();
    let devices = Array.from(this.devices.values());
    if (orgId) {
      devices = devices.filter(d => d.orgId === orgId);
    }

    const versionDistribution: Record<string, number> = {};
    const upgradeStatus = { idle: 0, pending: 0, inProgress: 0, success: 0, failed: 0 };
    let online = 0;

    for (const d of devices) {
      if ((now - d.lastHeartbeatAt.getTime()) < offlineThresholdMs) online++;

      const ver = d.version ?? 'unknown';
      versionDistribution[ver] = (versionDistribution[ver] ?? 0) + 1;

      switch (d.upgradeStatus) {
        case 'PENDING': upgradeStatus.pending++; break;
        case 'IN_PROGRESS': upgradeStatus.inProgress++; break;
        case 'SUCCESS': upgradeStatus.success++; break;
        case 'FAILED': upgradeStatus.failed++; break;
        default: upgradeStatus.idle++; break;
      }
    }

    return {
      totalDevices: devices.length,
      onlineDevices: online,
      offlineDevices: devices.length - online,
      versionDistribution,
      upgradeStatus,
    };
  }

  // ─── Entity Query ───────────────────────────────────────────────

  async queryEntities(params: EntityQueryParams): Promise<EntityQueryResult> {
    const {
      entityType, orgId, siteId, since, until,
      limit = 100, offset = 0,
      filters, sortBy = '_syncTimestamp', sortOrder = 'desc',
    } = params;

    // Support querying across multiple entity types
    const types = Array.isArray(entityType) ? entityType : [entityType];
    let records: Record<string, unknown>[] = [];
    for (const t of types) {
      const store = this.entities.get(t);
      if (store) {
        records.push(...Array.from(store.values()).map(r => ({ ...r, _entityType: t })));
      }
    }
    if (records.length === 0) return { entities: [], total: 0, limit, offset };

    // Filter by orgId
    if (orgId) records = records.filter(r => r.orgId === orgId);
    // Filter by siteId
    if (siteId) records = records.filter(r => r.siteId === siteId);
    // Filter by time range
    if (since) {
      const sinceMs = since.getTime();
      records = records.filter(r => {
        const ts = r._syncTimestamp ?? r.updatedAt;
        return ts ? new Date(ts as string).getTime() >= sinceMs : true;
      });
    }
    if (until) {
      const untilMs = until.getTime();
      records = records.filter(r => {
        const ts = r._syncTimestamp ?? r.updatedAt;
        return ts ? new Date(ts as string).getTime() <= untilMs : true;
      });
    }
    // Generic field filters
    if (filters) {
      for (const [field, value] of Object.entries(filters)) {
        records = records.filter(r => r[field] === value);
      }
    }

    // Sort
    records.sort((a, b) => {
      const aVal = a[sortBy] as string | undefined;
      const bVal = b[sortBy] as string | undefined;
      if (!aVal && !bVal) return 0;
      if (!aVal) return 1;
      if (!bVal) return -1;
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    const total = records.length;
    const paged = records.slice(offset, offset + limit);

    return { entities: paged, total, limit, offset };
  }

  // ─── LicenseDatabaseAdapter ──────────────────────────────────────

  async getLicense(orgId: string): Promise<OrgLicense | null> {
    return this.licenses.get(orgId) ?? null;
  }

  async listLicenses(): Promise<OrgLicense[]> {
    return Array.from(this.licenses.values());
  }

  async upsertLicense(license: OrgLicense): Promise<OrgLicense> {
    this.licenses.set(license.orgId, license);
    return license;
  }

  async deleteLicense(orgId: string): Promise<void> {
    this.licenses.delete(orgId);
  }

  // ─── UserDatabaseAdapter ───────────────────────────────────────

  async findByProviderAndId(provider: string, providerId: string): Promise<DashboardUser | null> {
    for (const user of this.users.values()) {
      if (user.provider === provider && user.providerId === providerId) return user;
    }
    return null;
  }

  async findByEmail(email: string): Promise<DashboardUser | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async upsertUser(data: {
    email: string; displayName?: string; avatarUrl?: string;
    provider: OAuthProvider; providerId?: string; orgId: string; role?: string;
  }): Promise<DashboardUser> {
    // Find existing by provider+id or by email
    let existing: DashboardUser | null = null;
    if (data.providerId) {
      existing = await this.findByProviderAndId(data.provider, data.providerId);
    }
    if (!existing) {
      existing = await this.findByEmail(data.email);
    }

    const now = new Date();
    const user: DashboardUser = {
      id: existing?.id ?? crypto.randomUUID(),
      email: data.email,
      displayName: data.displayName ?? existing?.displayName,
      avatarUrl: data.avatarUrl ?? existing?.avatarUrl,
      provider: data.provider,
      providerId: data.providerId ?? existing?.providerId,
      orgId: data.orgId,
      role: existing?.role ?? data.role ?? 'viewer',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.users.set(user.id, user);
    return user;
  }

  async listUsers(orgId?: string): Promise<DashboardUser[]> {
    const users = Array.from(this.users.values());
    if (orgId) return users.filter(u => u.orgId === orgId);
    return users;
  }

  async findById(userId: string): Promise<DashboardUser | null> {
    return this.users.get(userId) ?? null;
  }

  async deleteUser(userId: string): Promise<boolean> {
    return this.users.delete(userId);
  }

  async updateUserRole(userId: string, role: string): Promise<DashboardUser | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    user.role = role;
    user.updatedAt = new Date();
    return user;
  }

  // ─── DeviceConfig ───────────────────────────────────────────────

  async getDeviceConfig(siteId: string): Promise<DeviceConfigRecord | null> {
    return this.deviceConfigs.get(siteId) ?? null;
  }

  async setDeviceConfig(siteId: string, partial: Partial<DeviceConfigPayload>): Promise<DeviceConfigRecord> {
    const existing = this.deviceConfigs.get(siteId);
    const currentVersion = existing?.config.version ?? 0;
    const config: DeviceConfigPayload = {
      ...(existing?.config ?? {}),
      ...partial,
      version: currentVersion + 1,
    };
    const record: DeviceConfigRecord = {
      siteId,
      config,
      appliedVersion: existing?.appliedVersion,
      updatedAt: new Date(),
    };
    this.deviceConfigs.set(siteId, record);
    return record;
  }

  async ackDeviceConfig(siteId: string, version: number): Promise<void> {
    const record = this.deviceConfigs.get(siteId);
    if (record) {
      record.appliedVersion = version;
    }
  }

  /** Clear all data (for testing) */
  clear(): void {
    this.entities.clear();
    this.devices.clear();
    this.licenses.clear();
    this.users.clear();
    this.deviceConfigs.clear();
  }
}
