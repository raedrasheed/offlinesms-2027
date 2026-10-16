// Phase 4 chat data layer.
//
// All consistency writes go through Cloud Function callables; the client
// subscribes to Firestore for live updates only. The legacy `chats.ts`
// module re-exports a subset of these helpers for screens that haven't
// migrated yet.

import type { LocationAttachment, ContactAttachment, StructuredAttachment } from '../media/attachmentModel';
import type { StickerRef, PollData } from './pollModel';
import {
  collection, doc, onSnapshot, orderBy, query, where, limit,
  setDoc, serverTimestamp, Timestamp,
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
  displayNameSnapshot?: string | null;
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
  description?:     string | null;
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
  type:              'text' | 'image' | 'voice';
  createdAt?:        any;
};

/** A single @mention inside a message's text. `startIndex`/`endIndex` mark the
 *  span of the mention token (e.g. "@Raed") within `text` so the bubble can
 *  highlight it; `userId` is the mentioned group member. */
export type Mention = {
  userId:      string;
  displayName: string;
  startIndex:  number;
  endIndex:    number;
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

export type MessageType = 'text' | 'image' | 'voice' | 'sticker' | 'poll' | 'file' | 'video' | 'audio' | 'location' | 'contact';

export type MediaUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

/** Phase 23 — media metadata stored on image/voice messages. Binary lives in
 *  Firebase Storage; this object carries metadata only (never base64). */
export type MediaInfo = {
  fileName?:      string | null;
  storagePath:    string;
  downloadURL?:   string | null;
  mimeType:       string;
  sizeBytes:      number;
  width?:         number | null;
  height?:        number | null;
  durationMs?:    number | null;   // voice
  waveform?:      number[] | null; // voice, normalized 0..1
  thumbnailPath?: string | null;   // image
  thumbnailURL?:  string | null;
  uploadStatus:   MediaUploadStatus;
  uploadProgress?: number;         // local-only, 0..1 during upload
  localUri?:      string | null;   // local-only; not persisted to Firestore
};

export type Message = {
  id:                  string;
  conversationId:      string;
  senderUid:           string;
  type:                MessageType;
  text?:               string;
  caption?:            string;       // Phase 23 — image caption
  media?:              MediaInfo | null; // Phase 23 — image/voice metadata
  status?:             'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  deletedForEveryone?: boolean;
  deletedAt?:          any;
  deletedBy?:          string | null;
  deleteReason?:       string | null;
  editedAt?:           any;
  replyTo?:            ReplyTo | null;
  mentions?:           Mention[] | null;
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
  // Local-only: last send/upload failure (e.g. a failed media upload's storage
  // error code), surfaced in MessageInfo so it isn't logcat-only.
  errorCode?:          string | null;
  errorMessage?:       string | null;
  // Stickers / polls (type 'sticker' | 'poll'); `text` holds a short fallback.
  sticker?:            StickerRef | null;
  poll?:               PollData | null;
  location?:           LocationAttachment | null;
  contact?:            ContactAttachment | null;
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
  uid:                 string;
  isTyping?:           boolean;
  expiresAt?:          any;
  // Presence activity (Phase 24) — recording shares the typing doc so it needs
  // no extra rules; readers honour an independent TTL (recordingExpiresAt).
  isRecording?:        boolean;
  recordingExpiresAt?: any;
};

/** One participant's live activity in a chat (typing and/or recording). */
export type Activity = {
  uid:         string;
  isTyping:    boolean;
  isRecording: boolean;
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
  return onSnapshot(
    q,
    snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Message[];
      cb(rows.reverse());
    },
    // Without an error sink a failed query (e.g. a transient rules failure or
    // missing index) leaves the screen stuck on "Loading messages…" forever.
    err => { if (__DEV__) console.warn('[conversations] subscribeMessages failed:', err); },
  );
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
    err => { if (__DEV__) console.warn('[conversations] subscribeUserState failed:', err); },
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

/**
 * Subscribe to live activity (typing AND recording) for every participant
 * other than the caller. Each flag honours its own TTL so a stale doc never
 * keeps an indicator stuck.
 */
export function subscribeActivity(
  conversationId: string,
  cb: (rows: Activity[]) => void,
) {
  const me = auth.currentUser?.uid;
  return onSnapshot(collection(db, 'conversations', conversationId, 'typing'), snap => {
    const now = Date.now();
    const rows: Activity[] = [];
    for (const d of snap.docs) {
      if (d.id === me) continue;
      const data = d.data() as Typing;
      const typingLive    = data.isTyping    === true && (data.expiresAt?.toMillis?.() ?? 0) > now;
      const recordingLive  = data.isRecording === true && (data.recordingExpiresAt?.toMillis?.() ?? 0) > now;
      if (typingLive || recordingLive) {
        rows.push({ uid: d.id, isTyping: typingLive, isRecording: recordingLive });
      }
    }
    cb(rows);
  });
}

const RECORDING_TTL_MS = 8000;

/**
 * Publish the caller's recording state. Written directly to the owner-writable
 * typing doc (merge, so it never clobbers the typing flag). Refresh while a
 * long recording continues so the TTL doesn't lapse mid-recording.
 */
export async function setRecording(conversationId: string, isRecording: boolean): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await setDoc(
    doc(db, 'conversations', conversationId, 'typing', uid),
    {
      uid,
      isRecording,
      recordingExpiresAt: isRecording
        ? Timestamp.fromMillis(Date.now() + RECORDING_TTL_MS)
        : Timestamp.fromMillis(0),
    },
    { merge: true },
  );
}

