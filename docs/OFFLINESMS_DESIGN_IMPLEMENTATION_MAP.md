# OfflineSMS Design → Implementation Map

Maps every product design module to the current technical implementation. **Status** uses: ✅ Complete · 🟡 Partial · 🟧 Scaffold only · ❌ Missing.

Legend for "Recommended phase" matches `OFFLINESMS_IMPLEMENTATION_ROADMAP.md`.

---

## 1. Onboarding & authentication

| | |
|---|---|
| **Status** | 🟡 Phase 2 landed: web OTP, native-OTP plumbing, profile completion gating. Native verifier mount + email-link still pending. |
| **Existing** | `apps/mobile/src/screens/{Welcome,PhoneEntry,Otp,ProfileCompletion}.tsx`; `apps/mobile/src/lib/{auth,profile,username}.ts`; `functions/src/auth/{onUserCreate,claimUsername}.ts`; `apps/dashboard/app/login/page.tsx`; `scripts/promoteAdmin.ts` |
| **Missing** | Verifier mount for `expo-firebase-recaptcha` (or `@react-native-firebase/auth`), email-link path, password-less retry, terms acceptance, restore session UX, multi-device handoff |
| **Frontend** | Verifier modal mount in mobile root, optional `EmailLink.tsx`, terms checkbox |
| **Backend** | (Phase 3) `auditLog` helper to capture onboarding events |
| **Firestore** | `users` (extended), `usernames/{lower}` (lookup, new in Phase 2) |
| **Indexes** | — (lookup by doc id) |
| **Rules** | `users.update` field allow-list (Phase 2 ✓); `usernames` server-only writes (Phase 2 ✓) |
| **Tests** | OTP success/fail, profile claim collision, dup-username, RTL screens (Phase 20) |
| **Phase** | 2 ✓ (with documented follow-ups) |

## 2. User profile

| | |
|---|---|
| **Status** | 🟡 Edit-on-create exists; ongoing edit + avatar deferred. |
| **Existing** | `users/{uid}` schema with `displayName`, `username`, `usernameLower`, `about`, `profileCompleted`; field allow-list in rules; `claimUsername` callable handles renames too |
| **Missing** | Profile view + edit screens, avatar upload, presence, status text |
| **Frontend** | `Profile.tsx` (view), `ProfileEdit.tsx`, avatar picker, presence indicator |
| **Backend** | `setPresence` (heartbeat / RTDB); image-upload validation |
| **Firestore** | `users` (`presence`, `photoURL` already allowed by rules) |
| **Indexes** | — |
| **Rules** | Field allow-list landed Phase 2 |
| **Tests** | Upload size limits, sanitisation, presence churn |
| **Phase** | 4 (when chat features need presence) |

## 3. Chat list

| | |
|---|---|
| **Status** | ✅ Phase 4 landed: filters, unread, typing, FAB, NewChat. Swipe actions deferred. |
| **Existing** | `apps/mobile/src/screens/ChatsList.tsx` with real-time `subscribeConversations` (by `participantUids`), per-conversation `userState` + `typing` listeners, search + filters + FAB |
| **Missing** | Swipe gesture for pin/mute/archive, large-list virtualization tuning, presence dot |
| **Backend** | Counter increments + previews via `onMessageCreate` ✓; pin/mute/archive client writes ✓ (next: swipe UI) |
| **Firestore** | `conversations` (extended Phase 4), `userState/{uid}` ✓, `typing/{uid}` ✓ |
| **Indexes** | `(participantUids, updatedAt DESC)` (Phase 4 ✓); `(participantUids, status, updatedAt DESC)` (Phase 4 ✓) |
| **Rules** | userState owner-only + field allow-list (Phase 4 ✓); typing owner-write, participant-read (Phase 4 ✓) |
| **Phase** | 4 ✓ |

## 4. One-to-one chat

