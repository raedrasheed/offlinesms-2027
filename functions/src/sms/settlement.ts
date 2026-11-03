import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { smsBatchUnitCost } from './messageFormat';

/** Wallet, settlement marker and deterministic ledger rows commit atomically.
 * Firestore delivers triggers at least once; the same guard is shared by the
 * ordinary completion path and stale-batch recovery. */
export async function settleSmsBatch(db: Firestore, batchId: string, reap = false) {
  const ref = db.collection('smsBatches').doc(batchId);
  return db.runTransaction(async tx => {
    const batchSnap = await tx.get(ref);
    if (!batchSnap.exists) return null;
    const batch = batchSnap.data()!;
    if (!batch.senderId || batch.pointsRefunded != null) return null;
    const allowed = reap ? ['sending', 'accepted'] : ['accepted', 'partial', 'completed', 'failed'];
    if (!allowed.includes(batch.status)) return null;
    // A queued/leased relay job can still hand off the SMS. Never refund its
    // wallet hold while the device is able to send it later.
    if (reap) {
      const liveJobs = await tx.get(db.collection('relayJobs').where('batchId', '==', batchId)
        .where('status', 'in', ['queued', 'claimed', 'sending']).limit(1));
      if (!liveJobs.empty) return null;
    }
    const recipients = await tx.get(ref.collection('recipients'));
    const walletRef = db.collection('wallets').doc(batch.senderId);
    const wallet = await tx.get(walletRef);
    const delivered = recipients.docs.filter(r => r.get('smsStatus') === 'delivered').length;
    const queued = recipients.docs.filter(r => r.get('smsStatus') === 'queued').length;
    const handedOff = recipients.docs.filter(r => r.get('smsStatus') === 'sent').length;
    const failed = recipients.docs.filter(r => ['failed', 'undelivered'].includes(r.get('smsStatus'))).length;
    const skipped = recipients.docs.filter(r => r.get('smsStatus') === 'skipped').length;
    const sent = delivered + handedOff + (reap ? 0 : queued);
    const failedCount = failed + (reap ? queued : 0);
    const unitCost = smsBatchUnitCost(batch);
    const reserved = typeof batch.pointsReserved === 'number' && Number.isFinite(batch.pointsReserved)
      ? Math.max(0, batch.pointsReserved) : (batch.recipientCount ?? 0) * unitCost;
    const actualCost = Math.min(reserved, sent * unitCost);
    const refund = Math.max(0, reserved - actualCost);
    const now = FieldValue.serverTimestamp();
    tx.set(walletRef, {
      balance: (wallet.get('balance') ?? 0) + refund,
      reserved: Math.max(0, (wallet.get('reserved') ?? 0) - reserved),
      updatedAt: now,
    }, { merge: true });
    let finalStatus = batch.status as string;
    if (reap) {
      finalStatus = sent === 0 && failedCount > 0 ? 'failed' : failedCount > 0 ? 'partial' : 'completed';
      for (const r of recipients.docs) if (r.get('smsStatus') === 'queued') {
        tx.set(r.ref, { smsStatus: 'failed', failedAt: now, updatedAt: now }, { merge: true });
      }
    }
    tx.update(ref, {
      pointsDeducted: actualCost, pointsRefunded: refund, pointsSettledAt: now, updatedAt: now,
      ...(reap ? {
        status: finalStatus, completedAt: now, failedAt: finalStatus === 'failed' ? now : null,
        failedCount, deliveredCount: delivered, skippedCount: skipped,
      } : {}),
    });
    for (const [type, amount, direction] of [
      ['reservation_release', reserved, 'credit'],
      ['sms_spend', actualCost, 'debit'],
      ['refund', refund, 'credit'],
    ] as const) {
      if (amount <= 0) continue;
      tx.set(db.collection('transactions').doc(`sms_${batchId}_${type}`), {
        userId: batch.senderId, type, direction, amount, status: 'completed',
        relatedSmsBatchId: batchId, createdAt: now, completedAt: now,
        ...(type === 'sms_spend' ? { sent, failed: failedCount } : {}),
        ...(reap ? { note: 'reaper' } : {}),
      });
    }
    return { finalStatus, delivered, sent, failed: failedCount, skipped, eligible: recipients.size - skipped, refund, actualCost };
  });
}
