// When the gateway acknowledges a batch, transition reserved → deducted.
// Refund any per-recipient failures.
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
  const walletRef = db.collection('wallets').doc(after.senderId);

  // Count actual recipients now in the batch
  const recipients = await db.collection('smsBatches').doc(event.params.batchId).collection('recipients').get();
  const sent   = recipients.docs.filter(d => d.get('smsStatus') === 'queued' || d.get('smsStatus') === 'delivered').length;
  const failed = recipients.docs.filter(d => d.get('smsStatus') === 'failed').length;

  const reserved   = (before.recipientCount ?? 0) * COST_PER_SMS;
  const actualCost = sent * COST_PER_SMS;
  const refund     = reserved - actualCost;

  await db.runTransaction(async tx => {
    const w = await tx.get(walletRef);
    const balance = w.exists ? (w.get('balance') ?? 0) : 0;
    const r = w.exists ? (w.get('reserved') ?? 0) : 0;
    tx.set(walletRef, {
      balance: balance + refund,
      reserved: Math.max(0, r - reserved),
    }, { merge: true });
  });

  // Log a transaction
  await db.collection('transactions').add({
    userId: after.senderId,
    type: 'sms',
    amount: -actualCost,
    refund,
    sent,
    failed,
    batchId: event.params.batchId,
    createdAt: FieldValue.serverTimestamp(),
  });
});
