// Phase 22C — local-first conversation hook (flag-gated).
//
// When LOCAL_FIRST_CONVERSATION_ENABLED is on, opens the per-user DB + sync
// scheduler (so the outbox drains), serves messages from the local DB, and
// starts the Firestore→local message feeder. Falls back to `firestoreFallback`
// (the legacy Conversation path) if the local DB can't initialise. No-op when
// the flag is off.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LOCAL_FIRST_CONVERSATION_ENABLED } from '../config/features';
import { initLocalDb, messagesRepo, setActiveConversation } from '../localdb';
import { startConversationFeeder } from '../localdb/sync/conversationFeeder';
import { importLegacyQueueOnce } from '../localdb/sync/legacyImport';
import { mapAndOrderMessages } from './messageModel';
import type { Message } from '../lib/conversations';

export type ConversationSource = 'disabled' | 'local' | 'firestoreFallback';

const PAGE = 40;

export interface LocalConversation {
  messages: Message[];
  loading: boolean;
  source: ConversationSource;
  refresh: () => void;
  loadOlder: () => void;
}

export function useLocalConversation(conversationId: string | undefined, uid: string | undefined): LocalConversation {
  const enabled = LOCAL_FIRST_CONVERSATION_ENABLED && !!conversationId && !!uid;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [source, setSource] = useState<ConversationSource>(enabled ? 'local' : 'disabled');
  const limitRef = useRef(PAGE);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || !conversationId || refreshing.current) return;
    refreshing.current = true;
    try {
      const rows = await messagesRepo.listMessages(conversationId, limitRef.current);
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

  const loadOlder = useCallback(() => { limitRef.current += PAGE; void refresh(); }, [refresh]);

  return { messages, loading, source, refresh: () => { void refresh(); }, loadOlder };
}
