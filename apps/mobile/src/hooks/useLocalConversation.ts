// Phase 22C — local-first conversation hook (flag-gated).
//
// When LOCAL_FIRST_CONVERSATION_ENABLED is on, opens the per-user DB and
// serves messages from it before starting sync housekeeping and
// legacy-queue migration, and attaches the Firestore→local message feeder.
// Falls back to `firestoreFallback`
// (the legacy Conversation path) if the local DB can't initialise. No-op when
// the flag is off.
//
// Responsiveness / notification fixes (docs/PERFORMANCE_AND_SYNC.md):
//   • refreshes are coalesced, never dropped — a feeder change that lands while
//     a refresh runs triggers one more pass (it used to be discarded, leaving a
//     just-notified message invisible until some later change);
//   • unchanged rows keep their `Message` object (structural sharing), so one
//     incoming message re-renders one bubble, not the whole list;
//   • a `focusMessageId` (from a notification) is fetched directly if it isn't
//     local yet, the window grows to include it, and its state is exposed so the
//     screen can show "loading this message" / "waiting for connection";
//   • the returned object and its callbacks are stable across renders.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOCAL_FIRST_CONVERSATION_ENABLED } from '../config/features';
import {
  openLocalDb, initLocalDb, messagesRepo, setActiveConversation, clearChat, getChatClearedAt,
  notificationTargets, type TargetState,
} from '../localdb';
import { startConversationFeeder } from '../localdb/sync/conversationFeeder';
import { pullMessageHistoryPage } from '../localdb/sync/firebasePull';
import { isOnline, onConnectivityChange } from '../localdb/sync/networkState';
import { importLegacyQueueOnce } from '../localdb/sync/legacyImport';
import { createMessageMapper } from './messageModel';
import { coalescing } from '../lib/coalesce';
import { openConversation } from './conversationOpen';
import { onLocalMessagesChanged } from '../localdb/messageChanges';
import type { Message } from '../lib/conversations';

export type ConversationSource = 'disabled' | 'local' | 'firestoreFallback';
/** 'connecting' until the realtime listener delivered server data at least once. */
export type LiveState = 'connecting' | 'live' | 'offline' | 'error';

export interface FocusState { messageId: string; state: TargetState | 'locating' }

// Initial messages shown when a chat opens, and the chunk size loaded each time
// the user scrolls up (see loadOlder).
const PAGE = 100;
// Extra rows kept around a focused (deep-linked) message for context.
const FOCUS_CONTEXT = 20;

export interface LocalConversation {
  messages: Message[];
  loading: boolean;
  source: ConversationSource;
  live: LiveState;
  focus: FocusState | null;
  refresh: () => void;
  loadOlder: () => void;
  clear: () => Promise<void>;
  retrySync: () => void;
}

