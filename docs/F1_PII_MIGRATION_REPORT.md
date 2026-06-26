# F1 — Sensitive PII Migration: Final Report

**Status: COMPLETE (backend / dashboard / security).** Validated at commit `e42c7c2`.

This document is the final validation record for the F1 migration that moved a
user's sensitive PII (`phoneNumber`, `email`, `pinHash`, `pinSalt`, `pinSetAt`)
out of the world-readable `users/{uid}` document into an owner/admin-only
subdocument `users/{uid}/userPrivate/profile`.

---

## 1. Architecture: before vs after

### Before
```
users/{uid}                      ← readable by ANY signed-in user
  ├─ displayName, username, …    (public profile — fine)
  ├─ phoneNumber   ⚠ PII         readable by everyone
  ├─ email         ⚠ PII         readable by everyone
  └─ pinHash/pinSalt ⚠           (PIN write was actually rules-denied here)
```
- Any authenticated user could read every other user's phone number and email
  by reading the public `users/{uid}` doc.
- Phone-number → uid discovery scanned public fields.
- PIN set/verify targeted the public doc and was silently denied by the profile
  field allow-list (PIN never worked).

### After
```
users/{uid}                      ← readable by ANY signed-in user
  ├─ displayName, username, status, phoneVerified, emailVerified, prefs …
  └─ (NO phoneNumber / email written for new users; PIN never here)

users/{uid}/userPrivate/profile  ← OWNER or ADMIN only (rules); backend via Admin SDK
  ├─ phoneNumber   ✅ private     written only by verified OTP flow (Admin SDK)
  ├─ email         ✅ private     written only by verified OTP flow (Admin SDK)
  └─ pinHash/pinSalt/pinSetAt ✅  owner-writable (only these), set by mobile setPin
```
- Sensitive PII is no longer exposed to other users.
- Phone discovery resolves via `collectionGroup('userPrivate')` (Admin SDK only;
  a client collection-group query over these docs is denied by rules).
- PIN now works (owner-writable in the private subdoc).

> Note on field-level reads: Firestore rules are document-level, so the still
> world-readable `users/{uid}` doc cannot "hide" individual fields. PII privacy
> is achieved by **not writing** PII there (Phase C, commit 1) and reading it
> only from the private subdoc — not by a rule on the public doc. Existing
> public PII *values* on legacy docs are intentionally **not deleted** by this
> migration (see Remaining technical debt).

---

## 2. Phase summaries

### Phase A — dual-write (no behavior change for readers)
Mirror PII into `users/{uid}/userPrivate/profile` while the public doc still
carried the same fields. Added the `userPrivate` helper, the owner/admin rules
for the subdoc, the `COLLECTION_GROUP` index on `userPrivate.phoneNumber`, the
idempotent backfill, and a read-only verifier. No reads switched. Deployed to
production and backfilled (71/71 users; verifier GO).

### Phase B — switch reads (dual-write kept, public fields kept)
All sensitive reads moved to the private subdoc (private-first, with a temporary
public fallback for safety): by-uid phone reads via `readUserPhone`, phone→uid
discovery via `collectionGroup('userPrivate')`, the `linkPhoneContacts` trigger
re-pointed to the subdoc, PIN moved to the subdoc (mobile), and the dashboard
org-messaging recipient resolution switched to the collection group. Deployed
(functions + DigitalOcean dashboard); smoke tests passed; production healthy.

### Phase C — remove dual-write, remove fallback, harden (this phase)
1. **Stop dual-write** — the three auth writers no longer write PII to the
   public doc; PII goes only to the private subdoc.
2. **Remove fallback reads** — `readUserPhone`, `classifyRecipients`, dashboard
   `adminData`/export now read PII exclusively from the private subdoc.
3. **Tighten rules** — `userPrivate/{doc}`: owner may write only PIN fields;
   phone/email are Admin-SDK/admin-only; delete is admin-only.
4. **Cleanup** — removed dead `safeUserSummary`, unused
   `dualWriteUserPrivateProfile`, synthetic-sender null PII writes, and stale
   Phase A/B comments.
5. **Validation** — full audit + this report. Commit `5a` fixed the two findings
   the audit surfaced (admin-search email read; two stale comments).

---

## 3. Important commits

| Commit | Phase | Summary |
|--------|-------|---------|
| `2a1e0c7` | pre-A | Rename collection group `private` → `userPrivate` |
| `5ae742d` | A | Dual-write user PII to the private subdoc (no read switch) |
| `2cb0856` | A | Read-only Phase A backfill verifier |
| `9d3af1c` | B | Switch reads to the private subdoc (dual-write kept) |
| `f7bdaf1` | ops | Remove dead Firebase Hosting `dashboard` target |
| `704752d` | C1 | Stop dual-write of PII to the public users doc |
| `1f25159` | C2 | Remove public PII read fallbacks |
| `af3ef73` | C3 | Tighten `userPrivate` Firestore rules |
| `4d55e90` | C4 | Remove migration remnants |
| `e42c7c2` | C5a | Fix final audit findings (admin search email; stale comments) |

---

## 4. Files changed by area

**Backend (Cloud Functions)**
- `functions/src/lib/userPrivate.ts` — helper: ref, `writeUserPrivateProfile`,
  `readUserPhone` (private-only), `findUidsByPhoneNumbers`, `findUidByPhoneNumber`.
