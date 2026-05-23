# OfflineSMS Phase 15 — Admin Operations Hardening and Controlled Admin Actions

## Objective

Harden admin operations and add controlled write actions for wallets, points packages, SMS retry, support queue, system settings, dashboard real counts, audit log filters, and improved admin user pagination.

---

## Exact Scope

1. **Wallet freeze/unfreeze** — `adminSetWalletStatus` callable + `WalletFreezeAction` client component
2. **Points package create/edit** — `packageActions.ts` server actions + `/admin/points/packages/new` and `/admin/points/packages/[packageId]/edit` pages
3. **SMS retry from dashboard** — update `retryFailedSmsRecipients` to allow role-based admin + `SmsRetryAction` client component on batch detail
4. **Support queue foundation** — `/admin/support` list + `/admin/support/[ticketId]` detail + `TicketStatusAction` + `supportActions.ts`
5. **Admin settings foundation** — `/admin/settings` real implementation + `settingsActions.ts`
6. **Dashboard real counts** — replace hardcoded stats with Firestore count aggregation
7. **Audit log filters** — actor, action, targetType, result, from/to date range via query params
8. **Admin user pagination** — upgrade `listAdminUsers` to use `Auth.listUsers()` pagination

---

## Dashboard Files Affected

### New files
- `apps/dashboard/lib/packageActions.ts`
- `apps/dashboard/lib/supportActions.ts`
- `apps/dashboard/lib/settingsActions.ts`
- `apps/dashboard/app/admin/points/wallets/WalletFreezeAction.tsx`
- `apps/dashboard/app/admin/points/packages/new/page.tsx`
- `apps/dashboard/app/admin/points/packages/[packageId]/edit/page.tsx`
- `apps/dashboard/app/admin/sms/[batchId]/SmsRetryAction.tsx`
- `apps/dashboard/app/admin/support/[ticketId]/page.tsx`
- `apps/dashboard/app/admin/support/[ticketId]/TicketStatusAction.tsx`

### Modified files
- `apps/dashboard/lib/adminPermissions.ts` — new capabilities
- `apps/dashboard/lib/adminData.ts` — new helpers, upgraded listAdminUsers
- `apps/dashboard/app/admin/points/wallets/page.tsx` — freeze action column
- `apps/dashboard/app/admin/points/packages/page.tsx` — create link + manage links
- `apps/dashboard/app/admin/sms/[batchId]/page.tsx` — enable retry action
- `apps/dashboard/app/admin/support/page.tsx` — real implementation
- `apps/dashboard/app/admin/settings/page.tsx` — real implementation
- `apps/dashboard/app/admin/page.tsx` — real Firestore counts
- `apps/dashboard/app/admin/audit/page.tsx` — filter support
- `apps/dashboard/app/admin/roles/page.tsx` — use upgraded listAdminUsers

---

## Functions / Callables Affected

### New files
- `functions/src/admin/adminSetWalletStatus.ts`

### Modified files
- `functions/src/index.ts` — export adminSetWalletStatus
- `functions/src/sms/retryFailed.ts` — extend senderIsAdmin to include role-claim check

---

## Firestore Collections Read / Written

| Collection | Read | Written | Notes |
|---|---|---|---|
| `wallets` | yes | yes (status field only) | Freeze/unfreeze |
| `pointsPackages` | yes | yes | Create/edit |
| `supportTickets` | yes | yes (status field) | New collection |
| `systemSettings` (doc: `general`) | yes | yes | New document |
| `auditLogs` | yes | yes | All write actions |
| `smsBatches` | yes | no | Dashboard counts |
| `conversations` | yes | no | Dashboard counts |
| `users` | yes | no | Dashboard counts |
| `payments` | yes | no | Dashboard counts |

---

## RBAC / Capability Approach

### New capabilities added to `AdminCapability`

| Capability | Description |
|---|---|
| `manage:wallets` | Freeze / unfreeze wallets |
| `manage:packages` | Create / edit points packages |
| `retry:sms` | Retry failed SMS batches from dashboard |
| `manage:support` | Update support ticket status |
| `manage:settings` | Update system settings |

### Role → new capability mapping

| Role | New capabilities |
|---|---|
| `super_admin` | all five |
| `organization_admin` | `retry:sms` |
| `support_agent` | `manage:support` |
| `finance_admin` | `manage:wallets`, `manage:packages` |
| `auditor` | none |
| `legacy_admin` | all five |
| `bootstrap_admin` | all five |

---

## Redaction Rules

- Full phone numbers: never displayed — `maskPhone()` always applied
- Email: `maskEmail(role)` applied — only shown in full to super_admin, legacy_admin, bootstrap_admin, support_agent
- Support ticket `description`: user-submitted freetext, may be displayed as-is (it is user support content, not private messages); HTML-unsafe chars must not be rendered raw (React escapes by default)
- Audit log `metadata`: display field count only, no raw payload values
- System settings: no secrets, API keys, webhook URLs, or tokens stored/displayed
- Package fields: all safe (name, points, price, currency, status)

---

## Audit Requirements

