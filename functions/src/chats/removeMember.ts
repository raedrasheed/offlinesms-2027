// Callable: remove a member from a group.
//
// Permission matrix:
//   owner  → can remove admins or members. Cannot remove self via this
//            path — owners use leaveGroup (which has its own guard).
//   admin  → can remove members only. Cannot remove owner. Cannot
//            remove another admin (only owner can demote/remove admins).
//   member → denied.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

export const removeMember = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; memberUid?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  if (typeof data.memberUid !== 'string' || !data.memberUid) {
    throw new HttpsError('invalid-argument', 'memberUid-required');
  }
  const targetUid = data.memberUid;
  if (targetUid === uid) {
    throw new HttpsError('invalid-argument', 'use-leave-group');
  }

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);

  const [convoSnap, callerSnap, targetSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
    convoRef.collection('members').doc(targetUid).get(),
  ]);

  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  const convo = convoSnap.data() as { type?: string; participantUids?: string[]; memberCount?: number };
  if (convo.type !== 'group') throw new HttpsError('failed-precondition', 'not-a-group');

  const callerRole = (callerSnap.data()?.role ?? '') as string;
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'admins-only');
  }

  if (!targetSnap.exists) throw new HttpsError('not-found', 'member-not-found');
  const targetRole = (targetSnap.data()?.role ?? 'member') as string;

  if (targetRole === 'owner') {
    throw new HttpsError('permission-denied', 'cannot-remove-owner');
  }
  if (callerRole === 'admin' && targetRole === 'admin') {
    throw new HttpsError('permission-denied', 'owner-required-to-remove-admin');
  }

  const now = FieldValue.serverTimestamp();
  const nextParticipants = (convo.participantUids ?? []).filter(u => u !== targetUid);

  const batch = db.batch();
  batch.update(convoRef, {
    participantUids: nextParticipants,
    memberIds:       nextParticipants,
    memberCount:     nextParticipants.length,
    updatedAt:       now,
  });
  batch.update(convoRef.collection('members').doc(targetUid), {
    status: 'removed',
    role: 'member',
    updatedAt: now,
  });

  await batch.commit();

  await writeAuditLog({
    action: 'group.member.removed',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: {
      conversationId: convoRef.id,
      memberUid: targetUid,
      byRole: callerRole,
    },
  });

  return { ok: true };
});