- `functions/src/auth/onUserCreate.ts`, `verifyPhoneOtp.ts`, `verifyEmailOtp.ts`
  — write PII only to the private subdoc.
- `functions/src/sms/recipients.ts` (`classifyRecipients`), `relayDispatcher.ts`,
  `retryFailed.ts` — phone reads from the private subdoc.
- `functions/src/contacts/matchContacts.ts`, `createPhoneContact.ts`,
  `linkPhoneContacts.ts` — discovery/trigger via `userPrivate`.

**Dashboard (Next.js, Admin SDK)**
- `apps/dashboard/lib/adminData.ts` — `listUsers`/`getUser` read PII from private.
- `apps/dashboard/app/admin/users/export/route.ts` — export reads PII from private.
- `apps/dashboard/app/admin/search/route.ts` — admin search reads email from private.
- `apps/dashboard/lib/orgMessagingService.ts` — discovery via `collectionGroup`;
  synthetic-sender null PII writes removed.
- `apps/dashboard/lib/redaction.ts` — dead `safeUserSummary` removed (mask helpers kept).

**Mobile (Expo)**
- `apps/mobile/src/lib/pin.ts` — PIN read/write in the private subdoc.

**Rules / indexes / tooling**
- `firestore.rules` — owner/admin-only `userPrivate`, owner limited to PIN fields.
- `firestore.indexes.json` — `COLLECTION_GROUP` index on `userPrivate.phoneNumber`.
- `tests/rules/users.rules.test.ts` — full private-subdoc rules matrix (19 tests).
- `scripts/backfillUserPrivate.ts`, `scripts/verifyUserPrivateBackfill.ts` —
  migration tooling (kept for reference).

---

## 5. Security improvements
- Cross-user PII exposure **closed**: phone/email are no longer readable by other
  authenticated users.
- Phone-spoofing for discovery **closed**: the owner can no longer write
  `phoneNumber`/`email` to their own private subdoc (rules limit owner writes to
  PIN fields); those fields are Admin-SDK/admin-only.
- Client phone harvesting **closed**: a client `collectionGroup('userPrivate')`
  query is denied by rules (proven by test).
- PIN at rest is owner-only and now actually functions (previously rules-denied).
- Admin surfaces (list/detail/export/search) keep masking and now read from the
  private source.

---

## 6. Operational / deployment notes
- **Deploy order for this branch:** `firestore:rules` and `firestore:indexes`
  (index already Enabled), then `functions`, then the **DigitalOcean** dashboard
  (`dash.offlinesms.com`) — the dashboard is a Next.js server app, NOT Firebase
  Hosting (the dead Hosting target was removed in `f7bdaf1`).
- App Check: **unchanged** (`APPCHECK_ENFORCE` default OFF). Not part of F1.
- No dependency upgrades, no schema changes, no Firestore structure changes in
  Phase C.
- Existing production state at start of Phase C: Phase A+B deployed, backfill
  71/71, verifier GO, smoke tests passed.

---

## 7. Remaining technical debt
1. **Public PII values on legacy docs are not deleted.** Phase C stops *writing*
   and *reading* public PII, but pre-existing `phoneNumber`/`email` values remain
   on old `users/{uid}` docs. They are now inert (nothing reads them). A future
   optional one-off cleanup could null/delete them; until then the world-readable
   `users/{uid}` doc still technically *contains* stale PII for legacy users.
   This was explicitly out of scope ("do not delete public PII fields").
2. **Mobile own-profile read** — `apps/mobile/src/screens/Settings.tsx` reads the
   user's **own** `phoneNumber` from the public doc with a Firebase Auth fallback
   (`auth.currentUser?.phoneNumber`) that keeps it working. Not a cross-user leak.
   Address in the next **mobile rebuild** (read own phone from the private subdoc).
3. **Mobile PIN rebuild** — the PIN-in-private behavior (`pin.ts`) ships only with
   a new mobile build; until then older clients can't set/verify a PIN. Schedule
   with the next mobile release.
4. **Migration scripts retained** — `backfillUserPrivate.ts` /
   `verifyUserPrivateBackfill.ts` read public PII by design; kept for reference.

---

## 8. Rollback notes
- Each Phase C commit is independently revertable (`git revert <hash>`); none
  reintroduce the legacy `private` collection name (the rename predates them).
- `git revert e42c7c2` restores the admin-search public email read + old comments.
- `git revert af3ef73` restores the blanket `userPrivate` read/write rule.
- `git revert 1f25159` restores the public read fallbacks.
- `git revert 704752d` restores public PII writes (dual-write).
- Operationally, a fast production rollback is a Cloud Run revision rollback for
  functions plus a DigitalOcean redeploy of the prior dashboard build; rules can
  be redeployed from a reverted `firestore.rules`. Because public PII values were
  never deleted, reverting reads/writes is safe — no data restoration required.

---

## 9. Final status
- **Verification (this commit):** typecheck ✅, lint ✅, unit 586 ✅, rules 129 ✅,
  build ✅.
- **Audit:** no public `users/{uid}.phoneNumber`/`.email` reads; no public PII
  writes; no public fallback logic; no legacy `private` references; no obsolete
  helpers/stale runtime comments. All sensitive PII paths use
  `users/{uid}/userPrivate/profile`.

**The F1 PII migration is COMPLETE from the backend, dashboard, and security
perspective.** What remains is outside this migration: the optional deletion of
inert legacy public PII values, and the mobile rebuild (own-profile phone read +
PIN), to be handled with the next mobile release.