| | |
|---|---|
| **Status** | 🟡 Phase 4 landed text-only + read state + typing. Media + message actions deferred. |
| **Existing** | `apps/mobile/src/screens/Conversation.tsx` driving `sendTextMessage` / `markRead` / `setTyping` callables; `subscribeMessages`; peer profile via `users/{peerUid}` |
| **Missing** | Media (image/video/audio/file), reply, edit, delete, react, forward, copy, disappearing-messages enforcement, encrypted-banner accuracy |
| **Frontend** | Message bubble types, attachment composer, long-press action sheet |
| **Backend** | Phase 4 ships `sendTextMessage` / `markRead` / `setTyping` / `getOrCreateDirectConversation`. Phase 6 adds `editMessage` / `deleteMessage` / `reactToMessage` and media upload. |
| **Firestore** | `messages` extended (Phase 4: `senderUid`, `status`, `deletedForEveryone`, `editedAt`, `replyTo` placeholders) |
| **Indexes** | Existing `(conversationId, createdAt DESC)` collection-group index suffices |
| **Rules** | `senderUid == auth.uid` + type/length on create (Phase 4 ✓); edit/delete by sender or admin (Phase 4 ✓) |
| **Phase** | 4 ✓ (text), 6 (actions), 7 (receipts UI), 8 (media wave 1) |

## 5. Group chat

| | |
|---|---|
| **Status** | ✅ Phase 5 landed: create, member management, locks. Owner-transfer + mentions deferred. |
| **Existing** | `conversations.type='group'` + `name` + `ownerUid` + `memberCount` + `settings`; `members/{uid}` canonical Phase 5 schema; `NewGroup.tsx`, `GroupInfo.tsx`, `AddMembers.tsx`; six audited callables; group composer gates |
| **Missing** | Owner-transfer flow, mentions extraction, group description / about, avatar upload |
| **Frontend** | "Transfer ownership" UI, mentions composer |
| **Backend** | `transferOwnership` callable; `extractMentions` step in `onMessageCreate`; image-upload validation for `avatarUrl` |
| **Firestore** | `conversations`, `members` (Phase 5 ✓); future `messages.mentions: string[]` |
| **Indexes** | `(participantUids, type, updatedAt)` (Phase 5 ✓); future `(conversationId ASC, mentions ARRAY_CONTAINS)` |
| **Rules** | Owner/admin gates on members (Phase 5 ✓); member-count cap server-side (Phase 5 ✓) |
| **Phase** | 5 ✓ (with documented follow-ups) |

## 6. Communities

| | |
|---|---|
| **Status** | ❌ Missing |
| **Missing** | Data model, screens, admin UI |
| **Frontend** | `Communities.tsx`, `CommunityHome.tsx`, announcement channel |
| **Backend** | `createCommunity`, `joinCommunity` callables |
| **Firestore** | `communities/{id}`, `communities/{id}/groups/{convoId}` (or back-reference on conversations) |
| **Indexes** | `(communityId ASC, createdAt DESC)` |
| **Rules** | Community admin gating |
| **Tests** | Cross-group visibility, join/leave |
| **Phase** | 13 |

## 7. Status / Stories

| | |
|---|---|
| **Status** | 🟧 Backend hardened (Phase 3); no UI yet |
| **Existing** | `firestore.rules` server-side audience + expiry (Phase 3); `(authorId, createdAt)` index (Phase 3); `storage.rules` for `/statuses/{uid}/...` |
| **Missing** | Status composer, viewer, ring on chat list, audience picker, 24h expiry function, status views collection |
| **Frontend** | `StatusComposer.tsx`, `StatusViewer.tsx` |
| **Backend** | Scheduled `purgeExpiredStatuses` (Storage + Firestore); contacts-graph integration |
| **Firestore** | `statuses` (extended Phase 3: `audienceType`, `allowedViewerUids`, `excludedViewerUids`, `expiresAt`), `statusViews/{statusId}/{viewerId}` |
| **Indexes** | `(authorId ASC, createdAt DESC)` (Phase 3); single-field `expiresAt` auto |
| **Rules** | Audience + expiry enforced server-side (Phase 3 ✓) |
| **Tests** | Expiry, audience leakage, view tracking |
| **Phase** | 7 (UI), 13 (contacts-graph integration) |

## 8. Voice messages

