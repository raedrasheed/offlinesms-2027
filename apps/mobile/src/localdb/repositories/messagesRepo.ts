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

/** Count stored messages, optionally scoped to a single conversation. Excludes
 *  rows deleted for me, matching what the conversation screen renders. */
export async function countMessages(conversationId?: string): Promise<number> {
  if (conversationId != null) {
    const row = await getDb().first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND deleted_for_me = 0`,
      [conversationId],
    );
    return row?.n ?? 0;
  }
  const row = await getDb().first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages WHERE deleted_for_me = 0`,
  );
  return row?.n ?? 0;
}

export async function getByLocalId(localId: string): Promise<MessageRow | null> {
  return getDb().first<MessageRow>(`SELECT * FROM messages WHERE local_id = ?`, [localId]);
}

/**
 * Retention: keep the most recent `keepPerConversation` messages per
 * conversation and evict older ones, bounding DB growth. Only fully-synced rows
 * (sync_status 'synced' with a remote_id) are eligible — pending/unsent and
 * failed messages are never dropped, so nothing waiting on the outbox is lost.
 * Evicted history is re-fetchable from Firestore on demand. Returns the number
 * of rows deleted.
 */
export async function pruneOldMessages(keepPerConversation = 500): Promise<number> {
  const db = getDb();
  // Cheap guard: skip the full-table window sort + orphan sweep unless at least
  // one conversation actually exceeds the cap (the common case is a no-op).
  const over = await db.first<{ one: number }>(
    `SELECT 1 AS one FROM (
       SELECT conversation_id FROM messages
        WHERE sync_status = 'synced' AND remote_id IS NOT NULL
        GROUP BY conversation_id HAVING COUNT(*) > ?
     ) LIMIT 1`,
    [keepPerConversation],
  );
  if (!over) return 0;
  const victims = await db.all<{ id: string }>(
    `SELECT id FROM (
       SELECT id, ROW_NUMBER() OVER (
         PARTITION BY conversation_id
         ORDER BY COALESCE(remote_created_at, created_at) DESC
       ) AS rn
       FROM messages
       WHERE sync_status = 'synced' AND remote_id IS NOT NULL
     ) WHERE rn > ?`,
    [keepPerConversation],
  );
  if (victims.length === 0) return 0;
  const ids = victims.map((v) => v.id);
  // Chunk to stay under SQLite's bound-variable limit on large backlogs.
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const placeholders = chunk.map(() => '?').join(',');
    await db.run(`DELETE FROM messages WHERE id IN (${placeholders})`, chunk);
  }
  // Drop reactions/receipts orphaned by the prune (keyed by either id form).
  const orphanFilter = `message_id NOT IN (SELECT id FROM messages UNION SELECT remote_id FROM messages WHERE remote_id IS NOT NULL)`;
  await db.run(`DELETE FROM message_reactions WHERE ${orphanFilter}`);
  await db.run(`DELETE FROM message_receipts WHERE ${orphanFilter}`);
  return ids.length;
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
     VALUES (?,?,NULL,?,?,?, 'text', ?, ?, ?, NULL, ?, NULL, 0, 0, NULL, ?, ?, 0, NULL, 'pending', NULL, NULL, 'pending', ?, 0)`,
    [
      id, id, m.conversationId, m.senderUid, m.senderDisplayName ?? null, m.text, preview,
      now, now, m.replyToMessageId ?? null, m.replyToPreview ?? null, m.clientSequence,
    ],
  );
  return (await getByLocalId(id))!;
}

export interface NewLocalMediaMessage {
  conversationId: string;
  senderUid: string;
  senderDisplayName?: string | null;
  mediaType: 'image' | 'voice';
  caption?: string | null;
  localUri: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  waveform?: number[] | null;
  replyToMessageId?: string | null;
  replyToPreview?: string | null;
  deviceId: string;
  clientSequence: number;
}

/** Phase 23 — insert an optimistic outgoing media message (image/voice). */
export async function insertLocalMediaMessage(m: NewLocalMediaMessage): Promise<MessageRow> {
  const now = Date.now();
  const id = localMessageId(m.deviceId);
  const preview = m.mediaType === 'image' ? 'Photo' : 'Voice message';
  await getDb().run(
    `INSERT INTO messages
      (id, local_id, remote_id, conversation_id, sender_uid, sender_display_name, type, text, preview, caption,
       created_at, remote_created_at, updated_at, edited_at, deleted_for_everyone, deleted_for_me, deleted_at,
       reply_to_message_id, reply_to_preview, forwarded, forwarded_from_message_id,
       status, error_code, error_message, sync_status, client_sequence, server_version,
       media_local_uri, media_mime, media_size, media_width, media_height, media_duration_ms, media_waveform,
       media_upload_status, media_upload_progress)
     VALUES (?,?,NULL,?,?,?, ?, NULL, ?, ?, ?, NULL, ?, NULL, 0, 0, NULL, ?, ?, 0, NULL, 'pending', NULL, NULL, 'pending', ?, 0,
       ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
    [
      id, id, m.conversationId, m.senderUid, m.senderDisplayName ?? null, m.mediaType, preview, m.caption ?? null,
      now, now, m.replyToMessageId ?? null, m.replyToPreview ?? null, m.clientSequence,
      m.localUri, m.mimeType, m.sizeBytes, m.width ?? null, m.height ?? null, m.durationMs ?? null,
      m.waveform ? JSON.stringify(m.waveform) : null,
    ],
  );
  return (await getByLocalId(id))!;
}

