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
| Flow | Where checked |
| --- | --- |
| 1:1 user escalation | `escalate.ts` pre-filters by coverage before billing; `dispatchBatchToRelay` re-checks |
| Group escalation | same `escalate.ts`/dispatcher path |
| Org dashboard send | shared `submitOrganizationMessageBatch` annotates coverage synchronously; SMS escalation gated by dispatcher |
| Org Messaging API | same shared submit path; response includes `smsCoverage` |
| Sign-in OTP | exempt (jobs have no `recipientCountryCode`; claim filter ignores untagged jobs) |

**No silent fallback:** uncovered countries are skipped (`no_relay_for_country`), never routed to another country's relay and never HTTP-fallen-back. Capacity overflow for a *covered* country is queued (relay-only) or HTTP-fallback (hybrid) — unchanged.

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
- **Unit:** `npm run test` → **514 passing** (46 files), incl. new: `phoneCountry` (11), `relayCountry` (7), `relayRouting` (14), `relayDispatchSummary` (9).
- **Rules (emulator):** `relayCountry.rules` + `relay.rules` + `sms.rules` → **17 passing**.
- **Typecheck:** functions ✅ · dashboard ✅.
- Commits: #1 phone util · #2 model+enrollment+admin edit · #3 resolver · #4 1:1/group · #5 org dashboard+API · #6 dashboard UI+coverage · #7 this report.

## Acceptance criteria
- [x] Admin assigns countries during activation (pairing code requires ≥1).
- [x] Admin edits relay countries later (`setRelayCountries` / dashboard editor).
- [x] Relay list + detail show countries (+ "no countries" warning, confirm-before-remove).
- [x] Sending to a supported country uses only an eligible relay for that country.
- [x] Unsupported country → `لا يوجد relay لهذه البلد`.
- [x] 1:1, group, org dashboard, org API all check coverage; OTP exempt.
- [x] No relay job created without an eligible relay for the recipient country.
- [x] Mixed-country group sends only covered recipients; skips + summary reported.
- [x] Relay app can't bypass (claim filter + admin-only writes).
- [x] Existing relays not silently allowed all countries.
- [x] Audit logs on country changes.
- [x] Tests for user/org/API logic, eligibility, and security rules.

## Known limitations / decisions
1. **Relay-path-only enforcement** (confirmed): the HTTP-gateway provider mode (a mock) is out of scope; only relay routing is gated.
2. **Org in-app delivery preserved** (confirmed): org messaging is in-app-first; SMS coverage is *annotated* per recipient (`smsRelayCoverage`) and the SMS step is gated by the dispatcher — in-app delivery isn't blocked by missing relay coverage.
3. **Org-flow integration tests:** the repo has no functions/dashboard emulator-integration harness, so the country/coverage logic is validated via pure unit tests on the shared logic (functions mirror) + rules tests + typecheck rather than full end-to-end integration tests.
4. **"Countries without coverage" card** reflects current configured-relay state (relays exist but none active), not message-failure history; a recent-failures aggregation could be added later.
5. **Phone-utility duplication:** `normalizePhoneAndCountry` is mirrored across `packages/shared` / functions / dashboard (the project's established pattern, since `firebase deploy` can't cross-import) — keep the three copies in sync.

## Local testing
- `npm run test` (unit). `npm run test:rules` with `firebase emulators:start --only firestore` (rules).
- To exercise routing end-to-end: configure a relay's countries in the dashboard, enroll/activate with a country, then escalate a message to a covered vs uncovered number and observe queued vs `no_relay_for_country`.
