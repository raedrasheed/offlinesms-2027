// Callable: send a text message to a conversation the caller participates in.
//
// Audit metadata records the message id and length — never the body.
// The conversation summary, recipient unread counters, and receipt
// fan-out are handled by the onMessageCreate trigger.

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
  if (text.length === 0) {
    throw new HttpsError('invalid-argument', 'text-empty');
  }
  if (text.length > TEXT_MAX) {
    throw new HttpsError('invalid-argument', 'text-too-long');
  }

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) {
    throw new HttpsError('not-found', 'conversation-not-found');
  }
  const convo = convoSnap.data() as {
    participantUids?: string[];
    memberIds?: string[];
    status?: string;
  };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }
  if (convo.status === 'disabled') {
    throw new HttpsError('failed-precondition', 'conversation-disabled');
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
  });

  // Audit metadata never carries the body. The sanitiser in writeAuditLog
  // strips body/content/messageText keys defensively if a future caller
  // mis-uses this contract.
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
