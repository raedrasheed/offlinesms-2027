# OfflineSMS Phase 7 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 6 complete (`64f8a6e`).

---

## Objective

Complete the **receipt layer** for direct and group text messages: real
delivery / read ticks, per-recipient detail in Message Info, denormalised
aggregate counts on the message doc, and a server-enforced no-downgrade
status transition. Add the **status-view foundation** so a status owner can
see who viewed their post once Phase 13 wires the rest of the status UI.

No new product features beyond receipts. No media. No SMS, points, calls,
dashboard moderation.

---

## Exact scope

### Receipt data model

The existing `conversations/{c}/messages/{m}/receipts/{uid}` schema gains
the full Phase 7 shape:

```ts
receipts/{uid} {
  uid:            string,
  conversationId: string,
  messageId:      string,
  status:         'pending' | 'delivered' | 'read' | 'viewed' | 'played' | 'failed',
  deliveredAt:    timestamp | null,
  readAt:         timestamp | null,
  viewedAt:       timestamp | null,
  playedAt:       timestamp | null,
  failedAt:       timestamp | null,
  failureReason:  string | null,
  createdAt:      timestamp,
  updatedAt:      timestamp,
}
```

Status enum unchanged from Phase 3 (`isValidReceiptStatus`).

### Aggregate counts on messages

```ts
messages/{messageId} {
  // … existing Phase 4/5/6 fields …
  deliveredCount:   number,
  readCount:        number,
  viewedCount:      number,
  playedCount:      number,
  failedCount:      number,
  pendingCount:     number,
  receiptUpdatedAt: timestamp,
}
```

**Server-owned.** Clients can't write these — the `messages.update` rule is
already admin-only from Phase 6.

### Message views — design choice

We **fold "viewed" into the existing receipts enum** for text messages,
rather than introducing a new `views/{uid}` sub-collection. The receipt
already carries `viewedAt`, the rules already validate the enum, and the
aggregation trigger handles counts uniformly. When media support lands,
media-specific "view" events (e.g. opened-fullscreen) can reuse the same
receipt structure with `status: 'viewed'`. The dedicated `views/{uid}`
sub-collection stays in the design map for future media analytics.

### Status views

New sub-collection `statuses/{statusId}/views/{viewerUid}`:

```ts
{
  statusId:  string,
  ownerUid:  string,
  viewerUid: string,
  viewedAt:  timestamp,
}
```

Read: only the status owner sees their viewer list. Each viewer can read
their own view doc.
Write: only the `markStatusViewed` callable (Admin SDK; clients can't write
directly), which re-checks Phase 3's audience rules before recording the
view.

### Callables (`functions/src/chats/` and `functions/src/statuses/`)

| Callable | Audit |
|---|---|
| `markReceipt({ conversationId, messageId, status })` | not audited (noise) |
| `markStatusViewed({ statusId })` | not audited |

Plus an updated **`onReceiptWrite`** Firestore trigger that recomputes the
aggregate counts on the parent message doc after any receipt change.

Plus an extended **`getMessageInfo`** that, for senders viewing their own
message, returns a per-recipient receipt list (uid, displayName snapshot,
role, status, all timestamps, failureReason). Non-senders see counts only.

### Receipt status transitions (server-enforced)

`markReceipt` only allows monotonic forward transitions:

```
pending  →  delivered  →  read    (read implies viewed for text)
         ↘  viewed
         ↘  played
any      →  failed     (server-side / explicit; client can't downgrade)
```

A `read` doc can absorb a later `delivered` (no-op). A `pending` doc can
move to any forward state. Downgrades are silently no-op'd.

### Rules tightening

- `receipts.create` / `receipts.update`: keep Phase 3's owner-only +
  status-enum check, but **add doc-id sanity**: receipt doc id must equal
  `auth.uid`. Already enforced via `isSelf(uid)` in the path matcher.
- `receipts.read`: tighten so that **only the receipt owner OR the
  message sender OR an admin** can read receipts. Removes the Phase 4
  "any participant" read — which would have let group members enumerate
  each other's read status.
- New status-views sub-collection rules: owner reads all; viewer reads
  own; writes server-only.

### Client behaviour

- `Conversation` calls `markReceipt(messageId, 'delivered')` as soon as
  another user's message is rendered, and `markReceipt(messageId, 'read')`
  on each new batch arrival **and** on conversation focus.
- Dedupe: an in-memory `Set` per session prevents re-emitting the same
  `(messageId, status)` pair. Already-`read` messages aren't re-marked
  `delivered`.
- Batch: receipt writes are fired through a 300 ms debounce so a fast
  scroll doesn't blast the callable.

### Mobile UI

- **`MessageBubble`** gains a tick indicator for the caller's *own*
  messages in direct chats: `✓` (sent) / `✓✓` (delivered) / `✓✓` blue
  (read). For groups it shows a compact count (`✓ N` delivered / `👁 N`
  read) tappable to `MessageInfo`.
