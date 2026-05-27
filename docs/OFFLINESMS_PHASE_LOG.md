# OfflineSMS Phase Log

Running log of phased work. Newest first.

---

## Phase 22D — Message Actions + Receipts via Outbox (flag-gated)

**Branch:** `claude/phase22d-message-actions-outbox` (stacked on 22C).
**Status:** Code complete (22D-1 → 22D-3); **on-device verification PENDING**.
Gated by `LOCAL_FIRST_CONVERSATION_ENABLED` (default OFF) → no behaviour change.

### What was done

1. **Plan** — `docs/OFFLINESMS_PHASE_22D_PLAN.md`.
2. **Pure toggle logic** — `reactionLogic.toggleReaction` mirrors the server
   one-emoji-per-user rule; unit-tested.
3. **Outbox helpers** — `queueReactMessage` / `queueEditMessage` /
   `queueDeleteMessage` (optimistic local mutation + idempotent outbox item) and
   `queueStarMessage` / `queuePinMessage` / `queueMarkReceipt` (idempotent
   enqueue; receipt keys collapse per message+status). Repo mutators
   `updateReactions` / `updateText`.
4. **UI wiring** — `MessageBubble` react/edit/delete/star/pin and the
   Conversation incoming-receipt emission route through the outbox when the
   conversation is local-first (`context.localFirst`); the existing direct
   callables remain for flag-OFF.

### Verification

- Mobile typecheck **clean**; **156/156 tests pass** (58 localdb; +6 this phase).
- **NOT run:** Expo app / device. Device checklist in the 22D plan is **pending**
  (offline react/edit/delete apply instantly + sync on reconnect; no
  re-toggle/dup after retry; server reaction set reconciles; delete-for-everyone
  wins; flag-OFF parity).

### Known limitations / decisions

- star/pin/receipt **read-state** still comes from the live
  userState/conversation Firestore subscriptions, so only their **writes** were
  routed through the outbox — no redundant message-schema columns were added
  (deliberate; a local userState mirror for offline reads is a possible 22E
  item).
- Actions require the message's **remote id**; on a still-pending local message
  the helpers no-op with `{ ok:false, reason:'not-delivered' }`.
- Builds on 22A/22B/22C, which remain device-unverified.

---

## Phase 22C — Conversation Local-DB + Outbox Send (flag-gated)

**Branch:** `claude/phase22c-conversation-local-first` (stacked on the Phase 22
branch).
**Status:** Code complete (22C-1 → 22C-3); **on-device verification PENDING**.
Flag `LOCAL_FIRST_CONVERSATION_ENABLED` defaults OFF → no behaviour change.

### What was done

1. **Plan** — `docs/OFFLINESMS_PHASE_22C_PLAN.md`.
2. **Schema v2** — `reactions_json` + `delivered/read/viewed/played_count`
   columns on `messages` (migration v2 / ALTER), persisted by
   `upsertRemoteMessage` and mapped by the message view-model so local mode
   renders reactions + receipt indicators.
3. **Message view-model** (`src/hooks/messageModel.ts`) — `MessageRow` →
   `Message` (reactions parse, counts, replyTo, pending→sending) + chronological
   ordering. Pure, unit-tested.
4. **Feeder + hook** — `conversationFeeder` (reuses `subscribeMessages`, upserts
   reactions/counts into SQLite) and `useLocalConversation` (opens DB + sync
   scheduler, serves messages from the DB, paginates, Firestore fallback).
5. **Screen cutover** — `Conversation.tsx` reads from the local DB and sends via
   `queueSendMessage` + outbox/sync engine (idempotent; no dup on retry) when
   the flag is on; Firestore listener skipped; incoming receipts still emitted;
   falls back to the existing Firestore + OfflineContext path otherwise.
6. **Legacy import** — one-time, guarded import of the AsyncStorage
   `offlineQueue` into the SQLite outbox (safe: remaining legacy items are
   undelivered).
7. **Feature flag** — `LOCAL_FIRST_CONVERSATION_ENABLED` (default OFF, env
   override). Tests for model + migration v2 + flag default.

### Verification

- Mobile typecheck **clean**; all-workspaces typecheck **clean**.
- i18n parity **PASS**; **150/150 tests pass** (incl. 46 localdb).
- **NOT run:** Expo app / device. Device checklist in the 22C plan is **pending**
  (flag-OFF parity, cached instant load, optimistic send + no-dup on
  reconnect/retry, incoming stream, legacy migration once, logout wipe).

### Known limitations

- Reactions/receipts now persist locally, but per-user receipt detail
  (MessageInfo) and reaction *writes* still go through existing callables.
