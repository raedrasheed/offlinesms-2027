// App-level presence lifecycle (Phase 24).
//
// Mounted once for the signed-in session. Marks the user online while the app
// is foregrounded and writes a final lastSeen when it backgrounds, unmounts, or
// the user signs out. Network drops need no special handling — a foreground
// heartbeat that fails silently lets lastSeen go stale, so peers auto-show the
// user offline, and it refreshes on reconnect via the next heartbeat/foreground.

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { setOnline, setOffline } from '../services/presenceService';

export function usePresence(uid: string | undefined): void {
  useEffect(() => {
    if (!uid) return;
    void setOnline();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void setOnline();
      else void setOffline(); // background / inactive
    });

    return () => {
      sub.remove();
      void setOffline();
    };
  }, [uid]);
}
