# OfflineSMS Implementation Roadmap

Phased plan. Each phase is self-contained, leaves the app buildable, and ends with documentation + verification.

> Universal rule (applies to every phase below): every screen and page must render `loading`, `empty`, `error`, `permission`, and `success` states; every new admin action must be auditable; OfflineSMS is the only visible SMS brand.

---

## Phase 0 — Repository audit & technical planning

- **Objective.** Produce the audit, design map, roadmap, GitHub task breakdown, risk register, and technical architecture. No production behaviour changes.
- **Scope.** Docs only.
- **Files.** `docs/OFFLINESMS_*.md` (new).
- **Firestore / Functions / FE.** No changes.
- **Acceptance.** All 7 documents exist on the branch; commit hash recorded in `OFFLINESMS_PHASE_LOG.md`.
- **Risks.** None.
- **Rollback.** `git revert` of the docs commit.

---

## Phase 1 — Design system, layout shells, routing cleanup

- **Objective.** Lock the foundations: semantic design tokens, route guards, shared edge-state primitives, CI baseline.
- **Scope.**
  - Promote `@offlinesms/design-tokens` to expose **semantic role tokens** (`text.primary`, `surface.muted`, `border.strong`, `state.danger`, …) on top of the current palette.
  - Add `apps/dashboard/app/admin/layout.tsx` server-side guard via `firebase-admin` (session cookie verification + `admin` claim check).
  - Add a server route for session cookies (login/logout).
  - Add shared edge-state primitives (`LoadingState`, `EmptyState`, `ErrorState`, `PermissionState`, `SuccessState`) — one in `apps/dashboard/components/` and one in `apps/mobile/src/components/`.
  - Add GitHub Actions workflow: install → typecheck → lint → build (mobile web, dashboard, functions).
- **Files.** `packages/design-tokens/src/index.ts`, `tailwind-preset.js`; `apps/dashboard/app/admin/layout.tsx`, `app/api/session/route.ts`, `lib/session.ts`; `apps/mobile/src/components/*`; `.github/workflows/ci.yml`.
- **Firestore.** None.
- **Functions.** Optional: callable `createSessionCookie` if not using REST.
- **Mobile.** Replace ad-hoc `ActivityIndicator` with `LoadingState`.
- **Dashboard.** Wrap all `/admin/*` pages with new primitives.
- **Security rules.** Unchanged.
- **Indexes.** Unchanged.
- **Tests.** Snapshot of edge-state primitives; auth-guard redirect test.
- **Acceptance.** Unauthenticated user hitting `/admin` is redirected to `/login`; non-admin signed-in user is redirected to a "not authorised" page; CI is green on the branch.
- **Risks.** Token rename breaking existing references — mitigate with a compatibility shim re-exporting old names.
- **Rollback.** Revert tokens to the previous shape; remove guard.

---

## Phase 2 — Firebase auth, onboarding, profile completion

- **Objective.** End-to-end auth on mobile (web + native) and a profile-completion flow.
- **Scope.**
  - Native phone OTP via `@react-native-firebase/auth` (or `expo-firebase-recaptcha` on managed Expo).
  - Profile completion screen post-signup: `displayName`, `username` (uniqueness reserved), `about`, avatar upload.
  - Email-link sign-in path (optional but designed for).
  - Terms & privacy acceptance gate.
- **Files.** `apps/mobile/src/lib/auth.ts`, new `apps/mobile/src/screens/ProfileCompletion.tsx`; `functions/src/auth/claimUsername.ts`, extend `onUserCreate.ts`.
- **Firestore.** `usernames/{lowercase}` (uniqueness lookup) — server-only writes via callable.
- **Functions.** `claimUsername` callable (transactional uniqueness).
- **Mobile.** Wire navigation: if `users/{uid}.profileComplete !== true`, route to `ProfileCompletion`.
- **Dashboard.** None.
- **Rules.** `usernames`: create when document doesn't exist, owner-locked. `users.update` restricted to a field allow-list.
- **Indexes.** None new.
- **Tests.** OTP send/verify, dup username denied, profile completion gating.
- **Acceptance.** A fresh device can sign in by phone OTP and complete a profile. Re-login skips profile completion.
- **Risks.** Recaptcha friction on native; mitigate with platform-specific paths.
- **Rollback.** Feature-flag the new screen.

---

## Phase 3 — Core Firestore data model and rules hardening

