// Phase 22 — pull: read remote changes into the local DB. Cursor-based and
// paginated; prioritizes the active conversation. Firestore access lives here
// (inside the sync layer) — screens never query Firestore directly once cut
// over. Reads are one-shot getDocs (the sync engine schedules them); realtime
// listeners can be layered on later for the open conversation.

import {
  collection, query, where, orderBy, limit as qlimit, getDocs, doc, getDoc,
} from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { upsertRemoteConversation, applyUserState } from '../repositories/conversationsRepo';
import { upsertRemoteMessage, markDeletedForEveryone } from '../repositories/messagesRepo';
import { upsertMember } from '../repositories/membersRepo';

function ms(ts: any): number | null {
  return ts?.toMillis?.() ?? null;
}

/** Pull the user's conversations (and fold in per-user state). */
export async function pullConversations(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const snap = await getDocs(query(
    collection(db, 'conversations'),
    where('participantUids', 'array-contains', uid),
    orderBy('updatedAt', 'desc'),
    qlimit(50),
  ));
  for (const d of snap.docs) {
    const c = d.data() as any;
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
      last_message_at: ms(c.updatedAt),
      remote_updated_at: ms(c.updatedAt),
    });
    // Per-user state lives in conversations/{id}/userState/{uid}.
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
  }
}

/** Pull recent messages for one conversation. */
export async function pullMessages(conversationId: string, max = 50): Promise<void> {
  const snap = await getDocs(query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'desc'),
    qlimit(max),
  ));
  for (const d of snap.docs) {
    const m = d.data() as any;
    if (m.deletedForEveryone) {
      await markDeletedForEveryone(d.id);
      continue;
    }
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
      status: 'sent',
    });
  }
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