| Action | Event string |
|---|---|
| Wallet frozen | `admin.wallet.frozen` |
| Wallet unfrozen | `admin.wallet.unfrozen` |
| Package created | `points.package.created` |
| Package updated | `points.package.updated` |
| Package enabled | `points.package.enabled` |
| Package disabled | `points.package.disabled` |
| Ticket status changed | `support.ticket.status_changed` |
| Settings updated | `system.settings.updated` |

All audit writes via the shared `writeAuditLog` helper or inline `adminDb.collection('auditLogs').add()` pattern. All are soft-failing.

---

## Dashboard Count Strategy

Use Firestore count aggregation (`collection.count().get()`) which is read-cheap (one read per aggregation regardless of matching docs). Counts that touch large collections without a restrictive where clause are labelled "approximate" in the UI.

| Card | Query | Label |
|---|---|---|
| Total users | `users.count()` | "Approximate" (can be large) |
| Active groups | `conversations.where(type==group).where(status==active).count()` | Exact |
| SMS batches today | `smsBatches.where(createdAt >= today).count()` | Exact |
| Failed SMS | `smsBatches.where(status==failed).count()` | Exact |
| Open tickets | `supportTickets.where(status==open).count()` | Exact |
| Wallets | `wallets.count()` | "Approximate" |
| Pending payments | `payments.where(status==pending).count()` | Exact |

All count queries are wrapped in `Promise.all` and soft-failing (fall back to `—` on error).

---

## Support / Settings Strategy

### Support
- `supportTickets/{id}` Firestore collection (admin creates via dashboard or mobile app creates)
- Firestore document schema: `{ subject, category, status, userId, assignedTo, description, createdAt, updatedAt }`
- Status transitions: `open → pending → resolved → closed`
- Status update via server action (re-verifies session + capability)

### Settings
- `systemSettings/general` Firestore document
- Fields: `appName`, `supportEmail`, `defaultLanguage`, `defaultTimezone`, `smsEscalationEnabled`, `pointsEnabled`, `maintenanceMode` (display-only)
- Update via server action (re-verifies session + `manage:settings` capability)
- Email validated server-side; language/timezone from allow-list; no secrets stored

---

## Test Plan

- Super admin can freeze/unfreeze wallet → audit log written
- Finance admin can freeze/unfreeze wallet
- Support agent CANNOT freeze wallet (no `manage:wallets`)
- Frozen wallet balance unchanged (only status field written)
- Package create validates all fields server-side
- Package edit validates all fields server-side
- Package create/update writes audit log
- SMS retry button appears for roles with `retry:sms`
- SMS retry does not show SMS body
- Retry calls existing callable with correct batchId
- Support list shows all tickets
- Support ticket detail shows metadata + description (no private message body)
- Ticket status update writes audit log
- Settings load from Firestore (fallback to safe defaults)
- Settings update validates email format
- Settings update writes audit log
- Dashboard counts load without scanning entire collection
- Audit filters narrow results correctly
- Auth.listUsers pagination covers more than 200 users
- Last-super_admin guard still prevents demotion when only one remains
- Non-admin user is blocked at layout

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `count()` aggregation not available in emulator | Soft-fail fallback to `—` |
| Auth.listUsers rate limit | Cap at 3 pages (3 000 users) |
| adminSetRole last-super_admin count uses Firestore scan | Upgrade to use Auth.listUsers in Phase 15 |
| Audit log index required for combined filters | Only single-field filters supported; document combos that need indexes |
| Support tickets collection may not exist | Soft-fail on fetch; empty state shown |
| systemSettings/general doc may not exist | Fallback to safe defaults on read |

---

## Rollback Plan

All changes are additive:
- New callables are independent exports
- New server actions are independent modules
- New pages are independent routes
- Modified pages fall back gracefully on errors
- Reverting a commit restores prior state without cascading failures

---

## Acceptance Criteria

1. Plan document exists (this file)
2. `adminSetWalletStatus` callable exists and is exported
3. Wallet freeze/unfreeze UI on wallets page
4. Wallet actions gated by `manage:wallets` both client-side and server-side
5. Wallet freeze/unfreeze writes audit log
6. Freeze does not modify balance or reserved amounts
7. Package create page exists and validates
8. Package edit page exists and validates
9. Package writes audit log
10. SMS retry button appears on batch detail when failedCount > 0 and `retry:sms` capability present
11. SMS retry does not expose SMS body or full phones
12. Support list page exists (real implementation, not stub)
13. Support ticket detail page exists
14. Ticket status update writes audit log
15. Settings page shows real data (not stub)
16. Settings update validates and writes audit log
17. Dashboard counts are real Firestore counts (labelled where approximate)
18. Audit log page has filter inputs for actor, action, targetType, result, from, to
19. `listAdminUsers` uses Auth.listUsers pagination
20. Last-super_admin guard remains safe
21. No admin wallet balance adjustment
22. No refunds
23. No private message content exposed
24. No SMS body exposed
25. No full phone numbers
26. No secrets
27. No provider names
28. `tsc --noEmit` passes (dashboard + functions)
29. `next build` passes
30. Phase log updated
