// Existing-user upgrade, on real SQLite (sql.js): for every schema version an
// installed app can have (v1–v5; v5 is production), build the database with
// the migrations THAT version shipped (fixtures/localdb-history), fill it with
// representative data, then "launch" today's app — the real `openForUser`
// from src/localdb/connection.ts, with expo-sqlite backed by sql.js — and
// check: version, schema equal to a fresh install, every row preserved, the
// app's own reads/writes working on the migrated data, the new indexes used,
// pending outbox work still deliverable, and that a migration interrupted at
// ANY statement rolls back completely and succeeds on the next launch.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

let SQL: SqlJsStatic;
const files = new Map<string, Uint8Array>();   // "disk": file name → bytes
let failOn: ((sql: string) => boolean) | null = null;

/** Minimal expo-sqlite (async API) on sql.js, persisting to `files` on close. */
function openFake(name: string) {
  const db: Database = files.has(name) ? new SQL.Database(files.get(name)) : new SQL.Database();
  const bind = (p: any[] = []) => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const rows = (sql: string, params: any[] = []) => {
    const st = db.prepare(sql); st.bind(bind(params));
    const out: any[] = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out;
  };
  const exec = (sql: string) => {
    if (failOn?.(sql)) throw new Error(`injected failure: ${sql.slice(0, 50)}`);
    db.exec(sql);
  };
  return {
    async execAsync(sql: string) { exec(sql); },
    async runAsync(sql: string, params: any[] = []) { if (failOn?.(sql)) throw new Error('injected'); db.run(sql, bind(params)); },
    async getAllAsync(sql: string, params: any[] = []) { return rows(sql, params); },
    async getFirstAsync(sql: string, params: any[] = []) { return rows(sql, params)[0] ?? null; },
    async withTransactionAsync(fn: () => Promise<void>) {
      db.exec('BEGIN');
      try { await fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async closeAsync() { files.set(name, db.export()); db.close(); },
    _db: db,
  };
}
let lastOpened: ReturnType<typeof openFake> | null = null;
vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async (name: string) => (lastOpened = openFake(name)),
}));

import { openForUser, closeDb, getDb } from '../../src/localdb/connection';
import { LATEST_VERSION } from '../../src/localdb/migrations';
import * as messagesRepo from '../../src/localdb/repositories/messagesRepo';
import * as conversationsRepo from '../../src/localdb/repositories/conversationsRepo';
import * as outboxRepo from '../../src/localdb/repositories/outboxRepo';
import { mapAndOrderMessages } from '../../src/hooks/messageModel';

const HISTORY = [1, 2, 3, 4, 5] as const;
const UID = 'u_existing';
const FILE = `offlinesms_${UID}.db`;

/** Build the on-disk DB exactly as app version `v` left it, with data. */
async function seedHistoricalDb(v: number) {
  const { applyMigrations } = await import(`../fixtures/localdb-history/v${v}/migrations.ts`);
  const db = new SQL.Database();
  await applyMigrations(0, async (sql: string) => { db.exec(sql); });
  db.exec(`PRAGMA user_version = ${v}`);
  const cols = (t: string) => new Set((db.exec(`PRAGMA table_info(${t})`)[0]?.values ?? []).map(r => r[1] as string));
  const insert = (t: string, row: Record<string, unknown>) => {
    const have = cols(t);
    const keys = Object.keys(row).filter(k => have.has(k));
    db.run(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => row[k] as any));
  };
  insert('conversations', {
    id: 'c1', remote_id: 'c1', type: 'direct', title: 'Lina', participant_key: 'u_existing_u_lina',
    last_message_preview: 'مرحبا', last_message_at: 1_700_000_100_000, unread_count: 2, archived: 0,
    local_updated_at: 1, sync_status: 'synced',
  });
  insert('conversations', { id: 'c2', remote_id: 'c2', type: 'group', title: 'Team', last_message_at: 1_700_000_050_000, archived: 1, local_updated_at: 1, sync_status: 'synced' });
  for (let k = 0; k < 50; k++) {
    insert('messages', {
      id: `m${k}`, remote_id: `m${k}`, conversation_id: 'c1', sender_uid: k % 2 ? UID : 'u_lina',
      type: k === 7 && v >= 3 ? 'image' : 'text', text: k === 3 ? 'مرحبا 👋' : `message ${k}`, preview: `message ${k}`,
      created_at: 1_700_000_000_000 + k * 1000, remote_created_at: 1_700_000_000_000 + k * 1000, updated_at: 1,
      status: 'sent', sync_status: 'synced', deleted_for_me: k === 9 ? 1 : 0,
      reactions_json: k === 5 ? '{"👍":["u_lina"]}' : null, read_count: k % 3,
      media_mime: k === 7 ? 'image/jpeg' : null, media_download_url: k === 7 ? 'https://example.test/i.jpg' : null,
      mentions_json: null, reply_to_sender_uid: null,
    });
  }
  // An unsent message + its outbox item, written by the old version while offline.
  insert('messages', {
    id: 'local_msg_dev_1', local_id: 'local_msg_dev_1', conversation_id: 'c1', sender_uid: UID, type: 'text',
    text: 'sent while offline', preview: 'sent while offline', created_at: 1_700_000_200_000, updated_at: 1,
    status: 'pending', sync_status: 'pending', client_sequence: 1,
  });
  insert('outbox', {
    id: 'ob1', type: 'send_message', entity_type: 'message', entity_id: 'local_msg_dev_1', conversation_id: 'c1',
    payload_json: JSON.stringify({ conversationId: 'c1', text: 'sent while offline', localId: 'local_msg_dev_1' }),
    idempotency_key: 'send:dev:local_msg_dev_1', status: 'pending', attempt_count: 0, max_attempts: 8,
    next_attempt_at: null, created_at: 1, updated_at: 1,
  });
  insert('sync_state', { key: 'device_id', value: 'dev_existing', updated_at: 1 });
  insert('sync_state', { key: 'messages_cursor:c1', value: '1700000049000', updated_at: 1 });
  files.set(FILE, db.export());
  db.close();
}

