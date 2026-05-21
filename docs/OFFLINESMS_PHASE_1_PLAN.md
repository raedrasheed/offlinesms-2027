# OfflineSMS Phase 1 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 0 docs committed (`71fa481`, `fb06f98`).

---

## Objective

Land the four foundational pieces from Phase 0's recommendation, with **no product features added**:

1. Semantic design-token layer on top of the existing palette.
2. Backward-compatible token shim (existing imports keep working).
3. Server-side guard for `/admin/*` plus a `/api/session` route.
4. Shared edge-state primitives in both apps and adoption on safe scaffold pages.
5. GitHub Actions CI running install → typecheck → lint → build across workspaces.

---

## Exact scope

### 2.1 Design tokens

- Add a `semantic` export to `packages/design-tokens/src/index.ts`:
  - `color.background.{app,surface,subtle,sunken}`
  - `color.text.{primary,secondary,muted,inverse}`
  - `color.border.{default,strong,subtle}`
  - `color.action.{primary,primaryHover}`
  - `color.state.{success,warning,error,info}`
  - Plus a `dark` variant block reserved for Phase 19 but exported now (placeholder values from current `darkBg`/`darkSurface`/`darkInk`).
- Extend Tailwind preset to expose those semantic tokens (`bg-app`, `text-primary-fg`, `border-default`, `text-state-error`, etc.) **alongside** the existing palette classes — no rename, no removal.
- New doc: `docs/DESIGN_TOKENS_SEMANTIC_LAYER.md`.

### 2.2 Dashboard admin guard

- New `apps/dashboard/lib/session.ts`:
  - `verifySession(cookie?: string)` returns `{ uid, claims }` or `null`.
  - Roles considered "admin" (any of): `admin: true` (legacy), `permissions.canAccessAdmin`, or role ∈ {`super_admin`, `organization_admin`, `support_agent`, `finance_admin`, `auditor`} stored in `roles[]` claim.
- New `apps/dashboard/app/api/session/route.ts`:
  - `POST` accepts `{ idToken }`, calls `adminAuth.createSessionCookie`, sets HTTP-only `__session` cookie. 5-day expiry.
  - `DELETE` clears the cookie.
- Convert `apps/dashboard/app/admin/layout.tsx` to a server component that:
  - Reads `__session` from `cookies()`.
  - Verifies via `verifySession`.
  - Redirects to `/login?next=/admin/...` when no session.
  - Renders a `PermissionState` (no redirect to login loop) when signed in but lacking admin role.
- Update `app/login/page.tsx` to POST the ID token to `/api/session` after sign-in, then `router.push('/admin')`.
- Wire `Sidebar` "Sign out" button: call `DELETE /api/session`, `auth.signOut()`, then redirect to `/login`.
- **No Firestore rules changes** — guard is server-side using existing claims.

### 2.3 Shared UI state primitives

Add **dashboard** primitives in `apps/dashboard/components/state/`:

- `LoadingState`, `EmptyState`, `ErrorState`, `PermissionState`, `SuccessState`.
- Common props: `title`, `description`, `icon` (lucide), `primaryAction`, `secondaryAction`, `compact`, `fullPage`.
- Tailwind classes use semantic tokens.

Add **mobile** primitives in `apps/mobile/src/components/state/`:

- Same names, prop names, but React Native + StyleSheet (no Tailwind on mobile).
- Use design-token semantic values.

**Adoption (safe pages only):**
- Dashboard: `/admin/users` (replace ad-hoc loading/empty divs), `/admin/chats` placeholder, `/admin/groups` placeholder, `/admin/calls` placeholder, `/admin/reports` placeholder, `/admin/support` placeholder, `/admin/roles` placeholder, `/admin/settings` placeholder.
- Mobile: `ChatsList.tsx` (loading + empty), `Points.tsx` (loading), `Privacy.tsx`, `Devices.tsx`, `Status.tsx`, `Calls.tsx`, `SmsEscalation.tsx`.
- **Out of adoption scope:** `Conversation.tsx`, `/admin` overview (real data), `/admin/sms`, `/admin/points` — these have richer logic and will be revisited in feature phases.

### 2.4 CI

`.github/workflows/ci.yml`:

- Triggers: `pull_request`, `push: main`, plus the active feature branch.
- Single job, Node 20, npm cache.
- Steps:
  1. Checkout
  2. Setup Node 20
  3. `npm ci`
  4. `npm run typecheck --workspaces --if-present`
  5. `npm run lint --workspaces --if-present`
  6. `npm run build --workspaces --if-present`
- No deploys, no secrets, no Firebase mutations.

### 2.5 Documentation

- New: `docs/DESIGN_TOKENS_SEMANTIC_LAYER.md`.
- Update: `docs/OFFLINESMS_PHASE_LOG.md` with Phase 1 entry.
- Update: `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md` to note the new guard + semantic layer.
- Update: `docs/OFFLINESMS_RISK_REGISTER.md` — risk #4 (admin permission leakage at boundary) and risk #2 (private content exposure) mitigations now partially in place.

---

## Files expected to change

