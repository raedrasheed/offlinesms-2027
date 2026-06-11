// Callable: promote/demote a group member.
//
// Owner or admin may call this. Cannot change the owner's role from this
// path; owner-transfer is deferred to a later phase. Target must be an
// active member, and the caller cannot change their own role.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

const ALLOWED_ROLES = new Set(['admin', 'member']);

export const changeRole = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; memberUid?: unknown; role?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  if (typeof data.memberUid !== 'string' || !data.memberUid) {
    throw new HttpsError('invalid-argument', 'memberUid-required');
  }
  if (typeof data.role !== 'string' || !ALLOWED_ROLES.has(data.role)) {
    throw new HttpsError('invalid-argument', 'role-invalid');
  }
  const nextRole = data.role as 'admin' | 'member';
  const targetUid = data.memberUid;

  if (targetUid === uid) {
    throw new HttpsError('invalid-argument', 'cannot-change-own-role');
  }

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);

  const [convoSnap, callerSnap, targetSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
    convoRef.collection('members').doc(targetUid).get(),
  ]);

  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if ((convoSnap.data() as { type?: string }).type !== 'group') {
    throw new HttpsError('failed-precondition', 'not-a-group');
  }
  const callerRole = (callerSnap.data()?.role ?? '') as string;
  const callerActive = (callerSnap.data()?.status ?? 'active') === 'active';
  if (!callerActive || (callerRole !== 'owner' && callerRole !== 'admin')) {
    throw new HttpsError('permission-denied', 'admins-only');
  }
  if (!targetSnap.exists) throw new HttpsError('not-found', 'member-not-found');
  if ((targetSnap.data()?.status ?? 'active') !== 'active') {
    throw new HttpsError('failed-precondition', 'target-inactive');
  }
  if ((targetSnap.data()?.role ?? 'member') === 'owner') {
    throw new HttpsError('failed-precondition', 'cannot-change-owner-role');
  }

  await convoRef.collection('members').doc(targetUid).update({
    role: nextRole,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'group.member.role_changed',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: {
      conversationId: convoRef.id,
      memberUid: targetUid,
      role: nextRole,
    },
  });

  return { ok: true };
});
