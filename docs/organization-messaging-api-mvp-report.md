# Organization Messaging API — MVP Final Report

Status: **complete** (Phases 1–7 implemented and verified)
Branch: `claude/quirky-galileo-qizev6`
Scope: dashboard + backend only — **no mobile code was modified at any phase**.

---

## 1. Executive summary

Organizations can now be provisioned with their own dashboard account, log in,
generate a single API key, and submit messages to OfflineSMS users — either
manually from the dashboard or programmatically via
`POST /api/v1/org/messages/send`. Every submission is recorded as a batch with
per-recipient logs, counted against a monthly quota, and audited.

This solves the "organization broadcast" need (schools, businesses notifying
their members) without touching the mobile app.

**Intentionally not included:** real device delivery (see §13 — recorded
messages are `queued`, never `sent`/`delivered`), SMS relay integration,
templates, webhooks, CSV upload, SDKs, fallback SMS, approval workflows,
multiple API keys/scopes, and advanced delivery tracking.

## 2. Scope

| Constraint | Status |
| --- | --- |
| Dashboard/backend/functions only | ✅ all changes under `apps/dashboard/`, `firestore.rules`, `firestore.indexes.json`, `tests/rules/` |
| Mobile app untouched | ✅ verified `git status` per phase: 0 files under `apps/mobile/`, no React Native/Expo changes |
| No actual delivery | ✅ no delivery primitive is invoked; statuses are honest |
| Honest statuses | ✅ `accepted` / `queued` / `failed` / `unsupported_recipient` only — pinned by tests |

## 3. Implemented phases

| Phase | Commit | Summary |
| --- | --- | --- |
| 1 | `65632d5` | Organization account creation (super admin): org doc + Firebase Auth admin user + `role`/`organizationId` custom claims; `view:`/`manage:organization_messaging` capabilities |
| 2 | `d9714a3` | Organization Messaging dashboard page: usage summary, API key status, send form (validated, scoped), batch logs; nav entry |
| 3 | `e124285` | API key storage/security: `offmsg_live_…` format, SHA-256 hash-only at rest, show-once reveal, transactional rotate/revoke, audits |
| 4 | `59f8c3e` | Public endpoint `POST /api/v1/org/messages/send`: bearer auth by hash, both request shapes, quota transaction, batch + per-recipient logs |
| 5 | `353d20a` | Shared `submitOrganizationMessageBatch()` service; dashboard send wired to it (`source: dashboard`, actor = signed-in admin) |
| 6 | `18e9e16` | Batch detail page (`batches/[batchId]`), richer logs table, usage percentage, audit single-writer verification, allow-list read models |
| 7 | `19e06e6` | Firestore rules for the 4 new collections, 2 composite indexes (+ graceful fallback reads), 13 emulator rules tests, hardening pins |

## 4. Changed files summary

| Group | Files |
| --- | --- |
| Dashboard pages | `app/admin/organization-messaging/page.tsx`, `…/new/page.tsx` + `CreateOrgAccountForm.tsx`, `…/SendMessageForm.tsx`, `…/ApiKeySection.tsx`, `…/batches/[batchId]/page.tsx` |
| Server actions / services | `lib/orgMessagingActions.ts` (create account, send, generate/revoke key), `lib/orgMessagingService.ts` (shared submission path) |
| API route | `app/api/v1/org/messages/send/route.ts` |
| Validation / pure logic | `lib/orgMessagingValidation.ts`, `lib/orgMessagingKeys.ts`, `lib/orgMessagingApi.ts` |
| Read helpers | `lib/orgMessagingData.ts` |
| Permissions / nav | `lib/adminPermissions.ts`, `lib/adminNav.ts`, `components/Sidebar.tsx` |
| Firestore | `firestore.rules`, `firestore.indexes.json` |
| Tests | `__tests__/orgMessagingValidation.test.ts` (22), `__tests__/orgMessagingKeys.test.ts` (10), `__tests__/orgMessagingApi.test.ts` (37), `tests/rules/orgMessaging.rules.test.ts` (13) |
| Documentation | this report |

