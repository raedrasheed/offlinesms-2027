import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { conversationRevision, type ConversationSummary, type HiddenChat } from '../lib/chatVisibility';

type HiddenChats = Record<string, HiddenChat>;

/** Device-only deletion, account-scoped like the local message database. */
export function useChatVisibility(uid: string | undefined) {
  const [hidden, setHidden] = useState<HiddenChats>({});
  const [loaded, setLoaded] = useState(false);
  const current = useRef<HiddenChats>({});
  const generation = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const own = ++generation.current;
    current.current = {}; setHidden({}); setLoaded(false);
    if (!uid) { setLoaded(true); return; }
    AsyncStorage.getItem(`chats.hidden.v1:${uid}`).then(raw => {
      if (own !== generation.current) return;
      const parsed = raw ? JSON.parse(raw) : {};
      const valid: HiddenChats = {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [id, value] of Object.entries(parsed)) {
          const v = value as HiddenChat;
          if (v && Number.isFinite(v.messageAt) && (v.messageId === null || typeof v.messageId === 'string')) valid[id] = v;
        }
      }
      current.current = valid; setHidden(valid);
    }).catch(() => {}).finally(() => { if (own === generation.current) setLoaded(true); });
    return () => { generation.current++; };
  }, [uid]);

  const hide = useCallback(async (id: string, row: ConversationSummary) => {
    if (!uid || !loaded) throw new Error('chat-visibility-not-ready');
    const own = generation.current;
    const revision = conversationRevision(row);
    const write = writes.current.catch(() => {}).then(async () => {
      if (own !== generation.current) throw new Error('account-changed');
      const next = { ...current.current, [id]: revision };
      await AsyncStorage.setItem(`chats.hidden.v1:${uid}`, JSON.stringify(next));
      if (own !== generation.current) throw new Error('account-changed');
      current.current = next; setHidden(next);
    });
    writes.current = write;
    await write;
  }, [uid, loaded]);

  return { hidden, loaded, hide };
}
