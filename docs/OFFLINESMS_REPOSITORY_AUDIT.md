# OfflineSMS Repository Audit

**Phase:** 0 — Audit & Planning
**Branch:** `claude/repo-audit-architecture-MiZDX`
**Repository:** `raedrasheed/offlinesms-2027`

This document captures the verified state of the repository at the time of Phase 0. It is intentionally descriptive — no code in the production tree was modified to produce it.

---

## 1. Current Stack

| Layer | Technology | Version |
|---|---|---|
| Monorepo | npm workspaces | — |
| Runtime | Node | `>=20` |
| Language | TypeScript | `5.5.4` |
| Mobile | Expo + React Native + React Native Web | Expo 51, RN 0.74.5, RNW 0.19.10 |
| Dashboard | Next.js (App Router) | 14.2.15 |
| UI | React | 18.2 (mobile) / 18.3 (dashboard) |
| Backend | Firebase (Auth, Firestore, Storage, Functions, FCM, Hosting) | firebase 10.13.2, firebase-admin 12.5.0, firebase-functions 6.0.1 |
| Design system | `@offlinesms/design-tokens` (local workspace) | — |
| i18n | i18next + expo-localization | 23.15.1 |
| Icons | lucide-react | 0.451.0 |
| Tooling | firebase-tools, tsx | 13.21.0 / 4.19.0 |

---

## 2. Root Structure

```
/
├── apps/
│   ├── mobile/        Expo + React Native Web
│   └── dashboard/     Next.js 14 App Router
├── packages/
│   └── design-tokens/ Shared color/typography/spacing tokens (+ Tailwind preset)
├── functions/         Firebase Cloud Functions (Gen 2)
├── scripts/           seed.ts (demo data)
├── docs/              ARCHITECTURE.md, DATA_MODEL.md, FIREBASE_SETUP.md, PUSH_TO_GITHUB.md
├── firebase.json      Emulators + deploy targets (hosting → apps/dashboard/out)
├── .firebaserc        Project: offlinesms-prod, target: offlinesms-dashboard
├── firestore.rules    Member/admin gated; admin via custom claim
├── firestore.indexes.json  4 composite indexes
├── storage.rules      Per-path size limits
├── tsconfig.base.json Strict, ES2022, bundler resolution
├── .env.example       Service account + Firebase web/native env vars
└── package.json       Workspaces: apps/*, packages/*, functions
```

### Root scripts (`package.json`)

- `dev:mobile`, `dev:dashboard`, `dev:functions`
- `build`, `lint`, `typecheck` (per-workspace via `--if-present`)
- `seed` (`tsx scripts/seed.ts`)
- `firebase:emulators`, `firebase:deploy`

### CI/CD

**Not present.** No `.github/workflows/`, no other pipeline config. CI must be added in a later phase.

---

## 3. Mobile App (`apps/mobile`)

### Framework & navigation

- Entry: `App.tsx` — `SafeAreaProvider` + `NavigationContainer`.
- Root stack swaps between `AuthFlow` (Welcome → PhoneEntry → Otp) and `MainTabs` based on `onAuthStateChanged`.
- `MainTabs`: bottom-tab navigator — **Chats, Status, Calls, Settings**.
- Modal/root stack screens above tabs: **Conversation, Points, Privacy, Devices, SmsEscalation**.

### Libraries (`src/lib`)

- `firebase.ts` — Initialises Firebase web SDK; uses `getReactNativePersistence(AsyncStorage)` on native; supports Firestore emulator via `EXPO_PUBLIC_USE_EMULATORS=1`.
- `auth.ts` — Phone OTP via `RecaptchaVerifier` on web. **Native path throws** — flagged as TODO (requires `@react-native-firebase/auth`).
- `chats.ts` — `subscribeConversations`, `subscribeMessages`, `sendText`. Cloud Function trigger fans out receipts and updates conversation summary.

### Screens (13)

| # | Screen | Status | Notes |
|---|---|---|---|
| 1 | `Welcome.tsx` | Complete (visual) | Email path is placeholder. |
| 2 | `PhoneEntry.tsx` | Complete (web) | reCAPTCHA on web only. |
| 3 | `Otp.tsx` | Complete | 6-digit verify. |
| 4 | `ChatsList.tsx` | Complete | Live `subscribeConversations`. |
| 5 | `Conversation.tsx` | Partial | Text only. No media/voice/reply/edit/forward/info/views. |
| 6 | `Status.tsx` | **TODO** | Placeholder. |
| 7 | `Calls.tsx` | **TODO** | Placeholder. |
| 8 | `Settings.tsx` | Scaffold | 4 rows; only Points/Sign out fully wired. |
| 9 | `Points.tsx` | Partial | Reads `wallets/{uid}` live; Buy/Transfer buttons not wired. |
| 10 | `Privacy.tsx` | **TODO** | One-liner placeholder. |
| 11 | `Devices.tsx` | **TODO** | One-liner placeholder. |
| 12 | `SmsEscalation.tsx` | **TODO** | Must call `escalateSms` callable. |

