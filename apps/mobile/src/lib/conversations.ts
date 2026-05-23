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

export type ConversationStatus = 'active' | 'archived' | 'disabled' | 'locked';
export type ConversationType   = 'direct' | 'group' | 'channel';
export type GroupRole          = 'owner' | 'admin' | 'member';
export type MemberStatus       = 'active' | 'removed' | 'left';

export type GroupSettings = {
  onlyAdminsCanSend:       boolean;
  onlyAdminsCanEditInfo:   boolean;
  onlyAdminsCanAddMembers: boolean;
};

export type GroupMember = {
  uid:                 string;
  role:                GroupRole;
  status?:             MemberStatus;
  displayNameSnapshot?: string;
  photoURLSnapshot?:   string | null;
  joinedAt?:           any;
  addedBy?:            string;
};

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
  participantKey?:  string | null;
  status?:          ConversationStatus;
  lastMessage?:     LastMessage;
  // legacy fields kept for screens still reading them
  memberIds?:       string[];
  lastMessageText?: string;
  lastMessageAt?:   any;
  lastSenderId?:    string;
  updatedAt?:       any;
  // group-only (Phase 5)
  name?:            string;
  avatarUrl?:       string | null;
  ownerUid?:        string;
  memberCount?:     number;
  settings?:        GroupSettings;
  createdBy?:       string;
  // Phase 6
  pinnedMessage?:   PinnedMessage;
};

export type ReplyTo = {
  messageId:         string;
  senderUid:         string;
  senderDisplayName: string;
  preview:           string;
  type:              'text';
  createdAt?:        any;
};

export type ForwardedFrom = {
  conversationId: string;
  messageId:      string;
  senderUid?:     string;
};

export type PinnedMessage = {
  messageId:          string;
  senderUid:          string;
  senderDisplayName?: string | null;
  preview:            string;
  pinnedAt:           any;
  pinnedBy:           string;
} | null;

export type Message = {
  id:                  string;
  conversationId:      string;
  senderUid:           string;
  type:                'text';
  text?:               string;
  status?:             'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deletedForEveryone?: boolean;
  deletedAt?:          any;
  deletedBy?:          string | null;
  deleteReason?:       string | null;
  editedAt?:           any;
  replyTo?:            ReplyTo | null;
  forwarded?:          boolean;
  forwardedFrom?:      ForwardedFrom | null;
  reactions?:          Record<string, string[]> | null;
  pinnedAt?:           any;
  pinnedBy?:           string | null;
  expiresAt?:          any;
  createdAt:           any;
  // Group-only sender snapshots (Phase 5)
  senderDisplayName?:  string | null;
  senderPhotoURL?:     string | null;
  // Phase 7 aggregate counts (server-owned)
  deliveredCount?:     number;
  readCount?:          number;
  viewedCount?:        number;
  playedCount?:        number;
  failedCount?:        number;
  pendingCount?:       number;
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
  // Phase 6 — per-user message state
  starredMessageIds?:      string[];
  deletedForMeMessageIds?: string[];
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
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Conversation)),
    err => {
      // Don't leave the UI hung on a permanent loader: surface the empty
      // state so the user sees something actionable, and log the cause.
      // eslint-disable-next-line no-console
      console.warn('subscribeConversations error:', err?.code ?? err?.message ?? err);
      cb([]);
    },
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

