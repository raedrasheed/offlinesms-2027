// Callable: remove a member from a group.
//
// Permission matrix:
//   owner  → can remove admins or members. Cannot remove self via this
//            path — owners use leaveGroup (which has its own guard).
//   admin  → can remove admins or members. Cannot remove owner.
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

  // The roster authorizes media access. Read it in the same transaction as
  // the membership change so concurrent removals cannot restore a departed UID.
  const callerRole = await db.runTransaction(async tx => {
    const [convoSnap, callerSnap, targetSnap] = await tx.getAll(
      convoRef,
      convoRef.collection('members').doc(uid),
      convoRef.collection('members').doc(targetUid),
    );

    if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
    const convo = convoSnap.data() as { type?: string; participantUids?: string[] };
    if (convo.type !== 'group') throw new HttpsError('failed-precondition', 'not-a-group');

    const role = (callerSnap.data()?.role ?? '') as string;
    const participants = convo.participantUids ?? [];
    if (!participants.includes(uid) || (callerSnap.data()?.status ?? 'active') !== 'active'
      || (role !== 'owner' && role !== 'admin')) {
      throw new HttpsError('permission-denied', 'admins-only');
    }

    if (!targetSnap.exists) throw new HttpsError('not-found', 'member-not-found');
    if ((targetSnap.data()?.role ?? 'member') === 'owner') {
      throw new HttpsError('permission-denied', 'cannot-remove-owner');
    }

    const now = FieldValue.serverTimestamp();
    const nextParticipants = participants.filter(u => u !== targetUid);
    tx.update(convoRef, {
      participantUids: nextParticipants,
      memberIds:       nextParticipants,
      memberCount:     nextParticipants.length,
      updatedAt:       now,
    });
    tx.update(convoRef.collection('members').doc(targetUid), {
      status: 'removed',
      role: 'member',
      updatedAt: now,
    });
    return role;
  });

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
