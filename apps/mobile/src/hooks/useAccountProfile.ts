import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDocFromServer, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { ThemePreference } from '../lib/user';

type AccountProfile = {
  uid: string | null;
  profileCompleted: boolean | null;
  userTheme: ThemePreference | null;
  profileError: boolean;
};
const empty = (uid: string | null): AccountProfile => ({ uid, profileCompleted: null, userTheme: null, profileError: false });

/** Unknown/loading is never incomplete. Only a fresh server read can open
 * onboarding; a confirmed completion remains usable for this account offline. */
export function useAccountProfile(uid: string | null) {
  const [state, setState] = useState<AccountProfile>(() => empty(null));
  const [retry, setRetry] = useState(0);
  const retryProfile = useCallback(() => setRetry(value => value + 1), []);
  useEffect(() => {
    if (!uid) { setState(empty(null)); return; }
    let cancelled = false, live = false, revision = 0;
    let persistence = Promise.resolve();
    const current = () => !cancelled && auth.currentUser?.uid === uid;
    const key = `profileCompleted.v1:${uid}`;
    const ref = doc(db, 'users', uid);
    const fail = () => {
      if (current()) setState(previous => ({ ...(previous.uid === uid ? previous : empty(uid)), profileError: true }));
    };
    const accept = (snapshot: DocumentSnapshot, at: number) => {
      if (!current() || revision !== at || snapshot.metadata.hasPendingWrites) return;
      const data = snapshot.data();
      const done = snapshot.exists() && data?.profileCompleted === true;
      const theme = data?.preferredTheme;
      live = true;
      setState({ uid, profileCompleted: done, profileError: false,
        userTheme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : null });
      // Serialize cache writes so a slow older '0' cannot overwrite a newer '1'.
      persistence = persistence.catch(() => {}).then(async () => {
        if (current() && revision === at) await AsyncStorage.setItem(key, done ? '1' : '0');
      });
      void persistence.catch(() => {});
    };
    setState(previous => ({ ...(previous.uid === uid ? previous : empty(uid)), profileError: false }));
    void AsyncStorage.getItem(key).then(value => {
      // A persisted '0' must never mount onboarding before server verification.
      if (current() && !live && value === '1') setState({ uid, profileCompleted: true, userTheme: null, profileError: false });
    }).catch(() => {});
    const unsubscribe = onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
      if (!current()) return;
      const at = ++revision;
      // A local write can report fromCache=false before it is acknowledged.
      // Neither it nor an incomplete cache is proof onboarding is required.
      if (snapshot.metadata.hasPendingWrites) return;
      if (snapshot.exists() && snapshot.data()?.profileCompleted === true) { accept(snapshot, at); return; }
      if (snapshot.metadata.fromCache) return;
      // Re-read a negative result before mounting the form. A newer completed
      // snapshot, account switch, retry or unmount invalidates this response.
      void getDocFromServer(ref).then(confirmed => {
        if (!current() || revision !== at || confirmed.metadata.fromCache) return;
        accept(confirmed, at);
      }).catch(() => { if (revision === at) fail(); });
    }, () => { revision++; fail(); });
    return () => { cancelled = true; unsubscribe(); };
  }, [uid, retry]);
  // Guard the render before effects run during a direct A → B auth switch.
  return { ...(uid && state.uid === uid ? state : empty(uid)), retryProfile };
}
