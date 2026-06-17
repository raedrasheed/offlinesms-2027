// Expo Push transport (iOS). Sends ExpoPushMessages to the Expo push service
// over HTTPS (Node 20 global fetch — no extra dependency) and returns a ticket
// per message, aligned 1:1 with the input order so callers can map tickets back
// to (uid, deviceId, token) and disable dead tokens.
//
// Why Expo (not direct FCM) for iOS: the app uses the Firebase *web* JS SDK and
// registers an Expo push token on iOS; the Expo service holds the APNs key and
// delivers to Apple. Android keeps using firebase-admin FCM directly.

import {
  EXPO_PUSH_ENDPOINT, chunkExpoMessages,
  type ExpoPushMessage, type ExpoTicket,
} from './expoPushLogic';

/** Send a batch of Expo messages; returns one ticket per input message. */
export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<ExpoTicket[]> {
  if (messages.length === 0) return [];
  const tickets: ExpoTicket[] = [];

  for (const chunk of chunkExpoMessages(messages)) {
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(chunk),
      });

      if (!res.ok) {
        // Whole-request failure (e.g. 429/5xx): mark each as a transient error
        // (not token death) so tokens are retained for the next send.
        for (let i = 0; i < chunk.length; i++) {
          tickets.push({ status: 'error', message: `expo-http-${res.status}` });
        }
        continue;
      }

      const json = (await res.json()) as { data?: ExpoTicket[]; errors?: unknown };
      const data = Array.isArray(json.data) ? json.data : [];
      for (let i = 0; i < chunk.length; i++) {
        tickets.push(data[i] ?? { status: 'error', message: 'expo-no-ticket' });
      }
    } catch (e: any) {
      for (let i = 0; i < chunk.length; i++) {
        tickets.push({ status: 'error', message: String(e?.message ?? 'expo-network-error') });
      }
    }
  }

  return tickets;
}
