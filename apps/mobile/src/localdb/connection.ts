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
  transaction(fn: () => Promise<void>): Promise<void>;
}

class ExpoSqliteDatabase implements LocalDatabase {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}
  async run(sql: string, params: any[] = []): Promise<void> {
    await this.db.runAsync(sql, params);
  }
  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return (await this.db.getAllAsync(sql, params)) as T[];
  }
  async first<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    return ((await this.db.getFirstAsync(sql, params)) as T) ?? null;
  }
  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }
  async transaction(fn: () => Promise<void>): Promise<void> {
    await this.db.withTransactionAsync(fn);
  }
}

let current: { uid: string; raw: SQLite.SQLiteDatabase; db: LocalDatabase } | null = null;

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
 * Open (or reuse) the local DB for a user, running migrations. If a different
 * user's DB is open it is closed first so we never read another account's data.
 */
export async function openForUser(uid: string): Promise<LocalDatabase> {
  if (current && current.uid === uid) return current.db;
  if (current) await closeDb();

  const raw = await SQLite.openDatabaseAsync(fileName(uid));
  await raw.execAsync('PRAGMA journal_mode = WAL;');
  await raw.execAsync('PRAGMA foreign_keys = ON;');
  const db = new ExpoSqliteDatabase(raw);

  const versionRow = (await raw.getFirstAsync('PRAGMA user_version')) as { user_version: number } | null;
  const currentVersion = versionRow?.user_version ?? 0;
  if (currentVersion < LATEST_VERSION) {
    await db.transaction(async () => {
      await applyMigrations(currentVersion, (sql) => db.exec(sql));
    });
    // PRAGMA user_version does not accept bound params.
    await raw.execAsync(`PRAGMA user_version = ${LATEST_VERSION};`);
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

  current = { uid, raw, db };
  return db;
}

export function getDb(): LocalDatabase {
  if (!current) throw new Error('localdb: not opened — call openForUser(uid) first');
  return current.db;
}

export function getCurrentUid(): string | null {
  return current?.uid ?? null;
}

export async function closeDb(): Promise<void> {
  if (!current) return;
  try { await current.raw.closeAsync(); } catch { /* ignore */ }
  current = null;
}

/**
 * Wipe all per-user data for the currently open DB (logout / uid change).
 * Keeps the schema (recreates tables empty). Does NOT touch device_id.
 */
export async function wipeUserData(): Promise<void> {
  if (!current) return;
  const { db } = current;
  await db.transaction(async () => {
    for (const table of USER_DATA_TABLES) {
      await db.run(`DELETE FROM ${table}`);
    }
    await db.run(`DELETE FROM sync_state WHERE key NOT IN ('device_id')`);
  });
}

/** Test/utility helper: ensure schema exists on an arbitrary LocalDatabase. */
export async function ensureSchema(db: LocalDatabase): Promise<void> {
  for (const stmt of ALL_TABLE_STATEMENTS) await db.exec(stmt);
  for (const idx of CREATE_INDEXES) await db.exec(idx);
}
