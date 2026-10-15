// Phase 22B — local-first chat list hook (flag-gated).
//
// When LOCAL_FIRST_CHAT_LIST_ENABLED is on, opens the per-user SQLite DB, starts
// the Firestore→local feeder, and serves the chat list from the local DB. If
// the local DB can't initialise it reports `firestoreFallback` so ChatsList can
// keep using the legacy Firestore path. When the flag is off it is a no-op.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { coalescing } from '../lib/coalesce';
import { LOCAL_FIRST_CHAT_LIST_ENABLED } from '../config/features';
import { openLocalDb, conversationsRepo } from '../localdb';
import { startChatListFeeder } from '../localdb/sync/chatListFeeder';
import { createChatListMapper, ChatListItem } from './chatListModel';
import { startForegroundMessagePreload } from '../localdb/sync/foregroundMessagePreload';

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
  const { t } = useTranslation();
  const groupLabel = t('names.group');
  const directLabel = t('names.unknownUser');
  const preloadRef = useRef<ReturnType<typeof startForegroundMessagePreload> | null>(null);
  const lifecycle = useMemo(() => ({ active: false, generation: 0 }), [enabled, uid, groupLabel, directLabel]);
  // Coalesced (never dropped): a feeder change during a running refresh triggers
  // one more pass instead of being lost until the next unrelated change.
  const runner = useMemo(() => {
    if (!enabled) return null;
    const mapRows = createChatListMapper({ group: groupLabel, direct: directLabel });
    return coalescing(async () => {
      if (!lifecycle.active) return;
      const generation = lifecycle.generation;
      const current = () => lifecycle.active && lifecycle.generation === generation;
      try {
        const rows = await conversationsRepo.listConversations({ includeArchived: false });
        if (!current()) return;
        preloadRef.current?.update(rows);
        setItems(mapRows(rows));
        setSource('local');
        setError(null);
      } catch (e: any) {
        if (!current()) return;
        setError(e?.message ?? 'local-read-failed');
        setSource('firestoreFallback');
      } finally {
        if (current()) setLoading(false);
      }
    });
  }, [enabled, uid, groupLabel, directLabel, lifecycle]);
  const refresh = useCallback(async () => { await runner?.(); }, [runner]);

  useEffect(() => {
    if (!enabled || !uid) { setItems([]); setLoading(false); setSource('disabled'); return; }
    let stopFeeder: (() => void) | null = null;
    let cancelled = false;
    lifecycle.active = true;
    lifecycle.generation++;
    setItems([]); setLoading(true); setError(null);

    (async () => {
      try {
        await openLocalDb(uid);
        if (cancelled) return;
        preloadRef.current = startForegroundMessagePreload(uid);
        await refresh();
        if (cancelled) return;
        // Feeder upserts remote changes into the local DB and pings refresh.
        stopFeeder = startChatListFeeder(uid, () => { void refresh(); });
      } catch (e: any) {
        if (cancelled) return;
        preloadRef.current?.stop(); preloadRef.current = null;
        setError(e?.message ?? 'local-init-failed');
        setSource('firestoreFallback');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true; lifecycle.active = false; lifecycle.generation++;
      stopFeeder?.(); preloadRef.current?.stop(); preloadRef.current = null;
    };
  }, [enabled, uid, refresh, lifecycle]);

  const refreshVoid = useCallback(() => { void refresh(); }, [refresh]);
  return useMemo(() => ({ items, loading, error, source, refresh: refreshVoid }), [items, loading, error, source, refreshVoid]);
}
