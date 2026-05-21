# OfflineSMS Phase Log

Running log of phased work. Newest first.

---

## Phase 4 — Chat list and one-to-one messaging

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Direct conversation data contract.** Phase 4 introduces the canonical fields `participantUids[]`, `participantKey`, `lastMessage`, `status`, `createdBy`, `updatedAt` on `conversations/{id}`, while keeping `memberIds`, `lastMessageText`, `lastMessageAt`, `lastSenderId` and `senderId` as written-everywhere back-compat aliases so the existing receipt-fanout trigger, `/admin/users` page, and seed script keep working.
- **Two new sub-collections.**
  - `conversations/{c}/userState/{uid}`: per-user pin/mute/archive/favorite state plus server-owned `unreadCount`, `lastReadAt`, `lastMessagePreview`, `lastMessageAt`.
  - `conversations/{c}/typing/{uid}`: ephemeral typing flag with `expiresAt = now + 3000ms`.
- **Rules hardening.** New helpers `isConversationParticipantData()`, `isConversationParticipant()`, `isValidTextMessage()`, `onlyAllowedUserStateUpdates()`, etc. New rules:
  - `conversations.read` requires participation (`participantUids` or legacy `memberIds` or `/members` sub-collection).
  - `conversations.create` requires the caller to be listed in `participantUids/memberIds`.
  - `messages.create` enforces `type === 'text'`, `1..4000` chars, `senderUid === auth.uid`.
  - `userState/{uid}` is owner-only with a field allow-list (`pinned`, `muted`, `archived`, `favorite`, `updatedAt`); counters are server-owned (callable + trigger bypass via Admin SDK).
  - `typing/{uid}` is owner-write, participant-read.
- **Four callables (audited):**
  - `getOrCreateDirectConversation({ otherUserId })` — `chat.directConversation.opened`.
  - `sendTextMessage({ conversationId, text })` — `chat.message.sent` with `{ conversationId, length }` only.
  - `markRead({ conversationId })` — `chat.markRead`.
  - `setTyping({ conversationId, isTyping })` — **not audited** (would be too noisy).
- **`onMessageCreate` trigger extended** to write the new `lastMessage` object, refresh recipient `userState` (unread, preview), and zero the sender's own `userState` so self-sends never appear unread on the sender's own chat list. Receipt fan-out and back-compat aliases preserved.
- **Mobile data layer.** `apps/mobile/src/lib/conversations.ts` exposes `subscribe*` (conversations, messages, userState, typing) and typed callable wrappers (`sendTextMessage`, `markRead`, `setTyping`, `getOrCreateDirectConversation`). `setTyping` is client-debounced to one start event every 2 s. `apps/mobile/src/lib/chats.ts` becomes a thin facade so older imports keep compiling.
- **Mobile UI.**
  - `ChatsList` shows live conversations with unread badges, pin/mute indicators, typing previews, four filter chips (All / Unread / Favorites / Archived), a search field, and a FAB → `NewChat`. Groups chip rendered disabled until Phase 5.
  - `NewChat` searches users by `usernameLower` prefix (Firestore range query bounded by ``), filters out the caller, and routes into the new conversation via the callable.
  - `Conversation` consumes `sendTextMessage`, calls `markRead` on every incoming batch, emits typing start/stop on draft changes, renders peer name from `users/{peerUid}`, and surfaces inline errors via `ErrorState`.
- **Composite indexes added:** `conversations(participantUids, updatedAt)` and `conversations(participantUids, status, updatedAt)`. The legacy `conversations(memberIds, lastMessageAt)` index remains.
- **No dashboard work.** Phase 14 is where admin chat moderation lands.

### Files created

- `docs/OFFLINESMS_PHASE_4_PLAN.md`
- `apps/mobile/src/lib/conversations.ts`
- `apps/mobile/src/screens/NewChat.tsx`
- `functions/src/chats/getOrCreateDirectConversation.ts`
- `functions/src/chats/sendTextMessage.ts`
- `functions/src/chats/markRead.ts`
- `functions/src/chats/setTyping.ts`

### Files edited

