# OfflineSMS Technical Architecture

System-level blueprint for the build-out described in `OFFLINESMS_IMPLEMENTATION_ROADMAP.md`.

---

## A. Monorepo

```
offlinesms-2027/
├── apps/
│   ├── mobile        Expo SDK 51, React Native 0.74, RN Web 0.19
│   └── dashboard     Next.js 14 (App Router, static export → Firebase Hosting)
├── packages/
│   └── design-tokens Tokens + Tailwind preset (consumed by both apps)
├── functions/        Firebase Functions Gen 2 (Node 20, TS)
├── scripts/          Seed + admin promotion (admin SDK)
├── docs/             Architecture, data model, roadmap, audit
└── (root)            firebase.json, firestore.rules/indexes, storage.rules, tsconfig.base
```

- **Workspaces:** `apps/*`, `packages/*`, `functions`.
- **Common TS config:** `tsconfig.base.json` — strict, ES2022, bundler resolution.
- **Build orchestration:** root `package.json` runs `build|lint|typecheck` across workspaces via `--if-present`.
- **Versioning:** single repo version (`0.1.0`); apps inherit via workspace.

---

## B. Mobile architecture

- **Entry:** `App.tsx` provides `SafeAreaProvider` + `NavigationContainer` + auth listener.
- **Navigators:**
  - `AuthFlow`: `Welcome` → `PhoneEntry` → `Otp` → `ProfileCompletion` (added in Phase 2).
  - `MainTabs`: Chats / Status / Calls / Settings.
  - Root stack overlays: `Conversation`, `Points`, `Privacy`, `Devices`, `SmsEscalation`, `SmsBatchReport`, `BuyPoints`, `TransferPoints`, `MessageInfo`, `GroupInfo`, `NewGroup`.
- **State:** local `useState` + Firestore listeners are sufficient today. A minimal store (zustand or context-only) will land when listeners need sharing (Phase 4+).
- **Data layer:** thin wrappers in `src/lib/` (`firebase.ts`, `auth.ts`, `chats.ts`, future `sms.ts`, `points.ts`, `groups.ts`). Each wrapper exposes only typed primitives — screens never construct Firestore queries directly outside `lib/`.
- **i18n:** i18next + `expo-localization`. RTL enforced via `I18nManager.forceRTL` at boot.
- **Theming:** `src/theme/index.ts` consumes semantic tokens from `@offlinesms/design-tokens`. Dark mode added in Phase 19 behind a provider.
- **Offline:** Firestore SDK offline persistence on by default. All mutations are idempotent (clients pass deterministic IDs where applicable).
- **Push:** FCM tokens stored on `users.fcmTokens` (Phase 4+). A function `dispatchNewMessageNotification` sends pushes on `onMessageCreate`.

---

## C. Dashboard architecture

- **Framework:** Next.js 14, App Router, `typedRoutes`, static export (`out/`) served by Firebase Hosting.
- **Layouts:**
  - `app/layout.tsx` — global shell, theme bootstrap.
  - `app/admin/layout.tsx` — **server component** that verifies session cookie + `admin` claim via `firebase-admin` (Phase 1).
- **Routing pattern:** `app/admin/<entity>/{page,layout,error,loading}.tsx`; entity detail under `[id]`.
- **Data fetching:** server components read via `firebase-admin`; client components read via the public SDK with strict listener limits (typically `limit(50)`).
- **Forms:** uncontrolled inputs + server actions where convenient; callable functions for any privileged write.
- **Components:** `components/` for shared UI (`Sidebar`, `Topbar`, edge-state primitives, tables, drawers). All consume tokens via Tailwind preset.
- **Auth flow:** `/login` issues a session cookie (`__session`) via `app/api/session/route.ts`; `app/admin/layout.tsx` verifies it on each navigation. Logout clears the cookie and calls `auth.signOut()`.
- **RBAC:** sidebar and route guards consult `permissions` derived from custom claims (Phase 18).

---

## D. Firebase architecture

- **Project:** `offlinesms-prod` (production). Staging project to be added before Phase 20.
- **Services in use:** Auth (Phone OTP, Email/Password, Google), Firestore (Native mode), Storage, Functions (Gen 2 on Node 20), Hosting, FCM.
- **Emulators:** Auth (9099), Firestore (8080), Functions (5001), Storage (9199), Hosting (5000), UI (4000).
- **Configuration:** `firebase.json` + `.firebaserc` (single project + hosting target).
- **Secrets:** service-account JSON for admin tasks; payment-provider keys (Phase 10) stored via `firebase functions:secrets`.

---

## E. Firestore data model (consolidated)

