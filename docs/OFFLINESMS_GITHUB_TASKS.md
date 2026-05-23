# OfflineSMS GitHub Task Breakdown

Issue-ready tasks per phase. Each task is sized for a focused commit.

Common labels (apply per task): `phase:0`–`phase:20`, plus one or more of `frontend`, `dashboard`, `mobile`, `firebase`, `firestore`, `security`, `testing`, `docs`, and `priority:high|medium|low`.

---

## Phase 0 — Audit & planning

### [Phase 0] Produce repository audit and architecture documents
**Description.** Inspect the repo and write the seven Phase 0 documents listed in the roadmap. No code changes.
**Scope.**
- Inventory mobile, dashboard, functions, design tokens, Firestore rules/indexes/storage.
- List all TODOs.
- Document missing collections.
**Acceptance.**
- `docs/OFFLINESMS_REPOSITORY_AUDIT.md`, `…_DESIGN_IMPLEMENTATION_MAP.md`, `…_IMPLEMENTATION_ROADMAP.md`, `…_GITHUB_TASKS.md`, `…_RISK_REGISTER.md`, `…_TECHNICAL_ARCHITECTURE.md`, `…_PHASE_LOG.md` exist on the working branch.
- Single commit, message `docs: add OfflineSMS phase 0 implementation plan`.
**Technical notes.** Docs only. No prod behaviour changes.
**Labels.** `phase:0`, `docs`, `priority:high`.

---

## Phase 1 — Design system, layout shells, routing

### [Phase 1] Add semantic role tokens to design-tokens
**Description.** Layer semantic tokens (`text.primary`, `surface.muted`, `border.strong`, `state.danger`, `state.ok`, `state.warn`) on top of the existing palette and re-export through the Tailwind preset.
**Scope.** `packages/design-tokens/src/index.ts`, `tailwind-preset.js`. Compatibility shim re-exports old names.
**Acceptance.** Importing the new tokens compiles in both apps; dashboard `tailwind.config.ts` consumes them; no visual diff in screenshots.
**Technical notes.** Frontend only. Avoid renaming raw palette keys.
**Labels.** `phase:1`, `frontend`, `dashboard`, `mobile`, `priority:high`.

### [Phase 1] Dashboard auth+admin route guard
**Description.** Add a server-side guard to `app/admin/layout.tsx` that verifies a Firebase session cookie and the `admin: true` custom claim.
**Scope.** `apps/dashboard/app/admin/layout.tsx`, `app/api/session/route.ts`, `lib/session.ts`.
**Acceptance.** Unauth → `/login`; non-admin → "not authorised" page; admin → page renders.
**Technical notes.** Firebase Admin SDK. Set/clear `__session` cookie. App Check tolerated, not required yet.
**Labels.** `phase:1`, `dashboard`, `security`, `firebase`, `priority:high`.

### [Phase 1] Shared edge-state primitives (mobile + dashboard)
**Description.** Implement `LoadingState`, `EmptyState`, `ErrorState`, `PermissionState`, `SuccessState` in both apps.
**Acceptance.** All `/admin/*` pages and `ChatsList`/`Points` use the primitives.
**Labels.** `phase:1`, `frontend`, `mobile`, `dashboard`, `priority:medium`.

### [Phase 1] GitHub Actions CI (install, typecheck, lint, build)
**Description.** `.github/workflows/ci.yml` runs on PR and push.
**Acceptance.** Green on `main` and on Phase 0 branch.
**Labels.** `phase:1`, `docs`, `priority:high`.

---

## Phase 2 — Auth, onboarding, profile

### [Phase 2] Native phone OTP path
**Description.** Implement the native side of `apps/mobile/src/lib/auth.ts` via `@react-native-firebase/auth` or `expo-firebase-recaptcha`.
**Acceptance.** OTP send/verify works on iOS, Android, Web. Errors are user-friendly.
**Labels.** `phase:2`, `mobile`, `firebase`, `priority:high`.

### [Phase 2] Profile completion screen
**Description.** Post-signup gating screen for `displayName`, `username`, `about`, avatar.
**Scope.** `apps/mobile/src/screens/ProfileCompletion.tsx`, route guard in `App.tsx`.
**Acceptance.** Skipping the form is impossible; re-login skips it.
**Labels.** `phase:2`, `mobile`, `frontend`, `priority:high`.

