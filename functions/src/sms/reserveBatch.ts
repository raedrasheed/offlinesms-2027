import { FieldValue, type Firestore, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

/** A debit must always have its durable batch and reservation ledger record.
 * Keep these writes together so a crash cannot strand an untraceable hold. */
export async function reserveSmsBatch(db: Firestore, uid: string, batchRef: DocumentReference,
  cost: number, batchData: Record<string, unknown>): Promise<void> {
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new HttpsError('invalid-argument', 'sms-cost-invalid');
  const walletRef = db.collection('wallets').doc(uid);
  await db.runTransaction(async tx => {
    const wallet = await tx.get(walletRef);
    const balance = wallet.get('balance') ?? 0;
    if (balance < cost) throw new HttpsError('failed-precondition', 'not-enough-points');
    tx.set(walletRef, { balance: balance - cost, reserved: FieldValue.increment(cost), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(batchRef, batchData);
    tx.create(db.collection('transactions').doc(`sms_${batchRef.id}_reservation`), {
      userId: uid, type: 'reservation', direction: 'debit', amount: cost,
      status: 'completed', relatedSmsBatchId: batchRef.id,
      createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(),
    });
  });
}
