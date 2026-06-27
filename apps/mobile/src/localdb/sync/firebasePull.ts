// Phase 22 — pull: read remote changes into the local DB. Cursor-based and
// incremental; prioritizes the active conversation. Firestore access lives here
// (inside the sync layer) — screens never query Firestore directly once cut
// over. Reads are one-shot getDocs (the sync engine schedules them) and use
// per-collection high-water marks so each run only fetches what changed since
// the last pull. Realtime feeders own live updates for the open conversation
// (including edits/deletes), so this catch-up path can key on createdAt safely.

import {
  collection, query, where, orderBy, limit as qlimit, getDocs, doc, getDoc, Timestamp,
} from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { upsertRemoteConversation, applyUserState } from '../repositories/conversationsRepo';
import { upsertRemoteMessage, markDeletedForEveryone } from '../repositories/messagesRepo';
import { upsertMember } from '../repositories/membersRepo';
import { getCursor, setCursor } from '../repositories/syncStateRepo';

const CONV_PAGE = 50;
const MSG_PAGE = 50;

function ms(ts: any): number | null {
  return ts?.toMillis?.() ?? null;
}

/**
 * Pull conversations changed since the last pull (and fold in per-user state).
 * Incremental: queries `updatedAt > cursor` ascending and advances the
 * `last_conversations_pull_at` high-water mark to the newest doc seen, so steady
 * state fetches only what changed instead of re-reading the whole list.
 */
export async function pullConversations(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const since = await getCursor('last_conversations_pull_at');
  // `>=` (not `>`) so docs sharing the boundary millisecond aren't skipped when
  // a page truncates at the limit; re-processing the boundary doc is idempotent.
  const snap = await getDocs(query(
    collection(db, 'conversations'),
    where('participantUids', 'array-contains', uid),
    where('updatedAt', '>=', Timestamp.fromMillis(since)),
    orderBy('updatedAt', 'asc'),
    qlimit(CONV_PAGE),
  ));
  let maxTs = since;
  // Per-conversation userState lives in a sibling doc; fetch them in parallel
  // rather than serially (a cold-start page can be up to CONV_PAGE round-trips).
  await Promise.all(snap.docs.map(async (d) => {
    const c = d.data() as any;
    const updatedMs = ms(c.updatedAt);
    if (updatedMs != null && updatedMs > maxTs) maxTs = updatedMs;
    await upsertRemoteConversation({
      id: d.id,
      remote_id: d.id,
      type: c.type === 'group' ? 'group' : 'direct',
      title: c.name ?? null,
      owner_uid: c.ownerUid ?? null,
      status: c.status ?? 'active',
      member_count: c.memberCount ?? 0,
      pinned_message_id: c.pinnedMessage?.messageId ?? null,
      last_message_preview: c.lastMessageText ?? null,
      last_message_at: updatedMs,
      remote_updated_at: updatedMs,
    });
    try {
      const us = await getDoc(doc(db, 'conversations', d.id, 'userState', uid));
      if (us.exists()) {
        const s = us.data() as any;
        await applyUserState(d.id, {
          unread_count: s.unreadCount ?? 0,
          muted: s.muted ? 1 : 0,
          pinned: s.pinned ? 1 : 0,
          favorite: s.favorite ? 1 : 0,
          archived: s.archived ? 1 : 0,
        });
      }
    } catch { /* best-effort */ }
  }));
  if (maxTs > since) await setCursor('last_conversations_pull_at', maxTs);
}

/**
 * Pull messages for one conversation created since the last pull. Incremental:
 * queries `createdAt >= cursor` ascending and advances a per-conversation
 * high-water mark (`msg_cursor:<id>`). Maps reactions + receipt counts (same as
 * the realtime feeder) so the catch-up path keeps them consistent. Edits/deletes
 * of older messages are reconciled by the feeder when the chat is opened.
 */