| | |
|---|---|
| **Status** | ❌ Missing |
| **Frontend** | Recorder UI, waveform, play/pause, `playedAt` tracking |
| **Backend** | Storage upload + transcoding hook (optional) |
| **Firestore** | `messages.type='audio'` already in schema; `receipts.playedAt` already in schema |
| **Rules** | Reuse message rules; audio size limit via storage rules |
| **Phase** | 6 |

## 9. Voice calls / 10. Video calls

| | |
|---|---|
| **Status** | ❌ Missing |
| **Frontend** | Call UI, ring, in-call controls, history (`/admin/calls` UI placeholder) |
| **Backend** | WebRTC signalling (Functions + RTDB or third-party), `calls` collection |
| **Firestore** | `calls/{callId}` with participants, type, duration, status |
| **Indexes** | `(participantIds ARRAY, startedAt DESC)` |
| **Rules** | Participant-only reads; admin reads metadata only |
| **Phase** | Deferred — out of scope of phases 1–20 unless prioritised. Roadmap reserves headroom in Phase 13/18 for groundwork only. |

## 11. Message actions

| | |
|---|---|
| **Status** | ✅ Phase 6 landed: Copy, Reply, Forward, React, Star, Pin, Edit, Delete-for-me/everyone via long-press sheet on MessageBubble. |
| **Existing** | `apps/mobile/src/components/MessageBubble.tsx`; callables `editMessage`, `deleteMessage`, `reactToMessage`, `starMessage`, `pinMessage`, `forwardMessages`; reply preview + edit-mode composer; reactions chips + emoji picker; pinned-message banner |
| **Missing** | Multi-pin, richer action-sheet UI, native clipboard via `expo-clipboard`, mentions, polls, message templates |
| **Backend** | Phase 6 ✓ |
| **Firestore** | `messages.{editedAt, deletedForEveryone, replyTo, forwardedFrom, reactions, pinnedAt}`, `userState.{starredMessageIds, deletedForMeMessageIds}` (Phase 6 ✓) |
| **Phase** | 6 ✓ |

## 12. Message info

| | |
|---|---|
| **Status** | ✅ Phase 7 landed: aggregates grid + tabbed per-recipient list for senders; permission notice for non-senders. |
| **Existing** | `apps/mobile/src/screens/MessageInfo.tsx`; `getMessageInfo` callable extended with per-recipient + aggregates |
| **Missing** | Admin-side moderation view (Phase 14, redacted); analytics rollup (Phase 17) |
| **Backend** | Phase 7 ✓ |
| **Phase** | 7 ✓ |

## 13. Message views

| | |
|---|---|
| **Status** | ❌ Missing |
| **Frontend** | "Views" panel for media; integrated in MessageInfo |
| **Backend** | `views/{messageId}/{viewerId}` collection |
| **Phase** | 7 |

## 14. Delivery / read receipts

| | |
|---|---|
| **Status** | ✅ Phase 7 landed: server-monotonic markReceipt, aggregate counts, sender-only per-recipient view, group counts on bubble. |
| **Existing** | `markReceipt` callable + `onReceiptWrite` trigger; `messages.{deliveredCount, readCount, viewedCount, playedCount, failedCount, pendingCount}`; `MessageBubble` ReceiptIndicator (own messages only); rewritten `MessageInfo` with tabbed sender view |
| **Missing** | Group-admin aggregate visibility (no per-recipient detail); receipt reconciliation cron; tick rendering on incoming messages; played-status UI |
| **Backend** | All Phase 7 ✓; daily reconciliation queued for Phase 20 |
| **Firestore** | `receipts.{deliveredAt, readAt, viewedAt, playedAt, failedAt, failureReason}` (Phase 7 ✓) |
| **Rules** | Receipt reads: owner/sender/admin (tightened Phase 7) ✓; status enum (Phase 3 ✓) |
| **Phase** | 7 ✓ |

## 15. Bulk SMS escalation (OfflineSMS only)

