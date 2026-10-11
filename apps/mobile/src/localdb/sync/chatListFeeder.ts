// Phase 22B — Firestore → local chat-list feeder.
//
// When the local-first chat list is enabled, the UI does NOT subscribe to
// Firestore directly. This feeder owns the listeners: it upserts conversation
// docs and per-user state into the local SQLite DB (the UI's source of truth)
// and pings `onChange` so the hook re-reads. Logs only safe metadata (ids /
// counts) — never message text or phone numbers.

import {
  collection, query, where, orderBy, limit as qlimit, onSnapshot, doc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { profileStore } from '../../lib/userProfiles';
import { profileName } from '../../lib/displayNames.pure';
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
  // Direct-chat titles come from the shared profile resolver (batched, cached,
  // TTL-refreshed) and are re-written whenever the peer's name/photo changes —
  // a rename no longer leaves a stale title in SQLite. A uid is never stored as
  // a title: with no public name we store '' and the list shows the translated
  // "Unknown user" (this also clears legacy uid-fragment titles).
  const peerOf = new Map<string, string>();   // conversationId → peer uid
  const written = new Map<string, string>();  // conversationId → last title|photo written
  let profileUnsub: (() => void) | null = null;
  let profileKey = '';

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

  const writeTitle = (convId: string) => {
    const peer = peerOf.get(convId);
    const prof = peer ? profileStore.peek(peer) : undefined;
    if (!prof || stopped) return; // not loaded yet — the store notifies us
    const title = profileName(prof) ?? '';
    const sig = `${title}|${prof.photoURL ?? ''}`;
    if (written.get(convId) === sig) return;
    written.set(convId, sig);
    chain = chain
      .then(() => upsertRemoteConversation({ id: convId, title, avatar_url: prof.photoURL ?? null }))
      .then(notify)
      .catch(() => { written.delete(convId); });
  };
  const syncPeerProfiles = () => {
    const uids = [...new Set(peerOf.values())].sort();
    const key = uids.join(',');
    if (key !== profileKey) {
      profileKey = key;
      profileUnsub?.();
      profileUnsub = profileStore.subscribe(uids, () => { for (const id of peerOf.keys()) writeTitle(id); });
    }
    profileStore.request(uids); // fetches only missing/stale profiles, batched
    for (const id of peerOf.keys()) writeTitle(id);
  };

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

      // Track the direct-chat peer; its title is resolved by syncPeerProfiles.
      if (!isGroup) {
        const peerUid: string | undefined = (c.participantUids ?? []).find((u: string) => u !== uid);
        if (peerUid) peerOf.set(d.id, peerUid);
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
    for (const id of [...peerOf.keys()]) {
      if (!present.has(id)) { peerOf.delete(id); written.delete(id); }
    }
    syncPeerProfiles();

    if (batch.length === 0) notify();
  }, (err) => {
    // Surface only the error code; never message content.
    // eslint-disable-next-line no-console
    console.warn('chatListFeeder error:', (err as any)?.code ?? 'unknown');
  });

  return () => {
    stopped = true;
    try { unsubConvos(); } catch { /* noop */ }
    try { profileUnsub?.(); } catch { /* noop */ }
    for (const unsub of userStateUnsubs.values()) { try { unsub(); } catch { /* noop */ } }
    userStateUnsubs.clear();
  };
}
