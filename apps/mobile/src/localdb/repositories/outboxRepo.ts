// Phase 22 — outbox repository (durable, idempotent push queue).
//
// Every mutation the UI performs while local-first is enqueued here and drained
// by the sync engine. `idempotency_key` is UNIQUE, so enqueuing the same logical
// action twice (or a retry after an ambiguous failure) collapses to one row and
// can never create a duplicate remote write.

import { getDb } from '../connection';
import { localId } from '../sync/ids';
import type { OutboxRow, OutboxStatus, OutboxType } from '../types';

export interface EnqueueInput {
  type: OutboxType;
  entityType?: string | null;
  entityId?: string | null;
  conversationId?: string | null;
  payload: unknown;
  idempotencyKey: string;
  maxAttempts?: number;
}

/** Enqueue an outbox item. Idempotent on idempotency_key (no-op if present). */
export async function enqueue(input: EnqueueInput): Promise<OutboxRow> {
  const existing = await getDb().first<OutboxRow>(
    `SELECT * FROM outbox WHERE idempotency_key = ?`, [input.idempotencyKey]);
  if (existing) return existing;

  const now = Date.now();
  const id = localId('outbox');
  await getDb().run(
    `INSERT INTO outbox
      (id, type, entity_type, entity_id, conversation_id, payload_json, status,
       attempt_count, max_attempts, next_attempt_at, last_error_code, last_error_message,
       created_at, updated_at, idempotency_key)
     VALUES (?,?,?,?,?,?, 'pending', 0, ?, ?, NULL, NULL, ?, ?, ?)`,
    [
      id, input.type, input.entityType ?? null, input.entityId ?? null,
      input.conversationId ?? null, JSON.stringify(input.payload ?? {}),
      input.maxAttempts ?? 8, now, now, now, input.idempotencyKey,
    ],
  );
  return (await getById(id))!;
}

export async function getById(id: string): Promise<OutboxRow | null> {
  return getDb().first<OutboxRow>(`SELECT * FROM outbox WHERE id = ?`, [id]);
}

/**
 * Recover orphaned items stuck in 'processing': if a push was interrupted (app
 * backgrounded/killed between markProcessing and markCompleted/markFailed) the
 * item would otherwise never be re-claimed by claimDue and the message stays
 * "Sending…" forever. Flip 'processing' rows untouched for `staleMs` back to
 * 'pending'. The threshold avoids disturbing a genuinely in-flight push.
 * Returns the number of rows recovered.
 */
export type OutboxLane = 'all' | 'messages' | 'media';
const MEDIA_TYPES = "('send_image_message','send_voice_message','send_attachment_message')";
function laneClause(lane: OutboxLane): string { return lane === 'all' ? '' : ` AND type ${lane === 'media' ? 'IN' : 'NOT IN'} ${MEDIA_TYPES}`; }

export async function requeueStaleProcessing(staleMs = 90_000, now = Date.now(), lane: OutboxLane = 'all'): Promise<number> {
  const res: any = await getDb().run(
    `UPDATE outbox SET status = 'pending', updated_at = ?
      WHERE status = 'processing' AND updated_at <= ?${laneClause(lane)}`,
    [now, now - staleMs],
  );
  return res?.changes ?? res?.rowsAffected ?? 0;
}

/** Items that are due to be sent now (pending and next_attempt_at <= now).
 *  Three priority tiers, then oldest-first within a tier:
 *    0 — outgoing message sends (never wait behind bookkeeping → no stuck "Sending…")
 *    1 — other user mutations (group/contact adds, reactions, pins, escalations…)
 *    2 — read receipts (best-effort bookkeeping)
 *  Receipts are the LOWEST tier so a large or chronically-failing receipt backlog
 *  can't starve a real mutation like adding an external contact to a group. */
export async function claimDue(now = Date.now(), limit = 10, lane: OutboxLane = 'all'): Promise<OutboxRow[]> {
  return getDb().all<OutboxRow>(
    `SELECT * FROM outbox
      WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)${laneClause(lane)}
      ORDER BY
        CASE
          WHEN type IN ('send_message','send_image_message','send_voice_message','send_attachment_message') THEN 0
          WHEN type = 'mark_receipt' THEN 2
          ELSE 1
        END,
        created_at ASC
      LIMIT ?`,
    [now, limit],
  );
}

export async function markProcessing(id: string): Promise<void> {
  await getDb().run(`UPDATE outbox SET status = 'processing', updated_at = ? WHERE id = ?`, [Date.now(), id]);
}

export async function markCompleted(id: string): Promise<void> {
  await getDb().run(`UPDATE outbox SET status = 'completed', updated_at = ? WHERE id = ?`, [Date.now(), id]);
}

/**
 * Record a failed attempt. Re-queues with backoff until max_attempts is hit,
 * then dead-letters. `nextAttemptAt` is computed by the caller (retryPolicy).
 */
export async function markFailed(
  id: string,
  errorCode: string | null,
  errorMessage: string | null,
  nextAttemptAt: number,
  permanent = false,
): Promise<OutboxStatus> {
  const row = await getById(id);
  if (!row) return 'dead';
  const attempt = row.attempt_count + 1;
  const dead = permanent || attempt >= row.max_attempts;
  await getDb().run(
    `UPDATE outbox SET status = ?, attempt_count = ?, next_attempt_at = ?,
       last_error_code = ?, last_error_message = ?, updated_at = ? WHERE id = ?`,
    [dead ? 'dead' : 'pending', attempt, nextAttemptAt, errorCode, errorMessage, Date.now(), id],
  );
  return dead ? 'dead' : 'pending';
}

export async function retryItem(id: string): Promise<void> {
  await getDb().run(
    `UPDATE outbox SET status = 'pending', next_attempt_at = ?, updated_at = ? WHERE id = ?`,
    [Date.now(), Date.now(), id],
  );
}

/** Phase 23 — reset a failed item by its entity id (e.g. a media message's local id). */
export async function retryByEntityId(entityId: string): Promise<void> {
  await getDb().run(
    `UPDATE outbox SET status = 'pending', attempt_count = 0, next_attempt_at = ?, updated_at = ? WHERE entity_id = ? AND status IN ('failed','dead','pending')`,
    [Date.now(), Date.now(), entityId],
  );
}

/**
 * One-time housekeeping on startup: dead-letter pending read-receipt items that
 * have already failed at least `minAttempts` times. Read receipts are
 * best-effort, and a large backlog hard-failing with `internal` (e.g. thousands
 * enqueued at once) would otherwise churn the queue — and battery — for a long
 * time and slow every other item behind it. Returns the number cleared.
 */
export async function dropStuckReceipts(minAttempts = 2, now = Date.now()): Promise<number> {
  const res: any = await getDb().run(
    `UPDATE outbox SET status = 'dead', updated_at = ?
      WHERE type = 'mark_receipt' AND status = 'pending' AND attempt_count >= ?`,
    [now, minAttempts],
  );
  return res?.changes ?? res?.rowsAffected ?? 0;
}

export async function deleteCompleted(olderThanMs = 0): Promise<void> {
  await getDb().run(`DELETE FROM outbox WHERE status = 'completed' AND updated_at <= ?`, [Date.now() - olderThanMs]);
}

export async function pendingCount(): Promise<number> {
  const row = await getDb().first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM outbox WHERE status IN ('pending','processing')`);
  return row?.n ?? 0;
}

