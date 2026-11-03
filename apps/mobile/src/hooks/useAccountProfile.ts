import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { ThemePreference } from '../lib/user';

type AccountProfile = { uid: string | null; profileCompleted: boolean | null; userTheme: ThemePreference | null };

/** Cache restores the current account offline; neither a previous account's
 * state nor a late cache/snapshot callback can unlock its navigator. */
export function useAccountProfile(uid: string | null) {
  const [state, setState] = useState<AccountProfile>({ uid: null, profileCompleted: null, userTheme: null });
  useEffect(() => {
    if (!uid) return;
    let cancelled = false, live = false;
    const current = () => !cancelled && auth.currentUser?.uid === uid;
    const key = `profileCompleted.v1:${uid}`;
    void AsyncStorage.getItem(key).then(value => {
      if (current() && !live && value === '1') setState({ uid, profileCompleted: true, userTheme: null });
    }).catch(() => {});
    const unsubscribe = onSnapshot(doc(db, 'users', uid), { includeMetadataChanges: true }, snapshot => {
      if (!current()) return;
      const data = snapshot.data();
      const done = snapshot.exists() && data?.profileCompleted === true;
      // An empty/incomplete local Firestore cache is not proof that this
      // account needs onboarding. Keep the persisted completion result usable
      // offline, including when its AsyncStorage read finishes after this event.
      // Listen for metadata changes so an identical server-confirmed missing
      // document still replaces that offline fallback when connectivity returns.
      if (snapshot.metadata.fromCache && !done) return;
      live = true;
      const theme = data?.preferredTheme;
      setState({ uid, profileCompleted: done, userTheme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : null });
      void AsyncStorage.setItem(key, done ? '1' : '0').catch(() => {});
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [uid]);
  // Guard the render before effects run during a direct A → B auth switch.
  return uid && state.uid === uid ? state : { uid, profileCompleted: null, userTheme: null };
}
