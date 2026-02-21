/**
 * SafeSchool Prisma-backed SyncDatabaseAdapter
 *
 * Implements @edgeruntime/cloud-sync's SyncDatabaseAdapter interface
 * using SafeSchool's Prisma client. Handles entity whitelisting,
 * field sanitization, and maps to existing Prisma models.
 *
 * Types are inlined here so the SafeSchool repo can build without
 * @edgeruntime/cloud-sync installed — the package is only needed at
 * runtime (loaded via dynamic import in server.ts).
 */

import type { PrismaClient } from '@prisma/client';
import { sanitizeText } from '../utils/sanitize.js';

// ─── Inlined types from @edgeruntime/cloud-sync ─────────────────────────

export interface SyncEntity {
  type: string;
  action: 'create' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: string;
}

export interface EdgeDevice {
  id: string;
  siteId: string;
  hostname?: string;
  ipAddress?: string;
  version?: string;
  nodeVersion?: string;
  mode: string;
  pendingChanges: number;
  diskUsagePercent?: number;
  memoryUsageMb?: number;
  lastHeartbeatAt: Date;
  targetVersion?: string;
  upgradeStatus?: 'IDLE' | 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';
  upgradeError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FleetSummary {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  versionDistribution: Record<string, number>;
  upgradeStatus: {
    idle: number;
    pending: number;
    inProgress: number;
    success: number;
    failed: number;
  };
}

export interface SyncDatabaseAdapter {
  processPush(siteId: string, entities: SyncEntity[]): Promise<{ synced: number; errors: number }>;
  processPull(siteId: string, since: Date, entityTypes: string[]): Promise<Record<string, unknown[]>>;
  upsertDevice(device: {
    siteId: string; hostname?: string; ipAddress?: string; version?: string;
    nodeVersion?: string; mode: string; pendingChanges: number;
    diskUsagePercent?: number; memoryUsageMb?: number;
    upgradeStatus?: string; upgradeError?: string;
  }): Promise<EdgeDevice>;
  getDevice(siteId: string): Promise<EdgeDevice | null>;
  listDevices(): Promise<EdgeDevice[]>;
  setDeviceTargetVersion(siteId: string, targetVersion: string): Promise<void>;
  setAllDevicesTargetVersion(targetVersion: string): Promise<number>;
  getFleetSummary(offlineThresholdMs: number): Promise<FleetSummary>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_PUSH_TYPES = new Set([
  'alert', 'visitor', 'door', 'audit_log', 'lockdown_command',
]);

export class SafeSchoolSyncAdapter implements SyncDatabaseAdapter {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── Push (Edge → Cloud) ────────────────────────────────────────