```
users/{uid}                        displayName, username, phoneNumber, email, avatarUrl,
                                   about, status, profileComplete, presence, lastSeen,
                                   fcmTokens[], roleIds[], permissionsHash, createdAt

usernames/{lower}                  uid, createdAt                          (uniqueness lookup)

conversations/{convoId}            type ('dm'|'group'|'channel'), name, photoUrl,
                                   memberIds[], ownerId, locked,
                                   lastMessageText, lastMessageAt, lastSenderId,
                                   disappearingDuration, createdAt
  members/{uid}                    role ('owner'|'admin'|'member'), joinedAt
  userState/{uid}                  pinned, muted, archived, unread, lastReadAt
  typing/{uid}                     since (serverTimestamp, ephemeral)
  messages/{msgId}                 senderId, type, text, mediaUrl, metadata,
                                   forwarded, replyTo, reactions{}, pinnedAt,
                                   starredBy[], disappearAt, editedAt, createdAt,
                                   deliveredCount, readCount   (denorm)
    receipts/{uid}                 status, deliveredAt, readAt, playedAt
  views/{viewerId}                 firstSeenAt, lastSeenAt   (media views)

statuses/{statusId}                authorId, type, body, mediaUrl, backgroundColor,
                                   audience ('contacts'|'except'|'only'),
                                   audienceList[], expiresAt, createdAt
  views/{viewerId}                 viewedAt

wallets/{uid}                      balance, reserved, updatedAt, createdAt
transactions/{txId}                userId, type, amount, package, batchId, peerId,
                                   note, refund, sent, failed, priceCents, createdAt

smsBatches/{batchId}               messageId, conversationId, senderId, audience,
                                   smsBody, recipientCount, estimatedCost,
                                   gatewayBatchId, status, createdAt
  recipients/{uid}                 maskedPhone, smsStatus, reason,
                                   providerMessageId, sentAt, deliveredAt, failedAt

smsQuotaUsage/{uid}/{yyyymmdd}     batches, recipients, points

payments/{paymentId}               uid, packageId, provider, status, amountCents,
                                   webhookSig, idempotencyKey, createdAt

settings/{doc}                     sms-gateway | points-cost-rules | packages |
                                   feature-flags | branding | quota-limits

organizations/{orgId}              name, ownerId, plan, createdAt
  members/{uid}                    role, joinedAt

communities/{id}                   name, photoUrl, ownerId, createdAt
  channels/{convoId}               linked-conversation ref

calls/{callId}                     type ('audio'|'video'), participantIds[],
                                   startedAt, endedAt, status

tickets/{id}                       requesterId, status, subject, createdAt
  messages/{n}                     authorId, body, createdAt

flags/{id}                         targetType, targetId, reporterId, reason, status

roles/{id}                         name, permissions{action:bool}

auditLogs/{id}                     actorId, action, targetType, targetId,
                                   before, after, reason, redactionLevel, createdAt

gatewayHealth/{yyyymmdd}           successCount, failureCount, p95LatencyMs,
                                   rollupAt
```

---

## F. Security rules model

- **Identity:** Firebase Auth. Server-authoritative role via custom claims; `admin: true` for legacy, `permissions: {<action>: true}` after Phase 18.
- **Helpers:**
  - `isAuthed()` — `request.auth != null`.
  - `isSelf(uid)` — `request.auth.uid == uid`.
  - `isAdmin()` — `request.auth.token.admin == true`.
  - `hasPermission(action)` — `request.auth.token.permissions[action] == true` (Phase 18).
  - `isMember(convoId)` — existence in `conversations/{c}/members/{auth.uid}`.
  - `isGroupAdmin(convoId)` — role in {owner, admin}.
- **Mutation classes:**
  - **Free** (rare): `usernames` create-when-free.
  - **Self-scoped:** `users` (allow-list update), `wallet` reads, `receipts` writes.
  - **Member-scoped:** `conversations` and `messages` read/write.
  - **Server-authoritative:** `wallets`, `transactions`, `smsBatches`, `payments`, `auditLogs`, `flags`, `tickets`, `roles`, `gatewayHealth`, `settings` (writes), `smsQuotaUsage`.
- **Validation:** enum checks for status fields; `size(content) < limit`; field-allow-list on update.
- **Rate guarding:** rules enforce single-doc constraints; Functions enforce volumetric quotas.

---

## G. Cloud Functions architecture

