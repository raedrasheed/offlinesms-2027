// Shared push sender (Phase 27 + iOS). Reads a user's enabled device tokens,
// routes each to the right transport — Android native FCM via firebase-admin
// (unchanged), iOS Expo push tokens via the Expo Push service — and disables
// dead tokens. Used by the message + reaction triggers so send/cleanup logic
// lives in one place.

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging, type TokenMessage } from 'firebase-admin/messaging';
import { isDeadTokenError, collapseKey } from './notifyLogic';
import { resolveDeviceToken, type DeviceTokenDoc } from './deviceToken';
import { buildExpoMessage, isExpoDeadTokenTicket } from './expoPushLogic';
import { sendExpoPush } from './expoPush';

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

  const tag = content.conversationId ? collapseKey(content.conversationId) : undefined;

  // Partition enabled devices by transport.
  const fcm: Array<{ ref: FirebaseFirestore.DocumentReference; token: string }> = [];
  const expo: Array<{ ref: FirebaseFirestore.DocumentReference; token: string }> = [];
  for (const dev of devicesSnap.docs) {
    const resolved = resolveDeviceToken(dev.data() as DeviceTokenDoc);
    if (!resolved) continue;
    (resolved.provider === 'expo' ? expo : fcm).push({ ref: dev.ref, token: resolved.token });
  }

  const cleanups: Promise<unknown>[] = [];
  let sent = 0;

  // ── Android: native FCM via firebase-admin (behavior unchanged) ──
  if (fcm.length > 0) {
    const messaging = getMessaging();
    for (const { ref, token } of fcm) {
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
          cleanups.push(ref.set({ enabled: false, disabledAt: FieldValue.serverTimestamp(), disabledReason: code }, { merge: true }));
        }
      }
    }
  }

  // ── iOS: Expo push service (APNs) ──
  if (expo.length > 0) {
    const messages = expo.map(e => buildExpoMessage(e.token, content));
    const tickets = await sendExpoPush(messages);
    for (let i = 0; i < expo.length; i++) {
      const ticket = tickets[i];
      if (ticket?.status === 'ok') sent++;
      else if (isExpoDeadTokenTicket(ticket)) {
        cleanups.push(expo[i].ref.set(
          { enabled: false, disabledAt: FieldValue.serverTimestamp(), disabledReason: 'DeviceNotRegistered' },
          { merge: true },
        ));
      }
    }
  }

  await Promise.allSettled(cleanups);
  return sent;
}
