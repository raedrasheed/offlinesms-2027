import { getCurrentUid, getDb } from './connection';
import * as messagesRepo from './repositories/messagesRepo';
import * as outboxRepo from './repositories/outboxRepo';
import { idempotencyKey } from './sync/ids';
import { parsePoll } from '../lib/pollModel';
import { emitLocalMessagesChanged } from './messageChanges';

export type ClosePollResult = { ok: true } | { ok: false; reason: 'not-initialised' | 'not-delivered' | 'not-a-poll' | 'only-creator-can-close' };

/** Persist intent; the server still authorizes closing when it is sent. */
export async function enqueuePollClose(args: { conversationId: string; messageId: string }): Promise<ClosePollResult> {
  const uid = getCurrentUid();
  if (!uid) return { ok: false, reason: 'not-initialised' };
  const msg = await messagesRepo.getByRemoteId(args.messageId);
  if (!msg || msg.conversation_id !== args.conversationId) return { ok: false, reason: 'not-delivered' };
  const poll = msg.type === 'poll' && !msg.deleted_for_everyone ? parsePoll(msg.payload_json) : null;
  if (!poll) return { ok: false, reason: 'not-a-poll' };
  if (msg.sender_uid !== uid) return { ok: false, reason: 'only-creator-can-close' };
  if (poll.closed) return { ok: true };
  const item = await outboxRepo.enqueue({
    type: 'close_poll', entityType: 'message', entityId: args.messageId,
    conversationId: args.conversationId,
    idempotencyKey: idempotencyKey(['close-poll', args.conversationId, args.messageId]),
    payload: args,
  });
  // A deliberate retry reuses the same logical action after a recorded failure.
  if (item.status === 'dead' || item.status === 'failed') {
    await getDb().run(`UPDATE outbox SET status = 'pending', attempt_count = 0,
      next_attempt_at = ?, updated_at = ?, last_error_code = NULL, last_error_message = NULL WHERE id = ?`,
    [Date.now(), Date.now(), item.id]);
  }
  emitLocalMessagesChanged(args.conversationId);
  return { ok: true };
}
