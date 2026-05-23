# Phase 20 — Final Hardening: Testing, Security Review, Performance Review, Release Readiness

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** In progress
**Objective:** Final hardening phase. Verify, test, harden, document, and prepare the system for controlled release. No new product features.

---

## 1. Scope

This phase ships only:

1. **Automated test foundation** — Firestore rules tests, critical Cloud Functions helper tests, dashboard utility tests, mobile utility tests, and CI integration.
2. **Security review** — comprehensive doc covering admin guard, RBAC, org scoping, rules, Admin SDK bypass, webhook security, payment idempotency, wallet, SMS abuse controls, rate limits, redaction, audit logging, residual risks.
3. **Performance review** — Firestore queries, indexes, dashboard count strategy, export memory, search limits, large group aggregation, scheduled function cost, known limitations.
4. **Release readiness** — env var checklist, Firebase deployment checklist, admin bootstrap, data seed, smoke tests, rollback.
5. **QA checklist** — manual test matrix for all surfaces.
6. **Documentation updates** — phase log, architecture, risk register, design map.

## 2. Out of scope (explicit)

- No new features. No media messages. No mobile calls.
- No payment-provider UI changes. No real notification sending.
- No admin wallet adjustment. No full moderation workflow.
- No external provider names in UI.
- No loosening of Firestore rules, removing rate limits, or disabling admin guards.
- No exposure of private message content, SMS body, full phone numbers, or secrets.

## 3. Test strategy

### Tooling

- **Vitest** — chosen for TypeScript-first ergonomics, fast watch mode, and Node compatibility. Already widely adopted across the JS ecosystem.
- **@firebase/rules-unit-testing** — official library for rules tests against the Firestore emulator.
- **Firebase Emulator Suite** — required for rules tests; CI runs emulators only when invoking the rules suite.

### Test layout

```
tests/
  rules/                      # Firestore rules tests
    users.rules.test.ts
    conversations.rules.test.ts
    groups.rules.test.ts
    receipts.rules.test.ts
    sms.rules.test.ts
    wallet.rules.test.ts
    support.rules.test.ts
    system.rules.test.ts
  helpers/
    rules-helpers.ts
apps/dashboard/
  __tests__/
    redaction.test.ts
    adminPermissions.test.ts
    adminScope.test.ts
    rateLimit.test.ts
    exportHelper.test.ts
apps/mobile/
  __tests__/
    username.test.ts
    points.test.ts
    user.test.ts
functions/
  __tests__/
    helpers/
      idempotency.test.ts
      walletMath.test.ts
      smsRecipients.test.ts
      adminGuards.test.ts
```

### Scripts

- `npm run test` — runs vitest across all workspaces that have a test script
- `npm run test:rules` — runs the rules test suite (assumes emulator running locally; documented in test docs)
- `npm run validate` — typecheck + lint + i18n:check + test + build (single-command pre-merge check)

### CI changes

- Add a `test` step to `ci.yml` after lint: `npm run test --workspaces --if-present`
- Add `i18n:check` step (currently missing from CI)
- Rules tests run in a separate job that boots the Firestore emulator
- Functions emulator tests document as "manual / local-only" until a dedicated job is added — emulator startup is heavy and gated on Java availability

## 4. Rules testing strategy

Use `@firebase/rules-unit-testing` `initializeTestEnvironment` with `firestore: { rules: readFileSync('firestore.rules', 'utf8') }`. Each test creates authenticated and unauthenticated contexts and asserts allow/deny via `assertSucceeds` / `assertFails`.

Categories:
- **Users/profile** — own profile read, allowed preference fields, denied role/wallet writes
- **Conversations/messages** — participant read, non-participant deny, text-message sender match, own userState only
- **Groups** — member read, non-member deny, member-management gating
- **Receipts** — own receipt only, server-owned aggregates
- **SMS** — all client writes denied (smsEscalationBatches, recipients, quota usage)
- **Wallet/transactions/payments** — own-read, client-write denied
- **Support tickets** — owner create, admin field protected
- **System collections** — auditLogs / gatewayHealth / smsDeliveryEvents / transferQuotaUsage client-write denied

## 5. Functions testing strategy

Most callable handlers depend on Admin SDK and Auth context, which makes pure unit tests heavy. Strategy:

1. **Extract pure helpers** where they already exist (`functions/src/lib/*`) and test them directly with vitest.
2. **Idempotency keys** — assert that the helper for hashing/looking up events is deterministic and detects replays.
3. **Wallet math** — pure functions for reservation/release/transfer math that never produce negative reserved or balance.
4. **SMS recipient filtering** — pure function for opt-out / no-phone / dedup filtering.
5. **Admin guards** — pure functions for capability check & last-super-admin protection.
6. Document remaining flows that require emulator integration tests as deferred to a "Phase 20.1 integration tests" follow-up.

## 6. Dashboard testing strategy

Pure utility tests via vitest:
- `redaction` — phone masking, name masking
- `adminPermissions` — `canDo()` matrix for each role
- `adminScope` — `getAdminScope()` and `applyOrgScope()` behavior
- `rateLimit` — first request OK, subsequent over-limit blocked, TTL pruning
- `exportHelper` — CSV escaping for commas, quotes, newlines, redacted phone formatting

## 7. Mobile testing strategy

Vitest-compatible TS-only tests (no React Native renderer):
- `username` validation rules
- `points` formatting (positive/negative amounts, locale)
- `user` preference type mappings
- Existing i18n parity covered separately by `npm run i18n:check`

## 8. Files expected to change/create

