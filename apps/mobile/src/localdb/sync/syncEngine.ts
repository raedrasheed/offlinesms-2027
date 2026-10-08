// Phase 22 — sync engine. Orchestrates outbox push + remote pull + reconcile.
// Single-flight (no overlapping runs). Read by the scheduler; never blocks UI.

import * as outboxRepo from '../repositories/outboxRepo';
import * as messagesRepo from '../repositories/messagesRepo';
import * as conversationsRepo from '../repositories/conversationsRepo';
import { getCursor, setCursor } from '../repositories/syncStateRepo';
import { pullConversations, pullMessages, pullMembers, pullMessagesBefore } from './firebasePull';
import { pushOutboxItem } from './firebasePush';
import { isOnline } from './networkState';
import { isPermanent, errorCode, nextAttemptAt } from './retryPolicy';
import { LOCAL_MESSAGE_RETENTION_LIMIT } from '../../config/features';

let running = false;   // guards the heavy pull + history backfill
let pushing = false;   // guards the outbox push (independent → sends never wait on a pull)

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

// ── Full-history backfill ────────────────────────────────────────────────────
// On reconnect/foreground/boot, page BACKWARD through every conversation's
// history until the device holds all of it. Resumable across runs via two
// per-conversation cursors (frontier + done flag) and bounded per run so a
// single sync never runs away on a huge/old account.
const BACKFILL_PAGE = 100;                 // messages fetched per page
const MAX_BACKFILL_PAGES_PER_RUN = 8;      // ≈ 800 messages per run; resumes next sync
const BACKFILL_REASONS: ReadonlySet<SyncReason> = new Set(['boot', 'online', 'foreground']);

/** Backfill one conversation's older history, consuming from the shared page
 *  budget. Marks the conversation done when the server has nothing older. */
async function backfillConversation(id: string, budget: { pages: number }): Promise<void> {
  if (await getCursor(`backfill_done:${id}`) > 0) return;
  // Never page across a "clear chat" watermark (don't resurrect cleared history).
  const floor = await getCursor(`chat_cleared:${id}`);

  while (budget.pages > 0 && isOnline()) {
    let frontier = await getCursor(`backfill_before:${id}`);
    if (frontier <= 0) {
      const min = await messagesRepo.getMinMessageTime(id);
      frontier = min > 0 ? min : Date.now();   // empty chat → start from "now"
    }
    if (floor > 0 && frontier <= floor) { await markBackfillDone(id); return; }

    budget.pages--;
    const fetched = await pullMessagesBefore(id, frontier, floor, BACKFILL_PAGE);
    if (fetched === 0) { await markBackfillDone(id); return; }   // no older history

    const newMin = await messagesRepo.getMinMessageTime(id);
    if (newMin <= 0 || newMin >= frontier) { await markBackfillDone(id); return; } // no progress
    await setCursor(`backfill_before:${id}`, newMin);
  }
}

async function markBackfillDone(id: string): Promise<void> {
  await setCursor(`backfill_done:${id}`, Date.now());
  // Seed the forward cursor (if unset) so the next incremental pull for this
  // conversation starts from the newest message instead of re-reading from 0.
  if ((await getCursor(`msg_cursor:${id}`)) <= 0) {
    const max = await messagesRepo.getMaxMessageTime(id);
    if (max > 0) await setCursor(`msg_cursor:${id}`, max);
  }
}

/** Pull every message not yet on the device, across all conversations (active
 *  one first). Bounded per run; resumes on the next sync until complete. */
export async function backfillMissingMessages(activeConversationId?: string): Promise<void> {
  if (!isOnline()) return;
  const convos = await conversationsRepo.listConversations();
  const ids = convos.map(c => c.id);
  if (activeConversationId) {
    const i = ids.indexOf(activeConversationId);
    if (i > 0) { ids.splice(i, 1); ids.unshift(activeConversationId); }
  }
  const budget = { pages: MAX_BACKFILL_PAGES_PER_RUN };
  for (const id of ids) {
    if (budget.pages <= 0 || !isOnline()) break;
    try { await backfillConversation(id, budget); } catch { /* best-effort; retry next run */ }
  }
}