- **Codebase:** single `functions/` codebase, TypeScript, Gen 2 only.
- **Module layout:**
  ```
  functions/src/
  ├── auth/           onUserCreate, claimUsername, setAdminClaim
  ├── chats/          onMessageCreate, markReceipt, onReceiptWrite,
                      messageActions(.edit/.delete/.react/.forward)
  ├── groups/         create, addMembers, removeMember, changeRole, lock
  ├── sms/            escalate, gateway, onSmsBatchAccepted, retry, webhook, sendTest
  ├── points/         buy (webhook-driven), transfer, adminAdjust, refund
  ├── payments/       webhook
  ├── admin/          updateUser, lockConversation, viewMessageContent,
                      setRole, setPermissions, moderate, closeTicket
  ├── reports/        rollups, exportCsv
  ├── gateway/        rollupHealth (scheduled)
  ├── status/         purgeExpired (scheduled)
  ├── reapers/        reapStuckBatches (scheduled), reconcileCounters (scheduled)
  └── lib/            auditLog, firestore helpers, validators
  ```
- **Patterns:**
  - Every callable validates `request.auth` and uses `HttpsError`.
  - Every privileged write invokes `auditLog.write(...)` with `before/after` snapshots.
  - Idempotency keys on payments, retries, escalations.
  - Triggers are minimal: aggregation + side effects; business logic lives in callables.

---

## H. OfflineSMS Gateway architecture

- **Boundary:** `functions/src/sms/gateway.ts` is the **only** module aware of any underlying SMS provider. The rest of the codebase consumes a typed interface (`sendBatch(batchId, body, recipients): Promise<SmsBatchResult>`).
- **Naming:** every user-visible string uses "OfflineSMS" — no provider names in copy, telemetry, or logs.
- **Settings:** runtime config in `settings/sms-gateway` (sender ID, daily limit, webhook URL, balance display).
- **Health:** scheduled rollup writes to `gatewayHealth/{yyyymmdd}` (success rate, p95).
- **DLRs:** `sms/webhook.ts` validates HMAC, updates `smsBatches/{b}/recipients/{uid}`.
- **Retries:** `sms/retry.ts` produces a new batch limited to failed recipients.

---

## I. OfflineSMS Points architecture

- **Invariants:**
  - `balance >= 0` always.
  - `reserved >= 0`; `reserved <= balance + reserved` (never reserve more than held).
  - Every state change writes a `transactions` row.
- **Flows:**
  - **Buy:** webhook → idempotent `payments/{id}` upsert → wallet credit + `transactions(type='buy')`.
  - **Transfer:** transactional debit + credit; paired transactions.
  - **Reserve:** `escalateSms` transaction moves `balance → reserved` by `estimatedCost`.
  - **Settle:** `onSmsBatchAccepted` reduces `reserved` and refunds the delta if the actual cost was lower.
  - **Refund:** explicit admin callable for failed batches that weren't auto-refunded.
- **Cost calculation:** `settings/points-cost-rules` (`pointsPerSegment`, `minPointsPerSms`, `rounding`, `expireAfterMonths`).
- **Expiry:** scheduled function debits points older than the configured horizon, writing `transactions(type='admin-adjust', note='expiry')`.

---

## J. SMS escalation architecture

```
Mobile UI (SmsEscalation.tsx)
  └── escalateSms (callable)
        ├── audience resolution from receipts
        ├── phone fetch + mask
        ├── reserve points (transaction)
        ├── write smsBatch (status='sending')
        ├── gateway.sendBatch (mock today)
        ├── write per-recipient docs
        └── update smsBatch (status='accepted'|'partial')
                 ▼ trigger
            onSmsBatchAccepted
                 ├── count sent/failed
                 ├── settle reservation
                 ├── refund delta
                 └── write transaction(type='sms')

Reaper (scheduled) — for batches stuck in 'sending' > 15 minutes:
  release reservation, mark batch 'failed', audit.
```

Webhook channel:
```
Provider → sms/webhook (HMAC) → smsBatches/{b}/recipients/{uid} update
```

---

## K. Delivery / read receipt architecture

- `onMessageCreate` writes one `receipts/{uid}` placeholder per non-sender recipient with `status='pending'`.
- Client calls `markReceipt({messageId, status})` on render (delivered), focus (read), or play (played).
- `onReceiptWrite` aggregates `deliveredCount` and `readCount` onto the message doc.
- `MessageInfo` reads aggregated counts and a sample of receipts; expensive full-list reads are lazy.

---

## L. Message views architecture

- For media + statuses, `views/{viewerId}` records first/last viewed time.
- Aggregated counters on parent doc (`messages.viewCount`, `statuses.viewCount`).
- View writes deduped by `(viewerId, hour)` to avoid cost.

---

## M. Admin dashboard architecture

- **Shell:** Sidebar + Topbar present on every admin page.
- **Server-side guard:** `app/admin/layout.tsx` verifies session cookie and admin claim via `firebase-admin`. Any unauthorised access redirects (401 → `/login`, 403 → `/admin/no-access`).
- **Per-page pattern:** server component for initial data, optional client component for interactivity, edge-state primitives for loading/empty/error/permission/success.
- **Privileged writes:** always via callable functions (never direct Firestore writes from the dashboard), so audit logging is centralised.
- **Content redaction:** message content default-hidden in `/admin/chats/[id]/messages`. Reveal button gated by permission, requires reason, writes audit, surfaces a one-time decrypted view.

