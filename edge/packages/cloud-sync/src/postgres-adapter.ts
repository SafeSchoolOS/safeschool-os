// @ts-nocheck — WIP: will fix types when wiring into runtime
/**
 * PostgreSQL Sync Database Adapter
 *
 * Production adapter backed by PostgreSQL with:
 * - Org-level partitioning via orgId column on all tables
 * - Entity storage with JSONB data column
 * - Device registry with heartbeat tracking
 * - Device config for remote management
 * - License and user management
 *
 * Auto-creates tables on first connection (idempotent migrations).
 *
 * Requires: DATABASE_URL environment variable (PostgreSQL connection string)
 */

import crypto from 'node:crypto';
import pg from 'pg';
import { createLogger } from '@edgeruntime/core';
import type {
  SyncDatabaseAdapter,
  LicenseDatabaseAdapter,
  UserDatabaseAdapter,
  SyncEntity,
  EdgeDevice,
  FleetSummary,
  OrgLicense,
  DashboardUser,
  OAuthProvider,
  EntityQueryParams,
  EntityQueryResult,
  DeviceConfigRecord,
  DeviceConfigPayload,
} from './types.js';

const log = createLogger('cloud-sync:postgres');

export class PostgresAdapter implements SyncDatabaseAdapter, LicenseDatabaseAdapter, UserDatabaseAdapter {
  private pool: pg.Pool;
  private migrated = false;

