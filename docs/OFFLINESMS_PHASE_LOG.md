# OfflineSMS Phase Log

Running log of phased work. Newest first.

---

## Phase 1 — Design system, layout shells, routing cleanup

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build all green across all workspaces).

### What was done

- **Design tokens — semantic layer.** Added a role-based token layer (`color.background.*`, `color.text.*`, `color.border.*`, `color.action.*`, `color.state.*`) on top of the existing raw palette. Light + dark variants exported (dark variant unused until Phase 19). Tailwind preset surfaces the new tokens (`bg-bg-app`, `text-text-primary`, `border-border`, `bg-action-primary`, `text-state-error`, …) **alongside** the existing utilities — no rename, no removal. New doc: `docs/DESIGN_TOKENS_SEMANTIC_LAYER.md`.

- **Dashboard admin route guard.** `app/admin/layout.tsx` is now a server component (`runtime: nodejs`, `dynamic: 'force-dynamic'`) that reads the `__session` HTTP-only cookie, verifies it via `firebase-admin`, and authorises the request only when the user carries one of:
  - the legacy `admin: true` claim,
  - `permissions.canAccessAdmin === true`,
  - `role` or any of `roles[]` ∈ {`super_admin`, `organization_admin`, `support_agent`, `finance_admin`, `auditor`}, or
  - an email in the `BOOTSTRAP_ADMIN_EMAILS` allow-list (for first-admin bootstrap).
  Unauthenticated traffic is redirected to `/login?next=…`. Authenticated but unauthorised users see a `PermissionState` (no redirect loop). The Sidebar sign-out clears the session cookie before calling `auth.signOut()`. No Firestore rules changes in this phase.

- **`/api/session` route.** `POST` exchanges a Firebase ID token for an HTTP-only session cookie (5 day expiry); `DELETE` clears it. The login page now performs the exchange before navigating into `/admin`.

- **Shared state primitives.** Five components (`LoadingState`, `EmptyState`, `ErrorState`, `PermissionState`, `SuccessState`) added to both apps. Common props: `title`, `description`, `icon`, `primaryAction`, `secondaryAction`, `compact`, `fullPage`, `tone`. They consume semantic tokens, work in RTL (mobile uses `I18nManager.isRTL`), and are dark-mode-ready (no hard-coded raw colors).

- **Primitive adoption — only on safe scaffold pages.**
  - Dashboard: `/admin/{chats, groups, calls, reports, support, roles, settings}` (replace ad-hoc TODO divs with `EmptyState`); `/admin/users` (`LoadingState` + `EmptyState`).
  - Mobile: `ChatsList` (loading + empty), `Points` (loading), `Privacy`, `Devices`, `Status`, `Calls`, `SmsEscalation` (placeholder copy).
  - Intentionally **not** touched: `Conversation`, `/admin` overview, `/admin/sms`, `/admin/points` — these carry richer logic deferred to feature phases.

- **CI workflow.** `.github/workflows/ci.yml` runs `npm ci → typecheck → lint → build` across all workspaces on `pull_request`, `push: main`, and pushes to `claude/**` / `feature/**` branches. Node 20, npm cache, no secrets, no deploys.

- **Make repo buildable for CI** (minimum non-feature changes needed for CI to be meaningful):
  - Aligned `apps/dashboard` React + react-dom to **18.2.0** to match the mobile workspace (RN 0.74 pins React 18.2). The 18.3.1/18.2.0 mismatch made npm install two Reacts, which made Next.js server prerender crash with a `useContext`-is-null error.
  - Lazy-initialised both `lib/firebase.ts` and `lib/firebase-admin.ts` in the dashboard via Proxy, so `next build` can collect page data without `NEXT_PUBLIC_FIREBASE_*` or service-account env vars present.
  - Wrapped the login form in `<Suspense>` (needed because `useSearchParams` for `?next=…` triggers a CSR bailout) and marked the page `dynamic = 'force-dynamic'`.
  - Added a minimal `apps/dashboard/.eslintrc.json` so `next lint` runs non-interactively in CI.
  - Updated `apps/mobile/src/lib/firebase.ts` to pull `getReactNativePersistence` from `firebase/auth/react-native` (its real location in firebase-js-sdk 10.x).
  - Committed `package-lock.json` for deterministic CI installs; gitignored `*.tsbuildinfo` and `functions/lib/`.

### Files created

- `docs/OFFLINESMS_PHASE_1_PLAN.md`
- `docs/DESIGN_TOKENS_SEMANTIC_LAYER.md`
- `packages/design-tokens/src/semantic.ts`
- `apps/dashboard/lib/session.ts`
- `apps/dashboard/app/api/session/route.ts`
- `apps/dashboard/components/state/{StateShell,LoadingState,EmptyState,ErrorState,PermissionState,SuccessState,index}.tsx`
- `apps/mobile/src/components/state/{StateShell,LoadingState,EmptyState,ErrorState,PermissionState,SuccessState,index}.tsx`
- `apps/dashboard/.eslintrc.json`
- `.github/workflows/ci.yml`
- `package-lock.json`

### Files edited

- `packages/design-tokens/src/index.ts`, `tailwind-preset.js`
- `apps/dashboard/app/admin/layout.tsx`, `app/login/page.tsx`, `package.json`, `components/Sidebar.tsx`, `lib/firebase.ts`, `lib/firebase-admin.ts`, `.env.example`
- `apps/dashboard/app/admin/{chats,groups,calls,reports,support,roles,settings,users}/page.tsx`
- `apps/mobile/src/lib/firebase.ts`
- `apps/mobile/src/screens/{ChatsList,Points,Privacy,Devices,Status,Calls,SmsEscalation}.tsx`
- `.gitignore`

### Commits

