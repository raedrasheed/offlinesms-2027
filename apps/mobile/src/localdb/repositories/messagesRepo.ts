// Phase 22 — messages repository.
//
// The conversation screen reads from here. Outgoing messages are written
// immediately as `pending` for optimistic UI; the sync engine reconciles them
// to their canonical remote counterpart by local_id once the server confirms.

import { getDb } from '../connection';
import { localMessageId } from '../sync/ids';
import type { MessageRow, MessageStatus, MessageSyncStatus } from '../types';

const PAGE = 40;

export async function listMessages(conversationId: string, limit = PAGE, beforeCreatedAt?: number): Promise<MessageRow[]> {
  const params: any[] = [conversationId];
  let cursor = '';
  if (beforeCreatedAt != null) {
    cursor = 'AND COALESCE(remote_created_at, created_at) < ?';
    params.push(beforeCreatedAt);
  }
  params.push(limit);
  // Sort by canonical time when known, else local time. Newest first; the UI
  // reverses for display. deleted_for_me rows are hidden.
  const rows = await getDb().all<MessageRow>(
    `SELECT * FROM messages
      WHERE conversation_id = ? AND deleted_for_me = 0 ${cursor}
      ORDER BY COALESCE(remote_created_at, created_at) DESC
      LIMIT ?`,
    params,
  );
  return rows;
}

export async function getByLocalId(localId: string): Promise<MessageRow | null> {
  return getDb().first<MessageRow>(`SELECT * FROM messages WHERE local_id = ?`, [localId]);
}

export async function getByRemoteId(remoteId: string): Promise<MessageRow | null> {
  return getDb().first<MessageRow>(`SELECT * FROM messages WHERE remote_id = ?`, [remoteId]);
}

export interface NewLocalMessage {
  conversationId: string;
  senderUid: string;
  senderDisplayName?: string | null;
  text: string;
  replyToMessageId?: string | null;
  replyToPreview?: string | null;
  deviceId: string;
  clientSequence: number;
}

/** Insert an optimistic outgoing message (status `pending`). Returns the row. */
export async function insertLocalMessage(m: NewLocalMessage): Promise<MessageRow> {
  const now = Date.now();
  const id = localMessageId(m.deviceId);
  const preview = m.text.slice(0, 200);
  await getDb().run(
    `INSERT INTO messages
      (id, local_id, remote_id, conversation_id, sender_uid, sender_display_name, type, text, preview,
       created_at, remote_created_at, updated_at, edited_at, deleted_for_everyone, deleted_for_me, deleted_at,
       reply_to_message_id, reply_to_preview, forwarded, forwarded_from_message_id,
       status, error_code, error_message, sync_status, client_sequence, server_version)
     VALUES (?,?,?,?,?,?, 'text', ?, ?, ?, NULL, ?, NULL, 0, 0, NULL, ?, ?, 0, NULL, 'pending', NULL, NULL, 'pending', ?, 0)`,
    [
      id, id, m.conversationId, m.senderUid, m.senderDisplayName ?? null, m.text, preview,
      now, now, m.replyToMessageId ?? null, m.replyToPreview ?? null, m.clientSequence,
    ],
  );
  return (await getByLocalId(id))!;
}

export async function setStatus(localId: string, status: MessageStatus, sync?: MessageSyncStatus): Promise<void> {
  if (sync) {
    await getDb().run(`UPDATE messages SET status = ?, sync_status = ?, updated_at = ? WHERE local_id = ?`,
      [status, sync, Date.now(), localId]);
  } else {
    await getDb().run(`UPDATE messages SET status = ?, updated_at = ? WHERE local_id = ?`,
      [status, Date.now(), localId]);
  }
}

export async function setError(localId: string, code: string | null, message: string | null): Promise<void> {
  await getDb().run(
    `UPDATE messages SET status = 'failed', sync_status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE local_id = ?`,
    [code, message, Date.now(), localId],
  );
}

/** Reconcile a locally-created message with its canonical remote message. */
export async function reconcileToRemote(localId: string, remote: {
  remoteId: string; remoteCreatedAt: number | null; serverVersion?: number;
}): Promise<void> {
  await getDb().run(
    `UPDATE messages SET remote_id = ?, remote_created_at = COALESCE(?, remote_created_at),
       status = 'sent', sync_status = 'synced', server_version = COALESCE(?, server_version), updated_at = ?
     WHERE local_id = ?`,
    [remote.remoteId, remote.remoteCreatedAt, remote.serverVersion ?? null, Date.now(), localId],
  );
}

