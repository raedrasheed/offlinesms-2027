# OfflineSMS — Phase 22C Plan: Conversation screen local-first + outbox send (flag-gated)

## Objective

Move the **Conversation screen** to the local-first model: read messages from
the local SQLite DB, and send through the **outbox + sync engine** (built in
22A) instead of calling `sendTextMessage` directly. All behind a feature flag
that defaults **OFF**, with a Firestore fallback. The legacy
`OfflineContext`/`offlineQueue` send path stays intact as the default.

Out of scope (unchanged this phase): chat list (22B owns it), SMS/points logic,
SQLCipher, receipts/reactions/edits migration (a later sub-phase). No UI
redesign.

## Dependency / risk note

22C builds on 22A/22B, which are **not yet device-verified** (PR #6 Draft). This
phase is therefore additive and flag-gated; nothing is enabled by default. Both
22B and 22C must pass on-device verification before either flag is turned on in
production.

## Feature flag strategy

`apps/mobile/src/config/features.ts` adds `LOCAL_FIRST_CONVERSATION_ENABLED`
(default `false`, override `EXPO_PUBLIC_LOCAL_FIRST_CONVERSATION=1`). Independent
of the chat-list flag so each screen can be verified separately.

- OFF → existing Conversation screen (Firestore listeners + `OfflineContext`
  send) runs unchanged.
- ON → messages read from `messagesRepo`; sends go through `queueSendMessage`
  (local row `pending` + outbox) and the sync engine delivers them.
- Fallback → if the local DB can't initialise, report `firestoreFallback` and
  use the existing path.

## Current Conversation data flow

`Conversation.tsx` subscribes to `subscribeMessages(id)`, merges locally-queued
items from `OfflineContext`, calls `markRead`/`markReceipt` per snapshot, and
sends via `enqueue` (offline) / `sendTextMessage` (online). Sending currently
does **not** pass an idempotency key (duplicate risk on retry — closed by 22A's
`queueSendMessage` + server idempotency).

## Local read path

- New `useLocalConversation(conversationId)` hook: opens the per-user DB, reads
  `messagesRepo.listMessages(id)` (paginated, newest-first), starts the message
  feeder, re-reads on change. Returns `{ messages, loading, source, loadOlder }`.
- A pure `messageModel.ts`: maps `MessageRow` → the `Message` shape the existing
  `MessageBubble` renders (Timestamp-like wrappers, reactions/reply mapping),
  plus a deterministic merge/ordering helper. Unit-tested in node.

## Message feeder

`localdb/sync/conversationFeeder.ts`: owns the Firestore `messages` listener for
the open conversation; upserts into `messagesRepo` (reusing `upsertRemoteMessage`
/ `markDeletedForEveryone` from 22A) and pings the hook. Pulls members for
groups. Active-conversation only (set via `setActiveConversation`).

## Send path (outbox-first)

When the flag is ON, sending calls `queueSendMessage` (22A): writes a `pending`
local message + an idempotent outbox item, returns immediately for optimistic
UI. The 22A sync engine pushes via `sendTextMessage` with `localId` +
`idempotencyKey`, then reconciles to the canonical server id. The scheduler
(started by `initLocalDb`) drains the outbox; this phase switches the hook to
use `initLocalDb` (with scheduler) rather than 22B's `openLocalDb`.

## Legacy queue migration

One-time import of any `offlineQueue` (AsyncStorage) items into the SQLite
`outbox` on first local-first conversation open, then mark the legacy queue
drained. Guarded so it runs once and never double-sends (outbox idempotency
key derived from the legacy `clientMessageId`). Legacy path remains for flag-OFF.

## Conflict / ordering

Reuse 22A's `conflictResolver`. Ordering by `remote_created_at` when known, else
local `created_at` (pending sends sort to the bottom until reconciled).
Delete-for-everyone and edits handled by `upsertRemoteMessage`.

## Device verification checklist (PENDING — requires device/Expo build)

1. Flag OFF → Conversation behaves exactly as today.
2. Flag ON → open chat shows cached messages instantly (no network wait).
3. Send online → optimistic `pending` → `sent`; appears once (no dup).
4. Send offline → stays `pending`; delivers on reconnect; still no dup on retry.
5. Incoming messages stream in via the feeder; deletes/edits reflect.
6. Legacy queued messages migrate once and send without duplication.
7. Logout wipe; flag-OFF parity.

## Rollback

Flag defaults OFF → zero behavioural change. All modules additive; revert =
leave flag off. No remote/destructive changes; send still goes through the same
`sendTextMessage` callable (now idempotent).

## Acceptance criteria

Flag exists (default false); local conversation hook + pure message model +
feeder exist; sending routes through outbox when ON; Firestore fallback intact;
legacy queue migration is idempotent; no SMS/points changes; pure tests pass;
device checklist completed or marked pending; phase log updated.

## Staging

- **22C-1 (first increment):** flag + pure message model + tests (additive, no
  screen change).
- **22C-2:** conversation feeder + `useLocalConversation` hook.
- **22C-3:** gate `Conversation.tsx` read + send behind the flag; legacy queue
  import. Device-verified before enable.
