// Callable: createPointsRequest
//
// A signed-in user asks an organization / OfflineSMS admin to assign a points
// package. This is NOT a purchase: no price, currency, checkout, or payment is
// involved. It creates a pointsRequests/{id} doc with status='pending' and
// NEVER credits the wallet — an admin approves (credits) or rejects it from the
// dashboard.
//
// To prevent spam, a user may have only one pending request at a time.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

export const createPointsRequest = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { packageId?: unknown; note?: unknown };
  if (typeof data.packageId !== 'string' || !data.packageId) {
    throw new HttpsError('invalid-argument', 'packageId-required');
  }
  const note = typeof data.note === 'string' ? data.note.trim().slice(0, 300) : null;

  const db = getFirestore();

  // Snapshot the package (name + points only — never price/bonus/currency).
  const pkgSnap = await db.collection('pointsPackages').doc(data.packageId).get();
  if (!pkgSnap.exists) throw new HttpsError('not-found', 'package-not-found');
  const pkg = pkgSnap.data() as { name?: string; points?: number; status?: string };
  if (pkg.status !== 'active') throw new HttpsError('failed-precondition', 'package-inactive');
  const points = pkg.points ?? 0;
  if (points <= 0) throw new HttpsError('failed-precondition', 'package-misconfigured');

  // One pending request at a time.
  // Atomically enforce "one pending request per user": the pending-check and
  // the create happen in a single transaction, so two concurrent requests can't
  // both pass the check. The query read joins the transaction's conflict set —
  // the second committer is retried, sees the now-existing pending doc, and
  // fails with 'request-already-pending'.
  const pendingQuery = db.collection('pointsRequests')
    .where('userId', '==', uid)
    .where('status', '==', 'pending')
    .limit(1);
  const reqRef = db.collection('pointsRequests').doc();
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async tx => {
    const pending = await tx.get(pendingQuery);
    if (!pending.empty) throw new HttpsError('failed-precondition', 'request-already-pending');
    tx.set(reqRef, {
      userId:       uid,
      packageId:    data.packageId,
      packageName:  pkg.name ?? '',
      points,                       // snapshot — what the admin will assign on approve
      note,
      status:       'pending',      // pending | approved | rejected
      createdAt:    now,
      updatedAt:    now,
      reviewedAt:   null,
      reviewedByUid: null,
      reviewNote:   null,
    });
  });

  await writeAuditLog({
    action: 'points.request.created',
    actor:  { uid },
    target: { type: 'pointsRequest', id: reqRef.id },
    result: 'success',
    metadata: { requestId: reqRef.id, packageId: data.packageId, points },
  });

  return { requestId: reqRef.id, status: 'pending', points, packageName: pkg.name ?? '' };
});
