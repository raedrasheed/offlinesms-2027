// Phase 22 — sync_state key/value store (cursors, schema version, ids).
import { getDb } from '../connection';
import type { SyncStateKey } from '../types';

export async function getState(key: SyncStateKey): Promise<string | null> {
  const row = await getDb().first<{ value: string | null }>(
    `SELECT value FROM sync_state WHERE key = ?`, [key]);
  return row?.value ?? null;
}

export async function setState(key: SyncStateKey, value: string): Promise<void> {
  await getDb().run(
    `INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)`,
    [key, value, Date.now()],
  );
}

export async function getCursor(key: SyncStateKey): Promise<number> {
  const v = await getState(key);
  return v ? Number(v) : 0;
}

export async function setCursor(key: SyncStateKey, ms: number): Promise<void> {
  await setState(key, String(ms));
}

export async function getDeviceId(): Promise<string> {
  return (await getState('device_id')) ?? 'dev_unknown';
}
