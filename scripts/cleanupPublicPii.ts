// Legacy public PII cleanup (F1 follow-up) — delete stale sensitive fields from
// the public users/{uid} doc, ONLY where the same value is proven to exist in
// users/{uid}/userPrivate/profile.
//
// This is the one DESTRUCTIVE step of the F1 migration. Read docs/F1_PUBLIC_PII_CLEANUP.md
// BEFORE running --apply, and take a Firestore backup / PITR snapshot first:
// deleting public fields is NOT reversible by reverting code.
//
// Safety model (per field, per user):
//   - phoneNumber / email (strings): SAFE to delete iff the private copy exists,
//     is non-empty, AND equals the public value. Private missing/empty => UNSAFE
//     (skipped). Private present but different value => MISMATCH (skipped, never
//     auto-deleted).
//   - pinHash / pinSalt / pinSetAt: SAFE to delete iff the private copy has that
//     field present (presence-based; pinSetAt is a Timestamp). These were never
//     successfully written to the public doc historically, so usually absent.
//
// - Dry-run by default. Pass --apply to actually delete.
// - --strip-empty also removes null/empty placeholder keys for the 5 fields
//   (they hold no PII); OFF by default.
// - --verbose-redacted prints a SMALL sample of MASKED uids for the non-safe
//   buckets; never prints PII values or raw uids.
// - Logs COUNTS ONLY by default.
// - NEVER writes to or deletes from users/{uid}/userPrivate/profile.
// - Idempotent: re-running after --apply finds nothing left to delete.
//
// Credentials: GOOGLE_APPLICATION_CREDENTIALS must point at a prod service-account.json.
//
// Dry-run:    GOOGLE_APPLICATION_CREDENTIALS=./sa.json npx tsx scripts/cleanupPublicPii.ts
// Apply:      GOOGLE_APPLICATION_CREDENTIALS=./sa.json npx tsx scripts/cleanupPublicPii.ts --apply
// Strip empty: add --strip-empty ; Masked sample: add --verbose-redacted

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const STRIP_EMPTY = process.argv.includes('--strip-empty');
const VERBOSE = process.argv.includes('--verbose-redacted');
const SAMPLE_LIMIT = 10;

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('NO-GO: set GOOGLE_APPLICATION_CREDENTIALS to a prod service-account.json');
  process.exit(2);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) });
const db = getFirestore();

// String fields cleared only on exact value match; presence fields on presence.
const STRING_FIELDS = ['phoneNumber', 'email'] as const;
const PRESENCE_FIELDS = ['pinHash', 'pinSalt', 'pinSetAt'] as const;
const ALL_FIELDS = [...STRING_FIELDS, ...PRESENCE_FIELDS] as const;
type Field = (typeof ALL_FIELDS)[number];

