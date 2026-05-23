# OfflineSMS Security Review

**Phase:** 20 (final hardening)
**Scope:** Production-relevant security posture across rules, Cloud Functions, dashboard, and mobile.
**Status:** All checks listed below have been verified against the current branch.

---

## 1. Admin guard

| Check | Status | Reference |
|---|---|---|
| `/admin/*` requires valid session cookie | ✅ | `apps/dashboard/app/admin/layout.tsx` calls `verifySession(cookie)` |
| Forbidden state renders `PermissionState`, not admin UI | ✅ | same file, `state === 'forbidden'` branch |
| Unauthenticated state redirects to `/login` | ✅ | same file |
| Server-rendered: no client-side bypass | ✅ | `export const dynamic = 'force-dynamic'`; runs on Node runtime |

## 2. RBAC / capabilities

| Check | Status | Reference |
|---|---|---|
| Capabilities defined as discriminated string union | ✅ | `apps/dashboard/lib/adminPermissions.ts:AdminCapability` |
| `canDo(role, capability)` is the only gate used in pages | ✅ | grep `canDo(` shows ~20 admin pages all guard via it |
| `support_agent` cannot manage users / wallets / roles | ✅ | verified by `__tests__/adminPermissions.test.ts` |
| `finance_admin` cannot manage users / roles | ✅ | verified by `__tests__/adminPermissions.test.ts` |
| `auditor` cannot manage anything | ✅ | verified by `__tests__/adminPermissions.test.ts` |
| `organization_admin` cannot manage notifications or export users / audit | ✅ | verified by `__tests__/adminPermissions.test.ts` |

## 3. Organization scoping

| Check | Status | Reference |
|---|---|---|
| `organization_admin` reads only their org | ✅ | `apps/dashboard/lib/adminScope.ts:applyOrgScope` |
| Unrestricted roles bypass org filter | ✅ | `getAdminScope` returns `{ organizationId: undefined }` for non-org roles |
| Org claim must be string; numeric or missing claim → undefined | ✅ | verified by `__tests__/adminScope.test.ts` |
| `canViewOrganization` denies cross-org access for org-admins | ✅ | verified by `__tests__/adminScope.test.ts` |

## 4. Firestore rules — per-collection summary

| Collection | Read | Write | Notes |
|---|---|---|---|
| `users/{uid}` | any authed | self (allow-listed fields) or admin | role/admin fields blocked for self |
| `usernames/{lower}` | any authed | admin only | claims go through `claimUsername` callable |
| `conversations/{id}` | participant or admin | participant or admin (legacy fields only) | server callables own most updates |
| `…/members/{uid}` | participant or admin | admin (group); legacy direct path retained | group member writes go through callables |
| `…/userState/{uid}` | self or admin | self with allow-listed fields | unreadCount etc. server-only |
| `…/typing/{uid}` | participant or admin | self only | TTL via expiresAt |
| `…/messages/{id}` | participant or admin | participant (valid text) or admin | edits/deletes via callable |
| `…/messages/{id}/receipts/{uid}` | self / sender / admin | self or admin (status enum validated) | callable enforces monotonic transitions |
| `wallets/{uid}` | self or admin | admin only | clients can never credit |
| `transactions/{id}` | owner or admin | admin only | append-only via Admin SDK |
| `payments/{id}` | owner or admin | **denied for all** | webhook-only |
| `smsBatches/{id}` | sender or admin | admin only | sender field validated |
| `smsBatches/.../recipients/{id}` | any authed | admin only | masked phone only |
| `statuses/{id}` | author / audience member (non-expired) | author / admin | audience enforced in rules |
| `…/views/{viewerUid}` | author / self / admin | admin only | server-only via `markStatusViewed` |
| `settings/{doc}` | any authed | admin only | |
| `organizations/{id}` | admin | admin | |
| `roles/{id}` | admin | admin | |
| `auditLogs/{id}` | admin | **denied for all** | written via `writeAuditLog` helper only |
| `tickets/{id}` | owner or admin | owner-create (status=open, no assignedTo); admin update | |
| `flags/{id}` | admin | owner-create with status=open | admin reviews |
| `gatewayHealth/{id}` | admin | **denied for all** | scheduled function only |
| `smsQuotaUsage/{uid}/days/{ymd}` | self or admin | **denied for all** | escalation callable only |
| `smsDeliveryEvents/{id}` | admin | **denied for all** | gateway webhook only |
| `pointsPackages/{id}` | any authed | admin | catalogue |
| `pointsTransfers/{id}` | sender / recipient / admin | **denied for all** | `transferPoints` callable only |
| `transferQuotaUsage/{uid}/days/{ymd}` | self or admin | **denied for all** | callable only |