export function useLocalConversation(
  conversationId: string | undefined,
  uid: string | undefined,
  focusMessageId?: string,
): LocalConversation {
  const enabled = LOCAL_FIRST_CONVERSATION_ENABLED && !!conversationId && !!uid;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [source, setSource] = useState<ConversationSource>(enabled ? 'local' : 'disabled');
  const [live, setLive] = useState<LiveState>(isOnline() ? 'connecting' : 'offline');
  const [focus, setFocus] = useState<FocusState | null>(focusMessageId ? { messageId: focusMessageId, state: 'locating' } : null);
  const limitRef = useRef(PAGE);
  const localCountRef = useRef(0);
  const clearedAtRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const reachedStartRef = useRef(false);
  const focusRef = useRef<string | undefined>(focusMessageId);
  const restartLiveRef = useRef<(() => void) | null>(null);
  focusRef.current = focusMessageId;

  // A separate lifecycle for each user/chat prevents a late SQLite result from
  // a previous screen from replacing this screen's messages. The generation
  // also covers an effect cleanup/restart with the same dependencies.
  const lifecycle = useMemo(() => ({ active: false, ready: false, generation: 0 }), [enabled, uid, conversationId]);

  // One mapper + one coalescing runner per open conversation.
  const runner = useMemo(() => {
    if (!enabled || !conversationId) return null;
    const mapRows = createMessageMapper();
    return coalescing(async () => {
      if (!lifecycle.active || !lifecycle.ready) return;
      const generation = lifecycle.generation;
      const current = () => lifecycle.active && lifecycle.generation === generation;
      try {
        const all = await messagesRepo.listMessages(conversationId, limitRef.current);
        if (!current()) return;
        // Hide messages whose SERVER time is at/older than the "cleared"
        // watermark. Rows without a server time yet (own pending sends) stay.
        const rows = clearedAtRef.current > 0
          ? all.filter(r => r.remote_created_at == null || r.remote_created_at > clearedAtRef.current)
          : all;
        localCountRef.current = rows.length;
        setMessages(mapRows(rows));
        setSource('local');
      } catch {
        if (current()) setSource('firestoreFallback');
      } finally {
        if (current()) setLoading(false);
      }
    });
  }, [enabled, conversationId, lifecycle]);

  const refresh = useCallback(() => { void runner?.(); }, [runner]);

  /** Grow the window so a focused message is rendered, then mark it found. */
  const revealFocus = useCallback(async (messageId: string): Promise<boolean> => {
    if (!conversationId || !runner || !lifecycle.active || !lifecycle.ready) return false;
    const generation = lifecycle.generation;
    const current = () => lifecycle.active && lifecycle.generation === generation;
    const pos = await messagesRepo.positionFromNewest(conversationId, messageId);
    if (pos == null || !current()) return false;
    if (pos + FOCUS_CONTEXT > limitRef.current) limitRef.current = pos + FOCUS_CONTEXT;
    await runner();
    if (current() && focusRef.current === messageId) setFocus({ messageId, state: 'ready' });
    return true;
  }, [conversationId, runner, lifecycle]);

  useEffect(() => {
    if (!enabled || !uid || !conversationId || !runner) { setLoading(false); setSource('disabled'); return; }
    let cancelled = false;
    lifecycle.active = true;
    lifecycle.ready = false;
    lifecycle.generation++;
    setLoading(true);
    setMessages([]);
    setSource('local');
    setLive(isOnline() ? 'connecting' : 'offline');
    limitRef.current = PAGE;
    reachedStartRef.current = false;

    const stopOpen = openConversation({
      openDb: () => openLocalDb(uid),
      readClearedAt: () => getChatClearedAt(conversationId),
      showLocal: async clearedAt => {
        clearedAtRef.current = clearedAt;
        lifecycle.ready = true;
        await runner();
      },
      startLive: () => {
        // Catch-up starts only after the saved messages have been read.
        setActiveConversation(conversationId);
        let stopFeeder: () => void = () => {};
        const restart = () => {
          if (cancelled) return;
          stopFeeder();
          setLive(isOnline() ? 'connecting' : 'offline');
          stopFeeder = startConversationFeeder(conversationId, (change) => {
            if (cancelled) return;
            if (!change.fromCache) setLive('live');
            // applyRemoteMessages emits the shared refresh after commit.
            const f = focusRef.current;
            if (f && change.ids.includes(f)) void revealFocus(f);
          }, () => { if (!cancelled) setLive(isOnline() ? 'error' : 'offline'); });
        };
        restartLiveRef.current = restart;
        restart();
        const stopTargets = notificationTargets.subscribe((c, m, state) => {
          if (cancelled || c !== conversationId || m !== focusRef.current) return;
          if (state === 'ready') void revealFocus(m);
          else setFocus({ messageId: m, state });
        });
        // Notification work is independent of background maintenance, including
        // the initial target (the later-focus effect may run before DB ready).
        const target = focusRef.current;
        if (target) void (async () => {
          if (await revealFocus(target)) return;
          if (cancelled || focusRef.current !== target) return;
          const state = await notificationTargets.request(conversationId, target);
          if (cancelled || focusRef.current !== target) return;
          if (state === 'ready') await revealFocus(target);
          else setFocus({ messageId: target, state });
        })().catch(() => {
          if (!cancelled && focusRef.current === target) setFocus({ messageId: target, state: 'error' });
        });
        return () => {
          if (restartLiveRef.current === restart) restartLiveRef.current = null;
          stopFeeder(); stopTargets();
        };
      },
      maintain: async () => {
        await initLocalDb(uid);
        if (cancelled) return;
        await importLegacyQueueOnce(uid);
        // Imported pending sends must appear even without a remote snapshot.
        if (!cancelled) await runner();
      },
      onReadError: () => {
        setSource('firestoreFallback');
        setLoading(false);
      },
    });

    const stopLocal = onLocalMessagesChanged(changedId => {
      if (changedId === conversationId) void runner();
    });
    const stopConn = onConnectivityChange(online => {
      setLive(prev => (online ? (prev === 'offline' ? 'connecting' : prev) : 'offline'));
      if (online) void runner();
    });

    return () => {
      cancelled = true;
      lifecycle.active = false;
      lifecycle.ready = false;
      lifecycle.generation++;
      stopOpen();
      stopConn();
      stopLocal();
      setActiveConversation(undefined);
    };
  }, [enabled, uid, conversationId, runner, revealFocus, lifecycle]);

  // A new focus target on an already-open conversation (second notification tap).
  useEffect(() => {
    if (!focusMessageId) { setFocus(null); return; }
    setFocus({ messageId: focusMessageId, state: 'locating' });
    if (!runner || !conversationId || !lifecycle.ready) return;
    let cancelled = false;
    void (async () => {
      if (await revealFocus(focusMessageId)) return;
      if (cancelled) return;
      const s = await notificationTargets.request(conversationId, focusMessageId);
      if (cancelled) return;
      if (s === 'ready') await revealFocus(focusMessageId);
      else if (focusRef.current === focusMessageId) setFocus({ messageId: focusMessageId, state: s });
    })().catch(() => {
      if (!cancelled && focusRef.current === focusMessageId) setFocus({ messageId: focusMessageId, state: 'error' });
    });
    return () => { cancelled = true; };
  }, [focusMessageId, runner, conversationId, revealFocus, lifecycle]);

  const retrySync = useCallback(() => {
    // Retry also works for a failed conversation feed with no notification
    // target. Restart only the listener; never blank already visible messages.
    restartLiveRef.current?.();
    void runner?.();
    const f = focusRef.current;
    if (!f || !conversationId) return;
    setFocus({ messageId: f, state: 'fetching' });
    void notificationTargets.retry(conversationId, f).then(s => {
      if (!lifecycle.active || focusRef.current !== f) return;
      if (s === 'ready') void revealFocus(f);
      else if (focusRef.current === f) setFocus({ messageId: f, state: s });
    }).catch(() => {
      if (lifecycle.active && focusRef.current === f) setFocus({ messageId: f, state: 'error' });
    });
  }, [conversationId, revealFocus, runner, lifecycle]);

  const loadOlder = useCallback(async () => {
    if (!enabled || !conversationId || !runner) return;
    // Skip if a page is already in flight or we've already reached the start.
    if (loadingOlderRef.current || reachedStartRef.current) return;
    loadingOlderRef.current = true;
    try {
      limitRef.current += PAGE;
      await runner();
      // Window filled entirely from the local DB → more local history remains.
      if (localCountRef.current >= limitRef.current) return;
      // Local history exhausted: back-fill older messages from Firestore,
      // bounded below by any "clear chat" watermark. fetched === 0 ⇒ the start.
      // The first server page may overlap the cached live window. Keep moving
      // until this requested local window fills, rather than stalling on duplicates.
      for (let page = 0; page < 4 && localCountRef.current < limitRef.current; page++) {
        const fetched = await pullMessageHistoryPage(conversationId, PAGE);
        if (fetched === 0) { reachedStartRef.current = true; break; }
        await runner();
      }
    } catch {
      /* best-effort: keep showing what we have; a later scroll can retry */
    } finally {
      loadingOlderRef.current = false;
    }
  }, [enabled, conversationId, runner]);

  const clear = useCallback(async () => {
    if (!conversationId) return;
    clearedAtRef.current = await clearChat(conversationId);
    limitRef.current = PAGE;
    reachedStartRef.current = false;
    setMessages([]);
  }, [conversationId]);

  const loadOlderVoid = useCallback(() => { void loadOlder(); }, [loadOlder]);

  return useMemo(() => ({
    messages, loading, source, live, focus, refresh, loadOlder: loadOlderVoid, clear, retrySync,
  }), [messages, loading, source, live, focus, refresh, loadOlderVoid, clear, retrySync]);
}
