# OfflineSMS — Country-Based Relay Routing & Enforcement

Implementation note + verification report. Branch: `claude/country-relay-routing`.

## The rule
Every OfflineSMS send passes one question before a relay job is created:
**"Is there an active healthy relay assigned to the recipient country?"**
Yes → route through it. No → don't send; surface
**`لا يوجد relay لهذه البلد` / "No relay is available for this country"**.

## Architecture mapping (reused, no parallel collections)
- **Relay = `relayDevices/{deviceId}`** (org-scoped by `businessId`; `status`, `lastHeartbeatAt`, `caps`/`counters`; `HEARTBEAT_STALE_MS = 90s`). New fields: `allowedCountryCodes: string[]`, `countryRoutingEnabled: boolean`, `updatedBy`.
- **Jobs = `relayJobs/{jobId}`** — now carry `recipientCountryCode`.
- **Single chokepoint:** `functions/src/sms/relayDispatcher.ts → dispatchBatchToRelay`. Every real send (1:1, group, org dashboard, org API) creates relay jobs here, so one country-aware implementation covers all flows.
- **Resolver:** `functions/src/sms/countryRouting.ts` — `resolveRelayForOfflineSmsRecipient` + `findEligibleRelayForCountry` + `partitionRecipientsByCoverage`.
- **Phone→country:** `normalizePhoneAndCountry` (libphonenumber-js) — canonical in `packages/shared/phoneCountry.ts`, mirrored into `functions/src/lib/phoneCountry.ts` (deploy-safe) and `apps/dashboard/lib/phoneCountry.ts`.

## Enforcement per flow
Enforcement is **unconditional** — applied for EVERY provider mode (relay AND
the HTTP gateway), via the single decision `coverageSkipReason` (and its
Firestore wrapper `partitionRecipientsByCoverage`).

| Flow | Where checked |
| --- | --- |
| 1:1 user escalation | `escalate.ts` filters by coverage before billing, for relay AND http; `dispatchBatchToRelay` re-checks |
| Group escalation | same `escalate.ts`/dispatcher path; each recipient evaluated individually + summary |
| Org dashboard send | `submitOrganizationMessageBatch` HARD-BLOCKS in-app delivery for uncovered countries (`no_relay_for_country`, excluded from quota) before the quota txn |
| Org Messaging API | same shared submit path; response includes `smsCoverage` + per-item status |
| Org SMS escalation | `escalateOrgBatches` filters eligibles by coverage before sending — gates the HTTP path too (relay path already dispatcher-gated) |
| Relay claim (device) | `claimRelayJobs` refuses jobs for unserved countries via `canDeviceClaimJobCountry` (candidate filter + in-txn re-check) |
| Sign-in OTP request | `requestPhoneOtp` requires `hasRelayCoverageForCountry` for the OTP org or throws `no-relay-for-country` |
| Sign-in country picker | `getSupportedPhoneCountries` returns only countries with a live relay, plus the store-review number's country while review access is on (that number never needs a relay); the mobile picker offers only those |
| Admin test send | `sendRelayTestAction` country-checks via `loadOrgRelayCoverage` before queueing |

**No silent fallback:** uncovered countries are skipped (`no_relay_for_country`), never routed to another country's relay and never HTTP-fallen-back, and (for org messaging) never delivered in-app either. Capacity overflow for a *covered* country is queued (relay-only) or HTTP-fallback (hybrid) — unchanged.

## Eligibility (a relay may send to a country iff)
active · heartbeat fresh (<90s) · `countryRoutingEnabled` · `allowedCountryCodes` includes the country · has capacity. **Selection:** least-loaded → freshest heartbeat → deterministic by `deviceId`.

## Security (server-enforced)
- `relayDevices`/`relayJobs` are admin-write-only (rules). Relay devices/org-admins **cannot** write `allowedCountryCodes` via the client SDK — only the admin callable/action. (`tests/rules/relayCountry.rules.test.ts`.)
- `claimRelayJobs` only returns jobs whose `recipientCountryCode` ∈ the device's `allowedCountryCodes` → relays can't pull unsupported-country jobs.
- Country edits are validated server-side (ISO alpha-2 via libphonenumber) and audited (`relay.allowed_countries.updated`, `relay.country_routing.enabled/disabled`).

## Migration / backfill
Existing relays have no country config → `isRelayConfiguredForRouting` returns **false** → excluded from sending (never default-all). Admins configure them via the dashboard editor / `setRelayCountries`. The dashboard shows a warning (AR + EN) listing unconfigured relays.

## Environment
`libphonenumber-js` added to `functions`, `apps/dashboard`, `packages/shared`. No other env required (relay country config lives in Firestore).

## Verification results
- **Unit:** `npm run test` → **539 passing** (48 files), incl. new/updated:
  `phoneCountry` (11), `relayCountry` (11), `relayRouting` (14),
  `relayDispatchSummary` (8), `relayCoverageEnforcement` (12, new),
  `countries` (5, new, mobile), `orgMessagingApi` (38, updated).
