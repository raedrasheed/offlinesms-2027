# Phase 13 Plan — Admin Management Foundations

**Status:** In progress  
**Branch:** `claude/repo-audit-architecture-MiZDX`

## Objective

Build read-only and limited-write admin management views for Users, Organizations,
Groups, and Communities using the Phase 12 RBAC shell. Server-side only via
Firebase Admin SDK. No private content exposure. All writes audit-logged.

## Scope

### In scope

1. **Admin Users module** — server-side list + detail page, phone/email masked, wallet
   balance read-only, groups membership, recent audit logs, suspend/reactivate
   action backed by a new `setUserStatus` callable.
2. **Admin Organizations module** — server-side list + detail page (users tab, groups
   tab, settings read-only). No write actions (organization write deferred to Phase 14).
3. **Admin Groups module** — server-side list + detail page with members table.
   Lock/unlock group safe action via `adminLockGroup` server action (wraps existing
   `lockGroup` callable logic via Admin SDK, without requiring caller membership).
4. **Admin Communities foundation** — scaffold pages; empty state if collection absent.
5. **Shared table primitives** — `DataTable`, `StatusBadge`, `MetadataList`,
   `DetailCard`, `FilterBar` components under `components/admin/`.
6. **Admin data helpers** — `lib/adminData.ts` for all server-side Firestore reads.
7. **Redaction helpers** — `lib/redaction.ts` with `maskPhone`, `maskEmail`,
   `safeUserSummary`, `safeDate`.
8. **Capability map extension** — add `view:organizations`, `manage:users`,
   `view:communities` capabilities.
9. **Navigation update** — add Organizations, Communities to sidebar config.

### Out of scope

- Admin conversations/messages module
- Admin SMS reports module
- Admin Points/wallet management
- Admin wallet adjustment
- Payment/billing dashboard
- Moderation tooling
- Full analytics
- Global search implementation
- Full communities feature
- Any exposure of private message content, SMS bodies, full phone numbers,
  payment secrets, or third-party provider names

## Files Changed

```
docs/OFFLINESMS_PHASE_13_PLAN.md                    (new)
apps/dashboard/lib/redaction.ts                     (new)
apps/dashboard/lib/adminData.ts                     (new)
apps/dashboard/lib/adminPermissions.ts              (update)
apps/dashboard/lib/adminNav.ts                      (update)
apps/dashboard/components/admin/DataTable.tsx       (new)
apps/dashboard/components/admin/StatusBadge.tsx     (new)
apps/dashboard/components/admin/MetadataList.tsx    (new)
apps/dashboard/components/admin/DetailCard.tsx      (new)
apps/dashboard/components/admin/FilterBar.tsx       (new)
apps/dashboard/app/admin/users/page.tsx             (replace)
apps/dashboard/app/admin/users/[uid]/page.tsx       (new)
apps/dashboard/app/admin/organizations/page.tsx     (new)
apps/dashboard/app/admin/organizations/[orgId]/page.tsx (new)
apps/dashboard/app/admin/groups/page.tsx            (replace)
apps/dashboard/app/admin/groups/[conversationId]/page.tsx (new)
apps/dashboard/app/admin/communities/page.tsx       (new)
apps/dashboard/app/admin/communities/[communityId]/page.tsx (new)
functions/src/admin/setUserStatus.ts                (new)
functions/src/index.ts                              (update — export setUserStatus)
docs/OFFLINESMS_PHASE_LOG.md                        (update)
```

## Firestore Collections Read

| Collection           | Purpose                                    |
|----------------------|--------------------------------------------|
| `users/{uid}`        | User list + detail                         |
| `wallets/{uid}`      | Wallet balance for user detail (read-only) |
| `conversations`      | Groups list (type=group)                   |
| `conversations/{id}/members` | Group members tab                 |
| `organizations`      | Organizations list + detail                |
| `organizations/{id}/members` | Org members tab                   |
| `auditLogs`          | Recent activity for user/group detail      |

## Callables/Actions Reused

| Action          | Source                                      |
|-----------------|---------------------------------------------|
| `setUserStatus` | New server action (Admin SDK, audited)      |
| `adminLockGroup`| New server action (Admin SDK, audited)      |

## RBAC / Capability Approach

New capabilities added:
- `view:organizations` — org list + detail
- `manage:users` — suspend/reactivate action (super_admin only)
- `view:communities` — communities list + detail

UX filtering: `canDo(role, capability)` in `Sidebar` and page-level guards.
Security enforcement: every page server-component re-verifies session via
`verifySession()` and checks capability before any Firestore read.

## Sensitive Data Redaction Rules

| Field        | Rule                                          |
|--------------|-----------------------------------------------|
| Phone number | Always masked: `+XXX *** *** 1234`            |
| Email        | Shown to super_admin, support_agent; masked otherwise |
| Message body | Never shown (metadata only for groups)        |
| SMS body     | Never shown                                   |
| Payment data | Never shown; wallet balance is count only     |
| OTP / tokens | Never shown                                   |

## Pagination Strategy

- Default page size: 50 documents
- Cursor-based via `?cursor=<lastDocId>` (Firestore `startAfter`)
- `orderBy('createdAt', 'desc')` on all lists
- `limit(50)` enforced in every helper

## setUserStatus Callable Safety

- Requires admin claim on caller
- Prevents self-suspension
- Prevents lower-privileged admin from suspending super_admin
- Validates status transition (active → suspended, suspended → active only)
- Writes audit log regardless of outcome
- Updates `users/{uid}.status` and `users/{uid}.updatedAt`

## Risk Assessment

| Risk                              | Mitigation                                              |
|-----------------------------------|---------------------------------------------------------|
| Phone number exposure             | `maskPhone()` applied everywhere; server-side only      |
| Privilege escalation via UI       | Server re-validates role on every request               |
| Admin SDK bypasses rules          | Security enforced in server helpers, not Firestore rules|
| Unauthorized suspend action       | Callable checks admin claim + role + self-check         |
| Communities collection absent     | `try/catch` around fetch; empty state shown gracefully  |

## Rollback Plan

All changes are additive (new pages, new components, new callable). Rollback
is `git revert` of the Phase 13 commits. The Phase 12 shell, Phase 1 guard, and
mobile app are unaffected.

## Acceptance Criteria

1. Phase 13 plan committed first
2. typecheck passes across all workspaces
3. lint passes across all workspaces
4. build passes (dashboard + functions)
5. Users list shows masked phones, safe status badges
6. User detail shows groups summary and wallet balance (not full transaction list)
7. Organizations list loads or shows safe empty state
8. Organization detail has tabs (users, groups, settings)
9. Groups list loads or shows safe empty state
10. Group detail shows members table (no message bodies)
11. Communities page shows scaffold/empty state
12. Suspend/reactivate action is capability-gated (super_admin only)
13. Non-admins still blocked at Phase 1 guard
14. Finance admin cannot see group management actions
15. Auditor sees read-only pages with no management buttons
16. Phase 12 audit log still works
17. Sidebar filters correctly by role