  async processPush(siteId: string, entities: SyncEntity[]): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    for (const entity of entities) {
      if (!ALLOWED_PUSH_TYPES.has(entity.type)) {
        errors++;
        continue;
      }
      if (!entity.data?.id || typeof entity.data.id !== 'string' || !UUID_RE.test(entity.data.id)) {
        errors++;
        continue;
      }

      try {
        const d = entity.data;
        switch (entity.type) {
          case 'alert': {
            if (entity.action === 'create' || entity.action === 'update') {
              const safe = {
                id: d.id as string, siteId,
                level: d.level as string, status: d.status as string,
                source: d.source as string, triggeredById: d.triggeredById as string,
                buildingId: d.buildingId as string, buildingName: (d.buildingName || '') as string,
                floor: d.floor as string, roomId: d.roomId as string,
                message: d.message ? sanitizeText(d.message as string) : null,
                triggeredAt: d.triggeredAt ? new Date(d.triggeredAt as string) : new Date(),
              } as any;
              await this.prisma.alert.upsert({
                where: { id: safe.id },
                update: safe,
                create: safe,
              });
            }
            break;
          }
          case 'visitor': {
            if (entity.action === 'create' || entity.action === 'update') {
              const safe = {
                id: d.id as string, siteId,
                firstName: d.firstName ? sanitizeText(d.firstName as string) : '',
                lastName: d.lastName ? sanitizeText(d.lastName as string) : '',
                company: d.company ? sanitizeText(d.company as string) : undefined,
                hostName: d.hostName ? sanitizeText(d.hostName as string) : undefined,
                purpose: d.purpose ? sanitizeText(d.purpose as string) : '',
                destination: d.destination ? sanitizeText(d.destination as string) : '',
                status: d.status as string,
                checkedInAt: d.checkedInAt as string,
                checkedOutAt: d.checkedOutAt as string | undefined,
              } as any;
              await this.prisma.visitor.upsert({
                where: { id: safe.id },
                update: {
                  firstName: safe.firstName,
                  lastName: safe.lastName,
                  status: safe.status,
                  checkedOutAt: safe.checkedOutAt,
                },
                create: safe,
              });
            }
            break;
          }
          case 'door': {
            if (entity.action === 'update') {
              await this.prisma.door.update({
                where: { id: d.id as string },
                data: { status: d.status } as any,
              });
            }
            break;
          }
          case 'audit_log': {
            await this.prisma.auditLog.create({
              data: {
                id: d.id as string, siteId,
                userId: d.userId as string,
                action: d.action as string,
                entity: d.entity as string,
                entityId: d.entityId as string,
                details: d.details as any,
                ipAddress: d.ipAddress as string,
                createdAt: d.createdAt ? new Date(d.createdAt as string) : new Date(),
              },
            });
            break;
          }
          case 'lockdown_command': {
            await this.prisma.lockdownCommand.upsert({
              where: { id: d.id as string },
              update: {
                releasedAt: d.releasedAt as any,
                doorsLocked: d.doorsLocked as number,
                updatedAt: d.updatedAt as any,
              },
              create: {
                id: d.id as string, siteId,
                scope: d.scope as string,
                targetId: d.targetId as string,
                initiatedById: d.initiatedById as string,
                alertId: d.alertId as string,
                doorsLocked: d.doorsLocked as number,
                metadata: d.metadata as any,
                initiatedAt: d.initiatedAt ? new Date(d.initiatedAt as string) : new Date(),
              } as any,
            });
            break;
          }
        }
        synced++;
      } catch {
        errors++;
      }
    }

    return { synced, errors };
  }

  // ─── Pull (Cloud → Edge) ────────────────────────────────────────

  async processPull(siteId: string, since: Date, entityTypes: string[]): Promise<Record<string, unknown[]>> {
    const types = entityTypes.length > 0 ? entityTypes : ['user', 'site', 'building', 'room'];
    const result: Record<string, unknown[]> = {};

    if (types.includes('user')) {
      result.users = await this.prisma.user.findMany({
        where: {
          updatedAt: { gte: since },
          sites: { some: { siteId } },
        },
        select: {
          id: true, email: true, name: true, role: true, phone: true,
          isActive: true, createdAt: true, updatedAt: true,
          sites: { select: { siteId: true } },
          // passwordHash intentionally excluded
        },
      });
    }

    if (types.includes('site')) {
      result.sites = await this.prisma.site.findMany({
        where: { id: siteId, updatedAt: { gte: since } },
      });
    }

    if (types.includes('building')) {
      result.buildings = await this.prisma.building.findMany({
        where: { siteId, updatedAt: { gte: since } },
      });
    }

    if (types.includes('room')) {
      result.rooms = await this.prisma.room.findMany({
        where: {
          building: { siteId },
          updatedAt: { gte: since },
        },
      });
    }

    return result;
  }

  // ─── Device Registry ────────────────────────────────────────────