| | |
|---|---|
| **Status** | ✅ Phase 8 landed: hardened backend + multi-step mobile flow + entry points + audit. |
| **Existing** | `functions/src/sms/{escalate,previewEscalation,retryFailed,onSmsBatchAccepted,gateway,recipients}.ts`; `apps/mobile/src/lib/sms.ts`; `apps/mobile/src/screens/SmsEscalation.tsx`; `MessageInfo` + `MessageBubble` entry points |
| **Missing** | Real provider integration (currently mock gateway); `smsOptOut` settings UI; cross-batch dedupe for `already-sent-for-message`; `phoneVerified` strict mode |
| **Backend** | Phase 8 ✓ |
| **Firestore** | `smsBatches`, `smsBatches/{b}/recipients`, `smsQuotaUsage/{uid}/days/{yyyymmdd}` (writer wired Phase 8) |
| **Rules** | Server-only writes (Phase 0 + Phase 3) ✓ |
| **Phase** | 8 ✓; provider integration is deployment-time; opt-out settings UI Phase 19 |

## 16. OfflineSMS Points Wallet

| | |
|---|---|
| **Status** | ✅ Phase 9 landed: balance + reserved + available, filter chips, transaction history, transaction detail, SMS-batch deep-link, settings toggle for SMS opt-out. |
| **Existing** | `apps/mobile/src/screens/{Points,TransactionDetail,Settings}.tsx`; `apps/mobile/src/lib/{points,user}.ts`; canonical transaction-type mapping |
| **Missing** | Pagination beyond 25, dedicated `BatchReport` screen, server-side `in` queries for multi-value canonical filters |
| **Backend** | Phase 0 writers unchanged; Phase 10 will switch to canonical type strings + emit dedicated `reservation` / `reservation_release` rows |
| **Indexes** | `(userId, createdAt DESC)` (Phase 0) + `(userId, type, createdAt DESC)` (Phase 9 ✓) |
| **Rules** | Owner-read wallets / transactions, server-only writes (Phase 0 + Phase 3) ✓; `smsOptOut` allowed in `users.update` (Phase 9 ✓) |
| **Phase** | 9 ✓ |

## 17. Buy points

| | |
|---|---|
| **Status** | ✅ Phase 10 landed: webhook-driven purchase, idempotent credits, emulator-only mock confirmation. |
| **Existing** | `functions/src/points/{createPurchase,confirmPayment,confirmPaymentMock}.ts`, `apps/mobile/src/screens/BuyPoints.tsx`, `pointsPackages/{id}` collection |
| **Missing** | Real provider integration (deployment-time concern), `pointsPackages` seed data, in-app receipt screen |
| **Backend** | `createPurchase` creates pending payment; `confirmPayment` is shared-secret-gated and idempotent; `confirmPaymentMock` refuses outside `FUNCTIONS_EMULATOR` |
| **Firestore** | `pointsPackages` (Phase 10 ✓), `payments` (Phase 3 + Phase 10 ✓) |
| **Rules** | Packages: signed-in read, admin write (Phase 10 ✓); Payments: server-only write (Phase 3 ✓) |
| **Phase** | 10 ✓ |

## 18. Transfer points

| | |
|---|---|
| **Status** | ✅ Phase 10 landed: hardened transfer with caps, frozen-wallet guard, canonical transactions, fraud-flag emission. |
| **Existing** | `functions/src/points/transferPoints.ts`, `apps/mobile/src/screens/TransferPoints.tsx`, `pointsTransfers/{id}`, `transferQuotaUsage/{uid}/days/{yyyymmdd}` |
| **Missing** | Rate-window fraud detection (Phase 18), admin freeze callable (Phase 15) |
| **Backend** | Daily caps (20 transfers / 5000 pts), fraud flag at ≥ 2000 pts, canonical `transfer_in`/`transfer_out` rows, `transferQuotaUsage` increment, audit lineage |
| **Firestore** | `pointsTransfers`, `transferQuotaUsage` (Phase 10 ✓) |
| **Rules** | Transfers: sender+recipient+admin read, server-only write; quota: owner read, server-only write (Phase 10 ✓) |
| **Phase** | 10 ✓ |

## 19. SMS delivery reports

