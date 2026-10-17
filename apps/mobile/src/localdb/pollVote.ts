import { getCurrentUid, getDb, type LocalDatabase } from './connection';
import { enqueue } from './repositories/outboxRepo';
import { emitLocalMessagesChanged } from './messageChanges';
import { applyLocalVote, parsePoll } from '../lib/pollModel';
import { idempotencyKey } from './sync/ids';
import type { MessageRow, OutboxRow } from './types';

export interface OwnPollVote {
  known: boolean; selection: string[]; seq: number; pending: boolean; failed: boolean;
}
export const UNKNOWN_POLL_VOTE: OwnPollVote = { known: false, selection: [], seq: 0, pending: false, failed: false };
export const ballotKey = (cid: string, mid: string) => `poll-vote:${JSON.stringify([cid, mid])}`;

/** Private, per-account cache. Never serialize this into a shared message. */
export async function readOwnPollVote(db: LocalDatabase, cid: string, mid: string): Promise<OwnPollVote> {
  const row = await db.first<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [ballotKey(cid, mid)]);
  let confirmed = UNKNOWN_POLL_VOTE;
  try {
    if (row) {
      const value = JSON.parse(row.value);
      if (Array.isArray(value.selection) && Number.isFinite(value.seq)) confirmed = { ...UNKNOWN_POLL_VOTE, ...value, known: true };
    }
  } catch { /* a malformed cache is unknown, never an empty confirmed vote */ }
  const latest = await db.first<OutboxRow>(`SELECT * FROM outbox WHERE entity_type = 'message'
    AND entity_id = ? AND conversation_id = ? AND type = 'vote_poll'
    ORDER BY CAST(json_extract(payload_json, '$.seq') AS INTEGER) DESC LIMIT 1`, [mid, cid]);
  if (!latest) return confirmed;
  const pending = JSON.parse(latest.payload_json);
  if (!(pending.seq > confirmed.seq) || latest.status === 'completed') return confirmed;
  if (latest.status === 'dead') return { ...confirmed, failed: true, seq: pending.seq };
  return { known: true, selection: pending.optionIds, seq: pending.seq, pending: true, failed: false };
}

export async function saveOwnPollVote(db: LocalDatabase, cid: string, mid: string, selection: unknown, seq: unknown): Promise<void> {
  if (!Array.isArray(selection) || selection.some(s => typeof s !== 'string') || typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0) return;
  await db.run(`INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    WHERE CAST(json_extract(sync_state.value, '$.seq') AS INTEGER) <= ?`,
  [ballotKey(cid, mid), JSON.stringify({ selection, seq }), Date.now(), seq]);
  emitLocalMessagesChanged(cid);
}

let lastSeq = 0;
export async function enqueuePollVote(args: { conversationId: string; messageId: string; uid: string; optionIds: string[] }) {
  if (!getCurrentUid()) return { ok: false, reason: 'not-initialised' as const };
  if (getCurrentUid() !== args.uid) return { ok: false, reason: 'account-changed' as const };
  const db = getDb();
  let result: { ok: boolean; reason?: 'not-delivered' | 'not-a-poll' | 'vote-not-ready' } = { ok: true };
  await db.transaction(async tx => {
    const msg = await tx.first<MessageRow>('SELECT * FROM messages WHERE remote_id = ? AND conversation_id = ?', [args.messageId, args.conversationId]);
    if (!msg) { result = { ok: false, reason: 'not-delivered' }; return; }
    const poll = msg.type === 'poll' && !msg.deleted_for_everyone ? parsePoll(msg.payload_json) : null;
    if (!poll || poll.closed) { result = { ok: false, reason: 'not-a-poll' }; return; }
    const own = await readOwnPollVote(tx, args.conversationId, args.messageId);
    if (poll.anonymous && !own.known) { result = { ok: false, reason: 'vote-not-ready' }; return; }
    const selection = poll.options.map(o => o.id).filter(id => args.optionIds.includes(id));
    if ((!poll.multiple && selection.length > 1) || args.optionIds.some(id => !selection.includes(id))) {
      result = { ok: false, reason: 'not-a-poll' }; return;
    }
    const seq = lastSeq = Math.max(Date.now(), lastSeq + 1, own.seq + 1);
    const device = await tx.first<{ value: string }>("SELECT value FROM sync_state WHERE key = 'device_id'");
    await enqueue({ type: 'vote_poll', entityType: 'message', entityId: args.messageId, conversationId: args.conversationId,
      idempotencyKey: idempotencyKey(['vote', device?.value ?? 'unknown', args.messageId, String(seq)]),
      payload: { conversationId: args.conversationId, messageId: args.messageId, optionIds: selection, seq, voterUid: args.uid },
    }, tx);
    if (!poll.anonymous) await tx.run('UPDATE messages SET payload_json = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(applyLocalVote(poll, args.uid, selection)), Date.now(), msg.id]);
  });
  if (result.ok) emitLocalMessagesChanged(args.conversationId);
  return result;
}
