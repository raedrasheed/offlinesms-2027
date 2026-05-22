# OfflineSMS Technical Architecture

System-level blueprint for the build-out described in `OFFLINESMS_IMPLEMENTATION_ROADMAP.md`.

---

## Phase 8 — OfflineSMS SMS escalation

- **Backend.** `escalateSms` (Phase 0 callable) is rewritten in place: audience canonical form (`'everyone' | 'unread_only' | 'undelivered_only'` + legacy aliases), recipient resolution off Phase 7 receipts, eligibility classification (`no-phone` / `unverified-phone` / `opt-out` / `duplicate-phone` / `already-sent-for-message` / `rate-limited` / `policy-blocked`), daily batch cap (`MAX_BATCHES_PER_DAY = 20`), audience size cap (`MAX_RECIPIENTS_PER_BATCH = 200`), per-message cooldown (`COOLDOWN_MS = 60_000`), and quota persistence to `smsQuotaUsage/{uid}/days/{yyyymmdd}`.
- **Preview and retry.** `previewSmsEscalation` is a read-only mirror of the eligibility logic. `retryFailedSmsRecipients` re-dispatches only the failed recipients of an existing batch, linked via `retryOfBatchId`; bypasses the cooldown but still respects the daily cap.
- **Settlement.** `onSmsBatchAccepted` (Phase 0) now also stamps `pointsDeducted` and `pointsRefunded` onto the batch doc so the OfflineSMS Delivery Report shows final numbers.
- **Audit.** `sms.escalation.created` / `sms.escalation.accepted` / `sms.escalation.partial` / `sms.escalation.failed` / `sms.escalation.retry_failed`. Counts-only metadata — never the SMS body, never the message body, never full phone numbers.
- **Branding.** Single provider isolation point at `functions/src/sms/gateway.ts`. The rest of the system — UI, audit logs, telemetry, docs — only sees OfflineSMS.
- **Mobile UI.** `SmsEscalation.tsx` five-step flow (audience → recipients → text → confirm → result), driven by the Phase 8 callables; `MessageInfo` + `MessageBubble` entry points gated to the sender of the message.
- **Rules.** Unchanged. Phase 0 + Phase 3 already lock `smsBatches`, its `recipients`, and `smsQuotaUsage` to server-only writes.
- **Caps & defaults:** `COST_PER_SMS = 28` (Phase 0 default), `EDIT_WINDOW_MS` and other policy constants live in `functions/src/sms/recipients.ts`.

---

## Phase 7 — Delivery receipts, read receipts, message views

