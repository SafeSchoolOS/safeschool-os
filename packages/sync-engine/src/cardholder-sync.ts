// @ts-nocheck — WIP: will fix types when wiring into runtime
/**
 * Cardholder Bidirectional Sync Engine
 *
 * Syncs cardholders between EdgeRuntime and PAC systems (Lenel, Sicunet, vendor, etc.)
 * without creating duplicates. Uses an external ID mapping table and conflict resolution.
 *
 * Architecture:
 * - External ID mapping: { edgeId, externalId, source, lastSyncAt, hash }
 * - Change detection via content hashing (not full re-import)
 * - Conflict resolution rules: PAC wins for physical security fields, Edge wins for metadata
 */

import crypto from 'node:crypto';
import pg from 'pg';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('sync-engine:cardholder-sync');

// ─── Types ──────────────────────────────────────────────────────────

export interface CardholderMapping {
  edgeId: string;
  externalId: string | null;  // null = not yet pushed to PAC
  source: 'import' | 'edge' | 'synced';
  pacSystem: string;
  lastSyncAt: string;
  edgeHash: string;
  pacHash: string;
  conflictStatus: 'none' | 'pending' | 'resolved';
  conflictDetails?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncedCardholder {
  // EdgeRuntime fields
  edgeId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  photo?: string;
  department?: string;
  title?: string;

  // PAC fields (authoritative from PAC)
  externalId?: string;
  badgeNumber?: string;
  facilityCode?: string;
  cardFormat?: string;
  accessLevels?: string[];
  accessZones?: string[];
  credentialStatus?: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'REVOKED';

  // Metadata
  personType?: 'STAFF' | 'STUDENT' | 'WORKER' | 'VISITOR';
  company?: string;
  customFields?: Record<string, unknown>;

  // Sync metadata
  source: 'import' | 'edge' | 'synced';
  lastSyncAt: string;
  lastModifiedAt: string;
  lastModifiedBy: 'pac' | 'edge';
}

export interface ConflictResolution {
  field: string;
  edgeValue: unknown;
  pacValue: unknown;
  winner: 'pac' | 'edge' | 'merge' | 'flag';
  resolvedValue: unknown;
}

export interface SyncResult {
  imported: number;      // new from PAC
  exported: number;      // new to PAC
  updated: number;       // changed and synced
  conflicts: number;     // need manual review
  unchanged: number;     // no changes
  errors: number;
  details: SyncDetail[];
}

export interface SyncDetail {
  edgeId: string;
  externalId?: string;
  action: 'import' | 'export' | 'update_from_pac' | 'update_to_pac' | 'conflict' | 'skip' | 'error';
  name: string;
  fields?: string[];   // which fields changed
  error?: string;
}

export interface CardholderSyncConfig {
  /** Which side is authoritative for conflicts? Default: 'pac' */
  defaultAuthority: 'pac' | 'edge';
  /** Fields where PAC always wins */
  pacAuthorityFields: string[];
  /** Fields where Edge always wins */
  edgeAuthorityFields: string[];
  /** Fields that get merged (union) */
  mergeFields: string[];
  /** Auto-resolve conflicts or flag for review */
  autoResolve: boolean;
  /** Match strategy for finding existing records */
  matchStrategy: 'badge_number' | 'name_email' | 'external_id' | 'badge_or_name';
  /** Sync interval in ms */
  syncIntervalMs: number;
  /** PAC system identifier (for multi-PAC support) */
  pacSystem: string;
}

export interface SyncStatus {
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  totalMapped: number;
  synced: number;
  edgeOnly: number;
  pacOnly: number;
  conflicts: number;
  running: boolean;
  lastResult: SyncResult | null;
}

export interface ConflictRecord {
  mapping: CardholderMapping;
  edgeData: SyncedCardholder;
  pacData: Record<string, unknown>;
  resolutions: ConflictResolution[];
}

/**
 * Minimal interface for a PAC adapter that supports cardholder management.
 * Real implementations wrap vendor-specific APIs (Lenel, vendor, Sicunet, etc.)
 */
export interface CredentialManagementAdapter {
  /** List all cardholders from the PAC system */
  listCardholders(): Promise<PacCardholder[]>;
  /** Get a single cardholder by external ID */
  getCardholder(externalId: string): Promise<PacCardholder | null>;
  /** Create a new cardholder in the PAC system, returns external ID */
  createCardholder(data: PacCardholderCreate): Promise<string>;
  /** Update an existing cardholder in the PAC */
  updateCardholder(externalId: string, data: Partial<PacCardholderCreate>): Promise<void>;
}

export interface PacCardholder {
  externalId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  badgeNumber?: string;
  facilityCode?: string;
  cardFormat?: string;
  accessLevels?: string[];
  accessZones?: string[];
  credentialStatus?: string;
  personType?: string;
  company?: string;
  department?: string;
  title?: string;
  customFields?: Record<string, unknown>;
  lastModified?: string;
}

export interface PacCardholderCreate {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  badgeNumber?: string;
  facilityCode?: string;
  cardFormat?: string;
  accessLevels?: string[];
  personType?: string;
  company?: string;
  department?: string;
  title?: string;
}

const DEFAULT_CONFIG: CardholderSyncConfig = {
  defaultAuthority: 'pac',
  pacAuthorityFields: ['badgeNumber', 'facilityCode', 'cardFormat', 'accessLevels', 'accessZones', 'credentialStatus'],
  edgeAuthorityFields: ['email', 'phone', 'photo', 'department', 'title', 'company', 'customFields'],
  mergeFields: ['accessZones'],
  autoResolve: true,
  matchStrategy: 'badge_or_name',
  syncIntervalMs: 300000,  // 5 minutes
  pacSystem: 'default',
};

// ─── Empty result helper ────────────────────────────────────────────

function emptySyncResult(): SyncResult {
  return { imported: 0, exported: 0, updated: 0, conflicts: 0, unchanged: 0, errors: 0, details: [] };
}

// ─── CardholderSyncEngine ───────────────────────────────────────────

export class CardholderSyncEngine {
  private config: CardholderSyncConfig;
  private running = false;
  private lastResult: SyncResult | null = null;
  private lastSyncAt: string | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private pool: pg.Pool,
    private adapter: CredentialManagementAdapter,
    config: Partial<CardholderSyncConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  /** Initialize the mapping table (idempotent) */
  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS cardholder_mappings (
          edge_id TEXT NOT NULL,
          external_id TEXT,
          source TEXT NOT NULL DEFAULT 'import',
          pac_system TEXT NOT NULL DEFAULT 'default',
          last_sync_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          edge_hash TEXT,
          pac_hash TEXT,
          conflict_status TEXT DEFAULT 'none',
          conflict_details JSONB,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          PRIMARY KEY (edge_id, pac_system)
        );
        CREATE INDEX IF NOT EXISTS idx_ch_mappings_external ON cardholder_mappings (external_id);
        CREATE INDEX IF NOT EXISTS idx_ch_mappings_conflict ON cardholder_mappings (conflict_status);
      `);
      log.info('Cardholder mapping table initialized');
    } finally {
      client.release();
    }
  }

  /** Start periodic sync */
  startPeriodicSync(): void {
    if (this.syncTimer) return;
    log.info({ intervalMs: this.config.syncIntervalMs }, 'Starting periodic cardholder sync');
    this.syncTimer = setInterval(() => {
      this.sync().catch(err => log.error({ err }, 'Periodic cardholder sync failed'));
    }, this.config.syncIntervalMs);
  }

  /** Stop periodic sync */
  stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      log.info('Periodic cardholder sync stopped');
    }
  }

  /** Get current sync configuration */
  getConfig(): CardholderSyncConfig {
    return { ...this.config };
  }

  /** Update sync configuration */
  updateConfig(updates: Partial<CardholderSyncConfig>): void {
    this.config = { ...this.config, ...updates };
    // Restart periodic sync if interval changed
    if (updates.syncIntervalMs !== undefined && this.syncTimer) {
      this.stopPeriodicSync();
      this.startPeriodicSync();
    }
  }

  // ─── Full Sync ─────────────────────────────────────────────────

  /** Full bidirectional sync: pull from PAC, push new edge records, resolve conflicts */
  async sync(): Promise<SyncResult> {
    if (this.running) {
      log.warn('Sync already in progress, skipping');
      return emptySyncResult();
    }

    this.running = true;
    const result = emptySyncResult();

    try {
      log.info('Starting full cardholder sync...');

      // Step 1: Pull all PAC cardholders
      const pacCardholders = await this.adapter.listCardholders();
      log.info({ count: pacCardholders.length }, 'Fetched PAC cardholders');

      // Step 2: Get all edge cardholders (from sync_entities)
      const edgeCardholders = await this.getEdgeCardholders();
      log.info({ count: edgeCardholders.length }, 'Fetched edge cardholders');

      // Step 3: Get existing mappings
      const mappings = await this.getMappings();
      const mappingsByEdgeId = new Map(mappings.map(m => [m.edgeId, m]));
      const mappingsByExtId = new Map(mappings.filter(m => m.externalId).map(m => [m.externalId!, m]));
      const edgeById = new Map(edgeCardholders.map(c => [c.edgeId, c]));

      // Step 4: Process PAC cardholders (import new, update existing, detect conflicts)
      for (const pac of pacCardholders) {
        try {
          const detail = await this.processPacCardholder(pac, mappingsByExtId, mappingsByEdgeId, edgeById);
          result.details.push(detail);
          switch (detail.action) {
            case 'import': result.imported++; break;
            case 'update_from_pac': result.updated++; break;
            case 'conflict': result.conflicts++; break;
            case 'skip': result.unchanged++; break;
            case 'error': result.errors++; break;
          }
        } catch (err: any) {
          result.errors++;
          result.details.push({
            edgeId: '',
            externalId: pac.externalId,
            action: 'error',
            name: `${pac.firstName} ${pac.lastName}`,
            error: err.message,
          });
        }
      }

      // Step 5: Push edge-only cardholders to PAC
      const processedEdgeIds = new Set(result.details.map(d => d.edgeId).filter(Boolean));
      for (const edge of edgeCardholders) {
        if (processedEdgeIds.has(edge.edgeId)) continue;
        if (mappingsByEdgeId.has(edge.edgeId)) {
          // Already mapped but PAC cardholder wasn't in the pull — mark unchanged
          result.unchanged++;
          continue;
        }

        try {
          const detail = await this.pushCardholderToPac(edge);
          result.details.push(detail);
          switch (detail.action) {
            case 'export': result.exported++; break;
            case 'error': result.errors++; break;
          }
        } catch (err: any) {
          result.errors++;
          result.details.push({
            edgeId: edge.edgeId,
            action: 'error',
            name: `${edge.firstName} ${edge.lastName}`,
            error: err.message,
          });
        }
      }

      this.lastSyncAt = new Date().toISOString();
      this.lastResult = result;

      log.info({
        imported: result.imported,
        exported: result.exported,
        updated: result.updated,
        conflicts: result.conflicts,
        unchanged: result.unchanged,
        errors: result.errors,
      }, 'Cardholder sync completed');

      return result;
    } finally {
      this.running = false;
    }
  }

  /** Pull changes from PAC since last sync */
  async pullFromPac(): Promise<SyncResult> {
    if (this.running) return emptySyncResult();
    this.running = true;
    const result = emptySyncResult();

    try {
      const pacCardholders = await this.adapter.listCardholders();
      const mappings = await this.getMappings();
      const mappingsByExtId = new Map(mappings.filter(m => m.externalId).map(m => [m.externalId!, m]));
      const mappingsByEdgeId = new Map(mappings.map(m => [m.edgeId, m]));
      const edgeCardholders = await this.getEdgeCardholders();
      const edgeById = new Map(edgeCardholders.map(c => [c.edgeId, c]));

      for (const pac of pacCardholders) {
        try {
          const detail = await this.processPacCardholder(pac, mappingsByExtId, mappingsByEdgeId, edgeById);
          result.details.push(detail);
          switch (detail.action) {
            case 'import': result.imported++; break;
            case 'update_from_pac': result.updated++; break;
            case 'conflict': result.conflicts++; break;
            case 'skip': result.unchanged++; break;
            case 'error': result.errors++; break;
          }
        } catch (err: any) {
          result.errors++;
          result.details.push({
            edgeId: '',
            externalId: pac.externalId,
            action: 'error',
            name: `${pac.firstName} ${pac.lastName}`,
            error: err.message,
          });
        }
      }

      this.lastSyncAt = new Date().toISOString();
      this.lastResult = result;
      return result;
    } finally {
      this.running = false;
    }
  }

  /** Push new edge-created cardholders to PAC */
  async pushToPac(): Promise<SyncResult> {
    if (this.running) return emptySyncResult();
    this.running = true;
    const result = emptySyncResult();

    try {
      const edgeCardholders = await this.getEdgeCardholders();
      const mappings = await this.getMappings();
      const mappedEdgeIds = new Set(mappings.map(m => m.edgeId));

      for (const edge of edgeCardholders) {
        if (mappedEdgeIds.has(edge.edgeId)) {
          result.unchanged++;
          continue;
        }

        try {
          const detail = await this.pushCardholderToPac(edge);
          result.details.push(detail);
          switch (detail.action) {
            case 'export': result.exported++; break;
            case 'error': result.errors++; break;
          }
        } catch (err: any) {
          result.errors++;
          result.details.push({
            edgeId: edge.edgeId,
            action: 'error',
            name: `${edge.firstName} ${edge.lastName}`,
            error: err.message,
          });
        }
      }

      this.lastSyncAt = new Date().toISOString();
      this.lastResult = result;
      return result;
    } finally {
      this.running = false;
    }
  }

  // ─── Mappings & Conflicts ──────────────────────────────────────

  /** Get all cardholder mappings */
  async getMappings(): Promise<CardholderMapping[]> {
    const { rows } = await this.pool.query(
      `SELECT edge_id, external_id, source, pac_system, last_sync_at,
              edge_hash, pac_hash, conflict_status, conflict_details,
              created_at, updated_at
       FROM cardholder_mappings
       WHERE pac_system = $1
       ORDER BY updated_at DESC`,
      [this.config.pacSystem],
    );
    return rows.map(rowToMapping);
  }

  /** Get conflicts needing review */
  async getConflicts(): Promise<ConflictRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT edge_id, external_id, source, pac_system, last_sync_at,
              edge_hash, pac_hash, conflict_status, conflict_details,
              created_at, updated_at
       FROM cardholder_mappings
       WHERE pac_system = $1 AND conflict_status = 'pending'
       ORDER BY updated_at DESC`,
      [this.config.pacSystem],
    );

