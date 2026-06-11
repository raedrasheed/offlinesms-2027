// Push-notification client lifecycle (Phase 27).
//
// The app uses the Firebase *web* JS SDK, so native FCM/APNs tokens come from
// expo-notifications (getDevicePushToken → FCM token on Android). Tokens are
// stored at users/{uid}/devices/{deviceId} and sent to by the Admin SDK in the
// onMessageCreateNotify trigger. On logout we disable the device row.
//
// Foreground suppression: while the user is viewing a conversation we drop the
// local banner for that same conversation (the unread/UI update still happens
// via the existing Firestore listeners).

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { request } from './permissions';
import { getActiveConversationId } from '../localdb/sync/syncScheduler';
export { routeFromNotification, type PushRoute } from './pushRouting';

const DEVICE_ID_KEY = 'pushDeviceId.v1';
let tokenSub: { remove: () => void } | null = null;
let currentDeviceId: string | null = null;

async function stableDeviceId(): Promise<string> {
  if (currentDeviceId) return currentDeviceId;
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Platform.OS}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  currentDeviceId = id;
  return id;
}

/** Foreground handler: show banner unless the user is viewing that chat. */
export function installForegroundHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = (notification.request.content.data ?? {}) as { conversationId?: string };
      const suppress = !!data.conversationId && data.conversationId === getActiveConversationId();
      return {
        shouldShowAlert: !suppress,
        shouldPlaySound: !suppress,
        shouldSetBadge: false,
      };
    },
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  } catch { /* noop */ }
}

async function writeDevice(uid: string, fcmToken: string) {
  const deviceId = await stableDeviceId();
  await setDoc(doc(db, 'users', uid, 'devices', deviceId), {
    deviceId,
    fcmToken,
    platform: Platform.OS,
    appVersion: null,
    locale: Localization.getLocales?.()[0]?.languageTag ?? null,
    timezone: Localization.getCalendars?.()[0]?.timeZone ?? null,
    enabled: true,
    lastSeenAt: serverTimestamp(),
    createdAt: serverTimestamp(),   // merged — only meaningful on first write
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * Request permission (if needed) and register this device's push token for the
 * signed-in user. Safe to call repeatedly (after login). Returns true if a
 * token was registered.
 */
export async function registerForPush(uid: string): Promise<boolean> {
  try {
    const status = await request('notifications');
    if (status !== 'granted') return false;
    await ensureAndroidChannel();

    const token = await Notifications.getDevicePushTokenAsync();   // native FCM/APNs token
    const fcmToken = typeof token?.data === 'string' ? token.data : String(token?.data ?? '');
    if (!fcmToken) return false;
    await writeDevice(uid, fcmToken);

    // Refresh the stored token if the OS rotates it.
    tokenSub?.remove();
    tokenSub = Notifications.addPushTokenListener(t => {
      const next = typeof t?.data === 'string' ? t.data : String(t?.data ?? '');
      if (next) void writeDevice(uid, next);
    });
    return true;
  } catch {
    return false;   // never block app startup on push setup
  }
}

/** Disable this device's token on logout (keeps the row for history). */
export async function unregisterForPush(uid: string): Promise<void> {
  try {
    tokenSub?.remove();
    tokenSub = null;
    const deviceId = await stableDeviceId();
    await setDoc(doc(db, 'users', uid, 'devices', deviceId), {
      enabled: false, updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch { /* best-effort */ }
}