### i18n

- `i18n/index.ts`, `en.json`, `ar.json` — keys for welcome, auth, tabs, chats, convo, sms, points, common.
- `I18nManager.forceRTL` applied automatically when locale is Arabic.

### Theme

- `theme/index.ts` re-exports `colors`, `typography`, `radius`, `spacing` from `@offlinesms/design-tokens`.

### Mobile gaps

- No dark mode wiring (token placeholders exist).
- No status / stories, calls, voice messages, voice/video calls.
- No message actions (reply, edit, delete, react, forward), no message info / views, no delivery/read UI.
- No group management screens (create, settings, members, admins).
- No communities concept.
- No SMS escalation flow UI (function exists; screen is empty).
- No Buy points or Transfer points flow.
- No profile completion / username flow after signup.
- Native phone OTP not wired.

---

## 4. Dashboard (`apps/dashboard`)

### Structure

- Next.js 14, App Router, `typedRoutes` on, transpiles `@offlinesms/design-tokens`.
- Tailwind via `@offlinesms/design-tokens/tailwind` preset.
- Static export served by Firebase Hosting (`out/`).

### Routes (15)

**Public**
- `/` — redirect to `/admin`.
- `/login` — Email/password + Google. Redirects to `/admin`.

**Admin shell** (Sidebar + Topbar)

| Path | Status | Notes |
|---|---|---|
| `/admin` | Partial | Stat cards static; chart placeholder; gateway-health card static. |
| `/admin/users` | **Complete** | Live `users` query (limit 100); table renders. |
| `/admin/chats` | **TODO** | One-liner. |
| `/admin/groups` | **TODO** | One-liner. |
| `/admin/calls` | **TODO** | One-liner. |
| `/admin/sms` | Partial | Static config; "Recent batches" is TODO. |
| `/admin/points` | Partial | All numbers/packages hard-coded. |
| `/admin/reports` | **TODO** | One-liner. |
| `/admin/support` | **TODO** | One-liner. |
| `/admin/roles` | **TODO** | One-liner. |
| `/admin/settings` | **TODO** | One-liner. |

### Components

- `Sidebar.tsx` — 11 nav entries with lucide icons, active highlight, sign out.
- `Topbar.tsx` — Title/subtitle, search placeholder (not wired), bell, avatar.

### Libraries

- `lib/firebase.ts` — Client SDK with `NEXT_PUBLIC_*` env.
- `lib/firebase-admin.ts` — Admin SDK from service account env vars (`FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`).

### Dashboard gaps

- No role-gated access (any signed-in user reaches `/admin`).
- No content-redaction layer for private message review.
- No audit logging surface.
- No reports/exports builder.
- No moderation queue.
- No RTL or dark mode.
- No empty/error/loading patterns standardised.

---

## 5. Firebase Functions (`functions`)

| Export | Type | File | Status |
|---|---|---|---|
| `onUserCreate` | Identity (`beforeUserCreated`) | `auth/onUserCreate.ts` | Working — seeds user doc + wallet (50-pt welcome credit). |
| `setAdminClaim` | Callable | `auth/setAdminClaim.ts` | Working; admin-gated by existing custom claim. |
| `onMessageCreate` | Firestore trigger | `chats/onMessageCreate.ts` | Working — updates conversation summary, fans out per-recipient receipt placeholders. |
| `escalateSms` | Callable | `sms/escalate.ts` | Working — resolves audience, reserves points, dispatches via mock gateway, persists per-recipient docs. |
| `onSmsBatchAccepted` | Firestore trigger | `sms/onSmsBatchAccepted.ts` | Working — settles reservation, refunds delta, logs transaction. |
| `buyPoints` | Callable | `points/buy.ts` | Working but **payment provider integration is TODO**; currently trusts `packageId`. |
| `transferPoints` | Callable | `points/transfer.ts` | Working — atomic peer-to-peer with paired transactions. |

Helper: `sms/gateway.ts` — single isolation point for any real SMS provider; currently mocks 90/10 success with 400 ms latency.

### Function gaps