/** Upsert a message pulled from the remote backend (keyed by remote_id). */
export interface RemoteReceiptCounts {
  delivered?: number; read?: number; viewed?: number; played?: number;
}

export async function upsertRemoteMessage(r: {
  remoteId: string; conversationId: string; senderUid: string; senderDisplayName?: string | null;
  text: string | null; remoteCreatedAt: number | null; editedAt?: number | null;
  deletedForEveryone?: boolean; replyToMessageId?: string | null; replyToPreview?: string | null;
  forwarded?: boolean; serverVersion?: number; status?: MessageStatus;
  reactions?: Record<string, string[]> | null; counts?: RemoteReceiptCounts;
}): Promise<void> {
  const existing = await getByRemoteId(r.remoteId);
  const now = Date.now();
  const reactionsJson = r.reactions != null ? JSON.stringify(r.reactions) : null;
  const c = r.counts ?? {};
  if (existing) {
    await getDb().run(
      `UPDATE messages SET text = ?, sender_display_name = COALESCE(?, sender_display_name),
         remote_created_at = COALESCE(?, remote_created_at), edited_at = ?,
         deleted_for_everyone = ?, reply_to_message_id = ?, reply_to_preview = ?,
         forwarded = ?, status = COALESCE(?, status), sync_status = 'synced',
         server_version = COALESCE(?, server_version),
         reactions_json = ?, delivered_count = ?, read_count = ?, viewed_count = ?, played_count = ?,
         updated_at = ?
       WHERE remote_id = ?`,
      [
        r.text, r.senderDisplayName ?? null, r.remoteCreatedAt, r.editedAt ?? null,
        r.deletedForEveryone ? 1 : 0, r.replyToMessageId ?? null, r.replyToPreview ?? null,
        r.forwarded ? 1 : 0, r.status ?? null, r.serverVersion ?? null,
        reactionsJson, c.delivered ?? 0, c.read ?? 0, c.viewed ?? 0, c.played ?? 0,
        now, r.remoteId,
      ],
    );
  } else {
    await getDb().run(
      `INSERT INTO messages
        (id, local_id, remote_id, conversation_id, sender_uid, sender_display_name, type, text, preview,
         created_at, remote_created_at, updated_at, edited_at, deleted_for_everyone, deleted_for_me, deleted_at,
         reply_to_message_id, reply_to_preview, forwarded, forwarded_from_message_id,
         status, error_code, error_message, sync_status, client_sequence, server_version,
         reactions_json, delivered_count, read_count, viewed_count, played_count)
       VALUES (?, NULL, ?, ?, ?, ?, 'text', ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, NULL, ?, NULL, NULL, 'synced', 0, ?, ?, ?, ?, ?, ?)`,
      [
        r.remoteId, r.remoteId, r.conversationId, r.senderUid, r.senderDisplayName ?? null,
        r.text, (r.text ?? '').slice(0, 200), r.remoteCreatedAt ?? now, r.remoteCreatedAt ?? now, now,
        r.editedAt ?? null, r.deletedForEveryone ? 1 : 0, r.replyToMessageId ?? null, r.replyToPreview ?? null,
        r.forwarded ? 1 : 0, r.status ?? 'sent', r.serverVersion ?? 0,
        reactionsJson, c.delivered ?? 0, c.read ?? 0, c.viewed ?? 0, c.played ?? 0,
      ],
    );
  }
}

export async function markDeletedForEveryone(remoteId: string): Promise<void> {
  await getDb().run(
    `UPDATE messages SET deleted_for_everyone = 1, text = NULL, preview = NULL, updated_at = ? WHERE remote_id = ?`,
    [Date.now(), remoteId],
  );
}

export async function markDeletedForMe(id: string): Promise<void> {
  await getDb().run(`UPDATE messages SET deleted_for_me = 1, updated_at = ? WHERE id = ? OR local_id = ? OR remote_id = ?`,
    [Date.now(), id, id, id]);
}

export async function nextClientSequence(conversationId: string): Promise<number> {
  const row = await getDb().first<{ m: number }>(
    `SELECT MAX(client_sequence) AS m FROM messages WHERE conversation_id = ?`, [conversationId]);
  return (row?.m ?? 0) + 1;
}