  async upsertDevice(device: {
    siteId: string;
    hostname?: string;
    ipAddress?: string;
    version?: string;
    nodeVersion?: string;
    mode: string;
    pendingChanges: number;
    diskUsagePercent?: number;
    memoryUsageMb?: number;
    upgradeStatus?: string;
    upgradeError?: string;
  }): Promise<EdgeDevice> {
    const upsertData: any = {
      operatingMode: device.mode,
      pendingChanges: device.pendingChanges ?? 0,
      lastHeartbeatAt: new Date(),
      ...(device.version && { currentVersion: device.version }),
      ...(device.hostname && { hostname: device.hostname }),
      ...(device.nodeVersion && { nodeVersion: device.nodeVersion }),
      ...(device.ipAddress && { ipAddress: device.ipAddress }),
      ...(device.diskUsagePercent !== undefined && { diskUsagePercent: device.diskUsagePercent }),
      ...(device.memoryUsageMb !== undefined && { memoryUsageMb: device.memoryUsageMb }),
    };

    // Handle upgrade status reports
    if (device.upgradeStatus === 'SUCCESS') {
      upsertData.upgradeStatus = 'IDLE';
      upsertData.targetVersion = null;
      upsertData.upgradeError = null;
    } else if (device.upgradeStatus === 'FAILED') {
      upsertData.upgradeStatus = 'IDLE';
      upsertData.upgradeError = device.upgradeError || 'Unknown error';
    } else if (device.upgradeStatus === 'IN_PROGRESS') {
      upsertData.upgradeStatus = 'IN_PROGRESS';
    }

    const row = await this.prisma.edgeDevice.upsert({
      where: { siteId: device.siteId },
      update: upsertData,
      create: {
        siteId: device.siteId,
        ...upsertData,
        upgradeStatus: upsertData.upgradeStatus || 'IDLE',
      },
    });

    return this.mapDevice(row);
  }

  async getDevice(siteId: string): Promise<EdgeDevice | null> {
    const row = await this.prisma.edgeDevice.findUnique({ where: { siteId } });
    return row ? this.mapDevice(row) : null;
  }

  async listDevices(): Promise<EdgeDevice[]> {
    const rows = await this.prisma.edgeDevice.findMany({ orderBy: { lastHeartbeatAt: 'desc' } });
    return rows.map(r => this.mapDevice(r));
  }

  async setDeviceTargetVersion(siteId: string, targetVersion: string): Promise<void> {
    await this.prisma.edgeDevice.update({
      where: { siteId },
      data: { targetVersion, upgradeStatus: 'PENDING', upgradeError: null },
    });
  }

  async setAllDevicesTargetVersion(targetVersion: string): Promise<number> {
    const result = await this.prisma.edgeDevice.updateMany({
      where: {
        upgradeStatus: 'IDLE',
        OR: [
          { currentVersion: { not: targetVersion } },
          { currentVersion: null },
        ],
      },
      data: { targetVersion, upgradeStatus: 'PENDING', upgradeError: null },
    });
    return result.count;
  }

  async getFleetSummary(offlineThresholdMs: number): Promise<FleetSummary> {
    const devices = await this.prisma.edgeDevice.findMany({
      select: { currentVersion: true, upgradeStatus: true, lastHeartbeatAt: true },
    });

    const staleThreshold = new Date(Date.now() - offlineThresholdMs);
    const versionDistribution: Record<string, number> = {};
    const upgradeStatus = { idle: 0, pending: 0, inProgress: 0, success: 0, failed: 0 };
    let online = 0;

    for (const d of devices) {
      if (d.lastHeartbeatAt > staleThreshold) online++;
      const ver = d.currentVersion ?? 'unknown';
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

  // ─── Helper ─────────────────────────────────────────────────────

  private mapDevice(row: any): EdgeDevice {
    return {
      id: row.id,
      siteId: row.siteId,
      hostname: row.hostname ?? undefined,
      ipAddress: row.ipAddress ?? undefined,
      version: row.currentVersion ?? undefined,
      nodeVersion: row.nodeVersion ?? undefined,
      mode: row.operatingMode ?? 'STANDALONE',
      pendingChanges: row.pendingChanges ?? 0,
      diskUsagePercent: row.diskUsagePercent ?? undefined,
      memoryUsageMb: row.memoryUsageMb ?? undefined,
      lastHeartbeatAt: row.lastHeartbeatAt,
      targetVersion: row.targetVersion ?? undefined,
      upgradeStatus: row.upgradeStatus ?? 'IDLE',
      upgradeError: row.upgradeError ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
