// Read the CURRENT receipt in a transaction, not the trigger's potentially stale
// before/after values. One contribution per uid makes duplicate and out-of-order
// events idempotent, with constant reads after a one-time legacy bootstrap.
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { receiptCounts, RECEIPT_FIELDS } from './receiptCounts';

export async function aggregateReceipt(db: Firestore, convoId: string, messageId: string, uid: string): Promise<void> {
  const msgRef = db.doc(`conversations/${convoId}/messages/${messageId}`);
  const receiptRef = msgRef.collection('receipts').doc(uid);
  const contributionRef = msgRef.collection('receiptContributions').doc(uid);
  await db.runTransaction(async tx => {
    const [msg, receipt, prior] = await Promise.all([tx.get(msgRef), tx.get(receiptRef), tx.get(contributionRef)]);
    // Recursive retention deletes produce receipt events: never resurrect a parent.
    if (!msg.exists || msg.get('retentionDeleting') === true) return;
    if (msg.get('receiptAggregationVersion') !== 2) {
      const receipts = await tx.get(msgRef.collection('receipts'));
      const totals = receiptCounts(null);
      for (const row of receipts.docs) {
        const status = row.get('status') ?? 'pending';
        const counts = receiptCounts(status);
        for (const field of RECEIPT_FIELDS) totals[field] += counts[field];
        tx.set(msgRef.collection('receiptContributions').doc(row.id), { status });
      }
      tx.update(msgRef, { ...totals, receiptAggregationVersion: 2, receiptUpdatedAt: FieldValue.serverTimestamp() });
      return;
    }
    const status = receipt.exists ? receipt.get('status') ?? 'pending' : null;
    const previous = prior.exists ? prior.get('status') : null;
    if (status === previous) return;
    const before = receiptCounts(previous), after = receiptCounts(status);
    const totals = receiptCounts(null);
    for (const field of RECEIPT_FIELDS) totals[field] = Math.max(0, (msg.get(field) ?? 0) + after[field] - before[field]);
    tx.update(msgRef, { ...totals, receiptUpdatedAt: FieldValue.serverTimestamp() });
    if (status === null) tx.delete(contributionRef);
    else tx.set(contributionRef, { status });
  });
}

export const onReceiptWrite = onDocumentWritten({
  document: 'conversations/{convoId}/messages/{messageId}/receipts/{uid}', retry: true,
}, async event => {
  const { convoId, messageId, uid } = event.params;
  await aggregateReceipt(getFirestore(), convoId, messageId, uid);
});