- **Receipt doc shape:** `conversations/{c}/messages/{m}/receipts/{uid}` — `{ status, deliveredAt, readAt, viewedAt, playedAt, failedAt, failureReason, createdAt, updatedAt }`. Doc id is always the recipient uid.
- **Aggregate counts on messages:** `deliveredCount`, `readCount`, `viewedCount`, `playedCount`, `failedCount`, `pendingCount`, `receiptUpdatedAt` — server-owned (Phase 6's admin-only `messages.update` rule is unchanged).
- **`markReceipt` callable** is the canonical write path. Server-enforced monotonic transitions (`pending → delivered → read/viewed/played`, `* → failed`); downgrades are silently no-op'd. Wrapped in a Firestore transaction so concurrent clients can't race past the guard. Self-receipts are no-op'd.
- **`onReceiptWrite` trigger** recomputes the message-level aggregates on every change to a receipt doc — simple full-scan; acceptable at the Phase 5 group cap of 256.
- **Receipt read rule tightens** so participants can't enumerate each other's receipts. Only the receipt owner, the message sender, or an admin can read. Writes keep the Phase 3 owner-allowed path with the enum guard; `markReceipt` (Admin SDK) is the canonical write path.
- **Client rate limiting** in `apps/mobile/src/lib/conversations.ts`: in-memory dedupe of `(messageId, status)` per session + 300 ms debounce. Server still enforces no-downgrade, so even a lost dedupe state can't regress a receipt.
- **`getMessageInfo` extended:** senders see a per-recipient list with role badge + per-status timestamps + failure reason; non-senders see aggregates only and the client surfaces a permission notice.
- **`statuses/{statusId}/views/{viewerUid}`** records who viewed a status. Doc id = viewer uid → no duplicate growth. Writes go through `markStatusViewed`, which re-runs Phase 3's audience + expiry check server-side.
- **Design choice — "viewed" folded into receipts:** Phase 7 reuses the receipts enum's `viewed` for text messages. A dedicated `messages/{m}/views/{uid}` sub-collection is reserved for media-specific events when media support lands; the aggregation trigger stays uniform.

---

## Phase 6 — Message actions and message info

- **Message schema (additive):** `editedAt`, `deletedForEveryone`/`deletedAt`/`deletedBy`/`deleteReason`, `replyTo`, `forwarded`+`forwardedFrom`, `reactions`, `pinnedAt`+`pinnedBy`, `expiresAt`. `sendTextMessage` initialises every field at creation so docs are uniform.
- **Per-user message state lives on the existing `conversations/{c}/userState/{uid}` doc** — adds bounded `starredMessageIds` + `deletedForMeMessageIds` arrays (FIFO-capped at 500). No new collection, no new listener.
- **Conversation-level pin** at `conversations/{c}.pinnedMessage` (single message per conversation; multi-pin is a future enhancement).
- **Seven Phase 6 callables** (`editMessage`, `deleteMessage`, `reactToMessage`, `starMessage`, `pinMessage`, `forwardMessages`, `getMessageInfo`) own every state transition. Rules narrow `messages.update`/`messages.delete` to admin-only at the rules layer; legitimate mutations always come through the callables (Admin SDK).
- **Edit window:** 15 minutes from `createdAt`. The check lives in `editMessage`.
- **Delete-for-everyone policy:** sender always; group owner/admin may delete other members' messages.
- **Pin policy:** direct chats — any participant; groups — owner/admin only.
- **Forward:** text-only, ≤10 source messages × ≤10 targets, per-target send-permission check (locked / onlyAdminsCanSend respected).
- **Disappearing-message TTL foundation:** `messages.expiresAt` field + a scheduled function `sweepExpiredMessages` that's **not** exported from the functions barrel in Phase 6. Activation deferred to Phase 11 alongside the client TTL setting UI.
- **Audit:** `message.edited`, `message.deleted.for_me`, `message.deleted.for_everyone`, `message.pinned`, `message.unpinned`, `message.forwarded` (counts only). Reactions and stars deliberately not audited (noise).

---

## Phase 5 — Group chat and member management

- **`conversations/{id}` group fields:** `name`, `avatarUrl`, `ownerUid`, `memberCount`, `settings { onlyAdminsCanSend, onlyAdminsCanEditInfo, onlyAdminsCanAddMembers }`. `status` extended with `'locked'`.
- **`conversations/{c}/members/{uid}`** becomes the canonical role table: `role: 'owner' | 'admin' | 'member'`, `status: 'active' | 'removed' | 'left'`, plus `addedBy`, `displayNameSnapshot`, `photoURLSnapshot`. Phase 0/4 docs (with only `{ role }`) keep working — callables `merge: true`.
- **Group messages** carry `senderDisplayName` and `senderPhotoURL` snapshots captured at send time so the chat list and message bubbles render sender headers without joining `/users`.
- **Six callables** drive all group writes server-side: `createGroup`, `addMembers`, `removeMember`, `changeRole`, `leaveGroup`, `lockGroup`. All audited (`group.*` namespace), all using the Admin SDK so client-side rules don't have to know about role transitions.
- **`sendTextMessage`** is the only entry point that can write a group message. It rejects non-active members, `status === 'locked'` for non-privileged callers, and `settings.onlyAdminsCanSend` for non-privileged callers.
- **Rules:** `conversations.create` now requires `ownerUid == auth.uid` and self-inclusion in `participantUids` for any `type === 'group'` doc. `members/{uid}` is server-only for groups; the legacy path remains for non-group conversations. Helpers added: `getMemberRole(c)`, `isConversationOwner(c)`, `isConversationAdmin(c)`, `isValidGroupRole(role)`, `isGroupTypeData(d)`, `safeGroupConversationCreate()`.
- **Cap:** `MAX_GROUP_MEMBERS = 256`, enforced in `createGroup` and `addMembers`.
- **New composite index:** `conversations(participantUids, type, updatedAt)` for the "Groups" filter chip.
- **Owner transfer is deferred.** Owners cannot leave a non-empty group; transferring ownership to another admin lands in a later phase.

---

## Phase 4 — Chat list and one-to-one messaging

- **Canonical conversation shape:** `participantUids: string[]`, `participantKey: string` (sorted-uid join for O(1) direct-conversation lookup), `lastMessage: { messageId, senderUid, type, preview, createdAt }`, `status: 'active' | 'archived' | 'disabled'`, `createdBy`, `createdAt`, `updatedAt`. `memberIds`, `lastMessageText`, `lastMessageAt`, `lastSenderId`, message-level `senderId` are written alongside as back-compat aliases.
- **Per-user state and typing** live under `conversations/{c}/userState/{uid}` and `conversations/{c}/typing/{uid}`. Counters (`unreadCount`, `lastReadAt`, `lastMessagePreview`, `lastMessageAt`) are server-owned; clients write only `{ pinned, muted, archived, favorite, updatedAt }`. Typing docs carry `expiresAt = now + 3000ms` so readers filter live state client-side.
- **Callables (audited):** `getOrCreateDirectConversation`, `sendTextMessage`, `markRead`, `setTyping` (typing intentionally unaudited to avoid noise). Each emits a `chat.*` audit event; `sendTextMessage` records only `{ conversationId, length }` — the audit-log sanitiser strips `body`/`content`/`messageText` defensively.
- **Single fan-out trigger:** `onMessageCreate` updates the conversation summary, refreshes recipient `userState` (unread + preview), zeroes the sender's own `userState`, and writes per-recipient receipt placeholders (status `pending` per Phase 3's enum).
- **New composite indexes:** `conversations(participantUids, updatedAt)`, `conversations(participantUids, status, updatedAt)`. Existing indexes preserved.