### [Phase 2] claimUsername callable + usernames collection
**Description.** Add `functions/src/auth/claimUsername.ts` with a transactional uniqueness check; create `usernames/{lowercase}` doc owner-locked.
**Acceptance.** Concurrent claims for the same username fail one side cleanly.
**Labels.** `phase:2`, `firebase`, `firestore`, `security`, `testing`, `priority:high`.

### [Phase 2] Tighten users.update rules to a field allow-list
**Description.** Restrict client updates to `displayName`, `about`, `avatarUrl`, `lastSeen`, `fcmTokens`.
**Acceptance.** Rules unit test denies disallowed fields.
**Labels.** `phase:2`, `security`, `firestore`, `testing`, `priority:high`.

---

## Phase 3 — Data model & rules hardening

### [Phase 3] Add new Firestore collections + rules
**Description.** Add rules and minimal schema docs for `auditLogs`, `payments`, `flags`, `tickets`, `roles`, `permissions`, `organizations`, `gatewayHealth`, `smsQuotaUsage`.
**Acceptance.** Rules unit tests pass; data model doc updated.
**Labels.** `phase:3`, `firestore`, `security`, `docs`, `priority:high`.

### [Phase 3] Server-side audience enforcement for statuses
**Description.** Move audience filtering out of the client into a callable + rules.
**Acceptance.** A user outside the audience cannot read the status even with a direct Firestore call.
**Labels.** `phase:3`, `security`, `firestore`, `firebase`, `priority:high`.

### [Phase 3] Shared audit-log helper
**Description.** `functions/src/lib/auditLog.ts` writing `{actorId, action, targetType, targetId, before, after, reason, redactionLevel, ts}`.
**Acceptance.** Helper covered by tests; example usage from one callable.
**Labels.** `phase:3`, `firebase`, `security`, `testing`, `priority:high`.

### [Phase 3] First-admin promotion script
**Description.** `scripts/promoteAdmin.ts` reads UID, sets `admin: true` claim, audit-logs the action.
**Acceptance.** Documented in README.
**Labels.** `phase:3`, `firebase`, `docs`, `priority:medium`.

---

## Phase 4 — Chat list & 1:1 messaging

### [Phase 4] Per-user conversation state (pin/mute/archive/unread)
**Description.** `conversations/{c}/userState/{uid}` populated by triggers + callable `markRead`.
**Acceptance.** Unread badge accurate across two devices.
**Labels.** `phase:4`, `mobile`, `firebase`, `firestore`, `priority:high`.

### [Phase 4] Filter chips + swipe actions in ChatsList
**Description.** `All / Unread / Favorites / Groups` chips; swipe to pin/mute/archive.
**Acceptance.** Filters and actions persist across reloads.
**Labels.** `phase:4`, `mobile`, `frontend`, `priority:medium`.

### [Phase 4] Typing indicator
**Description.** Ephemeral `conversations/{c}/typing/{uid}` with `serverTimestamp` (3-second TTL via client-side eviction).
**Acceptance.** Indicator appears within 1 s and clears within 3 s.
**Labels.** `phase:4`, `mobile`, `firebase`, `priority:medium`.

---

## Phase 5 — Group chat

### [Phase 5] Create-group flow + member picker
**Description.** `NewGroup.tsx` with member picker and avatar upload.
**Acceptance.** New group appears in chat list with correct members.
**Labels.** `phase:5`, `mobile`, `frontend`, `firebase`, `priority:high`.

### [Phase 5] Group admin callables
**Description.** `addMembers`, `removeMember`, `changeRole`, `leaveGroup`, `lockChannel` callables, audit-logged.
**Acceptance.** Non-admin can't mutate; member cap enforced.
**Labels.** `phase:5`, `firebase`, `security`, `testing`, `priority:high`.

### [Phase 5] GroupInfo screen
**Description.** Members list, role badges, lock toggle (admin only).
**Labels.** `phase:5`, `mobile`, `frontend`, `priority:high`.

---

## Phase 6 — Message actions

### [Phase 6] Long-press action sheet (Reply, Copy, Forward, Delete, Edit, React, Star, Pin)
**Acceptance.** All actions wired; UI feels native on iOS/Android.
**Labels.** `phase:6`, `mobile`, `frontend`, `priority:high`.

### [Phase 6] Message action callables and field migrations
**Description.** Functions for edit (window check), delete (sender or admin), forward, react, pin.
**Labels.** `phase:6`, `firebase`, `firestore`, `security`, `testing`, `priority:high`.

