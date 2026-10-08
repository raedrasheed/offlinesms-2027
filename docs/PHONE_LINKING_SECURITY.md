# Phase 1 — SMS-abuse shutdown & secure phone linking

Status: **implemented on branch `claude/phase1-sms-abuse-phone-linking`, NOT deployed.**
Nothing in this document has been applied to production. Phone linking ships
**disabled** and stays disabled until its rollout is explicitly authorized.

Starting commit: `9486773d680eb40be5d1d86cdaa2b70970c52fea` (main).

---

## 1. Every path that can issue an OTP or create SMS delivery work

| Path | Caller | Before (main @ 9486773) | After |
|---|---|---|---|
| `requestPhoneOtp` (callable) | **anonymous** | Minted an OTP for any caller-supplied number and queued a relay SMS | Refuses unconditionally (`phone-signin-disabled`) before reading the payload |
| `verifyPhoneOtp` (callable) | **anonymous** | Find-or-**create** Auth user + 50-pt wallet + custom token; fixed test code | Refuses unconditionally; no account, token or wallet |
| `getSupportedPhoneCountries` (callable) | anonymous | Listed countries for the sign-in picker (Firestore reads) | Returns `[]`, no reads |
| Fixed app-review credential `+970599999999` / `123456` | anonymous | Skipped challenge, rate limits and SMS; minted accounts | Removed from code |
| Relay queue: queued `kind:'otp'` jobs | relay devices | Claimable by any device of the OTP org (untagged jobs bypassed country gating) | Cancelled at claim time and by the reaper; body (code) purged |
| Relay retries (`reportRelayDelivery`, `relayReaper`) | system | `maxAttempts:1` on the job was the only guard | Verification kinds can **never** requeue, whatever `maxAttempts` says |
| Firebase Auth native phone provider (`signInWithPhoneNumber`) | client SDK | Dead client code present; provider state in console unknown | Client code removed. **Console state must be checked manually** (§7) |
| `requestEmailOtp` | anonymous | Sends email, not SMS | Unchanged (out of scope; see App Check §5) |
| `escalateSms`, `retryFailedSmsRecipients`, `onSmsBatchAccepted`, org escalation, relay dispatcher (`sms/relayDispatcher.ts:37`, `sms/escalate.ts:323,375`, `orgMessaging/escalateOrgBatches.ts:295,322`, `sms/retryFailed.ts:159`) | authenticated, paid (points) | Business SMS, not OTP | Unchanged; verified they cannot carry caller-chosen OTP text to arbitrary numbers without an authenticated, charged batch |
| `gatewayWebhook` (HTTP) | provider | Inbound delivery reports only (HMAC) | Unchanged |
| **New** `requestPhoneLinkOtp` | authenticated, eligible | — | The only remaining verification-SMS producer; gated (§3) |

## 2. Confirmed root causes (file:line at 9486773)

Reproduced on the unmodified main code against the Firestore + Auth emulators
(see §9 for the exact reproduction). Results of that run:

* **R1 — unauthenticated SMS trigger.** `functions/src/auth/requestPhoneOtp.ts:46`
  is an `onCall` with no `request.auth` check; `:111` queues a relay SMS for any
  number that passes the 59/56 prefix gate. One anonymous caller from one IP
  queued **25/25** SMS to 25 different numbers. There was no per-source,
  per-caller or global limit.
* **R2 — race in the only limit.** The per-number cooldown/hourly cap is a
  read-then-write outside a transaction (`requestPhoneOtp.ts:87-107`). **20 parallel
  requests for one number produced 14 SMS** (limit was 5/hour, 60 s cooldown).
* **R3 — fixed production credential.** `functions/src/auth/otpLogic.ts:15-16` +
  `requestPhoneOtp.ts:56` + `verifyPhoneOtp.ts:49,78,101`: `+970599999999`/`123456`
  minted an Auth account, a custom token and a 50-point wallet with no SMS.
