// Phase 22 — sync engine. Orchestrates outbox push + remote pull + reconcile.
// Single-flight (no overlapping runs). Read by the scheduler; never blocks UI.

import * as outboxRepo from '../repositories/outboxRepo';
import * as messagesRepo from '../repositories/messagesRepo';
import { getCursor, setCursor } from '../repositories/syncStateRepo';
import { pullConversations, pullMessages, pullMembers } from './firebasePull';
import { pushOutboxItem } from './firebasePush';
import { isOnline } from './networkState';
import { isPermanent, errorCode, nextAttemptAt } from './retryPolicy';
import { LOCAL_MESSAGE_RETENTION_LIMIT } from '../../config/features';

let running = false;

// Realtime feeders own steady-state reads, so the engine only pulls on these
// lifecycle transitions (cold start, reconnect, return to foreground) to close
// any gap when feeders weren't attached. The frequent timer/outbox kicks just
// drain the outbox.
const PULL_REASONS: ReadonlySet<SyncReason> = new Set(['boot', 'auth-change', 'online', 'foreground', 'active-change']);

// Retention sweep cadence — at most once per this interval, on a pull run.
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function maybePrune(): Promise<void> {
  // Retention disabled (limit <= 0) → keep ALL messages on-device so the full
  // history stays available offline and reads come straight from local cache.
  if (LOCAL_MESSAGE_RETENTION_LIMIT <= 0) return;
  const last = await getCursor('last_prune_at');
  if (Date.now() - last < PRUNE_INTERVAL_MS) return;
  try { await messagesRepo.pruneOldMessages(LOCAL_MESSAGE_RETENTION_LIMIT); } catch { /* best-effort */ }
  await setCursor('last_prune_at', Date.now());
}

export type SyncReason =
  | 'boot' | 'auth-change' | 'online' | 'foreground'
  | 'active-change' | 'outbox' | 'manual' | 'timer';

/** Push all due outbox items. Returns how many completed. */
export async function pushOutbox(): Promise<number> {
  if (!isOnline()) return 0;
  let completed = 0;
  const due = await outboxRepo.claimDue();
  for (const item of due) {
    if (!isOnline()) break;
    await outboxRepo.markProcessing(item.id);
    try {
      const res = await pushOutboxItem(item);
      // Reconcile an optimistic send (text or media) with its canonical server
      // message id so the local row flips from pending → sent.
      if ((item.type === 'send_message' || item.type === 'send_image_message' || item.type === 'send_voice_message') && res.remoteId) {
        const payload = JSON.parse(item.payload_json || '{}');
        const localId = payload.localId ?? payload.localMessageId;
        if (localId) {
          await messagesRepo.reconcileToRemote(localId, {
            remoteId: res.remoteId, remoteCreatedAt: null,
          });
        }
      }
      await outboxRepo.markCompleted(item.id);
      completed++;
    } catch (err: any) {
      const code = errorCode(err);
      const message = err?.message ?? 'push-failed';
      if (isPermanent(err)) {
        // Permanent: dead-letter immediately and surface on the message.
        await outboxRepo.markFailed(item.id, code, message, Date.now() + 1e12);
        if (item.type === 'send_message') {
          const payload = JSON.parse(item.payload_json || '{}');
          if (payload.localId) await messagesRepo.setError(payload.localId, code, message);
        }
      } else {
        const attempt = item.attempt_count + 1;
        await outboxRepo.markFailed(item.id, code, message, nextAttemptAt(attempt));
        if (item.type === 'send_message') {
          const payload = JSON.parse(item.payload_json || '{}');
          if (payload.localId) await messagesRepo.setStatus(payload.localId, 'pending', 'pending');
        }
      }
    }
  }
  return completed;
}

/** Pull remote changes into the local DB. `activeConversationId` is prioritized. */
export async function pullRemoteChanges(activeConversationId?: string): Promise<void> {
  if (!isOnline()) return;
  await pullConversations();
  if (activeConversationId) {
    await pullMessages(activeConversationId);
    await pullMembers(activeConversationId);
  }
}

export async function syncNow(reason: SyncReason, activeConversationId?: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    await pushOutbox();
    if (PULL_REASONS.has(reason)) {
      await pullRemoteChanges(activeConversationId);
      // Keep the retention sweep off the conversation-open path; run it only on
      // app start / foreground so it never stalls opening a chat.
      if (reason === 'boot' || reason === 'foreground') await maybePrune();
    }
  } catch {
    // Never throw out of a sync run; individual failures are recorded per-item.
  } finally {
    running = false;
  }
}

export async function retryFailedOutboxItem(id: string): Promise<void> {
  await outboxRepo.retryItem(id);
}

export function isSyncing(): boolean {
  return running;
}
