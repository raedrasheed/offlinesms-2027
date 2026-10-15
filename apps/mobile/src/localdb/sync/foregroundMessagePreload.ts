import { AppState } from 'react-native';
import { getCurrentUid, getDb } from '../connection';
import { isOnline, onConnectivityChange } from './networkState';
import { startConversationFeeder } from './conversationFeeder';
import { pullRecentMessages } from './firebasePull';
import { createMessagePreload } from './messagePreload';
import { perfMark, perfNow } from '../../lib/perf';

/** Owned by the mounted chat list, including while another screen covers it. */
export function startForegroundMessagePreload(uid: string) {
  const database = getDb();
  let foreground = AppState.currentState == null || AppState.currentState === 'active';
  const preload = createMessagePreload({
    canRun: () => foreground && isOnline() && getCurrentUid() === uid && getDb() === database,
    fetchRecent: async id => {
      const started = perfNow();
      const count = await pullRecentMessages(id);
      perfMark('sync:preload:ready', { durationMs: Math.round(perfNow() - started), count });
      return count;
    },
    listen: (id, ready, error) => startConversationFeeder(id, change => {
      if (!change.fromCache) ready();
    }, error, 25),
  });
  const appState = AppState.addEventListener('change', state => {
    const wasForeground = foreground;
    foreground = state === 'active';
    if (!foreground) preload.pause();
    else if (!wasForeground) preload.resume();
  });
  const stopNetwork = onConnectivityChange(online => {
    if (online && foreground) preload.resume(); else preload.pause();
  });
  return {
    update: preload.update,
    stop() { preload.stop(); appState.remove(); stopNetwork(); },
  };
}
