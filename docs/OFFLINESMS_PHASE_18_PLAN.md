# OfflineSMS Phase 18 Implementation Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`  
**Date:** 2026-05-22  
**Scope:** Organization-scoped access, rate limiting, search normalization, report date ranges, support assignment, webhook delivery event logs, notification broadcast foundation, and supporting Firestore indexes.

---

## Goals

| # | Feature | Commit |
|---|---------|--------|
| 1 | Plan document | `docs: add OfflineSMS phase 18 implementation plan` |
| 2 | Organization-scoped admin access helpers | `feat(admin): add organization-scoped admin access helpers` |
| 3 | Rate limiting for search and exports | `feat(admin): add rate limiting for search and exports` |
| 4 | Search normalization + backfill script | `feat(admin): add search normalization and backfill script` |
| 5 | Report date-range controls (7d/30d/90d) | `feat(admin): add report date-range controls` |
| 6 | Support assignment workflow | `feat(admin): add support assignment workflow` |
| 7 | Webhook delivery event logs | `feat(admin): add webhook delivery event logs` |
| 8 | Notification broadcast foundation | `feat(admin): add notification broadcast foundation` |
| 9 | Firestore indexes | `chore(firebase): add Phase 18 indexes` |
| 10 | Phase log update | `docs: update phase log for phase 18` |

---

## Security Constraints (Preserved from All Prior Phases)

- Do NOT expose private message content, SMS body, full phone numbers, payment secrets, OTPs/tokens/secrets
- Do NOT mention Twilio, Vonage, MessageBird, Stripe, PayPal, or any provider names in UI
- Do NOT implement admin wallet balance adjustment, admin refunds, real payment-provider UI
- Do NOT implement media messages, mobile calls, full moderation workflow
- Do NOT break Phase 8–17 features

---

## Feature Specs

### 2. Organization-Scoped Admin Access

**Problem:** `SessionUser.claims` contains a `role` string but no `organizationId`. `organization_admin` users currently see all data across all orgs.

**Solution:**
- `lib/adminScope.ts` — read `organizationId` from `session.user.claims.organizationId` (type: `string | undefined`)
- `getAdminScope(session)` → `{ organizationId?: string }` — null if super_admin/legacy/bootstrap (see all)
- `applyOrgScope(query, scope, field?)` → applies `where('organizationId', '==', scope.organizationId)` only when scope has an org
- `canViewOrganization(session, orgId)` → true if super_admin or claims.organizationId === orgId
- Data helpers updated: users, groups, conversations, tickets, SMS batches scoped when `organizationId` present
- A new callable `adminSetOrgRole` in functions lets super_admin assign `role + organizationId` together
- **No UI changes to user-facing pages** — only data layer gates

### 3. Rate Limiting

**In-memory Map** (no Redis dependency, ephemeral per process, acceptable for low-traffic admin routes):

```
lib/rateLimit.ts
  - interface RateLimitOptions { maxRequests: number; windowMs: number }
  - function checkRateLimit(key: string, opts: RateLimitOptions): { ok: boolean; retryAfterMs?: number }
  - internal cleanup: delete entries older than 2× window on each call
```

Applied:
| Route | Limit |
|-------|-------|
| GET /admin/search | 60 req / 60s per uid |
| GET /admin/*/export | 10 req / 3600s per uid |
| GET /admin/audit/export | 5 req / 3600s per uid |

Returns 429 JSON `{ error: 'Rate limit exceeded. Try again in Xs.' }` — no Retry-After header needed (admin-only routes).

### 4. Search Normalization

**Fields to add:**
- `users.displayNameLower` — lowercase display name for prefix search
- `conversations.nameLower` — lowercase group name for prefix search

**Backfill script:** `scripts/backfillSearchFields.ts`
- Dry-run by default (prints what would change)
- `--write` flag performs the update in batches of 400
- Processes `users` (displayName → displayNameLower) and `conversations` where `type=group` (name → nameLower)

**Search route update:**
- When `displayNameLower` prefix search available, include alongside `usernameLower`
- Groups: search on `nameLower` prefix when available (falls back gracefully)

### 5. Report Date-Range Controls

Add `?range=7d|30d|90d` query param to `/admin/reports/page.tsx`. Default: `7d`.

- `RangePicker` client component (pill buttons: 7d / 30d / 90d) updates URL without full page reload via `<Link>`
- All aggregate counts and trend data respect the selected range
- Trend table changes: 7d = 7 rows, 30d = 30 rows, 90d = 30 weekly-bucketed rows (avoids 90 sequential queries)

### 6. Support Assignment Workflow

**New server action** `assignSupportTicket(ticketId, assigneeUid | null)` in `supportActions.ts`:
- Requires `manage:support`
- Writes `assignedTo` field + `updatedAt`
- Audit: `support.ticket.assigned` / `support.ticket.unassigned` / `support.ticket.reassigned`

**New client component** `TicketAssignAction.tsx`:
- Text input for assignee UID (with clear button for unassign)
- Shows current assignee
- Optimistic disable during submit

**Ticket detail page** updated:
- Assignment UI below status update (only for `canManage`)

**Support list page** updated:
- `?assignedTo=<uid>` filter param
- Assignee filter input in the filter bar

### 7. Webhook Delivery Event Logs

On `/admin/sms/[batchId]/page.tsx`, add a new `DetailCard` section:
- Read from `smsDeliveryEvents` collection where `offlineSmsBatchId == batchId`
- Order by `receivedAt` desc, limit 50
- Columns: event ID (truncated), status, receivedAt, processedAt, result
- No raw webhook payload, no phone number, no SMS body shown
- Soft-fail: if collection absent, skip the card

New `adminData.ts` helper: `listDeliveryEvents(batchId, cursor?)` → `AdminDeliveryEventRow[]`

### 8. Notification Broadcast Foundation

**New page:** `/admin/notifications/page.tsx`
- Gated by `view:notifications`
- Draft form: title (required, ≤140 chars), body (required, ≤500 chars), audience dropdown (all / organization / group)
- Preview card showing how the notification will look
- "Save draft" → writes `notifications/{id}` with `{ title, body, audience, status: 'draft', createdBy, createdAt, updatedAt }`
- "Send broadcast" button present but **disabled** with tooltip: "Broadcast sending will be enabled after notification infrastructure is implemented."
- Draft list: most recent 10 drafts
- Audit: `notification.draft.created`

**Nav update:** Bell icon, `view:notifications` capability

---

## Firestore Index Plan

```json
{ "collectionGroup": "users",              fields: [organizationId ASC, createdAt DESC] }
{ "collectionGroup": "users",              fields: [displayNameLower ASC, createdAt DESC] }
{ "collectionGroup": "conversations",      fields: [nameLower ASC, updatedAt DESC] }
{ "collectionGroup": "tickets",            fields: [assignedTo ASC, status ASC, updatedAt DESC] }
{ "collectionGroup": "smsDeliveryEvents",  fields: [offlineSmsBatchId ASC, receivedAt DESC] }
{ "collectionGroup": "notifications",      fields: [status ASC, createdAt DESC] }
{ "collectionGroup": "notifications",      fields: [createdBy ASC, createdAt DESC] }
```

---

## Non-Goals for Phase 18

- Real push notification delivery (FCM/APNs)
- Full org-scope UI enforcement (header banner, org switcher)
- Moderation workflow beyond flags list
- Mobile notification inbox (Phase 19+)
- Redis-based distributed rate limiting (Phase 20+)