* **R4 — phone numbers in audit rows.** `functions/src/lib/auditLog.ts:98` stores
  `target.id` verbatim and `requestPhoneOtp.ts:135` / `verifyPhoneOtp.ts:119` pass
  the full phone digits.
* **R5 — App Check could not help.** Enforcement is off (`APPCHECK_ENFORCE`) and
  the React-Native app uses the web JS SDK, which has no native attestation
  provider (`apps/mobile/src/lib/appCheck.ts:23`). Not a bug per se, but it means
  nothing distinguished the real app from a script.
* **R6 — weak code RNG.** `otpLogic.ts:57` defaulted to `Math.random` for OTPs
  (also used by email OTP).
* **R7 — client could seed phone/email on profile create.**
  `firestore.rules:161` let an owner create `users/{uid}` with `phoneNumber` and
  `email` when the doc didn't exist yet (confirmed: new rules test fails on old
  rules).
* **R8 — PII outlived account deletion.** `functions/src/auth/deleteAccount.ts:89`
  never deleted `users/{uid}/userPrivate/profile` (phone, email).
* **UI** — `apps/mobile/src/screens/Welcome.tsx:30` still offered "Continue with
  phone". The server shutdown does not depend on this button.

Assumption to confirm: the product owner reports phone registration "has been
disabled". On main the endpoints were still live, so that must have been an
operational change (e.g. relay devices off, `smsConfig/otp` cleared). Phase 1
makes the shutdown a property of the deployed code instead.

## 3. Phone linking — design

Callables (all `us-central1`, authenticated):

| Callable | Purpose |
|---|---|
| `getPhoneLinkStatus` | `{available:false}` while off; otherwise linked / pendingRecovery / eligible / reauthRequired / countries |
| `requestPhoneLinkOtp` | `{phoneE164, ownershipConfirmed:true, smsConsent:true, consentVersion:'phone-link-v1'}` → `{challengeId, expiresAtMs, resendAfterSec, maskedPhone}` |
| `verifyPhoneLinkOtp` | `{challengeId, code}` → `{linked:true, maskedPhone}` |
| `resumePhoneLink` | finish an interrupted link (no code, no SMS) |

**Gates, in order** (`functions/src/phoneLink/gates.ts`, `requestPhoneLinkOtp.ts`):
authenticated → feature enabled (env **and** runtime doc) → `purpose` absent or
`'link'` (anything else is rejected, never coerced) → caller not a relay device →
sign-in provider not `phone`/`anonymous` → Auth user exists and not disabled →
`auth_time` within `reauthMaxAgeSec` (default 10 min) **and** after
`tokensValidAfterTime` (revocation) → Admin-SDK record has `email` +
`emailVerified:true` → `users/{uid}.status` is `active` (or absent on pre-status
profiles) → explicit ownership + SMS consent at the current consent version →
number normalizes (libphonenumber-js, the same normalizer for storage, keys and
delivery) to a valid 59/56 mobile number → not emergency-stopped → relay org
configured and covering the country.

**Re-authentication.** Email accounts sign in with an emailed code (custom
token, `sign_in_provider:'custom'`). The app re-authenticates by emailing a code
to the *current* user's address and refuses to sign in if the returned uid
differs, so the step can never switch accounts. App attestation (App Check) and
user authentication are separate: App Check says "this is our app", the ID token
says "this is user X"; only the latter is enforced here (§5).

**Challenge** (`phoneLinkChallenges/{uid}` — one live challenge per account):
128-bit random `challengeId`; 6-digit code from `crypto.randomInt`; stored only
as `HMAC-SHA256(PHONE_HASH_PEPPER, challengeId|uid|'link'|phoneHmac|code)`, so a
verifier is useless for any other challenge, user, purpose or number. TTL 5 min;
5 wrong codes burn the challenge; 10 wrong codes per account per day lock
verification; single use (`status: used`, verifier deleted). **A new code
invalidates the previous one** (verifier overwritten, its SMS cancelled if still
queued). Verification looks the challenge up by the caller's uid — another user's
challenge is unaddressable — and takes the number from the challenge, never from
the client.

