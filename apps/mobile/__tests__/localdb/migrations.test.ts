import { describe, it, expect } from 'vitest';
import { applyMigrations, LATEST_VERSION, MIGRATIONS } from '../../src/localdb/migrations';
import {
  ALL_TABLE_STATEMENTS, CREATE_INDEXES,
  MESSAGES_V2_COLUMNS, MESSAGES_V3_COLUMNS,
} from '../../src/localdb/schema';

async function record() {
  const sqls: string[] = [];
  const version = await applyMigrations(0, async (sql) => { sqls.push(sql); });
  return { sqls, version };
}

describe('applyMigrations', () => {
  it('runs from 0 to the latest version', async () => {
    const { version } = await record();
    expect(version).toBe(LATEST_VERSION);
  });

  it('creates every table and index, then applies v2 + v3 columns', async () => {
    const { sqls } = await record();
    expect(sqls.length).toBe(
      ALL_TABLE_STATEMENTS.length + CREATE_INDEXES.length
      + MESSAGES_V2_COLUMNS.length + MESSAGES_V3_COLUMNS.length,
    );
    for (const table of ['conversations', 'messages', 'outbox', 'sync_state', 'tombstones', 'message_receipts', 'message_reactions', 'group_members']) {
      expect(sqls.some(s => s.includes(`CREATE TABLE IF NOT EXISTS ${table}`))).toBe(true);
    }
    expect(sqls.some(s => s.includes('idx_messages_conversation_created'))).toBe(true);
    expect(sqls.some(s => s.includes('idx_outbox_status_next_attempt'))).toBe(true);
    // v2 reactions/receipts columns.
    expect(sqls.some(s => s.includes('ADD COLUMN reactions_json'))).toBe(true);
    expect(sqls.some(s => s.includes('ADD COLUMN delivered_count'))).toBe(true);
    // v3 media columns (Phase 23).
    expect(sqls.some(s => s.includes('ADD COLUMN media_upload_status'))).toBe(true);
  });

  it('upgrades from v1 to latest by applying v2 then v3', async () => {
    const sqls: string[] = [];
    const version = await applyMigrations(1, async (sql) => { sqls.push(sql); });
    expect(version).toBe(LATEST_VERSION);
    expect(sqls).toEqual([...MESSAGES_V2_COLUMNS, ...MESSAGES_V3_COLUMNS]);
  });

  it('upgrades from v2 to latest by applying only v3', async () => {
    const sqls: string[] = [];
    const version = await applyMigrations(2, async (sql) => { sqls.push(sql); });
    expect(version).toBe(LATEST_VERSION);
    expect(sqls).toEqual(MESSAGES_V3_COLUMNS);
  });

  it('is a no-op when already at the latest version', async () => {
    const sqls: string[] = [];
    const version = await applyMigrations(LATEST_VERSION, async (sql) => { sqls.push(sql); });
    expect(version).toBe(LATEST_VERSION);
    expect(sqls.length).toBe(0);
  });

  it('migration versions are unique and ascending', () => {
    const versions = MIGRATIONS.map(m => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });
});