| | |
|---|---|
| **Status** | ✅ Phase 11 landed: dedicated mobile report, retry-failed callable hardened, HMAC-verified delivery webhook, cross-batch dedupe, opt-in stuck-batch reaper. |
| **Existing** | `apps/mobile/src/screens/SmsBatchReport.tsx`, `functions/src/sms/{gatewayWebhook,retryFailed,recipients,reapStuckBatches}.ts`, `smsDeliveryEvents/{id}`, canonical Phase 9 lifecycle |
| **Missing** | Dashboard `/admin/sms/[batchId]` (Phase 15), production provider wiring (deployment-time), reaper schedule activation (operator opt-in) |
| **Frontend** | Mobile report + retry + deep-links from TransactionDetail / SmsEscalation / MessageInfo |
| **Backend** | webhook + retry + reaper + cross-batch dedupe (Phase 11 ✓) |
| **Indexes** | `smsBatches(senderId, messageId, createdAt DESC)` (Phase 11 ✓) |
| **Phase** | 11 ✓ |

## 20. Admin dashboard (shell)

| | |
|---|---|
| **Status** | 🟡 Phase 12 + Phase 17 partial |
| **Existing** | `Sidebar.tsx`, `Topbar.tsx`, `/admin`; `AdminGlobalSearchShell.tsx` with debounced fetch, grouped results, keyboard navigation (↑ ↓ ↵ Esc), `search:global` capability gate. `/admin/search/route.ts` Firestore prefix + exact-ID search across 8 entity types, max 5 per group / 50 total. |
| **Missing** | RBAC-aware sidebar menu, breadcrumb, notifications, user menu |
| **Frontend** | `app/admin/layout.tsx` enforcing claim; `AdminGlobalSearchShell.tsx` (Phase 17 ✓) |
| **Backend** | `app/admin/search/route.ts` (Phase 17 ✓); session cookie verification via `firebase-admin` |
| **Phase** | 12 (guard), 17 ✓ (global search) |

## 21. Users management

| | |
|---|---|
| **Status** | ✅ Read (list) — Partial overall |
| **Missing** | Detail view, suspend/unblock, role change, message-history view (redacted), audit trail of admin actions |
| **Phase** | 13 |

## 22. Organizations management

| | |
|---|---|
| **Status** | ❌ Missing |
| **Missing** | Org model, members, billing, owner |
| **Firestore** | `organizations/{orgId}`, `organizations/{orgId}/members/{uid}` |
| **Phase** | 13 |

## 23. Groups management

| | |
|---|---|
| **Status** | ❌ Missing (dashboard placeholder) |
| **Frontend** | Group list (`conversations.type IN ['group','channel']`), member counts, last activity, lock/unlock |
| **Phase** | 13 |

## 24. Communities management

| | |
|---|---|
| **Status** | ❌ Missing (no model yet) |
| **Phase** | 13 |

## 25. Conversations management

| | |
|---|---|
| **Status** | ❌ Missing (dashboard placeholder `/admin/chats`) |
| **Frontend** | Conversation list, filter by type/status, member sample, last activity |
| **Backend** | Server-side query with admin SDK |
| **Phase** | 14 |

## 26. Messages management

| | |
|---|---|
| **Status** | ❌ Missing |
| **Frontend** | Message viewer with **content redacted by default** (metadata only); reveal requires elevated permission + audit entry |
| **Backend** | Callable `viewMessageContent` (audit-logged, permission-checked) |
| **Phase** | 14 |

## 27. OfflineSMS Gateway

| | |
|---|---|
| **Status** | 🟡 Partial (static config UI) |
| **Existing** | `/admin/sms`, `functions/src/sms/gateway.ts` |
| **Missing** | Live health metrics, batch list, batch detail, recipient drill-down, retry from dashboard, settings persistence |
| **Firestore** | `settings/sms-gateway` (existing in data model), `gatewayHealth/{yyyymmdd}` |
| **Phase** | 15–16 |

## 28. Reports & analytics

| | |
|---|---|
| **Status** | ✅ Phase 17 landed: 8 overview count cards, 7-day trend tables (SMS batches + new users with bar visualization), support tickets by status breakdown. |
| **Existing** | `app/admin/reports/page.tsx` (server component); parallel `getCountFromServer()` aggregation; 14-query 7-day trend (soft-fail per day); status breakdown table. Gated by `view:reports` capability. |
| **Missing** | Pre-aggregated rollup (currently all live queries); date-range picker; per-organization breakdowns; downloadable report PDF |
| **Backend** | All queries run server-side via `firebase-admin`. Scheduled rollup to `reports/{id}` deferred — current volume acceptable with live queries. |
| **Phase** | 17 ✓ (live queries); 20 (pre-aggregation rollups if latency degrades) |

