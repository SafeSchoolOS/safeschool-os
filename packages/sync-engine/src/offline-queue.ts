/**
 * EdgeRuntime Offline Queue
 *
 * Persistent queue backed by better-sqlite3 for storing pending sync operations
 * when the edge device cannot reach the cloud.
 * Implements exponential backoff on retries (max 5 retries, 30s -> 16min).
 * Uses better-sqlite3 for file-backed persistence and low memory usage.
 */

import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';

export interface QueuedOperation {
  id: number;
  entity: string;
  operation: 'create' | 'update' | 'delete';
  data: string;
  createdAt: string;
  retryCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  status: 'pending' | 'processing' | 'failed' | 'complete';
  targetUrl: string | null;
}

export interface QueueStats {
  pending: number;
  failed: number;
  complete: number;
  oldestPending: string | null;
}

const BASE_BACKOFF_MS = 30_000;
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 16 * 60 * 1000;

function calculateBackoffMs(retryCount: number): number {
  const backoff = BASE_BACKOFF_MS * Math.pow(4, retryCount);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

export class OfflineQueue {
  private db: BetterSqlite3Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed', 'complete')),
        target_url TEXT
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_next_retry ON sync_queue(next_retry_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_queue_target_url ON sync_queue(target_url)`);
  }

  /**
   * Wait for the queue to be initialized.
   * No-op with better-sqlite3 (synchronous init), kept for backward compat.
   */
  async ready(): Promise<void> {
    // better-sqlite3 is synchronous — nothing to wait for
  }

  enqueue(entity: string, operation: 'create' | 'update' | 'delete', data: unknown, targetUrl?: string): number {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    const stmt = this.db.prepare(
      `INSERT INTO sync_queue (entity, operation, data, created_at, status, target_url) VALUES (?, ?, ?, ?, 'pending', ?)`
    );
    const result = stmt.run(entity, operation, serialized, nowISO(), targetUrl ?? null);
    return Number(result.lastInsertRowid);
  }

  dequeue(batchSize: number = 10, targetUrl?: string): QueuedOperation[] {
    const now = nowISO();

    let sql = `
      SELECT id, entity, operation, data, created_at AS createdAt,
             retry_count AS retryCount, next_retry_at AS nextRetryAt,
             last_error AS lastError, status, target_url AS targetUrl
      FROM sync_queue
      WHERE status IN ('pending', 'failed')
        AND retry_count < ?
        AND (next_retry_at IS NULL OR next_retry_at <= ?)`;

    const params: unknown[] = [MAX_RETRIES, now];

    if (targetUrl !== undefined) {
      sql += `\n        AND (target_url = ? OR target_url IS NULL)`;
      params.push(targetUrl);
    }

    sql += `\n      ORDER BY created_at ASC\n      LIMIT ?`;
    params.push(batchSize);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      entity: row.entity,
      operation: row.operation,
      data: row.data,
      createdAt: row.createdAt,
      retryCount: row.retryCount,
      nextRetryAt: row.nextRetryAt,
      lastError: row.lastError,
      status: row.status,
      targetUrl: row.targetUrl ?? null,
    }));
  }

  /**
   * Dequeue operations grouped by target URL.
   * Returns a map of targetUrl -> QueuedOperation[].
   * Operations with NULL target_url are grouped under empty string key.
   */
  dequeueGrouped(batchSize: number = 50): Map<string, QueuedOperation[]> {
    const all = this.dequeue(batchSize);
    const grouped = new Map<string, QueuedOperation[]>();

    for (const op of all) {
      const key = op.targetUrl ?? '';
      const batch = grouped.get(key) ?? [];
      batch.push(op);
      grouped.set(key, batch);
    }

    return grouped;
  }

  markComplete(ids: number[]): void {
    const stmt = this.db.prepare(`UPDATE sync_queue SET status = 'complete' WHERE id = ?`);
    const tx = this.db.transaction((ids: number[]) => {
      for (const id of ids) {
        stmt.run(id);
      }
    });
    tx(ids);
  }

  markFailed(ids: number[], error: string): void {
    const selectStmt = this.db.prepare(`SELECT retry_count FROM sync_queue WHERE id = ?`);
    const updateStmt = this.db.prepare(
      `UPDATE sync_queue SET status = ?, retry_count = retry_count + 1, last_error = ?, next_retry_at = ? WHERE id = ?`
    );

    const tx = this.db.transaction((ids: number[], error: string) => {
      for (const id of ids) {
        const row = selectStmt.get(id) as { retry_count: number } | undefined;
        if (!row) continue;

        const currentRetry = row.retry_count;
        const backoffMs = calculateBackoffMs(currentRetry);
        const nextRetry = new Date(Date.now() + backoffMs).toISOString();
        const newStatus = currentRetry + 1 >= MAX_RETRIES ? 'failed' : 'pending';
        const nextRetryVal = currentRetry + 1 >= MAX_RETRIES ? null : nextRetry;

        updateStmt.run(newStatus, error, nextRetryVal, id);
      }
    });
    tx(ids, error);
  }

  getStats(): QueueStats {
    const pending = (this.db.prepare(`SELECT COUNT(*) as cnt FROM sync_queue WHERE status = 'pending'`).get() as any).cnt;
    const failed = (this.db.prepare(`SELECT COUNT(*) as cnt FROM sync_queue WHERE status = 'failed'`).get() as any).cnt;
    const complete = (this.db.prepare(`SELECT COUNT(*) as cnt FROM sync_queue WHERE status = 'complete'`).get() as any).cnt;
    const oldest = this.db.prepare(`SELECT created_at FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`).get() as { created_at: string } | undefined;

    return { pending, failed, complete, oldestPending: oldest?.created_at ?? null };
  }

  clear(): void {
    this.db.exec(`DELETE FROM sync_queue`);
  }

  close(): void {
    this.db.close();
  }
}
