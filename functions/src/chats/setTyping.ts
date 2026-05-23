// Callable: set the caller's typing state in a conversation.
//
// Writes conversations/{c}/typing/{uid} with an expiresAt 3 seconds ahead.
// Other participants read the doc; readers check expiresAt > now to decide
// whether to render the indicator. Deliberately NOT audited — typing events
// are too noisy to make a useful audit signal.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const TTL_MS = 3000;

export const setTyping = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; isTyping?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  const isTyping = data.isTyping === true;

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

  await convoRef.collection('typing').doc(uid).set({
    uid,
    isTyping,
    expiresAt: isTyping
      ? Timestamp.fromMillis(Date.now() + TTL_MS)
      : Timestamp.fromMillis(0),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});