Rules tests under `tests/rules/` cover the deny paths for every entry marked **denied for all**.

## 5. Admin SDK bypass risks

The Admin SDK bypasses Firestore rules. The mitigations:

| Mitigation | Status |
|---|---|
| Every server route under `/admin/api/*` re-verifies session before reading | ✅ |
| Every privileged callable re-checks `request.auth` + role/capability | ✅ |
| Webhook routes verify HMAC signature before any DB write | ✅ |
| Scheduled functions write deterministically (idempotent reapStuckBatches, etc.) | ✅ |
| Audit log written for every privileged action that mutates state | ✅ |
| Search/export use Admin SDK reads but rate-limited and redacted on output | ✅ |

## 6. Webhook security

| Webhook | Auth | Idempotency |
|---|---|---|
| `gatewayWebhook` (SMS DLR) | HMAC-SHA256 over body with `OFFLINESMS_WEBHOOK_SECRET` | `smsDeliveryEvents/{eventId}` insert; duplicate eventId silently dropped |
| `paymentWebhook` (purchase) | HMAC-SHA256 with `PAYMENT_WEBHOOK_SECRET` | `payments/{paymentId}.processedEventIds` set member-check; duplicate event short-circuits before wallet credit |

Secrets are read from `process.env.*` server-side only. No client code references them. No provider names appear in user-facing strings (verified by grep for `Twilio|Vonage|MessageBird|Stripe|PayPal` — only Phase-0 archive doc mentions them in narrative form).

## 7. Payment idempotency

`confirmPayment` server-side path:
1. Load `payments/{id}` document
2. If `payments.status === 'completed'` → no-op, return success
3. If incoming event id is already in `processedEventIds` → no-op
4. Inside a Firestore transaction:
   - Re-read payment doc
   - Re-check status + event id
   - Credit `wallets/{uid}` and write `transactions/{txid}` with `relatedPaymentId`
   - Mark payment completed; add event id to `processedEventIds`

Property-based test for this exact race is deferred to a follow-up (requires emulator).

## 8. Wallet double-spend prevention

`reserveForSms` and `releaseReservation`:
- Wrapped in a Firestore transaction
- Re-read `wallet.balance` and `wallet.reserved` inside the transaction
- Reject if `balance - reserved < cost`
- On release, never let `reserved` go below 0 (`Math.max(0, reserved - amount)`)

`transferPoints`:
- Reject self-transfer
- Reject if recipient wallet status is `frozen`
- Daily cap enforced by `transferQuotaUsage/{uid}/days/{yyyymmdd}` increment inside transaction

## 9. SMS escalation abuse controls

| Control | Implementation |
|---|---|
| Per-user daily cap | `smsQuotaUsage/{uid}/days/{ymd}` incremented in same transaction as wallet reservation |
| Per-conversation cooldown | `lastEscalationAt` on conversation doc checked in `escalateSms` |
| Audience cap | `MAX_RECIPIENTS_PER_BATCH` enforced in preview + escalate |
| Opt-out respect | `users.smsOptOut === true` excluded with `skipReason: 'opt-out'` (verified in `classifyRecipients` + unit test) |
| Cross-batch dedupe | `findAlreadySentUids` queries `smsBatches.recipients` for non-failed records on the same `relatedMessageId` |
| Audit | Every preview, escalate, retry writes to `auditLogs` |

## 10. Rate limiting

| Surface | Limit | Window | File |
|---|---|---|---|
| Global search | 60 requests | 60 s | `apps/dashboard/lib/rateLimit.ts:LIMITS.search` |
| Generic export (users/groups/sms/points/support) | 10 requests | 1 h | `LIMITS.export` |
| Audit log export | 5 requests | 1 h | `LIMITS.auditExport` |

**Known limitation:** in-memory Map state is per-process / per-serverless-invocation. A malicious actor with access to a high-concurrency cluster could exceed the cap globally. Acceptable for admin-only routes; documented in performance review.

## 11. Redaction

