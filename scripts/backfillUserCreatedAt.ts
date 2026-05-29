// Backfill `createdAt` (and a welcome wallet) for users that are missing it.
//
// Phone sign-in users created before the verifyPhoneOtp bootstrap fix have no
// createdAt, so Firestore's orderBy('createdAt') drops them from the admin
// Users list. This sets createdAt = updatedAt ?? now for any such doc, and
// creates a wallet (50-pt welcome credit) if one doesn't exist.
//
// Credentials (first that resolves wins):
//   1. GOOGLE_APPLICATION_CREDENTIALS  → path to a service-account.json
//   2. FIREBASE_ADMIN_* env vars       → already in your environment
//   3. apps/dashboard/.env.local       → the dashboard's FIREBASE_ADMIN_* creds
//
// Run (no key file needed if the dashboard env is configured):
//   npx tsx scripts/backfillUserCreatedAt.ts
import { cert, initializeApp, type AppOptions } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Minimal .env parser — returns KEY→value for the given file (if it exists). */
function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function resolveCredentials(): AppOptions {
  // 1. Service-account JSON file.
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && existsSync(credPath)) {
    return { credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) };
  }

  // 2/3. FIREBASE_ADMIN_* from the environment, falling back to the dashboard .env.local.
  const dashEnv = readEnvFile(path.join(__dirname, '../apps/dashboard/.env.local'));
  const projectId   = process.env.FIREBASE_ADMIN_PROJECT_ID   ?? dashEnv.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL  ?? dashEnv.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey  = (process.env.FIREBASE_ADMIN_PRIVATE_KEY  ?? dashEnv.FIREBASE_ADMIN_PRIVATE_KEY)?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }) };
  }

  console.error(
    'No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account.json,\n' +
    'or ensure apps/dashboard/.env.local has FIREBASE_ADMIN_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY.',
  );
  process.exit(1);
}

initializeApp(resolveCredentials());
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
