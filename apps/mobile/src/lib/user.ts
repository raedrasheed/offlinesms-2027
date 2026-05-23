// Per-user profile and preference helpers.
//
// Phase 2: allow-listed field writes via Firestore rules.
// Phase 9: smsOptOut added.
// Phase 19: preferredLanguage, preferredTheme, inAppNotifications, timeFormat added.
//
// smsOptOut remains the canonical Phase 8 eligibility field.
// New preference fields are opt-in and absent means "use device default".

import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

export type ThemePreference  = 'system' | 'light' | 'dark';
export type TimeFormat       = 'system' | '12h' | '24h';
export type LanguageCode     = 'en' | 'ar';

export type MeDoc = {
  uid:                 string;
  displayName?:        string;
  username?:           string;
  usernameLower?:      string;
  photoURL?:           string | null;
  about?:              string | null;
  profileCompleted?:   boolean;
  smsOptOut?:          boolean;
  // Phase 19 preferences
  preferredLanguage?:  LanguageCode;
  preferredTheme?:     ThemePreference;
  inAppNotifications?: boolean;
  timeFormat?:         TimeFormat;
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

export async function setPreferredLanguage(uid: string, lang: LanguageCode): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    preferredLanguage: lang,
    updatedAt: serverTimestamp(),
  });
}

export async function setPreferredTheme(uid: string, theme: ThemePreference): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    preferredTheme: theme,
    updatedAt: serverTimestamp(),
  });
}

export async function setInAppNotifications(uid: string, enabled: boolean): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    inAppNotifications: enabled,
    updatedAt: serverTimestamp(),
  });
}

export async function setTimeFormat(uid: string, format: TimeFormat): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    timeFormat: format,
    updatedAt: serverTimestamp(),
  });
}