| Surface | Phone | Email | Body / message content |
|---|---|---|---|
| Admin dashboard list views | `maskPhone()` always | `maskEmail()` (full only for super_admin / legacy_admin / bootstrap_admin / support_agent) | never rendered |
| Admin export CSV | `maskPhone()` always | `maskEmail()` always | never included |
| Admin detail pages | `maskPhone()` always | masked unless privileged role | never rendered |
| Mobile SMS preview | `maskPhone()` (server-side, then sent down) | n/a | excerpt only via `buildDefaultSmsBody` |
| Audit log | `redactPhone()` / `redactEmail()` in `sanitiseMetadata()` | same | `messageText`, `body`, `content` keys explicitly stripped |
| Search results | `safeUserSummary` strips raw fields | masked | never rendered |

## 12. Audit logging

| Action class | Audit log | Helper |
|---|---|---|
| Auth (claim/release username) | yes | `writeAuditLog` from `claimUsername` |
| Group membership changes | yes | `addMembers`, `removeMember`, `changeMemberRole`, `leaveGroup` |
| Messaging (edit / delete / pin) | yes | each callable writes |
| SMS escalation (preview / escalate / retry) | yes | with masked recipient count |
| Wallet (purchase / transfer / refund) | yes | `confirmPayment`, `transferPoints`, `releaseReservation` |
| Admin (set role, set wallet status, lock group) | yes | `adminSetRole`, `adminSetWalletStatus`, `adminLockGroup`, `adminSetOrgRole` |
| Notifications (draft create) | yes | `saveDraftNotification` server action |
| Support ticket assign / unassign / reassign | yes | `assignSupportTicket` |
| Export (every export route) | yes | `writeExportAudit` |

Forbidden metadata keys (`password`, `token`, `otp`, `secret`, `phoneNumber`, `messageText`, `body`, `content`) are stripped by `sanitiseMetadata()` — verified by `functions/__tests__/auditLog.test.ts`.

## 13. Explicit "no client can …" checks

| Check | Status |
|---|---|
| No client can credit `wallets/{uid}` | ✅ — rule `allow write: if isAdmin()` (admin still goes through callable; webhook is the only credit path) |
| No client can mark `payments/{id}.status = 'completed'` | ✅ — rule `allow write: if false` for clients **and admins** |
| No client can update `smsDeliveryEvents` | ✅ — rule `allow write: if false` |
| No client can write `auditLogs` | ✅ — rule `allow write: if false` for everyone |
| No admin page exposes message body / SMS body / full phone | ✅ — grep audit shows no `.text` or `.smsBody` rendered in admin pages; all phones go through `maskPhone()` |
| Search and export are redacted and rate-limited | ✅ — verified in helpers + tests |

## 14. Known residual risks

| # | Risk | Severity | Mitigation in place | Future work |
|---|---|---|---|---|
| R1 | In-memory rate limiter is per-instance | Low | Admin-only routes; ack'd | Phase 21: redis or Firestore counter |
| R2 | No emulator-based integration tests in CI | Medium | Pure helpers tested + local rules tests | Phase 21: CI job with Java-enabled image |
| R3 | Dashboard dark mode not wired | Low | Class scaffold only; light remains | Phase 21: palette wiring |
| R4 | Webhook secrets in env vars (not KMS) | Medium | Standard for serverless; rotated manually | Phase 21: Secret Manager binding |
| R5 | Notification broadcast UI exists in draft-only form | Low | Send button permanently disabled; no fan-out code path | Phase 21: gated rollout when needed |
| R6 | RTL not wired in dashboard | Low | `dir="ltr"` set explicitly; admin-only audience | Phase 21: if Arabic admin demand emerges |
| R7 | No 2FA enforcement on admin accounts | High | Documented in QA checklist (manual step) | Phase 21: Firebase MFA enforcement |

## 15. Required production checks (gate to deploy)

Before any production deploy:

1. ☐ Verify `BOOTSTRAP_ADMIN_EMAILS` env var is unset or empty in production
2. ☐ Verify `PAYMENT_WEBHOOK_SECRET` is set and rotated since last incident
3. ☐ Verify `OFFLINESMS_WEBHOOK_SECRET` is set and rotated since last incident
4. ☐ Verify Firebase project ID matches the production project
5. ☐ Run `firebase deploy --only firestore:rules,firestore:indexes` before functions
6. ☐ Verify the latest `firestore.rules` is deployed (check Firebase console hash)
7. ☐ Verify the route guard at `/admin/layout.tsx` returns `forbidden` for a known non-admin test account
8. ☐ Spot-check at least one export route returns redacted CSV
9. ☐ Spot-check at least one admin search query returns redacted results
10. ☐ Verify `/admin/audit` shows recent privileged actions
11. ☐ Verify a non-admin signed-in user cannot read `/api/admin/search`
12. ☐ Smoke-test the payment webhook with a replayed event — second event should be a no-op
