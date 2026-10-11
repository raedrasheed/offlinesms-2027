// Callable: send a text message to a conversation the caller participates in.
//
// Phase 4 path: validates membership + text length, writes the message,
// audits as chat.message.sent with { conversationId, length } only.
//
// Phase 5 additions for groups:
//   - Reject when conversation status is 'locked' or 'disabled' unless the
//     caller is owner/admin (locked) — disabled is hard-stop for everyone.
//   - Reject when settings.onlyAdminsCanSend is true and the caller isn't
//     owner/admin.
//   - Reject when the caller's membership status isn't 'active'.
//   - Capture senderDisplayName + senderPhotoURL snapshots on the message
//     doc so the chat UI can render sender headers without joining /users.
//
// Stickers and polls (kind: 'sticker' | 'poll') use this same callable so they
// get exactly the same membership / lock / admins-only / block / idempotency
// gates as text. A sticker is validated against the server catalog (no client
// URLs); a poll is validated by pollLogic.buildPoll. Both also carry a short
// `text` fallback, so older app versions show "👋" / "📊 question" instead of
// an empty bubble.
//
// Audit metadata never carries the body. The conversation summary,
// recipient unread counters, and receipt fan-out are handled by the
// onMessageCreate trigger.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { cleanNameSnapshot, publicNameFrom } from '../lib/displayName';
import { assertDirectNotBlocked } from './blockGuard';
import { findSticker } from './stickerCatalog';
import { buildPoll, pollFallbackText, PollError, type PollDoc } from './pollLogic';

const TEXT_MAX = 4000;

