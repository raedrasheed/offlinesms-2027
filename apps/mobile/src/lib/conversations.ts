// Phase 4 chat data layer.
//
// All consistency writes go through Cloud Function callables; the client
// subscribes to Firestore for live updates only. The legacy `chats.ts`
// module re-exports a subset of these helpers for screens that haven't
// migrated yet.

import {
  collection, doc, onSnapshot, orderBy, query, where, limit,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db, auth } from './firebase';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ConversationStatus = 'active' | 'archived' | 'disabled';
export type ConversationType   = 'direct' | 'group' | 'channel';

export type LastMessage = {
  messageId: string;
  senderUid: string;
  type:      'text';
  preview:   string;
  createdAt: any;
} | null;

export type Conversation = {
  id:               string;
  type:             ConversationType;
  participantUids:  string[];
  participantKey?:  string;
  status?:          ConversationStatus;
  lastMessage?:     LastMessage;
  // legacy fields kept for screens still reading them
  memberIds?:       string[];
  lastMessageText?: string;
  lastMessageAt?:   any;
  lastSenderId?:    string;
  updatedAt?:       any;
  name?:            string;
};

export type Message = {
  id:                  string;
  conversationId:      string;
  senderUid:           string;
  type:                'text';
  text?:               string;
  status?:             'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deletedForEveryone?: boolean;
  editedAt?:           any;
  replyTo?:            any;
  createdAt:           any;
};

export type UserState = {
  uid:                 string;
  pinned?:             boolean;
  muted?:              boolean;
  archived?:           boolean;
  favorite?:           boolean;
  unreadCount?:        number;
  lastReadAt?:         any;
  lastMessagePreview?: string;
  lastMessageAt?:      any;
};

export type Typing = {
  uid:       string;
  isTyping?: boolean;
  expiresAt?: any;
};

// ─────────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────────

export function subscribeConversations(
  cb: (rows: Conversation[]) => void,
) {
  const uid = auth.currentUser?.uid;
  if (!uid) { cb([]); return () => {}; }
  const q = query(
    collection(db, 'conversations'),
    where('participantUids', 'array-contains', uid),
    orderBy('updatedAt', 'desc'),
    limit(50),
  );
  return onSnapshot(q, snap =>
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Conversation))
  );
}

export function subscribeMessages(
  conversationId: string,
  cb: (msgs: Message[]) => void,
) {
  const q = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(100),
  );
  return onSnapshot(q, snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Message[];
    cb(rows.reverse());
  });
}

export function subscribeUserState(
  conversationId: string,
  cb: (state: UserState | null) => void,
) {
  const uid = auth.currentUser?.uid;
  if (!uid) { cb(null); return () => {}; }
  return onSnapshot(
    doc(db, 'conversations', conversationId, 'userState', uid),
    snap => cb(snap.exists() ? ({ uid, ...snap.data() } as UserState) : null),
  );
}

/**
 * Subscribe to typing indicators for all participants other than the caller.
 * Filters out expired typing docs locally so the UI only renders live state.
 */
export function subscribeTyping(
  conversationId: string,
  cb: (typing: Typing[]) => void,
) {
  const me = auth.currentUser?.uid;
  return onSnapshot(collection(db, 'conversations', conversationId, 'typing'), snap => {
    const now = Date.now();
    const rows: Typing[] = [];
    for (const d of snap.docs) {
      if (d.id === me) continue;
      const data = d.data() as Typing;
      if (!data.isTyping) continue;
      const exp = data.expiresAt?.toMillis?.() ?? 0;
      if (exp > now) rows.push({ ...data, uid: d.id });
    }
    cb(rows);
  });
}

// ─────────────────────────────────────────────────────────────────
// Callable wrappers
// ─────────────────────────────────────────────────────────────────

function fn<T = unknown, R = unknown>(name: string) {
  return httpsCallable<T, R>(getFunctions(app), name);
}

export async function getOrCreateDirectConversation(otherUserId: string): Promise<string> {
  const res = await fn<{ otherUserId: string }, { conversationId: string }>(
    'getOrCreateDirectConversation',
  )({ otherUserId });
  return res.data.conversationId;
}

export async function sendTextMessage(conversationId: string, text: string): Promise<string> {
  const res = await fn<{ conversationId: string; text: string }, { messageId: string }>(
    'sendTextMessage',
  )({ conversationId, text });
  return res.data.messageId;
}

export async function markRead(conversationId: string): Promise<void> {
  await fn<{ conversationId: string }, { ok: true }>('markRead')({ conversationId });
}

let typingDebounce = 0;
export async function setTyping(conversationId: string, isTyping: boolean): Promise<void> {
  // Debounce: when "typing", only emit at most once every 2 s. "Stopped"
  // events are always sent so the receiver clears the indicator quickly.
  const now = Date.now();
  if (isTyping && now - typingDebounce < 2000) return;
  if (isTyping) typingDebounce = now;
  await fn<{ conversationId: string; isTyping: boolean }, { ok: true }>(
    'setTyping',
  )({ conversationId, isTyping });
}