### Created
- `docs/OFFLINESMS_PHASE_20_PLAN.md` (this file)
- `docs/OFFLINESMS_SECURITY_REVIEW.md`
- `docs/OFFLINESMS_PERFORMANCE_REVIEW.md`
- `docs/OFFLINESMS_RELEASE_CHECKLIST.md`
- `docs/OFFLINESMS_QA_CHECKLIST.md`
- `tests/rules/*.rules.test.ts` (8 files)
- `tests/helpers/rules-helpers.ts`
- `vitest.config.ts` (root for rules tests)
- `apps/dashboard/__tests__/*.test.ts` (5 files)
- `apps/dashboard/vitest.config.ts`
- `apps/mobile/__tests__/*.test.ts` (3 files)
- `apps/mobile/vitest.config.ts`
- `functions/__tests__/helpers/*.test.ts` (4 files)
- `functions/vitest.config.ts`

### Modified
- `package.json` — add vitest devDep, test/validate scripts
- `apps/dashboard/package.json` — add test script
- `apps/mobile/package.json` — add test script
- `functions/package.json` — add test script
- `.github/workflows/ci.yml` — add i18n:check and test steps
- `docs/OFFLINESMS_PHASE_LOG.md`
- `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md`
- `docs/OFFLINESMS_RISK_REGISTER.md`
- `docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`

## 9. Security review scope

`docs/OFFLINESMS_SECURITY_REVIEW.md` will cover, with concrete file/line citations:
- Admin guard at `apps/dashboard/app/admin/layout.tsx`
- RBAC capability matrix at `apps/dashboard/lib/adminPermissions.ts`
- Org scoping at `apps/dashboard/lib/adminScope.ts`
- Firestore rules per-collection summary
- Admin SDK bypass — every server route re-verifies session
- Payment webhook signature + idempotency
- Wallet transaction safety (Firestore transactions, no negative reserved)
- SMS escalation abuse controls (per-day caps, cooldown, audience cap)
- Rate limiting (search 60/min, exports 10/hr, audit export 5/hr)
- Redaction of phones in admin views and exports
- Audit logging for all privileged actions
- Known residual risks (in-memory rate limit, emulator-only test coverage, dashboard dark mode incomplete)

## 10. Performance review scope

`docs/OFFLINESMS_PERFORMANCE_REVIEW.md` will cover:
- Firestore query audit (which queries are limit-bounded, which need indexes)
- Composite index coverage vs. live queries
- Dashboard count() vs. aggregate count strategy
- Export memory cap (1000 rows)
- Global search prefix-query limits (case-insensitive `displayNameLower`)
- Large-group receipt aggregation hotspot
- SMS batch report scale notes
- Rate limit limitation in serverless (in-memory, per-instance)
- Scheduled function cost estimate (reapStuckBatches every 15 min)
- Future optimizations (denormalization, paged queries, edge caching)

## 11. Release readiness scope

`docs/OFFLINESMS_RELEASE_CHECKLIST.md`:
- Environment variables (Firebase project IDs, service account, webhook secrets, app environment, dashboard base URL)
- Firebase deployments (rules, indexes, functions, storage rules, scheduled functions)
- Admin bootstrap (promoteAdmin script, super_admin verification, route-guard verification)
- Data seed (points packages, system settings, test users, wallet test balances)
- Smoke tests (login, profile, chat, group, receipts, SMS preview, wallet, purchase mock, transfer, admin, audit export, support)
- Rollback procedures (branch/tag, function rollback, rules rollback, index notes, feature flags)

## 12. QA checklist scope

`docs/OFFLINESMS_QA_CHECKLIST.md`: manual test matrix per surface (mobile auth, chat, groups, message actions, receipts, SMS escalation, wallet, buy/transfer, support, admin dashboard, search/export, settings, i18n/RTL/dark mode, accessibility, security negative tests).

## 13. CI changes

```yaml
- name: i18n parity check
  run: npm run i18n:check

- name: Test (all workspaces)
  run: npm run test --workspaces --if-present
```

Rules tests are NOT run in CI in Phase 20 (Java/emulator setup adds time and flakiness risk). They run locally via `npm run test:rules` after `firebase emulators:start --only firestore`. Adding a CI job for rules tests is a follow-up.

## 14. Rollback plan

All changes are additive:
- Test files only run when invoked; they don't affect production code paths.
- New documentation doesn't ship in any binary.
- CI additions are non-blocking for builds that pass everything else; if tests are flaky in CI we can move them to a separate job.

If the new test setup causes CI to fail unexpectedly:
1. Revert the workflow file change to remove the test step.
2. Tests can still be run locally via `npm run test`.
3. The phase log will note partial CI coverage as a known limitation.

## 15. Acceptance criteria

1. Phase 20 plan exists ✓ (this file)
2. Firestore rules tests exist
3. Critical helper tests exist; emulator gaps documented
4. Dashboard utility tests exist
5. Mobile utility tests exist
6. CI runs tests + i18n:check
7. Security review document exists
8. Performance review document exists
9. Release checklist exists
10. QA checklist exists
11. No client wallet-credit, payment-completion, SMS-delivery-status mutation, or auditLog write path introduced
12. Search/export remain redacted and rate-limited
13. Admin guard remains enabled
14. No private content / phones / secrets / provider names exposed
15. `typecheck`, `lint`, `i18n:check`, `test`, `build` all pass
16. Phase log updated

## 16. Commit strategy

1. `docs: add OfflineSMS phase 20 implementation plan` ← this commit
2. `test: add Firestore rules test foundation`
3. `test: add critical functions helper tests`
4. `test: add dashboard utility tests`
5. `test: add mobile utility tests`
6. `ci: add validation test workflow`
7. `docs: add security and performance reviews`
8. `docs: add release and QA checklists`
9. `docs: update phase log for phase 20`
