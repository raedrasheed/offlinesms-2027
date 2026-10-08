// Phase 22C — local-first conversation hook (flag-gated).
//
// When LOCAL_FIRST_CONVERSATION_ENABLED is on, opens the per-user DB + sync
// scheduler (so the outbox drains), serves messages from the local DB, and
// starts the Firestore→local message feeder. Falls back to `firestoreFallback`
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
  initLocalDb, messagesRepo, setActiveConversation, clearChat, getChatClearedAt,
  notificationTargets, type TargetState,
} from '../localdb';
import { startConversationFeeder } from '../localdb/sync/conversationFeeder';
import { pullMessagesBefore } from '../localdb/sync/firebasePull';
import { isOnline, onConnectivityChange } from '../localdb/sync/networkState';
import { importLegacyQueueOnce } from '../localdb/sync/legacyImport';
import { createMessageMapper } from './messageModel';
import { coalescing } from '../lib/coalesce';
import { perfMark } from '../lib/perf';
import type { Message } from '../lib/conversations';

export type ConversationSource = 'disabled' | 'local' | 'firestoreFallback';
/** 'connecting' until the realtime listener delivered server data at least once. */
export type LiveState = 'connecting' | 'live' | 'offline';

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
  retryFocus: () => void;
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
  const oldestMsRef = useRef<number | null>(null);
  const clearedAtRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const reachedStartRef = useRef(false);
  const focusRef = useRef<string | undefined>(focusMessageId);
  focusRef.current = focusMessageId;

  // One mapper + one coalescing runner per open conversation.
  const runner = useMemo(() => {
    if (!enabled || !conversationId) return null;
    const mapRows = createMessageMapper();
    let first = true;
    return coalescing(async () => {
      try {
        const all = await messagesRepo.listMessages(conversationId, limitRef.current);
        // Hide messages whose SERVER time is at/older than the "cleared"
        // watermark. Rows without a server time yet (own pending sends) stay.
        const rows = clearedAtRef.current > 0
          ? all.filter(r => r.remote_created_at == null || r.remote_created_at > clearedAtRef.current)
          : all;
        localCountRef.current = rows.length;
        const oldest = rows[rows.length - 1]; // rows are newest-first
        oldestMsRef.current = oldest ? (oldest.remote_created_at ?? oldest.created_at ?? null) : null;
        setMessages(mapRows(rows));
        setSource('local');
        if (first) { first = false; perfMark('conversation:firstLocalRender', { rows: rows.length }); }
      } catch {
        setSource('firestoreFallback');
      } finally {
        setLoading(false);
      }
    });
  }, [enabled, conversationId]);

  const refresh = useCallback(() => { void runner?.(); }, [runner]);

  /** Grow the window so a focused message is rendered, then mark it found. */
  const revealFocus = useCallback(async (messageId: string): Promise<boolean> => {
    if (!conversationId || !runner) return false;
    const pos = await messagesRepo.positionFromNewest(conversationId, messageId);
    if (pos == null) return false;
    if (pos + FOCUS_CONTEXT > limitRef.current) limitRef.current = pos + FOCUS_CONTEXT;
    await runner();
    if (focusRef.current === messageId) setFocus({ messageId, state: 'ready' });
    return true;
  }, [conversationId, runner]);

  useEffect(() => {
    if (!enabled || !uid || !conversationId || !runner) { setLoading(false); setSource('disabled'); return; }
    let stopFeeder: (() => void) | null = null;
    let stopTargets: (() => void) | null = null;
    let cancelled = false;
    perfMark('conversation:open', { id: conversationId });

    (async () => {
      try {
        await initLocalDb(uid);
        setActiveConversation(conversationId);
        await importLegacyQueueOnce(uid);
        clearedAtRef.current = await getChatClearedAt(conversationId);
        // Fresh window each time the chat (re)opens.
        limitRef.current = PAGE;
        reachedStartRef.current = false;
        if (cancelled) return;
        await runner();
        stopFeeder = startConversationFeeder(conversationId, (change) => {
          if (!change.fromCache) setLive('live');
          void runner().then(() => {
            const f = focusRef.current;
            if (f && change.ids.includes(f)) void revealFocus(f);
          });
        });
        const target = focusRef.current;
        if (target) {
          stopTargets = notificationTargets.subscribe((c, m, state) => {
            if (c !== conversationId || m !== focusRef.current) return;
            if (state === 'ready') void revealFocus(m);
            else setFocus({ messageId: m, state });
          });
          // Already local? Reveal immediately; otherwise fetch the one message.
          if (!(await revealFocus(target))) {
            const s = await notificationTargets.request(conversationId, target);
            if (s === 'ready') await revealFocus(target);
            else if (!cancelled) setFocus({ messageId: target, state: s });
          }
        }
      } catch {
        if (cancelled) return;
        setSource('firestoreFallback');
        setLoading(false);
      }
    })();

    const stopConn = onConnectivityChange(online => {
      setLive(prev => (online ? (prev === 'offline' ? 'connecting' : prev) : 'offline'));
      if (online) void runner();
    });

    return () => {
      cancelled = true;
      stopFeeder?.();
      stopTargets?.();
      stopConn();
      setActiveConversation(undefined);
    };
  }, [enabled, uid, conversationId, runner, revealFocus]);

  // A new focus target on an already-open conversation (second notification tap).
  useEffect(() => {
    if (!focusMessageId) { setFocus(null); return; }
    setFocus({ messageId: focusMessageId, state: 'locating' });
    if (!runner || !conversationId) return;
    void (async () => {
      if (await revealFocus(focusMessageId)) return;
      const s = await notificationTargets.request(conversationId, focusMessageId);
      if (s === 'ready') await revealFocus(focusMessageId);
      else if (focusRef.current === focusMessageId) setFocus({ messageId: focusMessageId, state: s });
    })();
  }, [focusMessageId, runner, conversationId, revealFocus]);

  const retryFocus = useCallback(() => {
    const f = focusRef.current;
    if (!f || !conversationId) return;
    setFocus({ messageId: f, state: 'fetching' });
    void notificationTargets.retry(conversationId, f).then(s => {
      if (s === 'ready') void revealFocus(f);
      else if (focusRef.current === f) setFocus({ messageId: f, state: s });
    });
  }, [conversationId, revealFocus]);

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
      if (oldestMsRef.current == null) { reachedStartRef.current = true; return; }
      const fetched = await pullMessagesBefore(conversationId, oldestMsRef.current, clearedAtRef.current);
      if (fetched > 0) await runner();
      else reachedStartRef.current = true;
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
    messages, loading, source, live, focus, refresh, loadOlder: loadOlderVoid, clear, retryFocus,
  }), [messages, loading, source, live, focus, refresh, loadOlderVoid, clear, retryFocus]);
}