- No payment webhook (Stripe, etc.) — `buyPoints` credits without payment.
- No retry-failed-SMS function.
- No status auto-expiry (storage.rules comment promises a function).
- No FCM dispatch for new messages.
- No audit-log writer or audit-emitting wrappers around admin actions.
- No scheduled function for points expiry (12-month rule referenced in dashboard UI).
- No webhooks endpoint for inbound SMS / delivery reports.
- No callable to mutate roles beyond `admin` boolean (UI promises a richer role manager).

### Security observations

- `setAdminClaim` is gated only by `request.auth.token.admin`. A first admin must be promoted manually (per `FIREBASE_SETUP.md`).
- `buyPoints` is callable by any authed user; without payment verification this is a free-points exploit if exposed.
- `escalateSms` checks sender ownership but not abuse limits (rate, per-day quota, audience size cap).

---

## 6. Firestore

### Collections referenced in code (11 declared, 4 implied)

`users`, `conversations`, `conversations/{c}/members`, `conversations/{c}/messages`, `conversations/{c}/messages/{m}/receipts`, `wallets`, `transactions`, `smsBatches`, `smsBatches/{b}/recipients`, `statuses`, `settings`.

Implied / referenced by UI but not yet modelled: `calls`, `tickets` (support), `roles`/`permissions`, `auditLogs`, `groups` (currently folded into `conversations.type='group'|'channel'`), `communities`.

### Rules (`firestore.rules`)

- `isAdmin()` via custom claim `admin: true`.
- `isMember(convoId)` via existence of self in `members` sub-collection.
- `isGroupAdmin(convoId)` via `members/{uid}.role in ['owner','admin']`.
- All mutation paths to `wallets`, `transactions`, `smsBatches`, `smsBatches/.../recipients` are admin-only — i.e. server-authoritative via Functions.
- `messages.create` requires `senderId == auth.uid`.
- `statuses` are public-read across all authed users (audience filtering is **not** enforced in rules — relies on client filtering).

### Rules gaps

- No content/length validation for messages.
- No write-rate constraints.
- `settings/{doc}` readable by all authed users — sensitive flags should be partitioned.
- `statuses` audience is not enforced server-side.
- `users` create rule allows any self-create — onboarding is currently mediated by the `onUserCreate` trigger, but client could still race.
- No write-side validation that `receipt.status` ∈ {pending, delivered, read, failed}.
- Missing rules for collections the UI implies (calls, tickets, audit logs, roles).

### Composite indexes (`firestore.indexes.json`)

| Collection | Fields |
|---|---|
| `messages` (collectionGroup) | `conversationId ASC`, `createdAt DESC` |
| `conversations` | `memberIds ARRAY_CONTAINS`, `lastMessageAt DESC` |
| `transactions` | `userId ASC`, `createdAt DESC` |
| `smsBatches` | `senderId ASC`, `createdAt DESC` |

### Storage rules

- `/avatars/{uid}/...` — 5 MB, self-write.
- `/conversations/{c}/{senderId}/...` — 30 MB, sender-write.
- `/statuses/{uid}/...` — 15 MB, self-write; comment promises 24 h auto-expire (function missing).

---

## 7. Design tokens (`packages/design-tokens`)

- `colors`: primary scale (`primary`, `primaryDark`, `primaryHover`, `primaryTint`, `primaryLight`, `primarySoft`, `primaryGrad`), 9-step `ink` scale, surface scale, semantic (`ok`, `warn`, `err`, `online`), placeholder dark tokens (`darkBg`, `darkSurface`, `darkSurface2`, `darkInk`).
- `typography`: `fontFamily.{sans, mono, arabic}` (Plus Jakarta Sans / JetBrains Mono / Noto Naskh Arabic), `fontSize` (xs → 4xl), `fontWeight` (regular → extrabold).
- `spacing` numeric scale (0.5 → 24).
- `radius` (none → pill).
- `shadows` (`sh1`, `sh2`, `sh3`, `shApp`).
- `tailwind-preset.js` — extends Tailwind theme so dashboard can use the same tokens.

### Token gaps