**Uniqueness & linking** (`verifyPhoneLinkOtp.ts`): the correct code atomically
consumes the challenge and creates `phoneClaims/{HMAC(number)}` for the uid
(refused if another *live* account holds it). Then Firebase Auth
`updateUser({phoneNumber})` (Auth enforces global uniqueness, which also covers
legacy phone accounts), then one transaction writes
`users/{uid}/userPrivate/profile.phoneNumber`, `users/{uid}.phoneVerified=true`,
activates the claim and marks the op `done`. State machine in
`phoneLinkOps/{uid}`: `claimed → auth-updated → done` (or `failed`, claim
released). Every step is idempotent; an interruption returns `link-interrupted`
and `resumePhoneLink` (or retrying verify with the same challenge) continues from
the recorded stage without a new code or SMS. A second request is refused
(`link-pending-recovery`) until the op resolves. No account is created or merged;
uid, conversations, memberships, wallet and profile are untouched.

A claim whose owning Auth user no longer exists is treated as stale and can be
taken over; `deleteMyAccount` now releases claims/ops/challenges and deletes
`userPrivate`.

Known product-visible consequence (pre-existing behaviour, flag for review):
writing `userPrivate.phoneNumber` fires `linkPhoneContactsOnUserWrite`, which
links phone contacts and **promotes the user into groups where that number was
an external member** — the same thing that happened for phone sign-ups.

## 4. Abuse controls & thresholds

All checks and counter increments happen in **one Firestore transaction together
with the challenge write and the relay-job create** — nothing is queued unless
every limit passed in that transaction. Counter docs: `smsRateLimits/{acct_uid |
dest_HMAC | src_HMAC | global_phoneLink}` (fixed windows, TTL field `expireAt`).

| Limit | Default | Hard bounds | Trade-off |
|---|---|---|---|
| code TTL | 300 s | 60–600 | short = less guessing time; long = slow SMS |
| wrong codes / challenge | 5 | 1–10 | 5 of 10⁶ ⇒ 5×10⁻⁶ per challenge |
| wrong codes / account / day | 10 | 1–30 | bounds guessing across challenges |
| account cooldown | 60 s | 30–3600 | |
| account per hour / day | 3 / 5 | 0–10 / 0–20 | real users need 1–2 |
| distinct numbers / account | 2 per day, 3 per 30 days | 0–5 / 0–10 | stops one account spraying numbers |
| destination cooldown | 60 s | 30–3600 | protects a victim from many accounts |
| destination per hour / day | 3 / 5 | 0–10 / 0–20 | |
| request source per hour / day | 20 / 60 | 0–200 / 0–1000 | loose on purpose: carrier-grade NAT puts many real users behind one IPv4 |
| global per hour / day | 100 / 500 | 0–2000 / 0–10000 | caps worst-case spend; raise deliberately |
| re-auth freshness | 600 s | 60–1800 | |

Overrides live in `smsConfig/phoneLink.limits` and are clamped into the bounds
(a limit can be tightened to 0 but never raised past its ceiling). Fixed windows
allow up to 2× a window's limit across a window edge; cooldowns and the daily
windows bound that. Windows only expire *forward*: a request carrying an older
timestamp counts into the current window (this was a real overshoot found by the
parallel test and fixed — see §8).

**"Unavailable" probes count.** A number already held by another account returns
the generic `phone-unavailable` (no identity, no SMS) and still consumes the
caller's account budget, so registration status can't be enumerated faster than
codes can be requested.

**Request source.** The per-source bucket uses the right-most
`X-Forwarded-For` entry (configurable `sourceHopsFromRight`, default 1); client-
supplied entries to its left are ignored. IPv4 buckets per address, IPv6 per /64,
no usable address → shared `unknown` bucket. **Must be validated against
production request logs before relying on it**: if the chosen hop turns out to be
a Google front-end address, all callers share one bucket and the per-source limit
behaves like a second global limit (more restrictive, never a bypass).

