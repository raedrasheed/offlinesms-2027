// Callable: setAdminClaim — admin-only; promotes (or demotes) another user.
//
// Phase 3: every call is audit-logged via writeAuditLog. The custom claim
// payload preserves any existing claims so we don't accidentally clear
// `role` or downstream permissions when toggling `admin`.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';

export const setAdminClaim = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.token?.admin) {
    await writeAuditLog({
      action: 'admin.claim.set',
      actor:  { uid: request.auth?.uid ?? 'anonymous' },
      target: request.data?.uid ? { type: 'user', id: String(request.data.uid) } : null,
      result: 'failure',
      metadata: { reason: 'not-admin' },
    });
    throw new HttpsError('permission-denied', 'Admins only');
  }

  const data = (request.data ?? {}) as { uid?: unknown; admin?: unknown };
  if (typeof data.uid !== 'string' || !data.uid) {
    throw new HttpsError('invalid-argument', 'uid required');
  }
  const targetUid = data.uid;
  const nextAdmin = !!data.admin;

  // Preserve any existing claims (role, permissions, etc.) and only
  // toggle the `admin` boolean.
  const existing = (await getAuth().getUser(targetUid)).customClaims ?? {};
  const nextClaims = { ...existing, admin: nextAdmin };
  await getAuth().setCustomUserClaims(targetUid, nextClaims);

  await writeAuditLog({
    action: 'admin.claim.set',
    actor:  { uid: request.auth.uid },
    target: { type: 'user', id: targetUid },
    result: 'success',
    metadata: {
      admin: nextAdmin,
      previousAdmin: existing.admin === true,
    },
  });

  return { ok: true };
});
