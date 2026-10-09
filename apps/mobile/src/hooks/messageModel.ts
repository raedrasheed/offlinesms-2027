// Phase 22C — pure message view-model: maps a local MessageRow to the `Message`
// shape MessageBubble/Conversation render, and orders messages chronologically.
// No native/db imports (type-only), so it runs under the node test harness.
//
// Known limitation (deferred to a later sub-phase): the local schema does not
// yet carry reactions, receipt aggregate counts, senderPhotoURL, or the
// replyTo sender snapshot, so those map to undefined/null in local mode.

import { parseSticker, parsePoll } from '../lib/pollModel';
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

function parseMentions(json: string | null | undefined): Message['mentions'] {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (m) => m && typeof m.userId === 'string' && typeof m.startIndex === 'number' && typeof m.endIndex === 'number',
    );
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
  const poll = row.type === 'poll' ? parsePoll(row.payload_json) : null;
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
          senderUid: row.reply_to_sender_uid ?? '',
          senderDisplayName: row.reply_to_sender_name ?? '',
          preview: row.reply_to_preview ?? '',
          type: (row.reply_to_type as 'text' | 'image' | 'voice') ?? 'text',
          createdAt: null,
        }
      : null,
    mentions: parseMentions(row.mentions_json),
    forwarded: row.forwarded === 1,
    reactions: parseReactions(row.reactions_json),
    createdAt: at,
    senderDisplayName: row.sender_display_name,
    deliveredCount: row.delivered_count ?? 0,
    readCount: row.read_count ?? 0,
    viewedCount: row.viewed_count ?? 0,
    playedCount: row.played_count ?? 0,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    sticker: row.type === 'sticker' ? parseSticker(row.payload_json) : null,
    poll: poll && row.poll_close_status ? { ...poll,
      closingPending: !poll.closed && (row.poll_close_status === 'pending' || row.poll_close_status === 'processing'),
      closingFailed: !poll.closed && (row.poll_close_status === 'dead' || row.poll_close_status === 'failed'),
    } : poll,
  } as Message;
}

/** Map + sort ascending by effective time (the order the chat list renders). */
export function mapAndOrderMessages(rows: MessageRow[]): Message[] {
  return [...rows].sort(compareRows).map(mapMessageRow);
}

/** Deterministic chronological order: canonical time, then local creation
 *  time, then id — equal timestamps never swap places between refreshes. */
export function compareRows(a: MessageRow, b: MessageRow): number {
  return effectiveTimeMs(a) - effectiveTimeMs(b)
    || (a.created_at ?? 0) - (b.created_at ?? 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Every column the rendered message depends on. Two rows with the same key
 *  render identically, so the previous `Message` object can be reused. */
function rowKey(r: MessageRow): string {
  return [
    r.updated_at, r.remote_id, r.status, r.sync_status, r.text, r.caption, r.type,
    r.deleted_for_everyone, r.edited_at, r.reactions_json, r.mentions_json,
    r.delivered_count, r.read_count, r.viewed_count, r.played_count,
    r.media_upload_status, r.media_upload_progress, r.media_download_url, r.media_thumb_url, r.media_local_uri,
    r.remote_created_at, r.error_code, r.sender_display_name, r.reply_to_message_id, r.reply_to_preview,
    r.payload_json, r.poll_close_status,
  ].join('\u0001');
}

/**
 * Structural-sharing mapper for one open conversation. Re-mapping every row on
 * every refresh produced brand-new `reactions` / `media` / `replyTo` objects,
 * which MessageBubble's memo compares by reference — so one incoming message
 * re-rendered every bubble that had reactions, media or a reply. Unchanged rows
 * now keep the identical `Message` object; only new or changed rows re-render.
 */
export function createMessageMapper() {
  let cache = new Map<string, { key: string; msg: Message }>();
  return function mapRows(rows: MessageRow[]): Message[] {
    const next = new Map<string, { key: string; msg: Message }>();
    const out = [...rows].sort(compareRows).map(r => {
      const k = rowKey(r);
      const hit = cache.get(r.id);
      const entry = hit && hit.key === k ? hit : { key: k, msg: mapMessageRow(r) };
      next.set(r.id, entry);
      return entry.msg;
    });
    cache = next;
    return out;
  };
}
