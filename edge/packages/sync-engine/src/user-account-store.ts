/**
 * EdgeRuntime User Account Store
 *
 * SQLite-backed credential store for edge devices.
 * Cloud is the single source of truth — on each sync pull,
 * all local accounts are replaced with the cloud account set.
 * Uses better-sqlite3 for file-backed persistence and low memory usage.
 */

import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('user-account-store');

export interface UserAccount {
  id: string;
  username: string;
  email?: string;
  passwordHash: string;
  role: string;
  siteId?: string;
  enabled: boolean;
  syncedAt: string;
}

export class UserAccountStore {
  private db: BetterSqlite3Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        site_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        synced_at TEXT NOT NULL
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_user_accounts_username ON user_accounts(username)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON user_accounts(email)`);
  }

  /**
   * Replace all local accounts with the cloud account set.
   * Runs in a transaction: DELETE all + INSERT all.
   */
  async replaceAll(accounts: UserAccount[]): Promise<void> {
    const insertStmt = this.db.prepare(
      `INSERT INTO user_accounts (id, username, email, password_hash, role, site_id, enabled, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = this.db.transaction((accounts: UserAccount[]) => {
      this.db.exec('DELETE FROM user_accounts');

      for (const account of accounts) {
        insertStmt.run(
          account.id,
          account.username,
          account.email ?? null,
          account.passwordHash,
          account.role,
          account.siteId ?? null,
          account.enabled ? 1 : 0,
          account.syncedAt,
        );
      }
    });

    tx(accounts);
    log.info({ count: accounts.length }, 'User accounts replaced from cloud sync');
  }

  async getByUsername(username: string): Promise<UserAccount | null> {
    const row = this.db.prepare('SELECT * FROM user_accounts WHERE username = ? AND enabled = 1').get(username) as Record<string, unknown> | undefined;
    return row ? this.rowToAccount(row) : null;
  }

  async getByEmail(email: string): Promise<UserAccount | null> {
    const row = this.db.prepare('SELECT * FROM user_accounts WHERE email = ? AND enabled = 1').get(email) as Record<string, unknown> | undefined;
    return row ? this.rowToAccount(row) : null;
  }

  async getAll(): Promise<UserAccount[]> {
    const rows = this.db.prepare('SELECT * FROM user_accounts').all() as Record<string, unknown>[];
    return rows.map(row => this.rowToAccount(row));
  }

  /**
   * Verify a password against the stored bcrypt hash.
   * Uses timing-safe comparison via the bcryptjs library.
   */
  async verifyPassword(username: string, password: string): Promise<boolean> {
    const account = await this.getByUsername(username);
    if (!account) return false;

    // Dynamic import to keep bcryptjs optional at module load time
    const { compare } = await import('bcryptjs');
    return compare(password, account.passwordHash);
  }

  async getCount(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM user_accounts').get() as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }

  private rowToAccount(row: Record<string, unknown>): UserAccount {
    return {
      id: String(row.id),
      username: String(row.username),
      email: row.email ? String(row.email) : undefined,
      passwordHash: String(row.password_hash),
      role: String(row.role),
      siteId: row.site_id ? String(row.site_id) : undefined,
      enabled: Boolean(row.enabled),
      syncedAt: String(row.synced_at),
    };
  }
}
