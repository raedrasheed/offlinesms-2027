// Phase 22B — Firestore → local chat-list feeder.
//
// When the local-first chat list is enabled, the UI does NOT subscribe to
// Firestore directly. This feeder owns the listeners: it upserts conversation
// docs and per-user state into the local SQLite DB (the UI's source of truth)
// and pings `onChange` so the hook re-reads. Logs only safe metadata (ids /
// counts) — never message text or phone numbers.

import {
  collection, query, where, orderBy, limit as qlimit, onSnapshot, doc, getDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { upsertRemoteConversation, applyUserState } from '../repositories/conversationsRepo';

function ms(ts: any): number | null {
  return ts?.toMillis?.() ?? null;
}

/**
 * Start feeding the current user's conversations into the local DB.
 * Returns an unsubscribe that tears down all listeners.
 */
export function startChatListFeeder(uid: string, onChange: () => void): () => void {
  const userStateUnsubs = new Map<string, () => void>();
  const resolvedTitles = new Set<string>(); // conversations whose peer name we've already resolved

  const convQuery = query(
    collection(db, 'conversations'),
    where('participantUids', 'array-contains', uid),
    orderBy('updatedAt', 'desc'),
    qlimit(50),
  );

  const unsubConvos = onSnapshot(convQuery, (snap) => {
    const present = new Set<string>();
    snap.forEach((d) => {
      present.add(d.id);
      const c = d.data() as any;
      const isGroup = c.type === 'group';

      void upsertRemoteConversation({
        id: d.id,
        remote_id: d.id,
        type: isGroup ? 'group' : 'direct',
        title: isGroup ? (c.name ?? null) : null, // direct peer name resolved below
        owner_uid: c.ownerUid ?? null,
        status: c.status ?? 'active',
        member_count: c.memberCount ?? 0,
        pinned_message_id: c.pinnedMessage?.messageId ?? null,
        last_message_preview: c.lastMessageText ?? null,
        last_message_at: ms(c.updatedAt),
        remote_updated_at: ms(c.updatedAt),
      });

      // Resolve the direct-chat peer display name once and store it as title.
      if (!isGroup && !resolvedTitles.has(d.id)) {
        const peerUid: string | undefined = (c.participantUids ?? []).find((u: string) => u !== uid);
        if (peerUid) {
          resolvedTitles.add(d.id);
          void getDoc(doc(db, 'users', peerUid)).then((u) => {
            const data = u.data() as { displayName?: string; username?: string; photoURL?: string | null } | undefined;
            const name = data?.displayName || (data?.username ? `@${data.username}` : peerUid.slice(0, 6));
            void upsertRemoteConversation({ id: d.id, title: name, avatar_url: data?.photoURL ?? null }).then(onChange);
          }).catch(() => { resolvedTitles.delete(d.id); });
        }
      }

      // Per-user state listener (unread/pinned/muted/favorite/archived).
      if (!userStateUnsubs.has(d.id)) {
        const u = onSnapshot(doc(db, 'conversations', d.id, 'userState', uid), (us) => {
          const s = (us.data() ?? {}) as any;
          void applyUserState(d.id, {
            unread_count: s.unreadCount ?? 0,
            muted: s.muted ? 1 : 0,
            pinned: s.pinned ? 1 : 0,
            favorite: s.favorite ? 1 : 0,
            archived: s.archived ? 1 : 0,
          }).then(onChange);
        });
        userStateUnsubs.set(d.id, u);
      }
    });

    // Drop userState listeners for conversations no longer present.
    for (const [id, unsub] of userStateUnsubs) {
      if (!present.has(id)) { try { unsub(); } catch { /* noop */ } userStateUnsubs.delete(id); }
    }

    onChange();
  }, (err) => {
    // Surface only the error code; never message content.
    // eslint-disable-next-line no-console
    console.warn('chatListFeeder error:', (err as any)?.code ?? 'unknown');
  });

  return () => {
    try { unsubConvos(); } catch { /* noop */ }
    for (const unsub of userStateUnsubs.values()) { try { unsub(); } catch { /* noop */ } }
    userStateUnsubs.clear();
  };
}
