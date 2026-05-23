// Callable: confirmPayment — webhook stand-in.
//
// Verifies a shared secret (PAYMENT_WEBHOOK_SECRET env var). Idempotent
// on the payment's idempotencyKey: a duplicate event for a payment
// already in status 'completed' is a no-op and returns success without
// re-crediting. Failed payments transition the doc to 'failed' but
// never credit the wallet.
//
// The signature comparison is constant-time. The secret is read from
// env; nothing on the request body is trusted to be authoritative.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { timingSafeEqual } from 'node:crypto';
import { writeAuditLog } from '../lib/auditLog';

function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch { return false; }
}

export const confirmPayment = onCall({ region: 'us-central1' }, async (request) => {
  const data = (request.data ?? {}) as {
    paymentId?:      unknown;
    idempotencyKey?: unknown;
    status?:         unknown;
    signature?:      unknown;
    failureReason?:  unknown;
    providerReference?: unknown;
  };

  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) throw new HttpsError('unavailable', 'payment-webhook-not-configured');
  if (typeof data.signature !== 'string' || !constantTimeEqual(data.signature, secret)) {
    throw new HttpsError('permission-denied', 'invalid-signature');
  }

  if (typeof data.paymentId !== 'string' || !data.paymentId) {
    throw new HttpsError('invalid-argument', 'paymentId-required');
  }
  if (typeof data.idempotencyKey !== 'string' || !data.idempotencyKey) {
    throw new HttpsError('invalid-argument', 'idempotencyKey-required');
  }
  const status = data.status as string;
  if (status !== 'completed' && status !== 'failed') {
    throw new HttpsError('invalid-argument', 'status-invalid');
  }

  const db = getFirestore();
  const paymentRef = db.collection('payments').doc(data.paymentId);

  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(paymentRef);
    if (!snap.exists) throw new HttpsError('not-found', 'payment-not-found');
    const p = snap.data() as {
      userId?: string; idempotencyKey?: string;
      status?: string; totalPoints?: number;
      points?: number; bonusPoints?: number;
    };
    if (p.idempotencyKey !== data.idempotencyKey) {
      throw new HttpsError('permission-denied', 'idempotency-mismatch');
    }

    // Already-completed dedupe.
    if (p.status === 'completed') {
      return { applied: false, reason: 'already-completed', userId: p.userId, totalPoints: p.totalPoints ?? 0 };
    }
    if (p.status === 'failed' && status === 'failed') {
      return { applied: false, reason: 'already-failed', userId: p.userId, totalPoints: 0 };
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
        failureReason: typeof data.failureReason === 'string' ? data.failureReason : 'unknown',
        providerReference: typeof data.providerReference === 'string' ? data.providerReference : null,
      });
      return { applied: true, status: 'failed', userId: p.userId, totalPoints: 0 };
    }

    // status === 'completed': credit the wallet AND write a canonical
    // 'purchase' transaction in the same transaction so a partial
    // failure doesn't leave an orphan credit.
    const totalPoints = p.totalPoints ?? ((p.points ?? 0) + (p.bonusPoints ?? 0));
    if (totalPoints <= 0 || !p.userId) {
      throw new HttpsError('failed-precondition', 'payment-misconfigured');
    }

    const walletRef = db.collection('wallets').doc(p.userId);
    const wSnap = await tx.get(walletRef);
    const balance = wSnap.exists ? ((wSnap.get('balance') as number) ?? 0) : 0;
    tx.set(walletRef, {
      balance:  balance + totalPoints,
      updatedAt: now,
    }, { merge: true });

    const txRef = db.collection('transactions').doc();
    tx.set(txRef, {
      userId:            p.userId,
      type:              'purchase',
      direction:         'credit',
      amount:            totalPoints,
      status:            'completed',
      relatedPaymentId:  paymentRef.id,
      relatedTransferId: null,
      relatedSmsBatchId: null,
      createdAt:         now,
      completedAt:       now,
      // legacy alias still surfaced for older clients
      package:           null,
    });

    tx.update(paymentRef, {
      status:            'completed',
      updatedAt:         now,
      completedAt:       now,
      providerReference: typeof data.providerReference === 'string' ? data.providerReference : null,
    });

    return { applied: true, status: 'completed', userId: p.userId, totalPoints };
  });

  if (status === 'completed' && result.applied) {
    await writeAuditLog({
      action: 'payment.confirmed',
      actor:  { uid: result.userId ?? 'system' },
      target: { type: 'payment', id: data.paymentId },
      result: 'success',
      metadata: { paymentId: data.paymentId, totalPoints: result.totalPoints },
    });
    await writeAuditLog({
      action: 'points.purchase.completed',
      actor:  { uid: result.userId ?? 'system' },
      target: { type: 'wallet', id: result.userId ?? '' },
      result: 'success',
      metadata: { paymentId: data.paymentId, credited: result.totalPoints },
    });
  } else if (status === 'failed' && result.applied) {
    await writeAuditLog({
      action: 'payment.failed',
      actor:  { uid: result.userId ?? 'system' },
      target: { type: 'payment', id: data.paymentId },
      result: 'failure',
      metadata: { paymentId: data.paymentId },
    });
  }

  return { ok: true, applied: result.applied, status };
});
