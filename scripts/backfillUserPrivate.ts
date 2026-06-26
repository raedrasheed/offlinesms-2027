// Backfill (F1, Phase A): copy sensitive PII from each public users/{uid} doc
// into the owner/admin-only private subdoc users/{uid}/private/profile.
//
// - Idempotent: re-running only writes when the subdoc is missing a field or
//   differs; safe to run repeatedly.
// - Dry-run by default: pass --apply to actually write.
// - Logs COUNTS ONLY — never prints phone numbers / emails / PIN material.
// - Does NOT delete anything from the public users/{uid} docs (Phase C does).
//
// Credentials: set GOOGLE_APPLICATION_CREDENTIALS to a service-account.json.
//
// Dry-run:  GOOGLE_APPLICATION_CREDENTIALS=./sa.json npx tsx scripts/backfillUserPrivate.ts
// Apply:    GOOGLE_APPLICATION_CREDENTIALS=./sa.json npx tsx scripts/backfillUserPrivate.ts --apply

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a service-account.json'); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) });
const db = getFirestore();

// Fields mirrored into users/{uid}/private/profile.
const FIELDS = ['phoneNumber', 'email', 'pinHash', 'pinSalt', 'pinSetAt'] as const;

async function main() {
  console.log(`F1 backfill — ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes; pass --apply to write)'}`);

  let scanned = 0;
  let needWrite = 0;
  let written = 0;
  let alreadyOk = 0;
  let noPii = 0;

  // Page through all users.
  const pageSize = 400;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection('users').orderBy('__name__').limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const userDoc of snap.docs) {
      scanned++;
      const data = userDoc.data();

      // Collect the PII fields that exist on the public doc.
      const present: Record<string, unknown> = {};
      for (const f of FIELDS) {
        if (data[f] !== undefined && data[f] !== null) present[f] = data[f];
      }
      if (Object.keys(present).length === 0) { noPii++; continue; }

      // Compare against the existing private subdoc to stay idempotent.
      const privRef = userDoc.ref.collection('private').doc('profile');
      const privSnap = await privRef.get();
      const priv = privSnap.exists ? privSnap.data() ?? {} : {};

      const missing: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(present)) {
        // pinSetAt is a Timestamp; compare by presence only (don't rewrite).
        if (priv[k] === undefined) missing[k] = v;
      }
      if (Object.keys(missing).length === 0) { alreadyOk++; continue; }

      needWrite++;
      if (APPLY) {
        await privRef.set({ ...missing, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        written++;
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  console.log('--- summary (counts only) ---');
  console.log('users scanned        :', scanned);
  console.log('with no PII fields   :', noPii);
  console.log('already in sync      :', alreadyOk);
  console.log(APPLY ? 'subdocs written      :' : 'would write subdocs  :', APPLY ? written : needWrite);
  if (!APPLY) console.log('\nDry-run only — re-run with --apply to write.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