**Delivery & ambiguous timeouts.** One deterministic job id per challenge
(`plink_<challengeId>`, `create()` in the same transaction) ⇒ at most one SMS per
challenge. Verification jobs carry `expiresAt`; the relay refuses expired ones.
A lapsed lease or a `failed` report is treated as **ambiguous** (the SMS may have
left the phone), so the job is failed, never resent; the user requests a new
code, which goes back through every limit. The SMS body (the only place the code
exists in clear) is deleted on any terminal report or cancellation.

**Emergency stop.** `smsConfig/phoneLink.emergencyStop: true` (or `enabled:false`,
or deleting the doc, or the doc being unreadable) stops new codes immediately
and makes `claimRelayJobs` cancel queued codes instead of handing them out. No
deploy needed. `PHONE_LINK_ENABLED` (deploy-time) is the outer switch.

## 5. App Check — inspected, deliberately not enforced

* Mobile is React Native on the Firebase **web** SDK; App Check there only works
  on web (reCAPTCHA). Native iOS/Android cannot mint tokens today
  (`apps/mobile/src/lib/appCheck.ts`). Enforcing would lock every mobile user out.
* The new callables use the same `appCheckOptions()` as before (env
  `APPCHECK_ENFORCE`, default off) and record whether a token was present
  (`appCheckPresent` on the challenge, `appCheck` in the audit row) so adoption
  can be measured. No bypass of any kind was added for unattested clients.
* Rollout path (needs a product/engineering decision, not done here):
  1. Add native attestation: `@react-native-firebase/app-check` (Play Integrity /
     App Attest) via an Expo config plugin + dev client, or a custom native module
     feeding the JS SDK `CustomProvider`.
  2. Register providers in the console, ship the build, watch App Check metrics
     with enforcement **off** until verified traffic ≈ 100 % of active versions.
  3. Turn on `APPCHECK_ENFORCE` for the phone-link callables first (authenticated,
     low volume), then the unauthenticated email-OTP callables.
  4. Rollback = set `APPCHECK_ENFORCE=off` and redeploy.
  5. Test plan: emulator does not enforce App Check, so verify in a staging
     project with debug tokens (allowed only in staging) and a release build.

## 6. Configuration

| Item | Where | Notes |
|---|---|---|
| `PHONE_HASH_PEPPER` | Secret Manager (`firebase functions:secrets:set PHONE_HASH_PEPPER`) | ≥ 32 random chars. **Must exist before deploying** (the phone-link functions declare it). Rotating it orphans existing claims/counters — treat as permanent. Missing/short ⇒ requests fail closed (`service-paused`). |
| `PHONE_LINK_ENABLED` | `functions/.env.<project>` | Only the exact string `true` enables. Leave unset in production until authorized. |
| `smsConfig/phoneLink` | Firestore (admin-only) | `{enabled, emergencyStop:false, businessId, androidAppHash?, limits?, sourceHopsFromRight?}` |
| `APPCHECK_ENFORCE` | functions env | unchanged, off |

**Firestore rules** (`firestore.rules`): `phoneLinkChallenges` unreadable by
everyone; `phoneClaims`, `phoneLinkOps`, `smsRateLimits` admin read-only, no client
writes; profile create may no longer carry `phoneNumber`/`email`.
**Index** (`firestore.indexes.json`): `relayJobs (kind, status, expiresAt)` for
the reaper sweep. Optional: Firestore TTL policies on `expireAt` for
`smsRateLimits` and `phoneLinkChallenges`.
**Migrations:** none required. Existing `otpChallenges` become inert.

## 7. Deployment sequence, monitoring, rollback (not executed)

1. Review/merge. Create `PHONE_HASH_PEPPER` in Secret Manager.
2. Deploy rules + indexes: `firebase deploy --only firestore:rules,firestore:indexes`.
3. Deploy functions **with `PHONE_LINK_ENABLED` unset** and **no**
   `smsConfig/phoneLink` doc. Effect: public OTP shutdown live, legacy queued OTP
   jobs neutralized at claim/reaper, phone linking invisible.
