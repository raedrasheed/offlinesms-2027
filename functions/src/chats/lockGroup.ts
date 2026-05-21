// Callable: lock/unlock a group. Owner/admin only.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

export const lockGroup = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; locked?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  const locked = data.locked === true;

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);

  const [convoSnap, callerSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
  ]);

  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if ((convoSnap.data() as { type?: string }).type !== 'group') {
    throw new HttpsError('failed-precondition', 'not-a-group');
  }
  const callerRole = (callerSnap.data()?.role ?? '') as string;
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'admins-only');
  }

  await convoRef.update({
    status:    locked ? 'locked' : 'active',
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: locked ? 'group.locked' : 'group.unlocked',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: { conversationId: convoRef.id },
  });

  return { ok: true, status: locked ? 'locked' : 'active' };
});
