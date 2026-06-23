// Pure helpers for the Expo Push transport (iOS). No network here — building the
// message payload, chunking, and classifying ticket/receipt errors are all
// unit-testable in isolation. The HTTP call lives in expoPush.ts.

import type { PushContent } from './send';

/** Expo Push API message shape (the subset we use). */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default' | null;
  priority: 'default' | 'high';
  channelId?: string;
  badge?: number;
  /** Wake a backgrounded app for data-only/silent delivery. */
  _contentAvailable?: boolean;
}

export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_CHUNK = 100;   // Expo accepts up to 100 messages/request

/**
 * Build an Expo push message from the shared PushContent. Silent (muted /
 * sound-off) → no sound, but still shows the banner. iOS thread/collapse uses
 * the collapseId carried in data (Expo maps `collapseId`→apns-collapse-id).
 */
export function buildExpoMessage(token: string, content: PushContent): ExpoPushMessage {
  const msg: ExpoPushMessage = {
    to: token,
    title: content.title,
    body: content.body,
    data: content.data,
    sound: content.silent ? null : 'default',
    priority: content.silent ? 'default' : 'high',
    channelId: 'messages',
  };
  return msg;
}

/** Split messages into Expo's max-size request chunks. */
export function chunkExpoMessages(msgs: ExpoPushMessage[], size = EXPO_PUSH_CHUNK): ExpoPushMessage[][] {
  const out: ExpoPushMessage[][] = [];
  for (let i = 0; i < msgs.length; i += size) out.push(msgs.slice(i, i + size));
  return out;
}

/** One Expo push ticket (immediate response) or receipt (later poll). */
export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Does this Expo ticket/receipt mean the token is permanently dead (should be
 * disabled)? `DeviceNotRegistered` is the Expo equivalent of FCM's
 * registration-token-not-registered. Malformed credentials/messages are NOT
 * token death.
 */
export function isExpoDeadTokenTicket(ticket: ExpoTicket | undefined): boolean {
  if (!ticket || ticket.status !== 'error') return false;
  return ticket.details?.error === 'DeviceNotRegistered';
}
