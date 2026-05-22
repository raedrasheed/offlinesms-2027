# Phase 12 Plan — Admin Dashboard Foundation

**Status:** In progress  
**Branch:** `claude/repo-audit-architecture-MiZDX`

## Goal

Lay the structural foundation of the admin dashboard: a role-aware sidebar,
a polished layout shell with topbar, user menu, breadcrumbs, and a global
search shell (⌘K, UI only), plus the first real admin-only page — a read-only
audit log skeleton backed by `auditLogs` Firestore collection.

## Scope

### In scope
- `lib/adminPermissions.ts` — role → capability map (UX filtering only; security is server-side)
- `lib/adminNav.ts` — central nav config with per-item capability requirements
- `components/Sidebar.tsx` update — accept `role` prop, filter items by capability
- `components/RoleBadge.tsx` — pill showing the current admin role
- `components/AdminTopbar.tsx` — server-passthrough wrapper (title, breadcrumbs, user menu)
- `components/AdminBreadcrumbs.tsx` — client, derives crumbs from pathname
- `components/AdminUserMenu.tsx` — client, avatar dropdown (name, email, role, sign-out)
- `components/AdminGlobalSearchShell.tsx` — client, ⌘K modal stub (no real search)
- `app/admin/layout.tsx` update — pass `{ user, role }` down to client components
- `app/admin/audit/page.tsx` — server component, paginates `auditLogs` via `adminDb`

### Out of scope (deferred to future phases)
- Users / orgs / groups / conversations modules
- Analytics dashboards
- Real global search implementation
- Admin wallet operations
- SMS gateway management
- Moderation tooling
- Any exposure of private message content or full phone numbers

## Capability Map

| Capability          | super_admin | org_admin | support_agent | finance_admin | auditor | legacy/bootstrap |
|---------------------|:-----------:|:---------:|:-------------:|:-------------:|:-------:|:----------------:|
| `view:overview`     | ✓           | ✓         | ✓             | ✓             | ✓       | ✓                |
| `view:users`        | ✓           | ✓         | ✓             |               |         | ✓                |
| `view:groups`       | ✓           | ✓         |               |               |         | ✓                |
| `view:calls`        | ✓           | ✓         |               |               |         | ✓                |
| `view:sms`          | ✓           |           |               |               |         | ✓                |
| `view:points`       | ✓           |           |               | ✓             |         | ✓                |
| `view:reports`      | ✓           | ✓         |               | ✓             | ✓       | ✓                |
| `view:support`      | ✓           | ✓         | ✓             |               |         | ✓                |
| `view:roles`        | ✓           |           |               |               |         | ✓                |
| `view:settings`     | ✓           | ✓         |               |               |         | ✓                |
| `view:audit`        | ✓           |           |               |               | ✓       | ✓                |

## Audit Log Page

Server component at `app/admin/audit/page.tsx`:
- Reads up to 50 latest `auditLogs` documents via `adminDb` (descending `createdAt`)
- Accepts `?cursor=<docId>` for cursor-based pagination
- Renders a read-only table: timestamp, actor, action, resource type, resource ID, severity
- Does not expose raw `payload` fields (shown only as JSON count)
- Requires `view:audit` capability via `adminPermissions.canDo(role, 'view:audit')`
- Returns `PermissionState` if role lacks capability

## Files Changed

```
docs/OFFLINESMS_PHASE_12_PLAN.md          (new)
apps/dashboard/lib/adminPermissions.ts    (new)
apps/dashboard/lib/adminNav.ts            (new)
apps/dashboard/components/Sidebar.tsx     (update)
apps/dashboard/components/RoleBadge.tsx   (new)
apps/dashboard/components/AdminTopbar.tsx (new)
apps/dashboard/components/AdminBreadcrumbs.tsx   (new)
apps/dashboard/components/AdminUserMenu.tsx      (new)
apps/dashboard/components/AdminGlobalSearchShell.tsx (new)
apps/dashboard/app/admin/layout.tsx       (update)
apps/dashboard/app/admin/audit/page.tsx   (new)
docs/OFFLINESMS_PHASE_LOG.md              (update)
docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md (update)
```
