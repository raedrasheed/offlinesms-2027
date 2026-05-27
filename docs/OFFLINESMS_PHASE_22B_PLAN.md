# OfflineSMS — Phase 22B Plan: ChatList Local-DB Cutover (flag-gated)

## Objective

Let the **chat list** read from the local SQLite DB instead of subscribing
directly to Firestore — behind a feature flag that defaults **off**. Firestore
becomes a *feeder* into the local DB (the UI's source of truth), with a safe
fallback to the existing Firestore path when the local DB is empty/unavailable.

Out of scope (unchanged this phase): Conversation screen, `OfflineContext` /
`offlineQueue`, SMS/points logic. Nothing is enabled by default.

## Feature flag strategy

`apps/mobile/src/config/features.ts` exposes `LOCAL_FIRST_CHAT_LIST_ENABLED`.
- Default `false`.
- Overridable at build time via `EXPO_PUBLIC_LOCAL_FIRST_CHAT_LIST=1` (Expo
  public env), so QA can flip it on a dev build without code changes.
- `false` → existing Firestore `ChatsList` is used verbatim.
- `true` → `ChatsList` reads from `useLocalChatList()`; if the local DB can't
  initialise, the hook reports `source: 'firestoreFallback'` and `ChatsList`
  silently uses the legacy Firestore path.

## Current ChatList data flow

`ChatsList.tsx` subscribes to `subscribeConversations()` plus per-conversation
`userState`, `typing`, and peer-profile listeners; it renders `enriched` rows
through `filtered` (All/Unread/Favorites/Groups + search) — Archived was removed
in an earlier UI change.

## Local DB read path

`apps/mobile/src/hooks/useLocalChatList.ts`:
1. `initLocalDb(uid)` (open per-user DB + start scheduler).
2. Read `conversationsRepo.listConversations()` (indexed by `last_message_at`).
3. Map rows → `ChatListItem` view models (`chatListModel.ts`, pure).
4. Start the Firestore feeder; re-query the local DB on each feeder change
   (debounced) since repositories don't yet expose live observers.
5. Return `{ items, loading, error, refresh, source }`.

Performance: newest-first via the `idx_conversations_last_message_at` index,
no per-row JSON parsing, initial set bounded by the repo query.

## Firestore fallback path

If `initLocalDb`/read throws, the hook returns `source: 'firestoreFallback'`
and `ChatsList` keeps its existing Firestore subscriptions. With the flag off,
the local code path is never mounted at all.

## Sync feeder strategy

`apps/mobile/src/localdb/sync/chatListFeeder.ts`:
- One `onSnapshot` on the user's conversations + per-conversation `userState`.
- Upserts conversations (and, for direct chats, resolves the peer display name
  once) and applies user-state fields (unread/pinned/muted/favorite/archived,
  last-message preview/time) into the local DB.
- De-dupes (COALESCE keeps existing title; no-op when nothing changed) and logs
  only safe metadata (ids/counts — never message text or phone numbers).

## Device verification checklist (PENDING — requires a device/Expo build)

1. `npm install` + `npx expo install expo-sqlite`.
2. `npx expo start`; app boots; SQLite opens; migrations apply.
3. Cold start shows cached chat list **before** network.
4. Airplane mode still shows the cached list.
5. Reconnect refreshes the local list; unread counts match Firestore after sync.
6. Group/direct/unread/favorite filters + search work on local data.
7. App restart keeps the DB; logout wipes it (no cross-user leak).
8. Flag off → byte-for-byte the old Firestore behaviour.

## Rollback plan

Flag defaults off → zero behavioural change. Disabling = leave flag false (or
unset the env). All new modules are additive; no remote/destructive changes.

## Acceptance criteria

Flag exists (default false); local chat-list hook + pure mappers exist; feeder
writes conversations/user-state into SQLite; `ChatsList` reads local when the
flag is on and falls back to Firestore otherwise; filters work on local data;
no SMS/points/Conversation changes; pure tests pass; device checklist completed
or clearly marked pending; phase log updated.
