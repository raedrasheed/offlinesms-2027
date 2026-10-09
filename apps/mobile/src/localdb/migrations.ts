// Phase 22 — versioned migrations.
//
// Pure & driver-agnostic: each migration receives an `exec(sql)` runner so the
// same migration list can be applied by expo-sqlite at runtime and exercised by
// unit tests with an in-memory fake. `applyMigrations` runs every migration
// whose version is greater than the database's current version, in order, and
// returns the resulting version.

import { ALL_TABLE_STATEMENTS, CREATE_INDEXES, MESSAGES_V2_COLUMNS, MESSAGES_V3_COLUMNS, EXTERNAL_MEMBERS_V4, MESSAGES_V5_COLUMNS, READ_PATH_INDEXES_V6, MESSAGES_V7_COLUMNS, SCHEMA_VERSION } from './schema';

export type SqlExec = (sql: string) => Promise<void>;

export interface Migration {
  version: number;
  up: (exec: SqlExec) => Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: async (exec) => {
      for (const stmt of ALL_TABLE_STATEMENTS) await exec(stmt);
      for (const idx of CREATE_INDEXES) await exec(idx);
    },
  },
  {
    // Phase 22C — denormalized reactions + receipt counts on messages.
    version: 2,
    up: async (exec) => {
      for (const stmt of MESSAGES_V2_COLUMNS) await exec(stmt);
    },
  },
  {
    // Phase 23 — media (image/voice) metadata + local upload state.
    version: 3,
    up: async (exec) => {
      for (const stmt of MESSAGES_V3_COLUMNS) await exec(stmt);
    },
  },
  {
    // Phase 25 — external phone-only group members (local mirror).
    version: 4,
    up: async (exec) => {
      for (const stmt of EXTERNAL_MEMBERS_V4) await exec(stmt);
    },
  },
  {
    // Reply sender snapshot + @mention metadata on messages.
    version: 5,
    up: async (exec) => {
      for (const stmt of MESSAGES_V5_COLUMNS) await exec(stmt);
    },
  },
  {
    // Performance — indexes matching the conversation / chat-list ORDER BYs.
    version: 6,
    up: async (exec) => {
      for (const stmt of READ_PATH_INDEXES_V6) await exec(stmt);
    },
  },
  {
    // Stickers + polls — typed message payload (JSON).
    version: 7,
    up: async (exec) => {
      for (const stmt of MESSAGES_V7_COLUMNS) await exec(stmt);
    },
  },
];

export const LATEST_VERSION = SCHEMA_VERSION;

export async function applyMigrations(currentVersion: number, exec: SqlExec): Promise<number> {
  let version = currentVersion;
  const pending = MIGRATIONS.filter(m => m.version > currentVersion).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    await m.up(exec);
    version = m.version;
  }
  return version;
}
