// Backfill `createdAt` (and a welcome wallet) for users that are missing it.
//
// Phone sign-in users created before the verifyPhoneOtp bootstrap fix have no
// createdAt, so Firestore's orderBy('createdAt') drops them from the admin
// Users list. This sets createdAt = updatedAt ?? now for any such doc, and
// creates a wallet (50-pt welcome credit) if one doesn't exist.
//
// Run:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/backfillUserCreatedAt.ts
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS in .env'); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) });
const db = getFirestore();

async function main() {
  const snap = await db.collection('users').get();
  let fixedCreatedAt = 0;
  let createdWallets = 0;

  for (const doc of snap.docs) {
    const data = doc.data();

    if (data.createdAt == null) {
      const fallback = (data.updatedAt as Timestamp | undefined) ?? Timestamp.now();
      await doc.ref.set({ createdAt: fallback }, { merge: true });
      fixedCreatedAt++;
      console.log(`createdAt set for ${doc.id} (@${data.username ?? '—'})`);
    }

    const wallet = await db.collection('wallets').doc(doc.id).get();
    if (!wallet.exists) {
      await wallet.ref.set({ balance: 50, reserved: 0, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      createdWallets++;
      console.log(`wallet created for ${doc.id}`);
    }
  }

  console.log(`\nDone. createdAt backfilled: ${fixedCreatedAt}, wallets created: ${createdWallets}.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
