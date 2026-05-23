// Admin callable: assign a role scoped to a specific organization.
//
// Only super_admin callers may invoke this.
// Sets both `role` and `organizationId` in the target user's custom claims.
// Passing organizationId=null clears the org scope (making it a plain role).
// Passing role=null clears both role and organizationId.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';
import { ADMIN_ROLES } from '../lib/roles';

export const adminSetOrgRole = onCall({ region: 'us-central1' }, async (request) => {
  const callerUid = request.auth?.uid;
  const callerToken = (request.auth?.token ?? {}) as Record<string, unknown>;

  if (!callerUid || callerToken.role !== 'super_admin') {
    await writeAuditLog({
      action: 'admin.org_role.set',
      actor:  { uid: callerUid ?? 'anonymous' },
      result: 'failure',
      metadata: { reason: 'not-super-admin' },
    });
    throw new HttpsError('permission-denied', 'Super admins only');
  }

  const data = (request.data ?? {}) as { uid?: unknown; role?: unknown; organizationId?: unknown };
  const targetUid     = typeof data.uid            === 'string' ? data.uid : null;
  const nextRole      = data.role === null ? null
    : typeof data.role === 'string' ? data.role : undefined;
  const nextOrgId     = data.organizationId === null ? null
    : typeof data.organizationId === 'string' ? data.organizationId : undefined;

  if (!targetUid || nextRole === undefined || nextOrgId === undefined) {
    throw new HttpsError('invalid-argument', 'uid, role (or null), and organizationId (or null) are required');
  }
  if (nextRole !== null && !(ADMIN_ROLES as readonly string[]).includes(nextRole)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${ADMIN_ROLES.join(', ')} or null`);
  }
  if (targetUid === callerUid) {
    throw new HttpsError('failed-precondition', 'cannot-modify-own-role');
  }

  const targetUser = await getAuth().getUser(targetUid);
  const targetClaims = (targetUser.customClaims ?? {}) as Record<string, unknown>;
  const currentRole  = targetClaims.role as string | undefined;
  const currentOrgId = targetClaims.organizationId as string | undefined;

  const nextClaims: Record<string, unknown> = { ...targetClaims };
  if (nextRole === null) {
    delete nextClaims.role;
    delete nextClaims.organizationId;
  } else {
    nextClaims.role = nextRole;
    if (nextOrgId === null) {
      delete nextClaims.organizationId;
    } else {
      nextClaims.organizationId = nextOrgId;
    }
  }

  await getAuth().setCustomUserClaims(targetUid, nextClaims);

  await writeAuditLog({
    action: 'admin.org_role.set',
    actor:  { uid: callerUid, email: request.auth?.token?.email as string | undefined },
    target: { type: 'user', id: targetUid },
    result: 'success',
    metadata: {
      from: { role: currentRole ?? null, organizationId: currentOrgId ?? null },
      to:   { role: nextRole, organizationId: nextOrgId },
    },
  });

  return { ok: true, role: nextRole, organizationId: nextOrgId };
});