function nonEmpty(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/** Mask a uid for --verbose-redacted output (never reveal the full id). */
function maskUid(uid: string): string {
  if (uid.length <= 4) return '****';
  return `${uid.slice(0, 2)}…${uid.slice(-2)}`;
}

type FieldStatus = 'safe' | 'unsafe' | 'mismatch' | 'empty';

/** Classify one field for one user (only called when the public key is present). */
function classifyField(field: Field, pub: Record<string, unknown>, priv: Record<string, unknown>): FieldStatus {
  const pubVal = pub[field];
  if (!nonEmpty(pubVal)) return 'empty';                 // null/'' placeholder key
  const privVal = priv[field];
  if (!nonEmpty(privVal)) return 'unsafe';              // no private copy → never delete
  if ((STRING_FIELDS as readonly string[]).includes(field)) {
    return pubVal === privVal ? 'safe' : 'mismatch';    // strings: require exact match
  }
  return 'safe';                                         // presence fields: private present is enough
}

async function main() {
  console.log(
    `F1 public-PII cleanup — ${APPLY ? 'APPLY (deleting public fields)' : 'DRY-RUN (no writes; pass --apply to delete)'}` +
    `${STRIP_EMPTY ? ' [strip-empty ON]' : ''}${VERBOSE ? ' [verbose-redacted]' : ''}`,
  );

  let totalUsers = 0;
  let usersWithPublicPii = 0;        // ≥1 non-empty target field on the public doc
  let usersPrivateExists = 0;        // userPrivate/profile exists
  let usersSafe = 0;                 // has public PII AND every present field is safe
  let usersUnsafe = 0;               // ≥1 present field UNSAFE (private missing)
  let usersMismatch = 0;             // ≥1 present field MISMATCH
  let usersPartial = 0;              // mix of safe + (unsafe|mismatch)
  let usersDeleted = 0;              // docs we wrote a delete to (apply)

  const perFieldDeletable: Record<Field, number> = { phoneNumber: 0, email: 0, pinHash: 0, pinSalt: 0, pinSetAt: 0 };
  const perFieldUnsafe: Record<Field, number> = { phoneNumber: 0, email: 0, pinHash: 0, pinSalt: 0, pinSetAt: 0 };
  const perFieldMismatch: Record<Field, number> = { phoneNumber: 0, email: 0, pinHash: 0, pinSalt: 0, pinSetAt: 0 };
  let emptyKeysStrippable = 0;       // null/'' placeholder keys (only acted on with --strip-empty)

  const sampleUnsafe: string[] = [];
  const sampleMismatch: string[] = [];

  let batch = db.batch();
  let batchOps = 0;
  const flush = async () => { if (batchOps > 0) { await batch.commit(); batch = db.batch(); batchOps = 0; } };

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
      const privExists = privSnap.exists;
      if (privExists) usersPrivateExists++;
      const priv = privExists ? (privSnap.data() ?? {}) : {};

      // Which target keys are actually present on the public doc?
      const presentFields = ALL_FIELDS.filter(f => Object.prototype.hasOwnProperty.call(pub, f));
      const nonEmptyFields = presentFields.filter(f => nonEmpty(pub[f]));
      if (nonEmptyFields.length > 0) usersWithPublicPii++;

      const toDelete: Field[] = [];
      let hasSafe = false, hasUnsafe = false, hasMismatch = false;

      for (const f of presentFields) {
        const status = classifyField(f, pub, priv);
        if (status === 'safe') {
          hasSafe = true; perFieldDeletable[f]++; toDelete.push(f);
        } else if (status === 'unsafe') {
          hasUnsafe = true; perFieldUnsafe[f]++;
        } else if (status === 'mismatch') {
          hasMismatch = true; perFieldMismatch[f]++;
        } else { // 'empty'
          emptyKeysStrippable++;
          if (STRIP_EMPTY) toDelete.push(f);             // empty placeholder holds no PII
        }
      }

      // Per-user buckets (based on the NON-empty PII fields only).
      if (nonEmptyFields.length > 0) {
        if (hasUnsafe) usersUnsafe++;
        if (hasMismatch) usersMismatch++;
        if (hasSafe && !hasUnsafe && !hasMismatch) usersSafe++;
        if (hasSafe && (hasUnsafe || hasMismatch)) usersPartial++;
        if (VERBOSE && hasUnsafe && sampleUnsafe.length < SAMPLE_LIMIT) sampleUnsafe.push(maskUid(userDoc.id));
        if (VERBOSE && hasMismatch && sampleMismatch.length < SAMPLE_LIMIT) sampleMismatch.push(maskUid(userDoc.id));
      }

      if (toDelete.length > 0) {
        usersDeleted++;
        if (APPLY) {
          const patch: Record<string, FirebaseFirestore.FieldValue> = {};
          for (const f of toDelete) patch[f] = FieldValue.delete();
          batch.update(userDoc.ref, patch);              // public doc ONLY; never the private subdoc
          batchOps++;
          if (batchOps >= pageSize) await flush();
        }
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }
  if (APPLY) await flush();

  console.log('--- counts (counts only; no PII) ---');
  console.log('1. total users                          :', totalUsers);
  console.log('2. users WITH public PII                :', usersWithPublicPii);
  console.log('3. users WHERE private copy exists      :', usersPrivateExists);
  console.log('4. users UNSAFE (private copy missing)  :', usersUnsafe);
  console.log('5. users SAFE to clean (all fields safe):', usersSafe);
  console.log('   · users partially safe              :', usersPartial);
  console.log('   · users with a MISMATCH (skipped)   :', usersMismatch);
  console.log('   · empty placeholder keys found      :', emptyKeysStrippable, STRIP_EMPTY ? '(will strip)' : '(left; use --strip-empty)');
  console.log('   per-field deletable (safe)          :', JSON.stringify(perFieldDeletable));
  console.log('   per-field unsafe (private missing)  :', JSON.stringify(perFieldUnsafe));
  console.log('   per-field mismatch (skipped)        :', JSON.stringify(perFieldMismatch));
  console.log(APPLY ? '   docs updated (fields deleted)       :' : '   docs that WOULD be updated           :', usersDeleted);

  if (VERBOSE) {
    if (sampleUnsafe.length)   console.log('   sample UNSAFE uids   :', sampleUnsafe.join(', '));
    if (sampleMismatch.length) console.log('   sample MISMATCH uids :', sampleMismatch.join(', '));
  }

  if (!APPLY) {
    console.log('\nDry-run only — re-run with --apply to delete the safe public fields.');
    console.log('WARNING: --apply is destructive. Take a Firestore backup / PITR snapshot first.');
  } else {
    console.log('\nApply complete. Re-run dry-run (and verifyPublicPiiCleanup.ts) to confirm.');
  }

  // Non-zero exit when unsafe/mismatch remain so automation notices stragglers.
  process.exit(usersUnsafe > 0 || usersMismatch > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('NO-GO: cleanup error:', (e as Error)?.message ?? e);
  process.exit(2);
});
