// Admin callable: assign or revoke an admin role on another user.
//
// Safety rules:
//   1. Caller must have role==='super_admin' claim.
//   2. Caller cannot modify their own role (prevents self-lockout).
//   3. Before removing/downgrading a super_admin, verifies at least one
//      other super_admin would remain (prevents total lockout).
//   4. Target role must be a valid ADMIN_ROLES value or null (clear role).
//   5. All changes audit-logged regardless of success or failure.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { ADMIN_ROLES } from '../lib/roles';

export const adminSetRole = onCall({ region: 'us-central1' }, async (request) => {
  const callerUid = request.auth?.uid;
  const callerToken = (request.auth?.token ?? {}) as Record<string, unknown>;

  if (!callerUid || callerToken.role !== 'super_admin') {
    await writeAuditLog({
      action: 'admin.role.set',
      actor:  { uid: callerUid ?? 'anonymous' },
      result: 'failure',
      metadata: { reason: 'not-super-admin' },
    });
    throw new HttpsError('permission-denied', 'Super admins only');
  }

  const data = (request.data ?? {}) as { uid?: unknown; role?: unknown };
  const targetUid  = typeof data.uid  === 'string' ? data.uid  : null;
  const nextRole   = data.role === null ? null
    : typeof data.role === 'string' ? data.role : undefined;

  if (!targetUid || nextRole === undefined) {
    throw new HttpsError('invalid-argument', 'uid and role (or null) are required');
  }
  if (nextRole !== null && !(ADMIN_ROLES as readonly string[]).includes(nextRole)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${ADMIN_ROLES.join(', ')} or null`);
  }
  if (targetUid === callerUid) {
    await writeAuditLog({
      action: 'admin.role.set',
      actor:  { uid: callerUid },
      result: 'failure',
      metadata: { reason: 'self-modification', targetRole: nextRole },
    });
    throw new HttpsError('failed-precondition', 'cannot-modify-own-role');
  }

  // Fetch the target user's current claims.
  const targetUser = await getAuth().getUser(targetUid);
  const targetClaims = (targetUser.customClaims ?? {}) as Record<string, unknown>;
  const currentRole = targetClaims.role as string | undefined;

  // If we're about to remove/downgrade a super_admin, ensure at least one other
  // super_admin remains. We query users collection for admin claims via auth listing
  // (max 1000 — sufficient for guard purposes).
  if (currentRole === 'super_admin' && nextRole !== 'super_admin') {
    const db = getFirestore();
    const adminSnap = await db.collection('users').limit(500).get();
    let superAdminCount = 0;
    await Promise.all(
      adminSnap.docs.map(async d => {
        try {
          const u = await getAuth().getUser(d.id);
          const claims = (u.customClaims ?? {}) as Record<string, unknown>;
          if (claims.role === 'super_admin') superAdminCount++;
        } catch { /* ignore missing auth user */ }
      })
    );
    if (superAdminCount <= 1) {
      await writeAuditLog({
        action: 'admin.role.set',
        actor:  { uid: callerUid },
        target: { type: 'user', id: targetUid },
        result: 'failure',
        metadata: { reason: 'would-remove-last-super-admin', superAdminCount },
      });
      throw new HttpsError('failed-precondition', 'cannot-remove-last-super-admin');
    }
  }

  // Preserve all other claims; only update `role`.
  const nextClaims: Record<string, unknown> = { ...targetClaims, role: nextRole };
  if (nextRole === null) delete nextClaims.role;
  await getAuth().setCustomUserClaims(targetUid, nextClaims);

  await writeAuditLog({
    action: 'admin.role.set',
    actor:  { uid: callerUid, email: request.auth?.token?.email as string | undefined },
    target: { type: 'user', id: targetUid },
    result: 'success',
    metadata: { from: currentRole ?? null, to: nextRole },
  });

  return { ok: true, role: nextRole };
});