  constructor(connectionString?: string) {
    const connStr = connectionString || process.env.DATABASE_URL;
    if (!connStr) {
      throw new Error('DATABASE_URL is required for PostgresAdapter');
    }
    this.pool = new pg.Pool({
      connectionString: connStr,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }

  // ─── Auto-Migration ─────────────────────────────────────────────

  private async ensureTables(): Promise<void> {
    if (this.migrated) return;

    const client = await this.pool.connect();
    try {
      await client.query(`
        -- Entities: partitioned by org_id, entity_type
        CREATE TABLE IF NOT EXISTS sync_entities (
          id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          org_id TEXT NOT NULL DEFAULT 'default',
          site_id TEXT,
          data JSONB NOT NULL DEFAULT '{}',
          action TEXT NOT NULL DEFAULT 'create',
          sync_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (org_id, entity_type, id)
        );
        CREATE INDEX IF NOT EXISTS idx_entities_type ON sync_entities (entity_type);
        CREATE INDEX IF NOT EXISTS idx_entities_org ON sync_entities (org_id);
        CREATE INDEX IF NOT EXISTS idx_entities_site ON sync_entities (site_id);
        CREATE INDEX IF NOT EXISTS idx_entities_updated ON sync_entities (updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_entities_org_type ON sync_entities (org_id, entity_type);

        -- Devices
        CREATE TABLE IF NOT EXISTS sync_devices (
          site_id TEXT PRIMARY KEY,
          org_id TEXT,
          hostname TEXT,
          ip_address TEXT,
          api_port INTEGER,
          version TEXT,
          node_version TEXT,
          mode TEXT NOT NULL DEFAULT 'EDGE',
          pending_changes INTEGER NOT NULL DEFAULT 0,
          disk_usage_percent REAL,
          memory_usage_mb REAL,
          last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          target_version TEXT,
          upgrade_status TEXT DEFAULT 'IDLE',
          upgrade_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_devices_org ON sync_devices (org_id);

        -- Device configs
        CREATE TABLE IF NOT EXISTS sync_device_configs (
          site_id TEXT PRIMARY KEY,
          config JSONB NOT NULL DEFAULT '{}',
          applied_version INTEGER,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Licenses
        CREATE TABLE IF NOT EXISTS sync_licenses (
          org_id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'active',
          products TEXT[] NOT NULL DEFAULT '{}',
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          expires_at TIMESTAMPTZ,
          grace_period_ends_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Users
        CREATE TABLE IF NOT EXISTS sync_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          display_name TEXT,
          avatar_url TEXT,
          provider TEXT NOT NULL DEFAULT 'local',
          provider_id TEXT,
          org_id TEXT NOT NULL DEFAULT 'default',
          role TEXT NOT NULL DEFAULT 'viewer',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON sync_users (email);
        CREATE INDEX IF NOT EXISTS idx_users_org ON sync_users (org_id);
        CREATE INDEX IF NOT EXISTS idx_users_provider ON sync_users (provider, provider_id);
      `);

      this.migrated = true;
      log.info('PostgreSQL tables ensured');
    } finally {
      client.release();
    }
  }

  // ─── Entity Sync ───────────────────────────────────────────────

  async processPush(siteId: string, entities: SyncEntity[], orgId?: string): Promise<{ synced: number; errors: number }> {
    await this.ensureTables();
    let synced = 0;
    let errors = 0;
    const org = orgId || 'default';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const entity of entities) {
        try {
          const id = (entity.data.id as string) || `${siteId}_${Date.now()}_${synced}`;
          const data = { ...entity.data, id, siteId, orgId: org };

          if (entity.action === 'delete') {
            await client.query(
              'DELETE FROM sync_entities WHERE org_id = $1 AND entity_type = $2 AND id = $3',
              [org, entity.type, id]
            );
          } else {
            await client.query(`
              INSERT INTO sync_entities (id, entity_type, org_id, site_id, data, action, sync_timestamp, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
              ON CONFLICT (org_id, entity_type, id) DO UPDATE SET
                data = $5, action = $6, site_id = $4, sync_timestamp = $7, updated_at = NOW()
            `, [id, entity.type, org, siteId, JSON.stringify(data), entity.action, entity.timestamp]);
          }
          synced++;
        } catch (err) {
          log.warn({ err, entityType: entity.type }, 'Entity push error');
          errors++;
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      log.error({ err }, 'Push transaction failed');
      throw err;
    } finally {
      client.release();
    }

    return { synced, errors };
  }

  async processPull(siteId: string, since: Date, entityTypes: string[], orgId?: string): Promise<Record<string, unknown[]>> {
    await this.ensureTables();
    const result: Record<string, unknown[]> = {};

    let query: string;
    let params: any[];

    if (entityTypes.length > 0) {
      query = `
        SELECT entity_type, data FROM sync_entities
        WHERE ($1::TEXT IS NULL OR org_id = $1)
          AND entity_type = ANY($2)
          AND updated_at >= $3
        ORDER BY updated_at ASC
      `;
      params = [orgId || null, entityTypes, since.toISOString()];
    } else {
      query = `
        SELECT entity_type, data FROM sync_entities
        WHERE ($1::TEXT IS NULL OR org_id = $1)
          AND updated_at >= $2
        ORDER BY updated_at ASC
      `;
      params = [orgId || null, since.toISOString()];
    }

    const { rows } = await this.pool.query(query, params);
    for (const row of rows) {
      const type = row.entity_type;
      if (!result[type]) result[type] = [];
      result[type].push(row.data);
    }

    return result;
  }

  // ─── Device Registry ──────────────────────────────────────────

  async upsertDevice(device: {
    siteId: string; orgId?: string; hostname?: string; ipAddress?: string;
    apiPort?: number; version?: string; nodeVersion?: string; mode: string;
    pendingChanges: number; diskUsagePercent?: number; memoryUsageMb?: number;
    upgradeStatus?: string; upgradeError?: string;
  }): Promise<EdgeDevice> {
    await this.ensureTables();

    const { rows } = await this.pool.query(`
      INSERT INTO sync_devices (site_id, org_id, hostname, ip_address, api_port, version, node_version,
        mode, pending_changes, disk_usage_percent, memory_usage_mb, upgrade_status, upgrade_error,
        last_heartbeat_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      ON CONFLICT (site_id) DO UPDATE SET
        org_id = COALESCE($2, sync_devices.org_id),
        hostname = COALESCE($3, sync_devices.hostname),
        ip_address = COALESCE($4, sync_devices.ip_address),
        api_port = COALESCE($5, sync_devices.api_port),
        version = COALESCE($6, sync_devices.version),
        node_version = COALESCE($7, sync_devices.node_version),
        mode = $8,
        pending_changes = $9,
        disk_usage_percent = COALESCE($10, sync_devices.disk_usage_percent),
        memory_usage_mb = COALESCE($11, sync_devices.memory_usage_mb),
        upgrade_status = COALESCE($12, sync_devices.upgrade_status),
        upgrade_error = $13,
        last_heartbeat_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `, [
      device.siteId, device.orgId || null, device.hostname || null,
      device.ipAddress || null, device.apiPort || null,
      device.version || null, device.nodeVersion || null,
      device.mode, device.pendingChanges,
      device.diskUsagePercent ?? null, device.memoryUsageMb ?? null,
      device.upgradeStatus || 'IDLE', device.upgradeError || null,
    ]);

    return this.rowToDevice(rows[0]);
  }

  async getDevice(siteId: string): Promise<EdgeDevice | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query('SELECT * FROM sync_devices WHERE site_id = $1', [siteId]);
    return rows.length > 0 ? this.rowToDevice(rows[0]) : null;
  }

  async listDevices(orgId?: string): Promise<EdgeDevice[]> {
    await this.ensureTables();
    let query = 'SELECT * FROM sync_devices';
    const params: any[] = [];
    if (orgId) {
      query += ' WHERE org_id = $1';
      params.push(orgId);
    }
    query += ' ORDER BY last_heartbeat_at DESC';
    const { rows } = await this.pool.query(query, params);
    return rows.map(r => this.rowToDevice(r));
  }

  async setDeviceTargetVersion(siteId: string, targetVersion: string): Promise<void> {
    await this.ensureTables();
    await this.pool.query(
      `UPDATE sync_devices SET target_version = $1, upgrade_status = 'PENDING', upgrade_error = NULL, updated_at = NOW() WHERE site_id = $2`,
      [targetVersion, siteId]
    );
  }

  async setAllDevicesTargetVersion(targetVersion: string, orgId?: string): Promise<number> {
    await this.ensureTables();
    let query = `UPDATE sync_devices SET target_version = $1, upgrade_status = 'PENDING', upgrade_error = NULL, updated_at = NOW()
      WHERE (upgrade_status = 'IDLE' OR upgrade_status IS NULL)`;
    const params: any[] = [targetVersion];
    if (orgId) {
      query += ' AND org_id = $2';
      params.push(orgId);
    }
    const result = await this.pool.query(query, params);
    return result.rowCount ?? 0;
  }

  async getFleetSummary(offlineThresholdMs: number, orgId?: string): Promise<FleetSummary> {
    await this.ensureTables();
    const thresholdDate = new Date(Date.now() - offlineThresholdMs).toISOString();

    let whereClause = '';
    const params: any[] = [thresholdDate];
    if (orgId) {
      whereClause = 'WHERE org_id = $2';
      params.push(orgId);
    }

    const { rows } = await this.pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE last_heartbeat_at >= $1) as online,
        version,
        upgrade_status
      FROM sync_devices ${whereClause}
      GROUP BY version, upgrade_status
    `, params);

    const versionDistribution: Record<string, number> = {};
    const upgradeStatus = { idle: 0, pending: 0, inProgress: 0, success: 0, failed: 0 };
    let total = 0, online = 0;

    for (const row of rows) {
      const count = parseInt(row.total);
      const onlineCount = parseInt(row.online);
      total += count;
      online += onlineCount;
      const ver = row.version || 'unknown';
      versionDistribution[ver] = (versionDistribution[ver] || 0) + count;
      switch (row.upgrade_status) {
        case 'PENDING': upgradeStatus.pending += count; break;
        case 'IN_PROGRESS': upgradeStatus.inProgress += count; break;
        case 'SUCCESS': upgradeStatus.success += count; break;
        case 'FAILED': upgradeStatus.failed += count; break;
        default: upgradeStatus.idle += count; break;
      }
    }

    return {
      totalDevices: total,
      onlineDevices: online,
      offlineDevices: total - online,
      versionDistribution,
      upgradeStatus,
    };
  }

  // ─── Entity Query ─────────────────────────────────────────────

  async queryEntities(params: EntityQueryParams): Promise<EntityQueryResult> {
    await this.ensureTables();
    const {
      entityType, orgId, siteId, since, until,
      limit = 100, offset = 0,
      filters, sortBy = 'updated_at', sortOrder = 'desc',
    } = params;

    const types = Array.isArray(entityType) ? entityType : [entityType];
    const conditions: string[] = ['entity_type = ANY($1)'];
    const queryParams: any[] = [types];
    let paramIdx = 2;

    if (orgId) {
      conditions.push(`org_id = $${paramIdx++}`);
      queryParams.push(orgId);
    }
    if (siteId) {
      conditions.push(`site_id = $${paramIdx++}`);
      queryParams.push(siteId);
    }
    if (since) {
      conditions.push(`updated_at >= $${paramIdx++}`);
      queryParams.push(since.toISOString());
    }
    if (until) {
      conditions.push(`updated_at <= $${paramIdx++}`);
      queryParams.push(until.toISOString());
    }
    if (filters) {
      for (const [field, value] of Object.entries(filters)) {
        conditions.push(`data->>$${paramIdx} = $${paramIdx + 1}`);
        queryParams.push(field, String(value));
        paramIdx += 2;
      }
    }

    const where = conditions.join(' AND ');
    // Map sortBy to SQL column — data fields use JSONB
    const sortColumn = sortBy === 'updated_at' || sortBy === '_syncTimestamp'
      ? 'updated_at'
      : `data->>'${sortBy.replace(/'/g, "''")}'`;
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Count total
    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM sync_entities WHERE ${where}`, queryParams
    );
    const total = parseInt(countResult.rows[0].total);

    // Fetch page
    const dataResult = await this.pool.query(
      `SELECT data FROM sync_entities WHERE ${where} ORDER BY ${sortColumn} ${order} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...queryParams, limit, offset]
    );

    const entities = dataResult.rows.map(r => r.data as Record<string, unknown>);
    return { entities, total, limit, offset };
  }

  // ─── Device Config ────────────────────────────────────────────

  async getDeviceConfig(siteId: string): Promise<DeviceConfigRecord | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query('SELECT * FROM sync_device_configs WHERE site_id = $1', [siteId]);
    if (rows.length === 0) return null;
    return {
      siteId: rows[0].site_id,
      config: rows[0].config as DeviceConfigPayload,
      appliedVersion: rows[0].applied_version,
      updatedAt: new Date(rows[0].updated_at),
    };
  }

  async setDeviceConfig(siteId: string, config: Partial<DeviceConfigPayload>): Promise<DeviceConfigRecord> {
    await this.ensureTables();
    const existing = await this.getDeviceConfig(siteId);
    const currentVersion = existing?.config?.version ?? 0;
    const newConfig: DeviceConfigPayload = {
      ...(existing?.config || {}),
      ...config,
      version: currentVersion + 1,
    };

    const { rows } = await this.pool.query(`
      INSERT INTO sync_device_configs (site_id, config, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (site_id) DO UPDATE SET config = $2, updated_at = NOW()
      RETURNING *
    `, [siteId, JSON.stringify(newConfig)]);

    return {
      siteId: rows[0].site_id,
      config: rows[0].config as DeviceConfigPayload,
      appliedVersion: rows[0].applied_version,
      updatedAt: new Date(rows[0].updated_at),
    };
  }

  async ackDeviceConfig(siteId: string, version: number): Promise<void> {
    await this.ensureTables();
    await this.pool.query(
      'UPDATE sync_device_configs SET applied_version = $1 WHERE site_id = $2',
      [version, siteId]
    );
  }

  // ─── License ──────────────────────────────────────────────────

  async getLicense(orgId: string): Promise<OrgLicense | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query('SELECT * FROM sync_licenses WHERE org_id = $1', [orgId]);
    if (rows.length === 0) return null;
    return this.rowToLicense(rows[0]);
  }

  async listLicenses(): Promise<OrgLicense[]> {
    await this.ensureTables();
    const { rows } = await this.pool.query('SELECT * FROM sync_licenses ORDER BY updated_at DESC');
    return rows.map(r => this.rowToLicense(r));
  }

  async upsertLicense(license: OrgLicense): Promise<OrgLicense> {
    await this.ensureTables();
    await this.pool.query(`
      INSERT INTO sync_licenses (org_id, status, products, stripe_customer_id, stripe_subscription_id, expires_at, grace_period_ends_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (org_id) DO UPDATE SET
        status = $2, products = $3, stripe_customer_id = $4, stripe_subscription_id = $5,
        expires_at = $6, grace_period_ends_at = $7, updated_at = NOW()
    `, [
      license.orgId, license.status, license.products,
      license.stripeCustomerId || null, license.stripeSubscriptionId || null,
      license.expiresAt?.toISOString() || null, license.gracePeriodEndsAt?.toISOString() || null,
    ]);
    return license;
  }

  async deleteLicense(orgId: string): Promise<void> {
    await this.ensureTables();
    await this.pool.query('DELETE FROM sync_licenses WHERE org_id = $1', [orgId]);
  }

  // ─── Users ────────────────────────────────────────────────────

  async findByProviderAndId(provider: string, providerId: string): Promise<DashboardUser | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query(
      'SELECT * FROM sync_users WHERE provider = $1 AND provider_id = $2', [provider, providerId]
    );
    return rows.length > 0 ? this.rowToUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<DashboardUser | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query('SELECT * FROM sync_users WHERE email = $1', [email]);
    return rows.length > 0 ? this.rowToUser(rows[0]) : null;
  }

  async upsertUser(data: {
    email: string; displayName?: string; avatarUrl?: string;
    provider: OAuthProvider; providerId?: string; orgId: string; role?: string;
  }): Promise<DashboardUser> {
    await this.ensureTables();
    const id = crypto.randomUUID();
    const { rows } = await this.pool.query(`
      INSERT INTO sync_users (id, email, display_name, avatar_url, provider, provider_id, org_id, role, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (id) DO UPDATE SET
        email = $2, display_name = COALESCE($3, sync_users.display_name),
        avatar_url = COALESCE($4, sync_users.avatar_url),
        provider = $5, provider_id = COALESCE($6, sync_users.provider_id),
        org_id = $7, updated_at = NOW()
      RETURNING *
    `, [id, data.email, data.displayName || null, data.avatarUrl || null,
        data.provider, data.providerId || null, data.orgId, data.role || 'viewer']);
    return this.rowToUser(rows[0]);
  }

  async listUsers(orgId?: string): Promise<DashboardUser[]> {
    await this.ensureTables();
    let query = 'SELECT * FROM sync_users';
    const params: any[] = [];
    if (orgId) {
      query += ' WHERE org_id = $1';
      params.push(orgId);
    }
    query += ' ORDER BY created_at DESC';
    const { rows } = await this.pool.query(query, params);
    return rows.map(r => this.rowToUser(r));
  }

  async findById(userId: string): Promise<DashboardUser | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query('SELECT * FROM sync_users WHERE id = $1', [userId]);
    return rows.length > 0 ? this.rowToUser(rows[0]) : null;
  }

  async deleteUser(userId: string): Promise<boolean> {
    await this.ensureTables();
    const result = await this.pool.query('DELETE FROM sync_users WHERE id = $1', [userId]);
    return (result.rowCount ?? 0) > 0;
  }

  async updateUserRole(userId: string, role: string): Promise<DashboardUser | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query(
      'UPDATE sync_users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [role, userId]
    );
    return rows.length > 0 ? this.rowToUser(rows[0]) : null;
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private rowToDevice(row: any): EdgeDevice {
    return {
      id: row.site_id,
      siteId: row.site_id,
      orgId: row.org_id,
      hostname: row.hostname,
      ipAddress: row.ip_address,
      apiPort: row.api_port,
      version: row.version,
      nodeVersion: row.node_version,
      mode: row.mode,
      pendingChanges: row.pending_changes,
      diskUsagePercent: row.disk_usage_percent,
      memoryUsageMb: row.memory_usage_mb,
      lastHeartbeatAt: new Date(row.last_heartbeat_at),
      targetVersion: row.target_version,
      upgradeStatus: row.upgrade_status,
      upgradeError: row.upgrade_error,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private rowToLicense(row: any): OrgLicense {
    return {
      orgId: row.org_id,
      status: row.status,
      products: row.products || [],
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      gracePeriodEndsAt: row.grace_period_ends_at ? new Date(row.grace_period_ends_at) : undefined,
    };
  }

  private rowToUser(row: any): DashboardUser {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      provider: row.provider as OAuthProvider,
      providerId: row.provider_id,
      orgId: row.org_id,
      role: row.role,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
