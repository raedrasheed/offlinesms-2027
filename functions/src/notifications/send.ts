// Shared FCM sender (Phase 27). Reads a user's enabled device tokens, sends one
// message per token, and disables dead tokens. Used by the message trigger and
// the reaction notification path so the send/cleanup logic lives in one place.

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging, type TokenMessage } from 'firebase-admin/messaging';
import { isDeadTokenError, collapseKey } from './notifyLogic';

interface DeviceDoc { fcmToken?: string; enabled?: boolean }

export interface PushContent {
  title: string;
  body: string;
  data: Record<string, string>;
  silent?: boolean;          // no sound/vibration (muted or sound-off)
  conversationId?: string;   // for the collapse/thread id
}

/** Send a push to all of a user's enabled devices. Returns the number sent. */
export async function sendPushToUser(uid: string, content: PushContent): Promise<number> {
  const db = getFirestore();
  const devicesSnap = await db.collection('users').doc(uid).collection('devices')
    .where('enabled', '==', true).get();
  if (devicesSnap.empty) return 0;

  const messaging = getMessaging();
  const cleanups: Promise<unknown>[] = [];
  const tag = content.conversationId ? collapseKey(content.conversationId) : undefined;
  let sent = 0;

  for (const dev of devicesSnap.docs) {
    const token = (dev.data() as DeviceDoc).fcmToken;
    if (!token) continue;

    const message: TokenMessage = {
      token,
      data: content.data,
      notification: { title: content.title, body: content.body },
      android: {
        ...(tag ? { collapseKey: tag } : {}),
        priority: content.silent ? 'normal' : 'high',
        notification: {
          ...(tag ? { tag } : {}),
          ...(content.silent ? { defaultSound: false } : { defaultSound: true, defaultVibrateTimings: true }),
        },
      },
      apns: {
        ...(tag ? { headers: { 'apns-collapse-id': tag } } : {}),
        payload: { aps: content.silent ? { sound: undefined } : { sound: 'default' } },
      },
    };

    try {
      await messaging.send(message);
      sent++;
    } catch (e: any) {
      const code = e?.errorInfo?.code ?? e?.code;
      if (isDeadTokenError(code)) {
        cleanups.push(dev.ref.set({ enabled: false, disabledAt: FieldValue.serverTimestamp(), disabledReason: code }, { merge: true }));
      }
    }
  }

  await Promise.allSettled(cleanups);
  return sent;
}
