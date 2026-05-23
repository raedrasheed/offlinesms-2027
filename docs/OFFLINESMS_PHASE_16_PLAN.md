# OfflineSMS Phase 16 — Firestore Indexes, Scheduled Jobs, Wallet Detail, Mobile Support, Audit Export, and Operational Foundations

## Objective

Harden the system operationally: deploy missing Firestore composite indexes, activate the stuck-batch reaper, add a wallet detail page, wire mobile support ticket creation to the admin queue, add redacted audit CSV export, and add calls and moderation foundation pages.

---

## Exact Scope

1. **Firestore composite indexes** — add all indexes missing for Phase 14/15 admin queries
2. **Activate reapStuckBatches scheduled function** — export from index.ts
3. **sweepExpiredMessages** — keep deferred (no client TTL UI yet; activating would silently delete message text)
4. **Wallet detail page** — `/admin/points/wallets/[uid]` with wallet summary, user info, transactions, freeze/unfreeze
5. **Fix tickets collection mismatch** — Phase 15 used `supportTickets`; Firestore rules use `tickets`; align to `tickets`
6. **Mobile support ticket creation** — `support.ts` lib + `SupportTicket.tsx` screen + Settings navigation entry + App.tsx registration
7. **Admin audit export** — `/admin/audit/export/route.ts` route handler returning CSV, row-limited, redacted, permission-gated
8. **Calls dashboard foundation** — real session guard, soft-fail `callLogs` read, EmptyState if collection absent
9. **Moderation foundation** — `/admin/moderation/page.tsx` reading `flags` collection
10. **Dashboard count refresh** — `RefreshButton` client component calling `router.refresh()`
11. **New capabilities** — `export:audit`, `view:moderation`

---

## Dashboard Files Affected

### New files
- `apps/dashboard/app/admin/points/wallets/[uid]/page.tsx`
- `apps/dashboard/app/admin/audit/export/route.ts`
- `apps/dashboard/app/admin/moderation/page.tsx`
- `apps/dashboard/app/admin/page.tsx` (RefreshButton inline client component)

### Modified files
- `apps/dashboard/lib/adminPermissions.ts` — export:audit, view:moderation
- `apps/dashboard/lib/adminData.ts` — fix tickets collection, add getWallet
- `apps/dashboard/lib/supportActions.ts` — fix tickets collection
- `apps/dashboard/app/admin/support/page.tsx` — fix createdBy field
- `apps/dashboard/app/admin/support/[ticketId]/page.tsx` — fix createdBy field
- `apps/dashboard/app/admin/audit/page.tsx` — add Export CSV button
- `apps/dashboard/app/admin/calls/page.tsx` — proper session guard
- `apps/dashboard/app/admin/points/wallets/page.tsx` — link rows to detail
- `apps/dashboard/lib/adminNav.ts` — add Moderation nav item

---

## Mobile Files Affected

### New files
- `apps/mobile/src/lib/support.ts`
- `apps/mobile/src/screens/SupportTicket.tsx`

### Modified files
- `apps/mobile/App.tsx` — register SupportTicket screen
- `apps/mobile/src/screens/Settings.tsx` — add Help & Support row

---

## Functions Affected

### Modified files
- `functions/src/index.ts` — export reapStuckBatches

---

## Firestore Indexes to Add

All additions to `firestore.indexes.json`:

| Collection | Fields | Reason |
|---|---|---|
| `auditLogs` | action ASC, createdAt DESC | Audit filter: action= |
| `auditLogs` | result ASC, createdAt DESC | Audit filter: result= |
| `conversations` | type ASC, status ASC | Dashboard count: active groups |
| `smsBatches` | status ASC, createdAt DESC | Dashboard count + status filter |
| `wallets` | status ASC, updatedAt DESC | Wallets page status filter |
| `tickets` | status ASC, createdAt DESC | Support list status filter |
| `tickets` | category ASC, createdAt DESC | Support list category filter |
| `tickets` | createdBy ASC, createdAt DESC | Mobile: user's own tickets |

Already present (no change needed):
- `auditLogs actorUid + createdAt` ✓
- `auditLogs targetType + targetId + createdAt` ✓  
- `flags status + createdAt` ✓
- `tickets createdBy + status + updatedAt` ✓
- `smsBatches senderId + createdAt` ✓
- `transactions userId + createdAt` ✓

---

## Scheduled Functions

### reapStuckBatches
- **Status:** Code exists at `functions/src/sms/reapStuckBatches.ts`; activating in Phase 16
- **Schedule:** every 30 minutes (defined in the function)
- **Idempotency:** guarded by `pointsRefunded != null` check
- **Safety verified:** yes — transaction-level idempotency check prevents double-settling
- **Activation:** add export to `functions/src/index.ts`

### sweepExpiredMessages
- **Status:** Keep deferred — no client-side TTL setting UI exists yet
- **Risk:** activating would silently clear `text` field of messages with `expiresAt` set; no mobile UI to inform users
- **Phase:** schedule for Phase 20 alongside TTL setting UI

