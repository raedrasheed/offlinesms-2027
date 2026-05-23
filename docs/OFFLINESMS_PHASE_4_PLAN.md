# OfflineSMS Phase 4 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 3 complete (`84e9e11`).

---

## Objective

First real chat functionality: **one-to-one text messaging**, a working chat list with filters and unread counts, mark-as-read, and a typing indicator. All consistency goes through Cloud Functions; clients never directly mutate conversation summaries or message counters.

No groups, no media, no SMS, no points, no calls, no status, no admin chat UI.

---

## Exact scope

### Data model (`conversations/{id}`)

- `type: 'direct' | 'group' | 'channel'` — Phase 4 only writes `'direct'`.
- `participantUids: string[]` — the canonical participant list (Phase 4+).
- `memberIds: string[]` — kept as a back-compat alias of `participantUids` so existing seed data, the receipt-fanout trigger, and the dashboard list page keep working until Phase 13's group module. Written alongside `participantUids` on every server-side create.
- `participantKey: string` — sorted-uid join (`uidA_uidB`) used to look up an existing direct conversation in O(1).
- `createdBy: string` — uid of the caller that opened the conversation.
- `createdAt`, `updatedAt`: server timestamps.
- `lastMessage: { messageId, senderUid, type, preview, createdAt }` — new canonical summary.
- `lastMessageText`, `lastMessageAt`, `lastSenderId` — back-compat (the existing trigger and dashboard read these).
- `status: 'active' | 'archived' | 'disabled'` — Phase 4 writes `'active'`.

### Sub-collection `conversations/{c}/messages/{messageId}`

- `conversationId: string`
- `senderUid: string` — canonical Phase 4 field.
- `senderId: string` — back-compat (the existing receipt trigger reads `senderId`).
- `type: 'text'` (only text in Phase 4)
- `text: string` — 1..4000 chars after trim.
- `createdAt`, `updatedAt`: server timestamps.
- `status: 'sent'` — Phase 4 always writes `'sent'`; future phases evolve this.
- `deletedForEveryone: false`
- `editedAt: null`
- `replyTo: null`

### Sub-collection `conversations/{c}/userState/{uid}` (NEW)

- `uid: string`
- `pinned: boolean`
- `muted: boolean`
- `archived: boolean`
- `favorite: boolean`
- `lastReadAt: serverTimestamp`
- `unreadCount: number`
- `lastMessagePreview: string` — clamped to ~80 chars
- `lastMessageAt: serverTimestamp`
- `updatedAt: serverTimestamp`

Clients write **only** `{ pinned, muted, archived, favorite, updatedAt }` via direct Firestore writes. Everything else is server-owned (callable / trigger).

### Sub-collection `conversations/{c}/typing/{uid}` (NEW)

- `uid: string`
- `isTyping: boolean`
- `updatedAt: serverTimestamp`
- `expiresAt: timestamp` — `now + 3000ms` set by the client (or by the callable).

Owner-write, participant-read. No content.

### Callables (`functions/src/chats/`)

1. **`getOrCreateDirectConversation({ otherUserId })`** — auth required, validates other uid, blocks self-chat, builds `participantKey` from sorted uids, looks up existing, creates if none. Initialises both `userState` docs. Audited as `chat.directConversation.opened` (no message content).

2. **`sendTextMessage({ conversationId, text })`** — auth required, validates participant, validates text (`1..4000` chars after trim), writes the message doc with both `senderUid` and back-compat `senderId`. The `onMessageCreate` trigger fans out `lastMessage` + recipient unread + receipts. Audited as `chat.message.sent` with **only** `{ messageId, length }` — never the body.

3. **`markRead({ conversationId })`** — auth required, validates participant, sets `userState/{self}.lastReadAt` to `serverTimestamp()` and resets `unreadCount` to `0`. Audited as `chat.markRead`.

4. **`setTyping({ conversationId, isTyping })`** — auth required, validates participant, writes `typing/{self}` with `expiresAt = now + 3000ms`. **Not audited** (would be too noisy).

### Trigger update (`functions/src/chats/onMessageCreate.ts`)

Extended to write the new `conversation.lastMessage` object **and** the recipients' `userState` (unread + preview). Receipt fan-out unchanged. Reads `senderUid` with `senderId` fallback so old + new clients both work.

### Firestore rules