4. Firebase console (manual, cannot be verified from code): Authentication →
   Sign-in method → **Phone provider disabled**; Identity Platform SMS region
   policy deny-all if available. Linking sets `phoneNumber` on Auth users, so an
   enabled Phone provider would let them sign in by phone.
5. Run the remediation script **dry-run** (§9) and review counts; `--apply` only
   after sign-off.
6. Ship the mobile build (Welcome without phone; Settings row appears only when
   the server reports `available`).
7. When rollout is authorized: create `smsConfig/phoneLink` with
   `emergencyStop:false`, tight limits (e.g. `globalPerDay: 50`), set
   `PHONE_LINK_ENABLED=true`, deploy, test with staff accounts, widen gradually.

Monitoring: `relayMetrics/summary.verificationCancelled`; log lines
`[phoneLink] request limited` (scope, code — no PII) → log-based metrics + alert
on rate; `smsRateLimits/global_phoneLink` vs budget; audit actions
`phoneLink.code.requested|request.unavailable|verify.unavailable|linked|link.unavailable`
and `relay.verification.cancelled`; any new `relayJobs` with `kind:'otp'` should
be **zero** after step 3 (alert if not).

Rollback: emergency stop (`smsConfig/phoneLink.emergencyStop:true`) is instant.
Redeploying the previous functions would **re-open public phone sign-in** — do
not roll back the shutdown; roll forward instead.

Existing data at deploy time: queued legacy `otp` jobs are cancelled on the next
claim or reaper run (≤ 1 min) with bodies purged; `claimed/sending` legacy jobs
fail at lease expiry, never resent; `otpChallenges` can no longer be verified.

## 8. Tests & evidence

| Command | Result (this branch) |
|---|---|
| `npm test` (unit, all workspaces) | 59 files, **656 passed** |
| `npm run test:rules` (Firestore emulator) | 14 files, **140 passed** (11 new) |
| `npm run test:integration` (Firestore + Auth emulators) | 3 files, **59 passed**; 4 consecutive green runs of the core suites |
| `npm run typecheck`, `npm run lint`, `npm run i18n:check`, mobile `tsc --noEmit` | clean |

Integration tests call the real handlers (and `claimRelayJobs`,
`reportRelayDelivery`, `relayReaper`) on the emulators. "Delivery" is the queued
`relayJobs` doc — the code is read from its body; no SMS is sent and no real
number is contacted. Scenario → test file:

| # | Scenario | Where |
|---|---|---|
| 1 | unauthenticated / unverified email / disabled / suspended / stale or revoked auth / phone & anonymous providers / relay tokens / consent / bad numbers | `phoneLink.int.test.ts` "scenario 1" |
| 2 | legacy endpoints (7 payload shapes incl. test credential & purpose smuggling), tampered purpose on the new endpoint | `shutdown.int.test.ts` "scenario 2" |
| 3 | one number from one/many accounts; one account across numbers; many accounts/numbers from one source (incl. spoofed XFF, IPv6 /64); global budget; override ceilings | "scenario 3" |
| 4 | 20 parallel same-account; 8 parallel accounts→one number; 10 parallel vs global budget | "scenario 4" |
| 5 | guessing, parallel guessing, account-wide guess cap, expiry, replay, supersede, simultaneous correct verifies | "scenario 5" |
| 6 | other user's challenge, client-supplied number at verify, code for X vs challenge for Y, forged ids | "scenario 6" |
| 7 | two accounts verify the same number concurrently; legacy holder; stale claim of deleted account | "scenario 7" |
| 8 | Auth-update failure → resume; finalize failure → retry verify; number taken mid-flight → claim released | "scenario 8" |
| 9 | legacy queued jobs, reaper sweep, single job per challenge, transient failure not retried, lease timeout not resent, emergency stop, fail-closed config, env gate | `shutdown.int.test.ts` "scenario 9" |
| 10 | direct client writes to challenges/claims/ops/counters/profile/userPrivate/smsConfig | `tests/rules/phoneLink.rules.test.ts` |
| 11 | uid, profile, wallet, membership, email preserved; no new Auth user | "scenario 11" |
| 12 | rejected calls leave relay jobs, claims, ops, phone fields, balance unchanged; audit/challenge contain no number/code | "scenario 12" |

