# OfflineSMS Phase Log

Running log of phased work. Newest first.

---

## Phase 7 — Delivery receipts, read receipts, message views

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Receipt schema fully populated.** `conversations/{c}/messages/{m}/receipts/{uid}` now carries `status` + `deliveredAt`/`readAt`/`viewedAt`/`playedAt`/`failedAt`/`failureReason`/`createdAt`/`updatedAt`. Doc id is always the recipient uid, pinned at the rules layer.
- **Aggregate counts denormalised onto messages.** `messages` gains `deliveredCount`, `readCount`, `viewedCount`, `playedCount`, `failedCount`, `pendingCount`, `receiptUpdatedAt` — all server-owned (Phase 6 already locked `messages.update` to admin-only at the rules layer).
- **Three new functions:**
  - `markReceipt` callable — monotonic-or-failed transition guard (`pending → delivered → read/viewed/played`, `* → failed`), server-side, with self-receipts silently no-op'd. Backfills `deliveredAt` when a fresh `read` arrives without prior delivery. Wrapped in a Firestore transaction so concurrent clients can't race past the guard. Not audited (too noisy).
  - `onReceiptWrite` trigger — recomputes the message-level aggregate counts on every receipt change by scanning the receipts sub-collection. Correct, simple, fine at the Phase 5 group cap of 256.
  - `markStatusViewed` callable — records `statuses/{statusId}/views/{viewerUid}` after re-running Phase 3's audience + expiry rules server-side. Doc id = viewer uid → duplicates are impossible by construction. Self-views silently no-op.
- **`getMessageInfo` extended.** When the caller is the message sender (or an admin), the response now includes a per-recipient receipt list (uid, displayName snapshot, role, status, per-status timestamps, failureReason). Non-senders still see the aggregates and the client surfaces a `PermissionState`.
- **Receipt rules tightened (Phase 7).** Receipt reads narrowed to **the receipt owner, the message sender, or an admin** — the Phase 4 "any participant" read is closed, so group members can no longer enumerate each other's read status. Writes keep the Phase 3 owner-allowed path with the enum guard; canonical writes still flow through `markReceipt`.
- **Status-view rules.** New sub-collection `statuses/{statusId}/views/{viewerUid}`: read by owner / viewer / admin; writes server-only.
- **Mobile UI.**
  - `MessageBubble` gains a `ReceiptIndicator` for the caller's own messages: `✓ / ✓✓ / ✓✓` (blue) for sent/delivered/read in direct chats; compact `✓ N · 👁 M` counts in groups.
  - `Conversation` calls `markReceipt(messageId, 'delivered')` and `'read'` for every visible non-self message on each `subscribeMessages` batch. The lib dedupes `(messageId, status)` pairs in-memory and debounces by 300 ms so a fast scroll doesn't blast the callable.
  - `MessageInfo` rewrites the layout: stats grid (Delivered / Read / Pending / Failed) + a tabbed per-recipient list for senders; for non-senders the same grid + a `PermissionState` explaining why detail is hidden.
- **Design choice — "viewed" folded into receipts.** Phase 7 deliberately reuses the receipts enum's `viewed` for text messages rather than introducing a parallel `messages/{m}/views/{uid}` sub-collection. The aggregation trigger stays uniform; the dedicated view collection is reserved for media-specific events when media support lands.
- **i18n.** New `receipts.*` namespace in `en.json` + `ar.json`.

### Files created

- `docs/OFFLINESMS_PHASE_7_PLAN.md`
- `functions/src/chats/markReceipt.ts`
- `functions/src/chats/onReceiptWrite.ts`
- `functions/src/statuses/markStatusViewed.ts`

### Files edited

- `firestore.rules`
- `functions/src/index.ts`
- `functions/src/chats/getMessageInfo.ts`
- `apps/mobile/src/lib/conversations.ts`
- `apps/mobile/src/components/MessageBubble.tsx`
- `apps/mobile/src/screens/Conversation.tsx`
- `apps/mobile/src/screens/MessageInfo.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_DATA_MODEL.md` and all phase-tracking docs

### Commits