- `firestore.rules`
- `firestore.indexes.json`
- `functions/src/chats/onMessageCreate.ts`
- `functions/src/index.ts`
- `apps/mobile/src/lib/chats.ts`
- `apps/mobile/src/screens/ChatsList.tsx`
- `apps/mobile/src/screens/Conversation.tsx`
- `apps/mobile/App.tsx`
- `docs/OFFLINESMS_DATA_MODEL.md`, `OFFLINESMS_TECHNICAL_ARCHITECTURE.md`, `OFFLINESMS_RISK_REGISTER.md`, `OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`

### Commits

| Hash | Message |
|---|---|
| `8e33fbc` | docs: add OfflineSMS phase 4 implementation plan |
| `525c701` | feat(data): add direct conversation data contracts and indexes |
| `e054b90` | security: add conversation, message, userState, and typing rules |
| `75475e5` | feat(functions): add direct conversation callables and fan-out |
| `3f12c3f` | feat(mobile): add conversations lib and new-chat screen |
| `507cf7d` | feat(mobile): add chat list filters, unread, typing, and conversation rewrite |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests for rules / callables / UI.** Manual emulator checklist in the Phase 4 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **`subscribeTyping` only filters expired docs client-side.** Stale `typing` docs persist in Firestore until overwritten. A scheduled cleanup function isn't strictly needed (rows are tiny and overwritten on every keystroke / 2s debounce window) but is queued for Phase 16 alongside other scheduled housekeeping.
- **`setTyping` callable cost.** Even with the 2-second client debounce, a chatty user generates one call per ~2s of typing. Cost is acceptable for Phase 4; presence tooling (RTDB) is on the table for Phase 7.
- **Message receipts UI not wired.** The enum is enforced and the trigger writes `status: 'pending'` for each recipient, but no client emits `delivered`/`read`/`played`. Phase 7 wires this.
- **Direct conversation participation update path.** `conversations.update` rules still allow any participant to write — useful for the seed script and Phase 5 group flows — but means a participant can technically rewrite `lastMessage` fields. Acceptable today because the canonical updates flow through callables; tighten in Phase 5 / Phase 18.
- **Username search is exact prefix.** A real fuzzy / full-text user search isn't in scope and isn't trivial in Firestore alone (Phase 17 will pair it with a search index).

### Recommended Phase 5 scope

Phase 5 = **Group chat and member management** (per the roadmap):