All dashboard paths are relative to `apps/dashboard/`.

## 5. Data model

`organizations/{orgId}` (extended, existing collection)
- `name`, `slug`, `status: active|suspended|disabled`, `ownerUid`, `settings{…}` (pre-existing)
- new: `adminUid`, `adminEmail`, `monthlyMessageLimit`, `createdBy`

`organizationApiKeys/{keyId}` — **server-only; never client-readable**
- `organizationId`, `keyHash` (SHA-256 hex — the only stored representation),
  `status: active|revoked`, `createdAt`, `createdBy`, `revokedAt`, `revokedBy`, `lastUsedAt`

`organizationMessageBatches/{batchId}`
- `organizationId`, `source: dashboard|api`, `createdBy` (admin uid or API key id),
  `status: accepted|partial|failed`, `total`, `accepted`, `queued`, `failed`,
  `unsupported`, `createdAt`, `completedAt`

`organizationMessages/{messageId}`
- `organizationId`, `batchId`, `recipientType: phone|userId`, `recipientValue`,
  `resolvedUserId`, `title`, `body`, `status` (§8), `failureReason`, `createdAt`

`organizationUsageCounters/{orgId_YYYY-MM}`
- `organizationId`, `month`, `used` (accepted/queued only), `limit` (snapshot), `updatedAt`

`auditLogs` (existing collection; new actions)
- `organization.account.created`, `organization_api_key_created`,
  `organization_api_key_revoked`, `organization_message_batch_created`,
  `organization_message_batch_failed` — metadata is ids/counts only.

## 6. Dashboard usage guide

1. **Create an organization account** (super admin): Admin → Org Messaging →
   *New organization account*. Enter org name, admin email + password
   (≥8 chars, letter + digit), monthly message limit, status. This creates the
   org, the admin login, and the org-scoped claims in one step.
2. **Organization admin login:** the org admin signs in to the dashboard with
   that email/password. Their sidebar shows *Org Messaging* scoped to their
   organization only.
