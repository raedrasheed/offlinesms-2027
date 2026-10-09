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
import { upsertRemoteConversation, applyUserState, applyRemoteConversations } from '../repositories/conversationsRepo';

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

  // Serialize applies so snapshots commit in order, and only notify the UI
  // after the write committed (it used to fire onChange before the un-awaited
  // upserts ran, so the re-read could miss the change).
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  const notify = () => { if (!stopped) onChange(); };

  const unsubConvos = onSnapshot(convQuery, (snap) => {
    const present = new Set<string>();
    snap.forEach((d) => { present.add(d.id); });

    // Only conversations that actually changed (Firestore re-delivers the whole
    // 50-row window on every snapshot).
    const changed = snap.docChanges().filter(ch => ch.type !== 'removed').map(ch => ch.doc);
    const batch = changed.map((d) => {
      const c = d.data() as any;
      const isGroup = c.type === 'group';
      return {
        id: d.id,
        remote_id: d.id,
        type: isGroup ? 'group' as const : 'direct' as const,
        title: isGroup ? (c.name ?? null) : null, // direct peer name resolved below
        // Groups carry their own avatar (Firestore `avatarUrl`); direct chats get
        // avatar_url from the peer-profile resolution step below.
        avatar_url: isGroup ? (c.avatarUrl ?? null) : null,
        owner_uid: c.ownerUid ?? null,
        status: c.status ?? 'active',
        member_count: c.memberCount ?? 0,
        pinned_message_id: c.pinnedMessage?.messageId ?? null,
        last_message_preview: c.lastMessageText ?? null,
        last_message_at: ms(c.updatedAt),
        remote_updated_at: ms(c.updatedAt),
      };
    });
    if (batch.length > 0) chain = chain.then(() => applyRemoteConversations(batch)).then(notify).catch(() => {});

    snap.forEach((d) => {
      const c = d.data() as any;
      const isGroup = c.type === 'group';

      // Resolve the direct-chat peer display name once and store it as title.
      if (!isGroup && !resolvedTitles.has(d.id)) {
        const peerUid: string | undefined = (c.participantUids ?? []).find((u: string) => u !== uid);
        if (peerUid) {
          resolvedTitles.add(d.id);
          void getDoc(doc(db, 'users', peerUid)).then((u) => {
            const data = u.data() as { displayName?: string; username?: string; photoURL?: string | null } | undefined;
            const name = data?.displayName || (data?.username ? `@${data.username}` : peerUid.slice(0, 6));
            chain = chain.then(() => upsertRemoteConversation({ id: d.id, title: name, avatar_url: data?.photoURL ?? null })).then(notify).catch(() => {});
          }).catch(() => { resolvedTitles.delete(d.id); });
        }
      }

      // Per-user state listener (unread/pinned/muted/favorite/archived).
      if (!userStateUnsubs.has(d.id)) {
        const u = onSnapshot(doc(db, 'conversations', d.id, 'userState', uid), (us) => {
          const s = (us.data() ?? {}) as any;
          chain = chain.then(() => applyUserState(d.id, {
            unread_count: s.unreadCount ?? 0,
            muted: s.muted ? 1 : 0,
            pinned: s.pinned ? 1 : 0,
            favorite: s.favorite ? 1 : 0,
            archived: s.archived ? 1 : 0,
          })).then(notify).catch(() => {});
        });
        userStateUnsubs.set(d.id, u);
      }
    });

    // Drop userState listeners for conversations no longer present.
    for (const [id, unsub] of userStateUnsubs) {
      if (!present.has(id)) { try { unsub(); } catch { /* noop */ } userStateUnsubs.delete(id); }
    }

    if (batch.length === 0) notify();
  }, (err) => {
    // Surface only the error code; never message content.
    // eslint-disable-next-line no-console
    console.warn('chatListFeeder error:', (err as any)?.code ?? 'unknown');
  });

  return () => {
    stopped = true;
    try { unsubConvos(); } catch { /* noop */ }
    for (const unsub of userStateUnsubs.values()) { try { unsub(); } catch { /* noop */ } }
    userStateUnsubs.clear();
  };
}
