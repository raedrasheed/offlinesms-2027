// When the gateway acknowledges a batch, transition reserved → deducted.
// Refund any per-recipient failures and record the points settlement on
// the batch doc so the OfflineSMS Delivery Report has the final numbers.

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
  const batchRef = db.collection('smsBatches').doc(event.params.batchId);
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
    }, { merge: true });
  });

  await db.collection('transactions').add({
    userId:    after.senderId,
    type:      'sms',
    amount:    -actualCost,
    refund,
    sent,
    failed,
    batchId:   event.params.batchId,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Stamp the settlement onto the batch so the Delivery Report shows it.
  await batchRef.update({
    pointsDeducted: actualCost,
    pointsRefunded: refund,
    updatedAt:      FieldValue.serverTimestamp(),
  });
});
