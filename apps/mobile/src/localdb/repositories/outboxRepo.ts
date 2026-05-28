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

/** Items that are due to be sent now (pending and next_attempt_at <= now). */
export async function claimDue(now = Date.now(), limit = 10): Promise<OutboxRow[]> {
  return getDb().all<OutboxRow>(
    `SELECT * FROM outbox
      WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC LIMIT ?`,
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
): Promise<OutboxStatus> {
  const row = await getById(id);
  if (!row) return 'dead';
  const attempt = row.attempt_count + 1;
  const dead = attempt >= row.max_attempts;
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
    `UPDATE outbox SET status = 'pending', attempt_count = 0, next_attempt_at = ?, updated_at = ? WHERE entity_id = ? AND status = 'failed'`,
    [Date.now(), Date.now(), entityId],
  );
}

export async function deleteCompleted(olderThanMs = 0): Promise<void> {
  await getDb().run(`DELETE FROM outbox WHERE status = 'completed' AND updated_at <= ?`, [Date.now() - olderThanMs]);
}

export async function pendingCount(): Promise<number> {
  const row = await getDb().first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM outbox WHERE status IN ('pending','processing')`);
  return row?.n ?? 0;
}
