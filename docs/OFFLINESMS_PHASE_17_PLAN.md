# OfflineSMS Phase 17 — Global Search, Export Foundation, Reporting, and Filtering Improvements

## Objective

Make the admin dashboard easier to navigate and inspect: activate the global search shell with capability-aware, redacted metadata search; add CSV export routes for key collections; build a real reporting/analytics foundation; and improve filtering/pagination across existing admin pages. No private content, SMS body, or full phone numbers are exposed anywhere.

---

## Exact Scope

1. **Global search foundation** — functional search route + UI shell
2. **New capabilities** — search:global, export:users, export:groups, export:sms, export:points, export:support, view:reports
3. **Filter/pagination improvements** — users, groups, transactions, payments pages
4. **Export routes** — users, groups, SMS batches, transactions, payments, support tickets
5. **Reports foundation** — /admin/reports real page with safe aggregate counts + 7-day trend tables
6. **Firestore indexes** — any new indexes required by Phase 17 queries
7. **Documentation** — plan, phase log, architecture, risk register, design map, data model, indexes

---

## Search Strategy

### Approach
Firestore-native prefix search using `>=` / `<=` range queries on lowercase string fields. No external search engine. Results are capability-scoped and per-group limited.

### Query Pattern
```
collection.where('field', '>=', q).where('field', '<=', q + '').limit(5)
```
Single-field range queries require only auto-indexed single-field indexes.

### Collections Searched

| Collection | Search field | Notes |
|---|---|---|
| `users` | `usernameLower` prefix; exact `uid` | Falls back to exact uid if q looks like uid (20+ alphanumeric chars) |
| `organizations` | `slug` prefix | slug is lowercase by convention |
| `conversations` (groups) | `name` prefix | Case-sensitive; known limitation documented |
| `smsBatches` | exact document id | Batch IDs are opaque; prefix not useful |
| `wallets` | exact document id (uid) | Wallets are keyed by uid |
| `payments` | exact document id | Payment IDs are opaque |
| `tickets` | exact document id | Ticket IDs are opaque |
| `auditLogs` | `action` prefix | e.g., searching "admin." returns admin actions |

### Limits
- Max 5 results per collection group
- Max 50 total results
- No unbounded scans
- No message body search
- No SMS body search
- No full phone number search

### Search Route
`GET /admin/search/route.ts`
- Input: `q` (required, min 2 chars), `type` (optional collection filter)
- Output: JSON `{ groups: SearchGroup[] }`
- Capability-aware: each collection gated by corresponding capability
- Debounced in client (300ms)

---

## Collections Searched by Role

| Role | Collections |
|---|---|
| super_admin | all |
| organization_admin | users, groups, smsBatches, tickets |
| support_agent | users, tickets |
| finance_admin | wallets, payments, transactions |
| auditor | users, auditLogs, smsBatches, payments |
| legacy_admin / bootstrap_admin | all |

---

## New Capabilities

| Capability | Description | Roles |
|---|---|---|
| `search:global` | Use admin global search | super_admin, org_admin, support_agent, finance_admin, auditor, legacy_admin, bootstrap_admin |
| `export:users` | Export users metadata CSV | super_admin, auditor, legacy_admin, bootstrap_admin |
| `export:groups` | Export groups metadata CSV | super_admin, organization_admin, auditor, legacy_admin, bootstrap_admin |
| `export:sms` | Export SMS batch list CSV | super_admin, organization_admin, auditor, legacy_admin, bootstrap_admin |
| `export:points` | Export transactions/payments CSV | super_admin, finance_admin, auditor, legacy_admin, bootstrap_admin |
| `export:support` | Export support tickets CSV | super_admin, support_agent, auditor, legacy_admin, bootstrap_admin |
| `view:reports` | View reports/analytics page | super_admin, finance_admin, auditor, organization_admin, legacy_admin, bootstrap_admin |

---

## Redaction Rules

All search results, exports, and reports redact:
- Full phone numbers → `maskPhone()` always applied
- Email → `maskEmail(role)` applied (full for super/support, masked for others)
- Message body → never included
- SMS body → never included
- Payment secrets / webhook keys / OTPs → never included
- Raw gateway payloads → never included

Export CSV columns per collection:

| Export | Columns |
|---|---|
| Users | uid, displayName, username, maskedEmail, maskedPhone, status, profileCompleted, smsOptOut, createdAt |
| Groups | id, name, status, memberCount, organizationId, createdAt |
| SMS batches | id, status, totalCount, sentCount, failedCount, pointsCost, createdAt |
| Transactions | id, uid, type, direction, amount, status, createdAt |
| Payments | id, userId, totalPoints, amount, currency, status, createdAt |
| Support tickets | id, subject, category, status, createdBy (uid only), createdAt, updatedAt |

---

## Export Strategy

- Shared helper `apps/dashboard/lib/exportHelper.ts` builds CSV strings
- Individual route files call helper with collection-specific logic
- Hard row limit: 1,000 rows per export
- Filters forwarded from page where practical (status, type, from, to)
- Each export writes audit log entry: `export.users`, `export.groups`, etc.
- No raw metadata values, no private content