### [Phase 6] Disappearing-message TTL sweeper
**Description.** Scheduled function purging messages with `disappearAt <= now`.
**Acceptance.** Cleanup verified in emulator after fast-forwarding clock.
**Labels.** `phase:6`, `firebase`, `testing`, `priority:medium`.

---

## Phase 7 — Receipts & message info

### [Phase 7] markReceipt callable + status enum rules
**Description.** Client calls `markReceipt({messageId, status})`; rules validate enum.
**Acceptance.** Two-device test shows correct progression.
**Labels.** `phase:7`, `mobile`, `firebase`, `firestore`, `testing`, `priority:high`.

### [Phase 7] Receipt aggregation trigger
**Description.** `onReceiptWrite` denormalises `deliveredCount` and `readCount` onto message doc.
**Acceptance.** Counts match `receipts` subcollection cardinalities.
**Labels.** `phase:7`, `firebase`, `firestore`, `testing`, `priority:high`.

### [Phase 7] MessageInfo screen
**Description.** Per-message recipient list with status and timestamps.
**Labels.** `phase:7`, `mobile`, `frontend`, `priority:medium`.

---

## Phase 8 — SMS escalation UI

### [Phase 8] SmsEscalation flow screen
**Description.** Audience picker, cost preview, confirmation, success view; calls existing `escalateSms`.
**Acceptance.** End-to-end with emulator credits and refunds correctly.
**Labels.** `phase:8`, `mobile`, `firebase`, `priority:high`.

### [Phase 8] Abuse controls in escalateSms
**Description.** Per-user-per-day cap, audience size cap, conversation cool-down; emits `smsQuotaUsage`.
**Acceptance.** Quota violation returns a specific error code.
**Labels.** `phase:8`, `firebase`, `security`, `testing`, `priority:high`.

---

## Phase 9 — Points wallet UI

### [Phase 9] Points history screen + transaction detail
**Description.** Live listener on `transactions where userId == uid order by createdAt desc`.
**Acceptance.** History list paginates; reserved badge accurate.
**Labels.** `phase:9`, `mobile`, `frontend`, `firebase`, `priority:medium`.

---

## Phase 10 — Buy & transfer

### [Phase 10] Payment webhook + buyPoints refactor
**Description.** Webhook ingests provider events into `payments/{id}` (idempotent) and only then credits the wallet. Remove synchronous credit path.
**Acceptance.** Replayed webhook is a no-op; failed payments never credit.
**Labels.** `phase:10`, `firebase`, `security`, `testing`, `priority:high`.

### [Phase 10] BuyPoints screen
**Labels.** `phase:10`, `mobile`, `frontend`, `priority:high`.

### [Phase 10] TransferPoints flow + daily cap
**Acceptance.** Over-cap transfer denied with audit entry.
**Labels.** `phase:10`, `mobile`, `firebase`, `security`, `priority:high`.

---

## Phase 11 — Delivery reports & retries

### [Phase 11] SmsBatchReport mobile screen
**Labels.** `phase:11`, `mobile`, `frontend`, `priority:high`.

### [Phase 11] retryFailedRecipients callable
**Acceptance.** Retries only `failed` recipients; new batch records reasons.
**Labels.** `phase:11`, `firebase`, `security`, `testing`, `priority:high`.

### [Phase 11] gatewayWebhook for delivery receipts
**Description.** HMAC-verified inbound endpoint updates recipient `smsStatus` and timestamps.
**Acceptance.** Tampered payloads rejected.
**Labels.** `phase:11`, `firebase`, `security`, `testing`, `priority:high`.

---

## Phase 12 — Dashboard foundation

### [Phase 12] RBAC-aware sidebar
**Description.** Hide menu items the role can't access; show "no permission" cards for direct URL access.
**Labels.** `phase:12`, `dashboard`, `frontend`, `security`, `priority:high`.

### [Phase 12] User menu + breadcrumbs + global search shell
**Labels.** `phase:12`, `dashboard`, `frontend`, `priority:medium`.

---

## Phase 13 — Admin entities

### [Phase 13] /admin/users/[uid] detail + suspend/unblock/role
**Acceptance.** Suspension blocks sign-in; audit entry written.
**Labels.** `phase:13`, `dashboard`, `firebase`, `security`, `priority:high`.

### [Phase 13] /admin/organizations CRUD
**Labels.** `phase:13`, `dashboard`, `firestore`, `priority:medium`.

### [Phase 13] /admin/groups list + lock/unlock
**Labels.** `phase:13`, `dashboard`, `priority:medium`.