Defect found by these tests and fixed before delivery: under parallel load the
global budget overshot (4 SMS against a limit of 3) because a request whose
timestamp predated the window start reset the window. Regression tests:
`functions/__tests__/phoneLinkLogic.test.ts` ("REGRESSION") and scenario 4.

**What these tests cannot prove**
* Firebase's own ID-token verification and `auth_time` semantics: tests construct
  the `request.auth` the framework would pass after verification.
* The real `X-Forwarded-For` shape in production (see §4).
* Production Firestore contention behaviour under real load (emulator verified
  serializability; a probe confirmed it locks missing docs too).
* The Android relay app's actual send behaviour and SMS Retriever hash.
* Firebase console settings (Phone provider, Identity Platform).
* The mobile UI on devices (typechecked and unit-tested helpers only; no device
  or E2E run), including RTL layout and the custom-token re-auth on iOS/Android.
* App Check (not enforceable on native today).

## 9. Reproduction & remediation

**Reproduce the original abuse (emulator only)** on the starting commit:

```sh
git worktree add /tmp/main-wt 9486773
ln -s "$PWD/node_modules" /tmp/main-wt/node_modules
cp vitest.integration.config.ts /tmp/main-wt/
mkdir -p /tmp/main-wt/functions/__integration__
cp functions/__integration__/harness.ts /tmp/main-wt/functions/__integration__/
# add a test that calls requestPhoneOtp.run(req(null, {phoneE164})) 25× for
# distinct numbers, 20× in parallel for one number, and
# verifyPhoneOtp.run(req(null, {phoneE164:'+970599999999', code:'123456'}))
cd /tmp/main-wt && npx firebase emulators:exec --project demo-offlinesms \
  --only firestore,auth "npx vitest run --config vitest.integration.config.ts"
```
Observed: 25/25 anonymous SMS queued; 14 SMS from 20 parallel requests to one
number; test credential minted uid + token + 50-pt wallet; audit `targetId` =
full digits.

**Production remediation (documented, NOT executed):**
`scripts/remediatePhoneOtpAbuse.ts` — dry-run by default, counts only (no PII).
`--apply --project=<id>` cancels in-flight legacy OTP jobs, purges code bodies,
deletes `otpChallenges`; `--redact-audit` additionally redacts raw phone audit
targets (destroys forensic detail — export a restricted copy first if the
targeted numbers must be notified). It never touches Auth users: **phone-only
accounts created during the abuse window need a product decision** (the dry-run
reports how many exist since `--since`). Verified against seeded emulator data
(`functions/__integration__/remediation.int.test.ts`).

## 10. Known limitations / follow-ups

* Existing phone-only accounts can no longer sign in on a new device (public phone
  sign-in is off). Their current sessions continue. Needs a product decision
  (e.g. let them add an email from Settings).
* App-review demo login must move to an email account (the fixed phone
  credential is gone).
* Changing or removing a linked number is not implemented (one number per
  account; `already-linked`).
* Abandoned `claimed` links keep the number reserved for that account until it
  resumes or is deleted (no auto-expiry, by design — only the number's owner can
  reach that state). Support can inspect `phoneLinkOps`.
* SMS text is English only (Arabic is UCS-2 and halves the per-segment length);
  product decision.
* `generatePairingCode` (relay pairing) still uses `Math.random`; unrelated to
  OTP, low risk (admin-issued, 15-min TTL) — follow-up.
* `requestEmailOtp` remains unauthenticated by design (sign-in); it sends email,
  not SMS, and benefits from App Check once native attestation exists.