- **Rules (emulator):** `relayCountry.rules` + `relay.rules` + `sms.rules` →
  **17 passing** (unchanged; rules layer untouched by the enforcement fix — run
  with `npm run test:rules` under the Firestore emulator).
- **Typecheck:** functions ✅ · dashboard ✅ · mobile ✅. i18n parity ✅.
- Commits: #1 phone util · #2 model+enrollment+admin edit · #3 resolver ·
  #4 1:1/group · #5 org dashboard+API · #6 dashboard UI+coverage · #7 report.
- Enforcement-bug fix commits (this round): #1 unconditional coverage on ALL
  paths (relay+http, org in-app hard-block) · #2 claim-time safety helper ·
  #3 `getSupportedPhoneCountries` · #4 mobile picker · #5 this report.

## Acceptance criteria
- [x] Admin assigns countries during activation (pairing code requires ≥1).
- [x] Admin edits relay countries later (`setRelayCountries` / dashboard editor).
- [x] Relay list + detail show countries (+ "no countries" warning, confirm-before-remove).
- [x] Sending to a supported country uses only an eligible relay for that country.
- [x] Unsupported country → `لا يوجد relay لهذه البلد`.
- [x] 1:1, group, org dashboard, org API all check coverage; OTP request gated.
- [x] Enforcement applies on the HTTP gateway path too (not relay-only).
- [x] Org messaging does NOT deliver in-app to non-covered countries (hard block, excluded from quota).
- [x] No relay job created without an eligible relay for the recipient country.
- [x] Mixed-country group sends only covered recipients; skips + summary reported.
- [x] Relay app can't bypass (claim filter `canDeviceClaimJobCountry` + admin-only writes).
- [x] Existing relays not silently allowed all countries.
- [x] `getSupportedPhoneCountries` returns only countries with an eligible active relay.
- [x] Mobile sign-in picker shows only supported countries, with loading/empty/error states (AR + EN).
- [x] Audit logs on country changes.
- [x] Tests for user/org/API logic, eligibility, claim safety, supported-countries, and the mobile picker.

## Enforcement-bug fix (round 2) — root cause & resolution
**Symptom:** a PS-only relay still delivered to +972 (IL) and +962 (JO).

**Root cause:** enforcement was originally **relay-path-only** by design
(limitation #1 below, now removed). Two leaks let uncovered countries through:
1. **HTTP provider mode** bypassed the country filter entirely (the filter ran
   only when relay mode was engaged) — 1:1, group, and org SMS escalation.
2. **Org in-app delivery** reached every member regardless of relay coverage
   (coverage was *annotated*, not enforced).
Plus untagged OTP jobs + an uncountry-checked admin test-send (fixed earlier in
`fb0b923`).

**Resolution (confirmed decisions):** enforce on HTTP too (hard block) and
block org in-app for non-covered countries. The coverage decision is now
unconditional across every path (see the table above), reusing the existing
`relayDevices`/`relayJobs`/resolver — no parallel architecture.

## Known limitations / decisions
1. **Org-flow integration tests:** the repo has no functions/dashboard emulator-integration harness, so the country/coverage logic is validated via pure unit tests on the shared logic (functions mirror) + rules tests + typecheck rather than full end-to-end integration tests. The enforcement-bug fix adds `relayCoverageEnforcement.test.ts`, which reproduces the 1:1 and group PS-only routing against real `+970/+972/+962` numbers through the exact `parse → coverageSkipReason` composition the send paths use.
2. **Coverage at submit vs. escalation:** org messaging evaluates coverage at submit time (in-app block). The deferred SMS escalation re-checks coverage at send time, so a relay going offline between submit and escalation correctly skips those recipients.
3. **`unknown` coverage is not blocked:** a recipient whose phone can't be parsed to a country (e.g. malformed, or a linked user with no usable `phoneNumber`) is treated as `unknown` and is NOT hard-blocked from in-app delivery — only an explicit `no_relay_for_country` (country detected, no relay) is. Invalid phones are still skipped for SMS by the classifier.
4. **Coverage-annotation failure is fail-open for in-app:** if `loadOrgRelayCoverage` throws transiently, org in-app delivery proceeds (the SMS step stays dispatcher-gated). This avoids failing an entire batch on a transient read.
5. **"Countries without coverage" card** reflects current configured-relay state (relays exist but none active), not message-failure history; a recent-failures aggregation could be added later.
6. **Phone-utility duplication:** `normalizePhoneAndCountry` is mirrored across `packages/shared` / functions / dashboard (the project's established pattern, since `firebase deploy` can't cross-import) — keep the three copies in sync.

## Local testing
- `npm run test` (unit). `npm run test:rules` with `firebase emulators:start --only firestore` (rules).
- To exercise routing end-to-end: configure a relay's countries in the dashboard, enroll/activate with a country, then escalate a message to a covered vs uncovered number and observe queued vs `no_relay_for_country`.
