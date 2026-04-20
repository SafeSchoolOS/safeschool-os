// @ts-nocheck — pg types from monorepo root, same as postgres-adapter.ts
/**
 * Backup & Restore Routes
 *
 * Provides database backup/restore API for fleet management:
 *   - GET  /backups         — list available backups
 *   - POST /backup          — create a new backup (JSON dump of all tables)
 *   - POST /restore/:name   — restore from a named backup
 *   - DELETE /backup/:name  — delete a backup
 *   - POST /demo-reset      — restore demo seed data (used by cron)
 *
 * Backups are stored as JSON files in the data directory.
 * Demo seed is a special backup named "demo-seed" that can be auto-restored on interval.
 */

import { createLogger } from '@edgeruntime/core';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import pg from 'pg';

const log = createLogger('cloud-sync:backup');

const BACKUP_TABLES = [
  'sync_entities',
  'sync_devices',
  'sync_device_configs',
  'sync_licenses',
  'sync_users',
  'panic_alerts',
  'visitors',
  'watchlist',
  'incidents',
  'incident_updates',
  'sops',
  'alarms',
  'drills',
  'guard_tours',
  'guard_checkpoints',
  'guard_shifts',
  'notifications',
  'notification_contacts',
  'notification_templates',
  'notification_channels',
  'reunification_events',
  'reunification_records',
  'threat_assessments',
  'sensor_events',
  'floor_plans',
  'risk_scores',
  'hall_passes',
  'grants',
  'tenants',
  'tips',
  'contractors',
  'cases',
  'evidence',
  'pass_compliance',
  'building_systems',
  'agencies',
  'webhooks',
  'audit_log',
  'compliance_reports',
  'signin_flows',
  'system_health',
  'system_health_history',
  'access_events',
  'analytics_results',
  'behavior_baselines',
  'behavior_alerts',
  'posture_history',
  'siem_config',
  'briefings',
  'tickets',
  'ticket_comments',
  'ticket_config',
  'widget_config',
  'multisite_commands',
];

export interface BackupRoutesOptions {
  /** Directory to store backup JSON files */
  backupDir?: string;
  /** PostgreSQL connection string (defaults to DATABASE_URL) */
  connectionString?: string;
}

interface BackupManifest {
  name: string;
  createdAt: string;
  tables: Record<string, number>;
  sizeBytes: number;
}

