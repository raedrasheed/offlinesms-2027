'use server';

// Admin-driven payment confirmation.
//
// Mirrors the confirmPayment callable's transaction (the webhook stand-in):
// crediting a pending payment's wallet + writing a canonical 'purchase'
// transaction atomically, or marking it failed. Gated by manage:wallets and
// idempotent — a payment already completed/failed is a no-op.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { verifySession } from './session';
import { canDo } from './adminPermissions';

export type PaymentActionState = { error?: string; success?: boolean };

export async function confirmPaymentAction(
  paymentId: string,
  outcome: 'completed' | 'failed',
  failureReason?: string,
): Promise<PaymentActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:wallets')) {
    return { error: 'Permission denied.' };
  }
  if (outcome !== 'completed' && outcome !== 'failed') return { error: 'Invalid outcome.' };
  if (!paymentId) return { error: 'Missing payment.' };

  const paymentRef = adminDb.collection('payments').doc(paymentId);

  let credited = 0;
  let userId: string | undefined;
  try {
    const result = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(paymentRef);
      if (!snap.exists) throw new Error('payment-not-found');
      const p = snap.data() as {
        userId?: string; status?: string;
        totalPoints?: number; points?: number; bonusPoints?: number;
      };

      // Idempotent: terminal states are a no-op.
      if (p.status === 'completed') return { applied: false, userId: p.userId, totalPoints: 0 };
      if (p.status === 'failed' && outcome === 'failed') return { applied: false, userId: p.userId, totalPoints: 0 };
      if (p.status !== 'pending' && p.status !== 'processing') {
        throw new Error(`unexpected-status:${p.status}`);
      }

      const now = FieldValue.serverTimestamp();

      if (outcome === 'failed') {
        tx.update(paymentRef, {
          status: 'failed', updatedAt: now, completedAt: now,
          failureReason: failureReason?.trim() || 'declined-by-admin',
        });
        return { applied: true, userId: p.userId, totalPoints: 0 };
      }

      const totalPoints = p.totalPoints ?? ((p.points ?? 0) + (p.bonusPoints ?? 0));
      if (totalPoints <= 0 || !p.userId) throw new Error('payment-misconfigured');

      const walletRef = adminDb.collection('wallets').doc(p.userId);
      const wSnap = await tx.get(walletRef);
      const balance = wSnap.exists ? ((wSnap.get('balance') as number) ?? 0) : 0;
      tx.set(walletRef, { balance: balance + totalPoints, updatedAt: now }, { merge: true });

      const txRef = adminDb.collection('transactions').doc();
      tx.set(txRef, {
        userId: p.userId, type: 'purchase', direction: 'credit',
        amount: totalPoints, status: 'completed',
        relatedPaymentId: paymentRef.id, relatedTransferId: null, relatedSmsBatchId: null,
        package: null, createdAt: now, completedAt: now,
      });

      tx.update(paymentRef, { status: 'completed', updatedAt: now, completedAt: now });
      return { applied: true, userId: p.userId, totalPoints };
    });

    credited = result.totalPoints;
    userId = result.userId;
  } catch (e: any) {
    const code = (e?.message as string) ?? 'error';
    if (code === 'payment-not-found')   return { error: 'Payment not found.' };
    if (code === 'payment-misconfigured') return { error: 'Payment is misconfigured (no points/user).' };
    if (code.startsWith('unexpected-status:')) return { error: `Payment is ${code.split(':')[1]} and can’t be changed.` };
    return { error: 'Could not update the payment.' };
  }

  try {
    await adminDb.collection('auditLogs').add({
      action: outcome === 'completed' ? 'payment.confirmed' : 'payment.failed',
      actorUid: session.user.uid, actorEmail: session.user.email ?? null,
      targetType: 'payment', targetId: paymentId,
      result: outcome === 'completed' ? 'success' : 'failure',
      metadata: { paymentId, userId: userId ?? null, credited },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  revalidatePath('/admin/points/payments');
  return { success: true };
}