export type SyncReason =
  | 'boot' | 'auth-change' | 'online' | 'foreground'
  | 'active-change' | 'outbox' | 'manual' | 'timer';

/** Push all due outbox items. Returns how many completed. */
export async function pushOutbox(): Promise<number> {
  if (!isOnline()) { console.log('[outbox] skip: offline'); return 0; }
  let completed = 0;
  const due = await outboxRepo.claimDue();
  if (due.length) console.log(`[outbox] pushing ${due.length} item(s)`);
  for (const item of due) {
    if (!isOnline()) break;
    await outboxRepo.markProcessing(item.id);
    try {
      const res = await pushOutboxItem(item);
      if (item.type.startsWith('send_')) console.log(`[outbox] sent ${item.type} ${item.id} → ${res.remoteId ?? '(no id)'}`);
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
      console.log(`[outbox] push FAILED ${item.type} ${item.id}: ${code} — ${message} (permanent=${isPermanent(err)})`);
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

// Push the outbox under its OWN single-flight guard, independent of the heavy
// pull/backfill `running` lock. This is what makes a freshly-sent message go out
// immediately even while a long history backfill is in progress — otherwise the
// send would sit in the outbox (stuck "pending", with no Message-info menu)
// until the backfill released the lock.
export async function flushOutbox(): Promise<void> {
  if (pushing) return;
  pushing = true;
  try {
    // Recover sends orphaned in 'processing' by an interrupted push (otherwise
    // they'd stay "Sending…" forever and never re-attempt).
    try { await outboxRepo.requeueStaleProcessing(); } catch { /* best-effort */ }
    // Drain in a loop so a large backlog (e.g. a queue of read-receipts) clears
    // in one pass instead of 10 items per scheduler tick. Bounded so a run can't
    // go on forever; pushOutbox returns 0 when nothing is due (or offline), which
    // ends the loop. Newly-sent messages are still picked up first each
    // iteration (claimDue prioritizes sends), so they never wait behind it.
    for (let i = 0; i < 100; i++) {
      const completed = await pushOutbox();
      if (completed === 0) break;
    }
  }
  catch { /* per-item failures are recorded in the outbox */ }
  finally { pushing = false; }
}

// Targeted catch-up for ONE conversation (opening a chat, a notification tap).
// Runs immediately under its own per-conversation guard — never skipped because
// a boot/foreground pull or a long history backfill holds the `running` lock
// (that skip is what left a freshly-notified message missing on open).
const targeted = new Map<string, Promise<void>>();
export function pullConversationNow(conversationId: string): Promise<void> {
  const inFlight = targeted.get(conversationId);
  if (inFlight) return inFlight;
  const p = (async () => {
    if (!isOnline()) return;
    try { await pullMessages(conversationId); } catch { /* the feeder still delivers */ }
    try { await pullMembers(conversationId); } catch { /* best-effort */ }
  })().finally(() => { targeted.delete(conversationId); });
  targeted.set(conversationId, p);
  return p;
}

export async function syncNow(reason: SyncReason, activeConversationId?: string): Promise<void> {
  if (reason === 'active-change' && activeConversationId) {
    // Opening a chat: don't make its catch-up wait behind an outbox drain.
    void flushOutbox();
    await pullConversationNow(activeConversationId);
    return;
  }
  // Always flush the outbox first, regardless of any in-flight pull/backfill.
  await flushOutbox();
  if (!PULL_REASONS.has(reason)) return;
  if (running) return;
  running = true;
  try {
    await pullRemoteChanges(activeConversationId);
    // Pull any older history still missing from the device (resumable, bounded
    // per run) so going online eventually mirrors the full history locally.
    if (BACKFILL_REASONS.has(reason)) await backfillMissingMessages(activeConversationId);
    // Keep the retention sweep off the conversation-open path; run it only on
    // app start / foreground so it never stalls opening a chat.
    if (reason === 'boot' || reason === 'foreground') await maybePrune();
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
