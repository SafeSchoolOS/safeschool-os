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
      // ── Pre-migration: fix stale schemas from older deployments ──
      // These run individually so one failure doesn't block the rest.
      const preMigrations = [
        // Fix incidents.id type mismatch (older schemas used SERIAL/INTEGER)
        `DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'incidents' AND column_name = 'id' AND data_type = 'integer'
          ) THEN
            -- Drop dependent FKs, change type, recreate
            ALTER TABLE incident_updates DROP CONSTRAINT IF EXISTS incident_updates_incident_id_fkey;
            ALTER TABLE incidents ALTER COLUMN id TYPE TEXT USING id::TEXT;
            ALTER TABLE incident_updates ALTER COLUMN incident_id TYPE TEXT USING incident_id::TEXT;
          END IF;
        END $$`,
        // Fix incident_updates.incident_id type if it's also INTEGER (to match incidents.id TEXT)
        `DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'incident_updates' AND column_name = 'incident_id' AND data_type = 'integer'
          ) THEN
            ALTER TABLE incident_updates DROP CONSTRAINT IF EXISTS incident_updates_incident_id_fkey;
            ALTER TABLE incident_updates ALTER COLUMN incident_id TYPE TEXT USING incident_id::TEXT;
          END IF;
        EXCEPTION WHEN undefined_table THEN NULL;
        END $$`,
        // Add missing columns to stale tables (older schemas)
        `ALTER TABLE floor_plans ADD COLUMN IF NOT EXISTS floor_number INTEGER NOT NULL DEFAULT 1`,
        // agencies — all columns that may be missing from older schema
        `DO $$ BEGIN
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS agency_type TEXT NOT NULL DEFAULT 'other';
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS contact_name TEXT;
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS contact_title TEXT;
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS contact_phone TEXT;
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS contact_email TEXT;
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS jurisdiction TEXT;
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS protocols JSONB NOT NULL DEFAULT '{}';
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS last_drill_date TEXT;
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mou_signed INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mou_expiry TEXT;
          ALTER TABLE agencies ADD COLUMN IF NOT EXISTS notes TEXT;
        EXCEPTION WHEN undefined_table THEN NULL;
        END $$`,
        // sites — all columns that may be missing (including site_name which replaced name)
        `DO $$ BEGIN
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_name TEXT NOT NULL DEFAULT '';
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS address TEXT;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS city TEXT;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS state TEXT;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS country TEXT;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS latitude REAL;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS longitude REAL;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS timezone TEXT;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'normal';
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS risk_score REAL DEFAULT 0;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS total_doors INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS total_cameras INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS online_devices INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS offline_devices INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS active_incidents INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS active_alarms INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS last_updated TEXT;
          ALTER TABLE sites ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT (NOW()::TEXT);
        EXCEPTION WHEN undefined_table THEN NULL;
        END $$`,
        // ticket_config — all columns that may be missing
        `DO $$ BEGIN
          ALTER TABLE ticket_config ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE ticket_config ADD COLUMN IF NOT EXISTS auto_create INTEGER NOT NULL DEFAULT 0;
        EXCEPTION WHEN undefined_table THEN NULL;
        END $$`,
        // tenants — all columns that may be missing
        `DO $$ BEGIN
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tenant_name TEXT NOT NULL DEFAULT '';
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS building TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS floor TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suite TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_name TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_email TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_phone TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lease_start TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lease_end TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS access_zones JSONB NOT NULL DEFAULT '[]';
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS visitor_quota INTEGER;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notes TEXT;
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
          ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        EXCEPTION WHEN undefined_table THEN NULL;
        END $$`,
        // access_events — fix all legacy schema issues (old tables had INTEGER id, NOT NULL on extra columns)
        `DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'access_events') THEN
            -- Fix id column type from INTEGER to TEXT
            IF EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'access_events' AND column_name = 'id' AND data_type IN ('integer', 'bigint', 'smallint')
            ) THEN
              ALTER TABLE access_events ALTER COLUMN id DROP DEFAULT;
              ALTER TABLE access_events ALTER COLUMN id SET DATA TYPE TEXT USING id::TEXT;
            END IF;
            -- Drop NOT NULL from all legacy columns that the new schema doesn't require
            PERFORM 1; -- no-op anchor
            BEGIN ALTER TABLE access_events ALTER COLUMN event_id DROP NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
            BEGIN ALTER TABLE access_events ALTER COLUMN event_time DROP NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
            BEGIN ALTER TABLE access_events ALTER COLUMN site_id DROP NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
          END IF;
        END $$`,
        // access_events — all columns that may be missing
        `DO $$ BEGIN
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'access_granted';
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS timestamp TEXT NOT NULL DEFAULT (NOW()::TEXT);
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS cardholder_id TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS cardholder_name TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS credential_type TEXT DEFAULT 'card';
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS door_id TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS door_name TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS reader_id TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS reader_name TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS facility_code TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS location TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS building TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS floor TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS zone TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS result TEXT DEFAULT 'granted';
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT 'connector';
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS source_event_id TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS metadata JSONB;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS device_id TEXT;
          ALTER TABLE access_events ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT (NOW()::TEXT);
        EXCEPTION WHEN undefined_table THEN NULL;
        END $$`,
        // Re-add incident_updates FK if it was dropped (or never existed)
        `DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'incident_updates_incident_id_fkey'
              AND table_name = 'incident_updates'
          ) THEN
            BEGIN
              ALTER TABLE incident_updates
                ADD CONSTRAINT incident_updates_incident_id_fkey
                FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE;
            EXCEPTION WHEN undefined_table THEN NULL;
            END;
          END IF;
        END $$`,
        // ── Stale-table fixups: add org_id and other missing columns ──
        `DO $$ BEGIN
          ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE visitors ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE alarms ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE drills ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE guard_tours ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE guard_checkpoints ADD COLUMN IF NOT EXISTS location TEXT;
          ALTER TABLE guard_checkpoints ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE notifications ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE sensor_events ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE compliance_reports ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN
          ALTER TABLE system_health ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        // sync_users — add password_hash and username if missing
        `DO $$ BEGIN
          ALTER TABLE sync_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
          ALTER TABLE sync_users ADD COLUMN IF NOT EXISTS username TEXT;
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        // incident_updates — add action column if missing
        `DO $$ BEGIN
          ALTER TABLE incident_updates ADD COLUMN IF NOT EXISTS action TEXT;
        EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        // incidents — add Tailgating to enum if it exists as an enum type
        `DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IncidentType') THEN
            ALTER TYPE "IncidentType" ADD VALUE IF NOT EXISTS 'Tailgating';
          END IF;
        EXCEPTION WHEN others THEN NULL; END $$`,

        // ── Multi-tenancy: add org_id to all tables missing it ──
        `DO $$ BEGIN ALTER TABLE signin_flows ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE threat_assessments ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE reunification_events ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE floor_plans ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE risk_scores ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE hall_passes ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE grants ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE tenants ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE tips ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE contractors ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE notification_contacts ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE notification_templates ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE cases ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE evidence ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE pass_compliance ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE building_systems ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE agencies ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE guard_shifts ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE widget_config ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,

        // ── Multi-tenancy: add site_id to operational tables ──
        `DO $$ BEGIN ALTER TABLE panic_alerts ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE alarms ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE drills ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE guard_tours ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE guard_shifts ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE notifications ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE sensor_events ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE incidents ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE threat_assessments ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE reunification_events ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE floor_plans ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE cases ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE tips ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE hall_passes ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE contractors ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE building_systems ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE compliance_reports ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,

        // ── Multi-tenancy: add account_site_id to devices ──
        `DO $$ BEGIN ALTER TABLE sync_devices ADD COLUMN IF NOT EXISTS account_site_id TEXT; EXCEPTION WHEN undefined_table THEN NULL; END $$`,

        // ── Multi-tenancy: add plan/limits to licenses ──
        `DO $$ BEGIN ALTER TABLE sync_licenses ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE sync_licenses ADD COLUMN IF NOT EXISTS max_sites INTEGER NOT NULL DEFAULT 1; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE sync_licenses ADD COLUMN IF NOT EXISTS max_devices INTEGER NOT NULL DEFAULT 10; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE sync_licenses ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 5; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
        `DO $$ BEGIN ALTER TABLE sync_licenses ADD COLUMN IF NOT EXISTS billing_model TEXT NOT NULL DEFAULT 'flat'; EXCEPTION WHEN undefined_table THEN NULL; END $$`,
      ];
      for (const sql of preMigrations) {
        try { await client.query(sql); } catch (e: any) {
          // Ignore errors (table may not exist yet — will be created below)
          if (!e.message?.includes('does not exist')) {
            log.warn({ err: e.message }, 'Pre-migration warning');
          }
        }
      }

      // Split schema into per-table blocks so one stale table doesn't block the rest.
      // Each block runs independently — if it fails (e.g. stale column), we log and continue.
      const schemaBlocks = (`
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
          username TEXT,
          display_name TEXT,
          avatar_url TEXT,
          provider TEXT NOT NULL DEFAULT 'local',
          provider_id TEXT,
          org_id TEXT NOT NULL DEFAULT 'default',
          role TEXT NOT NULL DEFAULT 'viewer',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          password_hash TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON sync_users (email);
        CREATE INDEX IF NOT EXISTS idx_users_org ON sync_users (org_id);
        CREATE INDEX IF NOT EXISTS idx_users_provider ON sync_users (provider, provider_id);

        -- Incidents
        CREATE TABLE IF NOT EXISTS incidents (
          id TEXT PRIMARY KEY,
          incident_number TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          incident_type TEXT NOT NULL DEFAULT 'other',
          priority TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL DEFAULT 'open',
          location TEXT,
          reported_by TEXT,
          assigned_to TEXT,
          sop_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          acknowledged_at TEXT,
          resolved_at TEXT,
          closed_at TEXT,
          resolution_notes TEXT,
          source_event_id TEXT,
          device_id TEXT,
          org_id TEXT NOT NULL DEFAULT 'default'
        );
        -- Migrate existing tables: add ALL columns that may not exist in older schemas
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_number TEXT NOT NULL DEFAULT '';
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_type TEXT NOT NULL DEFAULT 'other';
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reported_by TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_to TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS sop_id TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT NOW()::TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT NOW()::TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_at TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_at TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_at TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS source_event_id TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS device_id TEXT;
        ALTER TABLE incidents ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';
        CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status);
        CREATE INDEX IF NOT EXISTS idx_incidents_priority ON incidents (priority);
        CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents (incident_type);
        CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents (org_id);
        CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_incidents_assigned ON incidents (assigned_to);

        -- Incident Updates (activity log)
        CREATE TABLE IF NOT EXISTS incident_updates (
          id TEXT PRIMARY KEY,
          incident_id TEXT NOT NULL,
          update_type TEXT NOT NULL DEFAULT 'note',
          old_value TEXT,
          new_value TEXT,
          comment TEXT,
          updated_by TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_incident_updates_incident ON incident_updates (incident_id);
        CREATE INDEX IF NOT EXISTS idx_incident_updates_created ON incident_updates (created_at DESC);

        -- SOPs (Standard Operating Procedures)
        CREATE TABLE IF NOT EXISTS sops (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          incident_type TEXT NOT NULL,
          steps TEXT NOT NULL DEFAULT '[]',
          auto_actions TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          org_id TEXT NOT NULL DEFAULT 'default'
        );
        ALTER TABLE sops ADD COLUMN IF NOT EXISTS incident_type TEXT NOT NULL DEFAULT 'other';
        ALTER TABLE sops ADD COLUMN IF NOT EXISTS auto_actions TEXT;
        CREATE INDEX IF NOT EXISTS idx_sops_type ON sops (incident_type);
        CREATE INDEX IF NOT EXISTS idx_sops_org ON sops (org_id);

        -- Panic alerts (Alyssa's Law compliance — silent panic buttons)
        CREATE TABLE IF NOT EXISTS panic_alerts (
          id TEXT PRIMARY KEY,
          device_id TEXT,
          user_id TEXT,
          user_name TEXT,
          alert_type TEXT NOT NULL DEFAULT 'panic',
          location TEXT,
          latitude REAL,
          longitude REAL,
          status TEXT NOT NULL DEFAULT 'active',
          triggered_at TEXT NOT NULL,
          acknowledged_at TEXT,
          acknowledged_by TEXT,
          resolved_at TEXT,
          resolved_by TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_panic_status ON panic_alerts (status);
        CREATE INDEX IF NOT EXISTS idx_panic_triggered ON panic_alerts (triggered_at DESC);
        CREATE INDEX IF NOT EXISTS idx_panic_type ON panic_alerts (alert_type);

        -- Audit log (compliance & audit reporting)
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          actor_role TEXT,
          target_type TEXT,
          target_id TEXT,
          target_name TEXT,
          details JSONB DEFAULT '{}',
          ip_address TEXT,
          device_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action);
        CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor);
        CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log (target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

        -- Compliance reports
        CREATE TABLE IF NOT EXISTS compliance_reports (
          id TEXT PRIMARY KEY,
          report_type TEXT NOT NULL,
          title TEXT NOT NULL,
          parameters JSONB DEFAULT '{}',
          generated_by TEXT NOT NULL,
          format TEXT NOT NULL DEFAULT 'json',
          data JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_reports_type ON compliance_reports (report_type);
        CREATE INDEX IF NOT EXISTS idx_reports_created ON compliance_reports (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reports_generated_by ON compliance_reports (generated_by);

        -- Sign-in flows (custom visitor check-in workflows)
        CREATE TABLE IF NOT EXISTS signin_flows (
          id TEXT PRIMARY KEY,
          flow_name TEXT NOT NULL,
          visitor_type TEXT NOT NULL DEFAULT 'visitor',
          steps JSONB NOT NULL DEFAULT '[]',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_signin_flows_type ON signin_flows (visitor_type);
        CREATE INDEX IF NOT EXISTS idx_signin_flows_active ON signin_flows (active);

        -- Alarms (GSOC alarm queue with priority-based triage)
        CREATE TABLE IF NOT EXISTS alarms (
          id TEXT PRIMARY KEY,
          alarm_number TEXT NOT NULL,
          source_system TEXT NOT NULL DEFAULT 'manual',
          source_event_id TEXT,
          alarm_type TEXT NOT NULL DEFAULT 'other',
          priority TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL DEFAULT 'new',
          title TEXT NOT NULL,
          description TEXT,
          location TEXT,
          zone TEXT,
          device_name TEXT,
          assigned_to TEXT,
          acknowledged_at TEXT,
          acknowledged_by TEXT,
          resolved_at TEXT,
          resolved_by TEXT,
          resolution_notes TEXT,
          auto_actions_taken TEXT,
          linked_incident_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          sla_deadline TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_alarms_status ON alarms (status);
        CREATE INDEX IF NOT EXISTS idx_alarms_priority ON alarms (priority);
        CREATE INDEX IF NOT EXISTS idx_alarms_type ON alarms (alarm_type);
        CREATE INDEX IF NOT EXISTS idx_alarms_source ON alarms (source_system);
        CREATE INDEX IF NOT EXISTS idx_alarms_created ON alarms (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_alarms_number ON alarms (alarm_number);

        -- Drills (safety drill scheduling & compliance tracking)
        CREATE TABLE IF NOT EXISTS drills (
          id TEXT PRIMARY KEY,
          drill_type TEXT NOT NULL DEFAULT 'fire',
          title TEXT NOT NULL,
          description TEXT,
          scheduled_date TEXT,
          started_at TEXT,
          completed_at TEXT,
          duration_seconds INTEGER,
          status TEXT NOT NULL DEFAULT 'scheduled',
          participants_count INTEGER,
          building TEXT,
          location TEXT,
          conducted_by TEXT,
          compliance_period TEXT DEFAULT 'quarterly',
          notes TEXT,
          issues_found TEXT,
          corrective_actions TEXT,
          grade TEXT,
          state_requirement TEXT,
          reported_to_state INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        -- Migrate existing drills table: add ALL columns that may not exist
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS drill_type TEXT NOT NULL DEFAULT 'fire';
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS description TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS scheduled_date TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS started_at TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS completed_at TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled';
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS participants_count INTEGER;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS building TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS location TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS conducted_by TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS compliance_period TEXT DEFAULT 'quarterly';
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS issues_found TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS corrective_actions TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS grade TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS state_requirement TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS reported_to_state INTEGER DEFAULT 0;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT NOW()::TEXT;
        ALTER TABLE drills ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT NOW()::TEXT;
        CREATE INDEX IF NOT EXISTS idx_drills_type ON drills (drill_type);
        CREATE INDEX IF NOT EXISTS idx_drills_status ON drills (status);
        CREATE INDEX IF NOT EXISTS idx_drills_scheduled ON drills (scheduled_date DESC);
        CREATE INDEX IF NOT EXISTS idx_drills_created ON drills (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_drills_compliance ON drills (compliance_period);
        CREATE INDEX IF NOT EXISTS idx_drills_grade ON drills (grade);

        -- Guard Tours (NFC/QR checkpoint-based patrol system)
        CREATE TABLE IF NOT EXISTS guard_tours (
          id TEXT PRIMARY KEY,
          tour_name TEXT NOT NULL,
          description TEXT,
          route JSONB NOT NULL DEFAULT '[]',
          frequency TEXT NOT NULL DEFAULT 'per_shift',
          assigned_guard TEXT,
          status TEXT NOT NULL DEFAULT 'scheduled',
          scheduled_start TEXT,
          actual_start TEXT,
          completed_at TEXT,
          duration_seconds INTEGER,
          checkpoints_total INTEGER NOT NULL DEFAULT 0,
          checkpoints_completed INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_guard_tours_status ON guard_tours (status);
        CREATE INDEX IF NOT EXISTS idx_guard_tours_guard ON guard_tours (assigned_guard);
        CREATE INDEX IF NOT EXISTS idx_guard_tours_created ON guard_tours (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_guard_tours_frequency ON guard_tours (frequency);

        -- Guard Checkpoints (NFC/QR scan records per tour)
        CREATE TABLE IF NOT EXISTS guard_checkpoints (
          id TEXT PRIMARY KEY,
          tour_id TEXT NOT NULL REFERENCES guard_tours(id) ON DELETE CASCADE,
          checkpoint_name TEXT NOT NULL,
          checkpoint_code TEXT NOT NULL,
          order_index INTEGER NOT NULL DEFAULT 0,
          scanned_at TEXT,
          scanned_by TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          notes TEXT,
          photo_url TEXT,
          latitude REAL,
          longitude REAL,
          expected_scan_time TEXT,
          created_at TEXT NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_guard_checkpoints_tour ON guard_checkpoints (tour_id);
        CREATE INDEX IF NOT EXISTS idx_guard_checkpoints_status ON guard_checkpoints (status);
        CREATE INDEX IF NOT EXISTS idx_guard_checkpoints_code ON guard_checkpoints (checkpoint_code);

        -- Guard Shifts (duty roster)
        CREATE TABLE IF NOT EXISTS guard_shifts (
          id TEXT PRIMARY KEY,
          guard_name TEXT NOT NULL,
          guard_id TEXT,
          shift_start TEXT NOT NULL,
          shift_end TEXT,
          status TEXT NOT NULL DEFAULT 'scheduled',
          post_location TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_guard_shifts_status ON guard_shifts (status);
        CREATE INDEX IF NOT EXISTS idx_guard_shifts_guard ON guard_shifts (guard_name);
        CREATE INDEX IF NOT EXISTS idx_guard_shifts_start ON guard_shifts (shift_start DESC);

        -- Notifications (multi-channel emergency notification system)
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          notification_type TEXT NOT NULL DEFAULT 'alert',
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          channels JSONB NOT NULL DEFAULT '[]',
          recipients_type TEXT NOT NULL DEFAULT 'all',
          recipients_filter JSONB,
          sent_by TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          sent_at TEXT,
          delivery_stats JSONB NOT NULL DEFAULT '{"sent":0,"delivered":0,"failed":0,"pending":0}',
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications (notification_type);
        CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications (status);
        CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);

        -- Notification Contacts
        CREATE TABLE IF NOT EXISTS notification_contacts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          role TEXT NOT NULL DEFAULT 'staff',
          groups JSONB NOT NULL DEFAULT '[]',
          zone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_notif_contacts_role ON notification_contacts (role);
        CREATE INDEX IF NOT EXISTS idx_notif_contacts_zone ON notification_contacts (zone);
        CREATE INDEX IF NOT EXISTS idx_notif_contacts_active ON notification_contacts (active);

        -- Notification Templates
        CREATE TABLE IF NOT EXISTS notification_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          notification_type TEXT NOT NULL DEFAULT 'alert',
          title_template TEXT NOT NULL,
          message_template TEXT NOT NULL,
          default_channels JSONB NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_notif_templates_type ON notification_templates (notification_type);

        -- Reunification Events (SafeSchool — emergency parent-student reunification)
        CREATE TABLE IF NOT EXISTS reunification_events (
          id TEXT PRIMARY KEY,
          event_name TEXT NOT NULL,
          event_type TEXT NOT NULL DEFAULT 'evacuation',
          status TEXT NOT NULL DEFAULT 'active',
          initiated_by TEXT,
          initiated_at TEXT NOT NULL,
          completed_at TEXT,
          location TEXT,
          total_students INTEGER NOT NULL DEFAULT 0,
          accounted_for INTEGER NOT NULL DEFAULT 0,
          unaccounted INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_reunification_events_status ON reunification_events (status);
        CREATE INDEX IF NOT EXISTS idx_reunification_events_created ON reunification_events (created_at DESC);

        -- Reunification Records (individual student tracking per event)
        CREATE TABLE IF NOT EXISTS reunification_records (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES reunification_events(id) ON DELETE CASCADE,
          student_name TEXT NOT NULL,
          student_id TEXT,
          grade TEXT,
          homeroom TEXT,
          status TEXT NOT NULL DEFAULT 'unaccounted',
          accounted_at TEXT,
          released_to TEXT,
          released_to_id TEXT,
          released_at TEXT,
          verified_by TEXT,
          verification_method TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_reunification_records_event ON reunification_records (event_id);
        CREATE INDEX IF NOT EXISTS idx_reunification_records_status ON reunification_records (status);
        CREATE INDEX IF NOT EXISTS idx_reunification_records_student ON reunification_records (student_id);

        -- Threat Assessments (SafeSchool — behavioral threat assessment)
        CREATE TABLE IF NOT EXISTS threat_assessments (
          id TEXT PRIMARY KEY,
          case_number TEXT NOT NULL,
          subject_name TEXT NOT NULL,
          subject_id TEXT,
          subject_grade TEXT,
          subject_school TEXT,
          threat_type TEXT NOT NULL DEFAULT 'behavioral',
          threat_level TEXT,
          description TEXT NOT NULL DEFAULT '',
          reported_by TEXT,
          reporter_role TEXT DEFAULT 'staff',
          status TEXT NOT NULL DEFAULT 'reported',
          assigned_to TEXT,
          intervention_plan JSONB DEFAULT '{}',
          risk_factors JSONB DEFAULT '[]',
          protective_factors JSONB DEFAULT '[]',
          actions_taken JSONB DEFAULT '[]',
          follow_up_date TEXT,
          outcome TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          closed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_threat_assess_status ON threat_assessments (status);
        CREATE INDEX IF NOT EXISTS idx_threat_assess_level ON threat_assessments (threat_level);
        CREATE INDEX IF NOT EXISTS idx_threat_assess_type ON threat_assessments (threat_type);
        CREATE INDEX IF NOT EXISTS idx_threat_assess_created ON threat_assessments (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_threat_assess_case ON threat_assessments (case_number);
        CREATE INDEX IF NOT EXISTS idx_threat_assess_assigned ON threat_assessments (assigned_to);
        CREATE INDEX IF NOT EXISTS idx_threat_assess_followup ON threat_assessments (follow_up_date);

        -- Sensor Events (environmental sensor integration)
        CREATE TABLE IF NOT EXISTS sensor_events (
          id TEXT PRIMARY KEY,
          sensor_id TEXT,
          sensor_name TEXT,
          sensor_type TEXT NOT NULL DEFAULT 'motion',
          location TEXT,
          zone TEXT,
          value REAL,
          unit TEXT,
          threshold REAL,
          alert_triggered INTEGER NOT NULL DEFAULT 0,
          alert_type TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          acknowledged_by TEXT,
          resolved_at TEXT,
          device_id TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_sensor_events_type ON sensor_events (sensor_type);
        CREATE INDEX IF NOT EXISTS idx_sensor_events_status ON sensor_events (status);
        CREATE INDEX IF NOT EXISTS idx_sensor_events_alert ON sensor_events (alert_triggered);
        CREATE INDEX IF NOT EXISTS idx_sensor_events_location ON sensor_events (location);
        CREATE INDEX IF NOT EXISTS idx_sensor_events_created ON sensor_events (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sensor_events_sensor ON sensor_events (sensor_id);
        CREATE INDEX IF NOT EXISTS idx_sensor_events_device ON sensor_events (device_id);

        -- Floor Plans (interactive floor plans with device placement)
        CREATE TABLE IF NOT EXISTS floor_plans (
          id TEXT PRIMARY KEY,
          building_name TEXT NOT NULL,
          floor_name TEXT NOT NULL,
          floor_number INTEGER NOT NULL DEFAULT 1,
          image_url TEXT,
          svg_data TEXT,
          devices JSONB NOT NULL DEFAULT '[]',
          zones JSONB NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_floor_plans_building ON floor_plans (building_name);
        CREATE INDEX IF NOT EXISTS idx_floor_plans_floor ON floor_plans (floor_number);

        -- Risk Scores (Predictive Threat Scoring)
        CREATE TABLE IF NOT EXISTS risk_scores (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL DEFAULT 'zone',
          entity_id TEXT NOT NULL,
          entity_name TEXT,
          risk_score REAL NOT NULL DEFAULT 0,
          risk_level TEXT NOT NULL DEFAULT 'low',
          factors JSONB NOT NULL DEFAULT '[]',
          trend TEXT NOT NULL DEFAULT 'stable',
          last_calculated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          period_start TIMESTAMPTZ,
          period_end TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_risk_entity_type ON risk_scores (entity_type);
        CREATE INDEX IF NOT EXISTS idx_risk_entity ON risk_scores (entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_risk_level ON risk_scores (risk_level);
        CREATE INDEX IF NOT EXISTS idx_risk_score ON risk_scores (risk_score DESC);
        CREATE INDEX IF NOT EXISTS idx_risk_calculated ON risk_scores (last_calculated DESC);

        -- Hall Passes (Digital Hall Pass — SafeSchool)
        CREATE TABLE IF NOT EXISTS hall_passes (
          id TEXT PRIMARY KEY,
          student_name TEXT NOT NULL,
          student_id TEXT,
          grade TEXT,
          homeroom_teacher TEXT,
          destination TEXT NOT NULL DEFAULT 'bathroom',
          destination_detail TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          issued_by TEXT NOT NULL,
          issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expected_return TIMESTAMPTZ,
          returned_at TIMESTAMPTZ,
          duration_seconds INTEGER,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_hallpass_status ON hall_passes (status);
        CREATE INDEX IF NOT EXISTS idx_hallpass_student ON hall_passes (student_id);
        CREATE INDEX IF NOT EXISTS idx_hallpass_issued ON hall_passes (issued_at DESC);
        CREATE INDEX IF NOT EXISTS idx_hallpass_destination ON hall_passes (destination);
        CREATE INDEX IF NOT EXISTS idx_hallpass_teacher ON hall_passes (issued_by);

        -- Grants (Grant Application Helper — SafeSchool)
        CREATE TABLE IF NOT EXISTS grants (
          id TEXT PRIMARY KEY,
          grant_name TEXT NOT NULL,
          grant_program TEXT NOT NULL DEFAULT 'other',
          funding_agency TEXT,
          amount_requested REAL,
          amount_awarded REAL,
          status TEXT NOT NULL DEFAULT 'researching',
          deadline TEXT,
          submission_date TEXT,
          features_funded JSONB NOT NULL DEFAULT '[]',
          compliance_data JSONB NOT NULL DEFAULT '{}',
          notes TEXT,
          contact_name TEXT,
          contact_email TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_grants_status ON grants (status);
        CREATE INDEX IF NOT EXISTS idx_grants_program ON grants (grant_program);
        CREATE INDEX IF NOT EXISTS idx_grants_deadline ON grants (deadline);
        CREATE INDEX IF NOT EXISTS idx_grants_created ON grants (created_at DESC);

        -- Tenants (Tenant Experience Platform — SafeSchool)
        CREATE TABLE IF NOT EXISTS tenants (
          id TEXT PRIMARY KEY,
          tenant_name TEXT NOT NULL,
          building TEXT,
          floor TEXT,
          suite TEXT,
          contact_name TEXT,
          contact_email TEXT,
          contact_phone TEXT,
          lease_start TEXT,
          lease_end TEXT,
          access_zones JSONB NOT NULL DEFAULT '[]',
          visitor_quota INTEGER,
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);
        CREATE INDEX IF NOT EXISTS idx_tenants_building ON tenants (building);
        CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants (tenant_name);

        -- Anonymous Tips (SafeSchool tip line)
        CREATE TABLE IF NOT EXISTS tips (
          id TEXT PRIMARY KEY,
          tip_number TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'other',
          message TEXT NOT NULL,
          anonymous INTEGER NOT NULL DEFAULT 1,
          reporter_name TEXT,
          reporter_contact TEXT,
          status TEXT NOT NULL DEFAULT 'new',
          priority TEXT NOT NULL DEFAULT 'low',
          assigned_to TEXT,
          location TEXT,
          response_message TEXT,
          responded_at TEXT,
          responded_by TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_tips_status ON tips (status);
        CREATE INDEX IF NOT EXISTS idx_tips_priority ON tips (priority);
        CREATE INDEX IF NOT EXISTS idx_tips_category ON tips (category);
        CREATE INDEX IF NOT EXISTS idx_tips_number ON tips (tip_number);
        CREATE INDEX IF NOT EXISTS idx_tips_created ON tips (created_at DESC);

        -- Contractors (SafeSchool contractor management)
        CREATE TABLE IF NOT EXISTS contractors (
          id TEXT PRIMARY KEY,
          company_name TEXT NOT NULL,
          contact_name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          trade TEXT NOT NULL DEFAULT 'other',
          insurance_expiry TEXT,
          license_number TEXT,
          license_expiry TEXT,
          background_check_date TEXT,
          background_check_status TEXT NOT NULL DEFAULT 'pending',
          certifications JSONB NOT NULL DEFAULT '[]',
          access_zones JSONB NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'active',
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_contractors_status ON contractors (status);
        CREATE INDEX IF NOT EXISTS idx_contractors_trade ON contractors (trade);
        CREATE INDEX IF NOT EXISTS idx_contractors_company ON contractors (company_name);
        CREATE INDEX IF NOT EXISTS idx_contractors_bg_status ON contractors (background_check_status);
        CREATE INDEX IF NOT EXISTS idx_contractors_insurance ON contractors (insurance_expiry);
        CREATE INDEX IF NOT EXISTS idx_contractors_license ON contractors (license_expiry);

        -- Notification Channels (mass notification integration)
        CREATE TABLE IF NOT EXISTS notification_channels (
          id TEXT PRIMARY KEY,
          channel_type TEXT NOT NULL DEFAULT 'webhook',
          config JSONB NOT NULL DEFAULT '{}',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_notif_channels_type ON notification_channels (channel_type);
        CREATE INDEX IF NOT EXISTS idx_notif_channels_active ON notification_channels (active);

        -- Cases (GSOC case management)
        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY,
          case_number TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          case_type TEXT NOT NULL DEFAULT 'other',
          status TEXT NOT NULL DEFAULT 'open',
          priority TEXT NOT NULL DEFAULT 'medium',
          lead_investigator TEXT,
          linked_incidents JSONB NOT NULL DEFAULT '[]',
          linked_alarms JSONB NOT NULL DEFAULT '[]',
          findings TEXT,
          recommendations TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          closed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);
        CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases (priority);
        CREATE INDEX IF NOT EXISTS idx_cases_type ON cases (case_type);
        CREATE INDEX IF NOT EXISTS idx_cases_number ON cases (case_number);
        CREATE INDEX IF NOT EXISTS idx_cases_investigator ON cases (lead_investigator);
        CREATE INDEX IF NOT EXISTS idx_cases_created ON cases (created_at DESC);

        -- Evidence (case evidence with chain of custody)
        CREATE TABLE IF NOT EXISTS evidence (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
          evidence_type TEXT NOT NULL DEFAULT 'digital',
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          file_url TEXT,
          metadata JSONB NOT NULL DEFAULT '{}',
          collected_by TEXT,
          collected_at TEXT,
          chain_of_custody JSONB NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'collected',
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence (case_id);
        CREATE INDEX IF NOT EXISTS idx_evidence_type ON evidence (evidence_type);
        CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence (status);
        CREATE INDEX IF NOT EXISTS idx_evidence_collected ON evidence (collected_at DESC);

        -- PASS Guidelines Compliance (SafeSchool — Partner Alliance for Safer Schools)
        CREATE TABLE IF NOT EXISTS pass_compliance (
          id TEXT PRIMARY KEY,
          guideline_tier TEXT NOT NULL DEFAULT 'tier1_foundational',
          category TEXT NOT NULL DEFAULT 'access_control',
          requirement TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'non_compliant',
          evidence JSONB NOT NULL DEFAULT '{}',
          notes TEXT,
          assessed_by TEXT,
          assessed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_pass_tier ON pass_compliance (guideline_tier);
        CREATE INDEX IF NOT EXISTS idx_pass_category ON pass_compliance (category);
        CREATE INDEX IF NOT EXISTS idx_pass_status ON pass_compliance (status);

        -- Building Systems (SafeSchool — energy/building management integration)
        CREATE TABLE IF NOT EXISTS building_systems (
          id TEXT PRIMARY KEY,
          system_type TEXT NOT NULL DEFAULT 'hvac',
          system_name TEXT NOT NULL,
          location TEXT,
          zone TEXT,
          status TEXT NOT NULL DEFAULT 'online',
          last_value JSONB NOT NULL DEFAULT '{}',
          last_updated TEXT,
          integration_type TEXT NOT NULL DEFAULT 'manual',
          config JSONB NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_building_type ON building_systems (system_type);
        CREATE INDEX IF NOT EXISTS idx_building_status ON building_systems (status);
        CREATE INDEX IF NOT EXISTS idx_building_zone ON building_systems (zone);
        CREATE INDEX IF NOT EXISTS idx_building_integration ON building_systems (integration_type);

        -- Agencies (SafeSchool — inter-agency coordination)
        CREATE TABLE IF NOT EXISTS agencies (
          id TEXT PRIMARY KEY,
          agency_name TEXT NOT NULL,
          agency_type TEXT NOT NULL DEFAULT 'other',
          contact_name TEXT,
          contact_title TEXT,
          contact_phone TEXT,
          contact_email TEXT,
          jurisdiction TEXT,
          protocols JSONB NOT NULL DEFAULT '{}',
          last_drill_date TEXT,
          mou_signed INTEGER NOT NULL DEFAULT 0,
          mou_expiry TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_agencies_type ON agencies (agency_type);
        CREATE INDEX IF NOT EXISTS idx_agencies_mou ON agencies (mou_signed);

        -- Webhooks (all products — outbound event delivery)
        CREATE TABLE IF NOT EXISTS webhooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          events JSONB NOT NULL DEFAULT '[]',
          secret TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          last_triggered TEXT,
          last_status INTEGER,
          failure_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks (active);
        CREATE INDEX IF NOT EXISTS idx_webhooks_created ON webhooks (created_at DESC);

        -- System Health Monitoring (ADRM Defender-style infrastructure health)
        CREATE TABLE IF NOT EXISTS system_health (
          id TEXT PRIMARY KEY,
          system_name TEXT NOT NULL,
          system_type TEXT NOT NULL DEFAULT 'other',
          vendor TEXT NOT NULL DEFAULT 'other',
          ip_address TEXT,
          location TEXT,
          status TEXT NOT NULL DEFAULT 'unknown',
          last_seen TEXT,
          uptime_percent REAL DEFAULT 100.0,
          cpu_usage REAL,
          memory_usage REAL,
          disk_usage REAL,
          firmware_version TEXT,
          patch_level TEXT,
          license_type TEXT,
          license_expiry TEXT,
          warranty_expiry TEXT,
          last_maintenance TEXT,
          notes TEXT,
          device_id TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_system_health_status ON system_health (status);
        CREATE INDEX IF NOT EXISTS idx_system_health_type ON system_health (system_type);
        CREATE INDEX IF NOT EXISTS idx_system_health_vendor ON system_health (vendor);
        CREATE INDEX IF NOT EXISTS idx_system_health_device ON system_health (device_id);

        CREATE TABLE IF NOT EXISTS system_health_history (
          id TEXT PRIMARY KEY,
          system_id TEXT NOT NULL,
          status TEXT NOT NULL,
          cpu_usage REAL,
          memory_usage REAL,
          disk_usage REAL,
          response_time_ms INTEGER,
          checked_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_system_health_history_system ON system_health_history (system_id);
        CREATE INDEX IF NOT EXISTS idx_system_health_history_time ON system_health_history (checked_at DESC);

        -- PACS Analytics Engine (normalized access control events)
        CREATE TABLE IF NOT EXISTS access_events (
          id TEXT PRIMARY KEY,
          org_id TEXT,
          site_id TEXT DEFAULT 'default',
          event_type TEXT NOT NULL DEFAULT 'access_granted',
          timestamp TEXT NOT NULL DEFAULT (NOW()::TEXT),
          cardholder_id TEXT,
          cardholder_name TEXT,
          credential_type TEXT DEFAULT 'card',
          door_id TEXT,
          door_name TEXT,
          reader_id TEXT,
          reader_name TEXT,
          facility_code TEXT,
          location TEXT,
          building TEXT,
          floor TEXT,
          zone TEXT,
          result TEXT DEFAULT 'granted',
          source_system TEXT DEFAULT 'connector',
          source_event_id TEXT,
          metadata JSONB,
          device_id TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_access_events_timestamp ON access_events (timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_access_events_cardholder ON access_events (cardholder_id);
        CREATE INDEX IF NOT EXISTS idx_access_events_door ON access_events (door_id);
        CREATE INDEX IF NOT EXISTS idx_access_events_type ON access_events (event_type);
        CREATE INDEX IF NOT EXISTS idx_access_events_result ON access_events (result);
        CREATE INDEX IF NOT EXISTS idx_access_events_building ON access_events (building);
        CREATE INDEX IF NOT EXISTS idx_access_events_zone ON access_events (zone);
        CREATE INDEX IF NOT EXISTS idx_access_events_device ON access_events (device_id);

        CREATE TABLE IF NOT EXISTS analytics_results (
          id TEXT PRIMARY KEY,
          analysis_type TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'medium',
          title TEXT NOT NULL,
          description TEXT,
          subject_id TEXT,
          subject_name TEXT,
          evidence JSONB,
          status TEXT NOT NULL DEFAULT 'new',
          resolved_by TEXT,
          resolved_at TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_analytics_results_type ON analytics_results (analysis_type);
        CREATE INDEX IF NOT EXISTS idx_analytics_results_severity ON analytics_results (severity);
        CREATE INDEX IF NOT EXISTS idx_analytics_results_status ON analytics_results (status);
        CREATE INDEX IF NOT EXISTS idx_analytics_results_created ON analytics_results (created_at DESC);

        -- Physical Security UEBA (User & Entity Behavior Analytics)
        CREATE TABLE IF NOT EXISTS behavior_baselines (
          id TEXT PRIMARY KEY,
          cardholder_id TEXT NOT NULL UNIQUE,
          cardholder_name TEXT,
          department TEXT,
          typical_doors JSONB DEFAULT '[]',
          typical_hours JSONB DEFAULT '{}',
          typical_zones JSONB DEFAULT '[]',
          avg_daily_events REAL DEFAULT 0,
          avg_weekly_events REAL DEFAULT 0,
          last_calculated TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_behavior_baselines_cardholder ON behavior_baselines (cardholder_id);

        CREATE TABLE IF NOT EXISTS behavior_alerts (
          id TEXT PRIMARY KEY,
          alert_type TEXT NOT NULL,
          cardholder_id TEXT,
          cardholder_name TEXT,
          severity TEXT NOT NULL DEFAULT 'medium',
          description TEXT,
          baseline_value TEXT,
          observed_value TEXT,
          risk_score REAL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'new',
          reviewed_by TEXT,
          reviewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_behavior_alerts_cardholder ON behavior_alerts (cardholder_id);
        CREATE INDEX IF NOT EXISTS idx_behavior_alerts_severity ON behavior_alerts (severity);
        CREATE INDEX IF NOT EXISTS idx_behavior_alerts_status ON behavior_alerts (status);
        CREATE INDEX IF NOT EXISTS idx_behavior_alerts_risk ON behavior_alerts (risk_score DESC);
        CREATE INDEX IF NOT EXISTS idx_behavior_alerts_created ON behavior_alerts (created_at DESC);

        -- Posture Score History (Security Posture Grading)
        CREATE TABLE IF NOT EXISTS posture_history (
          id TEXT PRIMARY KEY,
          score INTEGER NOT NULL,
          grade TEXT NOT NULL,
          metrics JSONB NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_posture_history_created ON posture_history (created_at DESC);

        -- SIEM Config (SIEM/SOC webhook export)
        CREATE TABLE IF NOT EXISTS siem_config (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT 'SIEM Export',
          endpoint_url TEXT NOT NULL,
          format TEXT NOT NULL DEFAULT 'json',
          auth_type TEXT NOT NULL DEFAULT 'none',
          auth_value TEXT,
          events JSONB NOT NULL DEFAULT '[]',
          active INTEGER NOT NULL DEFAULT 1,
          last_sent TEXT,
          failure_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_siem_config_active ON siem_config (active);

        -- SIEM Export Log
        CREATE TABLE IF NOT EXISTS siem_export_log (
          id TEXT PRIMARY KEY,
          siem_config_id TEXT,
          event_type TEXT,
          event_id TEXT,
          status TEXT NOT NULL DEFAULT 'sent',
          status_code INTEGER,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_siem_log_config ON siem_export_log (siem_config_id);
        CREATE INDEX IF NOT EXISTS idx_siem_export_log_created ON siem_export_log (created_at DESC);

        -- Executive Briefings
        CREATE TABLE IF NOT EXISTS briefings (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          period_start TEXT,
          period_end TEXT,
          content JSONB NOT NULL DEFAULT '{}',
          summary_text TEXT,
          generated_by TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_briefings_created ON briefings (created_at DESC);

        -- Handoff Acknowledgments (Shift Handoff)
        CREATE TABLE IF NOT EXISTS handoff_acknowledgments (
          id TEXT PRIMARY KEY,
          operator TEXT NOT NULL,
          notes TEXT,
          acknowledged_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_handoff_ack_at ON handoff_acknowledgments (acknowledged_at DESC);

        -- Multi-Site Command View
        CREATE TABLE IF NOT EXISTS sites (
          id TEXT PRIMARY KEY,
          site_name TEXT NOT NULL,
          address TEXT,
          city TEXT,
          state TEXT,
          country TEXT,
          latitude REAL,
          longitude REAL,
          timezone TEXT,
          risk_score REAL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'normal',
          total_doors INTEGER NOT NULL DEFAULT 0,
          total_cameras INTEGER NOT NULL DEFAULT 0,
          online_devices INTEGER NOT NULL DEFAULT 0,
          offline_devices INTEGER NOT NULL DEFAULT 0,
          active_incidents INTEGER NOT NULL DEFAULT 0,
          active_alarms INTEGER NOT NULL DEFAULT 0,
          last_updated TEXT,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_sites_status ON sites (status);
        CREATE INDEX IF NOT EXISTS idx_sites_risk ON sites (risk_score DESC);
        CREATE INDEX IF NOT EXISTS idx_sites_name ON sites (site_name);

        -- Ticket Config (external ticketing integration)
        CREATE TABLE IF NOT EXISTS ticket_config (
          id TEXT PRIMARY KEY,
          system_type TEXT NOT NULL DEFAULT 'webhook',
          endpoint_url TEXT NOT NULL,
          auth_config JSONB NOT NULL DEFAULT '{}',
          field_mapping JSONB NOT NULL DEFAULT '{}',
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_ticket_config_active ON ticket_config (active);

        -- Ticket Log
        CREATE TABLE IF NOT EXISTS ticket_log (
          id TEXT PRIMARY KEY,
          ticket_config_id TEXT,
          incident_id TEXT,
          ticket_data JSONB NOT NULL DEFAULT '{}',
          result JSONB NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );
        CREATE INDEX IF NOT EXISTS idx_ticket_log_created ON ticket_log (created_at DESC);

        -- Org Settings (timezone, locale, org-level preferences)
        CREATE TABLE IF NOT EXISTS org_settings (
          id TEXT PRIMARY KEY DEFAULT 'default',
          timezone TEXT NOT NULL DEFAULT 'America/New_York',
          locale TEXT NOT NULL DEFAULT 'en-US',
          date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY',
          time_format TEXT NOT NULL DEFAULT '12h',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        INSERT INTO org_settings (id) VALUES ('default') ON CONFLICT DO NOTHING;

        -- Access Schedules (weekly hour grid, holiday overrides, FPI)
        CREATE TABLE IF NOT EXISTS access_schedules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          schedule_type TEXT NOT NULL DEFAULT 'weekly',
          blocks JSONB NOT NULL DEFAULT '[]',
          holidays JSONB NOT NULL DEFAULT '[]',
          first_person_in INTEGER NOT NULL DEFAULT 0,
          is_template INTEGER NOT NULL DEFAULT 0,
          color TEXT DEFAULT '#22c55e',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          org_id TEXT NOT NULL DEFAULT 'default'
        );
        CREATE INDEX IF NOT EXISTS idx_access_schedules_org ON access_schedules (org_id);
        CREATE INDEX IF NOT EXISTS idx_access_schedules_type ON access_schedules (schedule_type);
        CREATE INDEX IF NOT EXISTS idx_access_schedules_template ON access_schedules (is_template);

        -- Access Levels (group schedules + doors + cardholders)
        CREATE TABLE IF NOT EXISTS access_levels (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          schedule_id TEXT,
          doors JSONB NOT NULL DEFAULT '[]',
          cardholders JSONB NOT NULL DEFAULT '[]',
          priority INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          org_id TEXT NOT NULL DEFAULT 'default'
        );
        CREATE INDEX IF NOT EXISTS idx_access_levels_org ON access_levels (org_id);
        CREATE INDEX IF NOT EXISTS idx_access_levels_schedule ON access_levels (schedule_id);
        CREATE INDEX IF NOT EXISTS idx_access_levels_active ON access_levels (active);

        -- Accounts (SaaS multi-tenancy: the paying customer)
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          account_name TEXT NOT NULL,
          slug TEXT UNIQUE NOT NULL,
          account_type TEXT NOT NULL DEFAULT 'standard',
          products TEXT[] NOT NULL DEFAULT '{}',
          plan TEXT NOT NULL DEFAULT 'free',
          max_sites INTEGER NOT NULL DEFAULT 1,
          max_users INTEGER NOT NULL DEFAULT 5,
          max_devices INTEGER NOT NULL DEFAULT 10,
          billing_email TEXT,
          billing_model TEXT NOT NULL DEFAULT 'flat',
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          settings JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_accounts_slug ON accounts (slug);
        CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts (status);
        CREATE INDEX IF NOT EXISTS idx_accounts_stripe ON accounts (stripe_customer_id);

        -- Account Sites (locations/buildings within an account)
        CREATE TABLE IF NOT EXISTS account_sites (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          site_name TEXT NOT NULL,
          site_code TEXT,
          address TEXT,
          city TEXT,
          state TEXT,
          country TEXT,
          latitude REAL,
          longitude REAL,
          timezone TEXT,
          site_type TEXT DEFAULT 'building',
          region TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          settings JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_account_sites_account ON account_sites (account_id);
        CREATE INDEX IF NOT EXISTS idx_account_sites_region ON account_sites (region);
        CREATE INDEX IF NOT EXISTS idx_account_sites_status ON account_sites (status);

        -- User Site Roles (per-site role assignments for multi-site accounts)
        CREATE TABLE IF NOT EXISTS user_site_roles (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          site_id TEXT REFERENCES account_sites(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'viewer',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id, site_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_site_roles_user ON user_site_roles (user_id);
        CREATE INDEX IF NOT EXISTS idx_user_site_roles_site ON user_site_roles (site_id);
        CREATE INDEX IF NOT EXISTS idx_user_site_roles_account ON user_site_roles (account_id);

        -- Account SSO Configs (per-customer OAuth/SAML configuration)
        CREATE TABLE IF NOT EXISTS account_sso_configs (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          client_id TEXT,
          client_secret_encrypted TEXT,
          tenant_id TEXT,
          domain TEXT,
          config JSONB NOT NULL DEFAULT '{}',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_sso_configs_account ON account_sso_configs (account_id);
        CREATE INDEX IF NOT EXISTS idx_sso_configs_domain ON account_sso_configs (domain);

        -- Activation Key to Account mapping (links keys to accounts for auto-provisioning)
        CREATE TABLE IF NOT EXISTS activation_key_accounts (
          activation_key TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ak_accounts_account ON activation_key_accounts (account_id);

        -- Widget Config (embeddable widget settings)
        CREATE TABLE IF NOT EXISTS widget_config (
          id TEXT PRIMARY KEY,
          allowed_origins JSONB NOT NULL DEFAULT '["*"]',
          theme TEXT NOT NULL DEFAULT 'dark',
          refresh_interval INTEGER NOT NULL DEFAULT 30,
          show_sections JSONB NOT NULL DEFAULT '["alarms","incidents","devices","posture","events"]',
          created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
          updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
        );

        -- Pairing Codes (TV-style device pairing flow)
        CREATE TABLE IF NOT EXISTS pairing_codes (
          code TEXT PRIMARY KEY,
          device_fingerprint TEXT NOT NULL,
          product TEXT NOT NULL,
          hostname TEXT,
          ip_address TEXT,
          version TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          claimed_by_account_id TEXT,
          claimed_at TIMESTAMPTZ,
          claim_response JSONB
        );
        CREATE INDEX IF NOT EXISTS idx_pairing_codes_fingerprint ON pairing_codes (device_fingerprint);
        CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires ON pairing_codes (expires_at);

        -- Cardholder Sync Mappings (bidirectional PAC sync)
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
      `).split(/\n\s*(?=-- [A-Z])/).filter(b => b.trim());

      let failures = 0;
      for (const block of schemaBlocks) {
        try {
          await client.query(block);
        } catch (e: any) {
          failures++;
          log.warn({ err: e.message, block: block.slice(0, 80) }, 'Schema block failed (stale table?)');
        }
      }

      this.migrated = true;
      log.info({ tables: schemaBlocks.length, failures }, 'PostgreSQL tables ensured');
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
      // Include devices belonging to this org AND unassigned devices (org_id IS NULL)
      query += ' WHERE (org_id = $1 OR org_id IS NULL)';
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

  // ─── Multi-tenancy methods ─────────────────────────────────

  async resolveActivationKey(key: string): Promise<{ accountId: string } | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query(
      'SELECT account_id FROM activation_key_accounts WHERE activation_key = $1',
      [key],
    );
    return rows.length > 0 ? { accountId: String(rows[0].account_id) } : null;
  }

  async linkKeyToAccount(key: string, accountId: string): Promise<void> {
    await this.ensureTables();
    await this.pool.query(
      `INSERT INTO activation_key_accounts (activation_key, account_id)
       VALUES ($1, $2) ON CONFLICT (activation_key) DO UPDATE SET account_id = $2`,
      [key, accountId],
    );
  }

  async createAccount(opts: {
    accountName: string; slug?: string; products?: string[];
    plan?: string; billingEmail?: string; billingModel?: string;
  }): Promise<{ id: string }> {
    await this.ensureTables();
    const id = (await import('node:crypto')).randomUUID();
    const slug = opts.slug || opts.accountName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await this.pool.query(`
      INSERT INTO accounts (id, account_name, slug, products, plan, billing_email, billing_model)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, opts.accountName, slug, opts.products || ['safeschool'],
        opts.plan || 'free', opts.billingEmail || null, opts.billingModel || 'flat']);
    return { id };
  }

  async createAccountSite(accountId: string, opts: {
    siteName: string; siteCode?: string; address?: string;
    city?: string; state?: string; timezone?: string; siteType?: string;
  }): Promise<{ id: string }> {
    await this.ensureTables();
    const id = (await import('node:crypto')).randomUUID();
    await this.pool.query(`
      INSERT INTO account_sites (id, account_id, site_name, site_code, address, city, state, site_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, accountId, opts.siteName, opts.siteCode || null, opts.address || null,
        opts.city || null, opts.state || null, opts.siteType || 'building']);
    return { id };
  }

  // ─── Pairing Code Methods ──────────────────────────────────────

  async createPairingCode(opts: {
    code: string;
    deviceFingerprint: string;
    product: string;
    hostname?: string;
    ipAddress?: string;
    version?: string;
    expiresAt: string;
  }): Promise<void> {
    await this.ensureTables();
    await this.pool.query(`
      INSERT INTO pairing_codes (code, device_fingerprint, product, hostname, ip_address, version, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (code) DO UPDATE SET
        device_fingerprint = $2, product = $3, hostname = $4,
        ip_address = $5, version = $6, expires_at = $7,
        created_at = NOW(), claimed_by_account_id = NULL,
        claimed_at = NULL, claim_response = NULL
    `, [opts.code, opts.deviceFingerprint, opts.product,
        opts.hostname || null, opts.ipAddress || null, opts.version || null, opts.expiresAt]);
  }

  async getPairingCode(code: string): Promise<{
    code: string;
    deviceFingerprint: string;
    product: string;
    hostname?: string;
    ipAddress?: string;
    version?: string;
    expiresAt: string;
    claimedAt?: string;
    claimedByAccountId?: string;
    claimResponse?: Record<string, unknown>;
  } | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query(
      'SELECT * FROM pairing_codes WHERE code = $1', [code],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      code: r.code,
      deviceFingerprint: r.device_fingerprint,
      product: r.product,
      hostname: r.hostname || undefined,
      ipAddress: r.ip_address || undefined,
      version: r.version || undefined,
      expiresAt: new Date(r.expires_at).toISOString(),
      claimedAt: r.claimed_at ? new Date(r.claimed_at).toISOString() : undefined,
      claimedByAccountId: r.claimed_by_account_id || undefined,
      claimResponse: r.claim_response || undefined,
    };
  }

  async getPairingCodeByFingerprint(fingerprint: string): Promise<{
    code: string;
    expiresAt: string;
    claimedAt?: string;
  } | null> {
    await this.ensureTables();
    const { rows } = await this.pool.query(
      `SELECT code, expires_at, claimed_at FROM pairing_codes
       WHERE device_fingerprint = $1
       ORDER BY created_at DESC LIMIT 1`,
      [fingerprint],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      code: r.code,
      expiresAt: new Date(r.expires_at).toISOString(),
      claimedAt: r.claimed_at ? new Date(r.claimed_at).toISOString() : undefined,
    };
  }

  async claimPairingCode(code: string, opts: {
    claimedByAccountId?: string;
    claimResponse: Record<string, unknown>;
  }): Promise<void> {
    await this.ensureTables();
    await this.pool.query(`
      UPDATE pairing_codes
      SET claimed_by_account_id = $2, claimed_at = NOW(), claim_response = $3
      WHERE code = $1
    `, [code, opts.claimedByAccountId || null, JSON.stringify(opts.claimResponse)]);
  }

  async cleanExpiredPairingCodes(): Promise<number> {
    await this.ensureTables();
    const result = await this.pool.query(
      `DELETE FROM pairing_codes WHERE expires_at < NOW() AND claimed_at IS NULL`,
    );
    return result.rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
