// Phase 22C — local-first conversation hook (flag-gated).
//
// When LOCAL_FIRST_CONVERSATION_ENABLED is on, opens the per-user DB + sync
// scheduler (so the outbox drains), serves messages from the local DB, and
// starts the Firestore→local message feeder. Falls back to `firestoreFallback`
// (the legacy Conversation path) if the local DB can't initialise. No-op when
// the flag is off.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LOCAL_FIRST_CONVERSATION_ENABLED } from '../config/features';
import { initLocalDb, messagesRepo, setActiveConversation, clearChat, getChatClearedAt } from '../localdb';
import { startConversationFeeder } from '../localdb/sync/conversationFeeder';
import { pullMessagesBefore } from '../localdb/sync/firebasePull';
import { importLegacyQueueOnce } from '../localdb/sync/legacyImport';
import { mapAndOrderMessages, effectiveTimeMs } from './messageModel';
import type { Message } from '../lib/conversations';

export type ConversationSource = 'disabled' | 'local' | 'firestoreFallback';

const PAGE = 40;

export interface LocalConversation {
  messages: Message[];
  loading: boolean;
  source: ConversationSource;
  refresh: () => void;
  loadOlder: () => void;
  clear: () => Promise<void>;
}

export function useLocalConversation(conversationId: string | undefined, uid: string | undefined): LocalConversation {
  const enabled = LOCAL_FIRST_CONVERSATION_ENABLED && !!conversationId && !!uid;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [source, setSource] = useState<ConversationSource>(enabled ? 'local' : 'disabled');
  const limitRef = useRef(PAGE);
  const refreshing = useRef(false);
  const localCountRef = useRef(0);
  const oldestMsRef = useRef<number | null>(null);
  const clearedAtRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !conversationId || refreshing.current) return;
    refreshing.current = true;
    try {
      const all = await messagesRepo.listMessages(conversationId, limitRef.current);
      // Hide anything at/older than the "cleared chat" watermark.
      const rows = clearedAtRef.current > 0
        ? all.filter(r => effectiveTimeMs(r) > clearedAtRef.current)
        : all;
      localCountRef.current = rows.length;
      // Rows are newest-first; the last one is the oldest message held locally.
      const oldest = rows[rows.length - 1];
      oldestMsRef.current = oldest ? (oldest.remote_created_at ?? oldest.created_at ?? null) : null;
      setMessages(mapAndOrderMessages(rows));
      setSource('local');
    } catch {
      setSource('firestoreFallback');
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [enabled, conversationId]);

  useEffect(() => {
    if (!enabled || !uid || !conversationId) { setLoading(false); setSource('disabled'); return; }
    let stopFeeder: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        await initLocalDb(uid);
        setActiveConversation(conversationId);
        await importLegacyQueueOnce(uid);
        clearedAtRef.current = await getChatClearedAt(conversationId);
        if (cancelled) return;
        await refresh();
        stopFeeder = startConversationFeeder(conversationId, () => { void refresh(); });
      } catch {
        if (cancelled) return;
        setSource('firestoreFallback');
        setLoading(false);
      }
    })();

    return () => { cancelled = true; stopFeeder?.(); setActiveConversation(undefined); };
  }, [enabled, uid, conversationId, refresh]);

  const loadOlder = useCallback(async () => {
    if (!enabled || !conversationId) return;
    limitRef.current += PAGE;
    await refresh();
    // Local history exhausted (fewer rows than asked for): backfill older
    // messages from Firestore — covers history evicted by retention or never
    // reached by the forward pull — then re-read.
    if (localCountRef.current < limitRef.current && oldestMsRef.current != null) {
      try {
        const fetched = await pullMessagesBefore(conversationId, oldestMsRef.current);
        if (fetched > 0) await refresh();
      } catch { /* best-effort: keep showing what we have */ }
    }
  }, [enabled, conversationId, refresh]);

  const clear = useCallback(async () => {
    if (!conversationId) return;
    clearedAtRef.current = await clearChat(conversationId);
    setMessages([]);
  }, [conversationId]);

  return { messages, loading, source, refresh: () => { void refresh(); }, loadOlder, clear };
}
