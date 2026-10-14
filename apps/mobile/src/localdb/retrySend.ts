import { getCurrentUid, getDb } from './connection';
import * as messagesRepo from './repositories/messagesRepo';
import type { OutboxRow } from './types';
import { emitLocalMessagesChanged } from './messageChanges';

/** Explicit retry of the same failed text/sticker/poll, keeping its idempotency key. */
export async function retryQueuedSend(localId: string): Promise<boolean> {
  const uid = getCurrentUid();
  if (!uid) return false;
  const row = await messagesRepo.getByLocalId(localId);
  if (!row || row.sender_uid !== uid || row.remote_id || row.status !== 'failed') return false;
  const db = getDb();
  const job = await db.first<OutboxRow>(`SELECT * FROM outbox
    WHERE entity_type = 'message' AND entity_id = ? AND type = 'send_message'
      AND status IN ('pending', 'failed', 'dead') LIMIT 1`, [localId]);
  if (!job) return false;
  await db.transaction(async tx => {
    const now = Date.now();
    await tx.run(`UPDATE outbox SET status = 'pending', attempt_count = 0, next_attempt_at = ?,
      last_error_code = NULL, last_error_message = NULL, updated_at = ? WHERE id = ?`, [now, now, job.id]);
    await tx.run(`UPDATE messages SET status = 'pending', sync_status = 'pending',
      error_code = NULL, error_message = NULL, updated_at = ? WHERE local_id = ?`, [now, localId]);
  });
  emitLocalMessagesChanged(row.conversation_id);
  return true;
}