3. **Generate / revoke an API key:** Org Messaging page → API key section →
   *Generate API key*. **The secret is shown exactly once** ("Copy this key
   now. It will not be shown again."). *Regenerate* atomically revokes the old
   key; *Revoke* disables programmatic sending immediately.
4. **Send from the dashboard:** fill Title (≤80), Body (≤500), Recipients —
   one per line, `+E.164` phone or OfflineSMS user ID, max 500. The result
   banner shows batchId, status, accepted/failed/unsupported; usage and logs
   refresh automatically.
5. **View usage:** the Usage card shows monthly limit, used, remaining, used %
   and the `YYYY-MM` month key.
6. **View logs:** Recent batches table → click a batch id → batch detail page
   with the per-recipient message rows (latest 500).

Super admins do all of the above for any organization via the organization
picker (`?org=` selection); org admins are locked to their own.

## 7. API documentation

`POST /api/v1/org/messages/send`

Headers:
```
Authorization: Bearer offmsg_live_<key>
Content-Type: application/json
```

**Shape A — same message for all recipients**
```json
{
  "title": "Important Notice",
  "body": "Please review student affairs.",
  "recipients": [
    { "phone": "+970591234567" },
    { "userId": "abc123" }
  ]
}
```

**Shape B — different message per recipient**
```json
{
  "messages": [
    { "phone": "+970591111111", "title": "Financial Notice", "body": "Dear Ahmad, you have 120 NIS due." },
    { "phone": "+970562222222", "title": "Financial Notice", "body": "Dear Sara, you have 85 NIS due." }
  ]
}
```
Exactly one shape must be present. Limits: title ≤ 80 chars, body ≤ 500 chars,
1–500 recipients, each recipient exactly one of `phone` (+E.164; digits-only
without `+` rejected) or `userId`.

**Success — 200**
```json
{ "ok": true, "batchId": "…", "total": 2, "accepted": 1, "failed": 0, "unsupported": 1, "status": "partial" }
```

**Failures**

| HTTP | code | meaning |
| --- | --- | --- |
| 401 | `missing_authorization` | no/incorrect `Authorization: Bearer …` header |
| 401 | `invalid_key_format` | token doesn't match `offmsg_live_` + 43 base64url chars |
| 401 | `invalid_key` | key not recognized |
| 401 | `revoked_key` | key exists but is revoked |
| 403 | `organization_not_found` | key has no organization |
| 403 | `organization_suspended` | org status is not `active` |
| 400 | `invalid_payload` | shape/field validation failed (message includes a pointer, e.g. `messages[0].title`) |
| 400 | `too_many_recipients` | more than 500 recipients |
| 429 | `quota_exceeded` | request doesn't fit the remaining monthly quota |
| 500 | `internal_error` | transient server error |

Failure body: `{ "ok": false, "error": { "code": "…", "message": "…" } }`

## 8. Status meanings

| Status | Meaning |
| --- | --- |
| `accepted` | batch-level: every message was recorded with a viable in-app target |
| `queued` | message recorded for an existing OfflineSMS user; **awaiting future delivery wiring — not delivered** |
| `failed` | recipient could not be accepted (e.g. `user_not_found`) |
| `unsupported_recipient` | phone number with no linked OfflineSMS user (`phone_not_linked_to_user`) — no delivery path exists in this MVP |

Batch `status` is `accepted` (all queued), `partial` (some queued), or `failed`
(none queued).

> `sent`, `delivered`, and `seen` are **intentionally not used** anywhere in
> this MVP. Tests pin the vocabulary; rules reject client writes that would
> inject them.

## 9. Quota behavior

- Each organization has `monthlyMessageLimit`; usage is bucketed by UTC month
  key `YYYY-MM` in `organizationUsageCounters/{orgId_YYYY-MM}`.
- **Only accepted (queued) messages consume quota** — failed and unsupported
  recipients contribute 0 (test-pinned).
- A request is rejected (`quota_exceeded`) when its **total** size doesn't fit
  the remaining quota (conservative — avoids partial-fill races).
- Enforcement runs in a single Firestore **transaction** that reads the org
  (fresh status + limit) and the counter, checks, increments `used`, and
  creates the batch doc atomically. Both the API route and the dashboard send
  go through this same transaction (shared service).

## 10. Security decisions

| Decision | Implementation |
| --- | --- |
| Raw key shown once | only in the generate action's response, held in client component state; refresh loses it |
| Raw key never stored | only `keyHash` = SHA-256 hex at rest (appropriate for 256-bit random secrets) |
| Hash never exposed | read helpers route through pure allow-list mappers (`pickApiKeyStatusRow`, `mapBatchRow`, `mapMessageRow`); tests feed docs containing hashes and assert they can't surface |
| Key docs not client-readable | `organizationApiKeys` rules: `allow read, write: if false` for every client |
| Admin SDK bypasses rules | all server actions/routes keep explicit checks: session + `manage:organization_messaging` + `canViewOrganization`; rules are defense-in-depth only |
| Org scoping | `organization_admin` scope comes from custom claims (`getAdminScope`); client-provided `organizationId` is never trusted; the batch detail page re-checks the **batch's own** `organizationId` (`canAccessBatch`) |
| Super admin | unrestricted scope → any organization; org creation additionally requires unrestricted scope (org admins cannot create orgs) |
| Client writes denied | rules deny all client writes to batches/messages/counters (quota cannot be reset, statuses cannot be forged) |
| No bearer tokens in logs | audit actor is `apikey:<keyId>` or the admin uid; metadata is ids/counts; tests assert no `offmsg_live_`/`Bearer ` material in any derived shape |

## 11. Firestore rules and indexes

Rules (new section, existing `isAdmin()` / `isOrgAdminOf()` helper style):
- `organizationApiKeys` — read+write denied for all clients.
- `organizationMessageBatches`, `organizationMessages`,
  `organizationUsageCounters` — read for platform admins or the matching org
  admin (`token.organizationId == resource.data.organizationId`); all client
  writes denied.

Indexes added (only for queries that exist):
- `organizationMessageBatches`: `organizationId ASC, createdAt DESC`
- `organizationMessages`: `batchId ASC, createdAt DESC`

(No `organizationApiKeys` composite — its queries are equality-only; no
counters index — loaded by document id.)

**Deployment** (repo uses plain firebase-tools; `npm run firebase:deploy` is
the full deploy):
```bash
firebase deploy --only firestore          # rules + indexes together
# or individually:
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```
The list read helpers fall back to equality-only queries with in-memory sort
until the indexes finish building, so the page degrades gracefully. The
dashboard itself ships through the existing dashboard deployment
(`npm run build` in `apps/dashboard`).

## 12. Verification results (latest run, Phase 7/8)

| Check | Result |
| --- | --- |
| Dashboard typecheck (`tsc --noEmit`) | ✅ clean |
| Dashboard production build (`next build`) | ✅ compiled; 39/39 pages; routes `ƒ /admin/organization-messaging`, `ƒ …/new`, `ƒ …/batches/[batchId]`, `ƒ /api/v1/org/messages/send` registered |
| Functions typecheck | ✅ clean (untouched, verified) |
| Firestore emulator rules tests | ✅ **107/107** (13 new org-messaging cases, run against a live emulator) |
| Full unit suite (`vitest`) | ✅ **445/445** (69 org-messaging-specific) |
| Mobile files changed | ✅ **0** (`git status` grep `apps/mobile|expo|react-native` per phase) |

## 13. Known limitations

- **No actual delivery.** Nothing reaches a device. `queued` means "recorded
  and counted, awaiting future delivery wiring" — it does **not** mean
  delivered. There is no backend-only delivery primitive in this codebase that
  reaches arbitrary recipients without mobile changes or the points/relay
  pipeline, so delivery was deferred per the MVP's hard scope.
- Phone recipients only resolve when the number matches an existing
  `users.phoneNumber`; unlinked phones become `unsupported_recipient`.
- Latest 500 message rows per batch (no pagination).
- One API key per organization; no scopes.
- No templates, webhooks, CSV upload, SDK, fallback SMS, relay integration,
  approval workflows, or delivery states.

## 14. Recommended next phases (not implemented)

1. Real delivery via the existing FCM primitive (`sendPushToUser`) for
   `queued` messages to resolved users — server-side only, then (and only
   then) introduce delivery states.
2. Template support; CSV recipient upload; webhooks for status callbacks.
3. Developer portal / API docs page; JS + PHP SDK examples.
4. SMS relay integration for unsupported recipients, if approved.
5. Rate limiting per API key (the repo's `rateLimit` helper is a natural fit).

## 15. Final acceptance checklist

- [x] Organization account creation works (super admin only)
- [x] Organization dashboard page works (scoped per role)
- [x] API key generation/revocation works (show-once, hash-only, atomic rotate)
- [x] API endpoint accepts valid requests (both shapes)
- [x] API endpoint rejects invalid/revoked keys (401) and suspended orgs (403)
- [x] Quota enforcement works (transactional, accepted-only counting)
- [x] Dashboard send works through the same shared service (`source: dashboard`)
- [x] Logs and batch detail pages work (org-scoped, allow-list read models)
- [x] Rules tests pass (107/107 incl. 13 new)
- [x] Indexes added (2 composites matching real queries)
- [x] No mobile changes (0 files, every phase)
- [x] No fake `sent`/`delivered`/`seen` statuses (test- and rules-enforced)
- [x] No raw key leakage (storage, reads, audits, responses — test-enforced)
