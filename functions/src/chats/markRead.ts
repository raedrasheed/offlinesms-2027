// Callable: mark a conversation as read for the caller.
//
// Resets the caller's userState.unreadCount and sets lastReadAt. Updating
// per-message receipts (the `read` status fan-out) lands in Phase 7 when
// the receipts UI is wired; the receipt enum guard is already in place.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

export const markRead = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) {
    throw new HttpsError('not-found', 'conversation-not-found');
  }
  const convo = convoSnap.data() as { participantUids?: string[]; memberIds?: string[] };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }

  await convoRef.collection('userState').doc(uid).set({
    uid,
    unreadCount: 0,
    lastReadAt:  FieldValue.serverTimestamp(),
    updatedAt:   FieldValue.serverTimestamp(),
  }, { merge: true });

  await writeAuditLog({
    action: 'chat.markRead',
    actor:  { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
  });

  return { ok: true };
});
