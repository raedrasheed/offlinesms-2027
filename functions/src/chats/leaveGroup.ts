// Callable: leave a group.
//
// - Members and admins can always leave.
// - Owner can only leave when no other active members remain
//   (owner-transfer is deferred to a later phase). Leaving as the
//   last member disables the conversation.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

export const leaveGroup = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);

  const [convoSnap, callerSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
  ]);

  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  const convo = convoSnap.data() as { type?: string; participantUids?: string[]; memberCount?: number };
  if (convo.type !== 'group') throw new HttpsError('failed-precondition', 'not-a-group');

  if (!callerSnap.exists || (callerSnap.data()?.status ?? 'active') !== 'active') {
    throw new HttpsError('failed-precondition', 'not-a-member');
  }

  const callerRole = (callerSnap.data()?.role ?? 'member') as string;
  const nextParticipants = (convo.participantUids ?? []).filter(u => u !== uid);

  if (callerRole === 'owner' && nextParticipants.length > 0) {
    throw new HttpsError('failed-precondition', 'transfer-ownership-first');
  }

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();

  if (nextParticipants.length === 0) {
    // Last person out — disable the conversation.
    batch.update(convoRef, {
      status:          'disabled',
      participantUids: nextParticipants,
      memberIds:       nextParticipants,
      memberCount:     0,
      updatedAt:       now,
    });
  } else {
    batch.update(convoRef, {
      participantUids: nextParticipants,
      memberIds:       nextParticipants,
      memberCount:     nextParticipants.length,
      updatedAt:       now,
    });
  }

  batch.update(convoRef.collection('members').doc(uid), {
    status: 'left',
    updatedAt: now,
  });

  await batch.commit();

  await writeAuditLog({
    action: 'group.member.left',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: {
      conversationId: convoRef.id,
      wasRole: callerRole,
    },
  });

  return { ok: true };
});
