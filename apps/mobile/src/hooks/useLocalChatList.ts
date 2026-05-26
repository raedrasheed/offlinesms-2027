// Phase 22B — local-first chat list hook (flag-gated).
//
// When LOCAL_FIRST_CHAT_LIST_ENABLED is on, opens the per-user SQLite DB, starts
// the Firestore→local feeder, and serves the chat list from the local DB. If
// the local DB can't initialise it reports `firestoreFallback` so ChatsList can
// keep using the legacy Firestore path. When the flag is off it is a no-op.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LOCAL_FIRST_CHAT_LIST_ENABLED } from '../config/features';
import { openLocalDb, conversationsRepo } from '../localdb';
import { startChatListFeeder } from '../localdb/sync/chatListFeeder';
import { mapConversationRow, ChatListItem } from './chatListModel';

export type ChatListSource = 'disabled' | 'local' | 'firestoreFallback';

export interface LocalChatList {
  items: ChatListItem[];
  loading: boolean;
  error: string | null;
  source: ChatListSource;
  refresh: () => void;
}

export function useLocalChatList(uid: string | undefined): LocalChatList {
  const enabled = LOCAL_FIRST_CHAT_LIST_ENABLED && !!uid;
  const [items, setItems] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ChatListSource>(enabled ? 'local' : 'disabled');
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || refreshing.current) return;
    refreshing.current = true;
    try {
      const rows = await conversationsRepo.listConversations({ includeArchived: false });
      setItems(rows.map(mapConversationRow));
      setSource('local');
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'local-read-failed');
      setSource('firestoreFallback');
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !uid) { setLoading(false); setSource('disabled'); return; }
    let stopFeeder: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        await openLocalDb(uid);
        if (cancelled) return;
        await refresh();
        // Feeder upserts remote changes into the local DB and pings refresh.
        stopFeeder = startChatListFeeder(uid, () => { void refresh(); });
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? 'local-init-failed');
        setSource('firestoreFallback');
        setLoading(false);
      }
    })();

    return () => { cancelled = true; stopFeeder?.(); };
  }, [enabled, uid, refresh]);

  return { items, loading, error, source, refresh: () => { void refresh(); } };
}