export async function sendTextMessage(
  conversationId: string,
  text: string,
  replyTo?: ReplyTo | null,
): Promise<string> {
  const res = await fn<
    { conversationId: string; text: string; replyTo?: ReplyTo | null },
    { messageId: string }
  >('sendTextMessage')({ conversationId, text, replyTo: replyTo ?? null });
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

// ─────────────────────────────────────────────────────────────────
// Phase 5 — Groups
// ─────────────────────────────────────────────────────────────────

export async function createGroup(args: {
  name: string;
  memberUids: string[];
  avatarUrl?: string | null;
}): Promise<{ conversationId: string; memberCount: number }> {
  const res = await fn<typeof args, { conversationId: string; memberCount: number }>(
    'createGroup',
  )(args);
  return res.data;
}

export async function addGroupMembers(conversationId: string, memberUids: string[]): Promise<number> {
  const res = await fn<{ conversationId: string; memberUids: string[] }, { added: number }>(
    'addMembers',
  )({ conversationId, memberUids });
  return res.data.added;
}

export async function removeGroupMember(conversationId: string, memberUid: string): Promise<void> {
  await fn<{ conversationId: string; memberUid: string }, { ok: true }>(
    'removeMember',
  )({ conversationId, memberUid });
}

export async function changeGroupRole(
  conversationId: string,
  memberUid: string,
  role: 'admin' | 'member',
): Promise<void> {
  await fn<{ conversationId: string; memberUid: string; role: 'admin' | 'member' }, { ok: true }>(
    'changeRole',
  )({ conversationId, memberUid, role });
}

export async function leaveGroup(conversationId: string): Promise<void> {
  await fn<{ conversationId: string }, { ok: true }>(
    'leaveGroup',
  )({ conversationId });
}

export async function lockGroup(conversationId: string, locked: boolean): Promise<void> {
  await fn<{ conversationId: string; locked: boolean }, { ok: true; status: string }>(
    'lockGroup',
  )({ conversationId, locked });
}

export function subscribeMembers(
  conversationId: string,
  cb: (rows: GroupMember[]) => void,
) {
  return onSnapshot(
    collection(db, 'conversations', conversationId, 'members'),
    snap => {
      const rows = snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as GroupMember))
        .filter(m => (m.status ?? 'active') === 'active');
      cb(rows);
    },
  );
}

