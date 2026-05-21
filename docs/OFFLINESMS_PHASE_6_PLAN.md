# OfflineSMS Phase 6 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 5 complete (`8b7c72c`).

---

## Objective

Add user-facing **message actions** (reply, react, edit, delete, star, pin, forward) and a **Message Info** precursor, on top of the Phase 4/5 chat foundation. All write paths go through audited Cloud Function callables — clients never directly mutate message docs after creation.

No media messages, no full receipt analytics, no SMS, no points, no calls, no status, no admin moderation UI.

---

## Exact scope

### Data model

Existing `messages` fields stay. Phase 6 fills the placeholders (`editedAt`, `deletedForEveryone`, `replyTo`) and adds:

```ts
messages/{messageId} {
  // existing Phase 4/5 …
  editedAt:           timestamp | null,
  deletedForEveryone: boolean,
  deletedAt:          timestamp | null,
  deletedBy:          string  | null,
  deleteReason:       string  | null,
  replyTo: {
    messageId:         string,
    senderUid:         string,
    senderDisplayName: string,
    preview:           string,            // <= 80 chars
    type:              'text',
    createdAt:         timestamp,
  } | null,
  forwarded:    boolean,
  forwardedFrom: {
    conversationId: string,
    messageId:      string,
    senderUid?:     string,
  } | null,
  reactions:   { [emoji: string]: string[] } | null,   // one emoji per user; capped
  pinnedAt:    timestamp | null,
  pinnedBy:    string  | null,
  expiresAt:   timestamp | null,                       // disappearing-message TTL
}
```

**Per-user message state** lives on the existing `conversations/{c}/userState/{uid}` doc rather than a new collection, to avoid a per-message listener:

```ts
userState/{uid} {
  // existing Phase 4 fields …
  starredMessageIds:      string[],    // capped at 500
  deletedForMeMessageIds: string[],    // capped at 500
}
```

Both are bounded arrays — a Phase 20 reconciliation step can prune them if they ever hit the cap.

**Conversation-level pin** lives on the conversation doc:

```ts
conversations/{c} {
  pinnedMessage: {
    messageId: string,
    senderUid: string,
    senderDisplayName?: string,
    preview:   string,
    pinnedAt:  timestamp,
    pinnedBy:  string,
  } | null,
}
```

Only one pinned message at a time per conversation (simplest UI; multi-pin can land later).

### Callables (`functions/src/chats/`)

| Callable | Audit |
|---|---|
| `editMessage({ conversationId, messageId, text })` | `message.edited` |
| `deleteMessage({ conversationId, messageId, mode: 'for_me' \| 'for_everyone' })` | `message.deleted.for_me` / `message.deleted.for_everyone` |
| `reactToMessage({ conversationId, messageId, emoji })` | not audited (noise) |
| `starMessage({ conversationId, messageId, starred })` | not audited |
| `pinMessage({ conversationId, messageId, pinned })` | `message.pinned` / `message.unpinned` |
| `forwardMessages({ sourceConversationId, messageIds[], targetConversationIds[] })` | `message.forwarded` (counts only) |
| `getMessageInfo({ conversationId, messageId })` | not audited (read) |

Plus a small extension to **`sendTextMessage`**: accept an optional `replyTo` field on the request and persist it on the new message doc.

**Edit window:** `EDIT_WINDOW_MS = 15 * 60 * 1000` (15 minutes from `createdAt`).
**Reaction cap:** at most one emoji per user per message. Toggling the same emoji removes it; choosing a different emoji replaces the previous one.
**Pin policy:** direct chats — any participant may pin. Group chats — owner / admin only.
**Delete-for-everyone policy:** sender always; group owner / admin may delete other members' messages too.

### Disappearing-message TTL

- `messages.expiresAt` is honoured by a scheduled function `sweepExpiredMessages` (hourly), which flips matching messages to `deletedForEveryone: true` with `deleteReason: 'expired'`. No client-side TTL setting UI in Phase 6 — the field is foundation-only.
- The sweeper is registered with the existing functions barrel but **not enabled by default in `firebase.json`**; it ships as code only and is documented as deferred-activation until Phase 11.

### Rules

Tighten `messages.update` and `messages.delete`: previously allowed when `senderUid == auth.uid`. Phase 6 makes both **admin-only at the rules layer** because every legitimate update (edit / delete-for-everyone / react / pin) now flows through a callable that uses the Admin SDK. The narrow "sender can also delete" rule that Phase 4 left in place becomes dead code.

`conversations.update` rule narrowed for `pinnedMessage` — callable-owned, but admins keep an escape hatch.

`userState/{uid}` field allow-list extended to include `starredMessageIds`, `deletedForMeMessageIds`, `updatedAt` (already in there). The `starMessage` callable still does the write so rules stay simple; client direct-write fallback also accepted because both fields are owner-scoped anyway.

New helpers:

- `isWithinEditWindow(createdAt)`
- `isValidReactionMap(map)`
- `isValidReplyTo(obj)` / `isValidForwardedFrom(obj)`

