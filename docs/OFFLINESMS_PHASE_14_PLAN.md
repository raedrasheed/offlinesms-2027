# Phase 14 Plan — Admin Controls, SMS Dashboard, Points Overview, Roles

**Status:** In progress  
**Branch:** `claude/repo-audit-architecture-MiZDX`

## Objective

Fix the Phase 13 known limitation (GroupLockAction requires group membership), add
organization write actions, implement real read-only SMS batch and Points overview
dashboards, and build the Roles assignment foundation.

## Exact Scope

### 1. Admin-native group lock
- `functions/src/admin/adminLockGroup.ts` — callable, no membership requirement,
  requires `admin=true` claim, audited.
- Update `GroupLockAction.tsx` to call `adminLockGroup` instead of `lockGroup`.

### 2. Organizations create/edit
- `apps/dashboard/app/admin/organizations/new/page.tsx` — create form (server action).
- `apps/dashboard/app/admin/organizations/[orgId]/edit/page.tsx` — edit form (server action).
- `apps/dashboard/lib/orgActions.ts` — server actions for create/update, with validation,
  slug-uniqueness check, audit log.

### 3. Admin SMS dashboard
- `apps/dashboard/app/admin/sms/page.tsx` — replaces placeholder with real batch list.
- `apps/dashboard/app/admin/sms/[batchId]/page.tsx` — batch detail: summary cards,
  metadata, recipient table (masked phones, no SMS/message body).

### 4. Admin Points overview
- `apps/dashboard/app/admin/points/page.tsx` — replaces placeholder with nav hub + summary.
- `apps/dashboard/app/admin/points/wallets/page.tsx` — wallet list, read-only.
- `apps/dashboard/app/admin/points/transactions/page.tsx` — transaction list, read-only.
- `apps/dashboard/app/admin/points/payments/page.tsx` — payment list, read-only.
- `apps/dashboard/app/admin/points/packages/page.tsx` — packages list, read-only.

### 5. Admin Roles foundation
- `functions/src/admin/adminSetRole.ts` — callable, requires super_admin claim,
  protects last super_admin, audited.
- `apps/dashboard/app/admin/roles/page.tsx` — replaces placeholder with admin user list.
- `apps/dashboard/app/admin/roles/[uid]/page.tsx` — role detail + assignment form.

### 6. Admin data helpers extension
- Add to `apps/dashboard/lib/adminData.ts`:
  `listSmsBatches`, `getSmsBatch`, `listSmsBatchRecipients`,
  `listWallets`, `listTransactions`, `listPayments`, `listPointsPackages`,
  `listAdminUsers`.

### 7. Capabilities
- Add: `'manage:organizations'`, `'manage:roles'`, `'manage:sms'`

## Files Changed

```
docs/OFFLINESMS_PHASE_14_PLAN.md                         (new)
functions/src/admin/adminLockGroup.ts                    (new)
functions/src/admin/adminSetRole.ts                      (new)
functions/src/index.ts                                   (update)
apps/dashboard/lib/adminData.ts                          (update — 8 new helpers)
apps/dashboard/lib/adminPermissions.ts                   (update — 3 new capabilities)
apps/dashboard/lib/orgActions.ts                         (new — server actions)
apps/dashboard/app/admin/groups/[conversationId]/GroupLockAction.tsx  (update)
apps/dashboard/app/admin/organizations/new/page.tsx      (new)
apps/dashboard/app/admin/organizations/[orgId]/edit/page.tsx (new)
apps/dashboard/app/admin/sms/page.tsx                    (replace)
apps/dashboard/app/admin/sms/[batchId]/page.tsx          (new)
apps/dashboard/app/admin/points/page.tsx                 (replace)
apps/dashboard/app/admin/points/wallets/page.tsx         (new)
apps/dashboard/app/admin/points/transactions/page.tsx    (new)
apps/dashboard/app/admin/points/payments/page.tsx        (new)
apps/dashboard/app/admin/points/packages/page.tsx        (new)
apps/dashboard/app/admin/roles/page.tsx                  (replace)
apps/dashboard/app/admin/roles/[uid]/page.tsx            (new)
docs/OFFLINESMS_PHASE_LOG.md                             (update)
```

