// Callable: edit a text message.
//
// Sender-only, within EDIT_WINDOW_MS (15 minutes) of createdAt. Rejects
// deleted messages and non-text messages. Updates conversation.lastMessage
// preview when the edited message is the latest one. Audited as
// message.edited with { conversationId, messageId, length } — never the body.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

const TEXT_MAX = 4000;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
const PREVIEW_MAX = 80;

function buildPreview(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > PREVIEW_MAX ? t.slice(0, PREVIEW_MAX - 1) + '…' : t;
}

export const editMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; messageId?: unknown; text?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId)
    throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId)
    throw new HttpsError('invalid-argument', 'messageId-required');
  if (typeof data.text !== 'string')
    throw new HttpsError('invalid-argument', 'text-required');

  const text = data.text.trim();
  if (text.length === 0)        throw new HttpsError('invalid-argument', 'text-empty');
  if (text.length > TEXT_MAX)   throw new HttpsError('invalid-argument', 'text-too-long');

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const msgRef = convoRef.collection('messages').doc(data.messageId);

  const [convoSnap, msgSnap] = await Promise.all([convoRef.get(), msgRef.get()]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if (!msgSnap.exists)   throw new HttpsError('not-found', 'message-not-found');

  const convo = convoSnap.data() as { participantUids?: string[]; memberIds?: string[]; lastMessage?: { messageId?: string } };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }

  const msg = msgSnap.data() as { senderUid?: string; senderId?: string; type?: string; deletedForEveryone?: boolean; createdAt?: Timestamp };
  const senderUid = msg.senderUid ?? msg.senderId;
  if (senderUid !== uid) throw new HttpsError('permission-denied', 'not-message-sender');
  if (msg.type !== 'text') throw new HttpsError('failed-precondition', 'only-text-editable');
  if (msg.deletedForEveryone) throw new HttpsError('failed-precondition', 'message-deleted');

  const createdMs = (msg.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (createdMs > 0 && Date.now() - createdMs > EDIT_WINDOW_MS) {
    throw new HttpsError('failed-precondition', 'edit-window-closed');
  }

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.update(msgRef, {
    text,
    editedAt:  now,
    updatedAt: now,
  });

  // Update conversation summary preview if this was the latest message.
  if (convo.lastMessage?.messageId === data.messageId) {
    const preview = buildPreview(text);
    batch.update(convoRef, {
      lastMessage: {
        ...(convo.lastMessage as object),
        preview,
      },
      lastMessageText: preview,
      updatedAt:       now,
    });
  }

  await batch.commit();

  await writeAuditLog({
    action: 'message.edited',
    actor:  { uid },
    target: { type: 'message', id: data.messageId },
    result: 'success',
    metadata: {
      conversationId: data.conversationId,
      messageId:      data.messageId,
      length:         text.length,
    },
  });

  return { ok: true };
});
