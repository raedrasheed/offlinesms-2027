// Test/benchmark support: a real SQLite engine (sql.js — SQLite compiled to
// WebAssembly) behind the same `LocalDatabase` interface the app's repositories
// use on device (expo-sqlite). Lets repository, sync and query-plan tests run
// against real SQL in Node/CI. It counts executed statements: on a device every
// expo-sqlite call is a separate async native round-trip, which this in-process
// engine does not model, so statement counts are reported next to timings.

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { LocalDatabase } from '../../src/localdb/connection';
import { applyMigrations, LATEST_VERSION } from '../../src/localdb/migrations';

let SQL: SqlJsStatic | null = null;

export interface CountingDb extends LocalDatabase {
  raw: Database;
  statements: number;
  resetCount(): void;
  /** EXPLAIN QUERY PLAN detail lines for a statement. */
  plan(sql: string, params?: any[]): Promise<string[]>;
  close(): void;
}

function bindable(params: any[]): any[] {
  return params.map(p => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export async function createSqlJsDb(opts: { migrate?: boolean } = {}): Promise<CountingDb> {
  SQL ??= await initSqlJs();
  const raw = new SQL.Database();
  let depth = 0;
  const self: CountingDb = {
    raw,
    statements: 0,
    resetCount() { self.statements = 0; },
    async run(sql, params = []) {
      self.statements++;
      raw.run(sql, bindable(params));
    },
    async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      self.statements++;
      const st = raw.prepare(sql);
      try {
        st.bind(bindable(params));
        const out: T[] = [];
        while (st.step()) out.push(st.getAsObject() as T);
        return out;
      } finally { st.free(); }
    },
    async first<T = any>(sql: string, params: any[] = []): Promise<T | null> {
      const rows = await self.all<T>(sql, params);
      self.statements--; // counted once by all()
      self.statements++;
      return rows[0] ?? null;
    },
    async exec(sql) { self.statements++; raw.exec(sql); },
    async transaction(fn) {
      // expo-sqlite's withTransactionAsync is not re-entrant either; nested calls
      // simply join the outer transaction here.
      if (depth > 0) { depth++; try { await fn(); } finally { depth--; } return; }
      depth++;
      self.statements++;
      raw.exec('BEGIN');
      try { await fn(); raw.exec('COMMIT'); }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
      finally { depth--; }
    },
    async plan(sql, params = []) {
      const st = raw.prepare(`EXPLAIN QUERY PLAN ${sql}`);
      try {
        st.bind(bindable(params));
        const out: string[] = [];
        while (st.step()) out.push(String((st.getAsObject() as any).detail));
        return out;
      } finally { st.free(); }
    },
    close() { raw.close(); },
  };
  if (opts.migrate !== false) {
    await applyMigrations(0, sql => self.exec(sql));
    raw.exec(`PRAGMA user_version = ${LATEST_VERSION};`);
    raw.run(`INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('device_id', 'dev_test', 0)`);
    self.resetCount();
  }
  return self;
}
