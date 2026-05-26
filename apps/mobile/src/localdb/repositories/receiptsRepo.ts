// Phase 22 — receipts repository. Status transitions are monotonic; the
// conflict resolver decides whether an incoming status may overwrite the
// current one (never a downgrade).
import { getDb } from '../connection';
import { localId } from '../sync/ids';
import { mergeReceiptStatus } from '../sync/conflictResolver';
import type { ReceiptRow, ReceiptStatus } from '../types';

export async function getReceipt(messageId: string, uid: string): Promise<ReceiptRow | null> {
  return getDb().first<ReceiptRow>(
    `SELECT * FROM message_receipts WHERE message_id = ? AND user_uid = ?`, [messageId, uid]);
}

export async function listReceipts(messageId: string): Promise<ReceiptRow[]> {
  return getDb().all<ReceiptRow>(`SELECT * FROM message_receipts WHERE message_id = ?`, [messageId]);
}

/** Upsert a receipt, never downgrading status (monotonic). */
export async function upsertReceipt(
  messageId: string,
  uid: string,
  status: ReceiptStatus,
  at = Date.now(),
): Promise<void> {
  const existing = await getReceipt(messageId, uid);
  const next = existing ? mergeReceiptStatus(existing.status, status) : status;
  if (existing && next === existing.status) return; // no upgrade → no-op

  const col =
    next === 'delivered' ? 'delivered_at' :
    next === 'read'      ? 'read_at' :
    next === 'viewed'    ? 'viewed_at' :
    next === 'played'    ? 'played_at' :
    next === 'failed'    ? 'failed_at' : null;

  if (existing) {
    await getDb().run(
      `UPDATE message_receipts SET status = ?, ${col ? `${col} = ?,` : ''} sync_status = 'synced'
       WHERE message_id = ? AND user_uid = ?`,
      col ? [next, at, messageId, uid] : [next, messageId, uid],
    );
  } else {
    await getDb().run(
      `INSERT INTO message_receipts (id, message_id, user_uid, status, ${col ?? 'delivered_at'}, sync_status)
       VALUES (?, ?, ?, ?, ?, 'synced')`,
      [localId('receipt'), messageId, uid, next, col ? at : null],
    );
  }
}