---

## Phase 3 — Core data model and rules hardening

- **New collections (rules + schema only):** `organizations`, `organizations/{id}/members`, `roles`, `auditLogs`, `tickets`, `flags`, `payments`, `gatewayHealth`, `smsQuotaUsage/{uid}/days/{yyyymmdd}`. Schemas live in `docs/OFFLINESMS_DATA_MODEL.md`.
- **System-owned collections** — `auditLogs`, `gatewayHealth`, `smsQuotaUsage`, `payments` — are `allow write: if false` for clients. All writes happen through Cloud Functions via the Admin SDK (which bypasses rules). Even admin web sessions cannot write here directly; this keeps idempotency and audit in one codepath.
- **`statuses` audience + expiry** are enforced in `firestore.rules` (helpers `isStatusExpired()`, `isStatusAudienceMember()`). Client-side filtering is no longer load-bearing.
- **Receipts** carry a validated enum: `pending | delivered | read | viewed | played | failed`. Unknown statuses are rejected.
- **Audit logging.** `functions/src/lib/auditLog.ts` exports `writeAuditLog({ action, actor, target, result, metadata })` plus `sanitiseMetadata()` / `redactPhone()` / `redactEmail()`. The helper is **soft-failing** — audit-write errors never roll back the primary action. The first consumers are `claimUsername` (`auth.username.claimed` / `auth.username.changed`) and `setAdminClaim` (`admin.claim.set`).
- **Composite indexes added:** `auditLogs(actorUid, createdAt)`, `auditLogs(targetType, targetId, createdAt)`, `payments(userId, createdAt)`, `flags(status, createdAt)`, `tickets(createdBy, status, updatedAt)`, `statuses(authorId, createdAt)`.
- **Deferred (documented):** organization-membership rules (Phase 13), welcome-credit callable (Phase 10), automated rules tests (Phase 20).

---

## Onboarding & username uniqueness (Phase 2)

