// Callable: transferPoints — atomic peer-to-peer transfer
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const transferPoints = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
  const { toUid, amount, note } = request.data ?? {};
  if (!toUid || typeof amount !== 'number' || amount <= 0) throw new HttpsError('invalid-argument', 'bad inputs');
  if (toUid === uid) throw new HttpsError('invalid-argument', 'Cannot transfer to self');

  const db = getFirestore();
  const from = db.collection('wallets').doc(uid);
  const to   = db.collection('wallets').doc(toUid);

  await db.runTransaction(async tx => {
    const fs = await tx.get(from);
    const ts = await tx.get(to);
    const fbal = fs.exists ? (fs.get('balance') ?? 0) : 0;
    const tbal = ts.exists ? (ts.get('balance') ?? 0) : 0;
    if (fbal < amount) throw new HttpsError('failed-precondition', 'Not enough points');
    tx.set(from, { balance: fbal - amount }, { merge: true });
    tx.set(to,   { balance: tbal + amount }, { merge: true });
  });

  const ts = FieldValue.serverTimestamp();
  const out = db.collection('transactions');
  await Promise.all([
    out.add({ userId: uid,   type: 'transfer-out', amount: -amount, peerId: toUid, note, createdAt: ts }),
    out.add({ userId: toUid, type: 'transfer-in',  amount:  amount, peerId: uid,   note, createdAt: ts }),
  ]);

  return { ok: true };
});
