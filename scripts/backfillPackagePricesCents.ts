// One-time backfill: convert pointsPackages.price from major units (dollars)
// to the smallest currency unit (cents), e.g. 2.99 → 299. Packages created
// before the dashboard stored cents had dollar prices, which the app then
// divided by 100 (showing "USD 0.03"). Idempotent via a priceMigratedToCents
// marker so re-running never double-multiplies.
//
// Credentials (first that resolves wins):
//   1. GOOGLE_APPLICATION_CREDENTIALS  → path to a service-account.json
//   2. FIREBASE_ADMIN_* env vars
//   3. apps/dashboard/.env.local       → the dashboard's FIREBASE_ADMIN_* creds
//
// Run:
//   npx tsx scripts/backfillPackagePricesCents.ts
import { cert, initializeApp, type AppOptions } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function resolveCredentials(): AppOptions {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && existsSync(credPath)) {
    return { credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) };
  }
  const dashEnv = readEnvFile(path.join(__dirname, '../apps/dashboard/.env.local'));
  const projectId   = process.env.FIREBASE_ADMIN_PROJECT_ID  ?? dashEnv.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? dashEnv.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey  = (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? dashEnv.FIREBASE_ADMIN_PRIVATE_KEY)?.replace(/\\n/g, '\n');
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
  const snap = await db.collection('pointsPackages').get();
  let converted = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.priceMigratedToCents === true) { continue; }   // already in cents
    const dollars = (data.price as number) ?? 0;
    const cents = Math.round(dollars * 100);
    await doc.ref.set({ price: cents, priceMigratedToCents: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    converted++;
    console.log(`${doc.id} (${data.name ?? '—'}): ${dollars} → ${cents} cents`);
  }

  console.log(`\nDone. Packages converted: ${converted}, skipped (already cents): ${snap.size - converted}.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
