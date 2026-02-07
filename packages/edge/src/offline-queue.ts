/**
 * SafeSchool Offline Queue
 *
 * Persistent queue backed by better-sqlite3 for storing pending sync operations
 * when the edge device cannot reach the cloud. Uses WAL mode for performance.
 * Implements exponential backoff on retries (max 5 retries, 30s -> 16min).
 */

import Database from 'better-sqlite3';

export interface QueuedOperation {
  id: number;
  entity: string;
  operation: 'create' | 'update' | 'delete';
  data: string; // JSON-serialized
  createdAt: string;
  retryCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  status: 'pending' | 'processing' | 'failed' | 'complete';
}

export interface QueueStats {
  pending: number;
  failed: number;
  complete: number;
  oldestPending: string | null;
}

// Backoff schedule: 30s, 2min, 8min, 16min, 16min (capped)
const BASE_BACKOFF_MS = 30_000;
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 16 * 60 * 1000; // 16 minutes

function calculateBackoffMs(retryCount: number): number {
  // Exponential: 30s * 4^retryCount, capped at 16min
  const backoff = BASE_BACKOFF_MS * Math.pow(4, retryCount);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

export class OfflineQueue {
  private db: Database.Database;

  // Prepared statements (lazily initialized after ensureTable)
  private stmtEnqueue!: Database.Statement;
  private stmtDequeue!: Database.Statement;
  private stmtMarkComplete!: Database.Statement;
  private stmtMarkFailed!: Database.Statement;
  private stmtPendingCount!: Database.Statement;
  private stmtFailedCount!: Database.Statement;
  private stmtCompleteCount!: Database.Statement;
  private stmtOldestPending!: Database.Statement;
  private stmtClear!: Database.Statement;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.ensureTable();
    this.prepareStatements();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed', 'complete'))
      );

      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_next_retry ON sync_queue(next_retry_at);
    `);
  }

  private prepareStatements(): void {
    this.stmtEnqueue = this.db.prepare(`
      INSERT INTO sync_queue (entity, operation, data, created_at, status)
      VALUES (?, ?, ?, datetime('now'), 'pending')
    `);

    this.stmtDequeue = this.db.prepare(`
      SELECT id, entity, operation, data, created_at AS createdAt,
             retry_count AS retryCount, next_retry_at AS nextRetryAt,
             last_error AS lastError, status
      FROM sync_queue
      WHERE status IN ('pending', 'failed')
        AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
      ORDER BY created_at ASC
      LIMIT ?
    `);

    this.stmtMarkComplete = this.db.prepare(`
      UPDATE sync_queue SET status = 'complete' WHERE id = ?
    `);

    this.stmtMarkFailed = this.db.prepare(`
      UPDATE sync_queue
      SET status = CASE WHEN retry_count >= ? THEN 'failed' ELSE 'pending' END,
          retry_count = retry_count + 1,
          last_error = ?,
          next_retry_at = ?
      WHERE id = ?
    `);

    this.stmtPendingCount = this.db.prepare(`
      SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'pending'
    `);

    this.stmtFailedCount = this.db.prepare(`
      SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'failed'
    `);

    this.stmtCompleteCount = this.db.prepare(`
      SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'complete'
    `);

    this.stmtOldestPending = this.db.prepare(`
      SELECT created_at AS createdAt FROM sync_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `);

    this.stmtClear = this.db.prepare(`DELETE FROM sync_queue`);
  }

  /**
   * Enqueue a sync operation for later processing.
   */
  enqueue(entity: string, operation: 'create' | 'update' | 'delete', data: unknown): number {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    const result = this.stmtEnqueue.run(entity, operation, serialized);
    return result.lastInsertRowid as number;
  }

  /**
   * Dequeue the oldest pending operations up to batchSize.
   * Only returns operations whose retry time has elapsed.
   */
  dequeue(batchSize: number = 10): QueuedOperation[] {
    const rows = this.stmtDequeue.all(batchSize) as QueuedOperation[];
    return rows;
  }

  /**
   * Mark operations as successfully completed.
   */
  markComplete(ids: number[]): void {
    const transaction = this.db.transaction((opIds: number[]) => {
      for (const id of opIds) {
        this.stmtMarkComplete.run(id);
      }
    });
    transaction(ids);
  }

  /**
   * Mark operations as failed, incrementing retry count and setting next retry time.
   * If max retries exceeded, the operation stays in 'failed' status permanently.
   */
  markFailed(ids: number[], error: string): void {
    const transaction = this.db.transaction((opIds: number[]) => {
      for (const id of opIds) {
        // Get current retry count
        const row = this.db.prepare(
          'SELECT retry_count FROM sync_queue WHERE id = ?'
        ).get(id) as { retry_count: number } | undefined;

        if (!row) continue;

        const currentRetry = row.retry_count;
        const backoffMs = calculateBackoffMs(currentRetry);
        const nextRetry = new Date(Date.now() + backoffMs).toISOString();

        this.stmtMarkFailed.run(MAX_RETRIES, error, nextRetry, id);
      }
    });
    transaction(ids);
  }

  /**
   * Get queue statistics.
   */
  getStats(): QueueStats {
    const pending = (this.stmtPendingCount.get() as { count: number }).count;
    const failed = (this.stmtFailedCount.get() as { count: number }).count;
    const complete = (this.stmtCompleteCount.get() as { count: number }).count;
    const oldest = this.stmtOldestPending.get() as { createdAt: string } | undefined;

    return {
      pending,
      failed,
      complete,
      oldestPending: oldest?.createdAt ?? null,
    };
  }

  /**
   * Clear all entries from the queue.
   */
  clear(): void {
    this.stmtClear.run();
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