---

## Reporting Strategy

`/admin/reports/page.tsx` sections:
1. **Overview cards** — 7 pre-computed safe aggregate counts
2. **SMS trends** — 7-day table (count per day for last 7 days)
3. **Support status breakdown** — count by status (open/pending/resolved/closed)
4. **Points summary** — total transactions this week, total points spent

Implementation: Parallel Firestore count aggregations with date range filters. No chart library required — simple HTML tables and number cards. Soft-fail on each query (shows `—` on error).

---

## Filter / Pagination Improvements

Pages updated with FilterBar and URL-param-driven filters:

| Page | New filters |
|---|---|
| Users | status (active/inactive/suspended), profileCompleted |
| Groups | status (active/locked/archived) |
| Transactions | type (purchase/spend/transfer/refund), uid |
| Payments | status (pending/completed/failed/refunded) |

Existing filter-enabled pages (no change needed):
- Support: status + category ✓
- SMS batches: status ✓  
- Wallets: status ✓
- Audit logs: actor/action/result/targetType/date ✓

Data helpers updated:
- `listUsers(cursor?, status?)` — adds status filter
- `listGroups(cursor?, status?)` — adds status filter
- `listTransactions(cursor?, uid?, type?)` — adds type filter
- `listPayments(cursor?, status?)` — adds status filter

---

## Firestore Indexes Required

New indexes for Phase 17 queries:

| Collection | Fields | Reason |
|---|---|---|
| `users` | `status` ASC, `createdAt` DESC | Users status filter |
| `transactions` | `type` ASC, `createdAt` DESC | Transactions type-only filter |
| `payments` | `status` ASC, `createdAt` DESC | Payments status filter |
| `conversations` | `status` ASC, `updatedAt` DESC | Groups status filter |

Single-field indexes used by search prefix queries are auto-created by Firestore (no manual index needed for `usernameLower`, `slug`, `name` individual range queries).

Already-present indexes used by reports:
- `smsBatches`: `createdAt` (single-field auto)
- `tickets`: `status + createdAt DESC` ✓ (added Phase 16)
- `transactions`: `createdAt` (single-field auto)

---

## Performance Limits

- Search: max 5 results/group, 50 total, 300ms debounce in client
- Exports: max 1,000 rows hard limit
- Reports: max 7 parallel count queries, each capped by date range
- All lists: 50 per page (no change)
- No unbounded collection scans

---

## Test Plan

- Global search opens with ⌘K; Escape closes
- Search returns grouped results within 300ms debounce
- Search does not include message bodies or SMS bodies
- Search does not expose full phone numbers
- Support agent only sees users/tickets in search
- Finance admin only sees wallets/payments in search
- Users export: correct columns, masked phone, masked email, no secrets
- Groups export: correct columns, no member contact info
- SMS export: no SMS body, no gateway payload
- Transactions export: no secrets, correct direction sign
- Payments export: no payment secrets
- Support export: subject/category/status only (no description body)
- Users page: status filter works via URL params
- Groups page: status filter works
- Transactions page: type filter works
- Payments page: status filter works
- Reports page loads with counts
- 7-day SMS trend table shows daily counts
- Support status breakdown shows open/pending/resolved/closed
- All export routes write audit log entries
- No provider names in any page
- TypeScript clean, build passes

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Firestore prefix search returns too many results | Hard limit 5 per group, 50 total |
| Export unbounded on slow network | Row limit 1000; sequential not streamed |
| Search role-scoping bypass | Server-side capability check on every search call |
| Reports query missing index | Soft-fail; show `—` on missing index |
| FilterBar double-encode of cursor | `cursor` param deleted whenever a filter changes (existing FilterBar behaviour) |
| usernameLower field absent on old users | Falls back to empty results; documented limitation |

---

## Rollback Plan

- All changes are additive (new routes, new filter params, new page)
- Removing a filter param from a page has no data impact
- Export routes can be removed without data loss
- Search route removal degrades search to placeholder; no data impact
- Index additions: removing from JSON and redeploying deactivates them (no data loss)

---

## Acceptance Criteria

1. Phase 17 plan document exists
2. Global search route exists and returns grouped JSON
3. AdminGlobalSearchShell functional with debounced fetch and grouped results UI
4. Search is capability-aware (server-side check)
5. Search results are redacted (no full phones, no message bodies)
6. Users, groups, transactions, payments pages have FilterBar with URL-param filters
7. /admin/users/export route exists and is gated by export:users
8. /admin/groups/export route exists and is gated by export:groups
9. /admin/sms/export route exists and is gated by export:sms
10. /admin/points/transactions/export route exists and is gated by export:points
11. /admin/points/payments/export route exists and is gated by export:points
12. /admin/support/export route exists and is gated by export:support
13. All exports: row-limited (1000), redacted, audited, CSV format
14. /admin/reports page has real aggregate counts
15. Reports page has 7-day SMS trend table
16. Reports page has support status breakdown
17. New Firestore indexes added and documented
18. No private content exposed anywhere
19. No secrets, no provider names
20. TypeScript clean (dashboard + functions)
21. next build passes
22. Phase log updated