New helpers:
- `isConversationParticipant(c)` — `request.auth.uid in resource.data.participantUids` (with `memberIds` fallback for back-compat).
- `isDirectConversation(c)` — `c.type == 'direct'` and `participantUids.size() == 2`.
- `isValidConversationCreate()` — checks fields on `create`.
- `isValidTextMessage()` — `type == 'text'`, text 1..4000 chars, `senderUid == auth.uid`.
- `isOwnUserState(uid)`, `isOwnTyping(uid)`.
- `allowedUserStateClientFields()` — `[pinned, muted, archived, favorite, updatedAt]`.

Rule changes:
- `conversations/{c}.read` requires participant (or admin). Read by `participantUids array-contains auth.uid` OR legacy `memberIds array-contains auth.uid`.
- `conversations/{c}.create` allowed for any signed-in user IFF the doc names them in `participantUids/memberIds` (the callable writes this; legacy direct-create still works for seed scripts via admin SDK).
- `messages.create` validates text & sender.
- `userState/{uid}` writes restricted to owner + the small field allow-list.
- `typing/{uid}` writes restricted to owner; participants can read.

### Mobile UI

- **`ChatsList`**: real-time `conversations where participantUids array-contains uid order by updatedAt desc`. Filter chips: All / Unread / Favorites / Archived (Groups disabled until Phase 5). Search placeholder. FAB → `NewChat`. Shows unread badge, pinned/muted indicators, typing indicator when any participant in the conversation has a non-expired `typing` doc.
- **`NewChat`** (new screen): live user search by `usernameLower` prefix. Tap → `getOrCreateDirectConversation`, navigate to `Conversation`.
- **`Conversation`**: header with peer name; messages from `messages where conversationId == c orderBy createdAt asc`. Composer drives `sendTextMessage` and `setTyping`. On screen focus and on new incoming message, calls `markRead`. Failed send → inline error.

### Mobile lib

- New `apps/mobile/src/lib/conversations.ts` consolidating subscriptions + callable wrappers (`getOrCreateDirectConversation`, `sendTextMessage`, `markRead`, `setTyping`, `subscribeUserState`, `subscribeTyping`, `subscribeMessages`).
- Existing `apps/mobile/src/lib/chats.ts` is updated to consume the new shape but keeps `subscribeConversations` as a thin facade so the old screens keep compiling during the migration.

### Dashboard

Untouched. The existing `/admin/users` page already reads `users` with the admin SDK and respects redaction. No new admin UI.

### Indexes

- `conversations (participantUids array-contains, updatedAt DESC)` — chat list.
- `conversations (participantUids array-contains, status ASC, updatedAt DESC)` — for the All/Archived filter without a client-side filter.
- (Already exists) `conversations (memberIds array-contains, lastMessageAt DESC)` — kept for back-compat.

No `messages` index change — the existing `messages (conversationId, createdAt DESC)` covers it; in-conversation queries also work fine on the implicit doc-id ordering.

### Audit logging

- `chat.directConversation.opened` — actor = caller, target = conversation, metadata = `{ otherUid }`.
- `chat.message.sent` — actor = sender, target = message, metadata = `{ conversationId, length }`. **Never** body.
- `chat.markRead` — actor = caller, target = conversation. No body.
- Typing: not audited.

### Privacy

- `sendTextMessage` records **length only**; the audit metadata sanitiser would scrub `body`/`content`/`messageText` anyway.
- Admin dashboard message moderation is Phase 14; nothing in Phase 4 surfaces content.
- The user-search step uses `users.usernameLower` (already readable by any signed-in user per Phase 2 rules). No phone numbers, no emails returned.

---

## Files expected to change

**Create**
- `docs/OFFLINESMS_PHASE_4_PLAN.md` (this file)
- `apps/mobile/src/lib/conversations.ts`
- `apps/mobile/src/screens/NewChat.tsx`
- `functions/src/chats/getOrCreateDirectConversation.ts`
- `functions/src/chats/sendTextMessage.ts`
- `functions/src/chats/markRead.ts`
- `functions/src/chats/setTyping.ts`

