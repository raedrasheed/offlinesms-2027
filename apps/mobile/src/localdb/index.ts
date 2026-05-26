// Phase 22 — local-first data layer public API.
//
// Lifecycle (call from auth state handling once the cutover is enabled):
//   await initLocalDb(uid)   // open DB + start sync scheduler
//   await teardownLocalDb()  // stop sync + close (keeps data)
//   await wipeAndClose()     // logout: stop sync + wipe user data + close
//
// Read paths: import repositories directly (conversationsRepo, messagesRepo…).
// Write path for an optimistic outgoing message: queueSendMessage(...).

import { openForUser, closeDb, wipeUserData, getCurrentUid } from './connection';
import { startScheduler, stopScheduler, kick } from './sync/syncScheduler';
import * as messagesRepo from './repositories/messagesRepo';
import * as outboxRepo from './repositories/outboxRepo';
import { getDeviceId } from './repositories/syncStateRepo';
import { idempotencyKey } from './sync/ids';
import type { MessageRow } from './types';

export * from './types';
export { getDb, getCurrentUid } from './connection';
export * as conversationsRepo from './repositories/conversationsRepo';
export * as messagesRepo from './repositories/messagesRepo';
export * as outboxRepo from './repositories/outboxRepo';
export * as receiptsRepo from './repositories/receiptsRepo';
export * as membersRepo from './repositories/membersRepo';
export * as syncStateRepo from './repositories/syncStateRepo';
export { syncNow, pushOutbox, pullRemoteChanges, retryFailedOutboxItem, isSyncing } from './sync/syncEngine';
export { setActiveConversation, kick as kickSync } from './sync/syncScheduler';

let started = false;

export async function initLocalDb(uid: string): Promise<void> {
  await openForUser(uid);
  if (!started) { startScheduler(); started = true; }
}

export async function teardownLocalDb(): Promise<void> {
  if (started) { stopScheduler(); started = false; }
  await closeDb();
}

export async function wipeAndClose(): Promise<void> {
  if (started) { stopScheduler(); started = false; }
  await wipeUserData();
  await closeDb();
}

export interface QueueSendInput {
  conversationId: string;
  senderUid: string;
  senderDisplayName?: string | null;
  text: string;
  replyTo?: { messageId: string; senderUid?: string; senderDisplayName?: string; preview?: string } | null;
}

/**
 * Write an optimistic outgoing message to the local DB (status `pending`) and
 * enqueue a matching idempotent outbox item. Returns the local message row so
 * the UI can render it immediately. The sync engine delivers it when online.
 */
export async function queueSendMessage(input: QueueSendInput): Promise<MessageRow> {
  if (!getCurrentUid()) throw new Error('localdb: not initialised');
  const deviceId = await getDeviceId();
  const clientSequence = await messagesRepo.nextClientSequence(input.conversationId);

  const row = await messagesRepo.insertLocalMessage({
    conversationId: input.conversationId,
    senderUid: input.senderUid,
    senderDisplayName: input.senderDisplayName ?? null,
    text: input.text,
    replyToMessageId: input.replyTo?.messageId ?? null,
    replyToPreview: input.replyTo?.preview ?? null,
    deviceId,
    clientSequence,
  });

  await outboxRepo.enqueue({
    type: 'send_message',
    entityType: 'message',
    entityId: row.local_id,
    conversationId: input.conversationId,
    idempotencyKey: idempotencyKey(['send', deviceId, row.local_id]),
    payload: {
      conversationId: input.conversationId,
      text: input.text,
      replyTo: input.replyTo ?? null,
      localId: row.local_id,
      clientCreatedAt: row.created_at,
    },
  });

  kick('outbox');
  return row;
}
