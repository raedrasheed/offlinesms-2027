// Phase 22 — connectivity for the sync engine. Thin wrapper over NetInfo with a
// cached value so push/pull can check synchronously.
import NetInfo from '@react-native-community/netinfo';

let online = true;
const listeners = new Set<(online: boolean) => void>();

function usable(state: { isConnected?: boolean | null; isInternetReachable?: boolean | null }): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

export function startNetworkWatch(): () => void {
  const unsub = NetInfo.addEventListener(state => {
    const next = usable(state);
    if (next !== online) {
      online = next;
      listeners.forEach(l => { try { l(online); } catch { /* noop */ } });
    }
  });
  NetInfo.fetch().then(state => { online = usable(state); }).catch(() => {});
  return unsub;
}

export function isOnline(): boolean {
  return online;
}

export function onConnectivityChange(cb: (online: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