- **Objective.** Add the missing collections needed by later phases and tighten rules.
- **Scope.**
  - Introduce: `auditLogs`, `usernames`, `payments`, `flags`, `tickets`, `roles`, `permissions`, `organizations`, `gatewayHealth`, `smsQuotaUsage`.
  - Field allow-lists for `users.update`, `conversations.update`, `messages.create`.
  - Server-side audience enforcement for `statuses`.
  - Validation of `receipt.status` enum.
  - First admin promotion script (`scripts/promoteAdmin.ts`).
- **Files.** `firestore.rules`, `firestore.indexes.json`, `docs/DATA_MODEL.md` (extend), `scripts/promoteAdmin.ts`.
- **Functions.** Shared `auditLog.ts` helper (writes a sanitised before/after snapshot).
- **Mobile / Dashboard.** No behaviour change.
- **Indexes.** `(auditLogs.actorId ASC, createdAt DESC)`, `(auditLogs.targetType ASC, targetId ASC, createdAt DESC)`, `(users.username ASC)`, others as listed in design map.
- **Tests.** Firestore rules tests via `@firebase/rules-unit-testing` for every collection.
- **Acceptance.** Rules-test suite green; deployment to staging succeeds.
- **Risks.** Rule regressions for existing flows — run smoke tests against staging seed data.
- **Rollback.** Revert rules file; collections remain empty.

---

## Phase 4 — Chat list and one-to-one messaging

- **Objective.** Make chats production-quality for text DMs (search, filters, swipe, accurate unread).
- **Scope.**
  - Filter chips (All / Unread / Favorites / Groups).
  - Pin / mute / archive (per-user sub-doc `conversations/{c}/userState/{uid}`).
  - Unread counter via `onMessageCreate` increment + `markRead` callable.
  - In-conversation typing indicator (RTDB or ephemeral Firestore doc).
- **Files.** `apps/mobile/src/screens/ChatsList.tsx`, `Conversation.tsx`, `lib/chats.ts`; `functions/src/chats/onMessageCreate.ts` extend; new `markRead.ts`.
- **Firestore.** `conversations/{c}/userState/{uid}` (`pinned`, `muted`, `archived`, `lastReadAt`, `unread`).
- **Functions.** `markRead` callable.
- **Indexes.** `(memberIds CONTAINS, archived ASC, lastMessageAt DESC)`.
- **Tests.** Unread accuracy under concurrent sends; archive/restore.
- **Acceptance.** A user sees correct unread counts after sending/receiving across two devices.
- **Risks.** Counter drift — mitigate with a daily reconciliation function.
- **Rollback.** Feature flag.

---

## Phase 5 — Group chat and member management

- **Objective.** Create / manage groups with roles, mentions, locking.
- **Scope.** Create-group flow, group info, add/remove members, role mgmt (owner/admin/member), leave, mention parsing, lock channel.
- **Files.** `apps/mobile/src/screens/NewGroup.tsx`, `GroupInfo.tsx`; `functions/src/groups/*` callables.
- **Firestore.** `conversations` (`name`, `photoUrl`, `locked`), `members` sub-collection.
- **Indexes.** Mention search index.
- **Rules.** Role-based mutation; member-count cap (e.g. 1024) enforced server-side.
- **Tests.** Boundary cases for role transitions.
- **Acceptance.** Owner can promote/demote; non-admin cannot mutate members; locked channels only accept admin messages.
- **Risks.** Large groups (>500) listener cost — Phase 19 perf pass.

---

## Phase 6 — Message actions and message info

- **Objective.** Long-press menu: reply, edit, delete, copy, forward, react, star, pin. Disappearing messages enforced.
- **Scope.** New callables, Firestore fields, UI sheets, MessageInfo precursor.
- **Files.** `apps/mobile/src/screens/Conversation.tsx`, new components; `functions/src/chats/messageActions.ts` (collection of callables).
- **Firestore.** `messages.reactions`, `messages.pinnedAt`, `messages.starredBy[]`, `messages.disappearAt`.
- **Rules.** `editMessage` only by sender within edit window; `delete` by sender or admin.
- **Indexes.** None new.
- **Tests.** Action permissions; edit-window enforcement.
- **Acceptance.** Every action works on iOS, Android, Web; locked behaviours respected.

---

## Phase 7 — Delivery / read receipts and message views

- **Objective.** Real ticks, MessageInfo screen, view tracking for media/status.
- **Scope.**
  - Client `markReceipt` (delivered on render, read on view, played for audio).
  - Aggregation trigger maintains `messages.deliveredCount` and `readCount`.
  - `MessageInfo.tsx` UI.
  - Status views collection.
