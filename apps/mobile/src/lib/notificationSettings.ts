// Per-user notification preferences (Phase 27), stored at
// users/{uid}/notificationSettings/current. Client read/write of own only.

import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type NotificationSettings = {
  enabled: boolean;
  directMessages: boolean;
  groupMessages: boolean;
  reactions: boolean;
  sound: boolean;
  vibration: boolean;
  showPreview: boolean;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  directMessages: true,
  groupMessages: true,
  reactions: true,
  sound: true,
  vibration: true,
  showPreview: true,
};

function ref(uid: string) {
  return doc(db, 'users', uid, 'notificationSettings', 'current');
}

export function subscribeNotificationSettings(uid: string, cb: (s: NotificationSettings) => void) {
  return onSnapshot(ref(uid), snap => {
    cb({ ...DEFAULT_NOTIFICATION_SETTINGS, ...(snap.exists() ? (snap.data() as Partial<NotificationSettings>) : {}) });
  }, () => cb(DEFAULT_NOTIFICATION_SETTINGS));
}

export async function updateNotificationSettings(uid: string, patch: Partial<NotificationSettings>): Promise<void> {
  await setDoc(ref(uid), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}