- **`users/{uid}.profileCompleted: boolean`** drives onboarding routing on mobile. Set by `claimUsername`; seeded as `false` by `onUserCreate`.
- **`usernames/{lowercaseUsername}`** is the uniqueness lookup, written **only** by the `claimUsername` callable. Shape: `{ uid, username, claimedAt }`. Anyone signed in can read the doc (so the UI can preview "taken" status); writes are denied to clients and routed through the callable, which uses the Admin SDK to bypass rules.
- **`claimUsername` callable** runs a single Firestore transaction that:
  - rejects when the target username is held by another uid (`already-exists`),
  - releases the caller's prior `usernameLower` if they're renaming, and
  - updates `users/{uid}` with `displayName`, `username`, `usernameLower`, `about`, `profileCompleted: true`, `updatedAt`.
- **Reserved usernames** (`admin`, `support`, `system`, `offlinesms`, `official`, `root`, `null`, `undefined`, …) are enforced **both** client-side (`apps/mobile/src/lib/username.ts`) and server-side (`functions/src/auth/claimUsername.ts`). The two lists must stay in sync.
- **OTP secrets** never leave the Firebase SDK boundary: `ConfirmationResult` lives in module-scope memory, isn't persisted, isn't logged.

## User profile field allow-list (Phase 2)

`firestore.rules` enforces a field allow-list on `users/{uid}.update`:

| Allowed (self) | Banned (server-owned) |
|---|---|
| `displayName`, `photoURL`, `about`, `profileCompleted`, `fcmTokens`, `lastSeen`, `updatedAt` | `role`, `roles`, `permissions`, `admin`, `isAdmin`, `points`, `pointsBalance`, `wallet`, `walletStatus`, `organizationId`, `organizationRole`, `createdAt`, `phoneVerified`, `status`, `phoneNumber`, `email`, `username`, `usernameLower` |

`username` / `usernameLower` are intentionally banned from direct client writes: they only get written by the `claimUsername` callable (Admin SDK bypasses rules). Admins keep an escape hatch via `isAdmin()`.

## Admin bootstrap (Phase 2)

`scripts/promoteAdmin.ts` (run via `npm run promote:admin -- <email>`) sets `admin: true` + `role: 'super_admin'` custom claims on a target user, preserving any existing claims. Long-term admin management belongs to Phase 18; this script is bootstrap-only. See `docs/admin-bootstrap.md`.

---

## Design tokens — semantic layer (Phase 1)

Two-tier token model in `@offlinesms/design-tokens`:

- **Raw palette** (unchanged): `colors.{primary, ink*, surface, bgCanvas, ok, warn, err, darkBg, …}`. Still consumed by existing code; never deprecated within this roadmap.
- **Semantic layer** (new): `semantic.color.{background, text, border, action, state}` with light and dark variants. UI code added after Phase 1 should prefer semantic names. Tailwind preset exposes both, so `bg-bg-app` and `bg-canvas` are equivalent today.

See `docs/DESIGN_TOKENS_SEMANTIC_LAYER.md` for the full table and usage examples.

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

- **Framework:** Next.js 14, App Router, `typedRoutes`. Originally configured for static export (`out/`) served by Firebase Hosting; since Phase 1, `/admin/*` is server-rendered on demand (`runtime: 'nodejs'`, `dynamic: 'force-dynamic'`) so the admin guard can run server-side. Production deploys for `/admin/*` need a Node host (Cloud Run / Vercel) — addressed in Phase 12.
- **Session cookie:** Phase 1 introduces an HTTP-only `__session` cookie issued by `POST /api/session` (Firebase Admin `createSessionCookie`, 5-day expiry) and cleared by `DELETE /api/session`. `app/admin/layout.tsx` calls `verifySession(cookieValue)` (in `lib/session.ts`) on every request.
- **Admin role model (Phase 1):** any of `admin: true` claim · `permissions.canAccessAdmin === true` · `role` or `roles[]` ∈ {`super_admin`, `organization_admin`, `support_agent`, `finance_admin`, `auditor`} · email in `BOOTSTRAP_ADMIN_EMAILS` (env). Replaced by the full RBAC model in Phase 18; the single chokepoint at `verifySession` makes that migration a one-file change.
- **Layouts:**
  - `app/layout.tsx` — global shell, theme bootstrap.
  - `app/admin/layout.tsx` — **server component** that verifies session cookie + admin role (Phase 1).
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