- Dark tokens exist but no theme switcher; no token-aware mobile theme provider.
- No motion / easing tokens.
- No elevation tokens for mobile (RN doesn't consume CSS shadows directly).
- No semantic role tokens (e.g. `text.primary`, `surface.muted`) — only raw palette.

---

## 8. Documentation

Present: `README.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FIREBASE_SETUP.md`, `docs/PUSH_TO_GITHUB.md`.

Missing:
- Implementation roadmap, audit, risk register, GitHub task breakdown, technical architecture (this Phase 0 fills these).
- Contribution / coding standards.
- API contract for every callable / trigger.
- Operational runbook (incident, on-call).
- Privacy & data-handling policy.
- Threat model.
- Test strategy.

---

## 9. TODO markers (verbatim, 21 total)

**Mobile**
- `apps/mobile/src/lib/auth.ts` — Phone OTP on native requires `@react-native-firebase/auth`.
- `apps/mobile/src/screens/Privacy.tsx` — port `PrivacyScreen` design.
- `apps/mobile/src/screens/Devices.tsx` — Linked devices.
- `apps/mobile/src/screens/Calls.tsx` — Calls history.
- `apps/mobile/src/screens/Status.tsx` — Status / Stories.
- `apps/mobile/src/screens/SmsEscalation.tsx` — call `escalateSms` Cloud Function.

**Dashboard**
- `/admin/chats` — list conversations from Firestore.
- `/admin/groups` — filter conversations where type ∈ {group, channel}.
- `/admin/calls` — Call logs.
- `/admin/sms` — list `/smsBatches` ordered by `createdAt DESC`.
- `/admin/reports` — Report builder.
- `/admin/support` — Ticket queue.
- `/admin/roles` — Role manager (custom claims mutation).
- `/admin/settings` — Settings groups.

**Functions**
- `functions/src/points/buy.ts` — integrate Stripe / payment provider.

---

## 10. Build & run commands (verified from configs)

```bash
# Install
npm install

# Mobile (web)
npm run dev:mobile

# Dashboard
npm run dev:dashboard

# Functions (TS build + emulator)
npm run dev:functions

# All emulators (Auth, Firestore, Functions, Storage, Hosting, UI)
npm run firebase:emulators

# Demo data
npm run seed

# Quality
npm run typecheck
npm run lint
npm run build

# Deploy
npm run firebase:deploy
```

---

## 11. Technical risks (summary — see Risk Register for full)

1. `buyPoints` credits without payment verification → free-points exploit.
2. `setAdminClaim` bootstrap risk — first admin must be manually promoted; no on-boarding flow.
3. Statuses are visible to all authed users — audience filter not enforced server-side.
4. Dashboard has no role gating beyond authenticated session — any user reaching `/login` can land on `/admin`.
5. Admin dashboard has no content-redaction layer — message content review is unmediated.
6. SMS escalation has no per-user / per-day rate limit, no audience size cap.
7. Wallet reservation/refund relies on a single Firestore trigger — failure modes (stuck `sending` batches) have no reaper.
8. No audit log infrastructure for sensitive admin actions.
9. No FCM dispatch — push notifications absent.
10. No retry / DLQ for failed SMS recipients.
11. Composite-index set is minimal; many admin queries will require additional indexes.
12. Dashboard lacks RTL, dark mode; design tokens exist but are unconsumed.

---

## 12. Files / modules requiring early attention (Phase 1–3)

| Area | File(s) | Reason |
|---|---|---|
| Auth | `apps/mobile/src/lib/auth.ts` | Native OTP path is unimplemented. |
| Auth gating | `apps/dashboard/app/admin/layout.tsx` (to add) | Route guard absent — risk #4. |
| Points security | `functions/src/points/buy.ts` | Free-points exploit — risk #1. |
| SMS abuse | `functions/src/sms/escalate.ts` | No quotas — risk #6. |
| Rules | `firestore.rules` | Missing collections (audit, calls, tickets, roles); validation gaps. |
| Indexes | `firestore.indexes.json` | Must grow alongside admin queries. |
| Receipts | `functions/src/chats/onMessageCreate.ts` | Fan-out works; receipt update path from clients needs explicit callable / write rules. |
| Theming | `packages/design-tokens/src/index.ts`, `apps/mobile/src/theme`, dashboard Tailwind | No dark theme wiring; no semantic role tokens. |
| Dashboard shell | `apps/dashboard/components/Sidebar.tsx`, `Topbar.tsx` | RBAC-aware visibility; user-menu wiring. |

---

## 13. Recommended first implementation phase

**Phase 1 — Design system, layout shells, and route hardening.**

- Bring dashboard `app/admin/layout.tsx` under an auth+admin guard (server check via `firebase-admin`).
- Promote design tokens to a semantic layer (role tokens for `text/surface/border/state`) so dark mode and RTL land cleanly later.
- Standardise loading / empty / error / permission / success states across both apps (single primitives).
- Add lint, typecheck, and emulator-based smoke checks to a GitHub Action so every later PR has a green baseline.

Phase 1 should not yet touch chat data flow, Firestore rules of the messaging system, or Functions logic — those land in Phases 2–4.