/** Friendly mapping for callable error codes surfaced from the Phase 5 path. */
export function groupErrorCopy(code: string): string {
  switch (code) {
    case 'functions/already-exists':
    case 'already-exists':
      return 'That already exists.';
    case 'functions/permission-denied':
    case 'permission-denied':
      return 'You don’t have permission for this action.';
    case 'functions/failed-precondition':
    case 'failed-precondition':
      return 'This action isn’t available right now.';
    case 'functions/invalid-argument':
    case 'invalid-argument':
      return 'Please check the values and try again.';
    case 'functions/not-found':
    case 'not-found':
      return 'Not found.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** Decode the underlying message body of a callable error so the UI can show
 *  the exact reason for a few cases that we care about (locked, admin-only,
 *  transfer-ownership, too-many, etc.). */
export function groupCallableErrorReason(err: unknown): string | null {
  const msg = (err as { message?: string })?.message ?? '';
  if (!msg) return null;
  // Firebase callable errors look like 'group-locked' / 'admins-only' / ...
  return msg.includes(':') ? msg.split(':')[0] : msg;
}

// ─────────────────────────────────────────────────────────────────
// Phase 6 — message action callables
// ─────────────────────────────────────────────────────────────────

export const REACTION_EMOJIS: readonly string[] = [
  '👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉',
];

export async function editMessage(conversationId: string, messageId: string, text: string): Promise<void> {
  await fn<{ conversationId: string; messageId: string; text: string }, { ok: true }>(
    'editMessage',
  )({ conversationId, messageId, text });
}

export async function deleteMessage(
  conversationId: string,
  messageId: string,
  mode: 'for_me' | 'for_everyone',
): Promise<void> {
  await fn<{ conversationId: string; messageId: string; mode: 'for_me' | 'for_everyone' }, { ok: true }>(
    'deleteMessage',
  )({ conversationId, messageId, mode });
}

export async function reactToMessage(
  conversationId: string,
  messageId: string,
  emoji: string,
): Promise<{ toggledOff: boolean }> {
  const res = await fn<
    { conversationId: string; messageId: string; emoji: string },
    { ok: true; emoji: string; toggledOff: boolean }
  >('reactToMessage')({ conversationId, messageId, emoji });
  return { toggledOff: res.data.toggledOff };
}

export async function starMessage(conversationId: string, messageId: string, starred: boolean): Promise<void> {
  await fn<{ conversationId: string; messageId: string; starred: boolean }, { ok: true }>(
    'starMessage',
  )({ conversationId, messageId, starred });
}

export async function pinMessage(conversationId: string, messageId: string, pinned: boolean): Promise<void> {
  await fn<{ conversationId: string; messageId: string; pinned: boolean }, { ok: true }>(
    'pinMessage',
  )({ conversationId, messageId, pinned });
}

export async function forwardMessages(args: {
  sourceConversationId: string;
  messageIds: string[];
  targetConversationIds: string[];
}): Promise<{ forwarded: number; targets: number }> {
  const res = await fn<typeof args, { ok: true; forwarded: number; targets: number }>(
    'forwardMessages',
  )(args);
  return { forwarded: res.data.forwarded, targets: res.data.targets };
}

export type ReceiptStatus = 'pending' | 'delivered' | 'read' | 'viewed' | 'played' | 'failed';

export type ReceiptDetail = {
  uid:           string;
  displayName:   string | null;
  photoURL:      string | null;
  role:          GroupRole | null;
  status:        ReceiptStatus;
  deliveredAt:   any | null;
  readAt:        any | null;
  viewedAt:      any | null;
  playedAt:      any | null;
  failedAt:      any | null;
  failureReason: string | null;
};

export type ReceiptAggregates = {
  deliveredCount: number;
  readCount:      number;
  viewedCount:    number;
  playedCount:    number;
  failedCount:    number;
  pendingCount:   number;
};

export type MessageInfo = {
  messageId:          string;
  conversationId:     string;
  type:               'text';
  senderUid:          string | null;
  senderDisplayName:  string | null;
  createdAt:          any;
  editedAt:           any;
  deletedForEveryone: boolean;
  deletedAt:          any;
  pinnedAt:           any;
  pinnedBy:           string | null;
  forwarded:          boolean;
  forwardedFrom:      ForwardedFrom | null;
  replyTo:            ReplyTo | null;

  // Phase 7
  aggregates?:        ReceiptAggregates;
  isSender?:          boolean;
  isGroup?:           boolean;
  recipients?:        ReceiptDetail[] | null;

  // Phase 6 back-compat fields kept on the response.
  reactions:          Record<string, number>;
  receiptCounts:      Record<string, number>;
};

export async function getMessageInfo(conversationId: string, messageId: string): Promise<MessageInfo> {
  const res = await fn<{ conversationId: string; messageId: string }, MessageInfo>(
    'getMessageInfo',
  )({ conversationId, messageId });
  return res.data;
}

// ─────────────────────────────────────────────────────────────────
// Phase 7 — receipt callable with client-side rate limiting
// ─────────────────────────────────────────────────────────────────

/** In-memory dedupe of (messageId, status) pairs per session. */
const sentReceipts = new Set<string>();
let receiptFlushTimer: ReturnType<typeof setTimeout> | null = null;
let receiptQueue: Array<{ conversationId: string; messageId: string; status: ReceiptStatus }> = [];

async function flushReceiptQueue() {
  const queue = receiptQueue;
  receiptQueue = [];
  receiptFlushTimer = null;
  const call = fn<{ conversationId: string; messageId: string; status: ReceiptStatus }, { ok: true }>('markReceipt');
  for (const r of queue) {
    try { await call(r); } catch { /* best-effort */ }
  }
}

/**
 * Mark the caller's receipt for a message.
 * - Dedupes (messageId, status) so repeated calls during the same session
 *   are no-ops.
 * - Debounces by 300 ms so a fast scroll doesn't blast the callable.
 * The server still enforces monotonic transitions, so even if the client
 * loses the dedupe state across reloads the receipt can't downgrade.
 */
export function markReceipt(conversationId: string, messageId: string, status: ReceiptStatus) {
  const key = `${messageId}:${status}`;
  if (sentReceipts.has(key)) return;
  sentReceipts.add(key);
  receiptQueue.push({ conversationId, messageId, status });
  if (receiptFlushTimer == null) {
    receiptFlushTimer = setTimeout(() => { flushReceiptQueue().catch(() => {}); }, 300);
  }
}

/** Clear the dedupe set — used when switching accounts. */
export function resetReceiptCache() {
  sentReceipts.clear();
  receiptQueue = [];
  if (receiptFlushTimer != null) { clearTimeout(receiptFlushTimer); receiptFlushTimer = null; }
}

// ─────────────────────────────────────────────────────────────────
// Phase 7 — status views (foundation; status UI lands later)
// ─────────────────────────────────────────────────────────────────

export async function markStatusViewed(statusId: string): Promise<void> {
  await fn<{ statusId: string }, { ok: true }>('markStatusViewed')({ statusId });
}
