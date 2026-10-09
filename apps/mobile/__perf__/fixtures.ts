// Deterministic dataset + timing helpers for the local-data perf harness.
import type { CountingDb } from '../__tests__/support/sqljsDb';

export const DATASET = {
  conversations: 200,
  messagesPerConversation: 200,
  heavyConversationId: 'c_heavy',
  heavyMessages: 20_000,
};

export const T0 = 1_700_000_000_000;

/** Seed conversations + messages directly (fast path, not under measurement). */
export async function seed(db: CountingDb): Promise<void> {
  const r = db.raw;
  r.exec('BEGIN');
  const conv = r.prepare(`INSERT INTO conversations (id, remote_id, type, title, last_message_preview, last_message_at,
    unread_count, muted, pinned, favorite, archived, local_updated_at, remote_updated_at, sync_status)
    VALUES (?,?,?,?,?,?,?,0,0,0,0,?,?, 'synced')`);
  const msg = r.prepare(`INSERT INTO messages (id, local_id, remote_id, conversation_id, sender_uid, sender_display_name, type, text, preview,
    created_at, remote_created_at, updated_at, deleted_for_everyone, deleted_for_me, status, sync_status, client_sequence, server_version,
    reactions_json, delivered_count, read_count)
    VALUES (?, NULL, ?, ?, ?, ?, 'text', ?, ?, ?, ?, ?, 0, 0, 'sent', 'synced', 0, 0, ?, 1, 1)`);
  const ids = [DATASET.heavyConversationId, ...Array.from({ length: DATASET.conversations - 1 }, (_, i) => `c_${i}`)];
  ids.forEach((id, ci) => {
    const n = id === DATASET.heavyConversationId ? DATASET.heavyMessages : DATASET.messagesPerConversation;
    conv.run([id, id, ci % 5 === 0 ? 'group' : 'direct', `Chat ${ci}`, 'hello', T0 + ci * 1000 + n * 60_000, ci % 7, T0, T0]);
    for (let k = 0; k < n; k++) {
      const t = T0 + k * 60_000;
      const rid = `${id}_m${k}`;
      msg.run([rid, rid, id, k % 2 ? 'u_me' : 'u_peer', 'Peer', `message ${k} in ${id}`, `message ${k}`, t, t, t,
        k % 10 === 0 ? JSON.stringify({ '👍': ['u_peer'] }) : null]);
    }
  });
  conv.free(); msg.free();
  r.exec('COMMIT');
  db.resetCount();
}

export interface Measure { name: string; medianMs: number; p95Ms: number; statements: number; runs: number; note?: string }

export async function measure(db: CountingDb, name: string, runs: number, fn: (i: number) => Promise<unknown>, note?: string): Promise<Measure> {
  const times: number[] = [];
  let statements = 0;
  for (let i = 0; i < runs; i++) {
    db.resetCount();
    const t = performance.now();
    await fn(i);
    times.push(performance.now() - t);
    statements = db.statements;
  }
  times.sort((a, b) => a - b);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
  return { name, medianMs: +q(0.5).toFixed(2), p95Ms: +q(0.95).toFixed(2), statements, runs, note };
}