1. Create-group flow on mobile: `NewGroup.tsx` with member picker (reuses Phase 4's username search), avatar/name input, owner role assigned to creator.
2. `GroupInfo.tsx` screen — list members, role badges, lock/unlock, leave-group.
3. Callables: `createGroup`, `addMembers`, `removeMember`, `changeRole`, `leaveGroup`, `lockChannel` — all audited (`group.created`, `group.member.added`, …).
4. Rules tighten: only `owner/admin` may mutate `/members`; member-count cap enforced server-side; `conversations.update` rules narrow to the legitimate Phase 5 mutation paths.
5. Trigger update: `onMessageCreate` already fans out across all participants — group case is automatic once `participantUids` has more than 2 entries. Confirm with a manual emulator pass.

Defer: media messages, message actions, communities, dashboard moderation.

---

## Phase 3 — Core Firestore data model and rules hardening

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Data model contracts.** New `docs/OFFLINESMS_DATA_MODEL.md` documents every collection introduced in Phase 3 (`organizations`, `roles`, `auditLogs`, `tickets`, `flags`, `payments`, `gatewayHealth`, `smsQuotaUsage`) plus the new fields on existing `statuses` and the receipt-status enum. Schema only — no UI mounts them yet.
- **Composite indexes.** Six new composite indexes added to `firestore.indexes.json`, each documented and traceable to a real query (audit-log explorer, moderation queue, own-tickets, own-payments, own-statuses, "what happened to X"). Single-field indexes (e.g. `auditLogs.createdAt` and `statuses.expiresAt`) are left to Firestore's automatic indexing.
- **Rules hardening.** `firestore.rules` extended:
  - `auditLogs`, `gatewayHealth`, `smsQuotaUsage/{uid}/days/{yyyymmdd}`, `payments` are all `allow write: if false` for clients (even admins). Reads scoped to owner/admin as appropriate.
  - `tickets`: owner can create with `status: 'open'` and no `assignedTo`; owner+admin can read; admin updates/deletes.
  - `flags`: owner can create with `status: 'open'`; admin reads and updates (so reporters can't enumerate other reports).
  - `organizations` + `organizations/{id}/members/{uid}`: admin-only in Phase 3 (membership rules wait for Phase 13).
  - `roles`: admin read/write (catalogue; live permission checks still come from `request.auth.token`).
  - `statuses`: audience and expiry are now enforced server-side via the new helpers `isStatusExpired()` and `isStatusAudienceMember()`. Legacy docs without the new fields default to "any authed reader" but expired docs are read-blocked everywhere.
  - Receipt writes are checked against an enum (`isValidReceiptStatus()`): `pending | delivered | read | viewed | played | failed`. Unknown statuses are rejected.
  - All Phase 2 protections (users field allow-list, usernames write-deny) preserved.
- **Audit log helper.** `functions/src/lib/auditLog.ts` provides:
  - `writeAuditLog({ action, actor, target, result, metadata })` — soft-failing (a failed audit-log write never rolls back the primary action).
  - `sanitiseMetadata(...)` — strips a hard-coded set of forbidden keys (`password`, `token`, `otp`, `secret`, `apiKey`, `phone`, `email`, `messageText`, `body`, `content`, …), clamps strings, flattens one level.
  - `redactPhone(...)`, `redactEmail(...)` for callers that genuinely need an identifier signal.
- **First audit consumers.**
  - `claimUsername` emits `auth.username.claimed` (or `auth.username.changed` if releasing a prior name) after the transaction commits.
  - `setAdminClaim` emits `admin.claim.set` on success and `admin.claim.set` with `result: 'failure'` on permission denial. Also fixed a long-standing latent issue: the callable now **preserves** existing custom claims (role, permissions, …) instead of overwriting the whole block when toggling `admin`.
- **Welcome credit refactor — deferred.** `onUserCreate` already uses `merge: true`, so re-running it is idempotent in practice and Phase 3 has no consumer that needs to re-grant. A dedicated `grantWelcomeCreditIfEligible` callable lands when Phase 10 wires payments. Documented in the Phase 3 plan.

### Files created

- `docs/OFFLINESMS_PHASE_3_PLAN.md`
- `docs/OFFLINESMS_DATA_MODEL.md`
- `functions/src/lib/auditLog.ts`

### Files edited

- `firestore.rules`
- `firestore.indexes.json`
- `functions/src/auth/claimUsername.ts`
- `functions/src/auth/setAdminClaim.ts`
- `docs/OFFLINESMS_PHASE_LOG.md`, `OFFLINESMS_TECHNICAL_ARCHITECTURE.md`, `OFFLINESMS_RISK_REGISTER.md`, `OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`

### Commits

| Hash | Message |
|---|---|
| `a640507` | docs: add OfflineSMS phase 3 implementation plan |
| `35fd6ac` | feat(data): add core Firestore collection contracts and indexes |
| `940cc7d` | security: enforce status audience, receipt enums, lock system collections |
| `2de1b45` | feat(functions): add audit log helper |
| `f377bb3` | feat(functions): audit auth and admin bootstrap actions |

Tail commit lands with this docs update.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

Manual emulator checks queued in the Phase 3 plan; automation lands in Phase 20.

### Known limitations

- **No automated rules tests yet.** Manual emulator checklist documented in `docs/OFFLINESMS_PHASE_3_PLAN.md`; Phase 20 plugs `@firebase/rules-unit-testing` into CI.
- **Contacts graph isn't modelled.** Status audience `'all_contacts'` is approximated as "any signed-in user not in `excludedViewerUids`". When a real contacts model lands the rule tightens automatically (Phase 13).
- **Organization membership rules deferred.** Phase 3 leaves `organizations` and its `members` sub-collection admin-only. Member-aware rules land with Phase 13's admin org module.
- **Welcome credit callable deferred.** The `onUserCreate` trigger is idempotent today; a callable replacement isn't needed until Phase 10 introduces real payment-driven crediting.
- **Reserved username list still duplicated** between mobile and functions. Cross-package extraction is a Phase 18 (shared utilities) item.

### Recommended Phase 4 scope

Phase 4 = **Chat list + one-to-one messaging** (per the roadmap):

1. Per-user conversation state under `conversations/{c}/userState/{uid}` (pin, mute, archive, lastReadAt, unread). Owner-only writes; trigger maintains unread counts.
2. `markRead` callable so receipts begin to track real delivery / read state — receipt enum guard from Phase 3 already in place.
3. Filter chips on `ChatsList` (All / Unread / Favorites / Groups) backed by the new userState fields.
4. Typing indicator via an ephemeral `conversations/{c}/typing/{uid}` doc (3-second TTL).
5. Audit hooks on any privileged conversation actions (e.g. lock/unlock).

Do not yet build media messaging, group management UI, SMS escalation UI, points UI, or dashboard modules.

---

## Phase 2 — Firebase auth, onboarding, profile completion

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build all green across workspaces).

### What was done

- **Native phone OTP path.** `apps/mobile/src/lib/auth.ts` refactored: web keeps invisible reCAPTCHA; native uses an `ApplicationVerifier` registered via a new `setNativeRecaptchaVerifier()` hook so a future `FirebaseRecaptchaVerifierModal` mount drops in cleanly. Firebase auth error codes are mapped to a stable `OtpError` enum (`invalid-phone-number`, `invalid-verification-code`, `code-expired`, `too-many-attempts`, `network-error`, `quota-exceeded`, `recaptcha-unavailable`, `no-confirmation-in-flight`, …). Added `isPlausiblePhone()` and a `cancelOtp()` helper for backing out of the flow. **No OTP value is ever stored or logged**; `ConfirmationResult` lives in module-scope memory only.
- **Phone UX improvements.** `PhoneEntry.tsx` and `Otp.tsx` translate `OtpError` codes to product-friendly copy, autofill from `oneTimeCode`, and offer a "use a different number" link that clears in-flight state.
- **Profile completion flow.** New screen `ProfileCompletion.tsx` captures `displayName` (required, 1–60 chars), `username` (required, 3–20 chars, `[a-z0-9._]` with edge/consecutive-punct guards), and optional `about` (≤140 chars). Calls the `claimUsername` callable; on success Firestore flips `profileCompleted: true` and `App.tsx` swaps the navigator into `MainTabs`. Avatar upload is deferred — `photoURL` stays `null` for now.
- **Onboarding routing in `App.tsx`.** Subscribes to `users/{uid}` after sign-in; until `profileCompleted === true`, the app shows the `OnboardingFlow` instead of `MainTabs`.
- **Username uniqueness.** New Firestore collection `usernames/{lowercaseUsername}` with `{ uid, username, claimedAt }`. New callable `functions/src/auth/claimUsername.ts` runs a single transaction that:
  - Rejects `already-exists` when the target username is held by another uid.
  - Releases the caller's prior `usernameLower` if they're renaming.
  - Writes `usernames/{lower}` and patches `users/{uid}` with the allowed fields.
- **`onUserCreate` seeds `profileCompleted: false`** plus `null` username fields so the gate works from the first sign-in.
- **Firestore rules hardening.** `users.update` is now a strict field allow-list (`displayName`, `photoURL`, `about`, `profileCompleted`, `fcmTokens`, `lastSeen`, `updatedAt`). `username` and `usernameLower` are **only** writeable via the `claimUsername` callable. A redundant banned-list (`role`, `roles`, `permissions`, `admin`, `isAdmin`, `points`, `pointsBalance`, `wallet`, `walletStatus`, `organizationId`, `organizationRole`, `createdAt`, `phoneVerified`, `status`, `phoneNumber`, `email`, `username`, `usernameLower`) is a safety net against future edits. `users.create` is also field-scoped. `usernames/{lower}` reads are allowed for signed-in users (so the UI can show "taken" status); writes require admin (callable bypasses rules via Admin SDK).
- **Admin bootstrap script.** `scripts/promoteAdmin.ts` + `npm run promote:admin -- <email>` set `admin: true` and `role: 'super_admin'` claims on a target user, preserving existing claims. Refuses without an email arg, refuses unknown emails, never logs the service-account file. Docs: `docs/admin-bootstrap.md`.
- **Email-link sign-in:** deferred. No existing scaffolding to complete; introducing it from scratch is out of scope for Phase 2 and documented as deferred in the risk register and roadmap.
- **i18n.** Added `auth.createProfileSub`, `auth.about*`, `auth.usernameHint`, `auth.useDifferentNumber`, `auth.saving`, plus `profileErrors.*` and `otpErrors.*` keys in `en.json` and `ar.json`.

### Files created

- `docs/OFFLINESMS_PHASE_2_PLAN.md`
- `docs/admin-bootstrap.md`
- `apps/mobile/src/lib/username.ts`
- `apps/mobile/src/lib/profile.ts`
- `apps/mobile/src/screens/ProfileCompletion.tsx`
- `functions/src/auth/claimUsername.ts`
- `scripts/promoteAdmin.ts`

### Files edited

- `apps/mobile/src/lib/auth.ts`
- `apps/mobile/src/screens/{PhoneEntry,Otp}.tsx`
- `apps/mobile/App.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `functions/src/auth/onUserCreate.ts`
- `functions/src/index.ts`
- `firestore.rules`
- `package.json` (root) — added `promote:admin`
- `.env.example` (root)

### Commits

| Hash | Message |
|---|---|
| `f4079f3` | docs: add OfflineSMS phase 2 implementation plan |
| `67cadb1` | feat(auth): add native phone OTP flow with friendly errors |
| `85abd69` | feat(profile): add profile completion screen with username validation |
| `7a06371` | feat(functions): add claimUsername callable |
| `a17199c` | security: harden user profile Firestore updates |
| `471c0c2` | chore(admin): add first-admin promotion script |

Tail commit lands with this docs update.

### Checks run

```
npm run typecheck --workspaces --if-present     → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present          → ok
npm run build --workspaces --if-present         → ok
npm run promote:admin                           → refuses without email arg (expected)
```

### Known limitations

- **Native phone OTP requires a host-app verifier mount.** The path is plumbed (`setNativeRecaptchaVerifier`), but actually invoking it on iOS/Android requires `expo-firebase-recaptcha` (or `@react-native-firebase/auth`) to be installed and a verifier ref registered at app start. Phase 2 ships the plumbing + a clear `recaptcha-unavailable` error so web + dev work today; wiring the verifier mount is a follow-up.
- **Email-link sign-in deferred.** Not scaffolded; out of scope.
- **Avatar upload deferred.** `photoURL` is allowed in the field allow-list but no UI mounts the image picker yet. Phase 4+.
- **No automated tests for rules / callable.** Phase 20 lands `@firebase/rules-unit-testing` coverage; manual emulator testing is documented in the Phase 2 plan.
- **`claimUsername` callable** depends on Cloud Functions being deployed in environments that exercise the onboarding flow. The dashboard and seed data don't require it.

### Recommended Phase 3 scope

Phase 3 = **Core Firestore data model and rules hardening** (per the roadmap). Specifically:

1. Add missing Firestore collections needed by later phases: `auditLogs`, `payments`, `flags`, `tickets`, `roles`, `gatewayHealth`, `smsQuotaUsage`, `organizations`. Stubs only — rules + minimal schema docs, no UI.
2. Server-side audience enforcement for `statuses` (move the existing client-side filtering into rules / a callable).
3. Receipt `status` enum validation in `firestore.rules`.
4. Add a shared `functions/src/lib/auditLog.ts` helper so privileged callables in later phases can audit consistently. Wire `claimUsername` to use it as the first example.
5. (Optional) move `onUserCreate`'s welcome credit out of the trigger into an idempotent callable so it can be re-run if the trigger fails.

Defer: chat / SMS / wallet / dashboard module work — those are Phases 4+.

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
