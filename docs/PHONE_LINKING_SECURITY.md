# Verification-SMS (OTP) security — Phase 1, revised after review

Status: **implemented and tested locally on branch `claude/phase1-sms-abuse-phone-linking`. NOT deployed, NOT verified in production.**
Nothing here has been applied to production. Every purpose ships **off**; the
current production suspension is preserved until an explicitly authorized rollout.

| | SHA |
|---|---|
| Base (main) | `9486773d680eb40be5d1d86cdaa2b70970c52fea` |
| First review head (PR #28) | `8011ab4531774eead4ab1ab3db5e4bc3b009eba6` |
| Second review head (findings N1–N7) | `430dcfcbdc123ead8042d699635e93737c622754` |
| Third review head (findings M1–M3) | `0e90b7a14ddfdc18b01e9999878f2b40d3b3a1a6` |
| This revision | see the PR description (head of the branch) |

**Current review status:** the independent third review of `0e90b7a` (CI green
there, including the full relay Android build) accepted N2, N3, N4, N6 and N7 for
their reviewed scenarios, found N1 substantially corrected but for M3, and N5
partial because of M1/M2. It requested a focused round on M1–M3. This revision
addresses M1–M3 (§4c); it has **not** been re-reviewed. Production verification
SMS stays disabled pending review and the deployment/device gates (§11).

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
| `verifyPhoneAuthCode` | policy (purpose on) → session-bound challenge → expiry, per-challenge attempts, per-destination daily wrong-code cap → single use → monotonic completion (planned uid, one-time welcome credit, explicit Auth errors) → **every token mint (first, resume, lost-response replay) passes one gate**: completion window from server acceptance, Auth user not disabled, profile active; review ops additionally: same review generation + demo uid, designated demo account |
| `requestPhoneLinkOtp` / `verifyPhoneLinkOtp` / `resumePhoneLink` | auth + eligibility (verified email, active, fresh sign-in, consent) → link budgets + shared global → challenge + ≤1 job; monotonic link ops |
| `getSupportedPhoneCountries` | legacy callers → `[]`; `{v:2}` → countries only while sign-in sending is allowed |
| `claimRelayJobs` | device token → per-job tx re-reads job **and** device: status, pause/revoke, `countryRoutingEnabled` + countries, **capacity reservation (minute/hour/day)**; verification jobs: capability `send-auth-v1` required, legacy `otp` cancelled, expiry + sender + policyVersion bound |
| `authorizeRelaySend` (new; **verification jobs only** — business SMS never call it) | lease owner, job `claimed` (single use), device active, **device country routing re-checked** (`countryRoutingEnabled` + allow-list), verification: policy/sender/version/expiry + challenge still current & pending → job `sending`; returns a budget ≤ 15 s and ≤ the code's remaining lifetime, computed inside the transaction |
| Android `RelayService` → `SendPipeline` | per job: local pause → local de-dup by (jobId, **server attempt**) → claim deadline measured from the claim **request** start (monotonic) → authorization (fail closed) → deadline = min(claim, authorization budget from its request start) − 1.5 s → durable `sending` in Room → **final pause + deadline check after the write** → `SmsManager`; refusals of a possibly-handed-off job write the sticky `noResend` mark and the attempt-bound report in one awaited Room transaction (M1) |
| `reportRelayDelivery` | bound to ONE attempt (M2): applied only to the job's current attempt from the device holding it; stale/duplicate/unbound reports are acknowledged and never applied to a newer attempt; a stale report that the message may already have gone out stops further attempts (`noRetry`) or settles a job waiting between attempts; verification never requeues; metrics only (not capacity) |
| `relayReaper` | lapsed lease: verification or `noRetry` ⇒ fail (no resend); bounded run of the stale-code sweep |
| Stale-code sweep (`verification/staleJobSweep.ts`; on every `smsConfig/otp` change + each reaper run) | paginated by document id over every queued verification kind; per job a transaction re-reads the job **and the current policy** and cancels only if still `queued` and invalid now (legacy, expired, stopped, other sender, other generation) |
| `relayHeartbeat` | liveness + **telemetry only** (clamped); never touches `counters` or `usage` |
| Dashboard actions | platform admin only; set/clear sender, master/purpose/stop; `policyVersion` bumped **in a transaction** with the change; no client-side bulk cancel (the server sweep does it conditionally); audited |
| `requestEmailOtp` (email) | admin flag → **tx** reservation (cooldown/hour in `emailOtpLimits`) + challenge (with a send **generation**) before send → provider outcome written only if the challenge still carries that generation and is still `sending` |
| Business SMS (escalation, org batches, test send) | unchanged producers (authenticated/paid); now subject to claim-time capacity reservation and per-job device re-checks |

## 4. Findings R1–R8 (review of PR #28)

| # | Status | Fix | Tests (layer) |
|---|---|---|---|
| **R1** public phone flow removed | **Fixed** | Protected public flow `functions/src/phoneAuth/*`: pre-auth session, PoW, layered budgets, idempotent requestId, session-bound challenge, recoverable completion; mobile `PhoneEntry`/`Otp` use it; Welcome shows phone only while open | `phoneAuth.int.test.ts` A/B/C/D/M (handler), `wire.callable.test.ts` (HTTP), `phoneAuth.test.ts` (client flow) |
| **R2** heartbeat resets counters | **Fixed** server + app | Heartbeat stores clamped `telemetry`; capacity uses server `usage` reservations; app no longer sends counters | `relay.int.test.ts` E (exact old Android payload `sentToday:0`), unit clamps |
| **R3** no reservations | **Fixed** | Reservation in the same tx as the lease; minute/hour/day; UTC rollover; accounting unit = claimed attempt (conservative, no refunds); delivered-before-sent fixed | `relay.int.test.ts` F + A11, unit windows/rollover |
| **R4** stop/expiry only at claim | **Partially closed at `430dcfc`** (device timing, N4; retry contract, N5). Code fixed in this revision; re-review and device timing pending | `authorizeRelaySend` immediately before hand-off; conservative monotonic deadlines; final check after the durable write; attempt-aware de-dup | `relay.int.test.ts` G/N4/N5, `SendPipelineTest` (JVM), `RelayIntegrationTest` (Robolectric) |
| **R5** stale sender/routing | **Partially closed at `430dcfc`** (routing not re-checked at authorization, N3; unconditional cancellation, N6). Code fixed in this revision; re-review pending | Jobs carry `businessId` + `policyVersion`; claim/authorize compare with current policy and re-check device routing; conditional server sweep | `relay.int.test.ts` H/N3, `sweep.int.test.ts`, `wire.callable.test.ts` N6 |
| **R6** late worker downgrades `done` | **Fixed** | All op transitions conditional (`advanceOp`); release never undoes a terminal op; corrupted ops reconstructed from HMAC-matched sources | `phoneLink.int.test.ts` J (exact two-worker + crash ordering; **fails on PR #28 code, passes now**) |
| **R7** reauth always → number entry | **Fixed** | `stepForStatus` (pure) + reload after reauth; recovery wins even while sending is paused | `phoneAuth.test.ts` K (unit; no device UI run) |
| **R8** CI didn't run security suites | **Fixed** | `security-emulators` CI job: rules, integration, wire-level callable, JVM send pipeline; `relay-android` CI job: full relay APK build + unit + Robolectric integration | CI (runs on push) |

## 4b. Second-round findings N1–N7 (review of `430dcfc`)

Layers: **H** = handler on Firestore/Auth emulators; **W** = raw HTTP through the
Functions emulator with real Firestore triggers; **U** = pure unit; **J** = plain
JVM (Android-free pipeline with fakes); **R** = Robolectric (real Room + real
RelayApi code + production pipeline wiring over a fake callable transport). "Neg"
= the new tests were run against the reviewed `430dcfc` file and failed there.

| # | Finding | Fix | Regression (layer) · negative control |
|---|---|---|---|
| **N1** | Accepted ops could mint tokens after revocation | One `assertMintAllowed` gate before **every** `createCustomToken` (first completion, resume, lost-response replay): completion window measured from server acceptance (`acceptedAtMs`, default 10 min, fails closed if missing); Auth user not disabled; profile `active`; review ops bound to the review-access **generation** (hash of number, uid, salt, code hash, expiry) **and** demo uid, re-checked against the current config | `phoneAuth.int.test.ts` "A17 + N2" / "N1" (H), `secondRoundGuards.test.ts` (U). Neg: replay after disable/expiry/code+salt rotation/uid swap, demo designation removed, suspension after completion, interrupted op past the window — all failed on `430dcfc`. Controls (lost-response retry inside the window, done op past window, Auth-disabled) pass on both |
| **N2** | Review login had real-phone side effects | Review completion goes `review-ready → done` with **no** profile, `phoneVerified`, `userPrivate` phone or Auth phone write ⇒ `linkPhoneContactsOnUserWrite` never fires; target must be a designated demo account (custom claims exactly `{demoReview:true}`, enabled), enforced server-side at every mint and by `scripts/setReviewAccess.ts` (`--create-demo` or a designated `--uid`; refuses anything else) | H tests; **W**: review login over HTTP with an external group member on the review number — demo not promoted, no private phone; positive control in the same run: a genuine phone sign-in **is** promoted by the live trigger. Neg (W): on `430dcfc` the demo account **was promoted into the group** |
| **N3** | Routing not re-checked at authorization | `authorizeRelaySend` re-reads `countryRoutingEnabled` + allow-list (`deviceRoutingAllows`, shared with claim); refusal fails a verification job (`country-not-allowed`, body purged) or re-queues business SMS | `relay.int.test.ts` N3 (H), unit. Neg: switch-off and country-removed cases failed on `430dcfc`; control passes |
| **N4** | Device deadlines not conservative | Server: claim budget computed at response time, authorization budget computed **inside** the transaction and capped at 15 s and the code's remaining life. Device: claim budget starts at claim **request** start; authorization budget at its request start; deadline = min − 1.5 s; monotonic clock only; pause + deadline re-checked **after** the durable `sending` write | `SendPipelineTest` (J): t=0/8/9/12 sequence, claim latency, stale auth, wall-clock skew, network loss, refusal, pause during the durable write; `RelayIntegrationTest` (R): stale authorization; `relay.int.test.ts` N4 (H). Neg: the `430dcfc` `SendGate` returned *Send* for the t=0/8/9/12 sequence; N4 handler tests failed on `430dcfc` |
| **N5** | Local de-dup broke the business retry contract | Server returns `attempt` per lease; Room v2 stores it (real migration 1→2, no destructive fallback). Same attempt ⇒ never re-handed; a **new** attempt of a business SMS is sent unless this device may already have handed off the previous one (local `sending/sent/delivered`) ⇒ reported `ambiguous-handoff`, which the server classifies **permanent** (never re-queued). Verification codes are never sent twice | J + R (retry after pause before hand-off sent once as attempt 2; ambiguous never resent; migration keeps jobs + pending reports); `relay.int.test.ts` N5 (H). Neg: attempt test failed on `430dcfc` |
| **N6** | Dashboard bulk cancel was unconditional, capped | Client-side cancel removed. Server sweep (trigger on `smsConfig/otp` + reaper): paginated, per-job transaction re-reading job **and current policy**; only still-`queued` **and** now-invalid jobs are cancelled; bounded runs report incompleteness and resume. Dashboard bumps `policyVersion` in a transaction with the change | `sweep.int.test.ts` (H, 7 incl. races: claimed/sending/delivered between query and tx, policy reverted mid-sweep, 480+ jobs, bounded runs) + a control reproducing the reviewed algorithm overwriting a claimed and a new-generation job; **W**: policy write → trigger cancels the old-generation job only |
| **N7** | Late provider result could change a newer email challenge | Each send stores a `generation`; `settleSend` writes `pending`/`send-failed` only if the stored challenge still has that generation and is still `sending` | `emailOtp.int.test.ts` N7 (H, deferred provider promises, both orders × both outcomes). Neg: all 4 failed on `430dcfc` |


Third-review precision on §4b: **N3** covers verification SMS (final authorization
is only called when `requiresSendAuth`); **N4** device scheduling and the
physical hand-off remain release gates; **N5** was partial at `0e90b7a` (M1/M2);
the earlier N5 handler test used jobs with `batchId`/`recipientUid` null, so it
did **not** cover batch settlement — settlement is now covered by a real
batch + recipient fixture (§4c). The phone-link CI follow-up's injected
transaction-failure test covers the **no-commit** case only, not a committed
transaction whose response was lost.

## 4c. Third-review findings M1–M3 (review of `0e90b7a`)

Layers as in §4b; **R** now runs the production report path (`ReportStore`,
`flushReports` → `RelayApi.report`) on a file-backed Room v3 database that is
closed and reopened to simulate a process restart.

| # | Finding | Fix | Regression (layer) · negative control |
|---|---|---|---|
| **M1** | Reporting `ambiguous-handoff` erased the local no-resend evidence (the report's finalize turned the row into `failed`, so attempt 3 was sent) | Sticky `jobs.noResend` (Room v3). Written in the **same Room transaction** as the report (`ReportStore.record`), and the send loop **awaits** that write before continuing; nothing clears it (finalize, report retry, restart, newer attempts). Set for: an ambiguous refusal, a `sent`/`delivered` result, a partially sent multipart message (`ambiguous-partial-send`), and an exception from the send call (`ambiguous-send-exception`, conservative). Known pre-hand-off outcomes stay retryable: pause before hand-off, all parts rejected by the radio (`carrier-send-failed`). Server side: a late ambiguous/positive report for an older attempt sets `noRetry`, so neither a failure report nor the lease reaper creates another attempt | **R**: attempt 1 handed off → report held offline → two lease expiries → attempt 3 offered → client restart → still **one** hand-off; reports flush afterwards (stale one acknowledged, current one ends the job). Positive controls: pre-hand-off pause and all-parts-failed retry once; partial send does not. **J**: same sequence on the pipeline. **H**: late ambiguous report after the third lease → `noRetry` → no 4th attempt; reservations [3,3,3]. **Neg**: on `0e90b7a` the pipeline handed off attempt 3 (`[b:m1#1, b:m1#3]`); the H test failed there |
| **M2** | Attempt identity stopped at the local job: old reports/callbacks could change a newer attempt | **Device**: SMS PendingIntents carry the attempt (distinct identity per job/attempt/part via data URI); results aggregate per (job, attempt) (`SendResultAggregator`); reports are stored with `reports.attempt` and sent with it; local status updates are `WHERE jobId AND attempt`; the flush deletes a report only after a server answer and no longer stops at the first error (definitive refusals are dropped and logged). **Server**: `reportBinding` — a report applies only to the current attempt from the device holding it (`attemptDeviceId`, set at claim); older/other attempts are acknowledged with `notApplied: stale`; a duplicate failure of an attempt already re-queued is a no-op; a late success for an attempt whose lease lapsed settles the job instead of resending it; `sent` is never turned back by a later failure. Re-leases (attempt ≥ 2) only go to builds declaring `attempt-v1` | **H**: lost acknowledgment then re-lease to the **same** device → old report retried → attempt 2, counters and settlement unchanged; duplicate failure no-op; late success settles; late success for an older attempt while a newer one is in flight → `noRetry`; **different-device** re-lease; unbound reports; old build never re-leased; **real batch + recipient** fixture: retry then success settles the recipient and finalizes the batch once, a stale duplicate afterwards changes nothing. **R**: lost ack on the same device; delayed attempt-1 callback after the row became attempt 2 (row, body and multipart progress untouched); migrated pending reports flushed unbound. **U/J**: binding rules, aggregator. **Neg**: all 9 H tests failed on `0e90b7a` (old reports applied to the newer attempt; `not-lease-owner` for a lapsed attempt's success — the device would retry it forever; re-lease to an old build; a stale duplicate failure applied to a `sent` job after batch finalization); on `0e90b7a` a late attempt-1 callback rewrote attempt 2's local row to `failed` |
| **M3** | The final review/sign-in gate used the request-start configuration | `assertMintAllowed` re-reads the sign-in policy (purpose switch, review access) **at the gate**, evaluates the completion window and review expiry with a fresh clock, and compares the accepted review generation/demo uid against the current access; then Auth + profile, then the token. The SMS emergency stop still does not block completing an accepted sign-in (send-stop ≠ sign-in suspension). Decision point: these reads immediately precede `createCustomToken`; a change committed in the milliseconds after them is not seen, and already-issued tokens are not revoked | **H**: handler paused (test seam) after its initial config load and acceptance, before the final gate; review disabled / code rotated / demo uid changed / review expired / sign-in purpose suspended during the pause → **no token minted**; the gate in front of the token itself (second gate) too; a normal phone sign-in with the purpose suspended mid-request; positive controls: unchanged policy mints, immediate lost-response retry mints with no new SMS/account; emergency stop alone does not block. **Neg**: 7 of 7 revocation cases minted on `0e90b7a` (with only the no-op seam added) |

**Schema / report compatibility decisions (M2):**
* Relay Room **v3** (`MIGRATION_2_3`, non-destructive; 1→2→3 chain kept): adds
  `jobs.noResend` (rows in `sending`/`sent`/`delivered` are marked) and nullable
  `reports.attempt`. Pending reports from before the upgrade are **kept** and
  stay unbound (`attempt` NULL) — never guessed to belong to the current attempt.
* The server applies an **unbound** report only to a job that was never
  re-leased (`attempts ≤ 1`), where it is unambiguous; otherwise it acknowledges
  it as `notApplied: unbound` (audited) so the device can drain it.
* Re-leases go only to builds declaring `attempt-v1`; older builds still get
  first attempts (so their unbound reports always describe attempt 1).
* Jobs claimed before this revision have no `attemptDeviceId`; the lease owner
  is used instead (a re-queued legacy job has none ⇒ its reports are treated as
  stale/unbound, never applied).
* The flush drops a report only on a definitive refusal (not-found / wrong
  business or device / invalid); everything else is retried.

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
  are refused. A lost-response retry with the same session re-issues a token
  only inside the completion window measured from **server acceptance**
  (`signin.limits.tokenRetryWindowSec`, default 10 min) and only after the same
  mint gate as the first token (Auth not disabled, profile active, review
  generation unchanged).
* **Store review**: `smsConfig/otp.signin.review` (script-managed): one number →
  one **designated** demo account (custom claims exactly `{demoReview:true}`; no
  phone, email, admin/org/relay claims), salted-hash code, ≤30 days, revocable,
  no SMS, never creates or resolves accounts. A review login records **no phone**
  anywhere, so it never links contacts or joins groups. Any rotation or disable
  invalidates already-accepted review ops. Use a number the business controls.

### 6.2 Relay
* Accounting unit = one **claimed job attempt** (logical message, not billed
  segments). Never refunded; ambiguous outcomes count as sent.
* Verification jobs: `maxAttempts:1`, never requeued; lapsed leases fail.
* Business SMS retry contract: each lease has an `attempt`; a new attempt is
  sent unless this device may already have handed off the logical job (local
  `sending/sent/delivered` or the sticky `noResend`), which is reported as
  `ambiguous-handoff` (permanent; counted as sent). Reports and SMS callbacks
  are bound to the attempt end to end (§4c).
* Cross-device limit: if attempt N went out silently on device A (lease lapsed,
  no report yet) and attempt N+1 is leased to device B, B has no local evidence
  and may send it. The server stops any attempt after the late report arrives
  (`noRetry`), but cannot stop one already in flight. Exactly-once across
  devices is not claimed.
* Remaining unavoidable window: after the final post-write check and before
  `SmsManager.sendMultipartTextMessage` accepts the message (in-process, no I/O;
  the 4 s pacing is *after* send). It is bounded by the device deadline but not
  zero, and was **not measured on a device**. A message handed to the
  modem/carrier cannot be recalled; exactly-once carrier delivery across crashes
  is **not** claimed.
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
| Index | `firestore.indexes.json` | `relayJobs (kind, status, expiresAt)`; `relayJobs (kind, status, __name__)` for the paginated sweep |
| Trigger | `onOtpPolicyWritten` | runs the conditional sweep when sender/master/stop/purpose/`policyVersion` change |
| Review access | `scripts/setReviewAccess.ts` | `--create-demo` or `--uid=<designated demo>`; prints the code once to the operator terminal only |
| Migrations | relay Room 1→2→3 (adds `jobs.attempt`, `jobs.noResend`, `reports.attempt`; keeps rows and pending reports) | legacy `otp` jobs cancelled at claim/reaper/sweep; pre-existing `smsConfig/otp` resolves to OFF; ops accepted before this revision have no `acceptedAtMs` and therefore mint nothing (users sign in again) |
| Relay capabilities | claim `clientCaps` | `send-auth-v1` (verification jobs), `attempt-v1` (re-leases) |
| Native builds | mobile: new build with the v2 phone flow; relay: 0.2.0 (this revision's Room v3 / attempt-bound reports) | old mobile builds see no phone countries and get `app-update-required` |

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

Counts are from runs in this environment for this revision (exact numbers and
commands also in the PR description).

| Layer | Command | Result |
|---|---|---|
| Helper/unit | `npm test` | 695 / 695 (64 files) |
| Firestore rules (emulator) | `npm run test:rules` (with the Firestore emulator) | 143 / 143 (14 files) |
| Handler + Firestore/Auth emulators | `npm run test:integration` | 165 / 165 (7 files) |
| Wire-level HTTP + real triggers (Functions emulator) | `npm run test:callable` | 7 / 7 |
| Relay send pipeline (plain JVM, no Android SDK) | `gradle -p apps/mobile-relay/sendgate-jvm-test test` | 16 / 16 |
| Relay **Android app**: compile + package | `gradle -p apps/mobile-relay :app:assembleDebug` (placeholder `google-services.json` via `scripts/ci/relay-google-services.sh`) | BUILD SUCCESSFUL (debug APK) |
| Relay app unit + Robolectric integration | `gradle -p apps/mobile-relay :app:testDebugUnitTest` | 34 / 34 (`SendPipelineTest` 16, `RelayIntegrationTest` 13, `SendResultAggregatorTest` 5) |
| Typecheck / lint / i18n / build | `npm run typecheck|lint|build --workspaces`, mobile typecheck, `npm run i18n:check` | clean |

`RelayIntegrationTest` exercises the production send wiring (`relayPipeline`:
`RelayApiBackend` + `RoomLocalJobs` + `SendPipeline`) and the production report
path (`StoreReports` → `ReportStore`, `flushReports` → `RelayApi.report`) on a
real **file-backed** Room v3 database (closed and reopened for restarts), the
real `RelayApi` request/response code over a **fake callable transport** (that
binds reports to attempts, goes offline, or loses a committed response), a fake
SMS transport, SMS callbacks through `SendResultAggregator` + `ReportStore` (the
receiver minus its broadcast glue), and the Room 1→3 / 2→3 migrations on legacy
files. Not exercised: `SmsResultReceiver`'s Android broadcast glue, WorkManager
scheduling of `SyncReportsWorker` (its loop is `flushReports`), and
`isPermanentRefusal`'s Firebase exception mapping. The JSON fixtures it parses are checked against the real
`claimRelayJobs` / `authorizeRelaySend` responses in `relay.int.test.ts`
(contract tests).

**Not run / not proved:** the APK on a device; `SmsManager`, the modem and
carriers; the `RelayService` foreground/FCM/Firebase sign-in lifecycle; the Room
migration on a real device; device timing (Doze, background delays); UI/RTL on
devices; PoW timing on low-end phones (Hermes); Firebase ID-token **signature**
checking (the Auth emulator doesn't sign tokens); App Check (the emulator does
not enforce it); the production `X-Forwarded-For` chain (`sourceHopsFromRight`
must be verified against the real ingress before relying on source budgets);
production Firestore contention; any production data or logs (none inspected).

CI at `526c96a`: the general job and the new `relay-android` job passed; the
security-emulators job failed in both runs on two **pre-existing phone-link
concurrency tests** (not N1–N7 tests). One was a test race: the R6 two-worker
test assumed worker A always reached the Auth step first and deadlocked when B
did (reproduced locally 1/5 on 2 cores; fixed to be order-independent, 0/8
after). The other was a product gap: when the verify transaction failed for an
infrastructure reason (the emulator's `INVALID_ARGUMENT: Transaction is invalid
or closed` under contention; in production, exhausted contention retries or a
lost commit response), the raw error reached the caller as `INTERNAL`. It is now
reported as the retryable `link-interrupted` (resume completes a committed link,
or finds nothing and the code stays usable). Regression injects that exact error
and **fails on the `526c96a` handler**.

Negative controls: M1–M3 as listed in §4c; N1–N7 as listed in §4b; R6 tests fail on the PR #28 file and
pass now; the rules tests fail on the base rules for the profile-create gap; the
original abuse was reproduced on the base commit (25/25 anonymous SMS queued; 14
SMS from 20 parallel requests to one number; fixed credential minted an account).

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
* `relayDevices` is server-managed against ordinary clients and relay
  heartbeats only: a client holding the **platform-admin** claim can still write
  any field (incl. `usage`, `caps`, routing) through Firestore rules. Making it
  server-only is a follow-up.
* `requestEmailOtp` stays unauthenticated by design; keeps a conservative
  reservation when the provider fails (user waits for the cooldown).
* Phone-link side effect (pre-existing): a genuine phone link / sign-in sets the
  private phone, which runs `linkPhoneContactsOnUserWrite` and can **add the user
  to groups where that number was an external member**. (Store-review logins no
  longer do — N2.)
* The stale-code sweep is bounded per run and starts from the first queued job
  of each kind every time (the cursor lives only inside one run). It progresses
  as cancelled rows leave the queue, but a long prefix of still-valid queued
  codes is re-scanned on every run; forward progress past such a prefix is not
  guaranteed within one bounded run. Delivery never depends on it (claim and
  final authorization re-check every job). A persisted continuation is a
  follow-up.
* Relay report compatibility: unbound pre-upgrade reports for a re-leased job
  are acknowledged but not applied (§4c); a business job whose earlier attempt
  went out unreported can still be duplicated by a different device (§6.2).
* Release gates before enabling verification SMS: independent re-review of this
  revision; relay 0.2.0+ on every relay phone and a supervised device run
  (timing, pause, Room migration); verified ingress `X-Forwarded-For` hop count;
  thresholds from real traffic; a decision on native App Check (PoW is a cost
  layer, not a human check).
* SMS text is English only.
