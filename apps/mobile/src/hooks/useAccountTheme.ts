import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { ThemePreference } from '../lib/user';

/** Profile preferences are optional; their loading/error state never gates a session. */
export function useAccountTheme(uid: string | null): ThemePreference | null {
  const [state, setState] = useState<{ uid: string; theme: ThemePreference | null } | null>(null);
  useEffect(() => {
    if (!uid) { setState(null); return; }
    let active = true;
    const stop = onSnapshot(doc(db, 'users', uid), snapshot => {
      if (!active || auth.currentUser?.uid !== uid) return;
      const theme = snapshot.data()?.preferredTheme;
      setState({ uid, theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : null });
    }, () => { /* Keep the app usable when optional preferences cannot load. */ });
    return () => { active = false; stop(); };
  }, [uid]);
  return uid && state?.uid === uid ? state.theme : null;
}