---

## RBAC / Capability Approach

New capabilities:

| Capability | Description | Roles |
|---|---|---|
| `export:audit` | Download audit log CSV | super_admin, auditor, legacy_admin, bootstrap_admin |
| `view:moderation` | View content flags/reports | super_admin, support_agent, organization_admin, auditor, legacy_admin, bootstrap_admin |

---

## Redaction Rules

Audit export CSV:
- Columns: id, timestamp, actorUid, actorEmail, action, targetType, targetId (first 16 chars), result, metadataFieldCount
- No raw metadata values, no SMS body, no phone numbers, no secrets

Moderation page:
- Show: flagId, type, targetType, targetId (truncated), status, createdAt
- No private content, no message bodies

Wallet detail:
- Email: `maskEmail(role)` applied
- Phone: `maskPhone()` always applied
- No balance adjustment actions

---

## Export Rate-Limit Strategy

- Hard row limit: 1 000 rows per export request
- No token/pagination for export (export always most recent N rows matching filters)
- No infrastructure rate-limiting in Phase 16 (document as Phase 17 to add request throttling)
- Each export writes audit log entry: `audit.exported`

---

## Tickets Collection Fix

Phase 15 bug: admin data helpers and server actions used `supportTickets` collection; Firestore rules enforce `tickets` collection.

Fix in Phase 16:
- `adminData.ts`: `supportTickets` → `tickets`, field `userId` → `createdBy`
- `supportActions.ts`: `supportTickets` → `tickets`
- Support UI pages: `ticket.userId` → `ticket.createdBy`

Mobile writes to `tickets` collection matching Firestore rules.

---

## Test Plan

- Firestore indexes JSON is valid (`firebase deploy --only firestore:indexes` succeeds locally)
- Audit log page no longer shows missing-index warning for `result=` and `action=` single filters
- Dashboard active groups count resolves (no missing-index error)
- SMS batch status filter works
- Wallets status filter works
- Support ticket list status/category filters work
- reapStuckBatches function builds and exports without error
- Wallet detail page loads with wallet data and masked user info
- Wallet detail shows recent transactions
- Freeze/unfreeze action works on wallet detail page
- Mobile SupportTicket screen renders without errors
- Mobile support ticket creation writes to `tickets` collection with correct schema
- Admin support queue displays user-created tickets
- Audit export returns CSV with correct headers
- Audit export is blocked for roles without `export:audit`
- Audit export limits to 1 000 rows
- Audit export metadata column shows field count (not raw values)
- Calls page shows EmptyState (no callLogs in collection)
- Moderation page shows flags with safe metadata
- Dashboard refresh button triggers a page refresh
- No private content in any new page
- No full phone numbers
- No secrets
- TypeScript clean (dashboard + functions + mobile if typecheck exists)
- next build passes

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| reapStuckBatches double-settles a batch | Idempotency key `pointsRefunded != null` prevents re-entry |
| Composite index missing on deploy | firestore.indexes.json deployment required; soft-fail in admin UI until then |
| CSV export unbounded on slow network | Row limit 1000; export is sequential not streamed |
| Mobile screen navigation not registered | App.tsx updated to register SupportTicket |
| tickets collection name mismatch causes empty support queue | Fixed in this phase |

---

## Rollback Plan

- `reapStuckBatches`: remove export from index.ts and redeploy functions
- Indexes: removing indexes from JSON and redeploying deactivates them (no data loss)
- All other changes are additive pages/routes (no breaking changes to existing code)

---

## Acceptance Criteria

1. Phase 16 plan document exists
2. Firestore composite indexes file updated and valid JSON
3. Index purposes documented
4. `reapStuckBatches` exported and builds without error
5. `sweepExpiredMessages` remains deferred with written justification
6. Wallet detail page exists at `/admin/points/wallets/[uid]`
7. Wallet detail shows wallet summary + transactions + freeze/unfreeze action
8. Wallet detail does not allow balance adjustment
9. Wallets list links to detail page
10. Tickets collection mismatch fixed (supportTickets → tickets)
11. Mobile SupportTicket screen exists
12. Mobile screen writes to `tickets` collection with correct schema
13. App.tsx registers SupportTicket screen
14. Settings.tsx has Help & Support row
15. Audit export route exists at `/admin/audit/export`
16. Audit export is gated by `export:audit` capability
17. Audit export hard-limits to 1 000 rows
18. Audit export CSV contains no raw metadata values
19. Calls dashboard has real session guard and soft-fail callLogs read
20. Moderation page exists and reads `flags` collection safely
21. Dashboard refresh button exists
22. No admin wallet balance adjustment
23. No private message content
24. No SMS body exposed
25. No full phone numbers
26. No secrets
27. No provider names
28. tsc clean (dashboard + functions)
29. next build passes
30. Phase log updated