/** Phase 23 — update the local upload progress (0..1) for a pending media message. */
export async function setMediaProgress(localId: string, progress: number): Promise<void> {
  await getDb().run(
    `UPDATE messages SET media_upload_status = 'uploading', media_upload_progress = ?, updated_at = ? WHERE local_id = ?`,
    [Math.max(0, Math.min(1, progress)), Date.now(), localId],
  );
}

/** Phase 23 — mark a media message uploaded and store the resolved URLs. */
export async function setMediaUploaded(localId: string, urls: { downloadURL?: string | null; thumbnailURL?: string | null }): Promise<void> {
  await getDb().run(
    `UPDATE messages SET media_upload_status = 'uploaded', media_upload_progress = 1,
       media_download_url = COALESCE(?, media_download_url), media_thumb_url = COALESCE(?, media_thumb_url),
       updated_at = ? WHERE local_id = ?`,
    [urls.downloadURL ?? null, urls.thumbnailURL ?? null, Date.now(), localId],
  );
}

/** Phase 23 — mark a media upload failed (keeps the row for retry). */
export async function setMediaFailed(localId: string): Promise<void> {
  await getDb().run(
    `UPDATE messages SET media_upload_status = 'failed', updated_at = ? WHERE local_id = ?`,
    [Date.now(), localId],
  );
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

export interface RemoteMediaInput {
  mimeType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  waveform?: number[] | null;
  storagePath?: string | null;
  downloadURL?: string | null;
  thumbnailPath?: string | null;
  thumbnailURL?: string | null;
  uploadStatus?: 'pending' | 'uploading' | 'uploaded' | 'failed' | null;
}

export async function upsertRemoteMessage(r: {
  remoteId: string; conversationId: string; senderUid: string; senderDisplayName?: string | null;
  type?: 'text' | 'image' | 'voice'; caption?: string | null;
  text: string | null; remoteCreatedAt: number | null; editedAt?: number | null;
  deletedForEveryone?: boolean; replyToMessageId?: string | null; replyToPreview?: string | null;
  forwarded?: boolean; serverVersion?: number; status?: MessageStatus;
  reactions?: Record<string, string[]> | null; counts?: RemoteReceiptCounts;
  media?: RemoteMediaInput | null;
}): Promise<void> {
  const existing = await getByRemoteId(r.remoteId);
  const now = Date.now();
  const reactionsJson = r.reactions != null ? JSON.stringify(r.reactions) : null;
  const c = r.counts ?? {};
  const md = r.media ?? null;
  const waveformJson = md?.waveform != null ? JSON.stringify(md.waveform) : null;
  const type = r.type ?? 'text';
  if (existing) {
    // Only touch reactions/receipt counts (and media) when the caller actually
    // provides them. The catch-up pull omits reactions/counts; without this
    // guard it would clobber data the realtime feeder had set.
    const sets = [
      'type = COALESCE(?, type)', 'caption = ?', 'text = ?',
      'sender_display_name = COALESCE(?, sender_display_name)',
      'remote_created_at = COALESCE(?, remote_created_at)', 'edited_at = ?',
      'deleted_for_everyone = ?', 'reply_to_message_id = ?', 'reply_to_preview = ?',
      'forwarded = ?', 'status = COALESCE(?, status)', "sync_status = 'synced'",
      'server_version = COALESCE(?, server_version)', 'updated_at = ?',
    ];
    const params: any[] = [
      r.type ?? null, r.caption ?? null, r.text, r.senderDisplayName ?? null, r.remoteCreatedAt, r.editedAt ?? null,
      r.deletedForEveryone ? 1 : 0, r.replyToMessageId ?? null, r.replyToPreview ?? null,
      r.forwarded ? 1 : 0, r.status ?? null, r.serverVersion ?? null, now,
    ];
    if (r.reactions !== undefined) { sets.push('reactions_json = ?'); params.push(reactionsJson); }
    if (r.counts !== undefined) {
      sets.push('delivered_count = ?', 'read_count = ?', 'viewed_count = ?', 'played_count = ?');
      params.push(c.delivered ?? 0, c.read ?? 0, c.viewed ?? 0, c.played ?? 0);
    }
    if (r.media !== undefined) {
      sets.push(
        'media_mime = ?', 'media_size = ?', 'media_width = ?', 'media_height = ?',
        'media_duration_ms = ?', 'media_waveform = ?', 'media_storage_path = ?',
        'media_download_url = COALESCE(?, media_download_url)', 'media_thumb_path = ?',
        'media_thumb_url = COALESCE(?, media_thumb_url)', 'media_upload_status = ?',
      );
      params.push(
        md?.mimeType ?? null, md?.sizeBytes ?? null, md?.width ?? null, md?.height ?? null,
        md?.durationMs ?? null, waveformJson, md?.storagePath ?? null,
        md?.downloadURL ?? null, md?.thumbnailPath ?? null, md?.thumbnailURL ?? null,
        md?.uploadStatus ?? null,
      );
    }
    params.push(r.remoteId);
    await getDb().run(`UPDATE messages SET ${sets.join(', ')} WHERE remote_id = ?`, params);
  } else {
    await getDb().run(
      `INSERT INTO messages
        (id, local_id, remote_id, conversation_id, sender_uid, sender_display_name, type, text, preview, caption,
         created_at, remote_created_at, updated_at, edited_at, deleted_for_everyone, deleted_for_me, deleted_at,
         reply_to_message_id, reply_to_preview, forwarded, forwarded_from_message_id,
         status, error_code, error_message, sync_status, client_sequence, server_version,
         reactions_json, delivered_count, read_count, viewed_count, played_count,
         media_mime, media_size, media_width, media_height, media_duration_ms, media_waveform,
         media_storage_path, media_download_url, media_thumb_path, media_thumb_url, media_upload_status)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, NULL, ?, NULL, NULL, 'synced', 0, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.remoteId, r.remoteId, r.conversationId, r.senderUid, r.senderDisplayName ?? null,
        type, r.text, (r.text ?? '').slice(0, 200), r.caption ?? null,
        r.remoteCreatedAt ?? now, r.remoteCreatedAt ?? now, now,
        r.editedAt ?? null, r.deletedForEveryone ? 1 : 0, r.replyToMessageId ?? null, r.replyToPreview ?? null,
        r.forwarded ? 1 : 0, r.status ?? 'sent', r.serverVersion ?? 0,
        reactionsJson, c.delivered ?? 0, c.read ?? 0, c.viewed ?? 0, c.played ?? 0,
        md?.mimeType ?? null, md?.sizeBytes ?? null, md?.width ?? null, md?.height ?? null,
        md?.durationMs ?? null, waveformJson, md?.storagePath ?? null, md?.downloadURL ?? null,
        md?.thumbnailPath ?? null, md?.thumbnailURL ?? null, md?.uploadStatus ?? null,
      ],
    );
  }
}

/** Phase 22D — optimistic local mutators (applied before the outbox push). */
export async function updateReactions(remoteId: string, reactions: Record<string, string[]> | null): Promise<void> {
  await getDb().run(
    `UPDATE messages SET reactions_json = ?, updated_at = ? WHERE remote_id = ?`,
    [reactions != null ? JSON.stringify(reactions) : null, Date.now(), remoteId],
  );
}

export async function updateText(remoteId: string, text: string): Promise<void> {
  await getDb().run(
    `UPDATE messages SET text = ?, preview = ?, edited_at = ?, updated_at = ? WHERE remote_id = ?`,
    [text, text.slice(0, 200), Date.now(), Date.now(), remoteId],
  );
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
