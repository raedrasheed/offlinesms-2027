// Admin callable: lock/unlock a group WITHOUT requiring the caller to be a member.
//
// This is the admin-native equivalent of the mobile lockGroup callable. It bypasses
// the membership check that lockGroup enforces, making it suitable for dashboard
// admins who are not group members.
//
// The mobile lockGroup callable is unchanged — group owners/admins still use it.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

export const adminLockGroup = onCall({ region: 'us-central1' }, async (request) => {
  const callerUid = request.auth?.uid;
  const callerClaims = (request.auth?.token ?? {}) as Record<string, unknown>;

  if (!callerUid || !callerClaims.admin) {
    await writeAuditLog({
      action: 'admin.group.locked',
      actor:  { uid: callerUid ?? 'anonymous' },
      result: 'failure',
      metadata: { reason: 'not-admin' },
    });
    throw new HttpsError('permission-denied', 'Admins only');
  }

  const data = (request.data ?? {}) as { conversationId?: unknown; locked?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  const locked = data.locked === true;

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const convoSnap = await convoRef.get();

  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if ((convoSnap.data() as { type?: string }).type !== 'group') {
    throw new HttpsError('failed-precondition', 'not-a-group');
  }

  const nextStatus = locked ? 'locked' : 'active';
  await convoRef.update({ status: nextStatus, updatedAt: FieldValue.serverTimestamp() });

  await writeAuditLog({
    action: locked ? 'admin.group.locked' : 'admin.group.unlocked',
    actor:  { uid: callerUid, email: request.auth?.token?.email as string | undefined },
    target: { type: 'conversation', id: data.conversationId },
    result: 'success',
    metadata: { conversationId: data.conversationId, locked },
  });

  return { ok: true, status: nextStatus };
});
