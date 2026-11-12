import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { orgSenderUid } from './orgMessagingService';
import { decideReview, type ReviewOutcome } from './pointsRequestLogic';

function isDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('/') && value !== '.' && value !== '..';
}

/** Review a request after the caller verifies permission to manage wallets. */
export async function reviewPointsRequest(
  requestId: string,
  outcome: ReviewOutcome,
  reviewer: { uid: string; email?: string },
  reviewNote?: string,
): Promise<{ organizationId: string | null }> {
  if (outcome !== 'approved' && outcome !== 'rejected') throw new Error('invalid-outcome');
  if (!isDocumentId(requestId)) throw new Error('invalid-request');

  const reqRef = adminDb.collection('pointsRequests').doc(requestId);
  const note = typeof reviewNote === 'string' ? reviewNote.trim().slice(0, 300) || null : null;

  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new Error('request-not-found');
    const r = snap.data() as { userId?: string; organizationId?: unknown; status?: string; points?: number };
    const orgId = isDocumentId(r.organizationId) ? r.organizationId : null;

    const decision = decideReview({
      status: r.status ?? '', outcome, points: r.points ?? 0, userId: r.userId,
    });
    if (decision.kind === 'noop') return { organizationId: orgId };
    if (decision.kind === 'error') {
      throw new Error(decision.code === 'unexpected-status' ? `unexpected-status:${r.status}` : 'request-misconfigured');
    }

    const now = FieldValue.serverTimestamp();
    const points = decision.kind === 'credit' ? decision.points : 0;

    if (decision.kind === 'credit') {
      if (!isDocumentId(r.userId)) throw new Error('request-misconfigured');
      if (r.organizationId != null || r.userId.startsWith(orgSenderUid(''))) {
        if (!orgId || r.userId !== orgSenderUid(orgId) || !Number.isSafeInteger(points)) {
          throw new Error('request-misconfigured');
        }
        const org = await tx.get(adminDb.collection('organizations').doc(orgId));
        if (!org.exists || org.get('status') !== 'active') throw new Error('organization-inactive');
      }

      const walletRef = adminDb.collection('wallets').doc(r.userId);
      const wallet = await tx.get(walletRef);
      const balance = wallet.get('balance') ?? 0;
      if (!Number.isFinite(balance) || !Number.isFinite(balance + points)) throw new Error('wallet-misconfigured');
      tx.set(walletRef, {
        balance: balance + points,
        ...(wallet.exists ? {} : { reserved: 0, createdAt: now }),
        updatedAt: now,
      }, { merge: true });

      tx.create(adminDb.collection('transactions').doc(), {
        userId: r.userId, uid: r.userId, type: 'admin_adjustment', direction: 'credit',
        amount: points, status: 'completed',
        relatedPaymentId: null, relatedTransferId: null, relatedSmsBatchId: null,
        pointsRequestId: requestId, ...(orgId ? { organizationId: orgId } : {}),
        note: 'Points request approved', createdAt: now, completedAt: now,
      });
    }

    tx.update(reqRef, {
      status: outcome, updatedAt: now, reviewedAt: now,
      reviewedByUid: reviewer.uid, reviewNote: note,
    });
    tx.create(adminDb.collection('auditLogs').doc(), {
      action: outcome === 'approved' ? 'points.request.approved' : 'points.request.rejected',
      actorUid: reviewer.uid, actorEmail: reviewer.email ?? null,
      targetType: 'pointsRequest', targetId: requestId,
      result: outcome === 'approved' ? 'success' : 'failure',
      metadata: { requestId, userId: r.userId ?? null, organizationId: orgId, credited: points },
      createdAt: now,
    });
    return { organizationId: orgId };
  });
}