## Firestore Collections Read/Written

| Collection             | Operation | Purpose                           |
|------------------------|-----------|-----------------------------------|
| `conversations`        | read/write| adminLockGroup                    |
| `organizations`        | read/write| create/edit org server actions    |
| `smsBatches`           | read      | SMS batch list + detail           |
| `smsBatches/{id}/recipients` | read | Batch recipient table (masked phone) |
| `wallets`              | read      | Wallet list                       |
| `transactions`         | read      | Transaction list                  |
| `payments`             | read      | Payment list                      |
| `pointsPackages`       | read      | Package list                      |
| `users`                | read      | List admin users (roles page)     |
| `auditLogs`            | write     | All write actions                 |

## RBAC / Capability Approach

New capabilities:
- `manage:organizations` — super_admin, legacy_admin, bootstrap_admin
- `manage:roles` — super_admin only (to prevent privilege escalation)
- `manage:sms` — super_admin (for future retry actions; not yet enabled)

Existing capabilities reused:
- `view:sms` — SMS batch list/detail
- `view:points` — Points wallets/transactions/payments/packages
- `manage:groups` — adminLockGroup action
- `view:roles` — roles list/detail page

## Redaction Rules

| Field                    | Rule                                          |
|--------------------------|-----------------------------------------------|
| Recipient phone          | Always masked via `maskPhone()`               |
| SMS body                 | Never shown                                   |
| Message body             | Never shown                                   |
| `offlineSmsMessageId`    | Shown as metadata only (no body)              |
| `gatewayErrorMessage`    | Shown (already sanitised by webhook handler)  |
| `phoneHash`              | Never shown (server-only field)               |
| Payment `externalId`     | Shown (no PII per data model)                 |
| Payment `provider`       | Shown as-is (already redacted at write time)  |

## adminLockGroup Safety

1. Require `admin=true` claim (not just any group member).
2. Validate conversation exists + is type=group.
3. No membership check — intentionally bypassed for admin use.
4. Update `status` to `'locked'` or `'active'`.
5. Audit log: `admin.group.locked` / `admin.group.unlocked`.
6. Mobile `lockGroup` callable unchanged — group admins still use it.

## adminSetRole Safety

1. Require `role === 'super_admin'` in claims (only super_admins assign roles).
2. Prevent self-demotion.
3. Count remaining super_admins before allowing demotion of a super_admin —
   refuse if it would leave zero.
4. Validate target role is in `ADMIN_ROLES` or null (to clear role).
5. Audit log: `admin.role.set`.
6. Updates Firebase Auth custom claims via Admin SDK.

## Organization Server Actions Safety

1. `'use server'` + re-verify session inside each action.
2. Check `manage:organizations` capability.
3. Validate slug: lowercase alphanumeric + hyphens, 2–40 chars.
4. Check slug uniqueness before create.
5. Audit log: `organization.created` / `organization.updated`.
6. No client-side write path.

## Rollback Plan

All changes are additive. Rollback = `git revert` of Phase 14 commits.
Phase 13 pages, Phase 12 shell, Phase 1 guard, and mobile app are unaffected.

## Acceptance Criteria

1. Phase 14 plan committed first
2. `adminLockGroup` callable exists and requires admin claim
3. GroupLockAction calls `adminLockGroup` (no membership dependency)
4. Organization create/edit pages exist with server actions
5. SMS batch list shows batches with no SMS/message body
6. SMS batch detail shows masked phones only
7. Retry failed SMS action is disabled/deferred (not yet safe from dashboard)
8. Points wallets list is read-only
9. Points transactions list is read-only
10. Points payments list is read-only
11. Points packages list is read-only
12. No wallet adjustment action exists
13. Roles page lists admin users with current role
14. Role assignment protected against last-super_admin lockout
15. typecheck passes (dashboard + functions)
16. build passes
17. Phase log updated
