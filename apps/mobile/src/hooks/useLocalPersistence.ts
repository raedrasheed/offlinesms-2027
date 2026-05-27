// Background local persistence — keeps the on-device SQLite DB populated with
// the user's chats and messages regardless of the local-first UI flags. The UI
// still renders from Firebase (unless a local-first flag is on); these feeders
// just mirror remote data into SQLite so it's available offline and reflected
// in the storage counters. Best-effort: failures are swallowed so they never
// affect the live Firebase UI.

import { useEffect } from 'react';
import { LOCAL_FIRST_CHAT_LIST_ENABLED, LOCAL_FIRST_CONVERSATION_ENABLED } from '../config/features';
import { openLocalDb } from '../localdb';
import { startChatListFeeder } from '../localdb/sync/chatListFeeder';
import { startConversationFeeder } from '../localdb/sync/conversationFeeder';

/**
 * Persist the signed-in user's conversation list into the local DB for the
 * whole session. Skipped when the local-first chat list is enabled, since
 * useLocalChatList already runs the same feeder.
 */
export function useChatListPersistence(uid: string | undefined): void {
  const active = !LOCAL_FIRST_CHAT_LIST_ENABLED && !!uid;
  useEffect(() => {
    if (!active || !uid) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        await openLocalDb(uid);
        if (cancelled) return;
        stop = startChatListFeeder(uid, () => { /* persistence only */ });
      } catch { /* best-effort: never disrupt the live UI */ }
    })();
    return () => { cancelled = true; stop?.(); };
  }, [active, uid]);
}

/**
 * Persist the open conversation's messages into the local DB. Skipped when the
 * local-first conversation UI is enabled, since useLocalConversation already
 * runs the feeder.
 */
export function useMessagePersistence(conversationId: string | undefined, uid: string | undefined): void {
  const active = !LOCAL_FIRST_CONVERSATION_ENABLED && !!conversationId && !!uid;
  useEffect(() => {
    if (!active || !conversationId || !uid) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        await openLocalDb(uid);
        if (cancelled) return;
        stop = startConversationFeeder(conversationId, () => { /* persistence only */ });
      } catch { /* best-effort: never disrupt the live UI */ }
    })();
    return () => { cancelled = true; stop?.(); };
  }, [active, conversationId, uid]);
}
