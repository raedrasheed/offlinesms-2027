// Callable: createPurchase
//
// Creates a payments/{id} doc with status='pending'. NEVER credits the
// wallet. Returns paymentId + checkoutUrl for the mobile UI to surface.
//
// The real credit happens in confirmPayment (or confirmPaymentMock in
// the emulator), which validates a shared secret and is idempotent on
// the payment's idempotencyKey.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { writeAuditLog } from '../lib/auditLog';

export const createPurchase = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { packageId?: unknown };
  if (typeof data.packageId !== 'string' || !data.packageId) {
    throw new HttpsError('invalid-argument', 'packageId-required');
  }

  const db = getFirestore();
  const pkgSnap = await db.collection('pointsPackages').doc(data.packageId).get();
  if (!pkgSnap.exists) throw new HttpsError('not-found', 'package-not-found');
  const pkg = pkgSnap.data() as {
    points?: number; bonusPoints?: number; price?: number;
    currency?: string; status?: string;
  };
  if (pkg.status !== 'active') {
    throw new HttpsError('failed-precondition', 'package-inactive');
  }
  const points       = pkg.points ?? 0;
  const bonusPoints  = pkg.bonusPoints ?? 0;
  const totalPoints  = points + bonusPoints;
  const amount       = pkg.price ?? 0;
  const currency     = pkg.currency ?? 'EUR';
  if (points <= 0 || amount <= 0) {
    throw new HttpsError('failed-precondition', 'package-misconfigured');
  }

  const idempotencyKey = randomUUID();
  const paymentRef = db.collection('payments').doc();
  const now = FieldValue.serverTimestamp();

  await paymentRef.set({
    userId:           uid,
    packageId:        data.packageId,
    points,
    bonusPoints,
    totalPoints,
    amount,
    currency,
    status:           'pending',
    idempotencyKey,
    checkoutUrl:      null,        // populated by a real provider integration later
    providerReference: null,
    createdAt:        now,
    updatedAt:        now,
    completedAt:      null,
    failureReason:    null,
  });

  await writeAuditLog({
    action: 'payment.created',
    actor:  { uid },
    target: { type: 'payment', id: paymentRef.id },
    result: 'success',
    metadata: {
      paymentId: paymentRef.id,
      packageId: data.packageId,
      totalPoints,
      amount,
      currency,
    },
  });

  return {
    paymentId:      paymentRef.id,
    idempotencyKey,
    checkoutUrl:    null,
    points,
    bonusPoints,
    totalPoints,
    amount,
    currency,
    status:         'pending',
  };
});
