// Callable: buyPoints — server-side credit (payment integration is out of scope here)
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const buyPoints = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
  const { packageId } = request.data ?? {};

  // TODO: integrate Stripe / payment provider. For now we trust the
  // packageId mapping and credit synchronously.
  const PACKAGES: Record<string, { pts: number; bonus: number; priceCents: number }> = {
    '500':   { pts: 500,   bonus: 0,    priceCents: 500 },
    '1000':  { pts: 1000,  bonus: 50,   priceCents: 1000 },
    '5000':  { pts: 5000,  bonus: 500,  priceCents: 4500 },
    '10000': { pts: 10000, bonus: 1500, priceCents: 8500 },
  };
  const pkg = PACKAGES[packageId];
  if (!pkg) throw new HttpsError('invalid-argument', 'Unknown package');

  const db = getFirestore();
  const ref = db.collection('wallets').doc(uid);
  await db.runTransaction(async tx => {
    const w = await tx.get(ref);
    const balance = w.exists ? (w.get('balance') ?? 0) : 0;
    tx.set(ref, { balance: balance + pkg.pts + pkg.bonus }, { merge: true });
  });

  await db.collection('transactions').add({
    userId: uid, type: 'buy',
    amount: pkg.pts + pkg.bonus,
    package: packageId,
    priceCents: pkg.priceCents,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { credited: pkg.pts + pkg.bonus };
});
