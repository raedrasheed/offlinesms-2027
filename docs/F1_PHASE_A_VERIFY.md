# F1 Phase A — deploy, backfill & verify (path: `userPrivate`)

Read-only verifier + checklist for confirming Phase A is correctly deployed and
backfilled **before** Phase B. Nothing here deletes public fields or starts
Phase C. Commit baseline: `2a1e0c7`.

## 1. Deploy Phase A
```bash
firebase use offlinesms-prod-2027
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes        # wait until index is Enabled (below)
firebase deploy --only functions:onUserCreate,functions:verifyPhoneOtp,functions:verifyEmailOtp
```
Confirm the collection-group index before backfilling: Console → Firestore →
Indexes → collection group **`userPrivate`**, field **`phoneNumber`**, scope
**Collection group**, status **Enabled** (not Building).

## 2. Run the backfill
```bash
# dry-run (no writes — review counts)
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/backfillUserPrivate.ts

# apply (writes users/{uid}/userPrivate/profile)
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/backfillUserPrivate.ts --apply

# second dry-run (must show "would write subdocs: 0")
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/backfillUserPrivate.ts
```

## 3. Run the verifier (read-only)
```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run verify:userprivate
# or, with a small masked sample of failing uids (still no PII values):
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/verifyUserPrivateBackfill.ts --verbose-redacted
```
The verifier only **reads**. It prints **counts only** (no phone/email/PIN/UIDs)
unless `--verbose-redacted` is passed (which prints a few **masked** uids).

### What the counts mean
| # | Count | Meaning |
|---|---|---|
| 1 | total users | denominator |
| 2 | with `userPrivate/profile` | subdoc created |
| 3 | missing `userPrivate/profile` | OK if those users never had PII |
| 4 | **public phone set, private missing** | **must be 0** — backfill gap |
| 5 | **public email set, private missing** | **must be 0** — backfill gap |
| 6 | private exists but no sensitive data | informational (e.g. metadata-only) |

## 4. GO / NO-GO for Phase B
- **GO** — verifier exits **0** and prints:
  `GO: backfill complete — every public phone/email is mirrored into userPrivate/profile.`
  (i.e. count #4 = 0 **and** count #5 = 0). Combined with the other Phase A
  criteria (rules deployed, index Enabled, functions deployed, second dry-run
  `would write: 0`, smoke tests, clean logs) → Phase B may be deployed.
- **NO-GO** — verifier exits **1** and prints `NO-GO: backfill incomplete → …`.
  Re-run the backfill apply, then re-run the verifier until #4 and #5 are 0.
- **Exit 2** — bad credentials/invocation; fix and re-run.

> Do NOT deploy Phase B until the verifier reports GO and the full Phase A
> evidence has been confirmed.
