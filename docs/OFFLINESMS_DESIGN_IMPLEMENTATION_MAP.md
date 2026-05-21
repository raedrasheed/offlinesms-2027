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
| **Status** | 🟧 Scaffold (data model exists; no UI) |
| **Existing** | `conversations.type='group'`, `members/{uid}` sub-collection |
| **Missing** | Create-group flow, member picker, group info screen, add/remove members, role mgmt, leave group, mentions |
| **Frontend** | `NewGroup.tsx`, `GroupInfo.tsx`, member list, role pickers |
| **Backend** | Callables `createGroup`, `addMembers`, `removeMember`, `changeRole`; mentions extraction in `onMessageCreate` |
| **Firestore** | `conversations`, `members`, plus `mentions` index on messages |
| **Indexes** | `(conversationId ASC, mentions ARRAY_CONTAINS)` |
| **Rules** | Only `owner/admin` can mutate members; member counts capped server-side |
| **Tests** | Permission boundaries, large group performance, role transitions |
| **Phase** | 5 |

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
| **Status** | ❌ Missing |
| **Frontend** | Long-press sheet (Reply, Edit, Delete, Copy, Forward, React, Star, Pin) |
| **Backend** | Callables for `edit`, `delete`, `pin`, `react`, `forward` |
| **Firestore** | `messages.reactions/{uid}`, `messages.pinnedAt`, `messages.starredBy` |
| **Phase** | 6 |

## 12. Message info

| | |
|---|---|
| **Status** | ❌ Missing |
| **Frontend** | `MessageInfo.tsx` aggregating receipts (delivered to N, read by M) |
| **Backend** | Receipt summariser (denormalised counters on message doc) |
| **Phase** | 7 |

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
| **Status** | 🟡 Backend partially hardened (Phase 3 enum); client never marks delivered/read |
| **Existing** | `onMessageCreate` writes `receipts/{uid}` with `status: 'pending'`; status enum enforced in rules (Phase 3) |
| **Missing** | Client write of `delivered/read/played`; UI ticks; aggregated counters |
| **Frontend** | Mark-on-view, tick rendering |
| **Backend** | Callable `markReceipt` (rate-limited); aggregation trigger |
| **Firestore** | `receipts` (existing); `messages.deliveredCount`, `readCount` denorm fields |
| **Rules** | Receipt write by self only; status enum validation (Phase 3 ✓) |
| **Phase** | 7 |

## 15. Bulk SMS escalation (OfflineSMS only)

| | |
|---|---|
| **Status** | 🟡 Backend exists, no UI |
| **Existing** | `functions/src/sms/escalate.ts`, `gateway.ts`, `onSmsBatchAccepted.ts`; `smsBatches` rules + index |
| **Missing** | Mobile UI (`SmsEscalation.tsx` is empty), audience preview, cost preview, confirmation, receipt screen |
| **Frontend** | `SmsEscalation.tsx` full flow, audience picker, cost line item |
| **Backend** | Add per-user/day quota, audience-size cap, retry-failed callable |
| **Firestore** | `smsBatches` (existing); add `smsQuotaUsage/{uid}/{yyyymmdd}` |
| **Rules** | Quota docs admin-only writes |
| **Tests** | Insufficient points, partial fail refund, quota |
| **Phase** | 8, retries in 11 |

## 16. OfflineSMS Points Wallet

| | |
|---|---|
| **Status** | 🟡 Read-only screen exists |
| **Existing** | `apps/mobile/src/screens/Points.tsx` live `wallets/{uid}` |
| **Missing** | History list, reservation badge, transaction details |
| **Frontend** | `PointsHistory.tsx`, transaction row, filter |
| **Backend** | Existing `transactions` powers history |
| **Indexes** | `(userId ASC, createdAt DESC)` (already defined) |
| **Phase** | 9 |

## 17. Buy points

| | |
|---|---|
| **Status** | 🟡 Callable exists but trusts client; no payment |
| **Existing** | `functions/src/points/buy.ts`, `/admin/points` packages UI |
| **Missing** | Mobile purchase flow, payment provider integration (webhook-driven), receipts |
| **Frontend** | `BuyPoints.tsx`, package picker |
| **Backend** | Webhook endpoint, idempotent crediting, refund flow |
| **Firestore** | `payments/{paymentId}` |
| **Rules** | Server-only writes |
| **Phase** | 10 |

## 18. Transfer points

| | |
|---|---|
| **Status** | 🟡 Callable exists, no UI |
| **Existing** | `functions/src/points/transfer.ts` |
| **Missing** | `TransferPoints.tsx`, recipient picker, amount + note, confirmation |
| **Frontend** | Form, contact search |
| **Backend** | Add daily transfer cap, fraud-flag emitter |
| **Phase** | 10 |

## 19. SMS delivery reports

| | |
|---|---|
| **Status** | 🟧 Backend captures status; no UI |
| **Existing** | `smsBatches/{b}/recipients/{uid}.smsStatus` |
| **Missing** | Mobile batch report, retry failed action, dashboard analytics |
| **Frontend** | `SmsBatchReport.tsx` (mobile), `/admin/sms/[batchId]` (dashboard) |
| **Backend** | Callable `retryFailedRecipients`; webhook ingestion of provider statuses |
| **Phase** | 11 |

## 20. Admin dashboard (shell)

| | |
|---|---|
| **Status** | 🟡 Shell present, no role gating |
| **Existing** | `Sidebar.tsx`, `Topbar.tsx`, `/admin` |
| **Missing** | Auth+admin guard, RBAC-aware menu, user menu, search, breadcrumb, notifications |
| **Frontend** | `app/admin/layout.tsx` enforcing claim; user menu component |
| **Backend** | Verify session cookie via `firebase-admin` in server component |
| **Phase** | 12 |

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
| **Status** | ❌ Missing |
| **Frontend** | Report builder, exports (CSV) with phone masking |
| **Backend** | Scheduled rollup function → `reports/{id}` |
| **Phase** | 17 |

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
| **Status** | 🟡 Mobile yes, dashboard no |
| **Existing** | `I18nManager.forceRTL` in mobile i18n |
| **Missing** | Dashboard direction prop, RTL-aware spacing utilities, mirrored icons, layout regression suite |
| **Phase** | 19 |

## 35. Dark mode

| | |
|---|---|
| **Status** | ❌ Missing (placeholder tokens only) |
| **Existing** | `colors.darkBg/darkSurface/darkInk` |
| **Missing** | Theme provider, system-preference detection, manual toggle, semantic role tokens |
| **Phase** | 1 (token layer) + 19 (full theming pass) |

## 36. Edge states

| | |
|---|---|
| **Status** | ❌ Inconsistent |
| **Missing** | Shared `Loading`, `Empty`, `Error`, `Permission`, `Success` primitives (mobile + dashboard) |
| **Phase** | 1 |
