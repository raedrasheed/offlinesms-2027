# OfflineSMS — Phase 22 Plan: Local-First Mobile Database & Firebase Sync

## Objective

Introduce a WhatsApp-style **local-first** data layer for the OfflineSMS mobile
app: the device's SQLite database becomes the source of truth for the mobile
UI, and Firebase (Firestore + Cloud Functions) becomes the remote
synchronization backend. The UI must never block on the network to render
cached conversations or messages, outgoing changes are queued locally and
pushed when online, and remote changes are pulled into the local DB.

This phase introduces **no new product features** and **no UI redesign**. It is
infrastructure: a local database, repositories, a generalized outbox, a sync
engine, and minimal backend idempotency support.

## Current mobile data flow audit

Findings from the existing `apps/mobile` codebase:

- **Conversations list** (`src/screens/ChatsList.tsx`): subscribes directly to
  Firestore via `subscribeConversations()` plus per-conversation `userState`,
  `typing`, and peer-profile `onSnapshot` listeners. Renders only after the
  first Firestore snapshot (shows a full-page loader until then).
- **Conversation screen** (`src/screens/Conversation.tsx`): subscribes to the
  `messages` subcollection via Firestore listeners and merges in locally queued
  outgoing items for optimistic display.
- **Outgoing queue** (`src/lib/offlineQueue.ts`): an AsyncStorage-backed FIFO
  queue of text messages (`queued | syncing | failed`) with an in-memory cache
  and a listener set.
- **Connectivity + drain** (`src/context/OfflineContext.tsx`): one
  `@react-native-community/netinfo` listener; when online with pending items it
  drains the queue FIFO through the `sendTextMessage` callable, removing each
  item only after the server confirms. Retries up to 5 times.
- **Gap — no idempotency:** `OfflineContext` generates a `clientMessageId` but
  **never sends it to the server**. A retry after a lost/!timed-out response can
  create a duplicate remote message. Phase 22 closes this.
- **All privileged writes go through callables** (inventory below). The client
  does not write messages to Firestore directly.

### Existing Firestore listeners / callables inventory

Listeners (client → Firestore `onSnapshot`):
- `conversations` where `participantUids array-contains uid` (chat list)
- `conversations/{id}/userState/{uid}` (unread/pinned/muted/favorite/archived)
- `conversations/{id}/typing` (typing indicator)
- `conversations/{id}/messages` (conversation thread)
- `users/{uid}` (peer/profile)

Callables (client → Cloud Functions):
`getOrCreateDirectConversation`, `sendTextMessage`, `markRead`, `setTyping`,
`createGroup`, `addMembers`, `removeMember`, `changeRole`, `leaveGroup`,
`lockGroup`, `editMessage`, `deleteMessage`, `reactToMessage`, `starMessage`,
`pinMessage`, `forwardMessages`, `getMessageInfo`, `markReceipt`,
`markStatusViewed`, `escalateSms`, `previewSmsEscalation`,
`retryFailedSmsRecipients`, `createPurchase`, `confirmPayment`,
`transferPoints`, `matchContacts`, `claimUsername`.

## Local database technology decision

**Decision: Option A — `expo-sqlite` + a custom repository/sync layer.**

Rationale:
- The app is Expo-managed (SDK 51, RN 0.74.5); `expo-sqlite` ships first-party
  with a stable async API and needs no custom native module work.
- Minimal new dependencies; predictable, versioned SQL migrations.
- A small, auditable custom sync engine fits our callable-based backend better
  than WatermelonDB's sync primitives (which assume a particular push/pull
  endpoint shape we do not have).
- WatermelonDB would add native/prebuild complexity for little benefit here.

`expo-sqlite` (~14.x for SDK 51) will be added to `apps/mobile`.

### Security note on encryption

- SQLCipher is **not** available through stock `expo-sqlite` without a custom
  native build. For Phase 22 it is **deferred**; we rely on the OS app sandbox.
- Mitigation: **no secrets are stored in SQLite** — no auth tokens, OTPs,
  payment/webhook/admin secrets, or private keys. Tokens stay in Firebase Auth
  storage / `expo-secure-store`. Phone numbers are stored masked where the UI
  needs them.

## Schema proposal

Eight tables (full DDL in `OFFLINESMS_LOCAL_DB_SCHEMA.md`): `conversations`,
`messages`, `message_reactions`, `message_receipts`, `group_members`, `outbox`,
`sync_state`, `tombstones`. Every syncable row carries a `sync_status`
(`synced | pending | dirty | conflict | deleted/failed`) and timestamps split
into `local_*` and `remote_*` so the UI can sort by `remote_created_at` when
known and fall back to local time otherwise.

