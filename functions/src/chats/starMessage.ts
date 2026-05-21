// Callable: star/unstar a message for the calling user only.
//
// Owner-scoped state lives on the conversation userState doc to keep
// listener cost flat. List is FIFO-capped at 500. Not audited.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const STAR_CAP = 500;

export const starMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; messageId?: unknown; starred?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId)
    throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId)
    throw new HttpsError('invalid-argument', 'messageId-required');
  const starred = data.starred === true;

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);

  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  const convo = convoSnap.data() as { participantUids?: string[]; memberIds?: string[] };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }

  const stateRef = convoRef.collection('userState').doc(uid);
  const stateSnap = await stateRef.get();
  const existing = (stateSnap.data()?.starredMessageIds ?? []) as string[];

  let next: string[];
  if (starred) {
    if (existing.includes(data.messageId)) next = existing;
    else {
      next = [...existing, data.messageId];
      if (next.length > STAR_CAP) next.splice(0, next.length - STAR_CAP);
    }
  } else {
    next = existing.filter(id => id !== data.messageId);
  }

  await stateRef.set({
    uid,
    starredMessageIds: next,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, starred };
});
