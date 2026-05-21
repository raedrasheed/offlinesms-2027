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
// Audit metadata never carries the body. The conversation summary,
// recipient unread counters, and receipt fan-out are handled by the
// onMessageCreate trigger.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

const TEXT_MAX = 4000;

export const sendTextMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; text?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  if (typeof data.text !== 'string') {
    throw new HttpsError('invalid-argument', 'text-required');
  }
  const text = data.text.trim();
  if (text.length === 0)       throw new HttpsError('invalid-argument', 'text-empty');
  if (text.length > TEXT_MAX)  throw new HttpsError('invalid-argument', 'text-too-long');

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
  if (convo.status === 'disabled') {
    throw new HttpsError('failed-precondition', 'conversation-disabled');
  }

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

    senderDisplayName = member.displayNameSnapshot ?? null;
    senderPhotoURL    = member.photoURLSnapshot    ?? null;

    // Fall back to the live user doc if the membership snapshot is empty.
    if (!senderDisplayName) {
      const userSnap = await db.collection('users').doc(uid).get();
      const u = (userSnap.data() ?? {}) as { displayName?: string; photoURL?: string };
      senderDisplayName = u.displayName ?? uid;
      senderPhotoURL    = senderPhotoURL ?? u.photoURL ?? null;
    }
  }

  const msgRef = convoRef.collection('messages').doc();
  const now = FieldValue.serverTimestamp();
  await msgRef.set({
    conversationId:     convoRef.id,
    senderUid:          uid,
    senderId:           uid,           // back-compat alias
    type:               'text',
    text,
    status:             'sent',
    deletedForEveryone: false,
    editedAt:           null,
    replyTo:            null,
    createdAt:          now,
    updatedAt:          now,
    ...(isGroup ? { senderDisplayName, senderPhotoURL } : {}),
  });

  await writeAuditLog({
    action: 'chat.message.sent',
    actor:  { uid },
    target: { type: 'message', id: msgRef.id },
    result: 'success',
    metadata: {
      conversationId: convoRef.id,
      length:         text.length,
    },
  });

  return { messageId: msgRef.id };
});