---

## N. RBAC model

- **Phase ≤ 17:** single `admin: true` claim. Sufficient as a coarse gate.
- **Phase 18:** `roles/{roleId}` documents map action → boolean. A `setRole` callable assigns roles to users and writes a `permissions` object into the custom claim. Examples of actions: `canReadMessageContent`, `canRefundBatch`, `canAdjustWallet`, `canSuspendUser`, `canManageRoles`.
- **Enforcement:** rules check `request.auth.token.permissions[action] == true`; functions reuse a shared `requirePermission(action)` helper.
- **Revocation:** `setRole` rewrites claims; client reload picks them up. A `forceTokenRefresh` callable is provided for urgent revocation.

---

## O. Audit logging model

- **Helper:** `functions/src/lib/auditLog.ts` writes `auditLogs/{auto}` with `{actorId, action, targetType, targetId, before, after, reason?, redactionLevel, ip, ua, ts}`.
- **Conventions:**
  - `redactionLevel` ∈ `{ 'none' | 'phoneMasked' | 'contentRedacted' }` — controls what `before/after` may contain.
  - Reveals (message-content view, phone unmask) require a `reason` field.
- **Querying:** dashboard `/admin/audit` uses indexes `(actorId, createdAt DESC)`, `(targetType, targetId, createdAt DESC)`, `(action, createdAt DESC)`.
- **Retention:** configurable in `settings/feature-flags.auditRetentionDays`; a scheduled function purges old entries.

---

## P. RTL & localisation architecture

- **Mobile:** i18next; locale detection at boot; `I18nManager.forceRTL` for Arabic. Token-based spacing avoids hard-coded left/right; logical properties (`marginStart` / `marginEnd`) used everywhere.
- **Dashboard:** `dir` attribute on `<html>` driven by user preference (falls back to `navigator.language`). Tailwind RTL plugin or manual mirroring for icons. Logical CSS properties throughout.
- **Strings:** every user-visible string passes through `t()`. CI lints for raw English strings in JSX after Phase 19.

---

## Q. Dark mode architecture

- **Semantic tokens (Phase 1)** decouple components from raw colors:
  - `text.primary / secondary / muted`, `surface.canvas / raised / sunken`, `border.subtle / strong`, `state.danger / warn / ok / info`, plus interactive (`action.primary`, `action.primaryHover`).
- **Theme provider** sets light/dark variant via CSS variables on `<html>` (dashboard) and a React Context provider (mobile). System preference is the default; manual toggle in settings.
- **Tokens for elevation** so mobile shadows map to RN `elevation` cleanly.

---

## R. Testing strategy

| Layer | Tool | Coverage goal |
|---|---|---|
| Type checks | `tsc` per workspace | 100% in CI |
| Unit (functions) | `vitest` | Business logic in `functions/src/lib/*`, every callable's happy + error paths |
| Firestore rules | `@firebase/rules-unit-testing` | Every collection, every actor variant |
| Component (mobile) | `@testing-library/react-native` | Edge-state primitives, screens with logic (Conversation, SmsEscalation) |
| Component (dashboard) | `@testing-library/react` + Playwright component | Auth guard, role-based menu, redaction UI |
| E2E mobile | Detox (iOS + Android) | Auth → send a message → escalate SMS → wallet flow |
| E2E dashboard | Playwright | Login → users list → user detail → audit log |
| Load | k6 against emulator + staging | `escalateSms`, `markReceipt`, `webhook` |
| Visual | Chromatic / Percy (optional) | RTL × dark mode matrix |

CI runs typecheck + lint + unit + rules on every PR; e2e nightly.

---

## S. Deployment strategy

- **Environments:** local emulators → `offlinesms-staging` (added Phase 20) → `offlinesms-prod`.
- **CI/CD:**
  - PR: install, typecheck, lint, unit tests, rules tests, build mobile web + dashboard + functions.
  - Merge to `main`: deploy preview channel for hosting + functions to staging.
  - Tagged release: deploy to production (hosting + functions + rules + indexes) behind a manual approval.
- **Releases:** semantic version on the root `package.json`. Release notes generated from PR labels (`phase:X`).
- **Feature flags:** `settings/feature-flags` gates risky paths (dark mode, communities, new SMS providers).
- **Rollback:** Firebase Hosting channels for instant revert; functions versioned via `firebase functions:secrets` + Cloud Functions traffic split.
- **Observability:** Cloud Logging filters by function name; dashboards in Cloud Monitoring for SMS success rate, callable error rate, listener cost.
