// When the gateway acknowledges a batch, transition reserved → deducted.
// Refund any per-recipient failures and record the points settlement on
// the batch doc so the OfflineSMS Delivery Report has the final numbers.
//
// Phase 11: emits only the canonical Phase 9 transaction lifecycle
// rows (reservation_release, sms_spend, refund). The Phase 0
// legacy 'sms' row was dropped here.

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const COST_PER_SMS = 28;

export const onSmsBatchAccepted = onDocumentUpdated('smsBatches/{batchId}', async (event) => {
  const before = event.data?.before.data();
  const after  = event.data?.after.data();
  if (!before || !after) return;
  if (before.status === after.status) return;
  if (after.status !== 'accepted' && after.status !== 'partial' && after.status !== 'completed') return;

  const db = getFirestore();
  const batchRef  = db.collection('smsBatches').doc(event.params.batchId);
  const walletRef = db.collection('wallets').doc(after.senderId);

  const recipients = await batchRef.collection('recipients').get();
  const sent = recipients.docs.filter(d => {
    const status = d.get('smsStatus');
    return status === 'queued' || status === 'sent' || status === 'delivered';
  }).length;
  const failed = recipients.docs.filter(d => d.get('smsStatus') === 'failed').length;

  const reservedRecipients = (before.recipientCount as number) ?? 0;
  const reserved   = reservedRecipients * COST_PER_SMS;
  const actualCost = sent * COST_PER_SMS;
  const refund     = Math.max(0, reserved - actualCost);

  await db.runTransaction(async tx => {
    const w = await tx.get(walletRef);
    const balance = w.exists ? ((w.get('balance') as number) ?? 0) : 0;
    const r = w.exists ? ((w.get('reserved') as number) ?? 0) : 0;
    tx.set(walletRef, {
      balance:  balance + refund,
      reserved: Math.max(0, r - reserved),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  const now = FieldValue.serverTimestamp();
  const txCol = db.collection('transactions');

  // Phase 11: legacy { type: 'sms' } row dropped. The canonical
  // lifecycle below is the only emission path now. The Phase 9
  // mobile lib's canonicaliseType still tolerates legacy 'sms'
  // docs for any pre-Phase-11 data sitting in dev / staging.
  //
  // Phase 10 canonical lifecycle rows.
  // 1) reservation_release — clears the reserve hold (whole amount).
  if (reserved > 0) {
    await txCol.add({
      userId:            after.senderId,
      type:              'reservation_release',
      direction:         'credit',
      amount:            reserved,
      status:            'completed',
      relatedSmsBatchId: event.params.batchId,
      createdAt:         now,
      completedAt:       now,
    });
  }
  // 2) sms_spend — what was actually billed.
  if (actualCost > 0) {
    await txCol.add({
      userId:            after.senderId,
      type:              'sms_spend',
      direction:         'debit',
      amount:            actualCost,
      status:            'completed',
      sent,
      failed,
      relatedSmsBatchId: event.params.batchId,
      createdAt:         now,
      completedAt:       now,
    });
  }
  // 3) refund — only when actual < reserved.
  if (refund > 0) {
    await txCol.add({
      userId:            after.senderId,
      type:              'refund',
      direction:         'credit',
      amount:            refund,
      status:            'completed',
      relatedSmsBatchId: event.params.batchId,
      createdAt:         now,
      completedAt:       now,
    });
  }

  // Stamp settlement onto the batch doc.
  await batchRef.update({
    pointsDeducted: actualCost,
    pointsRefunded: refund,
    updatedAt:      FieldValue.serverTimestamp(),
  });
});
