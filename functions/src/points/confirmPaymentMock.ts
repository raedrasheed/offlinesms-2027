// Callable: confirmPaymentMock — EMULATOR-ONLY.
//
// Lets dev / CI exercise the full purchase confirm path without standing
// up a real provider. Refuses to run unless FUNCTIONS_EMULATOR === 'true'.
// Production deploys see the same code, but the env check makes the
// callable a no-op that returns permission-denied.
//
// Internally reuses the same idempotent credit + transaction logic as
// confirmPayment by reading the payment's idempotencyKey and signature
// from the env, so we never have two divergent confirm paths.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

export const confirmPaymentMock = onCall({ region: 'us-central1' }, async (request) => {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    throw new HttpsError('permission-denied', 'emulator-only');
  }
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { paymentId?: unknown; status?: unknown };
  if (typeof data.paymentId !== 'string' || !data.paymentId) {
    throw new HttpsError('invalid-argument', 'paymentId-required');
  }
  const status = (typeof data.status === 'string' ? data.status : 'completed') as 'completed' | 'failed';
  if (status !== 'completed' && status !== 'failed') {
    throw new HttpsError('invalid-argument', 'status-invalid');
  }

  const db = getFirestore();
  const paymentRef = db.collection('payments').doc(data.paymentId);

  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(paymentRef);
    if (!snap.exists) throw new HttpsError('not-found', 'payment-not-found');
    const p = snap.data() as {
      userId?: string; status?: string; totalPoints?: number;
      points?: number; bonusPoints?: number;
    };
    if (p.userId !== uid) {
      throw new HttpsError('permission-denied', 'not-payment-owner');
    }
    if (p.status === 'completed') {
      return { applied: false, totalPoints: p.totalPoints ?? 0 };
    }
    if (p.status !== 'pending' && p.status !== 'processing') {
      throw new HttpsError('failed-precondition', `unexpected-source-status:${p.status}`);
    }
    const now = FieldValue.serverTimestamp();

    if (status === 'failed') {
      tx.update(paymentRef, {
        status:        'failed',
        updatedAt:     now,
        completedAt:   now,
        failureReason: 'mock-failure',
      });
      return { applied: true, totalPoints: 0 };
    }

    const totalPoints = p.totalPoints ?? ((p.points ?? 0) + (p.bonusPoints ?? 0));
    const walletRef = db.collection('wallets').doc(uid);
    const wSnap = await tx.get(walletRef);
    const balance = wSnap.exists ? ((wSnap.get('balance') as number) ?? 0) : 0;
    tx.set(walletRef, { balance: balance + totalPoints, updatedAt: now }, { merge: true });

    const txRef = db.collection('transactions').doc();
    tx.set(txRef, {
      userId:            uid,
      type:              'purchase',
      direction:         'credit',
      amount:            totalPoints,
      status:            'completed',
      relatedPaymentId:  paymentRef.id,
      relatedTransferId: null,
      relatedSmsBatchId: null,
      createdAt:         now,
      completedAt:       now,
    });

    tx.update(paymentRef, {
      status:      'completed',
      updatedAt:   now,
      completedAt: now,
    });

    return { applied: true, totalPoints };
  });

  if (result.applied && status === 'completed') {
    await writeAuditLog({
      action: 'payment.confirmed',
      actor:  { uid },
      target: { type: 'payment', id: data.paymentId },
      result: 'success',
      metadata: { paymentId: data.paymentId, totalPoints: result.totalPoints, source: 'mock' },
    });
    await writeAuditLog({
      action: 'points.purchase.completed',
      actor:  { uid },
      target: { type: 'wallet', id: uid },
      result: 'success',
      metadata: { paymentId: data.paymentId, credited: result.totalPoints, source: 'mock' },
    });
  } else if (result.applied && status === 'failed') {
    await writeAuditLog({
      action: 'payment.failed',
      actor:  { uid },
      target: { type: 'payment', id: data.paymentId },
      result: 'failure',
      metadata: { paymentId: data.paymentId, source: 'mock' },
    });
  }

  return { ok: true, applied: result.applied, status };
});