## Sync architecture

```
UI screens
  → local repositories (read/subscribe + optimistic write)
    → SQLite local database (source of truth for UI)
      → sync engine (push outbox / pull remote)
        → Firebase callables + Firestore listeners (remote backend)
```

- **Push:** the outbox is a durable, idempotent queue. The sync engine drains it
  in small batches, mapping each item to the matching callable, and reconciles
  the local row with the canonical server result (real `remote_id` + server
  timestamp).
- **Pull:** Firestore listeners/queries live **inside the sync layer only** and
  feed the local DB (upsert + conflict resolution). Pulls are cursor-based
  (`remote_updated_at`), paginated, and prioritize the active conversation.
- **Triggers:** app start, auth-user change, network-online, app-foreground, a
  new outbox item, pull-to-refresh, and a foreground-only 30–60 s timer.

## Conflict resolution strategy

Deterministic rules (implemented in `conflictResolver.ts`, pure & unit-tested):
- **Delete-for-everyone:** server wins; once remote `deleted_for_everyone` is
  true the local row is forced deleted.
- **Edit conflict:** latest valid edit wins by **server timestamp**; a remote
  delete-for-everyone supersedes any local edit.
- **Receipt status:** **monotonic only** — `pending < delivered < read/viewed/
  played`; never downgrade.
- **Delete-for-me:** local user-state wins (never overwritten by remote).
- **Pending→canonical:** a local `pending`/`sent` message is matched to its
  remote counterpart by `idempotency_key`/`local_id`; the local row inherits the
  `remote_id` and server timestamp.

## Migration strategy

- Versioned migrations in `migrations.ts`; `sync_state.local_schema_version`
  records the applied version. Migrations run once on connection open.
- **One-time import** of the legacy `offlineQueue` (AsyncStorage) into the new
  SQLite `outbox` on first boot, then the legacy queue is drained/retired.
- UI cutover is staged (22A→22E) with a Firestore fallback so an empty/absent
  local DB never blocks the UI.

## Security / privacy strategy

See "Security note" above. Additionally: clear-data-on-logout (stop sync, wipe
the current user's local DB, warn if unsynced outbox exists); DB is namespaced
by `uid` (or wiped when `uid` changes) to keep account switching safe; no
private message content or phone numbers are ever logged.

## Performance strategy

- Chat list: single indexed query by `last_message_at`; no per-row JSON parse.
  Target first paint < 150 ms from SQLite.
- Conversation: paginate (latest 30–50, infinite scroll older); bounded memory.
- Sync: small push batches, paged pulls, debounced receipt writes, pause when
  backgrounded, resume on foreground. Retention policy prunes old rows but
  **never** unsynced outbox.

## Test strategy

- **Pure logic (runs in CI / `npm run test`, node env):** id generation, retry
  policy / backoff, outbox state machine, conflict resolver. Located under
  `apps/mobile/__tests__/localdb/` (the only mobile glob the root vitest config
  includes).
- **Driver-backed (device/integration harness, not node CI):** migrations apply,
  CRUD, query ordering, wipe. Documented as requiring a device/Expo test build.

## Rollback plan

- All Phase 22 modules are **additive**; screens keep using Firestore until the
  staged cutover is explicitly enabled. Reverting is removing the imports /
  disabling the cutover flag — no destructive remote changes.
- The `sendTextMessage` idempotency params are **optional and backward
  compatible**; existing callers are unaffected.

## Acceptance criteria

1. Phase 22 plan exists (this document).
2. Local DB module (`src/localdb/`) with schema + versioned migrations.
3. Local repositories for conversations, messages, receipts, members,
   userState, outbox, syncState.
4. Durable, idempotent outbox queue + sync-state store.
5. Sync engine (push/pull/reconcile) wired to existing callables, with a pure,
   tested conflict resolver and retry policy.
6. Server idempotency for `sendTextMessage` (optional `localId` +
   `idempotencyKey`), backward compatible, no rule changes.
7. Pure-logic tests pass; functions package still builds.
8. **Staged:** chat list & conversation read from local DB — built behind a
   fallback/flag, enabled only after on-device verification (22B–22E).
9. Logout wipes / namespaces local data.
10. No SMS/points business logic changed; no private data logged; existing
    validation and Firestore rules unaffected.

## Status / staging

- **22A (this phase):** local DB + repositories + outbox + sync engine +
  function idempotency + pure tests. Additive; default app behavior unchanged.
- **22B–22E (next, device-verified):** cut chat list, conversation, receipts,
  reactions/edits/deletes over to the local DB + outbox; demote Firestore
  listeners into the sync layer.