**Create**
- `packages/design-tokens/src/semantic.ts`
- `docs/DESIGN_TOKENS_SEMANTIC_LAYER.md`
- `docs/OFFLINESMS_PHASE_1_PLAN.md` (this file)
- `apps/dashboard/lib/session.ts`
- `apps/dashboard/app/api/session/route.ts`
- `apps/dashboard/components/state/{LoadingState,EmptyState,ErrorState,PermissionState,SuccessState,index}.tsx`
- `apps/mobile/src/components/state/{LoadingState,EmptyState,ErrorState,PermissionState,SuccessState,index}.tsx`
- `.github/workflows/ci.yml`

**Edit**
- `packages/design-tokens/src/index.ts` — re-export semantic block.
- `packages/design-tokens/tailwind-preset.js` — add semantic colors.
- `apps/dashboard/app/admin/layout.tsx` — server guard.
- `apps/dashboard/app/login/page.tsx` — POST `/api/session` after sign-in.
- `apps/dashboard/components/Sidebar.tsx` — wire sign-out.
- `apps/dashboard/app/admin/{chats,groups,calls,reports,support,roles,settings}/page.tsx` — use `EmptyState`.
- `apps/dashboard/app/admin/users/page.tsx` — use `LoadingState` + `EmptyState`.
- `apps/mobile/src/screens/{ChatsList,Points,Privacy,Devices,Status,Calls,SmsEscalation}.tsx` — use state primitives.
- `docs/OFFLINESMS_PHASE_LOG.md`, `OFFLINESMS_TECHNICAL_ARCHITECTURE.md`, `OFFLINESMS_RISK_REGISTER.md`.

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Guard locks out the first admin (no admin claim yet) | High | High | Fallback: a `BOOTSTRAP_ADMIN_EMAILS` env var allow-lists initial admins by email until a real admin claim exists. Documented in setup guide. |
| `firebase-admin` initialisation needs env vars at build time | Medium | Medium | Guard initialisation in `firebase-admin.ts` already runs at request time — but the static export build may fail. Mark the admin layout `export const dynamic = 'force-dynamic'` so it's never statically rendered. |
| Static export (Hosting target) breaks with server-only layout | High | High | Either (a) keep static export and accept that `/admin/*` requires a Node runtime, or (b) ship the guard but document that production hosting will need Node (Cloud Run / Vercel) before going live. Phase 1 ships **option (b)** with a documented limitation; existing `out/`-based deploys stay green because the new route is server-only. |
| Token shim regression in mobile/dashboard build | Low | Medium | Keep `colors`, `typography`, `spacing`, `radius`, `shadows` exports unchanged; semantic layer is a new export only. |
| CI fails because lint not configured in some workspaces | Low | Low | `--if-present` skips missing scripts. |

---

## Acceptance criteria

1. `packages/design-tokens` exports a `semantic` object and Tailwind preset surfaces it; old exports unchanged.
2. `apps/dashboard/app/admin/layout.tsx` is server-rendered, reads `__session` cookie, redirects unauth users to `/login`, and renders `PermissionState` for signed-in non-admin users.
3. `POST /api/session` creates a session cookie from a valid Firebase ID token; `DELETE /api/session` clears it.
4. Login flow ends in `/admin` only after the cookie is set.
5. Five state primitives exist in both apps and are used on the listed scaffold pages.
6. `.github/workflows/ci.yml` runs install → typecheck → lint → build with no secrets.
7. `npm run build --workspaces --if-present` succeeds locally (sandbox-permitting); failures must be documented.
8. No third-party SMS provider names appear anywhere.
9. No new chat/SMS/wallet/payment behaviour.
10. Phase log, architecture, and risk register updated.

---

## Rollback plan

- All changes live on the current branch; no production deploys.
- `git revert` the offending commit if any subsystem breaks.
- Token semantic layer is additive — removing it is a one-file revert.
- Admin guard is gated by a single layout file — reverting `app/admin/layout.tsx` restores prior behaviour.
- CI workflow can be deleted with no side effects.

---

## Test plan

The repo has no test harness yet. Phase 1 adds none — that's Phase 20. For now:

- **Manual checks (sandbox-permitting)**
  - `npm install` (root)
  - `npm run typecheck --workspaces --if-present`
  - `npm run lint --workspaces --if-present`
  - `npm run build --workspaces --if-present`
- **Documented manual QA** (cannot be run in this environment without Firebase credentials):
  1. Visit `/admin` unauthenticated → expect redirect to `/login`.
  2. Sign in with a non-admin user → expect `PermissionState` page on `/admin`.
  3. Promote a user to admin via the documented script → reload → reach `/admin`.
  4. Sign out via sidebar → land on `/login`; subsequent `/admin` visit redirects.
- **Future**: Phase 20 will add rules-unit-tests and e2e covering this guard.

---

## Commit plan

1. `docs: add OfflineSMS phase 1 implementation plan`
2. `feat(tokens): add semantic design token layer`
3. `feat(dashboard): protect admin routes with session role guard`
4. `feat(ui): add shared state primitives`
5. `ci: add workspace validation workflow`
6. `docs: update phase log for phase 1`