- Builds on 22A/22B, which remain device-unverified (PR #6 Draft).
- Conversation message *actions* (edit/delete/react/star/pin) still call their
  callables directly; routing those through the outbox is a later sub-phase.

---

## Phase 22B — ChatList Local-DB Cutover (flag-gated)

**Branch:** `claude/wonderful-bohr-WE9L0`
**Status:** Code complete; **on-device verification PENDING** (no Expo build
available in the work environment). Flag defaults OFF → no behaviour change.

### What was done

1. **Phase 22B plan** (`docs/OFFLINESMS_PHASE_22B_PLAN.md`).
2. **Feature flag** (`apps/mobile/src/config/features.ts`) —
   `LOCAL_FIRST_CHAT_LIST_ENABLED`, default `false`, overridable via
   `EXPO_PUBLIC_LOCAL_FIRST_CHAT_LIST=1`.
3. **Pure view-model** (`src/hooks/chatListModel.ts`) — `ConversationRow` →
   render item (Timestamp-like wrapper so existing `formatTime` works) +
   `filterChatList` (All/Unread/Favorites/Groups + search).
4. **Hook** (`src/hooks/useLocalChatList.ts`) — opens the per-user DB
   (`openLocalDb`, no message-sync scheduler), reads `conversationsRepo`, starts
   the feeder, re-reads on change; returns `{ items, loading, error, source,
   refresh }` with `firestoreFallback` on init failure.
5. **Feeder** (`src/localdb/sync/chatListFeeder.ts`) — owns the conversations +
   per-user-state Firestore listeners; upserts into SQLite, resolves direct-chat
   peer names once; logs only ids/codes.
6. **ChatsList integration** — flag-gated: local path skips the Firestore
   listeners; flag off / fallback keeps the old path verbatim. Same UI/filters/
   search; subtle "Local cache" hint in local mode.
7. **Tests** — mapper, filter, flag-default; **35/35 localdb tests passing**
   (node).

### Verification

- `apps/mobile/__tests__/localdb` — **35/35 passing** (vitest, node).
- Flag off by default → ChatsList behaviour unchanged.
- **NOT run:** Expo app / device. Device checklist in the 22B plan is **pending**
  (cold-start cached list, airplane mode, reconnect refresh, unread parity,
  filters on local data, logout no-leak, flag-off parity).

### Known limitations

- Direct-chat peer name resolved by the feeder (1 user-doc read each, cached);
  group/unread/preview come from the conversation + userState docs.
- Conversation screen, `OfflineContext`/`offlineQueue`, SMS/points: untouched.
- Mobile typecheck/lint/build not runnable here (Expo deps absent).

---

## Phase 22 — Local-First Mobile Database & Firebase Sync (22A)

**Branch:** `claude/wonderful-bohr-WE9L0`
**Status:** 22A complete (additive foundation). 22B–22E (UI cutover) deferred to
a device-verified follow-up.

### What was done

1. **Phase 22 plan** (`docs/OFFLINESMS_PHASE_22_PLAN.md`) — objective, current
   data-flow audit, listener/callable inventory, tech decision (`expo-sqlite`),
   schema, sync architecture, conflict/migration/security/perf/test/rollback
   strategies, acceptance criteria, and 22A→22E staging.
2. **Local DB foundation** (`apps/mobile/src/localdb/`) — row `types`, SQLite
   DDL + indexes (`schema`), versioned `migrations`, per-user `connection`
   management with logout `wipeUserData`, and local-id/idempotency-key `ids`.
   Added `expo-sqlite ~14.0.6`.
3. **Repositories** — `conversations` (indexed chat-list query + folded
   per-user state), `messages` (optimistic insert, paginated reads, remote
   reconcile by `local_id`), durable idempotent `outbox`, `syncState` cursors,
   monotonic `receipts`, group `members`, `userState` wrapper.
4. **Sync engine** — `conflictResolver` (pure), `retryPolicy` (pure),
   `networkState` (NetInfo), `firebasePush` (outbox→callables, passes
   `localId`/`idempotencyKey`), `firebasePull` (cursor/paged Firestore reads),
   `syncEngine` (single-flight push+pull+reconcile), `syncScheduler`
   (triggers + foreground timer). Public facade `index.ts`
   (`initLocalDb`/`queueSendMessage`/`wipeAndClose`).
5. **Server idempotency** — `sendTextMessage` accepts optional
   `localId`/`idempotencyKey`, dedupes by `clientLocalId`, returns the existing
   message on retry. Optional + backward compatible; no rule changes.
6. **Docs** — `OFFLINESMS_LOCAL_DB_SCHEMA.md`, `OFFLINESMS_SYNC_PROTOCOL.md`.
7. **Tests** — 25 pure-logic unit tests (conflict resolver, retry policy,
   migrations, ids) under `apps/mobile/__tests__/localdb/`, all passing in node.

### Verification

- `apps/mobile/__tests__/localdb` — **25/25 passing** (vitest, node env).
- `functions` package **compiles** (`tsc`) with the idempotency change.
- All new mobile modules are **additive** (not imported by any screen), so the
  running app's behaviour is unchanged.

### Known limitations / not done

- Could not run the Expo app, `expo-sqlite`, or mobile typecheck in this
  environment (native module + missing Expo deps); driver-backed DB tests and
  the UI cutover require a device/Expo build.
- **22B–22E (UI cutover)** — chat list/conversation reading from the local DB,
  and demoting Firestore listeners into the sync layer — deferred; repository
  read APIs are in place so the cutover is a small, well-scoped next step.
- SQLCipher deferred (no secrets stored in SQLite; OS sandbox relied upon).
- The legacy `offlineQueue`/`OfflineContext` remain the live send path until the
  cutover; a one-time import into the new outbox is part of 22C.

---

## Phase 21 — Controlled Production Rollout

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete.

### What was done

1. **Phase 21 plan** (`docs/OFFLINESMS_PHASE_21_PLAN.md`) — objective, release gates (10 items), deployment sequence, constraints, acceptance criteria.
2. **Environment & secrets checklist** (`docs/OFFLINESMS_ENVIRONMENT_CHECKLIST.md`) — Firebase project setup, Cloud Functions config keys (SMS gateway, payments webhook, notifications scaffold), mobile `.env` variables, dashboard `.env.local` variables, verification steps, staging vs production parity checks.
3. **Deployment runbook** (`docs/OFFLINESMS_DEPLOYMENT_RUNBOOK.md`) — exact commands for rules, indexes, functions, dashboard (Vercel/Hosting), admin bootstrap, scheduled jobs, post-deploy checks, and common failure recovery (billing, parse errors, index conflicts, cold starts, missing config).
4. **Admin bootstrap checklist** (`docs/OFFLINESMS_ADMIN_BOOTSTRAP_CHECKLIST.md`) — first-time `super_admin` creation via Admin SDK or Functions shell, role verification, last-super_admin protection test, support_agent creation, route guard validation, emergency locked-out recovery.
5. **Production smoke-test guide** (`docs/OFFLINESMS_PRODUCTION_SMOKE_TEST.md`) — 17 mobile items (login/OTP, profile, direct chat, message actions, groups, typing indicator, SMS escalation entry, insufficient balance, batch send/receipt, wallet, transactions, support ticket, i18n, dark mode, toggle persistence, receipts, sign out), 13 dashboard items (auth gate, RBAC nav, org scoping, search, export, privileged action + audit, wallet management, SMS batch view, support ticket, notification draft disabled, rate limits, reports), 6 security negative tests.
6. **Release tagging guide** (`docs/OFFLINESMS_RELEASE_TAGGING.md`) — `v<major>.<minor>.<patch>` convention, annotated tag commands, release notes template, rollback tag strategy, GitHub Release creation.
7. **Monitoring & incident checklist** (`docs/OFFLINESMS_MONITORING_CHECKLIST.md`) — SEV1/SEV2/SEV3 severity definitions and response targets, 48-hour observation items across auth/Firestore/functions/SMS gateway/points/dashboard/security, incident response steps per severity, monitoring tooling table.
8. **Rollback runbook** (`docs/OFFLINESMS_ROLLBACK_RUNBOOK.md`) — functions rollback (redeploy from tag), rules rollback (redeploy or console history), index rollback limitations, dashboard rollback (Vercel or Firebase Hosting rollback command), emergency feature disables (SMS, purchase/transfer, exports), full rollback sequence, data rollback limitations (PITR/export note), post-rollback checklist.

### Commits

- `docs: add OfflineSMS phase 21 rollout plan and runbooks`
- `docs: update phase log for phase 21` — _(this commit)_

### Files changed

- New: `docs/OFFLINESMS_PHASE_21_PLAN.md`
- New: `docs/OFFLINESMS_ENVIRONMENT_CHECKLIST.md`
- New: `docs/OFFLINESMS_DEPLOYMENT_RUNBOOK.md`
- New: `docs/OFFLINESMS_ADMIN_BOOTSTRAP_CHECKLIST.md`
- New: `docs/OFFLINESMS_PRODUCTION_SMOKE_TEST.md`
- New: `docs/OFFLINESMS_RELEASE_TAGGING.md`
- New: `docs/OFFLINESMS_MONITORING_CHECKLIST.md`
- New: `docs/OFFLINESMS_ROLLBACK_RUNBOOK.md`
- Modified: `docs/OFFLINESMS_PHASE_LOG.md`

### Checks

- `npm run validate` — typecheck ✅ lint ✅ i18n:check ✅ test ✅ build ✅
- No new product code. Documentation only.

---

## Phase 20 — Final Hardening: Testing, Security, Performance, Release Readiness

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete.

### What was done

1. **Test infrastructure** — added `vitest` at root, `@firebase/rules-unit-testing` for rules tests, root `vitest.config.ts` for unit suites and `vitest.rules.config.ts` for rules suites.
2. **Helper extraction** — pulled pure helpers from `apps/mobile/src/lib/points.ts` and `sms.ts` into `.helpers.ts` siblings so they can be unit-tested without pulling in firebase. Both files re-export the helpers; no behavior change.
3. **Dashboard utility tests** (52 tests): redaction, adminPermissions, adminScope, rateLimit, exportHelper.
4. **Mobile utility tests** (26 tests): username, points, sms (helpers only).
5. **Functions helper tests** (26 tests): auditLog redaction/sanitisation, SMS recipient filtering / audience canonicalization / phone masking.
6. **Firestore rules test scaffolding** — 60 rules tests across 6 files: users, conversations, sms, wallet, support, system collections (`auditLogs`, `gatewayHealth`, `smsDeliveryEvents`, quotas). All read/write deny paths covered. Run locally with `npm run test:rules` after `firebase emulators:start --only firestore`.
7. **CI updates** — added `i18n:check` and `test` steps to `.github/workflows/ci.yml`. Rules tests remain local-only (Java/emulator requirement; documented in inline comment).
8. **Validation script** — `npm run validate` runs `typecheck && lint && i18n:check && test && build`.
9. **Security review** (`docs/OFFLINESMS_SECURITY_REVIEW.md`) — admin guard, RBAC matrix, org scoping, rules per-collection table, Admin SDK bypass mitigations, webhook security, payment idempotency, wallet double-spend prevention, SMS abuse controls, rate limiting, redaction, audit logging, explicit "no client can …" checks, 7-row residual risk register, 12-point production gate checklist.
10. **Performance review** (`docs/OFFLINESMS_PERFORMANCE_REVIEW.md`) — Firestore query audit per surface, composite index coverage (Phase 18 indexes), dashboard count strategy, export memory cap (1000 rows / 5MB/hr), global search limits, large-group receipt aggregation hotspot, scheduled-function cost, rate-limit limitations, Phase 21+ optimization roadmap.
11. **Release checklist** (`docs/OFFLINESMS_RELEASE_CHECKLIST.md`) — env vars, deployment order, admin bootstrap, data setup, 14-point smoke test, rollback plan, post-deploy monitoring.
12. **QA checklist** (`docs/OFFLINESMS_QA_CHECKLIST.md`) — 16-section manual test matrix across mobile (A-I) and dashboard (J-M), plus security negative tests (N), perf spot checks (O), regression scope (P).

### Commits

- `docs: add OfflineSMS phase 20 implementation plan` — `e0ed454`
- `test: add vitest foundation with dashboard/mobile/functions unit tests` — `54d0988`
- `test: add Firestore rules test foundation` — `1901bab`
- `ci: add i18n parity check and unit tests to validation workflow` — `ab69887`
- `docs: add security and performance reviews` — `ff07a18`
- `docs: add release and QA checklists` — `c574456`
- `docs: update phase log for phase 20` — _(this commit)_

### Files changed

- New: `vitest.config.ts`, `vitest.rules.config.ts`, `tests/helpers/rules-helpers.ts`, `tests/rules/*.test.ts` (6), `tests/rules/README.md`
- New: `apps/dashboard/__tests__/*.test.ts` (5)
- New: `apps/mobile/__tests__/*.test.ts` (3), `apps/mobile/src/lib/points.helpers.ts`, `apps/mobile/src/lib/sms.helpers.ts`
- New: `functions/__tests__/*.test.ts` (2)
- New: `docs/OFFLINESMS_PHASE_20_PLAN.md`, `OFFLINESMS_SECURITY_REVIEW.md`, `OFFLINESMS_PERFORMANCE_REVIEW.md`, `OFFLINESMS_RELEASE_CHECKLIST.md`, `OFFLINESMS_QA_CHECKLIST.md`
- Modified: `package.json` (vitest devDep, test/validate scripts), `.github/workflows/ci.yml`
- Modified: `apps/mobile/src/lib/points.ts`, `sms.ts` (re-export from helpers — no behavior change)

### Checks run

- `npm run typecheck` ✓ (all workspaces)
- `npm run i18n:check` ✓ (276 keys, EN=AR parity)
- `npm run test` ✓ (104 unit tests across 10 files)
- `npm run lint` ✓ (no new lint errors introduced)

### Known limitations

- **Rules tests CI.** Firestore rules tests live in `tests/rules/` but are NOT run in CI — they require Java and the Firestore emulator. Run locally before merging any change to `firestore.rules`. A CI job that boots the emulator in a Java-enabled image is the recommended Phase 21 follow-up.
- **Functions emulator tests.** Full callable-handler integration tests would require the Functions emulator (Java) and Admin SDK mocking. Phase 20 covers the pure-helper layer; full integration tests are tracked for Phase 21.
- **In-memory rate limit.** Per-instance state; documented as acceptable for admin-only traffic.
- **Dashboard dark mode wiring.** Token scaffold exists (`darkMode: 'class'`) but actual palette wiring is deferred.
- **2FA enforcement on admin accounts.** Not enforced at the app layer; relies on operational policy (Phase 21 candidate).

### Final release readiness recommendation

The repository is **release-ready for a controlled rollout** with the following gates:

1. Bootstrap a single `super_admin` in production via `npm run promote:admin`
2. Verify webhook secrets are set in the production environment
3. Run the production smoke-test section (E) of the release checklist end-to-end
4. Tag the release commit (`git tag v1.0.0`)
5. Schedule a 48-hour observation window for the first cohort

The known limitations above do not block release; they are tracked optimizations and operational hardening, not blocking defects.

---

## Phase 19 — Localization Hardening, RTL, Dark Mode, Accessibility, User Preferences

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete.

### What was done

1. **i18n parity checker** (`scripts/checkI18n.ts`) — recursively flattens all locale JSON keys and fails CI if EN/AR diverge. `npm run i18n:check` at root.
2. **EN/AR translations** — added `settings.*` (33 keys), `support.*` (18 keys), `points.filter*`, `points.smsBatch`, `points.buySubtitle`, `points.transferSubtitle`, `points.loadingWallet`, `points.loadingTransactions`, `points.emptyDescription`. Total: 276 keys per locale.
3. **`apps/mobile/src/i18n/index.ts`** — exports `isRTL` (module-level boolean) and `changeLanguage(locale)` async helper that also calls `I18nManager.forceRTL`.
4. **`apps/mobile/src/lib/user.ts`** — added `ThemePreference`, `TimeFormat`, `LanguageCode` types; `setPreferredLanguage`, `setPreferredTheme`, `setInAppNotifications`, `setTimeFormat` setters.
5. **`firestore.rules`** — added `preferredLanguage`, `preferredTheme`, `inAppNotifications`, `timeFormat` to `allowedProfileFields()`.
6. **`apps/mobile/src/context/ThemeContext.tsx`** — `ThemeProvider` reads `userPreference` from Firestore via `App.tsx` prop; falls back to `useColorScheme()`; caches to AsyncStorage. `useTheme()` returns semantic color tokens.
7. **`apps/mobile/App.tsx`** — wrapped with `<ThemeProvider userPreference={userTheme}>`.
8. **Settings screen** — full rewrite with `useTranslation`, `useTheme`, language/theme/time-format chip selectors, in-app notifications toggle, accessibility labels, `buildStyles(colors, isRTL)`.
9. **ChatsList screen** — `buildStyles(colors, rtl)` with semantic tokens; RTL-aware FAB; accessibility on rows and chips; translated filter labels.
10. **Conversation screen** — `buildStyles(colors, rtl)` with semantic tokens; RTL-aware back chevron, composer, header; accessibility on back button, send button, reply/edit previews; fixed curly-quote artifacts.
11. **Points screen** — `buildStyles(colors, rtl)` with semantic tokens; all strings use `t('points.*')`; accessibility on filter chips and action buttons; translated filter labels.
12. **SupportTicket screen** — `buildStyles(colors, rtl)` with semantic tokens; all strings use `t('support.*')`; RTL-aware layout; accessibility on category chips, tabs, inputs, and submit button.
13. **Dashboard `tailwind.config.ts`** — `darkMode: 'class'` scaffold.
14. **Dashboard `app/layout.tsx`** — `dir="ltr"`, skip-to-main-content link.
15. **Dashboard `app/globals.css`** — `:focus-visible` ring (2px primary, offset 2px); `.skip-nav` helper class.
16. **Dashboard admin layout** — `id="main-content"` on `<main>`.
17. **`AdminGlobalSearchShell`** — ARIA: `role=dialog/aria-modal` on overlay, `role=combobox/aria-controls/aria-expanded` on input, `role=listbox/option/aria-selected` on results, `aria-live="polite"` on dynamic content.
18. **`apps/dashboard/lib/i18n.ts`** — `ADMIN_LABELS` central label map for nav, actions, and statuses.
19. **`docs/OFFLINESMS_ACCESSIBILITY_CHECKLIST.md`** — mobile and dashboard review gates.
20. **`docs/OFFLINESMS_LOCALIZATION_CHECKLIST.md`** — how to add strings, parity check usage, RTL rules, Arabic guidelines.

### Commits

- `docs(phase19): add phase 19 implementation plan` — `3ee698c`
- `feat(mobile): add i18n parity checker and EN/AR settings translations` — `f68e9cd`
- `feat(mobile): add theme context, user preferences, and settings screen` — `4b65700`
- `feat(mobile): improve RTL and dark mode across core screens` — `25a4c54`
- `feat(dashboard): add theme and accessibility foundations` — `10bf6dd`
- `docs: add localization and accessibility checklists` — `c3f7903`
- `docs: update phase log for phase 19` — _(this commit)_

### Scope respected (did NOT implement)

- No new business features, media messages, or mobile calls
- No real notification broadcast sending (draft-only, send disabled from Phase 18)
- No payment-provider UI changes
- No admin wallet adjustment
- No Phase 8–18 feature breakage

### Acceptance criteria met

- i18n:check passes (276 keys, EN=AR parity)
- All new mobile screens use semantic color tokens via `useTheme()`
- All new mobile screens use `buildStyles(colors, rtl)` pattern
- All major interactive elements on updated screens have `accessibilityRole` + `accessibilityLabel`
- Dashboard has `:focus-visible` ring, skip-nav, ARIA search dialog
- TypeScript passes cleanly across all workspaces

---

## Phase 18 — Org Scoping, Rate Limiting, Search Normalization, Date-Range Reports, Support Assignment, Webhook Logs, Notifications

**Branch:** `claude/repo-audit-architecture-MiZDX`  
**Status:** Complete.

### Commits

1. `docs: add OfflineSMS phase 18 implementation plan` — `486bd3f`
2. `feat(admin): add organization-scoped admin access helpers` — `22c1f0c`
3. `feat(admin): add rate limiting for search and exports` — `aa166d8`
4. `feat(admin): add search normalization and backfill script` — `da78f27`
5. `feat(admin): add report date-range controls` — `b6fd64d`
6. `feat(admin): add support assignment workflow` — `361d6b4`
7. `feat(admin): add webhook delivery event logs` — `a85512d`
8. `feat(admin): add notification broadcast foundation` — `463746d`
9. `chore(firebase): add Phase 18 indexes` — `01b8d37`
10. `docs: update phase log for phase 18` — (this commit)

### Files changed

**New files:**
- `docs/OFFLINESMS_PHASE_18_PLAN.md` — implementation plan
- `apps/dashboard/lib/adminScope.ts` — org-scoped access helpers
- `apps/dashboard/lib/rateLimit.ts` — in-memory rate limiter
- `functions/src/admin/adminSetOrgRole.ts` — callable for org-scoped role assignment
- `scripts/backfillSearchFields.ts` — backfill displayNameLower + nameLower
- `apps/dashboard/app/admin/notifications/page.tsx` — notification broadcast foundation
- `apps/dashboard/app/admin/notifications/DraftForm.tsx` — draft form client component
- `apps/dashboard/app/admin/notifications/notificationActions.ts` — saveDraftNotification server action
- `apps/dashboard/app/admin/support/[ticketId]/TicketAssignAction.tsx` — assignment client component

**Modified files:**
- `apps/dashboard/lib/adminPermissions.ts` — added view:notifications, manage:notifications capabilities
- `apps/dashboard/lib/adminNav.ts` — added Notifications nav item (Bell icon)
- `apps/dashboard/lib/adminData.ts` — listSupportTickets: assignedTo filter; listDeliveryEvents helper
- `apps/dashboard/lib/supportActions.ts` — assignSupportTicket server action
- `apps/dashboard/app/admin/search/route.ts` — rate limiting; displayNameLower + nameLower search
- `apps/dashboard/app/admin/reports/page.tsx` — ?range=7d|30d|90d date-range controls
- `apps/dashboard/app/admin/support/page.tsx` — assignedTo filter UI
- `apps/dashboard/app/admin/support/[ticketId]/page.tsx` — TicketAssignAction UI
- `apps/dashboard/app/admin/sms/[batchId]/page.tsx` — webhook delivery events card
- `apps/dashboard/app/admin/*/export/route.ts` (6 routes) — rate limiting
- `apps/dashboard/app/admin/audit/export/route.ts` — stricter audit-export limit (5/hr)
- `functions/src/index.ts` — export adminSetOrgRole
- `firestore.indexes.json` — 9 new composite indexes

### What was done

**1. Organization-scoped admin access (`adminScope.ts`):**
- `getAdminScope(session)` → `{ organizationId?: string }` — org_admin gets org ID from claims; other roles unrestricted
- `applyOrgScope(query, scope, field?)` — applies `.where('organizationId', '==', ...)` only when scope has an org
- `canViewOrganization(session, orgId)` — true if unrestricted or claims.organizationId matches
- `adminSetOrgRole` Cloud Function — super_admin callable to set `role + organizationId` together in custom claims

**2. Rate limiting (`rateLimit.ts`):**
- In-memory Map with TTL (per-process, ephemeral — appropriate for admin routes)
- `checkRateLimit(key, opts)` → `{ ok, retryAfterMs? }` with automatic stale-entry pruning
- Search: 60 req/min per uid; exports: 10 req/hr per uid; audit export: 5 req/hr per uid
- Returns 429 JSON with human-readable retry message

**3. Search normalization:**
- `backfillSearchFields.ts` script: dry-run by default; `--write` applies changes in batches of 400
- Populates `users.displayNameLower` and `conversations.nameLower` (groups only)
- Search route updated: users searched on both `usernameLower` and `displayNameLower` (deduped, max GROUP_LIMIT)
- Groups searched on `nameLower` with graceful fallback to case-sensitive `name` prefix

**4. Report date-range controls:**
- `?range=7d|30d|90d` query param (default: 7d)
- Pill picker in top-right of Reports page; all counts and trend tables respect selected range
- 90-day range buckets by week (13 rows) to avoid 90 sequential queries

**5. Support assignment workflow:**
- `assignSupportTicket(ticketId, ...)` server action in `supportActions.ts`
- Audits: `support.ticket.assigned` / `support.ticket.unassigned` / `support.ticket.reassigned`
- `TicketAssignAction.tsx` client component with UID input + Unassign button
- Ticket detail page: assignment card below status update (manage:support required)
- Support list: `?assignedTo=<uid>` filter param + input field in filter bar

**6. Webhook delivery event logs:**
- `listDeliveryEvents(batchId, cursor?)` helper in `adminData.ts`
- Reads `smsDeliveryEvents` collection where `offlineSmsBatchId == batchId`, ordered by `receivedAt desc`, limit 50
- Shown as a DetailCard on `/admin/sms/[batchId]/page.tsx` — soft-fails (hidden) when collection absent
- No raw payload, no phone number, no SMS body shown; columns: event ID, status, result, error code, receivedAt, processedAt

**7. Notification broadcast foundation:**
- `/admin/notifications/page.tsx` — gated by `view:notifications`
- Draft form: title (≤140), body (≤500), audience (all/organization/group)
- "Send broadcast" disabled with tooltip explaining infrastructure requirement
- `saveDraftNotification` server action writes `notifications/{id}` with `status: 'draft'`
- Audits as `notification.draft.created`
- Recent drafts table (10 rows): title, audience, status, createdAt
- Added Bell icon to admin nav for manage:notifications-capable roles

**8. Phase 18 Firestore indexes (9 new):**
- users: organizationId + createdAt
- users: displayNameLower + createdAt
- conversations: nameLower + updatedAt
- tickets: assignedTo + status + updatedAt
- tickets: assignedTo + createdAt
- smsDeliveryEvents: offlineSmsBatchId + receivedAt
- notifications: status + createdAt
- notifications: createdBy + createdAt

### Security decisions

- Org scope is data-layer only; no UI banner exposing the org restriction boundary
- Rate limiter uses `<action>:<uid>` keys — no cross-user interference
- Backfill script: destructive operations require explicit `--write` flag
- Delivery events: errorCode exposed (safe opaque string); full gateway payload never read
- Notification drafts: body stored in Firestore but never shown in exports or search results
- `assignedTo` UID stored as-is (no lookup to Auth); display is truncated in list, full in detail

---

## Phase 17 — Global Search, Export Foundation, Reporting, and Filter Improvements

**Branch:** `claude/repo-audit-architecture-MiZDX`  
**Status:** Complete. TypeScript clean (dashboard + functions), next build passes (all routes).

### Commits

1. `docs: add OfflineSMS phase 17 implementation plan` — `395b360`
2. `feat(admin): add global search route and UI` — `9d4bbfc`
3. `feat(admin): add reports foundation and Phase 17 Firestore indexes` — `743d8fd`
4. `docs: update phase log for phase 17` — (this commit)

### Files changed

**New files:**
- `docs/OFFLINESMS_PHASE_17_PLAN.md` — implementation plan
- `apps/dashboard/lib/exportHelper.ts` — shared CSV export helper
- `apps/dashboard/app/admin/search/route.ts` — global search API route
- `apps/dashboard/app/admin/users/export/route.ts`
- `apps/dashboard/app/admin/groups/export/route.ts`
- `apps/dashboard/app/admin/sms/export/route.ts`
- `apps/dashboard/app/admin/points/transactions/export/route.ts`
- `apps/dashboard/app/admin/points/payments/export/route.ts`
- `apps/dashboard/app/admin/support/export/route.ts`

**Modified files:**
- `apps/dashboard/lib/adminPermissions.ts` — 7 new capabilities: search:global, export:users, export:groups, export:sms, export:points, export:support, view:reports
- `apps/dashboard/lib/adminData.ts` — listUsers/listGroups/listTransactions/listPayments accept new filter params
- `apps/dashboard/components/AdminGlobalSearchShell.tsx` — fully functional with debounce + grouped results UI
- `apps/dashboard/app/admin/reports/page.tsx` — real implementation (was placeholder)
- `apps/dashboard/app/admin/users/page.tsx` — status FilterBar + Export CSV button
- `apps/dashboard/app/admin/groups/page.tsx` — status FilterBar + Export CSV button
- `apps/dashboard/app/admin/sms/page.tsx` — Export CSV button
- `apps/dashboard/app/admin/support/page.tsx` — Export CSV button
- `apps/dashboard/app/admin/points/transactions/page.tsx` — type FilterBar + Export CSV button
- `apps/dashboard/app/admin/points/payments/page.tsx` — status FilterBar + Export CSV button
- `firestore.indexes.json` — 6 new composite indexes

### What was done

**1. Global search foundation:**
- `GET /admin/search?q=<query>&type=<optional>` — capability-aware Firestore search
- Searches: users (usernameLower prefix + exact uid), organizations (slug prefix), groups (name prefix), smsBatches (exact ID), wallets (exact uid), payments (exact ID), tickets (exact ID), auditLogs (action prefix)
- Max 5 results per group, 50 total; 300ms client debounce
- Each collection gated by the role's existing view capability
- AdminGlobalSearchShell: debounced fetch, grouped results with status dots, keyboard nav (↑↓↵ Esc), loading spinner

**2. New capabilities (7 added):**
- `search:global` — all roles
- `export:users` — super_admin, auditor, legacy_admin, bootstrap_admin
- `export:groups` — super_admin, organization_admin, auditor, legacy_admin, bootstrap_admin
- `export:sms` — super_admin, organization_admin, auditor, legacy_admin, bootstrap_admin
- `export:points` — super_admin, finance_admin, auditor, legacy_admin, bootstrap_admin
- `export:support` — super_admin, support_agent, auditor, legacy_admin, bootstrap_admin
- `view:reports` — super_admin, finance_admin, organization_admin, auditor, legacy_admin, bootstrap_admin

**3. Filter/pagination improvements:**
- Users: status filter (active/inactive/suspended) via FilterBar + URL params
- Groups: status filter (active/locked/archived) via FilterBar + URL params
- Transactions: type filter (purchase/spend/transfer/refund/bonus) via FilterBar + URL params
- Payments: status filter (pending/completed/failed/refunded) via FilterBar + URL params
- All pages forward active filter to export href

**4. Export routes (6 new):**
All exports: GET routes, permission-gated, max 1,000 rows, CSV, audit-logged as export.*

| Route | Columns | Capability |
|---|---|---|
| /admin/users/export | uid, displayName, username, maskedEmail, maskedPhone, status, profileCompleted, smsOptOut, createdAt | export:users |
| /admin/groups/export | id, name, status, memberCount, organizationId, ownerUid, createdAt, updatedAt | export:groups |
| /admin/sms/export | id, status, totalCount, sentCount, deliveredCount, failedCount, skippedCount, pointsCost, attemptNumber, createdAt | export:sms |
| /admin/points/transactions/export | id, uid, type, direction, amount, status, createdAt | export:points |
| /admin/points/payments/export | id, userId, packageId, totalPoints, amount, currency, status, createdAt | export:points |
| /admin/support/export | id, subject, category, status, createdBy, createdAt, updatedAt | export:support |

No description body in support export. No phone numbers in any export. No message bodies anywhere.

**5. Reports foundation (/admin/reports):**
- 8 overview cards: total users, new users this week/month, active groups, SMS batches this week, failed SMS this week (amber if > 0), point-spend transactions this week, open tickets (amber if > 0)
- Two 7-day trend tables with inline bar visualization: SMS batches and new users
- Support tickets by status: open/pending/resolved/closed counts
- All counts use Firestore aggregation (count().get()), all soft-fail showing `—` on error
- Gated by `view:reports` capability

**6. Firestore indexes (6 new):**
- `users`: status ASC, createdAt DESC — users status filter
- `conversations`: type ASC, createdAt DESC — groups base query ordering
- `conversations`: type ASC, status ASC, createdAt DESC — groups with status filter
- `transactions`: type ASC, createdAt DESC — transactions type-only filter + reports
- `payments`: status ASC, createdAt DESC — payments status filter
- (smsBatches status+createdAt added in Phase 16 covers reports failed SMS query)

**7. Shared export helper (`lib/exportHelper.ts`):**
- `csvCell`, `csvRow`, `buildCsvResponse`, `writeExportAudit`, `EXPORT_LIMIT=1000`
- All export routes use this helper; single place to change row limit or CSV format

### Security posture

- Search results: no full phones, no message bodies, no SMS bodies, no secrets
- Exports: no description body, no phone numbers, no message content, no payment secrets
- Reports: pure aggregate counts, no personal data
- All routes re-verify session server-side
- Capability enforcement on every route (not just UI-level)

### Checks run

- `tsc --noEmit` — clean (dashboard + functions)
- `next build` — passes (all new routes included)

### Known limitations

1. Search uses Firestore prefix scan on lowercase fields; group name search is case-sensitive (usernameLower is lowercase, but group `name` field has mixed case). Documented in plan.
2. Reports 7-day trend queries run 14 sequential date-range count queries; adds ~1-2s render time on cold path.
3. Export routes do not stream; 1000 rows loaded into memory before sending. Acceptable for admin use.
4. Search does not index SMS message body or support ticket descriptions by design.
5. `usernameLower` field may be absent on users created before Phase 5 (claimUsername). Those users won't appear in username-prefix search but can be found by exact UID.
6. Finance_admin lost `view:reports` in Phase 15 (had it as `view:reports` but it was removed from capability mapping). Restored in Phase 17.

### Recommended Phase 18 Scope

1. **Organization-scoped admin roles** — organization_admin should be scoped to their own org's data; currently sees cross-org data.
2. **Rate limiting on export/search routes** — document Phase 16's deferred throttling work and implement token-bucket or per-user rate limits.
3. **Audit export pagination** — current audit export is capped at 1000 rows; add cursor-based pagination for compliance use cases.
4. **Search improvements** — add `displayNameLower` field to user documents for display-name prefix search; add organization-level result scoping.
5. **Report date-range picker** — allow admins to pick a custom date range instead of fixed 7/30 days.
6. **Support ticket assignment** — allow support agents to claim/assign tickets without a code change.
7. **Webhook delivery logs** — surface webhook/delivery report results in the admin dashboard.
8. **Mobile notifications settings** — admin can broadcast system notifications.

---

## Phase 16 — Firestore Indexes, Scheduled Jobs, Wallet Detail, Mobile Support, Audit Export, and Operational Foundations

**Branch:** `claude/repo-audit-architecture-MiZDX`  
**Status:** Complete. TypeScript clean (dashboard + functions), tsc passes.

### Commits

1. `chore(firebase): add composite indexes for admin filters and counts` — `3f93c56`
2. `feat(functions): activate stuck SMS batch reaper` — `928ba7b`
3. `feat(admin): add wallet detail page and mobile support ticket creation` — `d145673`
4. `feat(admin): add audit export, calls foundation, and moderation page` — `e78af87`
5. `feat(admin): add dashboard count refresh button` — `23efaaf`
6. `docs: update phase log for phase 16` — (this commit)

### Files changed

**New files:**
- `docs/OFFLINESMS_PHASE_16_PLAN.md` — implementation plan
- `apps/dashboard/app/admin/points/wallets/[uid]/page.tsx` — wallet detail page
- `apps/dashboard/app/admin/audit/export/route.ts` — redacted CSV export route
- `apps/dashboard/app/admin/moderation/page.tsx` — moderation foundation page
- `apps/dashboard/app/admin/RefreshButton.tsx` — client refresh button
- `apps/mobile/src/lib/support.ts` — support ticket Firestore helpers
- `apps/mobile/src/screens/SupportTicket.tsx` — mobile support ticket screen

**Modified files:**
- `firestore.indexes.json` — 8 new composite indexes
- `functions/src/index.ts` — exports reapStuckBatches
- `apps/dashboard/lib/adminPermissions.ts` — export:audit, view:moderation capabilities
- `apps/dashboard/lib/adminData.ts` — getWallet added; tickets collection fix (supportTickets→tickets, userId→createdBy); getDashboardCounts tickets fix
- `apps/dashboard/lib/supportActions.ts` — tickets collection fix
- `apps/dashboard/lib/adminNav.ts` — Moderation nav item
- `apps/dashboard/app/admin/page.tsx` — RefreshButton added
- `apps/dashboard/app/admin/audit/page.tsx` — Export CSV button for export:audit roles
- `apps/dashboard/app/admin/calls/page.tsx` — real session guard, soft-fail callLogs read, EmptyState
- `apps/dashboard/app/admin/points/wallets/page.tsx` — rows link to detail page
- `apps/dashboard/app/admin/support/page.tsx` — createdBy field fix
- `apps/dashboard/app/admin/support/[ticketId]/page.tsx` — createdBy field fix
- `apps/mobile/App.tsx` — registers SupportTicket screen
- `apps/mobile/src/screens/Settings.tsx` — Help & Support nav row

### What was done

**1. Firestore composite indexes (8 new):**
- `auditLogs`: action + createdAt DESC — audit filter: action=
- `auditLogs`: result + createdAt DESC — audit filter: result=
- `conversations`: type + status — dashboard count: active groups
- `smsBatches`: status + createdAt DESC — SMS status filter
- `wallets`: status + updatedAt DESC — wallets status filter
- `tickets`: status + createdAt DESC — support list status filter
- `tickets`: category + createdAt DESC — support list category filter
- `tickets`: createdBy + createdAt DESC — mobile: user's own tickets

**2. reapStuckBatches activated:**
- Exported from `functions/src/index.ts`; registers as every-30-minute scheduled function
- Idempotency guarded by `pointsRefunded != null` inside the function
- `sweepExpiredMessages` remains deferred (Phase 20) — no client TTL UI exists

**3. Wallet detail page (`/admin/points/wallets/[uid]`):**
- Wallet summary (balance, reserved, available, status, updated)
- User info with `maskEmail(role)` and `maskPhone()` always applied
- Recent transactions (up to 50)
- Freeze/unfreeze action for `manage:wallets` roles; read-only note for others
- Balance adjustment not available anywhere in the admin UI
- Wallets list rows now link to detail page

**4. Tickets collection fix:**
- `adminData.ts`, `supportActions.ts`, support UI pages all updated from `supportTickets` → `tickets`
- Field `userId` → `createdBy` throughout
- `getDashboardCounts` openTickets query fixed to `tickets` collection

**5. Mobile support ticket creation:**
- `apps/mobile/src/lib/support.ts` — `createSupportTicket` writes to `tickets` collection with correct schema: `createdBy`, `status: 'open'`, no `assignedTo`
- `SupportTicket.tsx` — two-tab screen: new ticket form (subject, description, category) + my tickets history
- `Settings.tsx` — Help & Support row navigates to SupportTicket
- `App.tsx` — SupportTicket registered in RootStack

**6. Audit export (`GET /admin/audit/export`):**
- Gated by `export:audit` capability (super_admin, auditor, legacy_admin, bootstrap_admin)
- Hard row limit: 1 000 rows
- Columns: id, timestamp, actorUid, actorEmail, action, targetType, targetId (first 16 chars), result, metadataFieldCount
- No raw metadata values, no SMS body, no phone numbers, no secrets
- Writes `audit.exported` audit log entry on each export
- Export CSV button on audit log page (shown only to eligible roles)
- Accepts same filters as the audit log page (actor, action, targetType, result, from, to)

**7. Calls dashboard foundation:**
- Real session guard with `verifySession` + `canDo(role, 'view:calls')`
- `callLogs` collection read soft-fails: missing collection or Firestore error shows EmptyState
- Table columns: initiator (truncated), conversation (truncated), duration, status, started

**8. Moderation foundation (`/admin/moderation`):**
- Reads `flags` collection, gated by `view:moderation`
- Columns: flagId (truncated), type, targetType, targetId (max 16 chars), status, createdAt
- Status filter tabs: All / Open / Reviewed / Dismissed
- No private content, no message bodies
- Moderation nav item added to adminNav.ts

**9. Dashboard refresh button:**
- `RefreshButton` client component calls `router.refresh()` to re-run server component
- Displays as "Refresh counts" button in the Overview header

**10. New capabilities:**
- `export:audit` — super_admin, auditor, legacy_admin, bootstrap_admin
- `view:moderation` — super_admin, support_agent, organization_admin (via plan), auditor, legacy_admin, bootstrap_admin

### Security posture

- No admin wallet balance adjustment (wallet detail shows summary only)
- No raw metadata in CSV export (field count only)
- No full phone numbers (maskPhone always applied)
- No SMS body exposed
- No private message content
- No secrets in any page
- No provider names
- All write actions re-verify session server-side

### sweepExpiredMessages deferral

`functions/src/chats/sweepExpiredMessages.ts` is implemented but NOT exported. Activating it would silently clear the `text` field of messages with `expiresAt` set. No client-side TTL setting UI exists yet. Scheduled for Phase 20 alongside the TTL setting screen.

### Checks run

- `tsc --noEmit` — clean (dashboard + functions)

---

## Phase 15 — Admin Operations Hardening and Controlled Admin Actions

**Branch:** `claude/repo-audit-architecture-MiZDX`  
**Status:** Complete. TypeScript clean (dashboard + functions), Next.js build green (35 routes).

### Commits

1. `docs: add OfflineSMS phase 15 implementation plan` — `cab12d5`
2. `feat(admin): add wallet freeze and unfreeze action` — `1fb4ccb`
3. `feat(admin): add points package create and edit flows` — `a699da8`
4. `feat(admin): enable SMS retry from dashboard` — `2a79a90`
5. `feat(admin): add support queue foundation` — `f4d5f07`
6. `feat(admin): add settings foundation` — `42b37d8`
7. `feat(admin): add dashboard counts and audit filters` — `bed2e7d`
8. `docs: update phase log for phase 15` — (this commit)

### Files changed

**New files:**
- `docs/OFFLINESMS_PHASE_15_PLAN.md` — implementation plan
- `functions/src/admin/adminSetWalletStatus.ts` — wallet freeze/unfreeze callable
- `apps/dashboard/lib/packageActions.ts` — package create/update server actions
- `apps/dashboard/lib/supportActions.ts` — ticket status update server action
- `apps/dashboard/lib/settingsActions.ts` — system settings update server action
- `apps/dashboard/app/admin/points/wallets/WalletFreezeAction.tsx` — client component
- `apps/dashboard/app/admin/points/packages/PackageForm.tsx` — shared form component
- `apps/dashboard/app/admin/points/packages/new/page.tsx` — create page
- `apps/dashboard/app/admin/points/packages/[packageId]/edit/page.tsx` — edit page
- `apps/dashboard/app/admin/sms/[batchId]/SmsRetryAction.tsx` — retry client component
- `apps/dashboard/app/admin/support/[ticketId]/page.tsx` — ticket detail page
- `apps/dashboard/app/admin/support/[ticketId]/TicketStatusAction.tsx` — status update component
- `apps/dashboard/app/admin/settings/SettingsForm.tsx` — settings form client component

**Modified files:**
- `functions/src/index.ts` — exports adminSetWalletStatus
- `functions/src/sms/retryFailed.ts` — extends admin check to include role-based access
- `apps/dashboard/lib/adminPermissions.ts` — 5 new capabilities: manage:wallets, manage:packages, retry:sms, manage:support, manage:settings
- `apps/dashboard/lib/adminData.ts` — upgraded listAdminUsers to Auth.listUsers() pagination; added getPointsPackage, listSupportTickets, getSupportTicket, getSystemSettings, getDashboardCounts
- `apps/dashboard/app/admin/points/wallets/page.tsx` — freeze/unfreeze column, status filter tabs
- `apps/dashboard/app/admin/points/packages/page.tsx` — New package button, Edit links
- `apps/dashboard/app/admin/sms/[batchId]/page.tsx` — real retry action (was deferred stub)
- `apps/dashboard/app/admin/support/page.tsx` — real implementation (was stub)
- `apps/dashboard/app/admin/settings/page.tsx` — real implementation (was stub)
- `apps/dashboard/app/admin/page.tsx` — real Firestore count aggregation (was hardcoded)
- `apps/dashboard/app/admin/audit/page.tsx` — filter inputs for actor, action, targetType, result, from, to

### What was done

**1. Wallet freeze/unfreeze:**
- `adminSetWalletStatus` callable requires `manage:wallets` capability (super_admin, finance_admin, legacy_admin, bootstrap_admin)
- Only the `status` field is written; balance and reserved are never touched
- Confirmation dialog before every action
- Audit logged as `admin.wallet.frozen` / `admin.wallet.unfrozen`
- Wallets list now has a status filter (All / Active / Frozen)

**2. Points package create/edit:**
- `createPointsPackage` and `updatePointsPackage` server actions, gated by `manage:packages`
- Full validation: name, points > 0, bonusPoints ≥ 0, price ≥ 0, currency, status, sortOrder
- Audit logged as `points.package.created` / `points.package.updated` / `points.package.enabled` / `points.package.disabled`
- Packages list now has New package button and per-row Edit links

**3. SMS retry from dashboard:**
- `SmsRetryAction` client component calls `retryFailedSmsRecipients` callable
- `retryFailedSmsRecipients` now also accepts `role === 'super_admin'` or `role === 'organization_admin'` in addition to `admin === true`
- Shows confirmation dialog noting points may be reserved; never exposes SMS body or full phones
- Displays result: new batch ID, sent/failed counts, final status
- Gated by `retry:sms` capability; roles without it see a disabled button with explanation

**4. Support queue foundation:**
- Real Firestore-backed list with status tabs and category filter
- Ticket detail shows metadata + user-submitted description (user support content, not private messages)
- Ticket status transitions: open → pending → resolved → closed
- All status changes audit-logged as `support.ticket.status_changed`
- Status update gated by `manage:support` (super_admin, support_agent)

**5. Settings foundation:**
- Reads/writes `systemSettings/general` Firestore document; falls back to safe defaults if doc absent
- Fields: appName, supportEmail, defaultLanguage, defaultTimezone, smsEscalationEnabled, pointsEnabled
- maintenanceMode displayed read-only (cannot be toggled from UI)
- All updates audit-logged as `system.settings.updated`
- Read-only view for roles without `manage:settings`

**6. Dashboard real counts:**
- Firestore count aggregation (`collection.count().get()`) for all cards
- totalUsers and totalWallets labelled Approximate (unbounded collections)
- Counts soft-fail on error (returns `—`)
- Cards link to relevant management pages

**7. Audit log filters:**
- GET query params: actor (actorUid), action, targetType, result, from (date), to (date)
- Single equality filter at a time to avoid composite index explosion
- Missing composite index caught and surfaced as an amber warning instead of crashing
- Payload metadata never shown (only field count)

**8. listAdminUsers scalability:**
- Upgraded from Firestore first-200 scan to `Auth.listUsers()` pagination
- Up to 3 pages × 1 000 users (3 000 users) scanned per request
- For each admin user, Firestore doc is fetched for display name enrichment
- adminSetRole last-super_admin guard uses the same upgraded path indirectly

### Security posture

- No admin wallet balance adjustment
- No admin refunds
- No private message content exposed
- No SMS body exposed
- No full phone numbers anywhere (maskPhone always applied)
- No secrets in settings (stored or displayed)
- No provider names mentioned in UI
- All new write actions re-verify session server-side

### Checks run

- `tsc --noEmit` — clean (dashboard + functions)
- `next build` — passes (35 routes, 0 errors)

### Known limitations

1. Support ticket collection (`supportTickets`) does not yet have a mobile-side creation flow; tickets can be seeded via admin script or a future mobile feature.
2. Audit log filters with multiple simultaneous equality conditions require composite Firestore indexes not yet deployed; the UI surfaces a warning when this occurs.
3. Dashboard count aggregations require Firestore indexes for certain `where` clauses (e.g., `conversations.where(type==group).where(status==active).count()`); soft-fail handles missing indexes.
4. Settings form toggles use React state; the form must be submitted to persist changes (no auto-save).
5. `listAdminUsers` caps at 3 000 users; organizations with more than 3 000 users in Auth may miss some admin records.

### Recommended Phase 16 scope

- Mobile-side support ticket creation flow
- Firestore composite indexes for audit log filter combinations (deploy via `firestore.indexes.json`)
- Wallet detail page (`/admin/points/wallets/[uid]`) with transaction history
- Suspension/unfreeze email notification hooks
- Real-time dashboard count refresh (polling or Firestore snapshot)
- Package promotion/discount engine if required
- Calls dashboard foundation
- Communities moderation foundation
- Admin export / CSV download for audit log or user list (gated, rate-limited)
- Reap stuck batches scheduled function activation

---

## Phase 14 — Admin Controls, SMS Dashboard, Points Overview, Roles

**Branch:** `claude/repo-audit-architecture-MiZDX`  
**Status:** Complete. TypeScript clean (dashboard + functions), Next.js build green (30 routes).

### Commits

1. `docs: add OfflineSMS phase 14 implementation plan` — `b0d3003`
2. `feat(admin): add admin-native group lock and role assignment callables` — `bea126a`
3. `feat(admin): add organization create and edit flows` — `630c4f8`
4. `feat(admin): add SMS batch dashboard foundation` — `3f22506`
5. `feat(admin): add points overview dashboard foundation` — `4a7430f`
6. `feat(admin): add roles assignment foundation` — `5a1d2ef`
7. `docs: update phase log for phase 14`

### Files changed (25 total)

**New files (18):**
- `functions/src/admin/adminLockGroup.ts`
- `functions/src/admin/adminSetRole.ts`
- `functions/src/lib/roles.ts`
- `apps/dashboard/lib/orgActions.ts`
- `apps/dashboard/components/admin/OrgForm.tsx`
- `apps/dashboard/app/admin/organizations/new/page.tsx`
- `apps/dashboard/app/admin/organizations/[orgId]/edit/page.tsx`
- `apps/dashboard/app/admin/sms/[batchId]/page.tsx`
- `apps/dashboard/app/admin/points/wallets/page.tsx`
- `apps/dashboard/app/admin/points/transactions/page.tsx`
- `apps/dashboard/app/admin/points/payments/page.tsx`
- `apps/dashboard/app/admin/points/packages/page.tsx`
- `apps/dashboard/app/admin/roles/[uid]/page.tsx`
- `apps/dashboard/app/admin/roles/[uid]/RoleAssignAction.tsx`
- `apps/dashboard/app/admin/roles/[uid]/roleOptions.ts`

**Updated files (10):**
- `functions/src/index.ts`
- `apps/dashboard/lib/adminPermissions.ts` — 3 new capabilities
- `apps/dashboard/lib/adminData.ts` — 8 new helpers
- `apps/dashboard/app/admin/groups/[conversationId]/GroupLockAction.tsx` — adminLockGroup
- `apps/dashboard/app/admin/organizations/page.tsx` — + New org button
- `apps/dashboard/app/admin/organizations/[orgId]/page.tsx` — Edit button
- `apps/dashboard/app/admin/sms/page.tsx` — replaced placeholder
- `apps/dashboard/app/admin/points/page.tsx` — replaced placeholder
- `apps/dashboard/app/admin/roles/page.tsx` — replaced placeholder

### What was done

- **`adminLockGroup` callable (new).** Admin-native group lock that does not require
  the caller to be a group member. Requires `admin=true` claim. Validates conversation
  type=group. Audits `admin.group.locked` / `admin.group.unlocked`. `GroupLockAction.tsx`
  updated to call this instead of the member-only `lockGroup`.
- **`adminSetRole` callable (new).** Assigns/removes admin role; callable only by
  `role==='super_admin'` callers; prevents self-modification; counts remaining
  super_admins before allowing last-one demotion; updates Firebase Auth custom claims;
  audit-logged for all outcomes.
- **Organization create/edit (new).** `'use server'` actions (`orgActions.ts`) with slug
  regex validation, uniqueness check, settings validation, audit log. `OrgForm.tsx`
  client form with `useFormState`. Create page at `/admin/organizations/new`;
  edit page at `/admin/organizations/[orgId]/edit`.
- **SMS dashboard (new).** `sms/page.tsx` replaced with real server-side batch list
  (status filter chips, counts, points). `sms/[batchId]/page.tsx` batch detail: stat
  cards, metadata with group/sender links, recipient table with masked phones, SMS
  status, skip/failure reason. Retry action shows disabled with clear deferred note.
- **Points overview (new).** Hub page + 4 sub-pages (wallets, transactions, payments,
  packages). All read-only. No wallet adjustment. Transactions show direction-signed
  amounts. Payments show total points + currency. Packages show catalog.
- **Roles foundation (new).** `roles/page.tsx` lists admin users (fetched via Admin SDK
  Auth + Firestore). `roles/[uid]/page.tsx` shows live claims + `RoleAssignAction`
  client component for super_admins to assign/clear roles.

### Security posture

- Every page re-verifies session + capability server-side.
- `adminLockGroup` and `adminSetRole` validate admin claims in the callable.
- Organization server actions re-verify inside each action.
- Phones masked in all SMS recipient tables.
- No SMS/message bodies, payment secrets, or provider names in any page.

### Known limitations

1. `listAdminUsers()` scans the first 200 users in Firestore and fetches Auth records
   in batches. Large deployments (1000+ users) should use `Auth.listUsers()` instead.
2. `adminSetRole` counts super_admins by scanning up to 500 Firestore user docs —
   may miss Auth users without a Firestore document. Production deployments should
   maintain an index.
3. OrgForm `Toggle` uses a hidden `false` input + checkbox `true` pattern; in some
   browsers the last value wins. Should be tested across targets.
4. `listTransactions` accepts a `uid` filter but the page does not yet expose it;
   per-user transaction filtering is a future enhancement.

### Recommended Phase 15 scope

1. Wallet freeze/unfreeze action (callable + admin UI).
2. Points package create/edit UI (currently read-only).
3. SMS retry from dashboard (new admin callable, no sender-auth restriction).
4. Support queue/ticket management foundation.
5. Settings page (gateway policy, rate limits — read/write for super_admin).
6. Dashboard overview with real Firestore-backed counts (replace static mocks).
7. Admin audit log improvements (filter by actor, action, target type).

---

## Phase 13 — Admin Management Foundations

**Branch:** `claude/repo-audit-architecture-MiZDX`  
**Status:** Complete. TypeScript clean (dashboard + functions), Next.js build green (22 routes).

### Commits

1. `docs: add OfflineSMS phase 13 implementation plan`
2. `feat(dashboard): add admin data and redaction helpers`
3. `feat(dashboard): add shared admin table primitives`
4. `feat(dashboard): implement users list and detail views`
5. `feat(dashboard): implement organizations list and detail views`
6. `feat(dashboard): implement groups list and detail views`
7. `feat(dashboard): add communities foundation pages`
8. `docs: update phase log for phase 13`

### Files changed

**New files (21):**
- `docs/OFFLINESMS_PHASE_13_PLAN.md`
- `apps/dashboard/lib/redaction.ts`
- `apps/dashboard/lib/adminData.ts`
- `apps/dashboard/components/admin/DataTable.tsx`
- `apps/dashboard/components/admin/StatusBadge.tsx`
- `apps/dashboard/components/admin/MetadataList.tsx`
- `apps/dashboard/components/admin/DetailCard.tsx`
- `apps/dashboard/components/admin/FilterBar.tsx`
- `apps/dashboard/app/admin/users/[uid]/page.tsx`
- `apps/dashboard/app/admin/users/[uid]/UserStatusAction.tsx`
- `apps/dashboard/app/admin/organizations/page.tsx`
- `apps/dashboard/app/admin/organizations/[orgId]/page.tsx`
- `apps/dashboard/app/admin/groups/[conversationId]/page.tsx`
- `apps/dashboard/app/admin/groups/[conversationId]/GroupLockAction.tsx`
- `apps/dashboard/app/admin/communities/page.tsx`
- `apps/dashboard/app/admin/communities/[communityId]/page.tsx`
- `functions/src/admin/setUserStatus.ts`

**Updated files (6):**
- `apps/dashboard/lib/adminPermissions.ts` — add view:organizations, manage:users, manage:groups, view:communities
- `apps/dashboard/lib/adminNav.ts` — add Organizations, Communities nav items
- `apps/dashboard/app/admin/users/page.tsx` — replace client component with server component
- `apps/dashboard/app/admin/groups/page.tsx` — replace EmptyState placeholder with server list
- `functions/src/index.ts` — export setUserStatus

### What was done

- **`lib/redaction.ts` (new).** `maskPhone()`, `maskEmail(role?)`, `safeDate()`,
  `safeUserSummary()`. Phone always masked (`+••• 1234`). Email shown in full only to
  `super_admin`, `legacy_admin`, `bootstrap_admin`, `support_agent`.
- **`lib/adminData.ts` (new).** 15 server-side Admin SDK helpers covering all four
  modules. All functions paginate at 50 docs max. All timestamps converted via `safeDate()`.
  Raw phone/email returned for callers to redact. Never reads message bodies.
- **`lib/adminPermissions.ts` (updated).** Three new capabilities:
  `view:organizations`, `manage:users` (super_admin only), `manage:groups` (super_admin
  only), `view:communities`.
- **`components/admin/` (5 new).** `DataTable`, `StatusBadge`, `MetadataList`,
  `DetailCard`, `FilterBar` — shared primitives used across all module pages.
- **Users module.**
  - `users/page.tsx` replaced (was insecure client-side Firestore read) with server
    component using Admin SDK; phones always masked; emails role-gated.
  - `users/[uid]/page.tsx` — profile, wallet balance (balance + reserved only, no
    full transaction list), group memberships, recent audit (action + timestamp + result).
  - `UserStatusAction.tsx` — client-side suspend/reactivate via `setUserStatus` callable;
    only rendered for `manage:users` roles; confirmation dialog required.
  - `setUserStatus` callable — prevents self-suspension, super_admin suspension;
    validates transitions; audit-logs every attempt.
- **Organizations module.** Read-only list + tabbed detail (overview / users / groups /
  settings). Write action button shows "deferred to a later phase" notice. Settings
  shows boolean flags only (no secrets).
- **Groups module.**
  - `groups/page.tsx` replaced with server list using Admin SDK.
  - `groups/[conversationId]/page.tsx` — tabbed: overview, members (200 max, no message
    bodies), settings (locked flag, description only), SMS batch count summary.
  - `GroupLockAction.tsx` — calls existing `lockGroup` callable; guarded by
    `manage:groups`; confirmation dialog; error message explains membership requirement.
- **Communities module.** Scaffold pages. Empty state if collection absent (error caught
  gracefully so missing collection does not 500). Detail page documents deferred full
  feature.

### Security posture

- Every page re-verifies session via `verifySession()` (Phase 1 guard stays first).
- Every page checks `canDo(role, capability)` server-side before any Firestore read.
- No private message content, SMS bodies, full phone numbers, or payment secrets exposed.
- `setUserStatus` prevents privilege escalation via self-suspend and super_admin suspend.
- Audit log written for all status change attempts (success and failure).

### Known limitations

- `getUserGroupMemberships` queries `participantUids` array; groups with >1000
  members that don't carry this field will be missed.
- `listOrgMembers` reads `organizations/{id}/members` sub-collection; if membership
  was never written there (early orgs), it returns empty.
- `GroupLockAction` calls the existing `lockGroup` callable which requires the
  admin to be a member of the group. Dashboard admins who are not group members
  will see an error. A dedicated admin lock action is recommended for Phase 14.
- Communities are scaffolded; no actual community data model exists yet.

### Recommended Phase 14 scope

1. Admin-native `adminLockGroup` callable (no membership requirement).
2. Organizations create/edit via server action (data model + rules already exist).
3. Admin SMS gateway dashboard (batch list, status summary, no message bodies).
4. Admin points/wallet overview (per-user balance list, no transaction edit).
5. Admin roles page (assign/revoke admin roles, uses setAdminClaim).
6. Server action / API route for real-time refreshes (replace router.refresh pattern).

---

## Phase 12 — Admin Dashboard Foundation

**Branch:** `claude/repo-audit-architecture-MiZDX`  
**Status:** Complete. TypeScript clean, Next.js build green (17 static + dynamic routes).

### What was done

- **`lib/adminPermissions.ts` (new).** Capability map (`AdminCapability` union) with `getCapabilities(role)` and `canDo(role, capability)` helpers. 11 capabilities across 7 role keys. UX-only — security remains in server-side `verifySession`.
- **`lib/adminNav.ts` (new).** Central nav config (`NAV_ITEMS`) mapping each route to a `LucideIcon` and a required `AdminCapability`. Single source of truth for both sidebar and any future breadcrumb resolution.
- **`components/Sidebar.tsx` (updated).** Now accepts a `role` prop from the server layout. Filters `NAV_ITEMS` via `canDo()` so lower-privilege roles see only relevant routes. Role badge (`RoleBadge`) and sign-out rendered at bottom below a divider.
- **`components/RoleBadge.tsx` (new).** Inline pill showing friendly role label with per-role colour (red = super_admin, blue = org_admin, green = support, yellow = finance, purple = auditor, orange = bootstrap).
- **`components/AdminBreadcrumbs.tsx` (new, client).** Derives breadcrumb trail from `usePathname()` using `SEGMENT_LABEL` map. Renders nothing on the root `/admin` route.
- **`components/AdminUserMenu.tsx` (new, client).** Avatar dropdown: shows email + role badge, click-outside to close, sign-out flow (DELETE /api/session → Firebase signOut → push /login).
- **`components/AdminGlobalSearchShell.tsx` (new, client).** ⌘K / Ctrl+K opens a modal stub; Escape closes. Real search deferred to a future phase; placeholder says so explicitly.
- **`components/AdminTopbar.tsx` (new).** Server-passthrough layout bar: `AdminBreadcrumbs` + `AdminGlobalSearchShell` + bell icon (static) + `AdminUserMenu`. Sticky top-0, z-30.
- **`app/admin/layout.tsx` (updated).** Extracts `{ user, role }` from the authorized session and passes `role` to `<Sidebar>` and both `email` + `role` to `<AdminTopbar>`. Layout now: sidebar | flex-col(topbar + main).
- **`app/admin/audit/page.tsx` (new, server component).** Read-only audit log skeleton:
  - Re-verifies session + checks `canDo(role, 'view:audit')` server-side; renders `PermissionState` if lacking.
  - Reads up to 50 `auditLogs` docs via `adminDb`, descending `createdAt`.
  - Cursor-based pagination via `?cursor=<docId>`.
  - Table columns: timestamp, actor email, action, resource type + truncated ID, severity pill, payload field count.
  - Raw `payload` object is never rendered — only its key count.

### Security posture maintained

- No admin module content pages were added (users, groups, orgs, etc.)
- No private message content or full phone numbers are exposed
- Audit log shows only metadata; payload fields are counted, not displayed
- `canDo()` check in audit page is additive — `verifySession()` Phase 1 guard still runs first

---

## Phase 11 — SMS delivery reports, retry failed, stuck-batch reaper

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Dropped the legacy `type: 'sms'` transaction row.** `onSmsBatchAccepted` now emits only the canonical lifecycle (`reservation_release`, `sms_spend`, `refund`). The Phase 9 `canonicaliseType` mapping still parses pre-Phase-11 docs for back-compat.
- **`gatewayWebhook` HTTP function (new).** HMAC-verified, idempotent, transactionally consistent:
  - Headers: `x-offlinesms-timestamp` (5-min replay window) + `x-offlinesms-signature` (`sha256=<hex>` over `${timestamp}.${rawBody}`).
  - `smsDeliveryEvents/{eventId}` is the dedupe table — doc id IS the event id.
  - Monotonic status transitions (`queued < sent < delivered`; terminal `failed` / `undelivered` may overwrite earlier non-terminal states).
  - Maintains `queuedCount` / `sentCount` / `deliveredCount` / `failedCount` on the batch in the same Firestore transaction as the recipient update.
  - When every recipient is terminal, flips batch status to `completed` / `partial` / `failed`.
  - Phone numbers, SMS body, message body are never logged. Provider error messages are sanitised + length-clamped at 200 chars.
- **Cross-batch dedupe.** `findAlreadySentUids(db, senderUid, messageId)` (new helper) returns the set of recipients with `smsStatus ∈ { queued, sent, delivered }` across any prior batch. `classifyRecipients` excludes them with `skipReason: 'already-sent-for-message'`. Used by `escalateSms`, `previewSmsEscalation`, and `retryFailedSmsRecipients`.
- **`retryFailedSmsRecipients` hardened.** Adds the cross-batch dedupe (so a recipient who succeeded via a separate batch in between isn't re-spammed), stamps `attemptNumber = source + 1` on the retry batch, and renames the audit lineage to `sms.retry.created` (success) + `sms.retry.failed` (gateway-error).
- **`reapStuckBatches` (scheduled, opt-in).** Code-only — not exported from `functions/src/index.ts`. When activated, runs every 30 min and flips batches in `sending` / `accepted` older than 15 minutes to `completed` / `partial` / `failed` per the recipient roster, releases the unspent reservation, and emits canonical `reservation_release` + `sms_spend` (+ `refund`) rows with `note: 'reaper'`. Idempotent on `pointsRefunded`.
- **Mobile UI.**
  - `SmsBatchReport.tsx` (new) — dedicated OfflineSMS Delivery Report with summary cards, batch metadata, recipient rows with status pills, filter chips, and a Retry-failed action.
  - `TransactionDetail` deep-links into `SmsBatchReport`.
  - `SmsEscalation` result step gains a "View OfflineSMS Delivery Report" primary button.
  - `MessageInfo` shows an "OfflineSMS reminders" card pointing at the most recent batch for the (message, sender) pair, backed by the new `smsBatches(senderId, messageId, createdAt)` composite index.
- **i18n.** New `smsReport.*` namespace in `en.json` + `ar.json`.

### Files created

- `docs/OFFLINESMS_PHASE_11_PLAN.md`
- `functions/src/sms/gatewayWebhook.ts`
- `functions/src/sms/reapStuckBatches.ts`
- `apps/mobile/src/screens/SmsBatchReport.tsx`

### Files edited

- `functions/src/sms/onSmsBatchAccepted.ts`
- `functions/src/sms/recipients.ts`
- `functions/src/sms/escalate.ts`
- `functions/src/sms/previewEscalation.ts`
- `functions/src/sms/retryFailed.ts`
- `functions/src/index.ts`
- `apps/mobile/src/screens/{TransactionDetail,SmsEscalation,MessageInfo}.tsx`
- `apps/mobile/App.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `firestore.rules`
- `firestore.indexes.json`
- Docs: data model, phase log (this file), technical architecture, risk register, design map.

### Commits

| Hash | Message |
|---|---|
| `e6460ce` | docs: add OfflineSMS phase 11 implementation plan |
| `695e0f4` | feat(data): formalize SMS delivery event and report contracts |
| `6a10db2` | security: lock delivery event and SMS report writes |
| `dba290e` | feat(functions): drop legacy SMS transaction row |
| `ac6b766` | feat(functions): add OfflineSMS delivery webhook ingestion |
| `0c77e7e` | feat(functions): add cross-batch dedupe and hardened retry |
| `3f7fe77` | feat(functions): add stuck SMS batch reaper |
| `b0dbbe9` | feat(mobile): add SMS batch report screen |
| `711d6de` | feat(mobile): link delivery reports from transactions, escalation, info |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests** for the webhook / dedupe / reaper. Manual emulator checklist documented in the Phase 11 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **Real provider integration is deployment-time.** `gatewayWebhook` ships ready (HMAC fully implemented). The mock `gateway.sendBatch` doesn't deliver real SMS, so there's no production traffic to ingest yet. Provider integration is a one-file change to `functions/src/sms/gateway.ts` plus pointing the provider at the webhook URL and setting `OFFLINESMS_WEBHOOK_SECRET`.
- **`reapStuckBatches` not registered as a schedule.** Code is in place; operators flip it on by adding the export to `functions/src/index.ts`. Same opt-in pattern as Phase 6's `sweepExpiredMessages`.
- **`MessageInfo` latest-batch link** shows only the most recent batch for a (sender, message) pair. A full multi-batch list with retry lineage is a Phase 18 enhancement.
- **Cross-batch dedupe scans prior batches.** Bounded by daily-cap (20 batches per uid per day); worst case is ≤ 20 recipient-sub-collection reads per escalation. Phase 20 perf pass can replace this with a hash-set on the message doc if it becomes a hotspot.
- **Aggregate counts on the batch** are only maintained by the Phase 11 webhook (not back-filled by `escalateSms`). A batch with no DLR events reads `0` for the new fields until the first event arrives; the `SmsBatchReport` falls back to live recipient sub-collection counts so the UI is always correct.

### Recommended Phase 12 scope

Phase 12 = **Admin dashboard foundation** (per the roadmap):

1. RBAC-aware sidebar in `apps/dashboard/components/Sidebar.tsx` — hide menu items the role can't access. Today every `/admin/*` route is gated by the Phase 1 admin guard; per-route capability checks land here.
2. `app/admin/layout.tsx` — add a user menu + breadcrumb shell.
3. Server-side global search bar shell (no implementation yet — Phase 17 wires it).
4. `app/admin/audit/page.tsx` skeleton listing `auditLogs/{id}` rows with redacted metadata. Read-only.
5. No new product features in this phase.

Defer: dashboard chat / SMS / points modules (Phases 13–17).

---

## Phase 10 — Points purchase and transfer flows

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Closed the free-points exploit.** The Phase 0 `buyPoints` callable that credited the wallet directly is **deleted**. The new flow is two-step:
  - `createPurchase({ packageId })` creates `payments/{id}` with `status: 'pending'`, a server-generated `idempotencyKey`, and `totalPoints` / `amount` / `currency`. **Never credits.**
  - `confirmPayment({ paymentId, idempotencyKey, status, signature })` requires `PAYMENT_WEBHOOK_SECRET` (constant-time `crypto.timingSafeEqual`), is idempotent on the doc's `idempotencyKey`, and on `'completed'` credits the wallet + writes a canonical `purchase` transaction in a single Firestore transaction.
  - `confirmPaymentMock({ paymentId, status })` reuses the same internal credit path but **refuses unless `process.env.FUNCTIONS_EMULATOR === 'true'`**. Production deploys return `permission-denied`.
- **Hardened the transfer flow.** `transferPoints` (`functions/src/points/transferPoints.ts`, replaces the Phase 0 `transfer.ts`) now enforces self-transfer / frozen-wallet / closed-wallet / daily caps (`DAILY_TRANSFER_CAP_COUNT = 20`, `DAILY_TRANSFER_CAP_POINTS = 5000`), insufficient-balance against `balance - reserved`, and writes:
  - `pointsTransfers/{id}` authoritative transfer record (status, idempotencyKey, flagged).
  - Canonical `transfer_out` / `transfer_in` transactions on both sides with `relatedTransferId` and `relatedUserId`.
  - `transferQuotaUsage/{uid}/days/{yyyymmdd}` increment.
  - `flags/{id}` when `amount >= FRAUD_FLAG_THRESHOLD_POINTS = 2000`.
- **Canonical transaction lifecycle.** `onSmsBatchAccepted` now emits `reservation_release` (credit) + `sms_spend` (debit) + `refund` (credit when applicable) **alongside** the legacy `type: 'sms'` row so older clients still parse during the migration window. `escalateSms` emits a `reservation` (debit) transaction when reserving. The Phase 9 mobile lib's `canonicaliseType` already accepts both legacy and canonical strings.
- **Data model.** Added `pointsPackages/{id}`, `pointsTransfers/{id}`, `transferQuotaUsage/{uid}/days/{yyyymmdd}`. `wallets/{uid}` gains optional `status` ('active' | 'frozen' | 'closed'; missing == 'active'). `transactions` carry `relatedPaymentId` and `relatedTransferId`.
- **Rules.** Added `pointsPackages` (signed-in read, admin write), `pointsTransfers` (sender/recipient/admin read; `allow write: if false`), `transferQuotaUsage/{uid}/days/{yyyymmdd}` (owner-read, server-only write). No previous rule loosened.
- **Indexes.** `pointsTransfers(fromUserId, createdAt DESC)` and `pointsTransfers(toUserId, createdAt DESC)` added.
- **Mobile UI.**
  - `apps/mobile/src/lib/points.ts` extended with `subscribePackages`, `subscribePayment`, `createPurchase`, `confirmPaymentMock`, `transferPoints`, and `pointsErrorCopy` / `pointsErrorReason` helpers.
  - `BuyPoints.tsx` — package picker → pending → success/failure. Emulator-only "Confirm payment (dev)" + "Simulate failure (dev)" buttons drive the mock callable. No provider names in copy.
  - `TransferPoints.tsx` — recipient search → amount → confirm → result. Available balance uses `balance - reserved`. Result step surfaces the fraud-flag advisory when the callable returns `flagged: true`.
  - `Points.tsx` flips `BUY_ENABLED = true` and `TRANSFER_ENABLED = true`, wires the buttons.
  - `TransactionDetail.tsx` renders `Payment` and `Transfer` cards keyed off the new `relatedPaymentId` / `relatedTransferId` fields.
- **No third-party provider names** anywhere in user-visible copy, audit logs, or transaction data.

### Files created

- `docs/OFFLINESMS_PHASE_10_PLAN.md`
- `functions/src/points/createPurchase.ts`
- `functions/src/points/confirmPayment.ts`
- `functions/src/points/confirmPaymentMock.ts`
- `functions/src/points/transferPoints.ts`
- `apps/mobile/src/screens/BuyPoints.tsx`
- `apps/mobile/src/screens/TransferPoints.tsx`

### Files deleted

- `functions/src/points/buy.ts` (Phase 0 unsafe direct-credit callable)
- `functions/src/points/transfer.ts` (Phase 0 transfer without caps / fraud flag)

### Files edited

- `functions/src/sms/escalate.ts` (emit `reservation`)
- `functions/src/sms/onSmsBatchAccepted.ts` (emit canonical lifecycle)
- `functions/src/index.ts` (exports)
- `apps/mobile/src/lib/points.ts`
- `apps/mobile/src/screens/{Points,TransactionDetail}.tsx`
- `apps/mobile/App.tsx`
- `firestore.rules`
- `firestore.indexes.json`
- Docs: data model, phase log (this file), technical architecture, risk register, design map.

### Commits

| Hash | Message |
|---|---|
| `7430f6c` | docs: add OfflineSMS phase 10 implementation plan |
| `706154b` | feat(data): add points packages, payments, and transfer contracts |
| `2404dab` | security: harden points purchase and transfer rules |
| `6bd182f` | feat(functions): add webhook-driven points purchase flow |
| `1a19de5` | feat(functions): add points transfer flow with quota and fraud flags |
| `62c0808` | feat(functions): canonicalize points transaction lifecycle |
| `6cd8ab6` | feat(mobile): add buy points flow |
| `97c3d78` | feat(mobile): add transfer points flow |
| `dcf2351` | feat(mobile): enable wallet actions and link payments/transfers in detail |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No real payment provider integrated.** `confirmPayment` is the production webhook stand-in (requires `PAYMENT_WEBHOOK_SECRET`). `confirmPaymentMock` is the emulator-only dev path. Integrating a real provider is a deployment-time concern; only `confirmPayment` will be invoked, and only by the webhook handler (which can be a Cloud Functions HTTP function added when the provider lands).
- **`pointsPackages` collection is empty until seeded.** Phase 15 will add an admin UI; for now `npm run seed` can be extended (it isn't in Phase 10).
- **Phase 0's `'sms'` legacy transaction row is still emitted** alongside the canonical `reservation_release` / `sms_spend` / `refund` rows. Phase 11 drops it.
- **Reservation event is per-batch** (not per-recipient). For multi-recipient SMS batches the wallet UI shows a single reservation row for the total cost.
- **Daily caps are UTC-day** and not user-tz-aware. Acceptable for Phase 10; localisation is a Phase 19 concern.
- **No admin freeze / unfreeze callable.** `wallets.{status}` is honoured by `transferPoints`, but only an Admin SDK script can set it. Phase 15.
- **Fraud-flag emission is single-transaction-based.** A user repeatedly transferring just under the threshold won't trigger. A rate-window check is a Phase 18 add-on.
- **No "Load more" pagination** on the wallet history yet — the Phase 9 25-row default remains. Phase 18 will revisit alongside the audit log explorer.

### Recommended Phase 11 scope

Phase 11 = **SMS delivery reports and retry failed SMS** (per the roadmap):

1. Drop the legacy `type: 'sms'` row from `onSmsBatchAccepted` now that Phase 10 emits the canonical lifecycle.
2. `gatewayWebhook` HTTP function that ingests provider DLRs (Delivery Receipts), HMAC-verified, and updates per-recipient `smsStatus` + `deliveredAt`/`failedAt`.
3. `SmsBatchReport.tsx` standalone screen (currently the Phase 8 result step is reachable only mid-flow); deep-link from `TransactionDetail` for `sms_spend` rows lands here.
4. Reaper: a scheduled function that flags `smsBatches` stuck in `sending` for more than 15 minutes and releases their reservation (Risk #5).
5. Cross-batch dedupe for `already-sent-for-message` skipReason (currently unused by Phase 8).

Defer: media messages, calls, dashboard moderation, admin wallet operations.

---

## Phase 9 — OfflineSMS Points Wallet (read-only foundation)

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Data model formalised.** Documented the read shape for `wallets/{uid}` (balance + reserved + computed available) and `transactions/{transactionId}` (type, direction, amount, status, related batch / message / conversation / user, refund / sent / failed / priceCents settlement fields). Phase 0 backend writers are unchanged in Phase 9.
- **Canonical transaction-type mapping.** Phase 0 wrote `'sms' / 'buy' / 'transfer-in' / 'transfer-out' / 'refund' / 'admin-adjust'`. The mobile lib canonicalises these (plus the new Phase 9 names) to a single union: `sms_spend | reservation | reservation_release | refund | purchase | transfer_in | transfer_out | admin_adjustment | other`. UI never branches on legacy values.
- **New index.** `transactions(userId ASC, type ASC, createdAt DESC)` — feeds the type filter chip on the wallet screen when the canonical maps to a single legacy value (e.g. `reservation`, `refund`). For multi-value mappings the lib falls back to a client-side filter over the unfiltered stream.
- **Rule change (narrow).** `smsOptOut` added to the `users.update` allow-list so the Settings toggle can persist it. Phase 8's `escalateSms` already honours the flag with `skipReason: 'opt-out'`. All other Phase 2 protections (`role`, `admin`, `wallet`, `points`, `permissions`, …) stay banned.
- **Mobile lib.**
  - `apps/mobile/src/lib/points.ts` — `subscribeWallet`, `subscribeTransactions`, `getTransaction`, plus `canonicaliseType`, `getTransactionLabel`, `getTransactionIcon`, `formatPointsAmount`.
  - `apps/mobile/src/lib/user.ts` — `subscribeMe(uid)`, `setSmsOptOut(uid, value)`.
- **Mobile UI.**
  - `Points.tsx` rewritten: balance card (Balance / Reserved / Available with explanation), disabled "Buy points" + "Transfer" (`Coming soon`, gated by `BUY_ENABLED` / `TRANSFER_ENABLED` constants — Phase 10 flips them), help card, filter chips (All / SMS / Refunds / Purchases / Transfers / Admin), transaction list.
  - `TransactionDetail.tsx` (new): hero with status pill + signed amount, details card, SMS settlement card when present, purchase card with package + price, counterparty card, "OfflineSMS Delivery Report" deep-link for `sms_spend` transactions with a related batch.
  - `Settings.tsx`: top "OfflineSMS Points" row with the live `{balance} pts · {reserved} reserved` subtitle; "Allow important SMS reminders" toggle wired to `users/{uid}.smsOptOut`; existing Privacy / Linked devices / Sign out rows retained.
  - `SmsEscalation.tsx` confirm step now shows two rows of stats: `Recipients / Cost` and `Balance / Reserved / Available / Remaining` so the wallet semantics match the Points screen.
- **i18n.** Phase 9 cleaned up the duplicate Phase 0 `sms` + `points` namespaces (they weren't referenced anywhere) and added the `points.*` namespace with `txType.*` and `txStatus.*` dictionaries. `en` and `ar` both updated.
- **No backend changes** in `functions/`. Phase 10 will migrate writers to canonical type names alongside payment integration.

### Files created

- `docs/OFFLINESMS_PHASE_9_PLAN.md`
- `apps/mobile/src/lib/points.ts`
- `apps/mobile/src/lib/user.ts`
- `apps/mobile/src/screens/TransactionDetail.tsx`

### Files edited

- `apps/mobile/src/screens/Points.tsx`
- `apps/mobile/src/screens/Settings.tsx`
- `apps/mobile/src/screens/SmsEscalation.tsx`
- `apps/mobile/App.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `firestore.rules`
- `firestore.indexes.json`
- `docs/OFFLINESMS_{DATA_MODEL,PHASE_LOG,TECHNICAL_ARCHITECTURE,RISK_REGISTER,DESIGN_IMPLEMENTATION_MAP}.md`

### Commits

| Hash | Message |
|---|---|
| `57aaa1a` | docs: add OfflineSMS phase 9 implementation plan |
| `2c762c2` | feat(data): formalize wallet and transaction read models |
| `72c946d` | security: allow user-controlled smsOptOut profile field |
| `f118368` | feat(mobile): add points wallet and transaction history lib |
| `cc08e5d` | feat(mobile): rewrite OfflineSMS Points wallet screen |
| `712e157` | feat(mobile): add transaction detail screen and settings entries |
| `d28599e` | feat(mobile): show reserved and available balance in SMS confirm |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No pagination** — the wallet list is capped at 25 most-recent transactions. "Load more" / infinite scroll lands when Phase 10 introduces purchase flows that grow history quickly.
- **No `reservation` / `reservation_release` writers exist yet** — Phase 0's escalation path does `balance -= cost; reserved += cost` inside a single transaction and `onSmsBatchAccepted` settles via the same wallet doc + a `type: 'sms'` transaction. The Phase 9 lib already recognises the canonical types, so a Phase 10/11 backend can emit dedicated `reservation` / `reservation_release` rows without UI changes.
- **`smsOptOut` is the only user-controlled preference today.** A full notifications-settings screen is Phase 19.
- **No "Buy points" / "Transfer" landing** — both are disabled with `Coming soon`. Phase 10.
- **Transaction filter for canonical types that map to multiple legacy values** (sms_spend, purchase, transfer_in, transfer_out, admin_adjustment) uses a client-side filter over the unfiltered stream rather than an `in` query. Acceptable at the 25-row default; Phase 20 can switch to a server-side `in` query once `MAX_OR_GROUP_SIZE` budgets are formalised.
- **TransactionDetail's delivery-report link** routes into `SmsEscalation` with the related conversation/message context, where the Phase 8 result step renders the report. A dedicated `BatchReport` screen is a possible refactor in a later phase.

### Recommended Phase 10 scope

Phase 10 = **Points purchase and transfer flows** (per the roadmap):

1. `BuyPoints.tsx` package picker; replace the Phase 0 synchronous `buyPoints` callable with a **webhook-driven** flow that writes `payments/{id}` idempotently and only credits the wallet when the provider event arrives. Close the free-points exploit (Risk #16 in the register).
2. `TransferPoints.tsx` flow with daily transfer cap and fraud-flag emitter.
3. Switch backend writers to canonical transaction-type names (`sms_spend`, `purchase`, `transfer_in/out`, `admin_adjustment`) and emit `reservation` / `reservation_release` rows so the Phase 9 wallet UI shows the full lifecycle.
4. Flip `BUY_ENABLED` / `TRANSFER_ENABLED` in `apps/mobile/src/screens/Points.tsx`.
5. Audit every payment + transfer.

Defer: media messages, calls, dashboard moderation.

---

## Phase 8 — OfflineSMS SMS escalation

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Backend hardening (`escalateSms`).** Rewrites the Phase 0 callable to:
  - Accept canonical `'everyone' | 'unread_only' | 'undelivered_only'` plus legacy `'unread' / 'undelivered'`.
  - Resolve recipients from Phase 7 receipts (not just the sender check).
  - Classify candidates into eligible + excluded with a structured `skipReason` (`no-phone`, `unverified-phone`, `opt-out`, `duplicate-phone`, `already-sent-for-message`, `rate-limited`, `policy-blocked`).
  - Enforce `MAX_BATCHES_PER_DAY = 20`, `MAX_RECIPIENTS_PER_BATCH = 200`, and a `COOLDOWN_MS = 60_000` per `(messageId, senderUid)` pair.
  - Persist usage to `smsQuotaUsage/{uid}/days/{yyyymmdd}` (Phase 3 collection — writer wired here).
  - Audit every state transition (`sms.escalation.created`, `…accepted`, `…partial`, `…failed`) with counts-only metadata. Never the SMS body, never the message body, never full phones.
  - Allow group owners/admins to escalate other members' messages (Phase 0 was sender-only).
- **Two new callables.**
  - `previewSmsEscalation` — read-only mirror of `escalateSms`'s audience + eligibility logic. Returns masked phones + wallet snapshot + cost + cap status. Mutates nothing.
  - `retryFailedSmsRecipients` — re-dispatches only the failed recipients of a prior batch. Creates a new batch with `retryOfBatchId` for audit lineage; bypasses the conversation cooldown (it's a targeted recovery), still respects the daily cap.
- **Shared helpers in `functions/src/sms/recipients.ts`** — `canonicalAudience`, `filterByAudience`, `classifyRecipients`, `maskPhone`, `todayKey`, plus the cap + cost constants.
- **`onSmsBatchAccepted` extended** to stamp `pointsDeducted` and `pointsRefunded` onto the batch doc so the OfflineSMS Delivery Report can show final settlement.
- **Mobile UI.**
  - `apps/mobile/src/lib/sms.ts` wraps the three callables, provides `smsErrorCopy`/`smsErrorReason`/`smsSkipReasonCopy`, and `buildDefaultSmsBody(conversationName, messageText)` for the SMS preview.
  - `apps/mobile/src/screens/SmsEscalation.tsx` replaces the Phase 1 EmptyState placeholder with a single screen that walks through five steps (audience → recipients → text → confirm → result), with a top stepper. The OfflineSMS Delivery Report at the end shows Sent / Failed / Skipped / Points cost + the OfflineSMS batch ID; "Retry failed" is offered when `result.failed > 0`.
  - `MessageInfo` shows a "Send via OfflineSMS" CTA when there are unread / pending / failed recipients on the sender's own message.
  - `MessageBubble` adds a "Send via OfflineSMS" entry to the long-press action sheet for the sender's own messages.
- **Branding policy.** Only OfflineSMS / OfflineSMS SMS Gateway / OfflineSMS Points / OfflineSMS Delivery Report / OfflineSMS batch in user-visible copy and audit metadata. The provider boundary stays exactly where Phase 0 put it — `functions/src/sms/gateway.ts`.
- **No rule changes.** The Phase 0 + Phase 3 rules already lock `smsBatches`, `smsBatches/{b}/recipients`, and `smsQuotaUsage` to server-only writes. Phase 8 confirms and documents this.
- **i18n.** New `sms.*` namespace in `en.json` + `ar.json`.

### Files created

- `docs/OFFLINESMS_PHASE_8_PLAN.md`
- `functions/src/sms/previewEscalation.ts`
- `functions/src/sms/retryFailed.ts`
- `functions/src/sms/recipients.ts`
- `apps/mobile/src/lib/sms.ts`

### Files edited

- `functions/src/sms/escalate.ts`
- `functions/src/sms/onSmsBatchAccepted.ts`
- `functions/src/index.ts`
- `apps/mobile/src/screens/SmsEscalation.tsx` (replaced placeholder)
- `apps/mobile/src/screens/MessageInfo.tsx`
- `apps/mobile/src/screens/Conversation.tsx`
- `apps/mobile/src/components/MessageBubble.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_{DATA_MODEL,PHASE_LOG,TECHNICAL_ARCHITECTURE,RISK_REGISTER,DESIGN_IMPLEMENTATION_MAP}.md`

### Commits

| Hash | Message |
|---|---|
| `eafe368` | docs: add OfflineSMS phase 8 implementation plan |
| `be453a1` | feat(data): add SMS escalation batch and quota contracts |
| `90e9a59` | feat(functions): harden OfflineSMS escalation with caps, cooldown, quota |
| `e3c0c98` | feat(mobile): add SMS escalation audience and recipient preview |
| `3009bad` | feat(mobile): wire Send via OfflineSMS entry points |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests** for the new callables / rules / UI. Manual emulator checklist in the Phase 8 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **`phoneVerified` is treated as truthy-by-default.** The current onboarding flow doesn't explicitly set the flag; the eligibility check only excludes when `phoneVerified === false`. Once Phase 2's onboarding owns the flag, the check tightens to `=== true`.
- **`smsOptOut` field has no UI to set it.** The escalation correctly respects an opt-out, but there's no settings screen yet (Phase 19).
- **`'already-sent-for-message'` skip reason isn't yet detected.** The skip-reason enum supports it for the future cross-batch dedupe, but Phase 8 doesn't yet scan prior batches to flag previously-SMSed recipients.
- **Mock gateway only.** `functions/src/sms/gateway.ts` is still the 90/10 mock; a real provider integration is a deployment-time concern that goes through the same typed interface.
- **No "Buy points" affordance lands a real flow.** Phase 10 wires the purchase flow; for now the confirm step disables when balance is insufficient.
- **`retryFailedSmsRecipients` doesn't deduplicate against the original batch's failures** if a separate manual escalation has been sent in between. Acceptable for Phase 8; tightens in Phase 11.

### Recommended Phase 9 scope

Phase 9 = **OfflineSMS Points Wallet** (per the roadmap):

1. `Points.tsx` history listing — live `transactions where userId == uid order by createdAt desc`, paginated.
2. `TransactionDetail.tsx` screen showing per-transaction breakdown (type, amount, related batch / peer / package).
3. Reservation badge — surface the existing `wallets/{uid}.reserved` in the header card so users see "Reserved for in-flight SMS" without having to dig.
4. Settings link for `smsOptOut` on the caller's own user doc.
5. No payment flow yet (Phase 10).
6. No admin wallet operations (Phase 15).

---

## Phase 7 — Delivery receipts, read receipts, message views

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Receipt schema fully populated.** `conversations/{c}/messages/{m}/receipts/{uid}` now carries `status` + `deliveredAt`/`readAt`/`viewedAt`/`playedAt`/`failedAt`/`failureReason`/`createdAt`/`updatedAt`. Doc id is always the recipient uid, pinned at the rules layer.
- **Aggregate counts denormalised onto messages.** `messages` gains `deliveredCount`, `readCount`, `viewedCount`, `playedCount`, `failedCount`, `pendingCount`, `receiptUpdatedAt` — all server-owned (Phase 6 already locked `messages.update` to admin-only at the rules layer).
- **Three new functions:**
  - `markReceipt` callable — monotonic-or-failed transition guard (`pending → delivered → read/viewed/played`, `* → failed`), server-side, with self-receipts silently no-op'd. Backfills `deliveredAt` when a fresh `read` arrives without prior delivery. Wrapped in a Firestore transaction so concurrent clients can't race past the guard. Not audited (too noisy).
  - `onReceiptWrite` trigger — recomputes the message-level aggregate counts on every receipt change by scanning the receipts sub-collection. Correct, simple, fine at the Phase 5 group cap of 256.
  - `markStatusViewed` callable — records `statuses/{statusId}/views/{viewerUid}` after re-running Phase 3's audience + expiry rules server-side. Doc id = viewer uid → duplicates are impossible by construction. Self-views silently no-op.
- **`getMessageInfo` extended.** When the caller is the message sender (or an admin), the response now includes a per-recipient receipt list (uid, displayName snapshot, role, status, per-status timestamps, failureReason). Non-senders still see the aggregates and the client surfaces a `PermissionState`.
- **Receipt rules tightened (Phase 7).** Receipt reads narrowed to **the receipt owner, the message sender, or an admin** — the Phase 4 "any participant" read is closed, so group members can no longer enumerate each other's read status. Writes keep the Phase 3 owner-allowed path with the enum guard; canonical writes still flow through `markReceipt`.
- **Status-view rules.** New sub-collection `statuses/{statusId}/views/{viewerUid}`: read by owner / viewer / admin; writes server-only.
- **Mobile UI.**
  - `MessageBubble` gains a `ReceiptIndicator` for the caller's own messages: `✓ / ✓✓ / ✓✓` (blue) for sent/delivered/read in direct chats; compact `✓ N · 👁 M` counts in groups.
  - `Conversation` calls `markReceipt(messageId, 'delivered')` and `'read'` for every visible non-self message on each `subscribeMessages` batch. The lib dedupes `(messageId, status)` pairs in-memory and debounces by 300 ms so a fast scroll doesn't blast the callable.
  - `MessageInfo` rewrites the layout: stats grid (Delivered / Read / Pending / Failed) + a tabbed per-recipient list for senders; for non-senders the same grid + a `PermissionState` explaining why detail is hidden.
- **Design choice — "viewed" folded into receipts.** Phase 7 deliberately reuses the receipts enum's `viewed` for text messages rather than introducing a parallel `messages/{m}/views/{uid}` sub-collection. The aggregation trigger stays uniform; the dedicated view collection is reserved for media-specific events when media support lands.
- **i18n.** New `receipts.*` namespace in `en.json` + `ar.json`.

### Files created

- `docs/OFFLINESMS_PHASE_7_PLAN.md`
- `functions/src/chats/markReceipt.ts`
- `functions/src/chats/onReceiptWrite.ts`
- `functions/src/statuses/markStatusViewed.ts`

### Files edited

- `firestore.rules`
- `functions/src/index.ts`
- `functions/src/chats/getMessageInfo.ts`
- `apps/mobile/src/lib/conversations.ts`
- `apps/mobile/src/components/MessageBubble.tsx`
- `apps/mobile/src/screens/Conversation.tsx`
- `apps/mobile/src/screens/MessageInfo.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_DATA_MODEL.md` and all phase-tracking docs

### Commits

| Hash | Message |
|---|---|
| `fcc667b` | docs: add OfflineSMS phase 7 implementation plan |
| `47c00b5` | feat(data): add receipt and status-view contracts |
| `69ab317` | security: add receipt and status-view rules |
| `9855261` | feat(functions): add markReceipt and receipt aggregation |
| `a8633ce` | feat(functions): extend message info with receipt details |
| `9eb8c31` | feat(functions): add status view tracking foundation |
| `930aa58` | feat(mobile): render receipt indicators and mark read/delivered |
| `61e231c` | feat(mobile): add full receipt details to message info |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests** yet. Manual emulator checklist in the Phase 7 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **`onReceiptWrite` recomputes by full scan.** Fine at the Phase 5 group cap of 256, but a Phase 20 perf pass may switch to `FieldValue.increment`-based counters with a daily reconciliation function (`reconcileReceiptCounts`) — code-only follow-up, no scheduling now.
- **Group-admin aggregate visibility is not implemented.** The Phase 7 rules only let the sender (or an admin) see per-recipient detail. Admins seeing read-rate-only without per-recipient timestamps is a clean Phase 18 feature.
- **No "Played" UI surface.** `playedCount` is wired through the trigger and aggregates but no client UI emits or renders it — voice messages land in a later phase.
- **No daily receipt reconciliation function.** Scheduling that safely needs emulator-tests first; queued for Phase 20.
- **No tick rendering on incoming messages.** Receipt indicators only show on the caller's own bubbles, by design.
- **Phase 4 receipt-read rule change is a real tightening.** Previously any participant could read receipts; now only owner/sender/admin can. Any future code path that reads receipts directly from a client other than the sender would have to be promoted to a callable. Today, no such path exists outside `getMessageInfo` (Admin SDK).

### Recommended Phase 8 scope

Phase 8 = **OfflineSMS SMS escalation (UI)** (per the roadmap):

1. Build `SmsEscalation.tsx` on top of the existing `escalateSms` callable. Audience picker (unread / undelivered / everyone — fed by Phase 7's receipt aggregates and per-recipient receipt list), masked-phone preview, cost preview against the wallet, confirmation, and a result screen with retry surface.
2. Add abuse controls to `escalateSms`: per-user-per-day batch cap, audience size cap, conversation cool-down. Persist to `smsQuotaUsage/{uid}/{yyyymmdd}` (Phase 3 collection already locked server-only).
3. Wire the existing `lib/sms.ts` placeholder on mobile so the conversation screen exposes an "Escalate to SMS" entry point gated by the receipt counts (only offered when there are unread/undelivered recipients).
4. Manual emulator pass: confirm points reservation → settle/refund flow lands the right `transactions` records (Phase 0 already wired the `onSmsBatchAccepted` trigger).
5. Audit every escalation. Brand all dispatch as OfflineSMS — no third-party provider names anywhere in copy / logs / telemetry.

Defer: media messages, communities, calls, dashboard moderation, payments. Points purchase + transfer come in Phase 10.

---

## Phase 6 — Message actions and message info

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Schema fills the Phase 4/5 placeholders + adds reactions, pinning, TTL.** `messages` now carries `editedAt`, `deletedForEveryone`/`deletedAt`/`deletedBy`/`deleteReason`, `replyTo`, `forwarded` + `forwardedFrom`, `reactions: { [emoji]: uid[] }`, `pinnedAt`/`pinnedBy`, and `expiresAt`. `sendTextMessage` now initialises every Phase 6 field explicitly so docs are uniform from creation.
- **Per-user message state** rides on the existing `conversations/{c}/userState/{uid}` doc — adds bounded `starredMessageIds[]` and `deletedForMeMessageIds[]` arrays (FIFO-capped at 500) — instead of a new collection, keeping listener cost flat.
- **Conversation-level pin** lives on `conversations/{c}.pinnedMessage` (single pinned message in Phase 6).
- **Seven new audited callables** (`functions/src/chats/`):
  - `editMessage` — sender-only, 15-minute edit window, refreshes `lastMessage` if applicable.
  - `deleteMessage` — `for_me` writes to the caller's userState array; `for_everyone` clears text + flips `deletedForEveryone` (sender always; group owner/admin may delete other members' messages, recorded as `byRole`).
  - `reactToMessage` — emoji allow-list, one emoji per user per message, **not** audited.
  - `starMessage` — owner-scoped, not audited.
  - `pinMessage` — direct: any participant; group: owner/admin only. Replaces previous pin.
  - `forwardMessages` — text-only, skips deleted, enforces source-read + per-target-send permission, caps at 10×10.
  - `getMessageInfo` — read-only metadata + reaction summary + receipt placeholder counts.
- **`sendTextMessage` extended** to accept an optional `replyTo` payload and persist it on the message doc.
- **Disappearing-message sweeper** code shipped at `functions/src/chats/sweepExpiredMessages.ts` but **deliberately not exported** from `functions/src/index.ts`, so `firebase deploy` won't register the cron job. Activation deferred to Phase 11.
- **Rules tightening.** `messages.update` and `messages.delete` are now admin-only at the rules layer; every legitimate mutation flows through a callable using the Admin SDK. Added two shape validators (`isValidReplyTo`, `isValidForwardedFrom`) for any future direct-create path.
- **Mobile UI.**
  - `MessageBubble` component (new) is the long-press surface: reply preview, forwarded label, edited/starred/pinned indicators, reaction chips, and a permission-gated action sheet via `Alert.alert`. Inline emoji picker for React.
  - `Conversation` rewritten: composer carries reply-preview / edit-mode banners; pinned-message banner above the list with tap-to-jump and × unpin (for direct chats or group admins); local `userState` drives starred + deletedForMe filtering.
  - `ForwardPicker` (new) — multi-select target list with peer name resolution.
  - `MessageInfo` (new) — read-only metadata + reaction summary + receipt placeholder breakdown with the Phase 7-deferral copy.
- **i18n.** New `messageActions.*` and `messageErrors.*` namespaces in `en.json` + `ar.json`.

### Files created

- `docs/OFFLINESMS_PHASE_6_PLAN.md`
- `apps/mobile/src/components/MessageBubble.tsx`
- `apps/mobile/src/screens/ForwardPicker.tsx`
- `apps/mobile/src/screens/MessageInfo.tsx`
- `functions/src/chats/editMessage.ts`
- `functions/src/chats/deleteMessage.ts`
- `functions/src/chats/reactToMessage.ts`
- `functions/src/chats/starMessage.ts`
- `functions/src/chats/pinMessage.ts`
- `functions/src/chats/forwardMessages.ts`
- `functions/src/chats/getMessageInfo.ts`
- `functions/src/chats/sweepExpiredMessages.ts` (code only; not exported)

### Files edited

- `firestore.rules`
- `functions/src/index.ts`
- `functions/src/chats/sendTextMessage.ts` — optional `replyTo` + Phase 6 field defaults.
- `apps/mobile/src/lib/conversations.ts` — types + callable wrappers + `REACTION_EMOJIS`.
- `apps/mobile/src/screens/Conversation.tsx` — uses `MessageBubble`, reply / edit composer state, pinned banner.
- `apps/mobile/App.tsx` — registers `ForwardPicker` + `MessageInfo` routes.
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_DATA_MODEL.md`, `docs/OFFLINESMS_PHASE_LOG.md` (this file), `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md`, `docs/OFFLINESMS_RISK_REGISTER.md`, `docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`

### Commits

| Hash | Message |
|---|---|
| `3a121ad` | docs: add OfflineSMS phase 6 implementation plan |
| `cb4f86f` | feat(data): add message action contracts |
| `3c7f3ce` | security: add message action rules |
| `e4dfda8` | feat(functions): add message action callables |
| `2e23b32` | feat(mobile): add message action sheet and reply/edit composer states |
| `dc8f440` | feat(mobile): add forward picker and message info screen |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests** for the new callables / rules / UI. Manual emulator checklist in the Phase 6 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **Reactions not audited.** Toggling a reaction is too noisy to record; if compliance later demands it, switch the `auditLog` call back on in `reactToMessage.ts`.
- **Single pinned message per conversation.** Multi-pin can land as a sub-collection later. The current model is simpler and matches WhatsApp-style defaults.
- **`Clipboard` API used by the bubble's Copy action is the legacy one** (`Clipboard.setString`). Works on web; deprecated on native. Phase 8/9 will swap to `expo-clipboard` when wider native testing happens.
- **`deletedForMe` filtering is client-side only.** Hidden messages still exist on the server; this is intentional (the spec calls for `deleteForMe` as a per-user view).
- **Disappearing-message sweeper code present but not scheduled.** Activation is Phase 11 alongside the TTL setting UI.
- **No Starred-Messages screen yet.** Per-message star toggles work; a "starred across all chats" listing is deferred to a later phase.
- **`Forward` is text-only.** Media forwarding lands with media support (Phase 8+).
- **`MessageInfo` returns only metadata.** It deliberately doesn't return the message body — the bubble already shows it, and keeping the callable body-free is a useful boundary.

### Recommended Phase 7 scope

Phase 7 = **Delivery receipts, read receipts, and message views** (per the roadmap):

1. Client-side `markReceipt({ messageId, status })` callable; clients call it on render (`delivered`), on view (`read`), on audio play (`played`).
2. Aggregation trigger `onReceiptWrite` denormalises `deliveredCount` / `readCount` onto the message doc.
3. Tick-rendering on bubbles (single tick = sent, two ticks = delivered, blue ticks = read) consuming the denormalised counts.
4. `MessageInfo` Phase-7 pass: full per-recipient receipt list for group messages, replacing the "available in a later update" placeholder.
5. Receipt rate-limiting and a daily reconciliation function (Phase 20 will toughen).

Defer: media messages, SMS escalation UI, points UI, dashboard moderation, calls.

---

## Phase 5 — Group chat and member management

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Group conversation contract.** `conversations/{id}` gains group-only fields (`name`, `avatarUrl`, `ownerUid`, `memberCount`, `settings { onlyAdminsCanSend, onlyAdminsCanEditInfo, onlyAdminsCanAddMembers }`) and `status` now includes `'locked'`. `participantKey` is nullable for groups.
- **Member contract.** `conversations/{c}/members/{uid}` is the canonical role table for groups: `{ uid, role: 'owner'|'admin'|'member', status: 'active'|'removed'|'left', addedBy, displayNameSnapshot, photoURLSnapshot, joinedAt, updatedAt }`. Phase 0/4 docs with only `{ role }` keep working — callable writes use `merge: true`.
- **Group messages** carry `senderDisplayName` + `senderPhotoURL` snapshots so the chat UI renders sender headers without joining `/users`.
- **Six new callables.** All audited via `writeAuditLog`. Metadata sanitiser scrubs body/content/messageText if mis-used.
  - `createGroup({ name, memberUids[], avatarUrl? })` → `group.created`. Cap `MAX_GROUP_MEMBERS = 256`.
  - `addMembers({ conversationId, memberUids[] })` → `group.member.added`. Owner/admin only.
  - `removeMember({ conversationId, memberUid })` → `group.member.removed`. Owner can remove admins; admin can remove members; owner-protection enforced.
  - `changeRole({ conversationId, memberUid, role })` → `group.member.role_changed`. Owner only; role ∈ {admin, member}; owner-role immutable from this path.
  - `leaveGroup({ conversationId })` → `group.member.left`. Owner can only leave when no other active members; last person out flips `status` to `disabled`.
  - `lockGroup({ conversationId, locked })` → `group.locked` / `group.unlocked`. Owner/admin only.
- **`sendTextMessage` extended** to reject non-active members, refuse sends when `status === 'locked'` unless owner/admin, refuse when `settings.onlyAdminsCanSend && !privileged`, and capture sender snapshots on the message doc.
- **Firestore rules.**
  - `conversations.create` now requires that group docs name the caller as `ownerUid` and include them in `participantUids` — client-side group spoofing is closed.
  - `members/{uid}.write` is server-only for groups (callables use Admin SDK). The legacy self-or-group-admin write path remains for non-group conversations.
  - New helpers: `getMemberRole(c)`, `memberExists(c, uid)`, `isConversationOwner(c)`, `isConversationAdmin(c)`, `isValidGroupRole(role)`, `isGroupTypeData(d)`, `safeGroupConversationCreate()`.
- **Composite index** added: `conversations(participantUids, type, updatedAt)` for the "Groups" filter chip.
- **Mobile UI.**
  - `apps/mobile/src/lib/conversations.ts` gains group types + the six callable wrappers + `subscribeMembers()` + `groupErrorCopy(code)`.
  - `ChatsList` enables the "Groups" filter chip, shows group name + member count, and the FAB now offers a "New chat / New group" action sheet.
  - `Conversation` adds a tappable header (groups → `GroupInfo`), sender-name labels above incoming group bubbles, and a state-machine composer that disables on `disabled`/`locked`/`onlyAdminsCanSend`/non-member with friendly inline copy.
  - `NewGroup` (new): multi-select picker on Phase 4's username search; calls `createGroup`.
  - `GroupInfo` (new): hero header, role-gated action rows (Add members / Lock·Unlock / Leave), member list with role badges and role-respecting per-row action sheets.
  - `AddMembers` (new): same picker pattern as `NewGroup`, filters out existing active members live.
- **i18n.** New `group.*` and `groupErrors.*` namespaces in `en.json` and `ar.json`.
- **No dashboard work.** Phase 14 is where admin moderation lands.

### Files created

- `docs/OFFLINESMS_PHASE_5_PLAN.md`
- `apps/mobile/src/screens/{NewGroup,GroupInfo,AddMembers}.tsx`
- `functions/src/chats/{createGroup,addMembers,removeMember,changeRole,leaveGroup,lockGroup}.ts`

### Files edited

- `firestore.rules`
- `firestore.indexes.json`
- `functions/src/chats/sendTextMessage.ts`
- `functions/src/index.ts`
- `apps/mobile/src/lib/conversations.ts`
- `apps/mobile/src/screens/{ChatsList,Conversation}.tsx`
- `apps/mobile/App.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_DATA_MODEL.md`, `docs/OFFLINESMS_PHASE_LOG.md` (this file), `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md`, `docs/OFFLINESMS_RISK_REGISTER.md`, `docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`

### Commits

| Hash | Message |
|---|---|
| `86a9bce` | docs: add OfflineSMS phase 5 implementation plan |
| `0750b25` | feat(data): add group conversation contracts and indexes |
| `51c3561` | security: add group member and conversation rules |
| `670a05c` | feat(functions): add group management callables |
| `a9e0461` | feat(mobile): add new group creation flow |
| `d978e91` | feat(mobile): add group conversation support |
| `3fbdcb4` | feat(mobile): add group info and member management |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests for rules / callables / UI.** Manual emulator checklist in the Phase 5 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **Owner-transfer deferred.** Owners must remove or be the last member before leaving; transferring ownership to another admin is a future-phase callable.
- **`onlyAdminsCanEditInfo` not yet wired.** The field is in the schema and a future "Edit group" screen will consult it; today only `lockGroup` / `addMembers` flows exist, both already owner/admin-only.
- **No avatar upload.** `avatarUrl` accepted by `createGroup` but the mobile UI doesn't mount an image picker yet. Phase 4+ media wave.
- **Member-count cap is server-only.** Rules don't enforce `memberCount <= 256` because it'd cost an extra `get()` per write. Phase 20 will reconsider.
- **Dashboard group moderation** is still empty-state. Phase 14.

### Recommended Phase 6 scope

Phase 6 = **Message actions and message info** (per the roadmap):

1. Long-press sheet on message bubbles: Copy, Reply, Forward, React, Star, Pin, Edit (sender only, within window), Delete-for-me / Delete-for-everyone (sender or admin).
2. Callables: `editMessage`, `deleteMessage`, `reactToMessage`, `pinMessage` (group-aware), `forwardMessages`. All audited.
3. Firestore fields on `messages`: `editedAt`, `deletedForEveryone`, `reactions: Record<emoji, uid[]>`, `pinnedAt`, `replyTo`, `forwardedFrom`.
4. Rule additions: edit window guard (e.g. 15 minutes), reaction shape validation, pin allowed for participants but only owner/admin in locked groups.
5. Disappearing-message TTL field on `messages` + a scheduled sweeper function.
6. `MessageInfo` precursor screen (read counts from existing `receipts/{uid}` placeholders — Phase 7 will populate them).

Defer: media messages, message views aggregation, full receipts UI (Phase 7), SMS escalation (Phase 8).

---

## Phase 4 — Chat list and one-to-one messaging

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Direct conversation data contract.** Phase 4 introduces the canonical fields `participantUids[]`, `participantKey`, `lastMessage`, `status`, `createdBy`, `updatedAt` on `conversations/{id}`, while keeping `memberIds`, `lastMessageText`, `lastMessageAt`, `lastSenderId` and `senderId` as written-everywhere back-compat aliases so the existing receipt-fanout trigger, `/admin/users` page, and seed script keep working.
- **Two new sub-collections.**
  - `conversations/{c}/userState/{uid}`: per-user pin/mute/archive/favorite state plus server-owned `unreadCount`, `lastReadAt`, `lastMessagePreview`, `lastMessageAt`.
  - `conversations/{c}/typing/{uid}`: ephemeral typing flag with `expiresAt = now + 3000ms`.
- **Rules hardening.** New helpers `isConversationParticipantData()`, `isConversationParticipant()`, `isValidTextMessage()`, `onlyAllowedUserStateUpdates()`, etc. New rules:
  - `conversations.read` requires participation (`participantUids` or legacy `memberIds` or `/members` sub-collection).
  - `conversations.create` requires the caller to be listed in `participantUids/memberIds`.
  - `messages.create` enforces `type === 'text'`, `1..4000` chars, `senderUid === auth.uid`.
  - `userState/{uid}` is owner-only with a field allow-list (`pinned`, `muted`, `archived`, `favorite`, `updatedAt`); counters are server-owned (callable + trigger bypass via Admin SDK).
  - `typing/{uid}` is owner-write, participant-read.
- **Four callables (audited):**
  - `getOrCreateDirectConversation({ otherUserId })` — `chat.directConversation.opened`.
  - `sendTextMessage({ conversationId, text })` — `chat.message.sent` with `{ conversationId, length }` only.
  - `markRead({ conversationId })` — `chat.markRead`.
  - `setTyping({ conversationId, isTyping })` — **not audited** (would be too noisy).
- **`onMessageCreate` trigger extended** to write the new `lastMessage` object, refresh recipient `userState` (unread, preview), and zero the sender's own `userState` so self-sends never appear unread on the sender's own chat list. Receipt fan-out and back-compat aliases preserved.
- **Mobile data layer.** `apps/mobile/src/lib/conversations.ts` exposes `subscribe*` (conversations, messages, userState, typing) and typed callable wrappers (`sendTextMessage`, `markRead`, `setTyping`, `getOrCreateDirectConversation`). `setTyping` is client-debounced to one start event every 2 s. `apps/mobile/src/lib/chats.ts` becomes a thin facade so older imports keep compiling.
- **Mobile UI.**
  - `ChatsList` shows live conversations with unread badges, pin/mute indicators, typing previews, four filter chips (All / Unread / Favorites / Archived), a search field, and a FAB → `NewChat`. Groups chip rendered disabled until Phase 5.
  - `NewChat` searches users by `usernameLower` prefix (Firestore range query bounded by ``), filters out the caller, and routes into the new conversation via the callable.
  - `Conversation` consumes `sendTextMessage`, calls `markRead` on every incoming batch, emits typing start/stop on draft changes, renders peer name from `users/{peerUid}`, and surfaces inline errors via `ErrorState`.
- **Composite indexes added:** `conversations(participantUids, updatedAt)` and `conversations(participantUids, status, updatedAt)`. The legacy `conversations(memberIds, lastMessageAt)` index remains.
- **No dashboard work.** Phase 14 is where admin chat moderation lands.

### Files created

- `docs/OFFLINESMS_PHASE_4_PLAN.md`
- `apps/mobile/src/lib/conversations.ts`
- `apps/mobile/src/screens/NewChat.tsx`
- `functions/src/chats/getOrCreateDirectConversation.ts`
- `functions/src/chats/sendTextMessage.ts`
- `functions/src/chats/markRead.ts`
- `functions/src/chats/setTyping.ts`

### Files edited

- `firestore.rules`
- `firestore.indexes.json`
- `functions/src/chats/onMessageCreate.ts`
- `functions/src/index.ts`
- `apps/mobile/src/lib/chats.ts`
- `apps/mobile/src/screens/ChatsList.tsx`
- `apps/mobile/src/screens/Conversation.tsx`
- `apps/mobile/App.tsx`
- `docs/OFFLINESMS_DATA_MODEL.md`, `OFFLINESMS_TECHNICAL_ARCHITECTURE.md`, `OFFLINESMS_RISK_REGISTER.md`, `OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`

### Commits

| Hash | Message |
|---|---|
| `8e33fbc` | docs: add OfflineSMS phase 4 implementation plan |
| `525c701` | feat(data): add direct conversation data contracts and indexes |
| `e054b90` | security: add conversation, message, userState, and typing rules |
| `75475e5` | feat(functions): add direct conversation callables and fan-out |
| `3f12c3f` | feat(mobile): add conversations lib and new-chat screen |
| `507cf7d` | feat(mobile): add chat list filters, unread, typing, and conversation rewrite |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests for rules / callables / UI.** Manual emulator checklist in the Phase 4 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **`subscribeTyping` only filters expired docs client-side.** Stale `typing` docs persist in Firestore until overwritten. A scheduled cleanup function isn't strictly needed (rows are tiny and overwritten on every keystroke / 2s debounce window) but is queued for Phase 16 alongside other scheduled housekeeping.
- **`setTyping` callable cost.** Even with the 2-second client debounce, a chatty user generates one call per ~2s of typing. Cost is acceptable for Phase 4; presence tooling (RTDB) is on the table for Phase 7.
- **Message receipts UI not wired.** The enum is enforced and the trigger writes `status: 'pending'` for each recipient, but no client emits `delivered`/`read`/`played`. Phase 7 wires this.
- **Direct conversation participation update path.** `conversations.update` rules still allow any participant to write — useful for the seed script and Phase 5 group flows — but means a participant can technically rewrite `lastMessage` fields. Acceptable today because the canonical updates flow through callables; tighten in Phase 5 / Phase 18.
- **Username search is exact prefix.** A real fuzzy / full-text user search isn't in scope and isn't trivial in Firestore alone (Phase 17 will pair it with a search index).

### Recommended Phase 5 scope

Phase 5 = **Group chat and member management** (per the roadmap):

1. Create-group flow on mobile: `NewGroup.tsx` with member picker (reuses Phase 4's username search), avatar/name input, owner role assigned to creator.
2. `GroupInfo.tsx` screen — list members, role badges, lock/unlock, leave-group.
3. Callables: `createGroup`, `addMembers`, `removeMember`, `changeRole`, `leaveGroup`, `lockChannel` — all audited (`group.created`, `group.member.added`, …).
4. Rules tighten: only `owner/admin` may mutate `/members`; member-count cap enforced server-side; `conversations.update` rules narrow to the legitimate Phase 5 mutation paths.
5. Trigger update: `onMessageCreate` already fans out across all participants — group case is automatic once `participantUids` has more than 2 entries. Confirm with a manual emulator pass.

Defer: media messages, message actions, communities, dashboard moderation.

---

## Phase 3 — Core Firestore data model and rules hardening

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Data model contracts.** New `docs/OFFLINESMS_DATA_MODEL.md` documents every collection introduced in Phase 3 (`organizations`, `roles`, `auditLogs`, `tickets`, `flags`, `payments`, `gatewayHealth`, `smsQuotaUsage`) plus the new fields on existing `statuses` and the receipt-status enum. Schema only — no UI mounts them yet.
- **Composite indexes.** Six new composite indexes added to `firestore.indexes.json`, each documented and traceable to a real query (audit-log explorer, moderation queue, own-tickets, own-payments, own-statuses, "what happened to X"). Single-field indexes (e.g. `auditLogs.createdAt` and `statuses.expiresAt`) are left to Firestore's automatic indexing.
- **Rules hardening.** `firestore.rules` extended:
  - `auditLogs`, `gatewayHealth`, `smsQuotaUsage/{uid}/days/{yyyymmdd}`, `payments` are all `allow write: if false` for clients (even admins). Reads scoped to owner/admin as appropriate.
  - `tickets`: owner can create with `status: 'open'` and no `assignedTo`; owner+admin can read; admin updates/deletes.
  - `flags`: owner can create with `status: 'open'`; admin reads and updates (so reporters can't enumerate other reports).
  - `organizations` + `organizations/{id}/members/{uid}`: admin-only in Phase 3 (membership rules wait for Phase 13).
  - `roles`: admin read/write (catalogue; live permission checks still come from `request.auth.token`).
  - `statuses`: audience and expiry are now enforced server-side via the new helpers `isStatusExpired()` and `isStatusAudienceMember()`. Legacy docs without the new fields default to "any authed reader" but expired docs are read-blocked everywhere.
  - Receipt writes are checked against an enum (`isValidReceiptStatus()`): `pending | delivered | read | viewed | played | failed`. Unknown statuses are rejected.
  - All Phase 2 protections (users field allow-list, usernames write-deny) preserved.
- **Audit log helper.** `functions/src/lib/auditLog.ts` provides:
  - `writeAuditLog({ action, actor, target, result, metadata })` — soft-failing (a failed audit-log write never rolls back the primary action).
  - `sanitiseMetadata(...)` — strips a hard-coded set of forbidden keys (`password`, `token`, `otp`, `secret`, `apiKey`, `phone`, `email`, `messageText`, `body`, `content`, …), clamps strings, flattens one level.
  - `redactPhone(...)`, `redactEmail(...)` for callers that genuinely need an identifier signal.
- **First audit consumers.**
  - `claimUsername` emits `auth.username.claimed` (or `auth.username.changed` if releasing a prior name) after the transaction commits.
  - `setAdminClaim` emits `admin.claim.set` on success and `admin.claim.set` with `result: 'failure'` on permission denial. Also fixed a long-standing latent issue: the callable now **preserves** existing custom claims (role, permissions, …) instead of overwriting the whole block when toggling `admin`.
- **Welcome credit refactor — deferred.** `onUserCreate` already uses `merge: true`, so re-running it is idempotent in practice and Phase 3 has no consumer that needs to re-grant. A dedicated `grantWelcomeCreditIfEligible` callable lands when Phase 10 wires payments. Documented in the Phase 3 plan.

### Files created

- `docs/OFFLINESMS_PHASE_3_PLAN.md`
- `docs/OFFLINESMS_DATA_MODEL.md`
- `functions/src/lib/auditLog.ts`

### Files edited

- `firestore.rules`
- `firestore.indexes.json`
- `functions/src/auth/claimUsername.ts`
- `functions/src/auth/setAdminClaim.ts`
- `docs/OFFLINESMS_PHASE_LOG.md`, `OFFLINESMS_TECHNICAL_ARCHITECTURE.md`, `OFFLINESMS_RISK_REGISTER.md`, `OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`

### Commits

| Hash | Message |
|---|---|
| `a640507` | docs: add OfflineSMS phase 3 implementation plan |
| `35fd6ac` | feat(data): add core Firestore collection contracts and indexes |
| `940cc7d` | security: enforce status audience, receipt enums, lock system collections |
| `2de1b45` | feat(functions): add audit log helper |
| `f377bb3` | feat(functions): audit auth and admin bootstrap actions |

Tail commit lands with this docs update.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

Manual emulator checks queued in the Phase 3 plan; automation lands in Phase 20.

### Known limitations

- **No automated rules tests yet.** Manual emulator checklist documented in `docs/OFFLINESMS_PHASE_3_PLAN.md`; Phase 20 plugs `@firebase/rules-unit-testing` into CI.
- **Contacts graph isn't modelled.** Status audience `'all_contacts'` is approximated as "any signed-in user not in `excludedViewerUids`". When a real contacts model lands the rule tightens automatically (Phase 13).
- **Organization membership rules deferred.** Phase 3 leaves `organizations` and its `members` sub-collection admin-only. Member-aware rules land with Phase 13's admin org module.
- **Welcome credit callable deferred.** The `onUserCreate` trigger is idempotent today; a callable replacement isn't needed until Phase 10 introduces real payment-driven crediting.
- **Reserved username list still duplicated** between mobile and functions. Cross-package extraction is a Phase 18 (shared utilities) item.

### Recommended Phase 4 scope

Phase 4 = **Chat list + one-to-one messaging** (per the roadmap):

1. Per-user conversation state under `conversations/{c}/userState/{uid}` (pin, mute, archive, lastReadAt, unread). Owner-only writes; trigger maintains unread counts.
2. `markRead` callable so receipts begin to track real delivery / read state — receipt enum guard from Phase 3 already in place.
3. Filter chips on `ChatsList` (All / Unread / Favorites / Groups) backed by the new userState fields.
4. Typing indicator via an ephemeral `conversations/{c}/typing/{uid}` doc (3-second TTL).
5. Audit hooks on any privileged conversation actions (e.g. lock/unlock).

Do not yet build media messaging, group management UI, SMS escalation UI, points UI, or dashboard modules.

---

## Phase 2 — Firebase auth, onboarding, profile completion

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build all green across workspaces).

### What was done

- **Native phone OTP path.** `apps/mobile/src/lib/auth.ts` refactored: web keeps invisible reCAPTCHA; native uses an `ApplicationVerifier` registered via a new `setNativeRecaptchaVerifier()` hook so a future `FirebaseRecaptchaVerifierModal` mount drops in cleanly. Firebase auth error codes are mapped to a stable `OtpError` enum (`invalid-phone-number`, `invalid-verification-code`, `code-expired`, `too-many-attempts`, `network-error`, `quota-exceeded`, `recaptcha-unavailable`, `no-confirmation-in-flight`, …). Added `isPlausiblePhone()` and a `cancelOtp()` helper for backing out of the flow. **No OTP value is ever stored or logged**; `ConfirmationResult` lives in module-scope memory only.
- **Phone UX improvements.** `PhoneEntry.tsx` and `Otp.tsx` translate `OtpError` codes to product-friendly copy, autofill from `oneTimeCode`, and offer a "use a different number" link that clears in-flight state.
- **Profile completion flow.** New screen `ProfileCompletion.tsx` captures `displayName` (required, 1–60 chars), `username` (required, 3–20 chars, `[a-z0-9._]` with edge/consecutive-punct guards), and optional `about` (≤140 chars). Calls the `claimUsername` callable; on success Firestore flips `profileCompleted: true` and `App.tsx` swaps the navigator into `MainTabs`. Avatar upload is deferred — `photoURL` stays `null` for now.
- **Onboarding routing in `App.tsx`.** Subscribes to `users/{uid}` after sign-in; until `profileCompleted === true`, the app shows the `OnboardingFlow` instead of `MainTabs`.
- **Username uniqueness.** New Firestore collection `usernames/{lowercaseUsername}` with `{ uid, username, claimedAt }`. New callable `functions/src/auth/claimUsername.ts` runs a single transaction that:
  - Rejects `already-exists` when the target username is held by another uid.
  - Releases the caller's prior `usernameLower` if they're renaming.
  - Writes `usernames/{lower}` and patches `users/{uid}` with the allowed fields.
- **`onUserCreate` seeds `profileCompleted: false`** plus `null` username fields so the gate works from the first sign-in.
- **Firestore rules hardening.** `users.update` is now a strict field allow-list (`displayName`, `photoURL`, `about`, `profileCompleted`, `fcmTokens`, `lastSeen`, `updatedAt`). `username` and `usernameLower` are **only** writeable via the `claimUsername` callable. A redundant banned-list (`role`, `roles`, `permissions`, `admin`, `isAdmin`, `points`, `pointsBalance`, `wallet`, `walletStatus`, `organizationId`, `organizationRole`, `createdAt`, `phoneVerified`, `status`, `phoneNumber`, `email`, `username`, `usernameLower`) is a safety net against future edits. `users.create` is also field-scoped. `usernames/{lower}` reads are allowed for signed-in users (so the UI can show "taken" status); writes require admin (callable bypasses rules via Admin SDK).
- **Admin bootstrap script.** `scripts/promoteAdmin.ts` + `npm run promote:admin -- <email>` set `admin: true` and `role: 'super_admin'` claims on a target user, preserving existing claims. Refuses without an email arg, refuses unknown emails, never logs the service-account file. Docs: `docs/admin-bootstrap.md`.
- **Email-link sign-in:** deferred. No existing scaffolding to complete; introducing it from scratch is out of scope for Phase 2 and documented as deferred in the risk register and roadmap.
- **i18n.** Added `auth.createProfileSub`, `auth.about*`, `auth.usernameHint`, `auth.useDifferentNumber`, `auth.saving`, plus `profileErrors.*` and `otpErrors.*` keys in `en.json` and `ar.json`.

### Files created

- `docs/OFFLINESMS_PHASE_2_PLAN.md`
- `docs/admin-bootstrap.md`
- `apps/mobile/src/lib/username.ts`
- `apps/mobile/src/lib/profile.ts`
- `apps/mobile/src/screens/ProfileCompletion.tsx`
- `functions/src/auth/claimUsername.ts`
- `scripts/promoteAdmin.ts`

### Files edited

- `apps/mobile/src/lib/auth.ts`
- `apps/mobile/src/screens/{PhoneEntry,Otp}.tsx`
- `apps/mobile/App.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `functions/src/auth/onUserCreate.ts`
- `functions/src/index.ts`
- `firestore.rules`
- `package.json` (root) — added `promote:admin`
- `.env.example` (root)

### Commits

| Hash | Message |
|---|---|
| `f4079f3` | docs: add OfflineSMS phase 2 implementation plan |
| `67cadb1` | feat(auth): add native phone OTP flow with friendly errors |
| `85abd69` | feat(profile): add profile completion screen with username validation |
| `7a06371` | feat(functions): add claimUsername callable |
| `a17199c` | security: harden user profile Firestore updates |
| `471c0c2` | chore(admin): add first-admin promotion script |

Tail commit lands with this docs update.

### Checks run

```
npm run typecheck --workspaces --if-present     → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present          → ok
npm run build --workspaces --if-present         → ok
npm run promote:admin                           → refuses without email arg (expected)
```

### Known limitations

- **Native phone OTP requires a host-app verifier mount.** The path is plumbed (`setNativeRecaptchaVerifier`), but actually invoking it on iOS/Android requires `expo-firebase-recaptcha` (or `@react-native-firebase/auth`) to be installed and a verifier ref registered at app start. Phase 2 ships the plumbing + a clear `recaptcha-unavailable` error so web + dev work today; wiring the verifier mount is a follow-up.
- **Email-link sign-in deferred.** Not scaffolded; out of scope.
- **Avatar upload deferred.** `photoURL` is allowed in the field allow-list but no UI mounts the image picker yet. Phase 4+.
- **No automated tests for rules / callable.** Phase 20 lands `@firebase/rules-unit-testing` coverage; manual emulator testing is documented in the Phase 2 plan.
- **`claimUsername` callable** depends on Cloud Functions being deployed in environments that exercise the onboarding flow. The dashboard and seed data don't require it.

### Recommended Phase 3 scope

Phase 3 = **Core Firestore data model and rules hardening** (per the roadmap). Specifically:

1. Add missing Firestore collections needed by later phases: `auditLogs`, `payments`, `flags`, `tickets`, `roles`, `gatewayHealth`, `smsQuotaUsage`, `organizations`. Stubs only — rules + minimal schema docs, no UI.
2. Server-side audience enforcement for `statuses` (move the existing client-side filtering into rules / a callable).
3. Receipt `status` enum validation in `firestore.rules`.
4. Add a shared `functions/src/lib/auditLog.ts` helper so privileged callables in later phases can audit consistently. Wire `claimUsername` to use it as the first example.
5. (Optional) move `onUserCreate`'s welcome credit out of the trigger into an idempotent callable so it can be re-run if the trigger fails.

Defer: chat / SMS / wallet / dashboard module work — those are Phases 4+.

---

## Phase 1 — Design system, layout shells, routing cleanup

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build all green across all workspaces).

### What was done

- **Design tokens — semantic layer.** Added a role-based token layer (`color.background.*`, `color.text.*`, `color.border.*`, `color.action.*`, `color.state.*`) on top of the existing raw palette. Light + dark variants exported (dark variant unused until Phase 19). Tailwind preset surfaces the new tokens (`bg-bg-app`, `text-text-primary`, `border-border`, `bg-action-primary`, `text-state-error`, …) **alongside** the existing utilities — no rename, no removal. New doc: `docs/DESIGN_TOKENS_SEMANTIC_LAYER.md`.

- **Dashboard admin route guard.** `app/admin/layout.tsx` is now a server component (`runtime: nodejs`, `dynamic: 'force-dynamic'`) that reads the `__session` HTTP-only cookie, verifies it via `firebase-admin`, and authorises the request only when the user carries one of:
  - the legacy `admin: true` claim,
  - `permissions.canAccessAdmin === true`,
  - `role` or any of `roles[]` ∈ {`super_admin`, `organization_admin`, `support_agent`, `finance_admin`, `auditor`}, or
  - an email in the `BOOTSTRAP_ADMIN_EMAILS` allow-list (for first-admin bootstrap).
  Unauthenticated traffic is redirected to `/login?next=…`. Authenticated but unauthorised users see a `PermissionState` (no redirect loop). The Sidebar sign-out clears the session cookie before calling `auth.signOut()`. No Firestore rules changes in this phase.

- **`/api/session` route.** `POST` exchanges a Firebase ID token for an HTTP-only session cookie (5 day expiry); `DELETE` clears it. The login page now performs the exchange before navigating into `/admin`.

- **Shared state primitives.** Five components (`LoadingState`, `EmptyState`, `ErrorState`, `PermissionState`, `SuccessState`) added to both apps. Common props: `title`, `description`, `icon`, `primaryAction`, `secondaryAction`, `compact`, `fullPage`, `tone`. They consume semantic tokens, work in RTL (mobile uses `I18nManager.isRTL`), and are dark-mode-ready (no hard-coded raw colors).

- **Primitive adoption — only on safe scaffold pages.**
  - Dashboard: `/admin/{chats, groups, calls, reports, support, roles, settings}` (replace ad-hoc TODO divs with `EmptyState`); `/admin/users` (`LoadingState` + `EmptyState`).
  - Mobile: `ChatsList` (loading + empty), `Points` (loading), `Privacy`, `Devices`, `Status`, `Calls`, `SmsEscalation` (placeholder copy).
  - Intentionally **not** touched: `Conversation`, `/admin` overview, `/admin/sms`, `/admin/points` — these carry richer logic deferred to feature phases.

- **CI workflow.** `.github/workflows/ci.yml` runs `npm ci → typecheck → lint → build` across all workspaces on `pull_request`, `push: main`, and pushes to `claude/**` / `feature/**` branches. Node 20, npm cache, no secrets, no deploys.

- **Make repo buildable for CI** (minimum non-feature changes needed for CI to be meaningful):
  - Aligned `apps/dashboard` React + react-dom to **18.2.0** to match the mobile workspace (RN 0.74 pins React 18.2). The 18.3.1/18.2.0 mismatch made npm install two Reacts, which made Next.js server prerender crash with a `useContext`-is-null error.
  - Lazy-initialised both `lib/firebase.ts` and `lib/firebase-admin.ts` in the dashboard via Proxy, so `next build` can collect page data without `NEXT_PUBLIC_FIREBASE_*` or service-account env vars present.
  - Wrapped the login form in `<Suspense>` (needed because `useSearchParams` for `?next=…` triggers a CSR bailout) and marked the page `dynamic = 'force-dynamic'`.
  - Added a minimal `apps/dashboard/.eslintrc.json` so `next lint` runs non-interactively in CI.
  - Updated `apps/mobile/src/lib/firebase.ts` to pull `getReactNativePersistence` from `firebase/auth/react-native` (its real location in firebase-js-sdk 10.x).
  - Committed `package-lock.json` for deterministic CI installs; gitignored `*.tsbuildinfo` and `functions/lib/`.

### Files created

- `docs/OFFLINESMS_PHASE_1_PLAN.md`
- `docs/DESIGN_TOKENS_SEMANTIC_LAYER.md`
- `packages/design-tokens/src/semantic.ts`
- `apps/dashboard/lib/session.ts`
- `apps/dashboard/app/api/session/route.ts`
- `apps/dashboard/components/state/{StateShell,LoadingState,EmptyState,ErrorState,PermissionState,SuccessState,index}.tsx`
- `apps/mobile/src/components/state/{StateShell,LoadingState,EmptyState,ErrorState,PermissionState,SuccessState,index}.tsx`
- `apps/dashboard/.eslintrc.json`
- `.github/workflows/ci.yml`
- `package-lock.json`

### Files edited

- `packages/design-tokens/src/index.ts`, `tailwind-preset.js`
- `apps/dashboard/app/admin/layout.tsx`, `app/login/page.tsx`, `package.json`, `components/Sidebar.tsx`, `lib/firebase.ts`, `lib/firebase-admin.ts`, `.env.example`
- `apps/dashboard/app/admin/{chats,groups,calls,reports,support,roles,settings,users}/page.tsx`
- `apps/mobile/src/lib/firebase.ts`
- `apps/mobile/src/screens/{ChatsList,Points,Privacy,Devices,Status,Calls,SmsEscalation}.tsx`
- `.gitignore`

### Commits

| Hash | Message |
|---|---|
| `c645d57` | `docs: add OfflineSMS phase 1 implementation plan` |
| `69d2d0a` | `feat(tokens): add semantic design token layer` |
| `5f6d89d` | `feat(ui): add shared state primitives and adopt on scaffold pages` |
| `ef2db47` | `feat(dashboard): protect admin routes with session role guard` |
| `0929843` | `ci: add workspace validation workflow` |
| `ede64e2` | `fix(ui): preserve caller-provided title in state primitives` |
| `93e423d` | `build: make repo buildable for CI` |

Tail commit will land with this docs update.

### Checks run

```
npm install                                     → ok
npm run typecheck --workspaces --if-present     → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present          → ok
npm run build --workspaces --if-present         → ok
  dashboard: 16 routes generated; /admin/* are ƒ dynamic
  functions: tsc → lib/
```

### Known limitations

- **Static export removed for /admin/\*.** Before Phase 1 the dashboard was set up to be statically exported (`firebase.json` serves `apps/dashboard/out`). The new server-side admin guard requires a Node runtime for `/admin/*`. The build still produces a usable artifact (admin routes are ƒ dynamic), but production deploys for `/admin/*` will need a Node host (Cloud Run / Vercel / similar) rather than pure static hosting. Phase 12 picks this up.
- **First admin bootstrap.** Until a real admin claim exists on at least one user, set `BOOTSTRAP_ADMIN_EMAILS` (server env) to a small list of trusted emails. Once promoted, remove the env var. Documented in `apps/dashboard/.env.example`.
- **No test infrastructure yet.** Phase 1 adds no test runner; phase plan rolls that into Phase 20.
- **Dark mode not wired.** Semantic tokens have a `darkSemantic` variant but no provider; Phase 19 wires the toggle.
- **Dashboard RTL not wired.** Mobile already forces RTL via `I18nManager`; the dashboard needs a Tailwind RTL plugin or manual mirroring (Phase 19).
- **Native phone OTP still TODO.** Untouched in Phase 1; Phase 2.

### Recommended Phase 2 scope

1. Native phone OTP path in `apps/mobile/src/lib/auth.ts` (or `expo-firebase-recaptcha`).
2. Profile-completion screen (display name, username, about, avatar). Add `usernames/{lower}` uniqueness collection + `claimUsername` callable.
3. Tighten `firestore.rules` on `users.update` to a field allow-list.
4. Email-link path (optional but designed for).
5. Documented `scripts/promoteAdmin.ts` for the first-admin bootstrap.

---

## Phase 0 — Repository audit & technical planning

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete (documentation only — no production code changed).

### What was done

- Inspected the entire repository: monorepo config, mobile app, dashboard, Cloud Functions, design tokens, Firestore rules and indexes, storage rules, scripts, and existing docs.
- Inventoried every screen (13 mobile), every admin page (11 + login + redirect), every Cloud Function (7), every Firestore collection (11 declared, 4+ implied), every composite index (4), and every TODO marker (21).
- Mapped 36 product design modules to their current implementation state.
- Drafted a 20-phase roadmap with acceptance criteria, scope, risks, and rollback per phase.
- Wrote 50+ issue-ready GitHub tasks, each labelled by phase + surface + priority.
- Compiled a 22-row risk register covering security, abuse, cost, privacy, and UX risks.
- Produced a consolidated technical architecture covering monorepo, mobile, dashboard, Firebase, Firestore, security rules, Functions, gateway, points, escalation, receipts, views, RBAC, audit, RTL, dark mode, testing, deployment.

### Files created

- `docs/OFFLINESMS_REPOSITORY_AUDIT.md`
- `docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`
- `docs/OFFLINESMS_IMPLEMENTATION_ROADMAP.md`
- `docs/OFFLINESMS_GITHUB_TASKS.md`
- `docs/OFFLINESMS_RISK_REGISTER.md`
- `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md`
- `docs/OFFLINESMS_PHASE_LOG.md` (this file)

### Checks run

- Repository structure inspected on the current commit of `claude/repo-audit-architecture-MiZDX`.
- No code modifications; no installs, builds, or tests were executed in Phase 0 (deferred to Phase 1 CI baseline).

### Known issues uncovered (full list in the Risk Register)

- `functions/src/points/buy.ts` credits points without payment verification — must close before any production traffic.
- Dashboard has no role-aware route guard.
- `statuses` audience is enforced client-side only.
- Several Firestore collections needed by later phases have no rules yet.
- No CI in `.github/workflows/`.
- No audit logging anywhere.
- Native phone OTP path unimplemented.
- Multiple mobile and dashboard screens are placeholders.

### Recommended Phase 1 scope

**Phase 1 — Design system, layout shells, and routing cleanup.**

1. Promote `@offlinesms/design-tokens` to expose semantic role tokens (`text.*`, `surface.*`, `border.*`, `state.*`, `action.*`) on top of the current palette, with a compatibility shim for existing imports.
2. Add a server-side guard at `apps/dashboard/app/admin/layout.tsx` that verifies a session cookie and the `admin: true` custom claim. Add the supporting `/api/session` route.
3. Add shared edge-state primitives (`LoadingState`, `EmptyState`, `ErrorState`, `PermissionState`, `SuccessState`) in both apps; convert existing `/admin/*` pages and `ChatsList` / `Points` to use them.
4. Add a `.github/workflows/ci.yml` running install → typecheck → lint → build for all workspaces on every PR.

Phase 1 must not touch chat data flow, Firestore rules of the messaging system, or Functions business logic.

### Commit

- **Hash:** `71fa481` (`docs: add OfflineSMS phase 0 implementation plan`).
- **Branch:** `claude/repo-audit-architecture-MiZDX`.