// ─────────────────────────────────────────────────────────────────
// Presence — online/last-seen via a heartbeat on the user doc.
// "online" is derived from lastSeen freshness (no extra field/rules needed).
// ─────────────────────────────────────────────────────────────────

/** Freshness window: an `online:true` user whose lastSeen is older than this is
 *  treated as offline anyway (covers a crash that never wrote online:false). */
export const ONLINE_WINDOW_MS = 45000;

export interface PresenceSnapshot {
  online: boolean;       // explicit flag (instant offline on background)
  lastSeenAt: number | null;
}

/** Write the caller's presence: explicit online flag + lastSeen heartbeat. */
export async function writePresence(online: boolean): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await setDoc(
    doc(db, 'users', uid),
    { online, lastSeen: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Heartbeat: keep online=true and lastSeen fresh while foregrounded. */
export const updateLastSeen = () => writePresence(true);

/** Subscribe to another user's presence (explicit flag + lastSeen). */
export function subscribePresence(uid: string, cb: (p: PresenceSnapshot) => void) {
  return onSnapshot(
    doc(db, 'users', uid),
    snap => {
      const d = snap.exists() ? snap.data() : null;
      cb({ online: d?.online === true, lastSeenAt: d?.lastSeen?.toMillis?.() ?? null });
    },
    () => cb({ online: false, lastSeenAt: null }),
  );
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
  mentions?: Mention[] | null,
): Promise<string> {
  const res = await fn<
    { conversationId: string; text: string; replyTo?: ReplyTo | null; mentions?: Mention[] | null },
    { messageId: string }
  >('sendTextMessage')({ conversationId, text, replyTo: replyTo ?? null, mentions: mentions ?? null });
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

// ── External phone contacts (Phase 25) ──────────────────────────────────────

export type ExternalMember = {
  contactId:       string;
  displayName:     string;
  phoneE164:       string;
  normalizedPhone: string;
  isRegistered:    boolean;
  linkedUid:       string | null;
};

export async function createPhoneContact(args: { displayName: string; phoneNumber: string; defaultCountry?: string }) {
  const res = await fn<typeof args, { contactId: string; phoneE164: string; displayName: string; isRegistered: boolean; linkedUid: string | null; created: boolean }>(
    'createPhoneContact',
  )(args);
  return res.data;
}

export async function addExternalContactToGroup(args: {
  conversationId: string; contactId?: string; displayName?: string; phoneNumber?: string; defaultCountry?: string;
}) {
  const res = await fn<typeof args, { added: number; contactId: string; isRegistered?: boolean; alreadyMember?: boolean; alreadyExternal?: boolean }>(
    'addExternalContactToGroup',
  )(args);
  return res.data;
}

export async function removeExternalContactFromGroup(conversationId: string, contactId: string): Promise<void> {
  await fn<{ conversationId: string; contactId: string }, { removed: number }>(
    'removeExternalContactFromGroup',
  )({ conversationId, contactId });
}

export function subscribeExternalMembers(
  conversationId: string,
  cb: (rows: ExternalMember[]) => void,
) {
  return onSnapshot(
    collection(db, 'conversations', conversationId, 'externalMembers'),
    snap => cb(snap.docs.map(d => ({ contactId: d.id, ...(d.data() as Omit<ExternalMember, 'contactId'>) }))),
    err => { if (__DEV__) console.warn('[conversations] subscribeExternalMembers failed:', err); },
  );
}

// ── Group invite links (Phase 26) ───────────────────────────────────────────

export type InviteJoinMode = 'open' | 'approval_required';

export type InviteSettings = {
  enabled: boolean;
  inviteCode?: string;
  joinMode: InviteJoinMode;
  revokedAt?: unknown;
};

export type JoinRequest = {
  requestId: string;
  requesterUid: string;
  requesterName: string | null;
  requesterPhotoURL?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedAt?: any;
};

export type InvitePreview = {
  conversationId: string;
  groupName: string;
  groupPhotoURL: string | null;
  memberCount: number;
  joinMode: InviteJoinMode;
  isMember: boolean;
  hasPendingRequest: boolean;
  status: 'can_join' | 'already_member' | 'request_pending' | 'disabled';
};

export async function createOrUpdateGroupInviteLink(conversationId: string, enabled: boolean, joinMode: InviteJoinMode) {
  const res = await fn<{ conversationId: string; enabled: boolean; joinMode: InviteJoinMode }, { inviteCode: string; enabled: boolean; joinMode: InviteJoinMode; url: string }>(
    'createOrUpdateGroupInviteLink',
  )({ conversationId, enabled, joinMode });
  return res.data;
}

export async function resetGroupInviteLink(conversationId: string) {
  const res = await fn<{ conversationId: string }, { inviteCode: string; url: string }>('resetGroupInviteLink')({ conversationId });
  return res.data;
}

export async function resolveGroupInviteLink(inviteCode: string): Promise<InvitePreview> {
  const res = await fn<{ inviteCode: string }, InvitePreview>('resolveGroupInviteLink')({ inviteCode });
  return res.data;
}

export async function joinGroupByInviteLink(inviteCode: string) {
  const res = await fn<{ inviteCode: string }, { status: 'joined' | 'pending' | 'already_member'; conversationId: string }>('joinGroupByInviteLink')({ inviteCode });
  return res.data;
}

export async function approveGroupJoinRequest(conversationId: string, requestId: string) {
  await fn<{ conversationId: string; requestId: string }, { ok: true }>('approveGroupJoinRequest')({ conversationId, requestId });
}

export async function rejectGroupJoinRequest(conversationId: string, requestId: string, reason?: string) {
  await fn<{ conversationId: string; requestId: string; reason?: string }, { ok: true }>('rejectGroupJoinRequest')({ conversationId, requestId, reason });
}

export async function cancelMyJoinRequest(conversationId: string, requestId: string) {
  await fn<{ conversationId: string; requestId: string }, { ok: true }>('cancelMyJoinRequest')({ conversationId, requestId });
}

export function subscribeInviteSettings(conversationId: string, cb: (s: InviteSettings | null) => void) {
  return onSnapshot(
    doc(db, 'conversations', conversationId, 'inviteSettings', 'current'),
    snap => cb(snap.exists() ? (snap.data() as InviteSettings) : null),
    err => { if (__DEV__) console.warn('[conversations] subscribeInviteSettings failed:', err); },
  );
}

export function subscribePendingJoinRequests(conversationId: string, cb: (rows: JoinRequest[]) => void) {
  return onSnapshot(
    query(collection(db, 'conversations', conversationId, 'joinRequests'), where('status', '==', 'pending')),
    snap => cb(snap.docs.map(d => ({ requestId: d.id, ...(d.data() as Omit<JoinRequest, 'requestId'>) }))),
    err => { if (__DEV__) console.warn('[conversations] subscribePendingJoinRequests failed:', err); },
  );
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

/** Update group name/description/avatar (owner/admin only). Only provided
 *  fields change; pass null to clear description/avatar. */
export async function updateGroupInfo(
  conversationId: string,
  patch: { name?: string; description?: string | null; avatarUrl?: string | null },
): Promise<void> {
  await fn<{ conversationId: string } & typeof patch, { ok: true }>(
    'updateGroupInfo',
  )({ conversationId, ...patch });
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
    err => { if (__DEV__) console.warn('[conversations] subscribeMembers failed:', err); },
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

/** Vote in a poll (direct callable; the local-first path queues it instead).
 *  `seq` orders this voter's votes so a late retry never overrides a newer one. */
export async function votePoll(conversationId: string, messageId: string, optionIds: string[]): Promise<void> {
  await fn<{ conversationId: string; messageId: string; optionIds: string[]; seq: number }, { ok: true }>('votePoll')({
    conversationId, messageId, optionIds, seq: Date.now(),
  });
}

/** End a poll (creator only). */
export async function closePoll(conversationId: string, messageId: string): Promise<void> {
  await fn<{ conversationId: string; messageId: string }, { ok: true }>('closePoll')({ conversationId, messageId });
}

/** Send a sticker or a poll when the local-first path is off (legacy path). */
export async function sendRichMessage(
  conversationId: string,
  rich: { kind: 'sticker'; sticker: { packId: string; stickerId: string } } | { kind: 'poll'; poll: { question: string; options: string[]; multiple: boolean } } | StructuredAttachment,
): Promise<string> {
  const res = await fn<Record<string, unknown>, { messageId: string }>('sendTextMessage')({ conversationId, ...rich });
  return res.data.messageId;
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
