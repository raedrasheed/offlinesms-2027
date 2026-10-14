// Phase 22 — SQLite connection management (the ONLY module that imports
// expo-sqlite). Repositories depend on the `LocalDatabase` interface, not on
// expo-sqlite directly, so they remain testable with an in-memory fake.
//
// The database file is namespaced per user (`offlinesms_<uid>.db`) so account
// switching never mixes data. Migrations run once on open, tracked via
// PRAGMA user_version.

import * as SQLite from 'expo-sqlite';
import { applyMigrations, LATEST_VERSION } from './migrations';
import { USER_DATA_TABLES, ALL_TABLE_STATEMENTS, CREATE_INDEXES } from './schema';
import { newDeviceId } from './sync/ids';

export interface LocalDatabase {
  run(sql: string, params?: any[]): Promise<void>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  first<T = any>(sql: string, params?: any[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
  /** All work inside a transaction must use its scoped database argument. */
  transaction(fn: (tx: LocalDatabase) => Promise<void>): Promise<void>;
}

class ExpoSqliteDatabase implements LocalDatabase {
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private readonly db: SQLite.SQLiteDatabase, private readonly inTransaction = false) {}

  // expo-sqlite's async transactions share a connection: overlapping BEGINs
  // throw, and an unrelated write can be rolled back with someone else's batch.
  // Queue complete transactions AND standalone operations. Only the explicit
  // transaction handle bypasses this queue, so no async-context guess is needed.
  private schedule<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('localdb: connection closed'));
    if (this.inTransaction) return work();
    const result = this.tail.then(work);
    this.tail = result.then(() => {}, () => {});
    return result;
  }
  async run(sql: string, params: any[] = []): Promise<void> {
    await this.schedule(() => this.db.runAsync(sql, params));
  }
  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.schedule(() => this.db.getAllAsync<T>(sql, params));
  }
  async first<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    return this.schedule(() => this.db.getFirstAsync<T>(sql, params));
  }
  async exec(sql: string): Promise<void> {
    await this.schedule(() => this.db.execAsync(sql));
  }
  async transaction(fn: (tx: LocalDatabase) => Promise<void>): Promise<void> {
    if (this.inTransaction) throw new Error('localdb: nested transaction');
    await this.schedule(() => this.db.withTransactionAsync(async () => {
      const tx = new ExpoSqliteDatabase(this.db, true);
      try { await fn(tx); } finally { tx.closed = true; }
    }));
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
    await this.db.closeAsync();
  }
}

let current: { uid: string; db: ExpoSqliteDatabase } | null = null;
let lifecycle: Promise<void> = Promise.resolve();
function sequenceLifecycle<T>(work: () => Promise<T>): Promise<T> {
  const result = lifecycle.then(work);
  lifecycle = result.then(() => {}, () => {});
  return result;
}

function fileName(uid: string): string {
  // Sanitise uid for a filename; Firebase uids are alnum but be defensive.
  const safe = uid.replace(/[^A-Za-z0-9_-]/g, '');
  return `offlinesms_${safe || 'anon'}.db`;
}

async function ensureDeviceId(db: LocalDatabase): Promise<void> {
  const row = await db.first<{ value: string }>(
    `SELECT value FROM sync_state WHERE key = 'device_id'`,
  );
  if (!row?.value) {
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('device_id', ?, ?)`,
      [newDeviceId(), Date.now()],
    );
  }
}

/**
 * Runs one migration statement. `ALTER TABLE t ADD COLUMN c` is skipped when
 * `c` already exists, so a database left half-upgraded by an older app build
 * (which bumped user_version only AFTER committing — an app killed in between
 * kept the new columns at the old version, and every later launch failed with
 * "duplicate column name") upgrades cleanly instead of staying unopenable.
 * Every other statement in the migrations is already idempotent (IF NOT EXISTS).
 */
const ADD_COLUMN = /^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i;
async function migrationExec(db: LocalDatabase, sql: string): Promise<void> {
  const m = ADD_COLUMN.exec(sql);
  if (m) {
    const cols = await db.all<{ name: string }>(`PRAGMA table_info(${m[1]})`);
    if (cols.some(c => c.name === m[2])) return;
  }
  await db.exec(sql);
}

/**
 * Open (or reuse) the local DB for a user, running migrations. If a different
 * user's DB is open it is closed first so we never read another account's data.
 */
export function openForUser(uid: string): Promise<LocalDatabase> {
  return sequenceLifecycle(() => openUser(uid));
}

async function openUser(uid: string): Promise<LocalDatabase> {
  if (current && current.uid === uid) return current.db;
  if (current) await closeCurrent();

  const raw = await SQLite.openDatabaseAsync(fileName(uid));
  try {
    await raw.execAsync('PRAGMA journal_mode = WAL;');
    await raw.execAsync('PRAGMA foreign_keys = ON;');
    const db = new ExpoSqliteDatabase(raw);

    const versionRow = (await raw.getFirstAsync('PRAGMA user_version')) as { user_version: number } | null;
    const currentVersion = versionRow?.user_version ?? 0;
    if (currentVersion < LATEST_VERSION) {
      // The version bump commits atomically WITH the schema changes. It used to
      // be written after the commit: an app killed in between re-ran the
      // migrations on next launch, and the non-idempotent `ALTER TABLE … ADD
      // COLUMN` failed ("duplicate column name"), leaving the DB unopenable.
      // (user_version lives in the DB header and is transactional.)
      await db.transaction(async tx => {
        await applyMigrations(currentVersion, (sql) => migrationExec(tx, sql));
        // PRAGMA user_version does not accept bound params.
        await tx.exec(`PRAGMA user_version = ${LATEST_VERSION};`);
      });
    }

    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('current_user_uid', ?, ?)`,
      [uid, Date.now()],
    );
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('local_schema_version', ?, ?)`,
      [String(LATEST_VERSION), Date.now()],
    );
    await ensureDeviceId(db);

    current = { uid, db };
    return db;
  } catch (error) {
    try { await raw.closeAsync(); } catch { /* preserve the original error */ }
    throw error;
  }
}

export function getDb(): LocalDatabase {
  if (!current) throw new Error('localdb: not opened — call openForUser(uid) first');
  return current.db;
}

export function getCurrentUid(): string | null {
  return current?.uid ?? null;
}

async function closeCurrent(): Promise<void> {
  if (!current) return;
  const { db } = current;
  current = null;
  try { await db.close(); } catch { /* ignore */ }
}

export function closeDb(): Promise<void> {
  return sequenceLifecycle(closeCurrent);
}

/**
 * Wipe all per-user data for the currently open DB (logout / uid change).
 * Keeps the schema (recreates tables empty). Does NOT touch device_id.
 */
export async function wipeUserData(): Promise<void> {
  if (!current) return;
  const { db } = current;
  await db.transaction(async tx => {
    for (const table of USER_DATA_TABLES) {
      await tx.run(`DELETE FROM ${table}`);
    }
    await tx.run(`DELETE FROM sync_state WHERE key NOT IN ('device_id')`);
  });
}

/** Test/utility helper: ensure schema exists on an arbitrary LocalDatabase. */
export async function ensureSchema(db: LocalDatabase): Promise<void> {
  for (const stmt of ALL_TABLE_STATEMENTS) await db.exec(stmt);
  for (const idx of CREATE_INDEXES) await db.exec(idx);
}