### [Phase 13] /admin/communities (model + list)
**Labels.** `phase:13`, `dashboard`, `firestore`, `priority:medium`.

---

## Phase 14 — Conversations & messages

### [Phase 14] /admin/chats list + detail (metadata)
**Labels.** `phase:14`, `dashboard`, `firebase`, `priority:high`.

### [Phase 14] /admin/chats/[id]/messages with redaction
**Description.** Content hidden by default; "Reveal" button requires permission + reason; writes audit entry per reveal.
**Acceptance.** Reveal without permission is denied; audit records the reason.
**Labels.** `phase:14`, `dashboard`, `security`, `firebase`, `priority:high`.

### [Phase 14] Conversation receipt analytics chart
**Labels.** `phase:14`, `dashboard`, `frontend`, `priority:low`.

---

## Phase 15 — SMS & points admin

### [Phase 15] /admin/sms — live batches and drill-down
**Labels.** `phase:15`, `dashboard`, `firebase`, `priority:high`.

### [Phase 15] adminAdjustWallet + adminRefundBatch callables
**Description.** Permission-gated, idempotent, audit-logged.
**Labels.** `phase:15`, `firebase`, `security`, `testing`, `priority:high`.

### [Phase 15] /admin/points — packages persistence and refund queue
**Labels.** `phase:15`, `dashboard`, `firebase`, `priority:medium`.

---

## Phase 16 — Gateway settings & health

### [Phase 16] settings/sms-gateway editor
**Labels.** `phase:16`, `dashboard`, `firebase`, `priority:medium`.

### [Phase 16] rollupGatewayHealth scheduled function
**Labels.** `phase:16`, `firebase`, `priority:medium`.

### [Phase 16] sendTestSms callable + UI button
**Labels.** `phase:16`, `dashboard`, `firebase`, `priority:low`.

---

## Phase 17 — Reports & exports

### [Phase 17] /admin/reports builder
**Labels.** `phase:17`, `dashboard`, `frontend`, `priority:medium`.

### [Phase 17] CSV export with phone masking
**Description.** Server-side exporter; full-unmask requires permission + audit.
**Labels.** `phase:17`, `firebase`, `security`, `priority:high`.

---

## Phase 18 — Support, moderation, roles, audit

### [Phase 18] /admin/support tickets queue + conversation
**Labels.** `phase:18`, `dashboard`, `firebase`, `priority:medium`.

### [Phase 18] /admin/moderation flags inbox + actions
**Labels.** `phase:18`, `dashboard`, `firebase`, `security`, `priority:high`.

### [Phase 18] /admin/roles builder + setRole callable
**Description.** Beyond `admin: true`. Custom claims written from `roles/{id}`.
**Labels.** `phase:18`, `dashboard`, `firebase`, `security`, `testing`, `priority:high`.

### [Phase 18] /admin/audit explorer
**Description.** Filter by actor, target, action, time.
**Labels.** `phase:18`, `dashboard`, `firebase`, `priority:high`.

---

## Phase 19 — RTL, localisation, dark mode, a11y

### [Phase 19] Dashboard RTL support
**Description.** `dir` attribute, mirrored icons, RTL-aware spacing.
**Labels.** `phase:19`, `dashboard`, `frontend`, `priority:medium`.

### [Phase 19] Dark mode (mobile + dashboard)
**Description.** Theme provider, semantic tokens consumed, system preference + manual toggle.
**Labels.** `phase:19`, `mobile`, `dashboard`, `frontend`, `priority:medium`.

### [Phase 19] Accessibility pass
**Description.** Focus rings, ARIA labels, keyboard navigation, contrast checks.
**Labels.** `phase:19`, `dashboard`, `mobile`, `priority:medium`.

---

## Phase 20 — Testing, security, performance, release

### [Phase 20] Firestore rules full coverage suite
**Labels.** `phase:20`, `testing`, `firestore`, `security`, `priority:high`.

### [Phase 20] Mobile e2e (Detox) + dashboard e2e (Playwright)
**Labels.** `phase:20`, `testing`, `priority:high`.

### [Phase 20] Load test of escalateSms + payment webhook
**Labels.** `phase:20`, `testing`, `firebase`, `priority:high`.

### [Phase 20] Security review — App Check, IAM, CSP, secrets
**Labels.** `phase:20`, `security`, `firebase`, `priority:high`.

### [Phase 20] Operational runbook + release notes
**Labels.** `phase:20`, `docs`, `priority:high`.