- **Files.** `apps/mobile/src/lib/chats.ts`, `functions/src/chats/markReceipt.ts`, `onReceiptWrite.ts`.
- **Firestore.** `receipts`, `messages.{deliveredCount, readCount}`, `statusViews`.
- **Indexes.** None new (sub-collection reads).
- **Rules.** Receipt write by self + enum guard.
- **Acceptance.** Two-device test shows tick progression and MessageInfo counts match.

---

## Phase 8 — OfflineSMS SMS escalation (UI)

- **Objective.** Build mobile UI on top of existing `escalateSms` callable.
- **Scope.** `SmsEscalation.tsx` flow: audience picker (unread / undelivered / everyone), preview with masked phones, cost preview, confirmation, success/partial/failure result, retry trigger.
- **Files.** `apps/mobile/src/screens/SmsEscalation.tsx`, new `lib/sms.ts`.
- **Functions.** Add abuse limits to `escalate.ts`: per-user-per-day batch cap, audience size cap, conversation cool-down.
- **Firestore.** `smsQuotaUsage/{uid}/{yyyymmdd}`.
- **Rules.** Quota docs admin-only.
- **Indexes.** Existing batch index suffices.
- **Tests.** Insufficient points; quota exceeded; partial dispatch refund accuracy.
- **Acceptance.** End-to-end on emulator: a message escalates, points reserved/settled, recipients populated, batch report renders.
- **Risks.** Abuse (#6 in risk register) — limits and audit log required.

---

## Phase 9 — OfflineSMS Points Wallet

- **Objective.** Full wallet experience.
- **Scope.** History list, filters, transaction detail screen, reservation badge.
- **Files.** `apps/mobile/src/screens/Points.tsx`, new `PointsHistory.tsx`, `TransactionDetail.tsx`.
- **Firestore.** `transactions` (existing).
- **Indexes.** Existing `(userId ASC, createdAt DESC)`.
- **Acceptance.** Wallet shows balance, reserved, history, and detail.

---

## Phase 10 — Points purchase and transfer flows

- **Objective.** Real money in, peer-to-peer transfer.
- **Scope.**
  - `BuyPoints.tsx` package picker.
  - Payment provider webhook (idempotent `payments/{id}` write → credit wallet only on `paid` status).
  - `TransferPoints.tsx` flow.
  - Daily transfer cap; fraud flag emitter.
- **Files.** `functions/src/payments/webhook.ts`, `functions/src/points/buy.ts` (refactor to be webhook-driven), `functions/src/points/transfer.ts` (limits).
- **Firestore.** `payments/{id}` (server writes only), `fraudFlags/{id}`.
- **Rules.** `payments` & `fraudFlags` admin-only.
- **Tests.** Idempotency on webhook retry; over-cap transfer denied.
- **Acceptance.** A successful payment credits exactly once; a duplicated webhook is a no-op.
- **Risks.** Free-points exploit (#1) — close the synchronous `buyPoints` path entirely.

---

## Phase 11 — SMS delivery reports and retry failed SMS

- **Objective.** Make failed sends recoverable; expose per-recipient status.
- **Scope.**
  - Mobile: `SmsBatchReport.tsx` (status per recipient, retry button).
  - Functions: `retryFailedRecipients` callable, `gatewayWebhook` for provider DLR (Delivery Receipt).
- **Files.** `apps/mobile/src/screens/SmsBatchReport.tsx`, `functions/src/sms/retry.ts`, `functions/src/sms/webhook.ts`.
- **Rules.** Webhook is unauthenticated but HMAC-verified.
- **Acceptance.** A failed recipient can be retried; provider DLRs update Firestore.

---

## Phase 12 — Admin dashboard foundation

- **Objective.** Make `/admin` production-grade: guards, search, user menu, breadcrumbs, notifications.
- **Scope.** Server-side session cookie pattern, RBAC-aware menu (hides items the role can't access), global search bar, breadcrumb trail.
- **Files.** `apps/dashboard/app/admin/layout.tsx`, `components/UserMenu.tsx`, `components/Breadcrumb.tsx`, `lib/session.ts`.
- **Acceptance.** Only admins reach `/admin`; menu reflects RBAC.

---

## Phase 13 — Admin: users, organizations, groups, communities

- **Objective.** CRUD-style admin tables for these entities.
- **Scope.**
  - `/admin/users/[uid]` detail (with redacted message preview off by default).
  - `/admin/organizations` (new).
  - `/admin/groups` (filter `conversations.type IN ['group','channel']`).
  - `/admin/communities` (new model).
- **Files.** Pages under `apps/dashboard/app/admin/*`; admin callables for suspend/unblock, role change, lock channel.
- **Functions.** `adminUpdateUser`, `adminLockConversation`, etc. — all audit-logged.
- **Rules.** Admin-only writes; rules helper extended for org membership.
- **Acceptance.** Suspend a user → user can't sign in; audit entry recorded.

---

## Phase 14 — Admin: conversations, messages, receipt analytics

- **Objective.** Conversation + message review with **content redacted by default**.
- **Scope.**
  - `/admin/chats` — conversation list.
  - `/admin/chats/[id]` — metadata, members, last activity.
  - `/admin/chats/[id]/messages` — message rows with hashed/redacted content, "Reveal" action behind `permissions.canReadMessageContent` + audit log + reason.
  - Receipt analytics chart for a conversation.
- **Acceptance.** A reviewer without permission sees metadata only; a reveal writes an audit record with `reason`.

---

## Phase 15 — Admin: SMS escalation + Points management

- **Objective.** Surface batches and points operations in dashboard.
- **Scope.**
  - `/admin/sms` — live batches list, drill into batch, retry, refund triggers (admin-initiated).
  - `/admin/points` — wallet adjustments (`adminAdjust`), refund queue processing, package management writes to `settings/packages`.
- **Functions.** `adminAdjustWallet`, `adminRefundBatch`, `updatePackages`.
- **Rules.** Permission check beyond `admin: true` — these require a more specific permission to limit blast radius.
- **Acceptance.** Refund queue processing is idempotent and audited.

---

## Phase 16 — OfflineSMS Gateway settings & health

- **Objective.** Operate the gateway from the dashboard.
- **Scope.**
  - `/admin/sms` config persisted to `settings/sms-gateway`.
  - Live health card from `gatewayHealth/{yyyymmdd}` (success rate, p95 latency).
  - "Send test SMS" callable.
- **Functions.** Scheduled `rollupGatewayHealth`; `sendTestSms` callable.
- **Acceptance.** Settings persist and apply on the next escalation.

---

## Phase 17 — Reports, analytics, exports

- **Objective.** Pre-built reports + CSV export with privacy controls.
- **Scope.** `/admin/reports` builder with masked phones by default; per-permission unmask + audit.
- **Functions.** Scheduled rollups to `reports/{id}`; signed-URL exporter.
- **Acceptance.** Exports show masked phones unless reviewer has explicit permission.

---

## Phase 18 — Support, moderation, roles & permissions, audit logs

- **Objective.** Full operations layer.
- **Scope.**
  - `/admin/support` tickets queue and conversation.
  - `/admin/moderation` flags inbox.
  - `/admin/roles` permission builder writing `roles/{id}` and pushing to user custom claims via callable.
  - `/admin/audit` audit log explorer.
- **Functions.** `setRole`, `setPermissions`, `moderate`, `closeTicket` — all audited.
- **Rules.** `roles`, `tickets`, `flags`, `auditLogs` admin-only.
- **Acceptance.** Every privileged write produces an audit entry; roles are revocable.

---

## Phase 19 — RTL, localisation, dark mode, accessibility

- **Objective.** Full theming + locale support.
- **Scope.** Dashboard RTL plugin, mirrored icons, dark mode (semantic tokens), keyboard navigation, focus rings, ARIA on dashboard.
- **Acceptance.** Visual regression tests pass for both LTR/RTL and Light/Dark on every major page.

---

## Phase 20 — Testing, security, performance, release readiness

- **Objective.** Production readiness.
- **Scope.**
  - Firestore rules unit tests (full coverage), e2e (Detox / Playwright), load test of SMS escalation, k6 against callables.
  - Index review (no scan warnings in emulator), listener-cost audit.
  - Final security review: secrets, IAM, App Check, CSP, rate limiting.
  - SLOs documented; on-call runbook; release notes.
- **Acceptance.** Go/no-go gate met.

---

## Cross-cutting policies (apply throughout)

1. SMS visible brand is **OfflineSMS** only. No mention of third-party providers in UI, docs, or telemetry strings.
2. SMS spend always denominated in **OfflineSMS Points**.
3. Wallet must never go negative — enforce in transactions.
4. Points reserved before sending, deducted after gateway acceptance, refunded on failure.
5. Refunds follow an explicit, documented policy (Phase 11 doc update).
6. Phone numbers masked in reports/dashboard by default.
7. Message content hidden in admin by default; reveal requires permission + audit reason.
8. Every privileged admin action is audit-logged.
9. Every page renders loading / empty / error / permission / success.
10. RTL + dark mode supported on every major page eventually.
11. Every phase keeps the app buildable (CI green).
