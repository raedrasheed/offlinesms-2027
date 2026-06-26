# F1 follow-up — Legacy Public PII Cleanup

Delete stale sensitive fields (`phoneNumber`, `email`, `pinHash`, `pinSalt`,
`pinSetAt`) from the **public** `users/{uid}` document, **only** where the same
value is proven to exist in `users/{uid}/userPrivate/profile`.

This runs *after* the F1 migration (see `docs/F1_PII_MIGRATION_REPORT.md`). By
then no app code reads or writes public PII; these fields are inert but still
physically present and world-readable. This is the one **destructive** step.

> ⚠️ **TAKE A FIRESTORE BACKUP / PITR SNAPSHOT BEFORE `--apply`.** Field deletion
> is NOT reversible by reverting code. The only safe restore is a pre-apply
> backup. Do **not** plan to "undo" by copying `userPrivate/profile` values back
> onto the public doc — that would re-introduce the exact PII exposure the
> migration removed.

## Preconditions (hard gate before `--apply`)
1. F1 Phase C is deployed (no code reads/writes public PII).
2. `npm run verify:userprivate` reports **GO** (every public phone/email is
   mirrored into the private subdoc).
3. A fresh Firestore **backup / PITR window** is confirmed.
4. You have run the **dry-run** below and reviewed the counts.
5. Run during a low-traffic window.

## Commands
All scripts require a prod service account:
`GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`. They are **offline
tooling** — nothing is deployed.

**Dry-run (no writes — default):**
```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run cleanup:public-pii
# or, with a masked sample of non-safe uids:
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/cleanupPublicPii.ts --verbose-redacted
```

**Apply (DESTRUCTIVE — deletes only safe public fields):**
```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/cleanupPublicPii.ts --apply
# add --strip-empty to ALSO remove null/empty placeholder keys (OFF by default):
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/cleanupPublicPii.ts --apply --strip-empty
```

**Verify (read-only, after apply):**
```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run verify:public-pii-cleanup
```

## Safety model (per field, per user)
- **`phoneNumber` / `email`** (strings): SAFE to delete **iff** the private copy
  exists, is non-empty, **and equals** the public value.
  - private missing/empty → **UNSAFE** (skipped).
  - private present but **different** → **MISMATCH** (skipped; never auto-deleted —
    reported for manual review).
- **`pinHash` / `pinSalt` / `pinSetAt`**: SAFE to delete **iff** the private copy
  has that field present (presence-based; `pinSetAt` is a Timestamp). Usually
  absent on the public doc (historically rules-denied).
- **Empty/null placeholder keys** hold no PII; left in place by default, removed
  only with `--strip-empty`.
- Deletion is **per field** — a safe field is removed even if another field on the
  same user is unsafe.
- **Idempotent**: re-running after `--apply` finds nothing left to delete.

## What it never does
- Never writes to or deletes from `users/{uid}/userPrivate/profile` (read-only there).
- Only ever issues `FieldValue.delete()` on the 5 named fields of the public
  `users/{uid}` doc.
- Never prints raw phone/email/PIN/salt/OTP or raw UIDs. Counts only;
  `--verbose-redacted` prints masked uids only.
- Does not change app logic, Firestore rules, App Check, or Cloud Functions, and
  deploys nothing.

## Dry-run counts (what they mean)
| # | Count | Meaning |
|---|-------|---------|
| 1 | total users | denominator |
| 2 | users WITH public PII | ≥1 non-empty target field on the public doc |
| 3 | users WHERE private copy exists | `userPrivate/profile` exists |
| 4 | users UNSAFE | ≥1 present public field whose private copy is missing — **skipped** |
| 5 | users SAFE to clean | has public PII AND every present field is safe |
| — | users partially safe | some safe + some unsafe/mismatch (safe fields still cleaned) |
| — | users with a MISMATCH | private exists but value differs — **skipped** |
| — | empty placeholder keys | null/'' keys (removed only with `--strip-empty`) |
| — | per-field deletable / unsafe / mismatch | breakdown across the 5 fields |

## Verifier GO / NO-GO
- **GO** (exit 0): `users STILL holding public PII = 0` →
  `GO: no public PII remains on any users/{uid} doc — cleanup complete.`
- **NO-GO** (exit 1): one or more docs still hold public PII (stragglers). The
  `stragglers with public PII & NO private` count tells you which need a backfill
  first; mismatches need manual review. Resolve, then re-run
  `cleanupPublicPii.ts --apply` and re-verify.
- **Exit 2**: bad credentials/invocation.

The verifier also reports `users with userPrivate/profile present` so you can
confirm the private store was untouched.

## Rollback limitations (read carefully)
- Deleting public fields is **not git-revertable**; reverting the script does
  nothing to data already deleted.
- The **only** safe restore is a **pre-apply Firestore backup / PITR snapshot**.
- The private subdoc retains the canonical values, which is why deletion is safe —
  it is **not** a rollback target. Re-copying private → public would re-expose PII
  and undo the migration.
- Mitigations: dry-run first, verifier GO, backup, maintenance window, batched
  apply (the script commits in batches of 400).