**Edit**
- `firestore.rules`
- `firestore.indexes.json`
- `functions/src/chats/onMessageCreate.ts` — extend fan-out (lastMessage object + recipient userState + back-compat aliases).
- `functions/src/index.ts` — export new callables.
- `apps/mobile/src/lib/chats.ts` — adapt to the new shape; keep facade for existing imports.
- `apps/mobile/src/screens/ChatsList.tsx` — filter chips, unread, typing, FAB.
- `apps/mobile/src/screens/Conversation.tsx` — callable-based send, typing, mark-read.
- `apps/mobile/App.tsx` — register `NewChat` in the root stack.
- `apps/mobile/src/i18n/{en,ar}.json` — new strings.
- Docs: phase log, architecture, risk register, data model, design map.

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Schema migration breaks existing seed data | Medium | Medium | Keep `memberIds`, `lastMessageText`, `lastMessageAt`, `lastSenderId`, `senderId` as written-everywhere aliases. Trigger reads both. |
| Race on unread increment vs `markRead` | Medium | Medium | Trigger uses `FieldValue.increment(1)`; `markRead` overwrites to `0` in a single set. Last-writer-wins is acceptable for unread counts; reconciliation is a Phase 20 item. |
| Typing flood blows up Firestore costs | Medium | Low | Client debounces `setTyping` to once every 2 seconds; doc TTL via `expiresAt` field consumed by readers. |
| Audit log floods on a chatty user | Low | Low | `chat.message.sent` is audited per send but carries only `{ messageId, length }`. Sanitiser strips body even if a future caller mistakes the contract. |
| Rules break Phase 3 protections | Low | High | New rule blocks are additive; existing system-owned collections (`auditLogs`, `gatewayHealth`, …) untouched. |
| Admin dashboard surfaces content accidentally | Low | High | No dashboard changes in this phase. |

---

## Rollback plan

- All changes on the working branch; no deploy.
- Each commit is scoped — `git revert <hash>` undoes one slice.
- Rules change ships in a single commit so revert is one shot.
- New callables aren't called from any existing legacy code path, so reverting them doesn't break anything beyond Phase 4 itself.

---

## Test plan

The repo still has no automated test harness (Phase 20). Phase 4 follows manual validation.

- `npm run typecheck --workspaces --if-present` — green.
- `npm run lint --workspaces --if-present` — green.
- `npm run build --workspaces --if-present` — green.

**Manual emulator checklist:**
1. User A signs in and lands on Chats. Empty state renders.
2. User A taps FAB → New Chat → searches User B by username → taps → routed to Conversation. A new `conversations` doc exists with `participantKey = "<min>_<max>"`.
3. User A sends "hello". Audit shows `chat.message.sent` with `length: 5`, no body.
4. User B opens the app. Chats list shows the conversation with unread badge `1`, last message preview "hello".
5. User B opens the conversation. `markRead` resets badge to `0`; audit shows `chat.markRead`.
6. User C (third party) attempts to read the conversation → denied by rules.
7. User C attempts to write to `userState/{B}` → denied.
8. Invalid message body (empty, > 4000 chars, `type: 'image'`) → callable rejects.
9. User A starts typing → `typing/{A}` written with `expiresAt`; User B sees "typing…" in header and chat list; clears after 3 s.
10. Phase 1 admin guard still works; Phase 2 onboarding still works.

---

## Acceptance criteria

1. Plan committed.
2. Direct conversation data model exists and is rule-protected.
3. Conversation reads restricted to participants.
4. Message creates validated (type, length, sender).
5. `userState` is owner-only for safe fields; server-owned for counters.
6. `typing` is owner-write, participant-read.
7. `getOrCreateDirectConversation`, `sendTextMessage`, `markRead`, `setTyping` callables exist and are audited (typing excluded).
8. Chat list shows real conversations with unread, filters, and typing.
9. Conversation screen sends and renders text messages via callables.
10. Unread counters increment on receive and reset on mark-read.
11. Typing indicator works.
12. No group / media / SMS / points / status / calls / admin-chat UI.
13. No third-party SMS provider names.
14. No private message content in audit logs.
15. Phase 1 / 2 / 3 protections still hold.
16. typecheck / lint / build green.
17. Phase log updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 4 implementation plan`
2. `feat(data): add direct conversation data contracts and indexes`
3. `security: add conversation, message, userState, and typing rules`
4. `feat(functions): add direct conversation callables and fan-out`
5. `feat(mobile): add conversations lib and new-chat screen`
6. `feat(mobile): add chat list filters, unread, typing, and FAB`
7. `feat(mobile): rewire conversation screen on top of new callables`
8. `docs: update phase log for phase 4`
