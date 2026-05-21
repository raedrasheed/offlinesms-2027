// Callable: escalateSms
// Body: { messageId, conversationId, audience, smsBody }
//   audience = 'unread' | 'undelivered' | 'everyone'
// Reserves points → records batch → dispatches via gateway → updates receipts.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { sendBatch } from './gateway';

const COST_PER_SMS = 28; // points

export const escalateSms = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

  const { messageId, conversationId, audience, smsBody } = request.data ?? {};
  if (!messageId || !conversationId || !audience || !smsBody) {
    throw new HttpsError('invalid-argument', 'Missing fields');
  }

  const db = getFirestore();
  const convoRef  = db.collection('conversations').doc(conversationId);
  const msgRef    = convoRef.collection('messages').doc(messageId);
  const msgSnap   = await msgRef.get();
  if (!msgSnap.exists) throw new HttpsError('not-found', 'Message not found');
  if (msgSnap.get('senderId') !== uid) throw new HttpsError('permission-denied', 'Only the sender can escalate');

  // 1. Resolve audience → recipient list
  const recipientsSnap = await msgRef.collection('receipts').get();
  let recipientUids = recipientsSnap.docs.map(d => ({ uid: d.id, status: d.get('status') }));
  if (audience === 'unread')      recipientUids = recipientUids.filter(r => r.status !== 'read');
  if (audience === 'undelivered') recipientUids = recipientUids.filter(r => r.status === 'pending' || r.status === 'failed');

  if (recipientUids.length === 0) throw new HttpsError('failed-precondition', 'No eligible recipients');

  // 2. Resolve phone numbers
  const recipients = await Promise.all(recipientUids.map(async r => {
    const u = await db.collection('users').doc(r.uid).get();
    const phone = u.get('phoneNumber');
    if (!phone) return null;
    return { uid: r.uid, phone, maskedPhone: maskPhone(phone) };
  }));
  const valid = recipients.filter((r): r is NonNullable<typeof r> => r !== null);

  // 3. Reserve points
  const cost = valid.length * COST_PER_SMS;
  const walletRef = db.collection('wallets').doc(uid);

  await db.runTransaction(async tx => {
    const w = await tx.get(walletRef);
    const balance = w.exists ? (w.get('balance') ?? 0) : 0;
    if (balance < cost) throw new HttpsError('failed-precondition', 'Not enough points');
    tx.set(walletRef, { balance: balance - cost, reserved: FieldValue.increment(cost) }, { merge: true });
  });

  // 4. Create batch record
  const batchRef = db.collection('smsBatches').doc();
  await batchRef.set({
    messageId, conversationId, senderId: uid, audience, smsBody,
    recipientCount: valid.length, estimatedCost: cost,
    status: 'sending', createdAt: FieldValue.serverTimestamp(),
  });

  // 5. Dispatch to OfflineSMS Gateway
  const result = await sendBatch(batchRef.id, smsBody, valid);

  // 6. Per-recipient docs + finalize batch
  const batch = db.batch();
  for (const r of valid) {
    const ok = result.acceptedRecipientIds.includes(r.uid);
    batch.set(batchRef.collection('recipients').doc(r.uid), {
      userId: r.uid,
      maskedPhone: r.maskedPhone,
      smsStatus: ok ? 'queued' : 'failed',
      reason: ok ? null : result.rejectedRecipientIds.find(x => x.uid === r.uid)?.reason,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  batch.update(batchRef, {
    gatewayBatchId: result.gatewayBatchId,
    status: result.rejectedRecipientIds.length === 0 ? 'accepted' : 'partial',
  });
  await batch.commit();

  return { batchId: batchRef.id, gatewayBatchId: result.gatewayBatchId, sent: result.acceptedRecipientIds.length, failed: result.rejectedRecipientIds.length };
});

function maskPhone(p: string) {
  if (p.length < 6) return p;
  return p.slice(0, 4) + ' ••• ' + p.slice(-3);
}