export const sendTextMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    conversationId?: unknown; text?: unknown; replyTo?: unknown; mentions?: unknown;
    localId?: unknown; idempotencyKey?: unknown;
    kind?: unknown; sticker?: unknown; poll?: unknown;
  };
  const kind: 'text' | 'sticker' | 'poll' = data.kind === 'sticker' || data.kind === 'poll' ? data.kind : 'text';
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  // Phase 22 — optional client idempotency. When the offline-first client
  // retries an ambiguous send it passes the same clientLocalId; we return the
  // already-created message instead of inserting a duplicate.
  const clientLocalId = typeof data.localId === 'string' && data.localId ? data.localId : null;
  const clientIdempotencyKey = typeof data.idempotencyKey === 'string' && data.idempotencyKey
    ? data.idempotencyKey : null;
  let text: string;
  let sticker: { packId: string; stickerId: string; alt: string } | null = null;
  let poll: PollDoc | null = null;
  if (kind === 'sticker') {
    const ref = (data.sticker ?? {}) as { packId?: unknown; stickerId?: unknown };
    const st = findSticker(ref.packId, ref.stickerId);
    if (!st) throw new HttpsError('invalid-argument', 'sticker-unknown');
    sticker = { packId: st.packId, stickerId: st.id, alt: st.alt };
    text = st.alt;
  } else if (kind === 'poll') {
    try { poll = buildPoll(data.poll); }
    catch (e) { throw new HttpsError('invalid-argument', e instanceof PollError ? e.code : 'poll-invalid'); }
    text = pollFallbackText(poll.question);
  } else {
    if (typeof data.text !== 'string') {
      throw new HttpsError('invalid-argument', 'text-required');
    }
    text = data.text.trim();
    if (text.length === 0)       throw new HttpsError('invalid-argument', 'text-empty');
    if (text.length > TEXT_MAX)  throw new HttpsError('invalid-argument', 'text-too-long');
  }

  // Optional replyTo. Validate shape; trust the caller for messageId — the
  // referenced message lives in the same conversation and we don't need to
  // round-trip another read here. If the caller spoofs the preview the
  // worst case is a wrong quote rendered to participants who can already
  // read the original message.
  let replyTo:
    | null
    | {
        messageId:         string;
        senderUid:         string;
        senderDisplayName: string;
        preview:           string;
        type:              'text';
        createdAt:         unknown;
      } = null;
  if (data.replyTo != null && kind !== 'poll') {
    const r = data.replyTo as Record<string, unknown>;
    if (typeof r.messageId !== 'string' || !r.messageId)
      throw new HttpsError('invalid-argument', 'replyTo.messageId-required');
    replyTo = {
      messageId:         r.messageId,
      senderUid:         typeof r.senderUid === 'string' ? r.senderUid : '',
      senderDisplayName: typeof r.senderDisplayName === 'string' ? r.senderDisplayName.slice(0, 80) : '',
      preview:           typeof r.preview === 'string' ? r.preview.slice(0, 200) : '',
      type:              'text',
      createdAt:         r.createdAt ?? null,
    };
  }

  // Optional @mentions. Validate shape and clamp; membership filtering happens
  // once participants are known (a user can't be mentioned outside the group).
  const MENTION_MAX = 50;
  type RawMention = { userId: string; displayName: string; startIndex: number; endIndex: number };
  let rawMentions: RawMention[] = [];
  if (kind === 'text' && Array.isArray(data.mentions)) {
    for (const item of data.mentions.slice(0, MENTION_MAX)) {
      const r = item as Record<string, unknown>;
      if (typeof r?.userId !== 'string' || !r.userId) continue;
      if (typeof r?.displayName !== 'string') continue;
      const startIndex = typeof r.startIndex === 'number' ? r.startIndex : -1;
      const endIndex = typeof r.endIndex === 'number' ? r.endIndex : -1;
      if (startIndex < 0 || endIndex <= startIndex || endIndex > text.length) continue;
      rawMentions.push({ userId: r.userId, displayName: r.displayName.slice(0, 80), startIndex, endIndex });
    }
  }

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) {
    throw new HttpsError('not-found', 'conversation-not-found');
  }
  const convo = convoSnap.data() as {
    type?:            string;
    participantUids?: string[];
    memberIds?:       string[];
    status?:          string;
    settings?:        { onlyAdminsCanSend?: boolean };
  };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }
  // Only mentions of actual conversation members survive — never mention someone
  // outside the group.
  const participantSet = new Set(participants);
  const mentions = rawMentions.filter(m => participantSet.has(m.userId));
  if (convo.status === 'disabled') {
    throw new HttpsError('failed-precondition', 'conversation-disabled');
  }
  // Direct chats: reject if either side has blocked the other.
  await assertDirectNotBlocked(db, convo, uid);

  const isGroup = convo.type === 'group';
  let senderDisplayName: string | null = null;
  let senderPhotoURL:    string | null = null;

  if (isGroup) {
    const memberSnap = await convoRef.collection('members').doc(uid).get();
    if (!memberSnap.exists) {
      throw new HttpsError('permission-denied', 'not-a-member');
    }
    const member = memberSnap.data() as { role?: string; status?: string;
                                          displayNameSnapshot?: string;
                                          photoURLSnapshot?: string | null };
    if ((member.status ?? 'active') !== 'active') {
      throw new HttpsError('permission-denied', 'not-an-active-member');
    }
    const role = member.role ?? 'member';
    const isPrivileged = role === 'owner' || role === 'admin';

    if (convo.status === 'locked' && !isPrivileged) {
      throw new HttpsError('failed-precondition', 'group-locked');
    }
    if (convo.settings?.onlyAdminsCanSend === true && !isPrivileged) {
      throw new HttpsError('permission-denied', 'admins-only');
    }

    senderDisplayName = cleanNameSnapshot(member.displayNameSnapshot, uid);
    senderPhotoURL    = member.photoURLSnapshot    ?? null;

    // Fall back to the live user doc if the membership snapshot is empty (or
    // a legacy uid). Never store the uid as a name: null when there is none.
    if (!senderDisplayName) {
      const userSnap = await db.collection('users').doc(uid).get();
      const u = (userSnap.data() ?? {}) as { displayName?: string; username?: string; photoURL?: string };
      senderDisplayName = publicNameFrom(u, uid);
      senderPhotoURL    = senderPhotoURL ?? u.photoURL ?? null;
    }
  }

  // Idempotency: if a message with this clientLocalId already exists in the
  // conversation, return it rather than creating a duplicate. clientLocalId is
  // globally unique per device, so a single-field index is sufficient.
  if (clientLocalId) {
    const dupSnap = await convoRef.collection('messages')
      .where('clientLocalId', '==', clientLocalId).limit(1).get();
    if (!dupSnap.empty) {
      return { messageId: dupSnap.docs[0].id, idempotent: true };
    }
  }

  const msgRef = convoRef.collection('messages').doc();
  const now = FieldValue.serverTimestamp();
  await msgRef.set({
    conversationId:     convoRef.id,
    senderUid:          uid,
    senderId:           uid,           // back-compat alias
    type:               kind,
    text,
    ...(sticker ? { sticker } : {}),
    ...(poll ? { poll } : {}),
    status:             'sent',
    deletedForEveryone: false,
    editedAt:           null,
    replyTo,
    mentions:           mentions.length > 0 ? mentions : null,
    forwarded:          false,
    forwardedFrom:      null,
    reactions:          null,
    pinnedAt:           null,
    pinnedBy:           null,
    expiresAt:          null,
    createdAt:          now,
    updatedAt:          now,
    clientLocalId,
    idempotencyKey:     clientIdempotencyKey,
    ...(isGroup ? { senderDisplayName, senderPhotoURL } : {}),
  });

  // Fire-and-forget — writeAuditLog already soft-fails internally, and on the
  // send hot path we don't want to add a Firestore round-trip to the client
  // response time. A failed log won't roll back the message.
  void writeAuditLog({
    action: 'chat.message.sent',
    actor:  { uid },
    target: { type: 'message', id: msgRef.id },
    result: 'success',
    metadata: {
      conversationId: convoRef.id,
      length:         text.length,
      kind,
    },
  }).catch(() => {});

  return { messageId: msgRef.id, idempotent: false };
});
