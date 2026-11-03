import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { auth } from '../lib/firebase';
import { fetchStatusFeed, groupStatusFeed, peekStatusFeed, subscribeStatusFeedChanges, type AuthorStatusGroup } from '../lib/statuses';

/** One account-scoped, deduplicated feed shared by inbox and direct-chat avatars. */
export function useStatusRings() {
  const uid = auth.currentUser?.uid;
  const activeUid = useRef(uid); activeUid.current = uid;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [items, setItems] = useState(peekStatusFeed);
  useEffect(() => { setItems(peekStatusFeed()); return subscribeStatusFeedChanges(() => setItems(peekStatusFeed())); }, [uid]);
  const refresh = useCallback(async () => { try { const rows = await fetchStatusFeed(); if (mounted.current && activeUid.current === uid && auth.currentUser?.uid === uid) setItems(rows); } catch { /* keep only the visible cached feed */ } }, [uid]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => {
    const next = Math.min(...items.map(item => item.expiresAtMs).filter(at => at > Date.now()));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setItems(rows => rows.filter(item => item.expiresAtMs > Date.now())), Math.max(1, next - Date.now()));
    return () => clearTimeout(timer);
  }, [items]);
  const groups = useMemo(() => Object.fromEntries(groupStatusFeed(items.filter(s => s.expiresAtMs > Date.now())).map(g => [g.authorId, g])) as Record<string, AuthorStatusGroup>, [items]);
  return { groups, refresh };
}