| Hash | Message |
|---|---|
| `fcc667b` | docs: add OfflineSMS phase 7 implementation plan |
| `47c00b5` | feat(data): add receipt and status-view contracts |
| `69ab317` | security: add receipt and status-view rules |
| `9855261` | feat(functions): add markReceipt and receipt aggregation |
| `a8633ce` | feat(functions): extend message info with receipt details |
| `9eb8c31` | feat(functions): add status view tracking foundation |
| `930aa58` | feat(mobile): render receipt indicators and mark read/delivered |
| `61e231c` | feat(mobile): add full receipt details to message info |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests** yet. Manual emulator checklist in the Phase 7 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **`onReceiptWrite` recomputes by full scan.** Fine at the Phase 5 group cap of 256, but a Phase 20 perf pass may switch to `FieldValue.increment`-based counters with a daily reconciliation function (`reconcileReceiptCounts`) — code-only follow-up, no scheduling now.
- **Group-admin aggregate visibility is not implemented.** The Phase 7 rules only let the sender (or an admin) see per-recipient detail. Admins seeing read-rate-only without per-recipient timestamps is a clean Phase 18 feature.
- **No "Played" UI surface.** `playedCount` is wired through the trigger and aggregates but no client UI emits or renders it — voice messages land in a later phase.
- **No daily receipt reconciliation function.** Scheduling that safely needs emulator-tests first; queued for Phase 20.
- **No tick rendering on incoming messages.** Receipt indicators only show on the caller's own bubbles, by design.
- **Phase 4 receipt-read rule change is a real tightening.** Previously any participant could read receipts; now only owner/sender/admin can. Any future code path that reads receipts directly from a client other than the sender would have to be promoted to a callable. Today, no such path exists outside `getMessageInfo` (Admin SDK).

### Recommended Phase 8 scope

Phase 8 = **OfflineSMS SMS escalation (UI)** (per the roadmap):

1. Build `SmsEscalation.tsx` on top of the existing `escalateSms` callable. Audience picker (unread / undelivered / everyone — fed by Phase 7's receipt aggregates and per-recipient receipt list), masked-phone preview, cost preview against the wallet, confirmation, and a result screen with retry surface.
2. Add abuse controls to `escalateSms`: per-user-per-day batch cap, audience size cap, conversation cool-down. Persist to `smsQuotaUsage/{uid}/{yyyymmdd}` (Phase 3 collection already locked server-only).
3. Wire the existing `lib/sms.ts` placeholder on mobile so the conversation screen exposes an "Escalate to SMS" entry point gated by the receipt counts (only offered when there are unread/undelivered recipients).
4. Manual emulator pass: confirm points reservation → settle/refund flow lands the right `transactions` records (Phase 0 already wired the `onSmsBatchAccepted` trigger).
5. Audit every escalation. Brand all dispatch as OfflineSMS — no third-party provider names anywhere in copy / logs / telemetry.

Defer: media messages, communities, calls, dashboard moderation, payments. Points purchase + transfer come in Phase 10.

---

## Phase 6 — Message actions and message info

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Schema fills the Phase 4/5 placeholders + adds reactions, pinning, TTL.** `messages` now carries `editedAt`, `deletedForEveryone`/`deletedAt`/`deletedBy`/`deleteReason`, `replyTo`, `forwarded` + `forwardedFrom`, `reactions: { [emoji]: uid[] }`, `pinnedAt`/`pinnedBy`, and `expiresAt`. `sendTextMessage` now initialises every Phase 6 field explicitly so docs are uniform from creation.
- **Per-user message state** rides on the existing `conversations/{c}/userState/{uid}` doc — adds bounded `starredMessageIds[]` and `deletedForMeMessageIds[]` arrays (FIFO-capped at 500) — instead of a new collection, keeping listener cost flat.
- **Conversation-level pin** lives on `conversations/{c}.pinnedMessage` (single pinned message in Phase 6).
- **Seven new audited callables** (`functions/src/chats/`):
  - `editMessage` — sender-only, 15-minute edit window, refreshes `lastMessage` if applicable.
  - `deleteMessage` — `for_me` writes to the caller's userState array; `for_everyone` clears text + flips `deletedForEveryone` (sender always; group owner/admin may delete other members' messages, recorded as `byRole`).
  - `reactToMessage` — emoji allow-list, one emoji per user per message, **not** audited.
  - `starMessage` — owner-scoped, not audited.
  - `pinMessage` — direct: any participant; group: owner/admin only. Replaces previous pin.
  - `forwardMessages` — text-only, skips deleted, enforces source-read + per-target-send permission, caps at 10×10.
  - `getMessageInfo` — read-only metadata + reaction summary + receipt placeholder counts.