async function dumpAllTables(pool: pg.Pool): Promise<Record<string, any[]>> {
  const dump: Record<string, any[]> = {};
  for (const table of BACKUP_TABLES) {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table}`);
      dump[table] = rows;
    } catch {
      // Table may not exist yet
      dump[table] = [];
    }
  }
  return dump;
}

async function restoreAllTables(pool: pg.Pool, dump: Record<string, any[]>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const client = await pool.connect();
  try {
    // Fix legacy NOT NULL constraints on access_events BEFORE transaction
    try {
      await client.query(`
        DO $$ DECLARE col_rec RECORD;
        BEGIN
          FOR col_rec IN
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'access_events' AND is_nullable = 'NO' AND column_name != 'id'
          LOOP
            BEGIN
              EXECUTE 'ALTER TABLE access_events ALTER COLUMN ' || quote_ident(col_rec.column_name) || ' DROP NOT NULL';
            EXCEPTION WHEN others THEN NULL;
            END;
          END LOOP;
        EXCEPTION WHEN undefined_table THEN NULL;
        END $$
      `);
    } catch (err) { log.debug({ err }, 'Schema fixup: access_events table may not exist'); }

    // Also fix id column type if needed
    try {
      await client.query(`
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'access_events' AND column_name = 'id' AND data_type IN ('integer', 'bigint')
          ) THEN
            ALTER TABLE access_events ALTER COLUMN id DROP DEFAULT;
            ALTER TABLE access_events ALTER COLUMN id SET DATA TYPE TEXT USING id::TEXT;
          END IF;
        EXCEPTION WHEN others THEN NULL;
        END $$
      `);
    } catch (err) { log.debug({ err }, 'Schema fixup: access_events id column type change failed'); }

    await client.query('BEGIN');

    // Truncate in reverse order to avoid FK issues
    for (const table of [...BACKUP_TABLES].reverse()) {
      await client.query('SAVEPOINT del_sp');
      try {
        await client.query(`DELETE FROM ${table}`);
        await client.query('RELEASE SAVEPOINT del_sp');
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT del_sp').catch((spErr) => { log.debug({ err: spErr }, 'Rollback to savepoint del_sp failed'); });
      }
    }

    for (const table of BACKUP_TABLES) {
      const rows = dump[table];
      if (!rows || rows.length === 0) {
        counts[table] = 0;
        continue;
      }

      // Build INSERT from column names of the first row
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

      let inserted = 0;
      for (const row of rows) {
        try {
          const values = columns.map(col => {
            const val = row[col];
            if (Array.isArray(val)) return val;
            return val;
          });
          // Use SAVEPOINT so a single row failure doesn't abort the whole transaction
          await client.query('SAVEPOINT row_sp');
          await client.query(insertSql, values);
          await client.query('RELEASE SAVEPOINT row_sp');
          inserted++;
        } catch (err: any) {
          await client.query('ROLLBACK TO SAVEPOINT row_sp').catch((spErr) => { log.debug({ err: spErr }, 'Rollback to savepoint row_sp failed'); });
          if (inserted === 0 && rows.indexOf(row) === 0) {
            log.warn({ table, err: err.message }, 'Row insert skipped');
          }
        }
      }
      counts[table] = inserted;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return counts;
}

export async function backupRoutes(fastify: FastifyInstance, opts: BackupRoutesOptions) {
  const connStr = opts.connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    log.warn('No DATABASE_URL — backup routes disabled');
    return;
  }

  const backupDir = opts.backupDir || join(process.cwd(), 'data', 'backups');
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const pool = new pg.Pool({
    connectionString: connStr,
    max: 3,
    ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // GET /backups — list available backups
  fastify.get('/backups', async (_request: FastifyRequest, reply: FastifyReply) => {
    const files = readdirSync(backupDir).filter(f => f.endsWith('.json'));
    const backups: BackupManifest[] = [];

    for (const file of files) {
      try {
        const path = join(backupDir, file);
        const raw = readFileSync(path, 'utf-8');
        const data = JSON.parse(raw);
        const stats = { size: Buffer.byteLength(raw, 'utf-8') };
        backups.push({
          name: file.replace('.json', ''),
          createdAt: data._createdAt || 'unknown',
          tables: Object.fromEntries(
            BACKUP_TABLES.map(t => [t, (data[t] || []).length])
          ),
          sizeBytes: stats.size,
        });
      } catch {
        // skip corrupt files
      }
    }

    return reply.send({ backups: backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  });

  // POST /backup — create a new backup
  fastify.post('/backup', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = (request.body as any) || {};
    const backupName = name || `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const safeName = backupName.replace(/[^a-zA-Z0-9_-]/g, '_');

    const dump = await dumpAllTables(pool);
    (dump as any)._createdAt = new Date().toISOString();
    (dump as any)._name = safeName;

    const json = JSON.stringify(dump, null, 2);
    const filePath = join(backupDir, `${safeName}.json`);
    writeFileSync(filePath, json, 'utf-8');

    const tableCounts = Object.fromEntries(
      BACKUP_TABLES.map(t => [t, (dump[t] || []).length])
    );

    log.info({ name: safeName, tables: tableCounts }, 'Backup created');
    return reply.send({
      success: true,
      name: safeName,
      tables: tableCounts,
      sizeBytes: Buffer.byteLength(json, 'utf-8'),
    });
  });

  // POST /restore/:name — restore from a named backup
  fastify.post('/restore/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = join(backupDir, `${safeName}.json`);

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: `Backup "${safeName}" not found` });
    }

    const raw = readFileSync(filePath, 'utf-8');
    const dump = JSON.parse(raw);
    const counts = await restoreAllTables(pool, dump);

    log.info({ name: safeName, restored: counts }, 'Backup restored');
    return reply.send({ success: true, name: safeName, restored: counts });
  });

  // DELETE /backup/:name — delete a backup
  fastify.delete('/backup/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = join(backupDir, `${safeName}.json`);

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: `Backup "${safeName}" not found` });
    }

    unlinkSync(filePath);
    log.info({ name: safeName }, 'Backup deleted');
    return reply.send({ success: true, deleted: safeName });
  });

  // POST /demo-reset — restore demo seed data
  fastify.post('/demo-reset', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = (request.query || {}) as Record<string, string>;
    const product = q.product || process.env.PRODUCT || 'safeschool';
    const seedPath = join(backupDir, 'demo-seed.json');

    // Auto-generate seed if missing
    if (!existsSync(seedPath)) {
      try {
        const { generateDemoSeed } = await import('./pac-emulator.js');
        const seed = generateDemoSeed(product.toLowerCase()) as any;
        seed._createdAt = new Date().toISOString();
        seed._name = 'demo-seed';
        seed._description = 'Auto-generated demo seed — ' + product;
        writeFileSync(seedPath, JSON.stringify(seed, null, 2), 'utf-8');
        log.info({ product }, 'Demo seed auto-generated on reset');
      } catch (err) {
        return reply.code(404).send({ error: 'No demo-seed.json found and auto-generation failed' });
      }
    }

    const raw = readFileSync(seedPath, 'utf-8');
    const dump = JSON.parse(raw);
    const counts = await restoreAllTables(pool, dump);

    log.info({ restored: counts }, 'Demo data reset from seed');
    return reply.send({ success: true, restored: counts });
  });

  // POST /generate-demo-seed — generate fresh demo seed from PAC emulator
  fastify.post('/generate-demo-seed', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = (request.query || {}) as Record<string, string>;
      const product = q.product || process.env.PRODUCT || 'safeschool';
      const { generateDemoSeed } = await import('./pac-emulator.js');
      const seed = generateDemoSeed(product.toLowerCase()) as any;
      seed._createdAt = new Date().toISOString();
      seed._name = 'demo-seed';
      seed._description = 'Generated demo seed — ' + product;

      const json = JSON.stringify(seed, null, 2);
      writeFileSync(join(backupDir, 'demo-seed.json'), json, 'utf-8');

      // Also restore it immediately
      const counts = await restoreAllTables(pool, seed);

      log.info({ product, events: (seed.access_events || []).length }, 'Demo seed generated and restored');
      return reply.send({
        success: true,
        product,
        events: (seed.access_events || []).length,
        restored: counts,
      });
    } catch (err: any) {
      log.error({ err }, 'Failed to generate demo seed');
      return reply.code(500).send({ error: 'Failed to generate demo seed: ' + err.message });
    }
  });

  // POST /snapshot-demo-seed — capture current data as the demo seed
  fastify.post('/snapshot-demo-seed', async (_request: FastifyRequest, reply: FastifyReply) => {
    const dump = await dumpAllTables(pool);
    (dump as any)._createdAt = new Date().toISOString();
    (dump as any)._name = 'demo-seed';
    (dump as any)._description = 'Demo seed data — auto-restored on interval';

    const json = JSON.stringify(dump, null, 2);
    const filePath = join(backupDir, 'demo-seed.json');
    writeFileSync(filePath, json, 'utf-8');

    const tableCounts = Object.fromEntries(
      BACKUP_TABLES.map(t => [t, (dump[t] || []).length])
    );

    log.info({ tables: tableCounts }, 'Demo seed snapshot saved');
    return reply.send({ success: true, tables: tableCounts });
  });
}

/**
 * Start the demo reset cron — restores demo-seed.json every intervalMs.
 * Call this from the runtime after API server boots.
 */
export function startDemoResetCron(intervalMs: number = 30 * 60 * 1000): NodeJS.Timeout | null {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) return null;

  const backupDir = join(process.cwd(), 'data', 'backups');
  const seedPath = join(backupDir, 'demo-seed.json');

  const doReset = async () => {
    if (!existsSync(seedPath)) {
      log.debug('Demo seed not found, skipping reset');
      return;
    }

    try {
      const pool = new pg.Pool({
        connectionString: connStr,
        max: 3,
        ssl: connStr.includes('sslmode=require') || connStr.includes('railway.app')
          ? { rejectUnauthorized: false }
          : undefined,
      });

      const raw = readFileSync(seedPath, 'utf-8');
      const dump = JSON.parse(raw);
      const counts = await restoreAllTables(pool, dump);
      await pool.end();

      log.info({ restored: counts }, 'Demo data auto-reset from seed');
    } catch (err) {
      log.error({ err }, 'Demo reset cron failed');
    }
  };

  log.info({ intervalMs }, 'Demo reset cron started');
  // Run immediately on startup so demo data is available right away
  doReset();
  return setInterval(doReset, intervalMs);
}