function schemaOf(db: Database) {
  const out: Record<string, string[]> = {};
  const tables = db.exec(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)[0]?.values.map(r => r[0] as string) ?? [];
  for (const t of tables) out[t] = (db.exec(`PRAGMA table_info(${t})`)[0]?.values ?? []).map(r => `${r[1]}:${r[2]}`).sort();
  out.__indexes = (db.exec(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name`)[0]?.values ?? []).map(r => r[0] as string);
  return out;
}

let fresh: Record<string, string[]>;

beforeAll(async () => {
  SQL = await initSqlJs();
  files.clear();
  await openForUser('u_fresh');           // a brand-new install of today's app
  fresh = schemaOf(lastOpened!._db);
  await closeDb();
});
beforeEach(async () => { await closeDb(); files.delete(FILE); failOn = null; });

describe.each(HISTORY)('upgrade from shipped schema v%i', (v) => {
  it('lands on the latest schema, identical to a fresh install', async () => {
    await seedHistoricalDb(v);
    await openForUser(UID);
    const raw = lastOpened!._db;
    expect(raw.exec('PRAGMA user_version')[0].values[0][0]).toBe(LATEST_VERSION);
    expect(schemaOf(raw)).toEqual(fresh);
  });

  it('keeps every row and the app reads it correctly', async () => {
    await seedHistoricalDb(v);
    await openForUser(UID);
    const msgs = await messagesRepo.listMessages('c1', 500);
    expect(msgs).toHaveLength(50); // 49 visible remote + the pending one (m9 deleted for me)
    const mapped = mapAndOrderMessages(msgs);
    expect(mapped.find(m => m.id === 'm3')?.text).toBe('مرحبا 👋');
    expect(mapped.at(-1)?.id).toBe('local_msg_dev_1');            // order preserved
    if (v >= 2) expect(mapped.find(m => m.id === 'm5')?.reactions).toEqual({ '👍': ['u_lina'] });
    if (v >= 3) expect(mapped.find(m => m.id === 'm7')?.media?.downloadURL).toBe('https://example.test/i.jpg');
    // New v7 column: old rows have no payload and still render as their type.
    expect(mapped.every(m => m.poll == null && m.sticker == null)).toBe(true);
    const chats = await conversationsRepo.listConversations({ includeArchived: false });
    expect(chats.map(c => c.id)).toEqual(['c1']);
    expect(chats[0].unread_count).toBe(2);
    // Cursors and device id survive (no full re-download, same device identity).
    expect(await getDb().first(`SELECT value FROM sync_state WHERE key = 'messages_cursor:c1'`)).toEqual({ value: '1700000049000' });
    expect(await getDb().first(`SELECT value FROM sync_state WHERE key = 'device_id'`)).toEqual({ value: 'dev_existing' });
  });

  it('delivers the message the old version left in the outbox, and new kinds work', async () => {
    await seedHistoricalDb(v);
    await openForUser(UID);
    const due = await outboxRepo.claimDue(Date.now(), 10);
    expect(due.map(d => d.id)).toEqual(['ob1']);
    // The send reconciles onto the same row (no duplicate).
    await messagesRepo.reconcileToRemote('local_msg_dev_1', { remoteId: 'srv_1', remoteCreatedAt: 1_700_000_200_500 });
    expect((await messagesRepo.listMessages('c1', 500)).filter(r => r.text === 'sent while offline')).toHaveLength(1);
    // A poll arriving after the upgrade is stored with its payload.
    await messagesRepo.applyRemoteMessages([{
      remoteId: 'p1', conversationId: 'c1', senderUid: 'u_lina', type: 'poll', text: '📊 q', remoteCreatedAt: 1_700_000_300_000,
      payload: JSON.stringify({ question: 'q', options: [{ id: 'o1', text: 'a' }, { id: 'o2', text: 'b' }], multiple: false, closed: false, votes: {} }),
    }]);
    expect(mapAndOrderMessages(await messagesRepo.listMessages('c1', 500)).at(-1)?.poll?.question).toBe('q');
  });

  it('uses the new read-path indexes on migrated data', async () => {
    await seedHistoricalDb(v);
    await openForUser(UID);
    const plan = lastOpened!._db.exec(`EXPLAIN QUERY PLAN SELECT * FROM messages WHERE conversation_id = 'c1' AND deleted_for_me = 0 ORDER BY COALESCE(remote_created_at, created_at) DESC LIMIT 100`);
    const detail = plan[0].values.map(r => String(r[3])).join(' | ');
    expect(detail).toContain('idx_messages_conv_visible_order');
    expect(detail).not.toContain('TEMP B-TREE');
  });

  it('a migration interrupted at any statement rolls back completely; the next launch succeeds', async () => {
    await seedHistoricalDb(v);
    // Find every statement this upgrade runs, then fail at each one in turn.
    const { applyMigrations } = await import('../../src/localdb/migrations');
    const stmts: string[] = [];
    await applyMigrations(v, async (s) => { stmts.push(s); });
    const targets = [...stmts, 'PRAGMA user_version'];
    for (const target of targets) {
      failOn = (sql) => sql.trim().startsWith(target.trim().slice(0, 60));
      await expect(openForUser(UID)).rejects.toThrow(/injected/);
      failOn = null;
      // App killed: nothing of the half-done upgrade was persisted.
      await lastOpened!.closeAsync();
      const check = new SQL.Database(files.get(FILE));
      expect(check.exec('PRAGMA user_version')[0].values[0][0]).toBe(v);
      expect(check.exec(`SELECT COUNT(*) FROM messages`)[0].values[0][0]).toBe(51);
      check.close();
    }
    // Next launch: the upgrade runs cleanly from the original version.
    await openForUser(UID);
    expect(lastOpened!._db.exec('PRAGMA user_version')[0].values[0][0]).toBe(LATEST_VERSION);
    expect(schemaOf(lastOpened!._db)).toEqual(fresh);
  });

  it('opening again is a no-op', async () => {
    await seedHistoricalDb(v);
    await openForUser(UID);
    await closeDb();
    const before = files.get(FILE)!;
    failOn = (sql) => /^\s*(ALTER|CREATE)/i.test(sql); // no schema statement may run again
    await openForUser(UID);
    expect(schemaOf(lastOpened!._db)).toEqual(fresh);
    expect(before.length).toBeGreaterThan(0);
  });
});

describe('devices left half-upgraded by the old migration runner', () => {
  it.each([1, 2, 3, 4])('a v%i database whose next columns were committed without the version bump opens and upgrades', async (v) => {
    await seedHistoricalDb(v);
    // Reproduce the stuck state: the next version's statements committed, but
    // user_version still says v (the old runner wrote it after the commit).
    const { applyMigrations } = await import(`../fixtures/localdb-history/v${v + 1}/migrations.ts`);
    const db = new SQL.Database(files.get(FILE));
    await applyMigrations(v, async (sql: string) => { db.exec(sql); });
    db.exec(`PRAGMA user_version = ${v}`);
    files.set(FILE, db.export()); db.close();

    await openForUser(UID);
    expect(lastOpened!._db.exec('PRAGMA user_version')[0].values[0][0]).toBe(LATEST_VERSION);
    expect(schemaOf(lastOpened!._db)).toEqual(fresh);
    expect(await messagesRepo.listMessages('c1', 500)).toHaveLength(50);
  });
});