## 29. Support tickets

| | |
|---|---|
| **Status** | ❌ Missing |
| **Firestore** | `tickets/{id}`, `tickets/{id}/messages/{n}` |
| **Phase** | 18 |

## 30. Moderation

| | |
|---|---|
| **Status** | ❌ Missing |
| **Frontend** | Moderation queue, action sheet |
| **Backend** | `flags/{id}` collection; `moderate` callable; audit hook |
| **Phase** | 18 |

## 31. Roles & permissions

| | |
|---|---|
| **Status** | ❌ Missing (only `admin: true` claim) |
| **Frontend** | `/admin/roles` builder |
| **Backend** | `setRole`, `setPermissions` callables; custom-claims model beyond boolean |
| **Firestore** | `roles/{roleId}`, `users.roleIds[]` |
| **Phase** | 18 |

## 32. Audit logs

| | |
|---|---|
| **Status** | 🟡 Phase 3 landed: collection + rules + helper + first two consumers. UI deferred. |
| **Backend** | `functions/src/lib/auditLog.ts` exports `writeAuditLog` + `redactPhone`/`redactEmail`/`sanitiseMetadata`. Soft-failing — never rolls back the primary action. Used by `claimUsername` and `setAdminClaim`. |
| **Firestore** | `auditLogs/{id}` (schema in `docs/OFFLINESMS_DATA_MODEL.md`) |
| **Indexes** | `(actorUid ASC, createdAt DESC)`, `(targetType ASC, targetId ASC, createdAt DESC)` (Phase 3 ✓) |
| **Rules** | Admin-read; `allow write: if false` for clients (Phase 3 ✓) |
| **Phase** | 3 (groundwork ✓); 18 (UI explorer) |

## 33. Settings

| | |
|---|---|
| **Status** | 🟧 Scaffold (`settings` collection schema; no UI) |
| **Frontend** | `/admin/settings` panels (gateway, points rules, packages, feature flags, branding) |
| **Backend** | `settings/*` reads/writes via callable to centralise validation + audit |
| **Phase** | 16 (gateway), 18 (rest) |

## 34. RTL

| | |
|---|---|
| **Status** | 🟡 Mobile substantially complete, dashboard LTR-only |
| **Existing** | `I18nManager.forceRTL` in `changeLanguage()`; `isRTL` module-level export; `buildStyles(colors, rtl)` pattern on all updated screens (ChatsList, Conversation, Points, SupportTicket, Settings) |
| **Missing** | Dashboard `dir` RTL support; layout regression suite for RTL screens |
| **Phase** | 19 ✓ (mobile); 20 (dashboard RTL + regression) |

## 35. Dark mode

| | |
|---|---|
| **Status** | 🟡 Mobile substantially complete, dashboard scaffold only |
| **Existing** | `ThemeContext` wired with `lightSemantic`/`darkSemantic`; all updated screens use `useTheme()`; user preference persisted to Firestore + AsyncStorage; Settings chip selector; dashboard `darkMode: 'class'` scaffold |
| **Missing** | Dashboard dark palette wiring; dark-mode regression tests |
| **Phase** | 19 ✓ (mobile); 20 (dashboard dark wiring) |

## 36. Edge states

| | |
|---|---|
| **Status** | ❌ Inconsistent |
| **Missing** | Shared `Loading`, `Empty`, `Error`, `Permission`, `Success` primitives (mobile + dashboard) |
| **Phase** | 1 |

---

## Phase 17 additions

### 37. Admin global search

