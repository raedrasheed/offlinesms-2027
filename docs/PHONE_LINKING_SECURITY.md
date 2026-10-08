# Verification-SMS (OTP) security — Phase 1, revised after review

Status: **implemented and tested locally on branch `claude/phase1-sms-abuse-phone-linking`. NOT deployed, NOT verified in production.**
Nothing here has been applied to production. Every purpose ships **off**; the
current production suspension is preserved until an explicitly authorized rollout.

| | SHA |
|---|---|
| Base (main) | `9486773d680eb40be5d1d86cdaa2b70970c52fea` |
| First review head (PR #28) | `8011ab4531774eead4ab1ab3db5e4bc3b009eba6` |
| This revision | see the PR description (head of the branch) |

Terms used below: **implemented** = code on this branch; **tested locally** =
executed in this environment at the layer stated; **deployed** / **verified in
production** = not done for anything in this document.

---

## 1. Scope correction (R1)

The first revision removed public phone sign-in. That was a product change, not
the requested fix. This revision **keeps public phone sign-up / sign-in for people
without an account** and protects it, while keeping the vulnerable original
handler retired. Phone linking to an existing email account remains a separate,
optional purpose. Neither purpose requires the other.

## 2. Threat model

| Actor | Can | Cannot (after this change) |
|---|---|---|
| **Anonymous requester** (script, botnet, rotating IPs, reinstalling app) | open pre-auth sessions; request codes for numbers | get an SMS without a fresh single-use proof-of-work bound to the session **and** the number; exceed session / installation / source / destination / global budgets; reuse a proof; guess against another session's challenge; reset budgets by verifying, reinstalling or opening new sessions |
| **Target (destination) number** | receives codes | receive more than 1 per 60 s / 3 per hour / 5 per day across *all* requesters and both purposes; have its code guessed more than 10 times/day across all sessions |
| **Relay device** (Android phone + SIM) | claim jobs, report results, heartbeat | over-claim capacity (server reservations); reset counters via heartbeat; send a verification code without a just-in-time server authorization (current build); send a stale/expired/superseded/stopped code through the final authorization; receive verification jobs at all if it's an old build |
| **Administrator** (dashboard) | set sender, master/purpose switches, emergency stop (audited, bump policyVersion, cancel queued codes) | write relayJobs, smsConfig, challenges, counters from a client SDK (rules deny, even with an admin claim) |
| **Account holder** | link own number (link purpose) | change verified-phone fields directly (rules) |

Boundaries: **before an account exists** the only identity is the opaque
pre-auth session (bearer, 256-bit, stored as HMAC) — signals are session,
installation id (untrusted), request source (trusted XFF hop), destination and
global budgets. **After** verification the Firebase uid exists; account-level
limits apply to the link purpose. Source identity and installation ids are
**risk signals, not identities**; none of them identifies a person.

## 3. Send-gate map (every producer and consumer)

| Path | Gate (where enforced) |
|---|---|
| `requestPhoneOtp` / `verifyPhoneOtp` (original) | **Retired**: refuse every call before reading the payload (`functions/src/auth/requestPhoneOtp.ts`, `verifyPhoneOtp.ts`) → `app-update-required` |
| `startPhoneAuth` | policy (env `PHONE_AUTH_ENABLED` + smsConfig/otp master, stop, sender, `signin.enabled`) → optional App Check requirement → per-source session budget (tx) |
| `requestPhoneAuthCode` | policy → attestation → purpose fixed → valid E.164 + 59/56 → relay coverage → **one tx**: session valid → idempotent replay → single-use PoW (rotated on every check) → session / installation / source (incl. distinct numbers) / destination / sign-in global / shared global → counters + challenge + ≤1 relay job |
| `verifyPhoneAuthCode` | policy (purpose on) → session-bound challenge → expiry, per-challenge attempts, per-destination daily wrong-code cap → single use → monotonic completion (planned uid, one-time welcome credit, explicit Auth errors) |
| `requestPhoneLinkOtp` / `verifyPhoneLinkOtp` / `resumePhoneLink` | auth + eligibility (verified email, active, fresh sign-in, consent) → link budgets + shared global → challenge + ≤1 job; monotonic link ops |
| `getSupportedPhoneCountries` | legacy callers → `[]`; `{v:2}` → countries only while sign-in sending is allowed |
| `claimRelayJobs` | device token → per-job tx re-reads job **and** device: status, pause/revoke, `countryRoutingEnabled` + countries, **capacity reservation (minute/hour/day)**; verification jobs: capability `send-auth-v1` required, legacy `otp` cancelled, expiry + sender + policyVersion bound |
| `authorizeRelaySend` (new) | lease owner, job `claimed` (single use), device active, verification: policy/sender/version/expiry + challenge still current & pending → job `sending` |
| Android `RelayService` | per job: local pause → Room insert result (duplicate ⇒ never resend) → deadline (monotonic) → authorization (fail closed) → persist `sending` → `SmsManager` |
| `reportRelayDelivery` | lease owner; idempotent/ordered; verification never requeues; metrics only (not capacity) |
| `relayReaper` | lapsed lease: verification ⇒ fail (no resend); queued legacy/expired verification ⇒ cancelled + body purged |
| `relayHeartbeat` | liveness + **telemetry only** (clamped); never touches `counters` or `usage` |
| Dashboard actions | platform admin only; set/clear sender, master/purpose/stop; bump `policyVersion`; cancel queued verification jobs; audited |
| `requestEmailOtp` (email) | admin flag → **tx** reservation (cooldown/hour in `emailOtpLimits`) + challenge before send |
| Business SMS (escalation, org batches, test send) | unchanged producers (authenticated/paid); now subject to claim-time capacity reservation and per-job device re-checks |

## 4. Findings R1–R8 (review of PR #28)

| # | Status | Fix | Tests (layer) |
|---|---|---|---|
| **R1** public phone flow removed | **Fixed** | Protected public flow `functions/src/phoneAuth/*`: pre-auth session, PoW, layered budgets, idempotent requestId, session-bound challenge, recoverable completion; mobile `PhoneEntry`/`Otp` use it; Welcome shows phone only while open | `phoneAuth.int.test.ts` A/B/C/D/M (handler), `wire.callable.test.ts` (HTTP), `phoneAuth.test.ts` (client flow) |
| **R2** heartbeat resets counters | **Fixed** server + app | Heartbeat stores clamped `telemetry`; capacity uses server `usage` reservations; app no longer sends counters | `relay.int.test.ts` E (exact old Android payload `sentToday:0`), unit clamps |
| **R3** no reservations | **Fixed** | Reservation in the same tx as the lease; minute/hour/day; UTC rollover; accounting unit = claimed attempt (conservative, no refunds); delivered-before-sent fixed | `relay.int.test.ts` F + A11, unit windows/rollover |
| **R4** stop/expiry only at claim | **Fixed** (bounded window documented) | `authorizeRelaySend` immediately before hand-off; claim returns kind/requiresSendAuth/sendWithinMs; app checks pause per job, monotonic deadline, fail-closed auth, Mutex, Room IGNORE honoured, `sending` persisted before hand-off | `relay.int.test.ts` G (handler), `SendGateTest` (JVM) |
| **R5** stale sender/routing | **Fixed** | Jobs carry `businessId` + `policyVersion`; claim/authorize compare with current policy; dashboard bumps version and cancels queued codes; `countryRoutingEnabled` and device status re-read in tx | `relay.int.test.ts` H |
| **R6** late worker downgrades `done` | **Fixed** | All op transitions conditional (`advanceOp`); release never undoes a terminal op; corrupted ops reconstructed from HMAC-matched sources | `phoneLink.int.test.ts` J (exact two-worker + crash ordering; **fails on PR #28 code, passes now**) |
| **R7** reauth always → number entry | **Fixed** | `stepForStatus` (pure) + reload after reauth; recovery wins even while sending is paused | `phoneAuth.test.ts` K (unit; no device UI run) |
| **R8** CI didn't run security suites | **Fixed** | `security-emulators` CI job: rules, integration, wire-level callable, JVM send rules | CI (runs on push) |

## 5. Original audit F01–F16

| # | Status |
|---|---|
| F01 requester/distinct budgets | Fixed — session, installation, source (+distinct/day), destination, global, shared |
| F02 native attestation | Partially — App Check accepted and enforceable by policy (`signin.attestation:'required'`, replay protection via `APPCHECK_CONSUME`); **native attestation not implemented** (needs `@react-native-firebase/app-check` + native rebuild). PoW is the active server-verified anti-automation step; it raises cost, it does not prove humanity |
| F03 non-atomic admission | Fixed — single tx incl. job; side effects (FCM, audit) after commit; requestId idempotency |
| F04 success resets budgets | Fixed — counters in `smsRateLimits` / `emailOtpLimits`, never deleted by verification |
| F05 heartbeat counters | Fixed (= R2) |
| F06 no reservations | Fixed (= R3) |
| F07 queued OTP outlive challenge | Fixed — expiry + challenge binding + supersession at admission, claim, authorization; reaper sweep |
| F08 no stop control | Fixed — master/purpose/stop/sender with fail-closed defaults; dashboard clear-sender works; queued codes cancelled on change. Policy clarification: **sign-in suspension blocks new codes and verification for sign-in; linking has its own switch**; existing sessions are unaffected |
| F09 relay rechecks | Fixed (= R4/R5) |
| F10 fixed review code | Fixed — removed; replaced by revocable, time-boxed, hashed **store-review access** to one demo uid, no SMS (`scripts/setReviewAccess.ts`) |
| F11 Math.random | Fixed — OTP, pairing codes (server + dashboard) use CSPRNG |
| F12 telemetry/identifiers | Fixed — keyed HMAC identifiers, opaque job ids, structured rejection logs with reason+scope, audit rows without numbers/codes |
| F13 parsing | Fixed — libphonenumber validity + supported prefix, one normalizer |
| F14 challenge binding/recovery | Fixed — opaque challenge + session binding, per-destination guess cap, explicit Auth error classes, monotonic recoverable completion, cleanup returns instead of throwing |
| F15 email OTP | Fixed (scoped companion) — tx reservation before send, separate limits doc, cleanup commits, explicit `user-not-found` |
| F16 tests at real boundaries | Fixed — handler/emulator, wire-level, JVM, rules; CI gate |

## 6. Design details

### 6.1 Public phone sign-in / sign-up
* **Session** `phoneAuthSessions/{HMAC(token)}`: 30 min, ≤3 codes, ≤2 numbers,
  60 s cooldown, carries the current PoW challenge and the last request (for
  idempotent replay). Opening sessions: ≤30/hour per source.
* **Proof-of-work**: `SHA-256("pow:v1:"+nonce+":"+e164+":"+solution)` with ≥ bits
  leading zeros; nonce single use (rotated on every check, returned in errors),
  10 min TTL, adaptive difficulty (+2 bits at 50 % of the hourly budget, +4 at
  90 %). Default 14 bits ≈ 16 k hashes on average. Measured here with the app's
  pure-TS SHA-256 on Node (V8 JIT): ~211 k hashes/s (16 bits averaged 0.41 s over
  8 solves). Hermes on a phone is expected to be several times slower and was
  **not measured** — tune `signin.limits.powBits` from field timing.
* **Budgets** (defaults; clamped bounds in `functions/src/phoneAuth/config.ts`):
  installation 5/day & 3 numbers/day (untrusted); source 20/h, 60/day, 10
  numbers/day; destination 60 s, 3/h, 5/day (shared with linking), 10 wrong
  codes/day; sign-in global 100/h, 500/day; shared (sign-in + link) 150/h, 700/day.
  These are starting points, **not** derived from production volumes (none were
  available) — set them from observed legitimate traffic before widening.
* **Shared IPs** (carrier NAT, universities): source limits are deliberately
  looser than destination/session limits and only *throttle* (time-boxed
  windows); nobody is permanently blocked. Under heavy shared-IP use the
  per-source cap is the knob to raise.
* **Completion**: `phoneAuthOps/{challengeId}` `verified → user-ready → done`;
  uid planned before `createUser` so a crash mid-create is recognised; welcome
  wallet created once (`tx.create`, only for an account this flow created);
  only `auth/user-not-found` means "new account"; disabled / suspended accounts
  are refused; a retry with the same session re-issues a token for 10 min.
* **Store review**: `smsConfig/otp.signin.review` (script-managed): one number →
  one pre-existing demo uid, salted-hash code, ≤30 days, revocable, no SMS, never
  creates or resolves accounts. Use a number the business controls.

### 6.2 Relay
* Accounting unit = one **claimed job attempt** (logical message, not billed
  segments). Never refunded; ambiguous outcomes count as sent.
* Verification jobs: `maxAttempts:1`, never requeued; lapsed leases fail.
* Remaining unavoidable window: between `authorizeRelaySend` returning ok and
  `SmsManager.sendMultipartTextMessage` (normally milliseconds, plus the 4 s
  pacing is *after* send). A message handed to the modem/carrier cannot be
  recalled; exactly-once carrier delivery across crashes is **not** claimed.
* Old relay builds (versionCode 1) receive business SMS only; **minimum relay
  version for verification SMS: 0.2.0 (versionCode 2)**.

## 7. Configuration

| Item | Where | Notes |
|---|---|---|
| `PHONE_HASH_PEPPER` | Secret Manager | ≥32 random chars; must exist before deploy; rotation orphans counters/claims |
| `PHONE_AUTH_ENABLED`, `PHONE_LINK_ENABLED` | functions env | exact `true` enables a purpose; leave unset |
| `APPCHECK_ENFORCE`, `APPCHECK_CONSUME` | functions env | unchanged default off; see §5 F02 |
| `smsConfig/otp` | Firestore (server-only writes) | `{businessId, enabled, emergencyStop:false, policyVersion, signin:{enabled, limits?, attestation?, review?}, link:{enabled, limits?}, shared:{perHour, perDay}, sourceHopsFromRight?}` |
| Rules | `firestore.rules` | new server-only collections; **client writes to relayJobs, smsConfig, otp/email challenges denied (admins too)** |
| Index | `firestore.indexes.json` | `relayJobs (kind, status, expiresAt)` |
| Migrations | none required | legacy `otp` jobs cancelled at claim/reaper; pre-existing `smsConfig/otp` resolves to OFF |
| Native builds | mobile: new build with the v2 phone flow; relay: 0.2.0 | old mobile builds see no phone countries and get `app-update-required` |

## 8. Deployment, observability, rollback (not executed)

1. Review/merge. Create `PHONE_HASH_PEPPER`. Confirm Firebase Auth's built-in
   **Phone provider is disabled** (console; not verifiable from code).
2. Deploy rules + indexes, then functions **with both env flags unset**. Effect:
   retired endpoints refuse; queued legacy codes are cancelled; heartbeat fix and
   reservations are live; no verification SMS can be sent.
3. Ship relay 0.2.0 to every relay phone; confirm `appVersion` via heartbeats.
4. Remediation **dry-run** (§9); `--apply` only after sign-off.
5. Ship the mobile build.
6. Authorized rollout: set env flag(s) + deploy; in the dashboard set the sender,
   enable master + purpose, lift the stop; start with tight limits; watch.

Monitoring: logs `[phoneAuth] request refused {reason, scope, source, dest}` and
`[phoneLink] request limited`, `[relay] send not authorized {reason}`; audit
actions `phoneAuth.code.queued`, `phoneAuth.signedIn`, `phoneLink.*`,
`relay.verification.cancelled`, `relay.otp.policy.set`; counters
`smsRateLimits/global_phoneAuth|global_phoneLink|global_verification`;
`relayDevices.usage` vs caps; any new `relayJobs` with `kind:'otp'` must be zero.

Rollback: the **emergency stop** (dashboard or doc) is instant and stops
admission and hand-off for every verification purpose. Do **not** redeploy an
older functions revision: that restores the exploitable sender. Roll forward.

## 9. Tests and evidence

| Layer | Command | Result (this revision) |
|---|---|---|
| Helper/unit | `npm test` | see PR description |
| Firestore rules (emulator) | `npm run test:rules` (with the Firestore emulator) | see PR description |
| Handler + Firestore/Auth emulators | `npm run test:integration` | see PR description |
| Wire-level HTTP via Functions emulator | `npm run test:callable` | see PR description |
| Relay send rules (plain JVM) | `gradle -p apps/mobile-relay/sendgate-jvm-test test` | see PR description |
| UI on device, Android app build, real SMS | — | **not run** (no device/SDK here) |

Negative controls run: R6 tests fail on the PR #28 file and pass now; the rules
tests fail on the base rules for the profile-create gap; the original abuse was
reproduced on the base commit (25/25 anonymous SMS queued; 14 SMS from 20
parallel requests to one number; fixed credential minted an account).

What these layers do **not** prove: Firebase's ID-token **signature** checking
(the Auth emulator doesn't sign tokens), App Check (emulator doesn't enforce),
the production `X-Forwarded-For` chain, production Firestore contention, the
relay APK on a device and the modem/carrier, PoW timing on low-end phones,
RTL/UI behaviour on devices.

### Production remediation (documented, NOT executed)
`scripts/remediatePhoneOtpAbuse.ts` — dry-run by default, counts only (no PII),
including `inFlightPossiblyOnDevice` (legacy jobs a relay may already hold).
`--apply --project=<id>` cancels queued/claimed legacy OTP jobs, purges bodies and
deletes `otpChallenges`. Audit redaction needs
`--redact-audit --forensic-export=<file>` (raw rows written first, mode 0600) or
an explicit `--no-forensic-export`. It never touches Auth users. Claimed legacy
jobs on an **old** relay build may still be sent by that phone and anything
handed to the modem can't be recalled — the server-side cancel prevents only
further hand-offs and retries. Verified against seeded emulator data
(`functions/__integration__/remediation.int.test.ts`).

## 10. Code-confirmed weaknesses vs. the historical incident

Everything in §4–§5 is **code-confirmed** (and reproduced in emulators where
stated). None of it proves which mechanism was used in the reported incident or
who the requester was. Attribution needs, if available: the deployed function
revision and env at the time; `smsConfig/otp` history; `relayJobs` by
kind/status/time (destinations masked, no bodies); relay heartbeats/counters and
carrier records; platform request logs. An IP address or a destination number is
not the identity of a person; a client installation id is resettable.

## 11. Known limitations / follow-ups

* Native App Check (Play Integrity / App Attest) is not implemented; PoW is a cost
  layer, not a human check. Decision needed on the native module rollout.
* Thresholds are not derived from production data.
* Admin-claim clients can still write `relayDevices` (incl. `usage`); writes go
  through rules as before. Consider server-only writes there too.
* `requestEmailOtp` stays unauthenticated by design; keeps a conservative
  reservation when the provider fails (user waits for the cooldown).
* Phone-link side effect (pre-existing): linking/sign-in sets the private phone,
  which runs `linkPhoneContactsOnUserWrite` and can **add the user to groups
  where that number was an external member**. Group membership is therefore not
  universally unchanged.
* SMS text is English only.
