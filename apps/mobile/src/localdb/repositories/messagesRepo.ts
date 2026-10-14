import { emitLocalMessagesChanged } from '../messageChanges';
// Phase 22 — messages repository.
//
// The conversation screen reads from here. Outgoing messages are written
// immediately as `pending` for optimistic UI; the sync engine reconciles them
// to their canonical remote counterpart by local_id once the server confirms.

import { getDb, type LocalDatabase } from '../connection';
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
    `SELECT messages.*, CASE WHEN messages.type = 'poll' THEN (
        SELECT status FROM outbox WHERE entity_type = 'message' AND entity_id = messages.remote_id
          AND conversation_id = messages.conversation_id AND type = 'close_poll'
        LIMIT 1
      ) ELSE NULL END AS poll_close_status FROM messages
      WHERE conversation_id = ? AND deleted_for_me = 0 ${cursor}
      ORDER BY COALESCE(remote_created_at, created_at) DESC
      LIMIT ?`,
    params,
  );
  return rows;
}

/**
 * How many visible messages are at least as new as the given message — the
 * window size the conversation screen needs to include it (notification deep
 * link to a message that is no longer among the newest). Uses the v6 order
 * index. Returns null when the message isn't stored locally.
 */
export async function positionFromNewest(conversationId: string, remoteOrLocalId: string): Promise<number | null> {
  const row = await getDb().first<{ t: number | null }>(
    `SELECT COALESCE(remote_created_at, created_at) AS t FROM messages
      WHERE conversation_id = ? AND (remote_id = ? OR local_id = ?) AND deleted_for_me = 0`,
    [conversationId, remoteOrLocalId, remoteOrLocalId],
  );
  if (!row || row.t == null) return null;
  const n = await getDb().first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages
      WHERE conversation_id = ? AND deleted_for_me = 0 AND COALESCE(remote_created_at, created_at) >= ?`,
    [conversationId, row.t],
  );
  return n?.n ?? null;
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

/** Phase 23 — newest SERVER message time in a conversation (0 if none synced).
 *  Server-time only so the "clear" watermark never mixes in a device's local
 *  clock (which would hide a peer's server-timestamped new messages). */
export async function getMaxMessageTime(conversationId: string): Promise<number> {
  const row = await getDb().first<{ t: number | null }>(
    `SELECT MAX(remote_created_at) AS t FROM messages WHERE conversation_id = ?`,
    [conversationId],
  );
  return row?.t ?? 0;
}

/** Oldest synced message time (min remote createdAt) for a conversation; 0 when
 *  none. Used as the starting frontier for the full-history backfill. */
export async function getMinMessageTime(conversationId: string): Promise<number> {
  const row = await getDb().first<{ t: number | null }>(
    `SELECT MIN(remote_created_at) AS t FROM messages WHERE conversation_id = ?`,
    [conversationId],
  );
  return row?.t ?? 0;
}

/** Phase 23 — delete all local messages for a conversation ("clear chat"). */
export async function deleteConversationMessages(conversationId: string): Promise<number> {
  const before = await getDb().first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?`, [conversationId]);
  await getDb().run(`DELETE FROM messages WHERE conversation_id = ?`, [conversationId]);
  return before?.n ?? 0;
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
  replyToSenderUid?: string | null;
  replyToSenderName?: string | null;
  replyToType?: string | null;
  mentionsJson?: string | null;
  deviceId: string;
  clientSequence: number;
  /** Sticker / poll messages (text holds the fallback). */
  type?: 'text' | 'sticker' | 'poll';
  payloadJson?: string | null;
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
       reply_to_message_id, reply_to_preview, reply_to_sender_uid, reply_to_sender_name, reply_to_type,
       mentions_json, forwarded, forwarded_from_message_id,
       status, error_code, error_message, sync_status, client_sequence, server_version, payload_json)
     VALUES (?,?,NULL,?,?,?, ?, ?, ?, ?, NULL, ?, NULL, 0, 0, NULL, ?, ?, ?, ?, ?, ?, 0, NULL, 'pending', NULL, NULL, 'pending', ?, 0, ?)`,
    [
      id, id, m.conversationId, m.senderUid, m.senderDisplayName ?? null, m.type ?? 'text', m.text, preview,
      now, now, m.replyToMessageId ?? null, m.replyToPreview ?? null,
      m.replyToSenderUid ?? null, m.replyToSenderName ?? null, m.replyToType ?? null,
      m.mentionsJson ?? null, m.clientSequence, m.payloadJson ?? null,
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

/** Phase 23 — mark a media upload failed (keeps the row for retry). Records the
 *  failure code/message so the cause (e.g. storage/unauthorized, wrong bucket)
 *  is recoverable instead of a silent retry arrow. */
export async function setMediaFailed(
  localId: string,
  error?: { code?: string | null; message?: string | null },
): Promise<void> {
  await getDb().run(
    `UPDATE messages SET media_upload_status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE local_id = ?`,
    [error?.code ?? null, error?.message ?? null, Date.now(), localId],
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
  const db = getDb();
  // The canonical server message may already be in the table — the realtime feed
  // can land it (keyed by remote_id) before the outbox reconciles the optimistic
  // row. Forcing remote_id onto the local row would then violate the UNIQUE
  // constraint on messages.remote_id, fail the outbox item, and make it re-send
  // (duplicate) forever. If a *different* row already owns this remote_id, the
  // optimistic row is a duplicate → drop it and let the canonical row stand.
  const existing = await db.first<{ local_id: string }>(
    `SELECT local_id FROM messages WHERE remote_id = ?`, [remote.remoteId],
  );
  if (existing && existing.local_id !== localId) {
    await db.run(`DELETE FROM messages WHERE local_id = ?`, [localId]);
    return;
  }
  await db.run(
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

export interface RemoteMessageInput {
  remoteId: string; conversationId: string; senderUid: string; senderDisplayName?: string | null;
  type?: 'text' | 'image' | 'voice' | 'sticker' | 'poll'; caption?: string | null;
  /** Sticker / poll payload JSON; undefined = leave as is. */
  payload?: string | null;
  text: string | null; remoteCreatedAt: number | null; editedAt?: number | null;
  deletedForEveryone?: boolean; replyToMessageId?: string | null; replyToPreview?: string | null;
  replyToSenderUid?: string | null; replyToSenderName?: string | null; replyToType?: string | null;
  mentions?: Array<{ userId: string; displayName: string; startIndex: number; endIndex: number }> | null;
  forwarded?: boolean; serverVersion?: number; status?: MessageStatus;
  reactions?: Record<string, string[]> | null; counts?: RemoteReceiptCounts;
  media?: RemoteMediaInput | null;
  /** The sender's optimistic local id (server field `clientLocalId`). */
  clientLocalId?: string | null;
}

/**
 * Apply a batch of remote messages in ONE transaction (realtime snapshot
 * changes, catch-up pages, a notification's target message). On a device each
 * statement is a native round-trip and each autocommit a WAL commit, so batching
 * is what keeps applying a snapshot off the user's critical path. Deleted-for-
 * everyone messages are tombstoned in the same transaction.
 */
export async function applyRemoteMessages(batch: RemoteMessageInput[]): Promise<void> {
  if (batch.length === 0) return;
  const database = getDb();
  await database.transaction(async tx => {
    for (const r of batch) {
      // A deleted-for-everyone message keeps its row (it renders as "deleted"
      // in place, preserving order) but never keeps its content.
      if (r.deletedForEveryone) await upsertRemoteMessage({ ...r, text: null, caption: null, media: null, payload: null }, tx);
      else await upsertRemoteMessage(r, tx);
    }
  });
  for (const id of new Set(batch.map(r => r.conversationId))) emitLocalMessagesChanged(id);
}

export async function upsertRemoteMessage(r: RemoteMessageInput, database: LocalDatabase = getDb()): Promise<void> {
  const find = () => database.first<MessageRow>('SELECT * FROM messages WHERE remote_id = ? LIMIT 1', [r.remoteId]);
  let existing = await find();
  if (!existing && r.clientLocalId) {
    // Our own message, delivered by the realtime feed before the send call
    // returned: adopt the optimistic row instead of inserting a second copy
    // (it used to show twice until the outbox reconciled it).
    await database.run(
      `UPDATE messages SET remote_id = ? WHERE local_id = ? AND conversation_id = ? AND remote_id IS NULL`,
      [r.remoteId, r.clientLocalId, r.conversationId],
    );
    existing = await find();
  }
  const now = Date.now();
  const reactionsJson = r.reactions != null ? JSON.stringify(r.reactions) : null;
  const mentionsJson = r.mentions != null ? JSON.stringify(r.mentions) : null;
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
      'reply_to_sender_uid = ?', 'reply_to_sender_name = ?', 'reply_to_type = ?',
      'forwarded = ?', 'status = COALESCE(?, status)', "sync_status = 'synced'",
      'server_version = COALESCE(?, server_version)', 'updated_at = ?',
    ];
    const params: any[] = [
      r.type ?? null, r.caption ?? null, r.text, r.senderDisplayName ?? null, r.remoteCreatedAt, r.editedAt ?? null,
      r.deletedForEveryone ? 1 : 0, r.replyToMessageId ?? null, r.replyToPreview ?? null,
      r.replyToSenderUid ?? null, r.replyToSenderName ?? null, r.replyToType ?? null,
      r.forwarded ? 1 : 0, r.status ?? null, r.serverVersion ?? null, now,
    ];
    if (r.reactions !== undefined) { sets.push('reactions_json = ?'); params.push(reactionsJson); }
    if (r.mentions !== undefined) { sets.push('mentions_json = ?'); params.push(mentionsJson); }
    if (r.payload !== undefined) { sets.push('payload_json = ?'); params.push(r.payload); }
    if (r.counts !== undefined) {
      sets.push('delivered_count = ?', 'read_count = ?', 'viewed_count = ?', 'played_count = ?');
      params.push(c.delivered ?? 0, c.read ?? 0, c.viewed ?? 0, c.played ?? 0);
    }
    if (r.media !== undefined) {
      // Keep a known URL across snapshots that omit it — except when the
      // message was deleted for everyone: then nothing of the media may stay.
      const keep = r.deletedForEveryone ? '' : 'COALESCE(?, media_download_url)';
      const keepThumb = r.deletedForEveryone ? '' : 'COALESCE(?, media_thumb_url)';
      sets.push(
        'media_mime = ?', 'media_size = ?', 'media_width = ?', 'media_height = ?',
        'media_duration_ms = ?', 'media_waveform = ?', 'media_storage_path = ?',
        `media_download_url = ${keep || '?'}`, 'media_thumb_path = ?',
        `media_thumb_url = ${keepThumb || '?'}`, 'media_upload_status = ?',
      );
      params.push(
        md?.mimeType ?? null, md?.sizeBytes ?? null, md?.width ?? null, md?.height ?? null,
        md?.durationMs ?? null, waveformJson, md?.storagePath ?? null,
        md?.downloadURL ?? null, md?.thumbnailPath ?? null, md?.thumbnailURL ?? null,
        md?.uploadStatus ?? null,
      );
    }
    params.push(r.remoteId);
    await database.run(`UPDATE messages SET ${sets.join(', ')} WHERE remote_id = ?`, params);
  } else {
    await database.run(
      `INSERT INTO messages
        (id, local_id, remote_id, conversation_id, sender_uid, sender_display_name, type, text, preview, caption,
         created_at, remote_created_at, updated_at, edited_at, deleted_for_everyone, deleted_for_me, deleted_at,
         reply_to_message_id, reply_to_preview, reply_to_sender_uid, reply_to_sender_name, reply_to_type,
         mentions_json, forwarded, forwarded_from_message_id,
         status, error_code, error_message, sync_status, client_sequence, server_version,
         reactions_json, delivered_count, read_count, viewed_count, played_count,
         media_mime, media_size, media_width, media_height, media_duration_ms, media_waveform,
         media_storage_path, media_download_url, media_thumb_path, media_thumb_url, media_upload_status, payload_json)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'synced', 0, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.remoteId, r.remoteId, r.conversationId, r.senderUid, r.senderDisplayName ?? null,
        type, r.text, (r.text ?? '').slice(0, 200), r.caption ?? null,
        r.remoteCreatedAt ?? now, r.remoteCreatedAt ?? now, now,
        r.editedAt ?? null, r.deletedForEveryone ? 1 : 0, r.replyToMessageId ?? null, r.replyToPreview ?? null,
        r.replyToSenderUid ?? null, r.replyToSenderName ?? null, r.replyToType ?? null,
        mentionsJson,
        r.forwarded ? 1 : 0, r.status ?? 'sent', r.serverVersion ?? 0,
        reactionsJson, c.delivered ?? 0, c.read ?? 0, c.viewed ?? 0, c.played ?? 0,
        md?.mimeType ?? null, md?.sizeBytes ?? null, md?.width ?? null, md?.height ?? null,
        md?.durationMs ?? null, waveformJson, md?.storagePath ?? null, md?.downloadURL ?? null,
        md?.thumbnailPath ?? null, md?.thumbnailURL ?? null, md?.uploadStatus ?? null,
        r.payload ?? null,
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

/** Optimistic local poll vote: rewrite this message's payload (the next
 *  snapshot from the server replaces it with the authoritative tally). */
export async function setPayload(remoteOrLocalId: string, payloadJson: string | null): Promise<void> {
  await getDb().run(
    `UPDATE messages SET payload_json = ?, updated_at = ? WHERE remote_id = ? OR local_id = ?`,
    [payloadJson, Date.now(), remoteOrLocalId, remoteOrLocalId],
  );
}

export async function getPayload(remoteOrLocalId: string): Promise<string | null> {
  const r = await getDb().first<{ payload_json: string | null }>(
    `SELECT payload_json FROM messages WHERE remote_id = ? OR local_id = ?`, [remoteOrLocalId, remoteOrLocalId],
  );
  return r?.payload_json ?? null;
}


/** Server-confirmed close; preserve votes that may have arrived during the call. */
export async function confirmPollClosed(messageId: string): Promise<void> {
  await getDb().run(`UPDATE messages SET payload_json = json_set(payload_json, '$.closed', json('true')), updated_at = ?
    WHERE remote_id = ? AND type = 'poll' AND json_valid(payload_json)`, [Date.now(), messageId]);
}
