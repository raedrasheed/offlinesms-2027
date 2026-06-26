// Public PII cleanup verifier (F1 follow-up) — READ-ONLY.
//
// Run AFTER scripts/cleanupPublicPii.ts --apply to confirm the cleanup is
// complete and non-destructive of the private store. It checks that:
//   - NO public users/{uid} doc still carries any of the sensitive fields
//     (phoneNumber, email, pinHash, pinSalt, pinSetAt) with a non-empty value;
//   - userPrivate/profile copies still exist (cleanup must never touch them).
//
// It NEVER writes or deletes anything. It prints COUNTS ONLY — no phone
// numbers, emails, PIN material, OTPs, or UIDs — unless --verbose-redacted is
// passed (a SMALL sample of partially-masked uids of docs that still hold
// public PII; still never prints PII values).
//
// Exit code:
//   0  → GO   : no public PII remains (cleanup complete)
//   1  → NO-GO: at least one public doc still holds PII (stragglers remain)
//   2  → bad invocation / credentials
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//     npx tsx scripts/verifyPublicPiiCleanup.ts
//   # add --verbose-redacted to also see a masked sample of straggler uids

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const VERBOSE = process.argv.includes('--verbose-redacted');
const SAMPLE_LIMIT = 10;

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('NO-GO: set GOOGLE_APPLICATION_CREDENTIALS to a prod service-account.json');
  process.exit(2);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) });
const db = getFirestore();

const PII_FIELDS = ['phoneNumber', 'email', 'pinHash', 'pinSalt', 'pinSetAt'] as const;
type Field = (typeof PII_FIELDS)[number];

function nonEmpty(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

function maskUid(uid: string): string {
  if (uid.length <= 4) return '****';
  return `${uid.slice(0, 2)}…${uid.slice(-2)}`;
}

async function main() {
  console.log(`F1 public-PII cleanup verifier — READ-ONLY${VERBOSE ? ' (verbose-redacted)' : ''}`);

  let totalUsers = 0;
  let usersWithPublicPii = 0;        // ≥1 non-empty PII field still on the public doc → must be 0 for GO
  let usersPrivateExists = 0;        // private/profile still present (sanity)
  let usersPublicPiiButNoPrivate = 0; // straggler with public PII AND no private copy (needs backfill)
  const perFieldRemaining: Record<Field, number> = { phoneNumber: 0, email: 0, pinHash: 0, pinSalt: 0, pinSetAt: 0 };

  const sampleStragglers: string[] = [];

  const pageSize = 400;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection('users').orderBy('__name__').limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const userDoc of snap.docs) {
      totalUsers++;
      const pub = userDoc.data();

      const remaining = PII_FIELDS.filter(f => nonEmpty(pub[f]));
      for (const f of remaining) perFieldRemaining[f]++;

      const privExists = (await userDoc.ref.collection('userPrivate').doc('profile').get()).exists;
      if (privExists) usersPrivateExists++;

      if (remaining.length > 0) {
        usersWithPublicPii++;
        if (!privExists) usersPublicPiiButNoPrivate++;
        if (VERBOSE && sampleStragglers.length < SAMPLE_LIMIT) sampleStragglers.push(maskUid(userDoc.id));
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  console.log('--- counts ---');
  console.log('1. total users                              :', totalUsers);
  console.log('2. users STILL holding public PII           :', usersWithPublicPii);
  console.log('3. users with userPrivate/profile present   :', usersPrivateExists);
  console.log('4. stragglers with public PII & NO private  :', usersPublicPiiButNoPrivate);
  console.log('   per-field public PII remaining           :', JSON.stringify(perFieldRemaining));
  if (VERBOSE && sampleStragglers.length) console.log('   sample straggler uids :', sampleStragglers.join(', '));

  console.log('--- result ---');
  if (usersWithPublicPii === 0) {
    console.log('GO: no public PII remains on any users/{uid} doc — cleanup complete.');
    process.exit(0);
  } else {
    console.log(`NO-GO: ${usersWithPublicPii} user(s) still hold public PII (private-missing: ${usersPublicPiiButNoPrivate}).`);
    console.log('Action: backfill the missing private copies, resolve mismatches, then re-run cleanupPublicPii.ts --apply.');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('NO-GO: verifier error:', (e as Error)?.message ?? e);
  process.exit(2);
});