- **`sendTextMessage` extended** to accept an optional `replyTo` payload and persist it on the message doc.
- **Disappearing-message sweeper** code shipped at `functions/src/chats/sweepExpiredMessages.ts` but **deliberately not exported** from `functions/src/index.ts`, so `firebase deploy` won't register the cron job. Activation deferred to Phase 11.
- **Rules tightening.** `messages.update` and `messages.delete` are now admin-only at the rules layer; every legitimate mutation flows through a callable using the Admin SDK. Added two shape validators (`isValidReplyTo`, `isValidForwardedFrom`) for any future direct-create path.
- **Mobile UI.**
  - `MessageBubble` component (new) is the long-press surface: reply preview, forwarded label, edited/starred/pinned indicators, reaction chips, and a permission-gated action sheet via `Alert.alert`. Inline emoji picker for React.
  - `Conversation` rewritten: composer carries reply-preview / edit-mode banners; pinned-message banner above the list with tap-to-jump and × unpin (for direct chats or group admins); local `userState` drives starred + deletedForMe filtering.
  - `ForwardPicker` (new) — multi-select target list with peer name resolution.
  - `MessageInfo` (new) — read-only metadata + reaction summary + receipt placeholder breakdown with the Phase 7-deferral copy.
- **i18n.** New `messageActions.*` and `messageErrors.*` namespaces in `en.json` + `ar.json`.

### Files created

- `docs/OFFLINESMS_PHASE_6_PLAN.md`
- `apps/mobile/src/components/MessageBubble.tsx`
- `apps/mobile/src/screens/ForwardPicker.tsx`
- `apps/mobile/src/screens/MessageInfo.tsx`
- `functions/src/chats/editMessage.ts`
- `functions/src/chats/deleteMessage.ts`
- `functions/src/chats/reactToMessage.ts`
- `functions/src/chats/starMessage.ts`
- `functions/src/chats/pinMessage.ts`
- `functions/src/chats/forwardMessages.ts`
- `functions/src/chats/getMessageInfo.ts`
- `functions/src/chats/sweepExpiredMessages.ts` (code only; not exported)

### Files edited

