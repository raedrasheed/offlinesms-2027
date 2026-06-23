'use server';

// Admin review of user points requests (NO payment).
//
// A user submits a pointsRequests/{id} (status='pending') asking for a package.
// An admin approves — which credits the wallet with the requested points and
// writes a canonical 'admin_adjustment' transaction atomically — or rejects it.
// Gated by manage:wallets and idempotent: a request already approved/rejected
// is a no-op.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { verifySession } from './session';
import { canDo } from './adminPermissions';

export type PointsRequestActionState = { error?: string; success?: boolean };

export async function reviewPointsRequestAction(
  requestId: string,
  outcome: 'approved' | 'rejected',
  reviewNote?: string,
): Promise<PointsRequestActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:wallets')) {
    return { error: 'Permission denied.' };
  }
  if (outcome !== 'approved' && outcome !== 'rejected') return { error: 'Invalid outcome.' };
  if (!requestId) return { error: 'Missing request.' };

  const reqRef = adminDb.collection('pointsRequests').doc(requestId);
  const note = reviewNote?.trim().slice(0, 300) || null;

  let credited = 0;
  let userId: string | undefined;
  try {
    const result = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(reqRef);
      if (!snap.exists) throw new Error('request-not-found');
      const r = snap.data() as { userId?: string; status?: string; points?: number };

      // Idempotent: terminal states are a no-op.
      if (r.status === 'approved' || r.status === 'rejected') {
        return { applied: false, userId: r.userId, points: 0 };
      }
      if (r.status !== 'pending') throw new Error(`unexpected-status:${r.status}`);

      const now = FieldValue.serverTimestamp();
      const review = {
        status: outcome, updatedAt: now, reviewedAt: now,
        reviewedByUid: session.user.uid, reviewNote: note,
      };

      if (outcome === 'rejected') {
        tx.update(reqRef, review);
        return { applied: true, userId: r.userId, points: 0 };
      }

      const points = r.points ?? 0;
      if (points <= 0 || !r.userId) throw new Error('request-misconfigured');

      const walletRef = adminDb.collection('wallets').doc(r.userId);
      const wSnap = await tx.get(walletRef);
      const balance = wSnap.exists ? ((wSnap.get('balance') as number) ?? 0) : 0;
      tx.set(walletRef, { balance: balance + points, updatedAt: now }, { merge: true });

      const txRef = adminDb.collection('transactions').doc();
      tx.set(txRef, {
        userId: r.userId, type: 'admin_adjustment', direction: 'credit',
        amount: points, status: 'completed',
        relatedPaymentId: null, relatedTransferId: null, relatedSmsBatchId: null,
        note: 'Points request approved', createdAt: now, completedAt: now,
      });

      tx.update(reqRef, review);
      return { applied: true, userId: r.userId, points };
    });

    credited = result.points;
    userId = result.userId;
  } catch (e: any) {
    const code = (e?.message as string) ?? 'error';
    if (code === 'request-not-found')       return { error: 'Request not found.' };
    if (code === 'request-misconfigured')   return { error: 'Request is misconfigured (no points/user).' };
    if (code.startsWith('unexpected-status:')) return { error: `Request is ${code.split(':')[1]} and can’t be changed.` };
    return { error: 'Could not update the request.' };
  }

  try {
    await adminDb.collection('auditLogs').add({
      action: outcome === 'approved' ? 'points.request.approved' : 'points.request.rejected',
      actorUid: session.user.uid, actorEmail: session.user.email ?? null,
      targetType: 'pointsRequest', targetId: requestId,
      result: outcome === 'approved' ? 'success' : 'failure',
      metadata: { requestId, userId: userId ?? null, credited },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  revalidatePath('/admin/points/requests');
  return { success: true };
}
