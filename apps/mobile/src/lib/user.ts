// Per-user profile helpers (Phase 9).
//
// Phase 2 already gates writes via the firestore.rules allow-list.
// Phase 9 adds `smsOptOut` to that allow-list so the Settings toggle
// can persist it without going through a callable.

import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

export type MeDoc = {
  uid:               string;
  displayName?:      string;
  username?:         string;
  usernameLower?:    string;
  photoURL?:         string | null;
  about?:            string | null;
  profileCompleted?: boolean;
  smsOptOut?:        boolean;
};

export function subscribeMe(uid: string | undefined, cb: (me: MeDoc | null) => void) {
  if (!uid) { cb(null); return () => {}; }
  return onSnapshot(doc(db, 'users', uid), snap => {
    if (!snap.exists()) { cb(null); return; }
    cb({ uid, ...(snap.data() as Omit<MeDoc, 'uid'>) });
  });
}

export async function setSmsOptOut(uid: string, optOut: boolean): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    smsOptOut: optOut,
    updatedAt: serverTimestamp(),
  });
}
