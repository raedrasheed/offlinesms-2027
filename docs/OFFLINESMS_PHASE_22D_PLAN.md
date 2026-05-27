# OfflineSMS — Phase 22D Plan: message actions + receipts through the outbox

## Objective

In local-first conversation mode, route **message actions** (react, edit,
delete) and **receipts** through the local DB + outbox instead of calling
callables directly: apply the change optimistically to the local DB, enqueue an
idempotent outbox item, and let the 22A sync engine deliver it. Gated by the
existing `LOCAL_FIRST_CONVERSATION_ENABLED` flag (default OFF); the legacy direct
callable path stays as the fallback.

Out of scope: SMS/points, UI redesign, chat-list, Conversation read/send (22C
owns those). No new product behaviour.

## Why

22C made message *content* (send) local-first. Actions are the remaining direct
callable calls on the open conversation. Routing them through the outbox gives
the same benefits: instant optimistic UI, offline support, and retry-safety
(the outbox is idempotent; the sync engine already maps every action type to its
callable — see `firebasePush.ts`).

## Current action paths (flag OFF — unchanged)

- `MessageBubble`: `reactToMessage`, `editMessage`, `deleteMessage`,
  `starMessage`, `pinMessage` (direct callables).
- `Conversation`: `markRead` / `markReceipt` per incoming message (direct).

## Local-first action paths (flag ON)

The 22A outbox already defines the types (`react_message`, `edit_message`,
`delete_message`, `star_message`, `pin_message`, `mark_receipt`) and
`firebasePush` already maps them. 22D adds the optimistic local mutation +
enqueue helpers and wires the UI.

| Action | Optimistic local update | Outbox item | Idempotency key |
|--------|-------------------------|-------------|------------------|
| React | toggle emoji in `reactions_json` (mirrors server one-emoji-per-user toggle) | `react_message {conversationId, messageId, emoji}` | per-tap (unique) — toggles are order-sensitive, not collapsible |
| Edit | update `text` + `edited_at` | `edit_message {conversationId, messageId, text}` | per-edit (unique) |
| Delete | set `deleted_for_me` or `deleted_for_everyone` | `delete_message {conversationId, messageId, mode}` | `delete:msgId:mode` (idempotent) |

Pre-condition: actions require the message's **remote id** (a still-pending
local message must be delivered first). The helpers no-op with a clear result if
only a local id exists.

## Staging

- **22D-1 (this increment):** plan + pure `toggleReaction` (server-mirrored) +
  outbox enqueue helpers (`queueReactMessage`/`queueEditMessage`/
  `queueDeleteMessage`) + repo mutators + unit tests. Additive — not yet wired
  into `MessageBubble`.
- **22D-2:** wire `MessageBubble` react/edit/delete to the outbox path when the
  conversation is local-first; keep direct callables for flag-OFF.
- **22D-3:** receipts through the outbox (batched/debounced `mark_receipt`), and
  star/pin — which need per-user (`starredMessageIds`) and conversation
  (`pinnedMessage`) state added to the local schema; deferred/scoped here.

## Conflict / ordering

Reactions: optimistic toggle is provisional; the feeder's authoritative
`reactions` from the server overwrites local once the push round-trips (server
is the source of truth for the final reaction set). Edits/deletes reconcile via
`upsertRemoteMessage` and the 22A conflict resolver (delete-for-everyone wins,
newest edit wins).

## Rollback

Flag defaults OFF → zero behaviour change. All helpers additive; UI wiring is
flag-gated. No remote/destructive changes — actions still go through the same
callables, now via the idempotent outbox.

## Device verification (PENDING)

Flag-OFF parity; offline react/edit/delete apply instantly and sync on
reconnect; no duplicate/again-toggled state after retry; server reaction set
reconciles; delete-for-everyone wins.

## Acceptance criteria

Pure toggle logic + enqueue helpers + repo mutators exist and are tested; outbox
types/push already support the actions; flag-OFF path unchanged; 22D-2/22D-3
clearly staged; phase log updated.
