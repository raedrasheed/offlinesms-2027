// Callable: adminSetWalletStatus
//
// Freezes or unfreezes a user wallet. Requires the caller to hold
// a role with the manage:wallets capability (super_admin, finance_admin,
// legacy_admin, bootstrap_admin). Touching balance or reserved is forbidden.
// Every status change is audit-logged.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

const MANAGE_WALLET_ROLES = new Set([
  'super_admin', 'finance_admin', 'legacy_admin', 'bootstrap_admin',
]);

const ALLOWED_STATUSES = new Set(['active', 'frozen']);

export const adminSetWalletStatus = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const claims = (request.auth?.token ?? {}) as Record<string, unknown>;
  const callerRole = typeof claims.role === 'string' ? claims.role : null;
  const isLegacyAdmin = claims.admin === true;
  if (!isLegacyAdmin && (!callerRole || !MANAGE_WALLET_ROLES.has(callerRole))) {
    throw new HttpsError('permission-denied', 'manage-wallets-required');
  }

  const data = (request.data ?? {}) as { walletOwnerUid?: unknown; status?: unknown };

  if (typeof data.walletOwnerUid !== 'string' || !data.walletOwnerUid) {
    throw new HttpsError('invalid-argument', 'walletOwnerUid-required');
  }
  if (typeof data.status !== 'string' || !ALLOWED_STATUSES.has(data.status)) {
    throw new HttpsError('invalid-argument', 'status-must-be-active-or-frozen');
  }

  const walletOwnerUid: string = data.walletOwnerUid;
  const newStatus: string = data.status;

  const db = getFirestore();
  const walletRef = db.collection('wallets').doc(walletOwnerUid);
  const walletSnap = await walletRef.get();
  if (!walletSnap.exists) throw new HttpsError('not-found', 'wallet-not-found');

  const currentStatus = (walletSnap.data()?.status as string | undefined) ?? 'active';
  if (currentStatus === newStatus) {
    return { status: newStatus, changed: false };
  }

  // Only update the status field — balance and reserved are never touched.
  await walletRef.update({
    status:    newStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const action = newStatus === 'frozen' ? 'admin.wallet.frozen' : 'admin.wallet.unfrozen';
  await writeAuditLog({
    action,
    actor:  { uid, email: (claims.email as string | undefined) ?? undefined },
    target: { type: 'wallet', id: walletOwnerUid },
    result: 'success',
    metadata: {
      previousStatus: currentStatus,
      newStatus,
      callerRole: callerRole ?? (isLegacyAdmin ? 'legacy_admin' : 'unknown'),
    },
  });

  return { status: newStatus, changed: true };
});
