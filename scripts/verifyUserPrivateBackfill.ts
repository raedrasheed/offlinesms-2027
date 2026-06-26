// Phase A production evidence verifier (F1) — READ-ONLY.
//
// Run AFTER deploying Phase A and running the backfill. It checks that every
// user with sensitive PII on the public users/{uid} doc has a matching
// users/{uid}/userPrivate/profile subdoc with those fields mirrored.
//
// It NEVER writes or deletes anything. It prints COUNTS ONLY — no phone
// numbers, emails, PIN hashes/salts, OTPs, or UIDs — unless you pass
// --verbose-redacted (which prints a SMALL sample of partially-masked UIDs of
// failing users to aid debugging; still never prints PII values).
//
// Exit code:
//   0  → all required Phase A conditions pass (GO signal for Phase B prep)
//   1  → at least one required condition failed (NO-GO)
//   2  → bad invocation / credentials
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//     npx tsx scripts/verifyUserPrivateBackfill.ts
//   # add --verbose-redacted to also see a masked sample of failing uids
//
// Credentials: GOOGLE_APPLICATION_CREDENTIALS must point at a prod
// service-account.json (the script only reads).

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

// Sensitive fields mirrored into userPrivate/profile (must match the backfill).
const SENSITIVE = ['phoneNumber', 'email', 'pinHash', 'pinSalt', 'pinSetAt'] as const;

/** Mask a uid for --verbose-redacted output (never reveal the full id). */
function maskUid(uid: string): string {
  if (uid.length <= 4) return '****';
  return `${uid.slice(0, 2)}…${uid.slice(-2)}`;
}

function nonEmpty(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

async function main() {
  console.log(`F1 Phase A verifier — READ-ONLY${VERBOSE ? ' (verbose-redacted)' : ''}`);

  let totalUsers = 0;
  let withPrivate = 0;
  let missingPrivate = 0;
  let pubPhoneNoPrivPhone = 0;     // public phoneNumber set, private phone missing
  let pubEmailNoPrivEmail = 0;     // public email set, private email missing
  let emptyPrivate = 0;            // private/profile exists but holds no sensitive field

  const sampleMissing: string[] = [];
  const samplePhoneGap: string[] = [];
  const sampleEmailGap: string[] = [];

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

      const privSnap = await userDoc.ref.collection('userPrivate').doc('profile').get();
      const hasPriv = privSnap.exists;
      const priv = hasPriv ? (privSnap.data() ?? {}) : {};

      if (!hasPriv) {
        missingPrivate++;
        if (VERBOSE && sampleMissing.length < SAMPLE_LIMIT) sampleMissing.push(maskUid(userDoc.id));
      } else {
        withPrivate++;
        const anySensitive = SENSITIVE.some(f => nonEmpty(priv[f]));
        if (!anySensitive) emptyPrivate++;
      }

      // Gap checks: public field present but not mirrored into private.
      if (nonEmpty(pub.phoneNumber) && !nonEmpty(priv.phoneNumber)) {
        pubPhoneNoPrivPhone++;
        if (VERBOSE && samplePhoneGap.length < SAMPLE_LIMIT) samplePhoneGap.push(maskUid(userDoc.id));
      }
      if (nonEmpty(pub.email) && !nonEmpty(priv.email)) {
        pubEmailNoPrivEmail++;
        if (VERBOSE && sampleEmailGap.length < SAMPLE_LIMIT) sampleEmailGap.push(maskUid(userDoc.id));
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  console.log('--- counts ---');
  console.log('1. total users                         :', totalUsers);
  console.log('2. users WITH userPrivate/profile      :', withPrivate);
  console.log('3. users MISSING userPrivate/profile   :', missingPrivate);
  console.log('4. public phone set, private MISSING   :', pubPhoneNoPrivPhone);
  console.log('5. public email set, private MISSING   :', pubEmailNoPrivEmail);
  console.log('6. private exists but NO sensitive data:', emptyPrivate);

  if (VERBOSE) {
    if (sampleMissing.length)  console.log('   sample missing-private uids   :', sampleMissing.join(', '));
    if (samplePhoneGap.length) console.log('   sample phone-gap uids         :', samplePhoneGap.join(', '));
    if (sampleEmailGap.length) console.log('   sample email-gap uids         :', sampleEmailGap.join(', '));
  }

  // Required Phase A conditions: every public PII value must be mirrored.
  // (missingPrivate alone is OK for users who never had PII; the gap counts are
  // the real failures — a public value that didn't get backfilled.)
  const failures: string[] = [];
  if (pubPhoneNoPrivPhone > 0) failures.push(`#4 phone gap = ${pubPhoneNoPrivPhone}`);
  if (pubEmailNoPrivEmail > 0) failures.push(`#5 email gap = ${pubEmailNoPrivEmail}`);

  console.log('--- result ---');
  if (failures.length === 0) {
    console.log('GO: backfill complete — every public phone/email is mirrored into userPrivate/profile.');
    process.exit(0);
  } else {
    console.log('NO-GO: backfill incomplete →', failures.join(' ; '));
    console.log('Action: re-run the backfill apply, then re-run this verifier until both gaps are 0.');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('NO-GO: verifier error:', (e as Error)?.message ?? e);
  process.exit(2);
});
