# OfflineSMS — Sync Protocol (Phase 22)

Local SQLite is the source of truth for the mobile UI. Firebase
(Firestore + Cloud Functions callables) is the remote backend. The sync engine
pushes the local outbox and pulls remote changes; the UI never blocks on it.

## Components

- `sync/networkState.ts` — NetInfo wrapper, cached `isOnline()`.
- `sync/retryPolicy.ts` — exponential backoff + jitter; permanent-error
  classification (`invalid-argument`, `permission-denied`, `unauthenticated`,
  `not-found`, `failed-precondition`, `already-exists`).
- `sync/conflictResolver.ts` — pure resolution rules (below).
- `sync/firebasePush.ts` — maps each outbox `type` to its callable.
- `sync/firebasePull.ts` — cursor/paged Firestore reads → local upserts.
- `sync/syncEngine.ts` — single-flight `syncNow(reason)` = `pushOutbox()` then
  `pullRemoteChanges(activeConversationId)`.
- `sync/syncScheduler.ts` — triggers + foreground-only timer.

## Push

1. UI write → local row (`pending`) + `outbox` row with a unique
   `idempotency_key`.
2. `pushOutbox()` claims due items (`status=pending`, `next_attempt_at<=now`),
   marks `processing`, calls the mapped callable.
3. On success: `send_message` reconciles the local message to the server id
   (`reconcileToRemote`) and the outbox item is `completed`.
4. On error:
   - **permanent** → outbox `dead`, message marked `failed` (retry affordance).
   - **transient** → outbox back to `pending` with backoff `next_attempt_at`;
     message returns to `pending`.

### Idempotency

`send_message` passes `localId` + `idempotencyKey` to `sendTextMessage`. The
server records `clientLocalId` and returns the existing message if it already
created one for that `(senderUid, clientLocalId)` — so a retry after an
ambiguous response never duplicates. The outbox `idempotency_key` is itself
`UNIQUE`, so enqueuing twice locally is also a no-op.

## Pull

Cursor-based (`remote_updated_at`), paginated, active-conversation-first:
conversations (+ per-user state) always; messages + members for the active /
recently opened conversation. Avoids full-collection scans and pulling all
messages at boot.

## Conflict resolution (deterministic)

- **Receipts** — monotonic: `pending < delivered < read/viewed < played`; never
  downgrade. A real signal beats a prior `failed`.
- **Delete-for-everyone** — server wins; forces local delete.
- **Edit** — newer wins by `server_version` then server timestamp; remote
  delete-for-everyone supersedes any local edit.
- **Delete-for-me** — local user-state wins; never overwritten by remote.
- **Pending→canonical** — match local `local_id` to the remote message's
  `clientLocalId`; inherit `remote_id` + server timestamp instead of inserting a
  duplicate.

## Triggers

App start, auth-user change, network-online, app-foreground, new outbox item,
pull-to-refresh, and a foreground-only 30–60 s timer. Sync pauses on background.

## Rollback

All modules additive; screens keep using Firestore until the staged cutover is
enabled. Server idempotency params are optional/back-compatible.