export async function pullMessages(conversationId: string, max = MSG_PAGE): Promise<void> {
  const cursorKey: `msg_cursor:${string}` = `msg_cursor:${conversationId}`;
  const since = await getCursor(cursorKey);
  // `>=` so messages sharing the boundary millisecond aren't dropped when a page
  // truncates at the limit; the upsert is idempotent so re-processing is safe.
  const snap = await getDocs(query(
    collection(db, 'conversations', conversationId, 'messages'),
    where('createdAt', '>=', Timestamp.fromMillis(since)),
    orderBy('createdAt', 'asc'),
    qlimit(max),
  ));
  let maxTs = since;
  for (const d of snap.docs) {
    const m = d.data() as any;
    const createdMs = ms(m.createdAt);
    if (createdMs != null && createdMs > maxTs) maxTs = createdMs;
    if (m.deletedForEveryone) {
      await markDeletedForEveryone(d.id);
      continue;
    }
    await upsertRemoteMessage({
      remoteId: d.id,
      conversationId,
      senderUid: m.senderUid ?? m.senderId ?? '',
      senderDisplayName: m.senderDisplayName ?? null,
      type: m.type ?? 'text',
      caption: m.caption ?? null,
      text: m.text ?? null,
      remoteCreatedAt: createdMs,
      editedAt: ms(m.editedAt),
      deletedForEveryone: !!m.deletedForEveryone,
      replyToMessageId: m.replyTo?.messageId ?? null,
      replyToPreview: m.replyTo?.preview ?? null,
      forwarded: !!m.forwarded,
      reactions: m.reactions ?? null,
      counts: {
        delivered: m.deliveredCount ?? 0,
        read: m.readCount ?? 0,
        viewed: m.viewedCount ?? 0,
        played: m.playedCount ?? 0,
      },
      media: m.media ? {
        mimeType: m.media.mimeType ?? null,
        sizeBytes: m.media.sizeBytes ?? null,
        width: m.media.width ?? null,
        height: m.media.height ?? null,
        durationMs: m.media.durationMs ?? null,
        waveform: m.media.waveform ?? null,
        storagePath: m.media.storagePath ?? null,
        downloadURL: m.media.downloadURL ?? null,
        thumbnailPath: m.media.thumbnailPath ?? null,
        thumbnailURL: m.media.thumbnailURL ?? null,
        uploadStatus: m.media.uploadStatus ?? null,
      } : null,
      status: 'sent',
    });
  }
  if (maxTs > since) await setCursor(cursorKey, maxTs);
}

/**
 * Backfill older messages from Firestore (those created strictly before
 * `beforeMs`), for paging back through history that retention has evicted or
 * that the forward pull never reached. Does not move the forward cursor.
 * Returns how many docs were fetched (0 means no older history remains).
 *
 * `afterMs` (default 0) sets an exclusive lower bound: pass a "clear chat"
 * watermark so paging never crosses it and resurrects cleared history.
 */
export async function pullMessagesBefore(conversationId: string, beforeMs: number, afterMs = 0, max = MSG_PAGE): Promise<number> {
  const constraints = [
    where('createdAt', '<', Timestamp.fromMillis(beforeMs)),
    ...(afterMs > 0 ? [where('createdAt', '>', Timestamp.fromMillis(afterMs))] : []),
    orderBy('createdAt', 'desc'),
    qlimit(max),
  ];
  const snap = await getDocs(query(
    collection(db, 'conversations', conversationId, 'messages'),
    ...constraints,
  ));
  for (const d of snap.docs) {
    const m = d.data() as any;
    if (m.deletedForEveryone) { await markDeletedForEveryone(d.id); continue; }
    await upsertRemoteMessage({
      remoteId: d.id,
      conversationId,
      senderUid: m.senderUid ?? m.senderId ?? '',
      senderDisplayName: m.senderDisplayName ?? null,
      text: m.text ?? null,
      remoteCreatedAt: ms(m.createdAt),
      editedAt: ms(m.editedAt),
      deletedForEveryone: !!m.deletedForEveryone,
      replyToMessageId: m.replyTo?.messageId ?? null,
      replyToPreview: m.replyTo?.preview ?? null,
      forwarded: !!m.forwarded,
      reactions: m.reactions ?? null,
      counts: {
        delivered: m.deliveredCount ?? 0,
        read: m.readCount ?? 0,
        viewed: m.viewedCount ?? 0,
        played: m.playedCount ?? 0,
      },
      status: 'sent',
    });
  }
  return snap.size;
}

/** Pull group members for a conversation. */
export async function pullMembers(conversationId: string): Promise<void> {
  const snap = await getDocs(collection(db, 'conversations', conversationId, 'members'));
  for (const d of snap.docs) {
    const m = d.data() as any;
    await upsertMember({
      conversationId,
      uid: d.id,
      displayName: m.displayNameSnapshot ?? null,
      photoUrl: m.photoURLSnapshot ?? null,
      role: m.role ?? 'member',
      status: m.status ?? 'active',
      joinedAt: ms(m.joinedAt),
    });
  }
}
