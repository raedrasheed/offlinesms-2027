// Callable: setAdminClaim — admin-only; promotes another user to admin.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';

export const setAdminClaim = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth?.token?.admin) throw new HttpsError('permission-denied', 'Admins only');
  const { uid, admin } = request.data ?? {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid required');
  await getAuth().setCustomUserClaims(uid, { admin: !!admin });
  return { ok: true };
});
