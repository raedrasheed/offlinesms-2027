# OfflineSMS Design → Implementation Map

Maps every product design module to the current technical implementation. **Status** uses: ✅ Complete · 🟡 Partial · 🟧 Scaffold only · ❌ Missing.

Legend for "Recommended phase" matches `OFFLINESMS_IMPLEMENTATION_ROADMAP.md`.

---

## 1. Onboarding & authentication

| | |
|---|---|
| **Status** | 🟡 Partial (web phone OTP works; native unimplemented; profile completion missing) |
| **Existing** | `apps/mobile/src/screens/Welcome.tsx`, `PhoneEntry.tsx`, `Otp.tsx`; `apps/mobile/src/lib/auth.ts`; `functions/src/auth/onUserCreate.ts`; `apps/dashboard/app/login/page.tsx` |
| **Missing** | Native OTP, email-link path, password-less retry, profile-completion screen, terms acceptance, restore session UX, multi-device handoff |
| **Frontend** | `ProfileCompletion.tsx`, `EmailLink.tsx`, native-OTP integration (`@react-native-firebase/auth`), terms checkbox |
| **Backend** | Extend `onUserCreate` to seed `username`, `about`; callable `claimUsername` with uniqueness check |
| **Firestore** | `users` (existing), new `usernames/{username}` lookup collection |
| **Indexes** | `users.username ASC` |
| **Rules** | `usernames` — create by self when free; immutable thereafter |
| **Tests** | OTP success/fail, profile claim collision, dup-username, RTL screens |
| **Phase** | 2 |

## 2. User profile

| | |
|---|---|
| **Status** | 🟧 Scaffold (no UI; doc seeded by trigger) |
| **Existing** | `users/{uid}` doc shape, avatar storage path |
| **Missing** | View/edit profile screen, avatar upload, about, status text, presence |
| **Frontend** | `Profile.tsx` (view), `ProfileEdit.tsx`, avatar picker |
| **Backend** | Callable `updateProfile` (validates length, sanitises), `setPresence` (heartbeat or RTDB) |
| **Firestore** | `users` (`displayName`, `username`, `about`, `avatarUrl`, `lastSeen`, `presence`) |
| **Indexes** | — |
| **Rules** | Tighten `users.update` to a field-allow-list |
| **Tests** | Upload size limits, sanitisation, presence churn |
| **Phase** | 2 |

## 3. Chat list

| | |
|---|---|
| **Status** | ✅ Complete (basic) |
| **Existing** | `apps/mobile/src/screens/ChatsList.tsx`, `subscribeConversations` |
| **Missing** | Search, filters (All/Unread/Favorites/Groups), swipe actions (mute/pin/archive), unread badge accuracy, typing indicators |
| **Frontend** | Filter chips, swipe gesture, archive screen |
| **Backend** | Counter increments (unread) via trigger, mute/pin field updates |
| **Firestore** | `conversations` (`pinned`, `muted`, `archived`, `unreadByUser`) |
| **Indexes** | `(archived ASC, lastMessageAt DESC)` per user |
| **Rules** | Member-only writes to `pinned/muted/archived` (per-user sub-doc) |
| **Tests** | Filter combinations, swipe actions, large list virtualization |
| **Phase** | 4 |

## 4. One-to-one chat

| | |
|---|---|
| **Status** | 🟡 Partial (text only) |
| **Existing** | `apps/mobile/src/screens/Conversation.tsx`, `sendText`, `onMessageCreate` |
| **Missing** | Media (image/video/audio/file), reply, edit, delete, react, forward, copy, disappearing-messages enforcement, encrypted-banner accuracy |
| **Frontend** | Message bubble types, attachment composer, long-press action sheet |
| **Backend** | Callable `editMessage`, `deleteMessage`; media-upload validation; disappearing-message TTL sweeper (scheduled) |
| **Firestore** | `messages` (`mediaUrl`, `metadata`, `replyTo`, `editedAt`, `disappearAt`) |
| **Indexes** | Existing message index suffices |
| **Rules** | Validate `senderId == auth.uid` on edit/delete; size/type constraints |
| **Tests** | Send-receive race, edit/delete by non-sender denied, attachment limits |
| **Phase** | 4–6 |

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
| **Status** | 🟧 Scaffold (`statuses` collection + storage path; no UI) |
| **Existing** | `firestore.rules` for `statuses`, `storage.rules` for `/statuses/{uid}/...` |
| **Missing** | Status composer, viewer, ring on chat list, audience picker, 24h expiry function |
| **Frontend** | `StatusComposer.tsx`, `StatusViewer.tsx` |
| **Backend** | Scheduled `purgeExpiredStatuses` (Storage + Firestore); audience-enforcement read mediator |
| **Firestore** | `statuses` (existing), `statusViews/{statusId}/{viewerId}` |
| **Indexes** | `(authorId ASC, createdAt DESC)`, `(audience IN, expiresAt ASC)` |
| **Rules** | Audience-aware read gating (move from client-side filter) |
| **Tests** | Expiry, audience leakage, view tracking |
| **Phase** | 7 (after receipts), with content in 13 |

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
| **Status** | 🟡 Partial (placeholders fanned out; client never marks delivered/read) |
| **Existing** | `onMessageCreate` writes `receipts/{uid}` with `status: 'pending'` |
| **Missing** | Client write of `delivered/read/played`; UI ticks; aggregated counters |
| **Frontend** | Mark-on-view, tick rendering |
| **Backend** | Callable `markReceipt` (rate-limited); aggregation trigger |
| **Firestore** | `receipts` (existing); `messages.deliveredCount`, `readCount` denorm fields |
| **Rules** | Receipt write by self only; status enum validation |
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
| **Status** | ❌ Missing |
| **Backend** | Wrapper helper `writeAudit({actorId, action, target, redactionLevel, before, after})` invoked from every privileged callable |
| **Firestore** | `auditLogs/{id}` |
| **Indexes** | `(actorId ASC, createdAt DESC)`, `(targetType ASC, targetId ASC, createdAt DESC)` |
| **Rules** | Admin-read; server-only writes |
| **Phase** | 18 (must land before content reveal in Phase 14 — partial groundwork earlier) |

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
