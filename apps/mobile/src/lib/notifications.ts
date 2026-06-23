// Push-notification client lifecycle (Phase 27 + iOS).
//
// The app uses the Firebase *web* JS SDK, so it can't mint native FCM tokens on
// iOS. Transport is therefore provider-aware:
//   • Android → getDevicePushTokenAsync() → native FCM token (provider 'fcm').
//   • iOS     → getExpoPushTokenAsync({ projectId }) → Expo push token
//               (provider 'expo'); the backend delivers via the Expo Push API
//               (APNs). Requires a real device + the APNs key configured in EAS.
//
// Tokens are stored at users/{uid}/devices/{deviceId} and read by the Admin SDK
// in the notification triggers. On logout we disable THIS device row only.
//
// Foreground suppression: while viewing a conversation we drop the local banner
// for that same conversation (unread/UI still updates via Firestore listeners).

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Localization from 'expo-localization';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { request } from './permissions';
import { getActiveConversationId } from '../localdb/sync/syncScheduler';
import { providerForPlatform, usesExpoToken, buildDeviceRecord } from './pushTokens';
export { routeFromNotification, type PushRoute } from './pushRouting';

const DEVICE_ID_KEY = 'pushDeviceId.v1';
let tokenSub: { remove: () => void } | null = null;
let currentDeviceId: string | null = null;

/** Developer diagnostics only — never shown to users; silent in production. */
function devLog(...args: unknown[]) {
  if (__DEV__) console.log('[push]', ...args);
}

/** EAS project id — required by getExpoPushTokenAsync on iOS. */
function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId ??
    undefined
  );
}

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
      // SDK 53 (expo-notifications 0.31) replaced `shouldShowAlert` with the
      // split `shouldShowBanner` / `shouldShowList` flags.
      return {
        shouldShowBanner: !suppress,
        shouldShowList: !suppress,
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

/** Acquire the platform's push token: Expo token on iOS, native FCM on Android. */
async function acquireToken(): Promise<string | null> {
  if (usesExpoToken(Platform.OS)) {
    const pid = projectId();
    if (!pid) { devLog('missing EAS projectId — cannot get Expo push token'); return null; }
    const res = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    return typeof res?.data === 'string' && res.data ? res.data : null;
  }
  const res = await Notifications.getDevicePushTokenAsync();   // native FCM (Android)
  return typeof res?.data === 'string' ? res.data : (res?.data != null ? String(res.data) : null);
}

async function writeDevice(uid: string, token: string) {
  const deviceId = await stableDeviceId();
  // Idempotent merge — re-registering with the same deviceId updates the row,
  // never creates a duplicate. createdAt only "sticks" on first write.
  await setDoc(doc(db, 'users', uid, 'devices', deviceId), {
    ...buildDeviceRecord({
      deviceId,
      token,
      platform: Platform.OS,
      appVersion: Application.nativeApplicationVersion ?? null,
      buildVersion: Application.nativeBuildVersion ?? null,
      locale: Localization.getLocales?.()[0]?.languageTag ?? null,
      timezone: Localization.getCalendars?.()[0]?.timeZone ?? null,
    }),
    lastSeenAt: serverTimestamp(),
    createdAt: serverTimestamp(),   // merged — only meaningful on first write
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * Request permission (if needed) and register this device's push token for the
 * signed-in user. Safe to call repeatedly (after login) — idempotent. Returns
 * true if a token was registered.
 *
 * Permission states are all handled: granted → register; denied/undetermined →
 * no-op (the Settings screen offers a path to enable). Simulators / non-physical
 * devices throw on token acquisition; we swallow and log in dev only.
 */
export async function registerForPush(uid: string): Promise<boolean> {
  try {
    const status = await request('notifications');
    if (status !== 'granted') { devLog('permission not granted:', status); return false; }
    await ensureAndroidChannel();

    const token = await acquireToken();
    if (!token) { devLog('no push token acquired (provider:', providerForPlatform(Platform.OS), ')'); return false; }
    await writeDevice(uid, token);
    devLog('registered', providerForPlatform(Platform.OS), 'token for', uid);

    // Refresh the stored token if the OS rotates it (updates the same row).
    tokenSub?.remove();
    tokenSub = Notifications.addPushTokenListener(t => {
      const next = typeof t?.data === 'string' ? t.data : (t?.data != null ? String(t.data) : '');
      if (next) void writeDevice(uid, next);
    });
    return true;
  } catch (e) {
    devLog('registerForPush failed:', e);
    return false;   // never block app startup on push setup
  }
}

/** Disable this device's token on logout (keeps the row for history). Only THIS
 *  device is disabled — the user's other devices keep receiving. */
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