These helpers are conservative — used to validate `messages.create` payloads (so future direct `create` paths can't smuggle malformed replyTo/forwardedFrom objects).

### Mobile UI

- **`MessageBubble.tsx` (new):** isolated bubble component. Renders reply preview, forwarded label, reactions row, edited/deleted/pinned indicators, "tap and hold" → action sheet via React Native's `Alert.alert` (with overrides where the design wants a richer sheet).
- **`Conversation.tsx`:** uses `MessageBubble`; composer shows reply preview + edit-mode banner; pinned banner appears above the list with tap-to-jump.
- **`ForwardPicker.tsx` (new):** lists active conversations (re-uses `subscribeConversations`), multi-select, "Forward" button calls `forwardMessages`.
- **`MessageInfo.tsx` (new):** screen for a single message; pulls `getMessageInfo`; renders sent / edited / deleted / pinned / starred / reactions / forwarded-from / reply-to / receipt-placeholder counts.

Actions visible per state:

| State | Available actions |
|---|---|
| Normal message | Copy · Reply · Forward · React · Star · Pin · Edit (sender, in window) · Delete · Info |
| Edited message | Same; "edited" label |
| Pinned message | Same; Pin → "Unpin" |
| Starred (for me) | Same; Star → "Unstar" |
| Deleted for everyone | Info · Delete for me |

### Indexes

- `messages` collection group: `(expiresAt ASC)` — used by the sweeper. Single-field index is automatic; no addition needed.

No new composite indexes. The existing `messages(conversationId, createdAt DESC)` covers reply / forward / info reads.

### i18n

Add `messageActions.*` and `messageErrors.*` namespaces in `en.json` + `ar.json`.

### Audit metadata policy

| Action | metadata |
|---|---|
| `message.edited` | `{ conversationId, messageId, length }` |
| `message.deleted.for_me` | `{ conversationId, messageId }` |
| `message.deleted.for_everyone` | `{ conversationId, messageId, byRole }` |
| `message.pinned` / `message.unpinned` | `{ conversationId, messageId }` |
| `message.forwarded` | `{ from, to: targetCount, count }` |

Reactions, stars, edits-in-flight (`sendTextMessage`-with-`replyTo`) all skip the audit log. Body text is **never** recorded.

---

## Files expected to change

**Create**
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
- `functions/src/chats/sweepExpiredMessages.ts` (code only; not wired in firebase.json)

**Edit**
- `firestore.rules`
- `functions/src/index.ts`
- `functions/src/chats/sendTextMessage.ts` — optional `replyTo` field passthrough.
- `apps/mobile/src/lib/conversations.ts` — types + callable wrappers.
- `apps/mobile/src/screens/Conversation.tsx` — use MessageBubble, reply / edit composer, pinned banner.
- `apps/mobile/App.tsx` — register ForwardPicker + MessageInfo routes.
- `apps/mobile/src/i18n/{en,ar}.json`
- Docs: phase log, technical architecture, risk register, design map, data model.

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tightened `messages.update` rule breaks existing seed or any pre-existing client write | Low | Medium | All current writes are callable-mediated; the Phase 4 `chats.ts` facade already routes through `sendTextMessage`. Seed uses Admin SDK. |
| `reactions` map grows unbounded with many emojis | Low | Low | One emoji per user per message; reactions object is recreated on each toggle, never grown. |
| `starredMessageIds` / `deletedForMeMessageIds` arrays grow over time | Low | Low | Capped at 500 in the callable; older entries are dropped FIFO when the cap is hit. |
| Edit-window race (client thinks open, server sees closed) | Medium | Low | Server is authoritative; mobile shows friendly error from the callable. |
| Disappearing-message sweeper accidentally runs and deletes too much | Low | High | Code shipped but scheduler not enabled in `firebase.json`; explicit follow-up in Phase 11. |
| Forward fan-out spam | Medium | Medium | `forwardMessages` enforces target-participant check per conversation; a per-call target cap of 10 conversations × 10 messages bounds the blast radius. |
| Audit-log payload accidentally includes text | Low | High | Helper sanitiser strips `body`/`content`/`messageText`/`text` keys; every Phase 6 callable explicitly passes `{ length }` instead of `{ text }`. |

---

## Rollback plan

- All commits scoped; rules change, callable additions, and mobile UI revert independently.
- `messages.update` rule tightening is the highest-risk single commit; reverting it restores the Phase 4 behaviour (sender-may-update).
- Disappearing-message sweeper is unused until explicitly scheduled; reverting the file is safe.

---

## Test plan

No automated harness yet (Phase 20).

- `npm run typecheck --workspaces --if-present` — green.
- `npm run lint --workspaces --if-present` — green.
- `npm run build --workspaces --if-present` — green.

**Manual emulator checklist** mirrors the spec's checklist.

---

## Acceptance criteria

1. Plan committed.
2. Message fields + per-user state + pinnedMessage summary in the schema.
3. Rules narrowed: `messages.update`/`delete` no longer accept direct sender writes — callables only.
4. Seven callables exist, audited where appropriate.
5. `sendTextMessage` accepts `replyTo`.
6. Mobile bubbles render reply / forwarded / edited / deleted / pinned / starred / reactions.
7. Long-press sheet wired to every action with permission gates.
8. ForwardPicker and MessageInfo ship.
9. Disappearing-message sweeper code present but not auto-scheduled.
10. No third-party SMS provider names.
11. No message body in any audit log.
12. Phase 1 / 2 / 3 / 4 / 5 still work.
13. typecheck / lint / build green.
14. Phase log updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 6 implementation plan`
2. `feat(data): add message action contracts`
3. `security: add message action rules`
4. `feat(functions): add message action callables`
5. `feat(mobile): add message action sheet and reply/edit composer states`
6. `feat(mobile): add reactions, star, pin, and delete UI`
7. `feat(mobile): add forward picker and message info screen`
8. `docs: update phase log for phase 6`