- **`MessageInfo`** Phase-7 pass: senders see a tabbed per-recipient
  list (All / Delivered / Read / Pending / Failed) with avatar initials,
  role badge (for groups), and per-row timestamps. Non-senders see a
  small "You can only view detailed delivery for messages you sent."
  permission notice + the aggregate counts.

### i18n

New `receipts.*` namespace in `en.json` + `ar.json`.

### Indexes

No new composite indexes. The `MessageInfo` callable reads receipts via
`messageRef.collection('receipts').get()` — no composite needed. Single-
field `status` index is automatic.

### Deferred

- **Daily receipt reconciliation function.** Code can be added but
  scheduling is risky pre-emulator-tests. Phase 20.
- **Group-admin aggregate visibility.** The current rules only grant
  receipt access to the sender. Admins seeing aggregate read-rate without
  per-recipient detail is a clean Phase 18 feature.
- **Played indicator UI** for voice notes — no voice notes yet, so the
  `playedCount` is wired through aggregation but doesn't have a UI
  surface.

---

## Files expected to change

**Create**
- `docs/OFFLINESMS_PHASE_7_PLAN.md`
- `functions/src/chats/markReceipt.ts`
- `functions/src/chats/onReceiptWrite.ts`
- `functions/src/statuses/markStatusViewed.ts`

**Edit**
- `firestore.rules`
- `functions/src/index.ts`
- `functions/src/chats/getMessageInfo.ts` — receipt list for sender
- `apps/mobile/src/lib/conversations.ts` — `markReceipt`, `markStatusViewed`, types
- `apps/mobile/src/components/MessageBubble.tsx` — tick / count indicators
- `apps/mobile/src/screens/Conversation.tsx` — outbound receipt writes
- `apps/mobile/src/screens/MessageInfo.tsx` — per-recipient list
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_{DATA_MODEL,PHASE_LOG,TECHNICAL_ARCHITECTURE,RISK_REGISTER,DESIGN_IMPLEMENTATION_MAP}.md`

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Receipt writes flood the function on long scrolls | High | Medium | 300 ms client debounce + in-memory dedupe; receipt writes are merge-only with no-downgrade so retries are safe. |
| Tightened receipt-read rule breaks legacy code paths | Low | Medium | Phase 4 / 5 / 6 code never reads receipts directly from the client — only the new `getMessageInfo` callable does, and it uses Admin SDK. |
| `onReceiptWrite` recomputes counts on every write — expensive for big groups | Medium | Medium | Member cap is 256 (Phase 5), so the worst case is a 256-doc read once per receipt event. Acceptable; Phase 20 can swap to incremental counters if cost spikes. |
| `markReceipt` downgrades a `read` to `delivered` | Low | Low | Server-side `isMonotonic` check; downgrade attempts are silently no-op'd. |
| Status-view rules let any signed-in viewer record a view of any status | Low | High | `markStatusViewed` re-runs Phase 3's audience check server-side. Client-direct writes denied at rules level. |

---

## Rollback plan

- Every commit scoped — receipt rules, callables, trigger, mobile UI
  revert independently.
- The receipt-read rule tightening is the highest-risk single change;
  reverting it restores Phase 4 read behaviour.
- `markReceipt` rewrites are no-ops on downgrade; un-deploying the
  trigger leaves stale aggregate counts but no data corruption.

---

## Test plan

No automated harness yet (Phase 20). Manual emulator checklist mirrors
the spec's checklist.

`npm run typecheck` / `lint` / `build` must stay green.

---

## Acceptance criteria

1. Plan committed.
2. Receipt schema + aggregate counts in the data model doc.
3. `markReceipt` callable with monotonic transition guard.
4. `onReceiptWrite` trigger maintains aggregate counts.
5. `getMessageInfo` returns the per-recipient list to senders only.
6. `markStatusViewed` callable; rules pin status-view writes to
   server-only and reads to owner/self.
7. `MessageBubble` renders sent/delivered/read indicators for own
   messages (direct) and compact counts (group).
8. `MessageInfo` shows the tabbed sender view; non-senders get a
   permission notice + counts.
9. Client dedupe + 300 ms debounce in place.
10. No third-party SMS provider names.
11. No message body in any audit log (receipts aren't audited at all in
    Phase 7).
12. Phase 1 / 2 / 3 / 4 / 5 / 6 still work.
13. typecheck / lint / build green.
14. Phase log updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 7 implementation plan`
2. `feat(data): add receipt and status-view contracts`
3. `security: add receipt and status-view rules`
4. `feat(functions): add markReceipt and receipt aggregation`
5. `feat(functions): extend message info with receipt details`
6. `feat(functions): add status view tracking foundation`
7. `feat(mobile): render receipt indicators and mark read/delivered`
8. `feat(mobile): add full receipt details to message info`
9. `docs: update phase log for phase 7`