    const conflicts: ConflictRecord[] = [];
    for (const row of rows) {
      const mapping = rowToMapping(row);
      const edgeData = await this.getEdgeCardholder(mapping.edgeId);
      let pacData: Record<string, unknown> = {};
      if (mapping.externalId) {
        const pac = await this.adapter.getCardholder(mapping.externalId);
        if (pac) pacData = pac as any;
      }

      const details = mapping.conflictDetails ? JSON.parse(mapping.conflictDetails) : [];
      conflicts.push({ mapping, edgeData: edgeData!, pacData, resolutions: details });
    }

    return conflicts;
  }

  /** Resolve a conflict manually */
  async resolveConflict(edgeId: string, resolutions: Record<string, 'pac' | 'edge'>): Promise<void> {
    const mapping = await this.getMapping(edgeId);
    if (!mapping) throw new Error(`No mapping found for edgeId ${edgeId}`);

    const edgeData = await this.getEdgeCardholder(edgeId);
    if (!edgeData) throw new Error(`No edge cardholder found for edgeId ${edgeId}`);

    let pacData: PacCardholder | null = null;
    if (mapping.externalId) {
      pacData = await this.adapter.getCardholder(mapping.externalId);
    }

    // Apply resolutions
    const merged: Record<string, unknown> = { ...(edgeData as any) };
    for (const [field, winner] of Object.entries(resolutions)) {
      if (winner === 'pac' && pacData) {
        (merged as any)[field] = (pacData as any)[field];
      }
      // 'edge' keeps the current edge value — no change needed
    }

    // Update edge cardholder with merged values
    await this.upsertEdgeCardholder(merged as any);

    // Update PAC with any edge-winning fields
    if (mapping.externalId) {
      const pacUpdates: Record<string, unknown> = {};
      for (const [field, winner] of Object.entries(resolutions)) {
        if (winner === 'edge') {
          pacUpdates[field] = (edgeData as any)[field];
        }
      }
      if (Object.keys(pacUpdates).length > 0) {
        await this.adapter.updateCardholder(mapping.externalId, pacUpdates as any);
      }
    }

    // Update mapping — mark resolved
    const now = new Date().toISOString();
    const edgeHash = this.computeHash(merged);
    await this.pool.query(
      `UPDATE cardholder_mappings
       SET conflict_status = 'resolved', conflict_details = NULL,
           edge_hash = $1, last_sync_at = $2, updated_at = $2, source = 'synced'
       WHERE edge_id = $3 AND pac_system = $4`,
      [edgeHash, now, edgeId, this.config.pacSystem],
    );

    log.info({ edgeId, resolutions }, 'Conflict resolved');
  }

  /** Get sync status */
  async getStatus(): Promise<SyncStatus> {
    const mappings = await this.getMappings();
    const conflictCount = mappings.filter(m => m.conflictStatus === 'pending').length;
    const syncedCount = mappings.filter(m => m.source === 'synced').length;
    const edgeOnlyCount = mappings.filter(m => m.source === 'edge' && !m.externalId).length;
    const pacOnlyCount = mappings.filter(m => m.source === 'import' && m.externalId).length;

    return {
      lastSyncAt: this.lastSyncAt,
      nextSyncAt: this.syncTimer && this.lastSyncAt
        ? new Date(new Date(this.lastSyncAt).getTime() + this.config.syncIntervalMs).toISOString()
        : null,
      totalMapped: mappings.length,
      synced: syncedCount,
      edgeOnly: edgeOnlyCount,
      pacOnly: pacOnlyCount,
      conflicts: conflictCount,
      running: this.running,
      lastResult: this.lastResult,
    };
  }

  // ─── Private: PAC → Edge processing ────────────────────────────

  private async processPacCardholder(
    pac: PacCardholder,
    mappingsByExtId: Map<string, CardholderMapping>,
    mappingsByEdgeId: Map<string, CardholderMapping>,
    edgeById: Map<string, SyncedCardholder>,
  ): Promise<SyncDetail> {
    const name = `${pac.firstName} ${pac.lastName}`;
    const pacHash = this.computeHash(this.normalizePacData(pac));

    // Check if we already have a mapping for this external ID
    const existingMapping = mappingsByExtId.get(pac.externalId);
    if (existingMapping) {
      return this.handleExistingMapping(existingMapping, pac, pacHash, edgeById);
    }

    // Try to match to an existing edge cardholder
    const matchedEdgeId = await this.findMatch(pac, edgeById);

    if (matchedEdgeId) {
      // Matched an existing edge record — create mapping and sync
      const edgeData = edgeById.get(matchedEdgeId);
      const edgeHash = edgeData ? this.computeHash(this.normalizeEdgeData(edgeData)) : '';
      const now = new Date().toISOString();

      await this.pool.query(
        `INSERT INTO cardholder_mappings (edge_id, external_id, source, pac_system, last_sync_at, edge_hash, pac_hash, conflict_status, created_at, updated_at)
         VALUES ($1, $2, 'synced', $3, $4, $5, $6, 'none', $4, $4)
         ON CONFLICT (edge_id, pac_system) DO UPDATE SET
           external_id = $2, source = 'synced', last_sync_at = $4, edge_hash = $5, pac_hash = $6, updated_at = $4`,
        [matchedEdgeId, pac.externalId, this.config.pacSystem, now, edgeHash, pacHash],
      );

      // Apply PAC-authoritative fields to edge
      if (edgeData) {
        const merged = this.mergeFromPac(edgeData, pac);
        await this.upsertEdgeCardholder(merged);
      }

      return {
        edgeId: matchedEdgeId,
        externalId: pac.externalId,
        action: 'update_from_pac',
        name,
        fields: this.config.pacAuthorityFields,
      };
    }

    // No match — import as new edge cardholder
    const edgeId = crypto.randomUUID();
    const now = new Date().toISOString();
    const newCardholder: SyncedCardholder = {
      edgeId,
      firstName: pac.firstName,
      lastName: pac.lastName,
      email: pac.email,
      phone: pac.phone,
      department: pac.department,
      title: pac.title,
      externalId: pac.externalId,
      badgeNumber: pac.badgeNumber,
      facilityCode: pac.facilityCode,
      cardFormat: pac.cardFormat,
      accessLevels: pac.accessLevels,
      accessZones: pac.accessZones,
      credentialStatus: (pac.credentialStatus as any) || 'ACTIVE',
      personType: (pac.personType as any) || 'STAFF',
      company: pac.company,
      customFields: pac.customFields,
      source: 'import',
      lastSyncAt: now,
      lastModifiedAt: now,
      lastModifiedBy: 'pac',
    };

    await this.upsertEdgeCardholder(newCardholder);

    const edgeHash = this.computeHash(this.normalizeEdgeData(newCardholder));
    await this.pool.query(
      `INSERT INTO cardholder_mappings (edge_id, external_id, source, pac_system, last_sync_at, edge_hash, pac_hash, conflict_status, created_at, updated_at)
       VALUES ($1, $2, 'import', $3, $4, $5, $6, 'none', $4, $4)
       ON CONFLICT (edge_id, pac_system) DO NOTHING`,
      [edgeId, pac.externalId, this.config.pacSystem, now, edgeHash, pacHash],
    );

    return { edgeId, externalId: pac.externalId, action: 'import', name };
  }

  private async handleExistingMapping(
    mapping: CardholderMapping,
    pac: PacCardholder,
    pacHash: string,
    edgeById: Map<string, SyncedCardholder>,
  ): Promise<SyncDetail> {
    const name = `${pac.firstName} ${pac.lastName}`;
    const edgeData = edgeById.get(mapping.edgeId) || await this.getEdgeCardholder(mapping.edgeId);

    if (!edgeData) {
      // Edge record was deleted — re-import
      const edgeId = mapping.edgeId;
      const now = new Date().toISOString();
      const reimported: SyncedCardholder = {
        edgeId,
        firstName: pac.firstName,
        lastName: pac.lastName,
        email: pac.email,
        phone: pac.phone,
        externalId: pac.externalId,
        badgeNumber: pac.badgeNumber,
        facilityCode: pac.facilityCode,
        cardFormat: pac.cardFormat,
        accessLevels: pac.accessLevels,
        accessZones: pac.accessZones,
        credentialStatus: (pac.credentialStatus as any) || 'ACTIVE',
        personType: (pac.personType as any) || 'STAFF',
        source: 'import',
        lastSyncAt: now,
        lastModifiedAt: now,
        lastModifiedBy: 'pac',
      };
      await this.upsertEdgeCardholder(reimported);
      await this.updateMappingHash(edgeId, this.computeHash(this.normalizeEdgeData(reimported)), pacHash);
      return { edgeId, externalId: pac.externalId, action: 'import', name };
    }

    // Check if PAC data has changed
    if (pacHash === mapping.pacHash) {
      // PAC hasn't changed — check if edge has changed
      const currentEdgeHash = this.computeHash(this.normalizeEdgeData(edgeData));
      if (currentEdgeHash === mapping.edgeHash) {
        return { edgeId: mapping.edgeId, externalId: pac.externalId, action: 'skip', name };
      }

      // Edge changed, PAC didn't — push edge changes to PAC if needed
      if (mapping.externalId) {
        const edgeChangedFields = this.getChangedFields(edgeData, pac);
        const edgeAuthorityChanges: Record<string, unknown> = {};
        for (const field of edgeChangedFields) {
          if (this.config.edgeAuthorityFields.includes(field)) {
            edgeAuthorityChanges[field] = (edgeData as any)[field];
          }
        }
        if (Object.keys(edgeAuthorityChanges).length > 0) {
          await this.adapter.updateCardholder(mapping.externalId, edgeAuthorityChanges as any);
        }
      }
      await this.updateMappingHash(mapping.edgeId, this.computeHash(this.normalizeEdgeData(edgeData)), pacHash);
      return { edgeId: mapping.edgeId, externalId: pac.externalId, action: 'update_to_pac', name };
    }

    // PAC has changed — detect conflicts
    const currentEdgeHash = this.computeHash(this.normalizeEdgeData(edgeData));
    const edgeAlsoChanged = currentEdgeHash !== mapping.edgeHash;

    if (!edgeAlsoChanged) {
      // Only PAC changed — auto-apply PAC changes
      const merged = this.mergeFromPac(edgeData, pac);
      await this.upsertEdgeCardholder(merged);
      await this.updateMappingHash(mapping.edgeId, this.computeHash(this.normalizeEdgeData(merged)), pacHash);
      return {
        edgeId: mapping.edgeId,
        externalId: pac.externalId,
        action: 'update_from_pac',
        name,
        fields: this.getChangedFields(edgeData, pac),
      };
    }

    // Both sides changed — conflict!
    const conflictingFields = this.getConflictingFields(edgeData, pac, mapping);
    if (conflictingFields.length === 0) {
      // Changes are on different fields — safe merge
      const merged = this.mergeFromPac(edgeData, pac);
      await this.upsertEdgeCardholder(merged);
      await this.updateMappingHash(mapping.edgeId, this.computeHash(this.normalizeEdgeData(merged)), pacHash);
      return {
        edgeId: mapping.edgeId,
        externalId: pac.externalId,
        action: 'update_from_pac',
        name,
        fields: this.getChangedFields(edgeData, pac),
      };
    }

    // Real conflict — apply resolution rules
    const resolutions = conflictingFields.map(field => this.resolveFieldConflict(field, (edgeData as any)[field], (pac as any)[field]));
    const needsReview = resolutions.some(r => r.winner === 'flag');

    if (this.config.autoResolve && !needsReview) {
      // Auto-resolve: apply winners
      const merged = { ...(edgeData as any) };
      for (const res of resolutions) {
        merged[res.field] = res.resolvedValue;
      }
      merged.lastModifiedAt = new Date().toISOString();
      merged.lastModifiedBy = 'pac';
      await this.upsertEdgeCardholder(merged as SyncedCardholder);
      await this.updateMappingHash(mapping.edgeId, this.computeHash(merged), pacHash);
      return {
        edgeId: mapping.edgeId,
        externalId: pac.externalId,
        action: 'update_from_pac',
        name,
        fields: conflictingFields,
      };
    }

    // Flag for manual review
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE cardholder_mappings
       SET conflict_status = 'pending', conflict_details = $1, pac_hash = $2, updated_at = $3
       WHERE edge_id = $4 AND pac_system = $5`,
      [JSON.stringify(resolutions), pacHash, now, mapping.edgeId, this.config.pacSystem],
    );

    return {
      edgeId: mapping.edgeId,
      externalId: pac.externalId,
      action: 'conflict',
      name,
      fields: conflictingFields,
    };
  }

  // ─── Private: Edge → PAC push ──────────────────────────────────

  private async pushCardholderToPac(edge: SyncedCardholder): Promise<SyncDetail> {
    const name = `${edge.firstName} ${edge.lastName}`;

    try {
      const externalId = await this.adapter.createCardholder({
        firstName: edge.firstName,
        lastName: edge.lastName,
        email: edge.email,
        phone: edge.phone,
        badgeNumber: edge.badgeNumber,
        facilityCode: edge.facilityCode,
        cardFormat: edge.cardFormat,
        accessLevels: edge.accessLevels,
        personType: edge.personType,
        company: edge.company,
        department: edge.department,
        title: edge.title,
      });

      const now = new Date().toISOString();
      const edgeHash = this.computeHash(this.normalizeEdgeData(edge));
      await this.pool.query(
        `INSERT INTO cardholder_mappings (edge_id, external_id, source, pac_system, last_sync_at, edge_hash, pac_hash, conflict_status, created_at, updated_at)
         VALUES ($1, $2, 'synced', $3, $4, $5, $5, 'none', $4, $4)
         ON CONFLICT (edge_id, pac_system) DO UPDATE SET
           external_id = $2, source = 'synced', last_sync_at = $4, edge_hash = $5, pac_hash = $5, updated_at = $4`,
        [edge.edgeId, externalId, this.config.pacSystem, now, edgeHash],
      );

      return { edgeId: edge.edgeId, externalId, action: 'export', name };
    } catch (err: any) {
      return { edgeId: edge.edgeId, action: 'error', name, error: err.message };
    }
  }

  // ─── Private: Matching ─────────────────────────────────────────

  /** Match an incoming PAC cardholder to an existing edge record */
  private async findMatch(
    pac: PacCardholder,
    edgeById: Map<string, SyncedCardholder>,
  ): Promise<string | null> {
    const strategy = this.config.matchStrategy;

    for (const [edgeId, edge] of edgeById) {
      switch (strategy) {
        case 'external_id':
          if (edge.externalId && edge.externalId === pac.externalId) return edgeId;
          break;

        case 'badge_number':
          if (edge.badgeNumber && pac.badgeNumber && edge.badgeNumber === pac.badgeNumber) return edgeId;
          break;

        case 'name_email':
          if (this.namesMatch(edge, pac) && this.emailsMatch(edge, pac)) return edgeId;
          break;

        case 'badge_or_name':
        default:
          // First try badge number (most reliable)
          if (edge.badgeNumber && pac.badgeNumber && edge.badgeNumber === pac.badgeNumber) return edgeId;
          // Then try external ID
          if (edge.externalId && edge.externalId === pac.externalId) return edgeId;
          // Finally try name + email
          if (this.namesMatch(edge, pac) && this.emailsMatch(edge, pac)) return edgeId;
          break;
      }
    }

    return null;
  }

  private namesMatch(a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }): boolean {
    return a.firstName.toLowerCase().trim() === b.firstName.toLowerCase().trim()
        && a.lastName.toLowerCase().trim() === b.lastName.toLowerCase().trim();
  }

  private emailsMatch(a: { email?: string }, b: { email?: string }): boolean {
    if (!a.email && !b.email) return true; // Both missing — match by name only
    if (!a.email || !b.email) return false;
    return a.email.toLowerCase().trim() === b.email.toLowerCase().trim();
  }

  // ─── Private: Hashing & Change Detection ───────────────────────

  /** Compute content hash for change detection */
  private computeHash(data: Record<string, unknown>): string {
    // Normalize: sort keys, stringify, hash
    const sortedKeys = Object.keys(data).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const v = data[key];
      if (v !== undefined && v !== null && v !== '') {
        normalized[key] = v;
      }
    }
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 16);
  }

  private normalizePacData(pac: PacCardholder): Record<string, unknown> {
    return {
      firstName: pac.firstName,
      lastName: pac.lastName,
      email: pac.email,
      badgeNumber: pac.badgeNumber,
      facilityCode: pac.facilityCode,
      cardFormat: pac.cardFormat,
      accessLevels: pac.accessLevels?.sort(),
      accessZones: pac.accessZones?.sort(),
      credentialStatus: pac.credentialStatus,
      personType: pac.personType,
      company: pac.company,
      department: pac.department,
      title: pac.title,
    };
  }

  private normalizeEdgeData(edge: SyncedCardholder): Record<string, unknown> {
    return {
      firstName: edge.firstName,
      lastName: edge.lastName,
      email: edge.email,
      badgeNumber: edge.badgeNumber,
      facilityCode: edge.facilityCode,
      cardFormat: edge.cardFormat,
      accessLevels: edge.accessLevels?.sort(),
      accessZones: edge.accessZones?.sort(),
      credentialStatus: edge.credentialStatus,
      personType: edge.personType,
      company: edge.company,
      department: edge.department,
      title: edge.title,
    };
  }

  private getChangedFields(edge: SyncedCardholder, pac: PacCardholder): string[] {
    const fields: string[] = [];
    const comparisons: Array<[string, unknown, unknown]> = [
      ['firstName', edge.firstName, pac.firstName],
      ['lastName', edge.lastName, pac.lastName],
      ['email', edge.email, pac.email],
      ['phone', edge.phone, pac.phone],
      ['badgeNumber', edge.badgeNumber, pac.badgeNumber],
      ['facilityCode', edge.facilityCode, pac.facilityCode],
      ['cardFormat', edge.cardFormat, pac.cardFormat],
      ['credentialStatus', edge.credentialStatus, pac.credentialStatus],
      ['personType', edge.personType, pac.personType],
      ['company', edge.company, pac.company],
      ['department', edge.department, pac.department],
      ['title', edge.title, pac.title],
    ];

    for (const [field, edgeVal, pacVal] of comparisons) {
      if (this.valuesAreDifferent(edgeVal, pacVal)) {
        fields.push(field);
      }
    }

    // Array fields
    if (this.arraysAreDifferent(edge.accessLevels, pac.accessLevels)) fields.push('accessLevels');
    if (this.arraysAreDifferent(edge.accessZones, pac.accessZones)) fields.push('accessZones');

    return fields;
  }

  private getConflictingFields(edge: SyncedCardholder, pac: PacCardholder, _mapping: CardholderMapping): string[] {
    // Fields that changed on BOTH sides (compared to the stored hashes, we just re-check changed fields)
    return this.getChangedFields(edge, pac);
  }

  private valuesAreDifferent(a: unknown, b: unknown): boolean {
    if (a === b) return false;
    if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return false;
    return true;
  }

  private arraysAreDifferent(a?: string[], b?: string[]): boolean {
    if (!a && !b) return false;
    if (!a || !b) return true;
    if (a.length !== b.length) return true;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.some((v, i) => v !== sb[i]);
  }

  // ─── Private: Conflict Resolution ──────────────────────────────

  /** Apply conflict resolution rules for a single field */
  private resolveFieldConflict(field: string, edgeValue: unknown, pacValue: unknown): ConflictResolution {
    // PAC-authority fields
    if (this.config.pacAuthorityFields.includes(field)) {
      return { field, edgeValue, pacValue, winner: 'pac', resolvedValue: pacValue };
    }

    // Edge-authority fields
    if (this.config.edgeAuthorityFields.includes(field)) {
      return { field, edgeValue, pacValue, winner: 'edge', resolvedValue: edgeValue };
    }

    // Merge fields (union of arrays)
    if (this.config.mergeFields.includes(field)) {
      if (Array.isArray(edgeValue) && Array.isArray(pacValue)) {
        const merged = [...new Set([...edgeValue, ...pacValue])];
        return { field, edgeValue, pacValue, winner: 'merge', resolvedValue: merged };
      }
    }

    // Default authority
    if (this.config.defaultAuthority === 'pac') {
      return { field, edgeValue, pacValue, winner: 'pac', resolvedValue: pacValue };
    }
    if (this.config.defaultAuthority === 'edge') {
      return { field, edgeValue, pacValue, winner: 'edge', resolvedValue: edgeValue };
    }

    // Flag for manual review
    return { field, edgeValue, pacValue, winner: 'flag', resolvedValue: null };
  }

  // ─── Private: Merge ────────────────────────────────────────────

  private mergeFromPac(edge: SyncedCardholder, pac: PacCardholder): SyncedCardholder {
    const merged = { ...edge };
    const now = new Date().toISOString();

    // PAC-authoritative fields always win
    for (const field of this.config.pacAuthorityFields) {
      const pacVal = (pac as any)[field];
      if (pacVal !== undefined && pacVal !== null) {
        (merged as any)[field] = pacVal;
      }
    }

    // Merge fields (union)
    for (const field of this.config.mergeFields) {
      const edgeArr = (edge as any)[field];
      const pacArr = (pac as any)[field];
      if (Array.isArray(edgeArr) && Array.isArray(pacArr)) {
        (merged as any)[field] = [...new Set([...edgeArr, ...pacArr])];
      } else if (Array.isArray(pacArr)) {
        (merged as any)[field] = pacArr;
      }
    }

    // Non-authority fields that are empty on edge but present in PAC — fill in
    const allFields = ['firstName', 'lastName', 'email', 'phone', 'department', 'title', 'company', 'personType'];
    for (const field of allFields) {
      if (!(merged as any)[field] && (pac as any)[field]) {
        (merged as any)[field] = (pac as any)[field];
      }
    }

    merged.externalId = pac.externalId;
    merged.source = 'synced';
    merged.lastSyncAt = now;
    merged.lastModifiedAt = now;
    merged.lastModifiedBy = 'pac';

    return merged;
  }

  // ─── Private: Database Helpers ─────────────────────────────────

  private async getEdgeCardholders(): Promise<SyncedCardholder[]> {
    const { rows } = await this.pool.query(
      `SELECT id, data FROM sync_entities WHERE entity_type = 'cardholder' ORDER BY updated_at DESC`,
    );
    return rows.map((r: any) => {
      const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      return { edgeId: r.id, ...d };
    });
  }

  private async getEdgeCardholder(edgeId: string): Promise<SyncedCardholder | null> {
    const { rows } = await this.pool.query(
      `SELECT id, data FROM sync_entities WHERE id = $1 AND entity_type = 'cardholder'`,
      [edgeId],
    );
    if (rows.length === 0) return null;
    const d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    return { edgeId: rows[0].id, ...d };
  }

  private async upsertEdgeCardholder(ch: SyncedCardholder): Promise<void> {
    const data = { ...ch };
    delete (data as any).edgeId;
    const now = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO sync_entities (id, site_id, entity_type, data, updated_at)
       VALUES ($1, 'cloud', 'cardholder', $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = $3`,
      [ch.edgeId, JSON.stringify(data), now],
    );
  }

  private async getMapping(edgeId: string): Promise<CardholderMapping | null> {
    const { rows } = await this.pool.query(
      `SELECT edge_id, external_id, source, pac_system, last_sync_at,
              edge_hash, pac_hash, conflict_status, conflict_details,
              created_at, updated_at
       FROM cardholder_mappings
       WHERE edge_id = $1 AND pac_system = $2`,
      [edgeId, this.config.pacSystem],
    );
    return rows.length > 0 ? rowToMapping(rows[0]) : null;
  }

  private async updateMappingHash(edgeId: string, edgeHash: string, pacHash: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE cardholder_mappings
       SET edge_hash = $1, pac_hash = $2, last_sync_at = $3, updated_at = $3, source = 'synced', conflict_status = 'none'
       WHERE edge_id = $4 AND pac_system = $5`,
      [edgeHash, pacHash, now, edgeId, this.config.pacSystem],
    );
  }
}

// ─── Row Mapping Helper ───────────────────────────────────────────

function rowToMapping(row: any): CardholderMapping {
  return {
    edgeId: row.edge_id,
    externalId: row.external_id,
    source: row.source,
    pacSystem: row.pac_system,
    lastSyncAt: row.last_sync_at,
    edgeHash: row.edge_hash || '',
    pacHash: row.pac_hash || '',
    conflictStatus: row.conflict_status || 'none',
    conflictDetails: row.conflict_details ? JSON.stringify(row.conflict_details) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Demo PAC Adapter ─────────────────────────────────────────────

const DEMO_FIRST_NAMES = ['James', 'Sarah', 'Michael', 'Emily', 'Robert', 'Jennifer', 'David', 'Lisa', 'Daniel', 'Maria',
  'Thomas', 'Amanda', 'William', 'Ashley', 'Christopher', 'Stephanie', 'Matthew', 'Nicole', 'Andrew', 'Elizabeth',
  'Joseph', 'Jessica', 'Ryan', 'Megan', 'John', 'Lauren', 'Brian', 'Rachel', 'Kevin', 'Heather',
  'Mark', 'Amber', 'Steven', 'Michelle', 'Timothy', 'Kimberly', 'Jason', 'Christina', 'Jeffrey', 'Rebecca',
  'Patrick', 'Samantha', 'Scott', 'Katherine', 'Benjamin', 'Danielle', 'Gregory', 'Alexandra', 'Eric', 'Olivia'];

const DEMO_LAST_NAMES = ['Anderson', 'Baker', 'Carter', 'Davis', 'Evans', 'Foster', 'Garcia', 'Harris', 'Irving', 'Johnson',
  'King', 'Lewis', 'Martinez', 'Nelson', 'Ortiz', 'Parker', 'Quinn', 'Roberts', 'Smith', 'Taylor',
  'Underwood', 'Valdez', 'Walker', 'Xu', 'Young', 'Zhang', 'Adams', 'Brown', 'Clark', 'Diaz',
  'Edwards', 'Fletcher', 'Grant', 'Hill', 'Ingram', 'Jones', 'Kelly', 'Long', 'Mitchell', 'Nguyen',
  'Owen', 'Perez', 'Ramirez', 'Scott', 'Turner', 'Upton', 'Vargas', 'Williams', 'York', 'Zimmerman'];

const DEMO_DEPARTMENTS = ['Engineering', 'HR', 'Finance', 'Marketing', 'Operations', 'Security', 'IT', 'Facilities', 'Legal', 'Executive'];
const DEMO_ACCESS_LEVELS = ['General Access', 'Restricted', 'Executive Floor', 'Data Center', 'Loading Dock', 'Parking Garage', 'Lab Area'];
const DEMO_ZONES = ['Zone A - Main Building', 'Zone B - Annex', 'Zone C - Warehouse', 'Zone D - R&D Lab', 'Zone E - Executive', 'Zone F - Visitor'];

/**
 * Demo PAC adapter that generates realistic cardholder data.
 * Used when no real PAC system is connected.
 */
export class DemoPacAdapter implements CredentialManagementAdapter {
  private cardholders: PacCardholder[] = [];
  private initialized = false;

  constructor(
    private edgeCardholders: SyncedCardholder[] = [],
    private conflictIds: Set<string> = new Set(),
  ) {}

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.cardholders = this.generateDemoCardholders();
  }

  private generateDemoCardholders(): PacCardholder[] {
    const results: PacCardholder[] = [];

    // Generate 50 PAC cardholders
    for (let i = 0; i < 50; i++) {
      const firstName = DEMO_FIRST_NAMES[i]!;
      const lastName = DEMO_LAST_NAMES[i]!;
      const dept = DEMO_DEPARTMENTS[i % DEMO_DEPARTMENTS.length]!;
      const numLevels = 1 + (i % 3);
      const numZones = 1 + (i % 4);

      const cardholder: PacCardholder = {
        externalId: `PAC-${String(1000 + i)}`,
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        phone: `555-${String(1000 + i)}`,
        badgeNumber: `BDG-${String(5000 + i).padStart(6, '0')}`,
        facilityCode: `FC-${String(100 + (i % 5))}`,
        cardFormat: i % 3 === 0 ? 'HID 26-bit' : i % 3 === 1 ? 'HID 37-bit' : 'MIFARE Classic',
        accessLevels: DEMO_ACCESS_LEVELS.slice(0, numLevels),
        accessZones: DEMO_ZONES.slice(0, numZones),
        credentialStatus: i < 42 ? 'ACTIVE' : i < 46 ? 'SUSPENDED' : 'EXPIRED',
        personType: i < 35 ? 'STAFF' : i < 45 ? 'WORKER' : 'VISITOR',
        company: i >= 35 && i < 45 ? `Contractor Corp ${i - 34}` : undefined,
        department: dept,
        title: i % 10 === 0 ? 'Director' : i % 5 === 0 ? 'Manager' : 'Associate',
        lastModified: new Date().toISOString(),
      };

      // For the 40 that should match edge records, use matching names
      if (i < 40 && i < this.edgeCardholders.length) {
        const edge = this.edgeCardholders[i]!;
        cardholder.firstName = edge.firstName;
        cardholder.lastName = edge.lastName;
        if (edge.email) cardholder.email = edge.email;
      }

      // For 3 conflict records, modify badge number or email
      if (this.conflictIds.has(cardholder.externalId) || (i >= 37 && i < 40)) {
        cardholder.badgeNumber = `BDG-CHANGED-${i}`;
        cardholder.email = `changed.${cardholder.firstName.toLowerCase()}@newdomain.com`;
      }

      results.push(cardholder);
    }

    return results;
  }

  async listCardholders(): Promise<PacCardholder[]> {
    this.ensureInitialized();
    return this.cardholders;
  }

  async getCardholder(externalId: string): Promise<PacCardholder | null> {
    this.ensureInitialized();
    return this.cardholders.find(c => c.externalId === externalId) || null;
  }

  async createCardholder(data: PacCardholderCreate): Promise<string> {
    this.ensureInitialized();
    const externalId = `PAC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.cardholders.push({
      externalId,
      ...data,
      accessLevels: data.accessLevels || [],
      accessZones: [],
      credentialStatus: 'ACTIVE',
      lastModified: new Date().toISOString(),
    });
    return externalId;
  }

  async updateCardholder(externalId: string, data: Partial<PacCardholderCreate>): Promise<void> {
    this.ensureInitialized();
    const idx = this.cardholders.findIndex(c => c.externalId === externalId);
    if (idx >= 0) {
      this.cardholders[idx] = { ...this.cardholders[idx]!, ...data, lastModified: new Date().toISOString() };
    }
  }
}