- `firestore.rules`
- `functions/src/index.ts`
- `functions/src/chats/sendTextMessage.ts` — optional `replyTo` + Phase 6 field defaults.
- `apps/mobile/src/lib/conversations.ts` — types + callable wrappers + `REACTION_EMOJIS`.
- `apps/mobile/src/screens/Conversation.tsx` — uses `MessageBubble`, reply / edit composer state, pinned banner.
- `apps/mobile/App.tsx` — registers `ForwardPicker` + `MessageInfo` routes.
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_DATA_MODEL.md`, `docs/OFFLINESMS_PHASE_LOG.md` (this file), `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md`, `docs/OFFLINESMS_RISK_REGISTER.md`, `docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`

### Commits

| Hash | Message |
|---|---|
| `3a121ad` | docs: add OfflineSMS phase 6 implementation plan |
| `cb4f86f` | feat(data): add message action contracts |
| `3c7f3ce` | security: add message action rules |
| `e4dfda8` | feat(functions): add message action callables |
| `2e23b32` | feat(mobile): add message action sheet and reply/edit composer states |
| `dc8f440` | feat(mobile): add forward picker and message info screen |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests** for the new callables / rules / UI. Manual emulator checklist in the Phase 6 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **Reactions not audited.** Toggling a reaction is too noisy to record; if compliance later demands it, switch the `auditLog` call back on in `reactToMessage.ts`.
- **Single pinned message per conversation.** Multi-pin can land as a sub-collection later. The current model is simpler and matches WhatsApp-style defaults.
- **`Clipboard` API used by the bubble's Copy action is the legacy one** (`Clipboard.setString`). Works on web; deprecated on native. Phase 8/9 will swap to `expo-clipboard` when wider native testing happens.
- **`deletedForMe` filtering is client-side only.** Hidden messages still exist on the server; this is intentional (the spec calls for `deleteForMe` as a per-user view).
- **Disappearing-message sweeper code present but not scheduled.** Activation is Phase 11 alongside the TTL setting UI.
- **No Starred-Messages screen yet.** Per-message star toggles work; a "starred across all chats" listing is deferred to a later phase.
- **`Forward` is text-only.** Media forwarding lands with media support (Phase 8+).
- **`MessageInfo` returns only metadata.** It deliberately doesn't return the message body — the bubble already shows it, and keeping the callable body-free is a useful boundary.

### Recommended Phase 7 scope

Phase 7 = **Delivery receipts, read receipts, and message views** (per the roadmap):

1. Client-side `markReceipt({ messageId, status })` callable; clients call it on render (`delivered`), on view (`read`), on audio play (`played`).
2. Aggregation trigger `onReceiptWrite` denormalises `deliveredCount` / `readCount` onto the message doc.
3. Tick-rendering on bubbles (single tick = sent, two ticks = delivered, blue ticks = read) consuming the denormalised counts.
4. `MessageInfo` Phase-7 pass: full per-recipient receipt list for group messages, replacing the "available in a later update" placeholder.
5. Receipt rate-limiting and a daily reconciliation function (Phase 20 will toughen).

Defer: media messages, SMS escalation UI, points UI, dashboard moderation, calls.

---

## Phase 5 — Group chat and member management

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Status:** Complete. App builds end-to-end (typecheck + lint + build green across workspaces).

### What was done

- **Group conversation contract.** `conversations/{id}` gains group-only fields (`name`, `avatarUrl`, `ownerUid`, `memberCount`, `settings { onlyAdminsCanSend, onlyAdminsCanEditInfo, onlyAdminsCanAddMembers }`) and `status` now includes `'locked'`. `participantKey` is nullable for groups.
- **Member contract.** `conversations/{c}/members/{uid}` is the canonical role table for groups: `{ uid, role: 'owner'|'admin'|'member', status: 'active'|'removed'|'left', addedBy, displayNameSnapshot, photoURLSnapshot, joinedAt, updatedAt }`. Phase 0/4 docs with only `{ role }` keep working — callable writes use `merge: true`.
- **Group messages** carry `senderDisplayName` + `senderPhotoURL` snapshots so the chat UI renders sender headers without joining `/users`.
- **Six new callables.** All audited via `writeAuditLog`. Metadata sanitiser scrubs body/content/messageText if mis-used.
  - `createGroup({ name, memberUids[], avatarUrl? })` → `group.created`. Cap `MAX_GROUP_MEMBERS = 256`.
  - `addMembers({ conversationId, memberUids[] })` → `group.member.added`. Owner/admin only.
  - `removeMember({ conversationId, memberUid })` → `group.member.removed`. Owner can remove admins; admin can remove members; owner-protection enforced.
  - `changeRole({ conversationId, memberUid, role })` → `group.member.role_changed`. Owner only; role ∈ {admin, member}; owner-role immutable from this path.
  - `leaveGroup({ conversationId })` → `group.member.left`. Owner can only leave when no other active members; last person out flips `status` to `disabled`.
  - `lockGroup({ conversationId, locked })` → `group.locked` / `group.unlocked`. Owner/admin only.
- **`sendTextMessage` extended** to reject non-active members, refuse sends when `status === 'locked'` unless owner/admin, refuse when `settings.onlyAdminsCanSend && !privileged`, and capture sender snapshots on the message doc.
- **Firestore rules.**
  - `conversations.create` now requires that group docs name the caller as `ownerUid` and include them in `participantUids` — client-side group spoofing is closed.
  - `members/{uid}.write` is server-only for groups (callables use Admin SDK). The legacy self-or-group-admin write path remains for non-group conversations.
  - New helpers: `getMemberRole(c)`, `memberExists(c, uid)`, `isConversationOwner(c)`, `isConversationAdmin(c)`, `isValidGroupRole(role)`, `isGroupTypeData(d)`, `safeGroupConversationCreate()`.
- **Composite index** added: `conversations(participantUids, type, updatedAt)` for the "Groups" filter chip.
- **Mobile UI.**
  - `apps/mobile/src/lib/conversations.ts` gains group types + the six callable wrappers + `subscribeMembers()` + `groupErrorCopy(code)`.
  - `ChatsList` enables the "Groups" filter chip, shows group name + member count, and the FAB now offers a "New chat / New group" action sheet.
  - `Conversation` adds a tappable header (groups → `GroupInfo`), sender-name labels above incoming group bubbles, and a state-machine composer that disables on `disabled`/`locked`/`onlyAdminsCanSend`/non-member with friendly inline copy.
  - `NewGroup` (new): multi-select picker on Phase 4's username search; calls `createGroup`.
  - `GroupInfo` (new): hero header, role-gated action rows (Add members / Lock·Unlock / Leave), member list with role badges and role-respecting per-row action sheets.
  - `AddMembers` (new): same picker pattern as `NewGroup`, filters out existing active members live.
- **i18n.** New `group.*` and `groupErrors.*` namespaces in `en.json` and `ar.json`.
- **No dashboard work.** Phase 14 is where admin moderation lands.

### Files created

- `docs/OFFLINESMS_PHASE_5_PLAN.md`
- `apps/mobile/src/screens/{NewGroup,GroupInfo,AddMembers}.tsx`
- `functions/src/chats/{createGroup,addMembers,removeMember,changeRole,leaveGroup,lockGroup}.ts`

### Files edited

- `firestore.rules`
- `firestore.indexes.json`
- `functions/src/chats/sendTextMessage.ts`
- `functions/src/index.ts`
- `apps/mobile/src/lib/conversations.ts`
- `apps/mobile/src/screens/{ChatsList,Conversation}.tsx`
- `apps/mobile/App.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_DATA_MODEL.md`, `docs/OFFLINESMS_PHASE_LOG.md` (this file), `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md`, `docs/OFFLINESMS_RISK_REGISTER.md`, `docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`

### Commits

| Hash | Message |
|---|---|
| `86a9bce` | docs: add OfflineSMS phase 5 implementation plan |
| `0750b25` | feat(data): add group conversation contracts and indexes |
| `51c3561` | security: add group member and conversation rules |
| `670a05c` | feat(functions): add group management callables |
| `a9e0461` | feat(mobile): add new group creation flow |
| `d978e91` | feat(mobile): add group conversation support |
| `3fbdcb4` | feat(mobile): add group info and member management |

Tail commit (this docs update) lands next.

### Checks run

```
npm run typecheck --workspaces --if-present   → ok (dashboard, mobile, functions)
npm run lint --workspaces --if-present        → ok
npm run build --workspaces --if-present       → ok
```

### Known limitations

- **No automated tests for rules / callables / UI.** Manual emulator checklist in the Phase 5 plan; `@firebase/rules-unit-testing` lands in Phase 20.
- **Owner-transfer deferred.** Owners must remove or be the last member before leaving; transferring ownership to another admin is a future-phase callable.
- **`onlyAdminsCanEditInfo` not yet wired.** The field is in the schema and a future "Edit group" screen will consult it; today only `lockGroup` / `addMembers` flows exist, both already owner/admin-only.
- **No avatar upload.** `avatarUrl` accepted by `createGroup` but the mobile UI doesn't mount an image picker yet. Phase 4+ media wave.
- **Member-count cap is server-only.** Rules don't enforce `memberCount <= 256` because it'd cost an extra `get()` per write. Phase 20 will reconsider.
- **Dashboard group moderation** is still empty-state. Phase 14.

### Recommended Phase 6 scope

Phase 6 = **Message actions and message info** (per the roadmap):

1. Long-press sheet on message bubbles: Copy, Reply, Forward, React, Star, Pin, Edit (sender only, within window), Delete-for-me / Delete-for-everyone (sender or admin).
2. Callables: `editMessage`, `deleteMessage`, `reactToMessage`, `pinMessage` (group-aware), `forwardMessages`. All audited.
3. Firestore fields on `messages`: `editedAt`, `deletedForEveryone`, `reactions: Record<emoji, uid[]>`, `pinnedAt`, `replyTo`, `forwardedFrom`.
4. Rule additions: edit window guard (e.g. 15 minutes), reaction shape validation, pin allowed for participants but only owner/admin in locked groups.
5. Disappearing-message TTL field on `messages` + a scheduled sweeper function.
6. `MessageInfo` precursor screen (read counts from existing `receipts/{uid}` placeholders — Phase 7 will populate them).

Defer: media messages, message views aggregation, full receipts UI (Phase 7), SMS escalation (Phase 8).

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
