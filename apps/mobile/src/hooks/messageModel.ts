// Phase 22C — pure message view-model: maps a local MessageRow to the `Message`
// shape MessageBubble/Conversation render, and orders messages chronologically.
// No native/db imports (type-only), so it runs under the node test harness.
//
// Known limitation (deferred to a later sub-phase): the local schema does not
// yet carry reactions, receipt aggregate counts, senderPhotoURL, or the
// replyTo sender snapshot, so those map to undefined/null in local mode.

import type { MessageRow } from '../localdb/types';
import type { Message } from '../lib/conversations';
import { tsLike } from './chatListModel';

/** Effective ordering time: canonical server time when known, else local. */
export function effectiveTimeMs(row: Pick<MessageRow, 'remote_created_at' | 'created_at'>): number {
  return row.remote_created_at ?? row.created_at ?? 0;
}

function mapStatus(s: MessageRow['status']): Message['status'] {
  return s === 'pending' ? 'sending' : s;
}

function parseReactions(json: string | null): Record<string, string[]> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : null;
  } catch {
    return null;
  }
}

function parseWaveform(json: string | null | undefined): number[] | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? p.filter((n) => typeof n === 'number') : null;
  } catch {
    return null;
  }
}

function mapMedia(row: MessageRow): Message['media'] {
  if (row.type !== 'image' && row.type !== 'voice') return null;
  return {
    storagePath: row.media_storage_path ?? '',
    downloadURL: row.media_download_url ?? null,
    mimeType: row.media_mime ?? '',
    sizeBytes: row.media_size ?? 0,
    width: row.media_width ?? null,
    height: row.media_height ?? null,
    durationMs: row.media_duration_ms ?? null,
    waveform: parseWaveform(row.media_waveform),
    thumbnailPath: row.media_thumb_path ?? null,
    thumbnailURL: row.media_thumb_url ?? null,
    uploadStatus: (row.media_upload_status ?? 'uploaded') as NonNullable<Message['media']>['uploadStatus'],
    uploadProgress: row.media_upload_progress ?? 0,
    localUri: row.media_local_uri ?? null,
  };
}

export function mapMessageRow(row: MessageRow): Message {
  const at = tsLike(effectiveTimeMs(row));
  return {
    // Prefer the canonical remote id (needed for server-side actions); fall
    // back to the local id for still-pending messages.
    id: row.remote_id ?? row.local_id ?? row.id,
    conversationId: row.conversation_id,
    senderUid: row.sender_uid,
    type: row.type,
    text: row.text ?? undefined,
    caption: row.caption ?? undefined,
    media: mapMedia(row),
    status: mapStatus(row.status),
    deletedForEveryone: row.deleted_for_everyone === 1,
    editedAt: row.edited_at != null ? tsLike(row.edited_at) : null,
    replyTo: row.reply_to_message_id
      ? {
          messageId: row.reply_to_message_id,
          senderUid: '',
          senderDisplayName: '',
          preview: row.reply_to_preview ?? '',
          type: 'text',
          createdAt: null,
        }
      : null,
    forwarded: row.forwarded === 1,
    reactions: parseReactions(row.reactions_json),
    createdAt: at,
    senderDisplayName: row.sender_display_name,
    deliveredCount: row.delivered_count ?? 0,
    readCount: row.read_count ?? 0,
    viewedCount: row.viewed_count ?? 0,
    playedCount: row.played_count ?? 0,
  } as Message;
}

/** Map + sort ascending by effective time (the order the chat list renders). */
export function mapAndOrderMessages(rows: MessageRow[]): Message[] {
  return [...rows]
    .sort((a, b) => effectiveTimeMs(a) - effectiveTimeMs(b))
    .map(mapMessageRow);
}
