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
| Fourth review head (findings Q1–Q2) | `538e67202c2123d2682e0b3dc9be7f21a3735701` |
| Fifth review head (Q1–Q2 closed; E1 wording) | `c4349b27d52f92ff8dc8943fa614c6dbbc51d76b` — CI [run 37780903956](https://github.com/raedrasheed/offlinesms-2027/actions/runs/37780903956) green (its synthetic merge tree equals this head's tree) |
| This revision | see the PR description (documentation/evidence wording + test names only on top of `c4349b2`) |

**Current review status (fifth independent review, of `c4349b2`):** Q1 and Q2
are **closed** for the reported code defects; no new blocking product defect
was found in that focused review. Accepted as reviewed: N2, N3, N4, N6, N7, M3,
the M1/M2 sequences and Q1/Q2. This revision only corrects evidence wording
(E1) and records the plan for the remaining gates (§12). This is code-review
acceptance, **not** approval to merge, deploy, enable production SMS or
certify the application: the real-device and deployment gates (§11, §12)
remain open, and R4/R5 stay **partial** where they depend on them.
Production verification SMS stays disabled.

**Environment decision (2026-10-08):** the product owner explicitly authorized
using the existing production environment for validation. Section 12.2 records
the production procedure and supersedes the separate-project requirement for
that mode. Authorization is recorded; no production inspection, deployment,
configuration change or test execution is claimed by this documentation update.

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
| `reportRelayDelivery` | bound to ONE attempt (M2): applied only to the job's current attempt from the device holding it; stale/duplicate/unbound reports are acknowledged and never applied to a newer attempt; only a report from the server-recorded holder of an earlier attempt (`attemptOwners`, Q1) that the message may already have gone out stops further attempts (`noRetry`) or settles a job waiting between attempts — future/never-issued attempts and unrecorded holders have no effect; verification never requeues; metrics only (not capacity) |
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
| **R4** stop/expiry only at claim | **Partial.** Code-level fixes accepted by independent review (N4 at `0e90b7a`; the N5 retry contract via M1/M2 and Q2 at `c4349b2`). Still open: device timing, the physical hand-off and real callback ordering (§12 G2–G3) | `authorizeRelaySend` immediately before hand-off; conservative monotonic deadlines; final check after the durable write; attempt-aware de-dup | `relay.int.test.ts` G/N4/N5, `SendPipelineTest` (JVM), `RelayIntegrationTest` (Robolectric) |
| **R5** stale sender/routing | **Partial.** Code-level fixes accepted by independent review (N3 for verification SMS, N6 at `0e90b7a`). Still open: the deployed policy/routing configuration and relay fleet versions (§12 G1, G9) | Jobs carry `businessId` + `policyVersion`; claim/authorize compare with current policy and re-check device routing; conditional server sweep | `relay.int.test.ts` H/N3, `sweep.int.test.ts`, `wire.callable.test.ts` N6 |
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


## 4d. Fourth-review findings Q1–Q2 (review of `538e672`)

Evidence layers: **U** pure helper; **H** emulator handler; **R** Robolectric
with the real Room database and the production `ReportStore`/admission code;
**SQL model** was the reviewer's own probe (not repeated here); no **device**
evidence. "Neg" = the test was run against the `538e672` code and failed there.

| # | Finding | Fix | Regression (layer) · negative control |
|---|---|---|---|
| **Q1** | `stale` was not proof of a legitimate earlier attempt: a future/never-issued attempt, or an earlier attempt from a device that never held it, could settle a queued job or set `noRetry` | Claim records an immutable, server-issued `attemptOwners[n] = deviceId` for every lease. `reportBinding` now distinguishes: **current** (current attempt, proven holder); **stale** (earlier attempt, reporter is its RECORDED holder) — the only category with late-reconciliation authority; **unverified** (attempt > current, incl. never-leased jobs, or an earlier attempt whose holder is not on record) — acknowledged, no effect; **unbound** (no attempt identity on a re-leased job) — acknowledged, no effect; **foreign** (an attempt recorded as held by another device) — refused. Legacy jobs leased before `attemptOwners` existed only know their current attempt's holder, so their earlier-attempt reports are `unverified`: legacy late-report reconciliation is deliberately given up | **H**: never-leased job + attempt 99 sent/delivered/ambiguous → nothing changes and it is still claimable; another device's in-flight job + future attempt from any device → nothing changes; a real earlier attempt reported by a device that never held it, in flight and between attempts → refused, nothing changes; legacy history → no effect; cross-business → refused; a **real batch + recipient** with forged evidence → recipient, batch finalization and all device counters unchanged, then the genuine holder settles it. Positive controls: the recorded holder's late ambiguity settles a job between attempts; its late success while a newer attempt is in flight sets `noRetry`. **U**: binding table. **Neg**: 5 of 5 forged/legacy cases failed on `538e672` (the attempt-99 report was **applied** to a never-leased job); the 2 controls pass on both |
| **Q2** | `get` → `dedup` → `put` (REPLACE) were separate steps; a no-resend mark committed in between was overwritten with `noResend=false` | Admission is **one Room transaction** (`RoomLocalJobs.admit`): fresh read → `dedup` → write. The REPLACE upsert is **removed**: a new job is an insert, a newer attempt takes the row over with `UPDATE … WHERE attempt < :new AND noResend = 0`, which never writes `noResend` (0 rows ⇒ refused as ambiguous). The durable `sending` write is conditional too (`… AND noResend = 0`) and is the **local sending decision**: a mark written after admission but before it refuses the hand-off. A mark written after it is kept and refuses every later attempt, but does **not** stop the attempt already in flight — that attempt may still proceed through the final pause/deadline check to `transport.send` (the decision is committed; the physical hand-off has not necessarily happened yet) | **R**: a production `ReportStore.record` written as a **nested write inside the admission transaction**, between its read and its conditional takeover (seam on the production path; it joins the transaction rather than committing independently) → takeover refused, mark kept, attempt never reaches the fake transport; database closed/reopened and a further attempt offered → still refused. This shows the conditional write preserves/rejects the intervening state; it does not demonstrate an independent concurrent transaction committing inside an active admission (Room's lock makes such a writer wait — covered by the orderings below). Report after admission, before the `sending` decision → hand-off refused; report after the `sending` decision but before `transport.send` → that in-flight attempt still reaches the fake transport, the guard stays true and refuses every later attempt after reopen. Positive control: no late report → the retryable attempt is sent once. Pre-hand-off pause and definitive carrier failure controls unchanged. **Neg**: on `538e672` (no admission transaction there) the same seam's write committed independently between `get` and the REPLACE `put`, and the REPLACE erased it ("noResend erased") |

Note on the Q2 seam: with admission in one transaction, a writer on another
coroutine waits for the transaction's lock and commits after it (the
before/after-sending-decision tests). The only way any write can land between
the read and the takeover is as a nested write on the transaction's own
coroutine, which the seam does; the conditional takeover is what refuses it.

Fifth review (of `c4349b2`): **Q1 and Q2 closed** for the reported defects. E1
(this wording) corrected afterwards: the sending decision is distinguished from
the physical hand-off, and the between-read-and-write test is described as a
nested write.

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

## 8. Deployment, observability, rollback

The stopped subset approved in §12.3 was deployed on 2026-10-08 (§12.4).
The sequence below remains the general release procedure; mobile/relay rollout
and admission-enabled verification SMS are not complete or enabled.

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
| Helper/unit | `npm test` | 697 / 697 (64 files) |
| Firestore rules (emulator) | `npm run test:rules` (with the Firestore emulator) | 143 / 143 (14 files) |
| Handler + Firestore/Auth emulators | `npm run test:integration` | 172 / 172 (7 files) |
| Wire-level HTTP + real triggers (Functions emulator) | `npm run test:callable` | 17 / 17 at `d3cafc76` ([CI 37829267841](https://github.com/raedrasheed/offlinesms-2027/actions/runs/37829267841)); includes the G7 rehearsal in §12.3 |
| Relay send pipeline (plain JVM, no Android SDK) | `gradle -p apps/mobile-relay/sendgate-jvm-test test` | 16 / 16 |
| Relay **Android app**: compile + package | `gradle -p apps/mobile-relay :app:assembleDebug` (placeholder `google-services.json` via `scripts/ci/relay-google-services.sh`) | BUILD SUCCESSFUL (debug APK) |
| Relay app unit + Robolectric integration | `gradle -p apps/mobile-relay :app:testDebugUnitTest` | 38 / 38 (`SendPipelineTest` 16, `RelayIntegrationTest` 17, `SendResultAggregatorTest` 5) |
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
production Firestore contention; production request logs. Read-only production
configuration, queue/counter totals and a remediation dry-run were subsequently
inspected on 2026-10-08 (§12.3); those observations do not prove these runtime gates.

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

Negative controls: Q1–Q2 as listed in §4d; M1–M3 as listed in §4c; N1–N7 as listed in §4b; R6 tests fail on the PR #28 file and
pass now; the rules tests fail on the base rules for the profile-create gap; the
original abuse was reproduced on the base commit (25/25 anonymous SMS queued; 14
SMS from 20 parallel requests to one number; fixed credential minted an account).

### Production remediation (dry-run executed; apply NOT executed)
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
  are acknowledged but not applied (§4c); late reports for an EARLIER attempt of
  a job leased before `attemptOwners` existed are acknowledged with no effect
  (§4d) — legacy late reconciliation is given up rather than trusted; a business job whose earlier attempt
  went out unreported can still be duplicated by a different device (§6.2).
* Release gates before enabling verification SMS (execution plan: §12): independent re-review of this
  revision; relay 0.2.0+ on every relay phone and a supervised device run
  (timing, pause, Room migration); verified ingress `X-Forwarded-For` hop count;
  thresholds from real traffic; a decision on native App Check (PoW is a cost
  layer, not a human check).
* SMS text is English only.

## 12. Remaining validation gates — execution plan and recorded results

The table below is the original gate plan. The G7 emulator rehearsal and the
production read-only preflight/remediation dry-run have run (§12.3). The approved
stopped deployment and seven production smoke checks are complete (§12.4).
The independent production switch matrix, live budget/token validation and
device gates remain open. Roles, not people, are named; the product owner assigns them.
"Fake/emulator" steps can run in CI or locally; "device" steps need an installed
build; "authorized" steps need separately approved access to a non-production
or production Firebase project, real SIMs or production data. The production
access/test-environment authorization was subsequently given on 2026-10-08;
use §12.2 for that mode. The table and §12.1 describe the original isolated-project
procedure. Real SMS/device evidence and general rollout remain separate gates.

| Gate | Environment | Operator (role) | Steps | Expected observations | Evidence to retain | Needs |
|---|---|---|---|---|---|---|
| **G1** Relay app upgrade + Room migration on device | Two Android test phones (API 26 and API 34), relay 0.1.x installed, a **non-production** Firebase project | Relay app engineer | Enrol with 0.1.x; create local rows and pending reports while offline; upgrade to this build; reopen; reconnect | No crash; rows kept; `attempt`=0, `noResend` set on `sending/sent/delivered` rows; pending reports flushed unbound and acknowledged | `adb logcat` excerpt; exported `jobs`/`reports` tables **with bodies removed**; app versions | Device + non-production project. (Migration logic already covered by Robolectric — fake) |
| **G2** `SmsManager` / modem / multipart callbacks | Same phones with test SIMs; destinations = **business-controlled test numbers only** | Relay app engineer + business owner of the numbers | Business SMS: single part, multipart (≥3 parts), radio off mid-send, airplane mode, invalid destination | One callback outcome per (job, attempt); partial multipart → `ambiguous-partial-send`, never resent; all-parts-failed → one retry as the next attempt; reports bound to attempts | Server `relayJobs` timeline (masked numbers, no bodies), audit rows, device logs | Device + **explicit authorization for real SMS to controlled numbers** (not authorized so far) |
| **G3** Lifecycle, timing, restart | Phones from G2; network shaping (e.g. a throttling proxy) | Relay app engineer | Kill the app between `sending` and the callback; reboot; Doze/background; FCM wake vs poll overlap; delay claim/authorization responses near code expiry | No second hand-off of any attempt; verification codes refused on device once the deadline passes; lease expiry → ambiguous → no resend | Monotonic timestamps from device logs; server job timelines | Device (sequences already covered with fakes in `SendPipelineTest` / `RelayIntegrationTest`) |
| **G4** Proof-of-work speed on phones | Low-end Android (2–3 GB RAM), mid-range Android, oldest supported iPhone; release build of the mobile app | Mobile engineer | Time `solvePow` at 14/16/18 bits, 30 runs each, cold and warm | p50/p95 per device; pick `powBits` so p95 stays acceptable (threshold set by product) | Raw timings per device/model/OS | Devices (Node timing is not representative) |
| **G5** Ingress `X-Forwarded-For` trust | Non-production project with the **same** Cloud Functions v2 front end as production | Backend engineer | Call `startPhoneAuth` from 2–3 known client IPs, directly and via a proxy that sets its own XFF; log the header chain (test project only) | The real client IP sits at a fixed position from the right; `sourceHopsFromRight` set to it; spoofed left-side values ignored | Redacted header chains and the derived source bucket | Authorized non-production project; production confirmation needs authorized log access |
| **G6** Native App Check | Product/security decision; then a mobile build with `@react-native-firebase/app-check` (Play Integrity / App Attest) | Product owner + mobile engineer | Decide; implement; test with the debug provider in non-production; then `signin.attestation: 'required'` there | Requests without a valid token refused; legitimate builds pass | Decision record; non-production enforcement test log | Native build + non-production project |
| **G7a** Disabled-policy rejection | Emulators first, then the isolated non-production project of G7b | Backend engineer | With each switch off in turn — env `PHONE_AUTH_ENABLED` unset, master `enabled:false`, `emergencyStop:true`, `businessId` cleared, `signin.enabled:false` — call `startPhoneAuth` and `requestPhoneAuthCode` | Refused before any budget work: `phone-auth-unavailable` (env, master, `signin.enabled`) or `service-paused` (stop, no sender); **zero** new documents in `smsRateLimits`, `phoneAuthSessions`, `phoneAuthChallenges`, `relayJobs` | Refusal codes per switch; before/after document counts of those collections | Emulators (already covered by handler tests, M block); the project run needs authorization. **Not** evidence that budgets hold (see G7b) |
| **G7b** Budgets under parallel load, physical SMS impossible | Emulators (dry run), then an **isolated non-production project** with sending policy **ON** (see §12.1) | Backend engineer; product owner approves the low limits | §12.1 | Every refusal during the run is a **budget** refusal (`scope` set); accepted requests never exceed any configured budget; `relayJobs` only ever `queued`, never claimed | Counter documents before/after, refusal log tally, job tally (§12.1) | Fake/emulator for the dry run; **authorized non-production project + a deploy of this branch there** for the real run |
| **G7c** Real ID-token verification and configuration | Same non-production project, real Auth (signed tokens) | Backend engineer | Expired, forged, other-project and unsigned tokens against authenticated callables (`requestPhoneLinkOtp`, `getPhoneLinkStatus`, relay callables with/without the relay claim); confirm `PHONE_HASH_PEPPER` is set and env flags as intended | Invalid tokens refused by the framework before any handler work; relay callables refuse non-relay tokens | Request/response summaries; deployed config listing (secret **names** only) | Authorized non-production project (the Auth emulator does not check signatures) |
| **G8** Platform-admin `relayDevices` write boundary | Rules emulator | Backend engineer + product owner | Decide whether admin clients may write `usage`/`caps`/routing; if not, server-only rules plus rules tests | Admin client writes to those fields refused; dashboard still works through callables | Rules diff + emulator test output | Fake/emulator only |
| **G9** Pre-rollout production read-only checks | Production, **read-only** | Operator with authorized production read access | `remediatePhoneOtpAbuse.ts` dry-run (counts only); read `smsConfig/otp`; list relay `appVersion`s from heartbeats; confirm Firebase Phone provider disabled | Counts only (no PII); suspension still in place; every relay on 0.2.0+ before any enable | Dry-run output; screenshots of settings | **Separately authorized production access** |
| **G10** Rollout | Production | Product owner (decision) + backend/relay engineers | §8 order; start with tight limits; watch §8 signals; emergency stop ready | Only after G1–G9 sign-off | Change record, dashboards | **Explicit rollout authorization** (not given) |

### 12.1 G7b procedure — reach the budget transaction, make SMS impossible

`requestPhoneAuthCode` only reaches its budget transaction after, in order:
the sending policy (`requireSigninConfig(…, 'send')`: env + master on +
`emergencyStop:false` + a sender `businessId` + `signin.enabled`), optional App
Check, a valid supported number, and **live relay coverage** for the number's
country (an `active` relay device of that business with a heartbeat younger than
90 s, country routing on, the country in its allow-list). The transaction then
checks session → idempotent replay → single-use proof-of-work → session /
installation / source / destination / global / shared budgets, and only then
writes counters, the challenge and one `queued` relay job. A run that is
refused earlier (policy, `no-relay-for-country`, invalid proof) never touches the
counters and proves nothing about budgets.

**Setup (isolated non-production project, never production):**
1. A dedicated Firebase project with this branch deployed (deploy separately
   authorized), its own `PHONE_HASH_PEPPER`, `PHONE_AUTH_ENABLED=true`; no relay
   app build is ever configured for this project.
2. `smsConfig/otp`: `enabled:true`, `emergencyStop:false`,
   `businessId:"g7-test-business"` (a business used for nothing else),
   `signin.enabled:true`, `signin.attestation:'off'` (or App Check debug
   tokens), and deliberately **low limits within the clamped bounds** so each
   budget trips within a few dozen requests — e.g. `destinationPerHour:2`,
   `destinationCooldownSec:30`, `sessionMaxCodes:2`, `sourcePerHour:6`,
   `globalPerHour:20`, `powBits:8`, `powMaxBits:8` (low proof cost keeps the
   load generator simple; proof-of-work speed is G4, not G7).
3. Relay coverage with a **synthetic** device written by the Admin SDK:
   `relayDevices/g7-synthetic` = `{businessId:"g7-test-business", status:"active",
   countryRoutingEnabled:true, allowedCountryCodes:["PS"], fcmToken:null,
   caps:{maxPerMinute:0, maxPerHour:0, maxPerDay:0}}`. The harness refreshes
   `lastHeartbeatAt` (and `status:"active"`) every 30 s, because the reaper marks
   a device offline after 90 s without a heartbeat.

**Claim-blocking controls** (check both before, during and after the run):
- No relay identity exists for that business: no custom token is ever minted for
  `g7-synthetic`, and no Auth user carries a `relayDevice` claim in the project —
  `claimRelayJobs` requires one, so nothing can claim.
- `caps` 0/0/0: relay coverage ignores capacity, but every claim is refused by
  the capacity check (`count >= 0`), even for a hypothetical valid device token.

**Additional precautions and cleanup** (not independent send blockers):
- `fcmToken:null`: prevents a push wake-up; it does not prevent polling.
- Destination numbers are only numbers the business controls (valid PS mobile
  numbers, required by the number check), so even a misconfiguration could only
  reach the business itself.
- Teardown: set `emergencyStop:true` → the policy trigger's sweep cancels every
  queued code and purges its body; then delete the synthetic device.

**Run:**
1. Dry run against the Functions + Firestore + Auth emulators with the same
   harness and limits (validates the harness and the expected counter math; no
   SMS path exists there; not evidence of real contention).
2. Real run from 2–3 load runners with distinct egress IPs (source budgets need
   the `sourceHopsFromRight` value from G5): many sessions (`startPhoneAuth`),
   each solving the proof and calling `requestPhoneAuthCode` in parallel bursts —
   the same destination from many sessions (destination budget/cooldown), many
   destinations from one source (source distinct/hour), one session past its code
   limit (session), and enough total to exceed `globalPerHour`.

**Validity checks and expected observations:**
- Policy, `no-relay-for-country` and `proof-invalid` refusals during the run =
  **0** (otherwise the run did not reach the budget path and is void).
- Every other refusal carries a budget `scope` (`session`, `installation`,
  `source`, `destination`, `global`, `shared`) in the response and in the
  `[phoneAuth] request refused {reason, scope}` log.
- accepted responses = new `relayJobs` `pauth_*` = increase of
  `smsRateLimits/global_phoneAuth` window count = increase of
  `smsRateLimits/global_verification`; no destination's counter exceeds
  `destinationPerHour`; no source above `sourcePerHour`; global ≤ `globalPerHour`.
- Every `pauth_*` job stays `queued` (never `claimed`/`sending`/`sent`/`delivered`);
  `relayDevices/g7-synthetic.usage` absent/unchanged; zero `claimRelayJobs` calls
  in the logs; after teardown every such job is `failed` with `lastError: sending-stopped`
  and no `messageBody`.

**Evidence to retain** (no phone numbers, codes or bodies — counter keys are
HMACs): exports of the `smsRateLimits` documents and `phoneAuthSessions` counts
before/after; the tally of refusals by `(reason, scope)` from logs; the job tally
by status before and after teardown; the synthetic device document; the
`smsConfig/otp` document used; harness version and runner IPs (redacted to /24).


### 12.2 Existing production environment — authorized validation mode (bounded live validation recorded)

On 2026-10-08 the product owner confirmed that the existing environment is
production and explicitly permitted using it for these tests. The repository's
`.firebaserc` identifies `offlinesms-prod-2027`; confirm that identifier against
the authenticated project before any operation. No new Firebase project is
required for this mode. This is permission to perform controlled validation,
not evidence that a gate has passed or a request to send real SMS to users.

This procedure replaces the isolated-project assumptions in G5, G7a–G7c and
G9 when those checks use production. It does not authorize weakening production
App Check, deleting production records or deploying unrelated changes. It
does not turn the native-device gates into server tests.

1. **Read-only preflight.** Use authenticated Firebase/Google Cloud access to
   inspect the deployed revision, configuration, required indexes and triggers,
   effective budget limits, relevant counter window timestamps/counts, active
   relay routing, and verification queue counts by state. Confirm the built-in
   Firebase Phone provider remains disabled. Verify the existing
   `PHONE_HASH_PEPPER` is present; do not rotate it or export its value.
   Retain a restricted snapshot of the configuration fields that will change.
   Check the branch-to-deployment gap before any deployment; never assume the
   reviewed GitHub commit is already live. A required test deployment must have
   an explicit, reviewed manifest of affected functions/rules/indexes and use
   the stopped configuration in §8 before admission is temporarily enabled.

2. **Prepare the run.** Complete the emulator rehearsal first. Record the exact
   harness version, controlled destination numbers (kept out of published
   evidence), runner addresses, expected counter paths, and test-document IDs.
   Use a bounded maintenance window: the sender, switches and global/shared
   counters affect the whole project, so a test business alone is not full
   isolation. Initial live ceiling: 60 session-start calls plus 60 code-request
   calls, including retries, at most four concurrent requests, and at most
   ten minutes total. These are stop limits, not a throughput benchmark.
   Measure only the scopes actually reached; leave other scopes open.
   Do not use the low proof difficulty or App Check-off/debug configuration
   from §12.1 on publicly accessible production endpoints. Use the effective
   production proof and attestation requirements with legitimate test clients.

3. **G7a and routing safety.** Create a unique test-only business identifier and
   synthetic device with the routing, heartbeat and zero-capacity settings from
   §12.1. No real relay, pairing credential or relay Auth identity may belong to
   this business; production identities for other businesses may remain.
   Check this before every admission-enabled phase and abort if it changes.
   Keep physical relay sending unavailable for this test business.
   With only that synthetic sender selected, run the disabled-policy matrix
   separately; measure zero new test sessions/challenges/jobs and no budget
   increments attributable to its requests. Temporary env changes require the
   deployment manifest above. Exclude uncontrolled traffic from measurements;
   if it cannot be distinguished or stopped for the window, stop the run and
   do not claim clean G7 evidence.

4. **G5, then G7b.** Verify the actual ingress source derivation before relying
   on source-bucket results. Temporarily enable admission only with the test
   sender and the two checked claim blockers in place; keep phone linking
   disabled. Use limits derived from the current counter baselines and within
   the code's bounds. Never reset or delete shared production counters to make
   a test pass. Account for window rollover, or use a fresh natural window.
   Exercise each scope in a separate phase so an earlier limit cannot mask the
   intended one. Source/global/shared scopes that cannot be reached within the
   bounded run remain open. Monitor policy/config drift, unexpected requests,
   relay claims, errors and service health; stop immediately on any unexpected
   claim or loss of either claim blocker. A normal refusal during a phase must
   be attributable to its expected budget, not policy, coverage or bad proof.

5. **Interpret evidence against the implementation.** Count unique newly
   accepted requests separately from idempotent replays. Reconcile those
   acceptances with newly created test jobs and window-aware increases in the
   global/shared counters. The current shared-budget check reports
   `scope: 'global'`; distinguish it from the sign-in global budget using
   phase configuration and counter evidence, not an invented `shared` label.
   Jobs must never be claimed/sending/sent/delivered. Earlier jobs in a session
   may be cancelled as `superseded`, and the reaper may cancel expired jobs;
   do not require every job to remain queued throughout a multi-code run.
   Keep explicit tallies of those terminal reasons. These evidence
   interpretations also apply to the isolated-project procedure in §12.1.

6. **G7c and G9.** Use controlled test identities to check signed-token refusal
   cases against the actual deployed authenticated callables, with sending
   stopped. Do not enrol a relay identity for the synthetic business.
   Run the remediation script in counts-only dry-run mode, inspect configuration
   and relay versions, and record only redacted evidence. Never treat these
   checks as permission to apply remediation or to send messages.

7. **Stop and restore.** On completion, timeout or interruption, stop the
   runners, set `emergencyStop:true` and disable sign-in admission. Preserve
   verification suspension. Wait for all test jobs to be terminal and their
   message bodies removed; record actual cancellation reasons, including
   `sending-stopped`, `expired`, `superseded` or `policy-changed`.
   Compare the current config with the test manifest before restoring touched
   sender/limit fields, preserving unrelated concurrent edits. Never lower
   `policyVersion`, restore old queued codes, or redeploy an older vulnerable
   functions revision. Remove only manifest-listed test documents after
   evidence capture and ownership checks; retain shared counters and real
   user records. Remove the synthetic device after its jobs are safe.
   Verify the stopped state and record any unresolved cleanup explicitly.

**Execution status:** the emulator rehearsal, authenticated production preflight
and remediation dry-run are complete (§12.3). The owner subsequently approved
the concrete stopped-deployment scope, which was executed and verified (§12.4).
The policy, provider, secret, rules, indexes and selected functions changed as
recorded there. The owner then supplied one controlled destination and the
bounded production checks in §12.5 were executed. G7a passed; G7b has evidence
for the explicitly listed scopes, with the remaining scopes and gates still
open. Test-only cleanup is complete; production remediation was not applied.
Production is stopped again. Environment access and the documented validation
scope are already authorized; do not request those permissions again.


### 12.3 Evidence and proposed stopped deployment — 2026-10-08

**Emulator evidence.** Runtime/test source: `d3cafc76dae98469ce49d905450380147d53ac97`.
[CI run 37829267841](https://github.com/raedrasheed/offlinesms-2027/actions/runs/37829267841)
passed all three jobs, including 143 rules tests, 172 handler integration tests
and 17 HTTP callable tests. Ten added HTTP cases cover four disabled-policy
settings, five parallel budget phases and a session cooldown/exhaustion case.
The environment-off case remains covered separately by the handler tests.

The budget phases produced 14 unique accepted requests/jobs, 29 budget
refusals and five successful idempotent replays with no extra jobs/counters.
Global/shared counter changes reconciled with unique jobs; no job was claimed.
Teardown cancelled all 14 jobs as `sending-stopped` and removed their bodies.
The HTTP harness requires the exact local emulator project/hosts; it cannot
be repointed at production. This closes the rehearsal, not live G7.

**Production observations.** Authenticated reads of
`offlinesms-prod-2027`, captured around 19:28–19:31 UTC. Queries are successive
observations, not one atomic database snapshot.

| Item | Observed result |
|---|---|
| Functions | 76 deployed functions. All nine additions listed below are absent. The Firebase source hash on the inspected legacy/relay functions is `2656c210f299f6c8dce4bc267b587f40b438e97b`; this is **not** a verified Git SHA. |
| Firebase built-in Phone provider | **Enabled.** The prior assumption that it was disabled is false for this snapshot. No setting was changed. |
| `smsConfig/otp` | Sender and Android hash are present; master/stop/version/signin/link fields are absent. This would resolve to disabled/stopped **under the new branch code**; it does not establish how the deployed legacy code behaves. |
| Protected-flow state | Zero documents in `phoneAuthSessions`, `phoneAuthChallenges`, `phoneLinkChallenges` and `smsRateLimits`. All three named global/shared counter documents are absent. |
| All relay jobs | 366 total: 334 delivered, 21 sent, 11 failed; zero queued/claimed/sending/expired. |
| Relay devices | Two, both reporting 0.1.0: one revoked, one paused; neither heartbeat is fresh. No device upgrade was performed. |
| Country discovery | One read-only call to deployed `getSupportedPhoneCountries` returned HTTP 200 and an empty country list. This is not a budget test. |
| Rules | Deployed release updated 2026-06-26; differs from branch rules after normalizing line endings. |
| Required sweep indexes | Neither `relayJobs(kind,status,expiresAt)` nor `relayJobs(kind,status,__name__)` appears in the complete composite-index listing. |
| Pepper prerequisite | Secret Manager returned HTTP 403 / `SERVICE_DISABLED`. Secret existence/value could not be verified; no secret was read, created or rotated. |

**Remediation dry-run.** Executed the unchanged exported
`runRemediation` logic from `scripts/remediatePhoneOtpAbuse.ts` at the source
revision above, using a read-only REST adapter for the authorized Firebase CLI
session. The adapter exposes only the reads needed by this routine and supplies
no write/batch interface; `apply:false`, `redactAudit:false`, all-time range.
This is the exported routine, not the service-account CLI entry point.

Results: 83 `otpChallenges`; 303 legacy OTP jobs (278 delivered, 17 sent,
8 failed), zero with message bodies, zero possibly in flight on a device;
456 OTP audit rows whose target is still a raw phone number; 71 phone-only
Auth users across all time. All applied-change counts and forensic-export counts
are zero. These counts do not identify abuse-created accounts. Published evidence
contains no phone numbers, codes, message bodies, emails, UIDs or credentials.
G9 remains open because its required provider/relay-version state is not met.

**Concrete stopped-deployment scope — approved and executed on 2026-10-08.**
The following scope was prepared first, explicitly approved by the owner, then
executed with the results in §12.4.
Pinned application source is `d3cafc76`; this is a partial deployment to prepare
controlled validation, not deployment of every change in PR #28.

| Surface | Exact proposed scope |
|---|---|
| Google/Firebase configuration | Enable Secret Manager API; inspect secret metadata, reuse `PHONE_HASH_PEPPER` if present or create it only if confirmed absent, with access for the selected runtime identity. Disable Firebase's built-in Phone provider. Disabling this provider affects clients that currently use Firebase phone authentication and is an explicit decision, not a read-only test. |
| Firestore policy | Preserve sender/hash and unrelated fields; set master/signin/link disabled and `emergencyStop:true`; monotonically advance `policyVersion`. Keep both purpose environment flags unset and preserve current App Check settings. |
| Firestore rules | The complete branch `firestore.rules`: protect phone/email profile creation and private-profile owner writes; deny client writes to relay jobs, SMS policy and OTP state, including admin clients; add protected-flow server-only collections. |
| Firestore indexes | Add only the two missing relay sweep indexes above; retain all existing indexes and wait for READY. |
| Nine new functions, us-central1 | `startPhoneAuth`, `requestPhoneAuthCode`, `verifyPhoneAuthCode`, `requestPhoneLinkOtp`, `verifyPhoneLinkOtp`, `resumePhoneLink`, `getPhoneLinkStatus`, `authorizeRelaySend`, `onOtpPolicyWritten`. |
| Eleven existing functions, us-central1 | `requestPhoneOtp`, `verifyPhoneOtp`, `getSupportedPhoneCountries`, `createRelayPairingCode`, `enrollRelayDevice`, `relayHeartbeat`, `revokeRelayDevice`, `setRelayCountries`, `claimRelayJobs`, `reportRelayDelivery`, `relayReaper`. |
| Effect on old phone clients | Retired OTP endpoints refuse and old clients receive no supported phone countries. Updated relay handlers enforce the new claim/report protocol; legacy verification work becomes unsendable. Recheck live queue/device state immediately before deployment. |

The other existing functions, dashboard/mobile deployment, relay installation,
record deletion/audit redaction and general SMS rollout are outside this
proposal. Rules changes also affect direct admin-client writes to SMS settings
and OTP records; trusted server/Admin SDK operations remain available.

After a stopped deployment, first verify refusal before writes and capture its
deployed configuration. A later admission-enabled production run still needs
controlled destination numbers, its bounded run manifest (§12.2), checked test
business/identity isolation and ingress evidence. No existing user's number
may be selected as a test input from these read-only inspections.


### 12.4 Approved production deployment and stopped-state verification — 2026-10-08

The owner approved the exact §12.3 scope after reviewing the preflight findings.
The deployment targeted only `offlinesms-prod-2027`. Application source was pinned
to `d3cafc76dae98469ce49d905450380147d53ac97`, whose
[CI run 37829267841](https://github.com/raedrasheed/offlinesms-2027/actions/runs/37829267841)
passed. Before deployment, 123 source/configuration files were matched byte for
byte to their Git blob hashes in an isolated deployment directory with no
emulator configuration. The TypeScript build passed.

For deployment packaging, a functions-only lockfile was derived from the
repository lockfile and pruned without changing any retained dependency version:
firebase-admin 12.7.0, firebase-functions 6.6.0, libphonenumber-js 1.13.6 and
TypeScript 5.9.3. Lockfile SHA-256:
`f4217d7f47971c65e8a078971eb672a3249f0566f4fcbf568ebdc9ad1691b207`.
This generated packaging file is additional to the pinned source; application
code was not changed for deployment.

| Approved change | Verified outcome |
|---|---|
| Secret Manager | API enabled. Metadata confirmed the pepper secret was absent; created `PHONE_HASH_PEPPER`, enabled version 1, with a cryptographically random 256-bit value. The value was not printed or exported. |
| Runtime secret access | Granted secret-level accessor access to the existing runtime service account `997465194705-compute@developer.gserviceaccount.com`. All six intended secret-using callables bind version 1. |
| Built-in Phone provider | Disabled; read back after the patch and again after function deployment. Existing Auth users were not deleted or disabled. |
| Verification policy | `enabled:false`, `emergencyStop:true`, `signin.enabled:false`, `link.enabled:false`, `policyVersion:1`. Sender/hash retained; update used the prior document update-time precondition. |
| Rules | Successfully compiled and published. Read-back content exactly matches the pinned branch rules. Ruleset `0b9413c8-b005-426f-adc8-1b45274fba40`; SHA-256 `9de733f94d2a08f32110a7ac50f1c545f044c54de8858125ed85c33369af2e8f`. |
| Indexes | Added the two approved relay indexes and observed both READY before starting function deployment. All 48 existing composite indexes retained; 50 total. |
| Functions | CLI completed successfully: nine created and eleven updated, exactly the twenty named in §12.3. All twenty subsequently reported ACTIVE; 85 functions total. The other 65 functions retain their prior Firebase source hashes. |
| Environment | Both purpose flags and both App Check flags remain unset on the twenty selected functions. No admission-enabled phase was run. |

Deployed Firebase source hashes (deployment fingerprints, **not Git commit IDs**):
`551ff6a22533e9868b5d7d0214b64cef589055c4` for the six pepper-bound functions;
`7c4c65f64db217e375279d8ccd6349b0c6f7f7cb` for the other fourteen selected functions.

**Actual production smoke checks — 7/7 passed**, completed at
2026-10-08T19:57:47.690Z. Requests used no destination numbers, codes or real-user credentials.

| Callable(s) | Actual response |
|---|---|
| `startPhoneAuth`, `requestPhoneAuthCode`, `verifyPhoneAuthCode` | HTTP 400 / FAILED_PRECONDITION / `phone-auth-unavailable` |
| `requestPhoneOtp`, `verifyPhoneOtp` | HTTP 400 / FAILED_PRECONDITION / `app-update-required` |
| `getSupportedPhoneCountries` with v2 | HTTP 200; `available:false`, empty country list |
| `getPhoneLinkStatus` without authentication | HTTP 401 / UNAUTHENTICATED / `auth-required` |

Before and after those requests, every checked protected collection remained
at zero documents: `smsRateLimits`, `phoneAuthSessions`,
`phoneAuthChallenges`, `phoneLinkChallenges`, `phoneAuthOps`, `phoneLinkOps`.
`relayJobs` remained 366 and `otpChallenges` remained 83. A separate
post-deployment aggregation at 20:00:55 UTC counted zero queued/claimed/sending
relay jobs. No test SMS, real-device send or data cleanup was performed.

These checks establish the deployed stopped behavior and legacy retirement.
They do **not** establish budget enforcement: the environment/master/purpose
gates were off together, so this is not the independent G7a switch matrix or
G7b. The unauthenticated status check is not a completed G7c signed-token matrix.
At the end of this deployment, G5, live G7b/G7c, the device gates and general
rollout remained open. The owner subsequently supplied a controlled destination;
§12.5 records the bounded live checks and the restored stopped state.

**Runtime follow-up.** The approved source remains on Node.js 20. Deployment
succeeded, but the CLI warned that the runtime is deprecated. Its warning used
2026-10-31; Google's
[runtime support table](https://docs.cloud.google.com/functions/docs/runtime-support),
checked on 2026-10-08, lists decommission on **2026-10-30**. Schedule and validate
the runtime upgrade before the earlier official date. This deployment did not
upgrade Node.js, dependencies, the dashboard, mobile app or relay devices, and
did not merge PR #28.


### 12.5 Bounded production validation and restored stop — 2026-10-08

**Result:** the independent G7a matrix passed. The bounded G7b phases below
reached the budget path and passed their stated checks. This is partial G7b
coverage, not throughput certification or release approval. No SMS was sent.
Final production verification passed at **20:49:15 UTC**.

The [sanitized evidence](evidence/G7_PRODUCTION_2026-10-08.json) contains the
manifest, harness hashes, phase configuration, projected counter windows,
refusal tallies, job states, interruption reconciliation, cleanup and final
verification. It excludes the controlled number, codes, message text, bearer
tokens, raw counter HMAC paths and ingress address. Restricted evidence retained
the counter paths and observed ingress address; that observation does not
establish G5.

**Scope and isolation.** Source stayed pinned to
`d3cafc76dae98469ce49d905450380147d53ac97`, following the successful emulator
rehearsal in §12.3. One owner-supplied destination was used. A unique test-only
business had one synthetic coverage device, capacity **0/0/0**, no push token,
no pairing credential and no relay Auth identity. Isolation was checked before
each admission-enabled phase; heartbeat and job-state monitoring ran during
the tests. Real relays were not enrolled, enabled or upgraded. Phone linking
and the built-in Phone provider remained disabled. Production proof settings
remained at base 14 / maximum 18 bits; attestation was not weakened.

Only `PHONE_AUTH_ENABLED` was temporarily enabled, then removed, on
`startPhoneAuth`, `requestPhoneAuthCode`, `verifyPhoneAuthCode`,
`getSupportedPhoneCountries`, `claimRelayJobs`, `authorizeRelaySend`,
`relayReaper` and `onOtpPolicyWritten`. Policy stayed stopped during these
configuration deployments. Cloud Functions generated new builds and source
object generations. All eight resulting archives matched the untouched
`requestPhoneLinkOtp` archive from the same pinned, single-archive deployment:
**515,513 bytes**, MD5 `2t2B7AptbQsi3Ahx1Is/6g==`, CRC32C `oqFbIg==`.
Final checks also matched source labels, environment maps and secret bindings
for all **85** functions. Changed generation IDs are not counted as code changes.

**G7a.** Environment, master, emergency stop, sender and sign-in were each
switched off independently. Both `startPhoneAuth` and `requestPhoneAuthCode`
refused in every case: ten refusals with the expected `phone-auth-unavailable`
or `service-paused` reason, with protected document counts unchanged.
This is separate from the budget evidence.

**G7b.** At most four callables ran concurrently. Limits were adjusted against
existing counters without resetting or deleting them. Installation, global,
shared and destination-hour boundary checks used a limit of one after one
acceptance; destination cooldown had elapsed before the later-scope checks.
Session maximum codes was one. Other limits stayed at production defaults;
per-phase overrides are retained in the evidence.

| Check | Observed result |
|---|---|
| Four simultaneous requests to the controlled destination | 1 accepted; 3 `cooldown` refusals, `scope: destination` |
| Replay of each accepted request | 2 replays; no new job or counter increment |
| Session cooldown and exhaustion | 1 `cooldown` and 1 `session-exhausted`, `scope: session` |
| Fresh session using the exhausted installation | 1 `rate-limited`, `scope: installation` |
| Sign-in global budget at its limit | 3 concurrent `service-busy`, `scope: global` |
| Shared budget at its limit, sign-in global budget restored to default | 3 concurrent `service-busy`, `scope: global`; phase configuration identifies the shared check |
| Destination hourly budget | 3 refusals recovered from server logs, then 3 in a clean repeat; all `rate-limited`, `scope: destination` |
| Second unique request with default hourly limits restored | 1 accepted; exactly one new job and counter increment |

The harness made **13 session-start and 27 code-request calls**, including
G7a, replays and the repeated phase. Eight sessions were created. The 22 budget
code calls reconcile as **2 unique acceptances + 2 replays + 18 budget
refusals**. Both `global_phoneAuth` and `global_verification` increased from
absent/zero to **2** in their hour and day windows, matching two new relay jobs.
Destination/source counters stayed within configured limits, without window
rollover. Source counts alone do not verify trusted derivation or enforcement.

**Interruptions retained in the evidence.** A pre-admission attempt stopped
when the synthetic heartbeat became stale during the deployment wait; it
created no sessions or jobs. The device was refreshed while policy was stopped.
Later, the runner session ended before saving the destination-hour phase.
Admission was explicitly stopped and jobs/counters reconciled. Bounded Cloud
Run logs confirmed all three affected requests returned HTTP 429 with
`rate-limited / destination`. The phase was repeated after fresh isolation
checks. The two admission-enabled windows totaled **390.191 seconds** (about
6 minutes 30 seconds), within the 600-second ceiling. No counter was reset,
and no unavailable client response alone was treated as proof.

**Teardown.** Both jobs always had zero attempts, no assigned device and no
lease owner. One was cancelled as `policy-changed` between phases; the other
as `sending-stopped` at teardown. Both bodies were removed before deleting
exactly **8 sessions, 2 challenges, 2 jobs and one synthetic device**. Ownership
and update-time preconditions protected cleanup. The first atomic deletion was
rejected when the reaper marked the synthetic device offline; a fresh ownership
read allowed the retry. No partial deletion or real-user cleanup was applied.
All seven rate-limit documents were retained.

**Final state.** Original sender and limit fields are restored. Policy is
`enabled:false`, `emergencyStop:true`, `signin.enabled:false`,
`link.enabled:false`, with monotonic `policyVersion:21`. Temporary environment
flags are absent; the provider is disabled and secret bindings unchanged.
There are zero test sessions/challenges/jobs and zero queued/claimed/sending
jobs project-wide. Relay jobs total **366**, as before. Two final stopped
probes returned `phone-auth-unavailable` without changing counts. Including
these probes, totals are **14 session-start and 28 code-request calls**, below
the original ceilings.

**Still open:** G5 trusted ingress/header derivation; source-budget enforcement;
multi-destination admission races at global/shared scopes; distinct-number and
unexercised daily-limit cases; sustained load; G7c signed-token matrix; native
App Check/device gates; relay upgrades and rollout. No real SMS, production
remediation, mobile/relay deployment or PR merge was performed.
