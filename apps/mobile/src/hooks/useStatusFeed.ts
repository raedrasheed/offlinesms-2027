import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { auth } from '../lib/firebase';
import { fetchStatusFeed, peekStatusFeed, subscribeStatusFeedChanges, type StatusFeedItem } from '../lib/statuses';

const REFRESH_MS = 30_000;
type FeedState = { uid?: string; items: StatusFeedItem[]; loading: boolean; refreshing: boolean; loaded: boolean; error: boolean };
const unexpired = (items: StatusFeedItem[]) => items.filter(item => item.expiresAtMs > Date.now());

/** Refresh only while the Status tab is visible in the foreground. The data
 * layer still deduplicates requests shared with the chat-avatar status rings. */
export function useStatusFeed() {
  const uid = auth.currentUser?.uid, focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const active = focused && foreground && !!uid;
  const identity = useRef({ uid, active });
  if (identity.current.uid !== uid || identity.current.active !== active) identity.current = { uid, active };
  const context = identity.current;
  const mounted = useRef(true);
  const pending = useRef<{ context: typeof context; promise: Promise<void> } | null>(null);
  const [state, setState] = useState<FeedState>(() => ({ uid, items: peekStatusFeed(), loading: active, refreshing: false, loaded: false, error: false }));
  function current() { return mounted.current && identity.current === context && context.active && auth.currentUser?.uid === uid; }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => subscription.remove();
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!current()) return Promise.resolve();
    if (pending.current?.context === context) return pending.current.promise;
    setState(previous => {
      const sameAccount = previous.uid === uid;
      const items = sameAccount ? unexpired(previous.items) : peekStatusFeed();
      const loaded = sameAccount && previous.loaded;
      return { uid, items, loaded, error: sameAccount && previous.error, loading: !loaded && items.length === 0, refreshing: true };
    });
    // A focus/resume must not reuse a recently cached empty feed.
    const request = fetchStatusFeed(true).then(items => {
      if (current()) setState({ uid, items: unexpired(items), loading: false, refreshing: false, loaded: true, error: false });
    }).catch(() => {
      if (current()) setState(previous => ({ ...previous, loading: false, refreshing: false, error: true }));
    }).finally(() => { if (pending.current?.promise === request) pending.current = null; });
    pending.current = { context, promise: request };
    return request;
  }, [context]);

  useEffect(() => {
    if (!active) return;
    const updateCachedRows = () => {
      if (current()) setState(previous => previous.uid === uid
        ? { ...previous, items: peekStatusFeed() }
        : { uid, items: peekStatusFeed(), loading: true, refreshing: false, loaded: false, error: false });
    };
    updateCachedRows();
    const unsubscribe = subscribeStatusFeedChanges(updateCachedRows);
    void refresh();
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => { clearInterval(timer); unsubscribe(); };
  }, [context, refresh]);

  useEffect(() => {
    if (!active || state.uid !== uid) return;
    const expiresAt = Math.min(...state.items.map(item => item.expiresAtMs).filter(value => value > Date.now()));
    if (!Number.isFinite(expiresAt)) return;
    const timer = setTimeout(() => {
      if (current()) setState(previous => ({ ...previous, items: unexpired(previous.items) }));
    }, Math.max(1, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [context, state.items, state.uid]);

  const sameAccount = state.uid === uid && auth.currentUser?.uid === uid;
  return {
    items: sameAccount ? unexpired(state.items) : [],
    loading: sameAccount ? state.loading : active,
    refreshing: sameAccount && active && state.refreshing,
    loaded: sameAccount && state.loaded,
    error: sameAccount && state.error,
    refresh,
  };
}
