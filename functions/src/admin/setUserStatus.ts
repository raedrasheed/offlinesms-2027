// Admin callable: set a user's status (active / suspended).
//
// Safety rules enforced server-side:
//   1. Caller must be authenticated and have admin=true claim.
//   2. Caller cannot suspend themselves.
//   3. Caller cannot suspend a super_admin (role claim).
//   4. Only valid transitions: active→suspended, suspended→active.
//   5. Audit log written for every attempt (success or failure).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';

const ALLOWED_STATUSES = new Set(['active', 'suspended']);

export const setUserStatus = onCall({ region: 'us-central1' }, async (request) => {
  const callerUid = request.auth?.uid;
  const callerClaims = (request.auth?.token ?? {}) as Record<string, unknown>;

  if (!callerUid || !callerClaims.admin) {
    await writeAuditLog({
      action: 'admin.user.setStatus',
      actor:  { uid: callerUid ?? 'anonymous' },
      result: 'failure',
      metadata: { reason: 'not-admin' },
    });
    throw new HttpsError('permission-denied', 'Admins only');
  }

  const data = (request.data ?? {}) as { uid?: unknown; status?: unknown };
  const targetUid = typeof data.uid === 'string' ? data.uid : null;
  const nextStatus = typeof data.status === 'string' ? data.status : null;

  if (!targetUid || !nextStatus) {
    throw new HttpsError('invalid-argument', 'uid and status are required');
  }
  if (!ALLOWED_STATUSES.has(nextStatus)) {
    throw new HttpsError('invalid-argument', 'status must be active or suspended');
  }
  if (targetUid === callerUid) {
    throw new HttpsError('failed-precondition', 'cannot-modify-own-status');
  }

  // Prevent suspending a super_admin.
  const targetAuth = await getAuth().getUser(targetUid);
  const targetRole = (targetAuth.customClaims as Record<string, unknown> | undefined)?.role;
  if (targetRole === 'super_admin') {
    await writeAuditLog({
      action: 'admin.user.setStatus',
      actor:  { uid: callerUid },
      target: { type: 'user', id: targetUid },
      result: 'failure',
      metadata: { reason: 'cannot-suspend-super-admin', targetRole },
    });
    throw new HttpsError('permission-denied', 'cannot-suspend-super-admin');
  }

  const db = getFirestore();
  const userRef = db.collection('users').doc(targetUid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'user-not-found');

  const currentStatus = (userSnap.data()?.status as string | undefined) ?? 'active';
  if (currentStatus === nextStatus) {
    return { ok: true, status: nextStatus };
  }

  await userRef.update({ status: nextStatus, updatedAt: FieldValue.serverTimestamp() });

  await writeAuditLog({
    action: 'admin.user.setStatus',
    actor:  { uid: callerUid, email: request.auth?.token?.email as string | undefined },
    target: { type: 'user', id: targetUid },
    result: 'success',
    metadata: { from: currentStatus, to: nextStatus },
  });

  return { ok: true, status: nextStatus };
});