| Hash | Message |
|---|---|
| `c645d57` | `docs: add OfflineSMS phase 1 implementation plan` |
| `69d2d0a` | `feat(tokens): add semantic design token layer` |
| `5f6d89d` | `feat(ui): add shared state primitives and adopt on scaffold pages` |
| `ef2db47` | `feat(dashboard): protect admin routes with session role guard` |
| `0929843` | `ci: add workspace validation workflow` |
| `ede64e2` | `fix(ui): preserve caller-provided title in state primitives` |
| `93e423d` | `build: make repo buildable for CI` |

Tail commit will land with this docs update.

### Checks run

```
npm install                                     → ok
npm run typecheck --workspaces --if-present     → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present          → ok
npm run build --workspaces --if-present         → ok
  dashboard: 16 routes generated; /admin/* are ƒ dynamic
  functions: tsc → lib/
```

### Known limitations

- **Static export removed for /admin/\*.** Before Phase 1 the dashboard was set up to be statically exported (`firebase.json` serves `apps/dashboard/out`). The new server-side admin guard requires a Node runtime for `/admin/*`. The build still produces a usable artifact (admin routes are ƒ dynamic), but production deploys for `/admin/*` will need a Node host (Cloud Run / Vercel / similar) rather than pure static hosting. Phase 12 picks this up.
- **First admin bootstrap.** Until a real admin claim exists on at least one user, set `BOOTSTRAP_ADMIN_EMAILS` (server env) to a small list of trusted emails. Once promoted, remove the env var. Documented in `apps/dashboard/.env.example`.
- **No test infrastructure yet.** Phase 1 adds no test runner; phase plan rolls that into Phase 20.
- **Dark mode not wired.** Semantic tokens have a `darkSemantic` variant but no provider; Phase 19 wires the toggle.
- **Dashboard RTL not wired.** Mobile already forces RTL via `I18nManager`; the dashboard needs a Tailwind RTL plugin or manual mirroring (Phase 19).
- **Native phone OTP still TODO.** Untouched in Phase 1; Phase 2.

### Recommended Phase 2 scope

1. Native phone OTP path in `apps/mobile/src/lib/auth.ts` (or `expo-firebase-recaptcha`).
2. Profile-completion screen (display name, username, about, avatar). Add `usernames/{lower}` uniqueness collection + `claimUsername` callable.
3. Tighten `firestore.rules` on `users.update` to a field allow-list.
4. Email-link path (optional but designed for).
5. Documented `scripts/promoteAdmin.ts` for the first-admin bootstrap.

---

## Phase 0 — Repository audit & technical planning

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete (documentation only — no production code changed).

### What was done

- Inspected the entire repository: monorepo config, mobile app, dashboard, Cloud Functions, design tokens, Firestore rules and indexes, storage rules, scripts, and existing docs.
- Inventoried every screen (13 mobile), every admin page (11 + login + redirect), every Cloud Function (7), every Firestore collection (11 declared, 4+ implied), every composite index (4), and every TODO marker (21).
- Mapped 36 product design modules to their current implementation state.
- Drafted a 20-phase roadmap with acceptance criteria, scope, risks, and rollback per phase.
- Wrote 50+ issue-ready GitHub tasks, each labelled by phase + surface + priority.
- Compiled a 22-row risk register covering security, abuse, cost, privacy, and UX risks.
- Produced a consolidated technical architecture covering monorepo, mobile, dashboard, Firebase, Firestore, security rules, Functions, gateway, points, escalation, receipts, views, RBAC, audit, RTL, dark mode, testing, deployment.

### Files created

- `docs/OFFLINESMS_REPOSITORY_AUDIT.md`
- `docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`
- `docs/OFFLINESMS_IMPLEMENTATION_ROADMAP.md`
- `docs/OFFLINESMS_GITHUB_TASKS.md`
- `docs/OFFLINESMS_RISK_REGISTER.md`
- `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md`
- `docs/OFFLINESMS_PHASE_LOG.md` (this file)

### Checks run

- Repository structure inspected on the current commit of `claude/repo-audit-architecture-MiZDX`.
- No code modifications; no installs, builds, or tests were executed in Phase 0 (deferred to Phase 1 CI baseline).

### Known issues uncovered (full list in the Risk Register)

- `functions/src/points/buy.ts` credits points without payment verification — must close before any production traffic.
- Dashboard has no role-aware route guard.
- `statuses` audience is enforced client-side only.
- Several Firestore collections needed by later phases have no rules yet.
- No CI in `.github/workflows/`.
- No audit logging anywhere.
- Native phone OTP path unimplemented.
- Multiple mobile and dashboard screens are placeholders.

### Recommended Phase 1 scope

**Phase 1 — Design system, layout shells, and routing cleanup.**

1. Promote `@offlinesms/design-tokens` to expose semantic role tokens (`text.*`, `surface.*`, `border.*`, `state.*`, `action.*`) on top of the current palette, with a compatibility shim for existing imports.
2. Add a server-side guard at `apps/dashboard/app/admin/layout.tsx` that verifies a session cookie and the `admin: true` custom claim. Add the supporting `/api/session` route.
3. Add shared edge-state primitives (`LoadingState`, `EmptyState`, `ErrorState`, `PermissionState`, `SuccessState`) in both apps; convert existing `/admin/*` pages and `ChatsList` / `Points` to use them.
4. Add a `.github/workflows/ci.yml` running install → typecheck → lint → build for all workspaces on every PR.

Phase 1 must not touch chat data flow, Firestore rules of the messaging system, or Functions business logic.

### Commit

- **Hash:** `71fa481` (`docs: add OfflineSMS phase 0 implementation plan`).
- **Branch:** `claude/repo-audit-architecture-MiZDX`.