| | |
|---|---|
| **Status** | ✅ Phase 17 landed |
| **Existing** | `app/admin/search/route.ts` — Firestore prefix search on `usernameLower` (users), `slug` (orgs), `name` (groups); exact-ID lookup for smsBatches, wallets, payments, tickets, auditLogs. Max 5 per group, 50 total, all queries parallel. `AdminGlobalSearchShell.tsx` — debounced (300 ms) fetch, grouped results UI, keyboard navigation (↑ ↓ ↵ Esc). |
| **Capability** | `search:global` |
| **Limitation** | Group name search is case-sensitive (prefix on stored `name`). Users must type lowercase to match mixed-case group names. A `nameLower` field is the planned fix (future phase). |
| **Phase** | 17 ✓ |

### 38. Admin CSV exports

| | |
|---|---|
| **Status** | ✅ Phase 17 landed |
| **Existing** | Export routes: `/admin/users/export`, `/admin/groups/export`, `/admin/sms/export`, `/admin/points/transactions/export`, `/admin/points/payments/export`, `/admin/support/export`. Shared `apps/dashboard/lib/exportHelper.ts` (`csvCell`, `csvRow`, `buildCsvResponse`, `writeExportAudit`, `EXPORT_LIMIT = 1000`). Export buttons on all six pages. |
| **Capabilities** | `export:users`, `export:groups`, `export:sms`, `export:points`, `export:support` |
| **Redaction** | Phones masked via `redactPhone()`. No message content in exports. |
| **Audit** | Every export writes an `auditLogs` entry with actor, entity, row count, and applied filters. |
| **Phase** | 17 ✓ |

### 39. Admin FilterBar (URL-param driven)

| | |
|---|---|
| **Status** | ✅ Phase 17 landed |
| **Existing** | `FilterBar` component added to: users (status filter), groups (status filter), transactions (type filter), payments (status filter) pages. All filter state is URL-param driven — shareable links, browser back/forward compatible. `listUsers`, `listGroups`, `listTransactions`, `listPayments` in `adminData.ts` updated to accept and forward filter params. |
| **Missing** | Date-range filter, free-text filter on list pages |
| **Phase** | 17 ✓ |

### 40. Testing infrastructure

| | |
|---|---|
| **Status** | ✅ Phase 20 landed |
| **Existing** | `vitest` at root with `vitest.config.ts` (unit) and `vitest.rules.config.ts` (rules). 104 unit tests passing across dashboard (redaction, permissions, scope, rateLimit, exportHelper), mobile (username, points helpers, sms helpers), and functions (auditLog redaction, SMS recipient filtering). 60 rules tests in `tests/rules/` (users, conversations, sms, wallet, support, system collections) covering deny paths. Pure mobile helpers extracted into `.helpers.ts` siblings so vitest can import without firebase. CI runs typecheck + lint + i18n:check + test + build. `npm run validate` is the single-command pre-merge gate. |
| **Missing** | Rules tests in CI (Java/emulator requirement; Phase 21), Functions emulator integration tests, mobile/dashboard component tests, E2E tests, load tests |
| **Phase** | 20 ✓ |

### 41. Security & performance review

| | |
|---|---|
| **Status** | ✅ Phase 20 landed |
| **Existing** | `docs/OFFLINESMS_SECURITY_REVIEW.md` — admin guard, RBAC, org scoping, rules per-collection table, Admin SDK bypass mitigations, webhook security, payment idempotency, wallet double-spend prevention, SMS abuse controls, rate limiting, redaction, audit logging, 7-row residual risk register, 12-point production gate. `docs/OFFLINESMS_PERFORMANCE_REVIEW.md` — Firestore query audit, composite index coverage, dashboard count strategy, export memory cap, global search limits, large-group aggregation hotspot, scheduled-function cost, rate-limit limitations, Phase 21+ optimization roadmap. |
| **Phase** | 20 ✓ |

### 42. Release readiness

| | |
|---|---|
| **Status** | ✅ Phase 20 landed |
| **Existing** | `docs/OFFLINESMS_RELEASE_CHECKLIST.md` — env vars, deployment order (rules → indexes → storage → functions → hosting), admin bootstrap, data setup, 14-point smoke test, rollback plan, post-deploy monitoring. `docs/OFFLINESMS_QA_CHECKLIST.md` — 16-section manual test matrix covering mobile (A-I), dashboard (J-M), security negatives (N), performance spot checks (O), regression scope (P). |
| **Phase** | 20 ✓ |
