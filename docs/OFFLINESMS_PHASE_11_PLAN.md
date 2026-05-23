# OfflineSMS Phase 11 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 10 complete (`c3c557a`).

---

## Objective

Complete the OfflineSMS SMS delivery lifecycle after escalation: ingest
provider Delivery Reports via an HMAC-verified webhook, surface a
dedicated `SmsBatchReport` screen, harden the retry-failed path with
cross-batch dedupe, and add a reaper for stuck batches. Drop Phase 0's
legacy `type: 'sms'` transaction row now that the canonical lifecycle
is in place.

No new product features beyond delivery. No media, no calls, no admin
moderation.

---

## Existing inventory

- `functions/src/sms/escalate.ts` — emits the batch + recipient docs;
  Phase 10 also emits a canonical `reservation` transaction.
- `functions/src/sms/onSmsBatchAccepted.ts` — settles wallet on
  `accepted` / `partial` / `completed` and emits canonical
  `reservation_release` / `sms_spend` / `refund` rows **plus** a
  legacy `type: 'sms'` row. Phase 11 drops the legacy row.
- `functions/src/sms/retryFailed.ts` — Phase 8 callable; refactor here
  to enforce cross-batch dedupe + audit.
- `functions/src/sms/gateway.ts` — single isolation point for any real
  SMS provider. Phase 11 doesn't change the interface.
- `smsBatches/{batchId}` and `smsBatches/{b}/recipients/{uid}` —
  existing collections. The spec's `smsEscalationBatches` and our
  `smsBatches` refer to the same documents (documented since Phase 8).
- `smsQuotaUsage`, `flags`, `payments`, `pointsTransfers` etc. all stay
  as-is.

---

## Exact scope

### Legacy transaction-row cleanup

Drop the Phase 0 `db.collection('transactions').add({ type: 'sms', … })`
emission in `onSmsBatchAccepted`. Canonical rows
(`reservation_release`, `sms_spend`, `refund`) already cover the same
information; the Phase 9 mobile lib's `canonicaliseType` handles both,
so removing it is invisible to existing UI.

### Schema additions

```ts
smsDeliveryEvents/{eventId} {
  eventId:             string,           // doc id == eventId
  offlineSmsBatchId:   string,
  offlineSmsMessageId: string | null,
  batchId:             string | null,    // resolved internal batch id
  recipientUid:        string | null,
  status:              'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed',
  receivedAt:          timestamp,
  processedAt:         timestamp | null,
  rawHash:             string,           // SHA-256 of the signed payload
  result:              'processed' | 'duplicate' | 'ignored' | 'failed',
  errorCode:           string | null,
  errorMessage:        string | null,    // sanitised — no body, no PII
}
```

```ts
smsBatches/{batchId}  // extended
  attemptNumber:           number,        // 1 for first escalation, N+1 for retry batches
  acceptedAt:              timestamp | null,
  failedAt:                timestamp | null,
  completedAt:             timestamp | null,
  lastDeliveryReportAt:    timestamp | null,
  queuedCount:             number,
  sentCount:               number,
  deliveredCount:          number,
  failedCount:             number,
  skippedCount:            number,
```

```ts
smsBatches/{b}/recipients/{uid}  // extended
  attemptNumber:           number,
  offlineSmsMessageId:     string | null,
  phoneHash:               string | null,  // SHA-256 of E.164 phone; useful for cross-batch dedupe
  gatewayErrorCode:        string | null,
  gatewayErrorMessage:     string | null,  // sanitised
  deliveryReportEventId:   string | null,
```

### Functions

#### `gatewayWebhook` (HTTP)

`functions/src/sms/gatewayWebhook.ts` — `onRequest` HTTP function.

Headers required:
- `x-offlinesms-timestamp` — unix seconds. Reject if > 5 minutes from now.
- `x-offlinesms-signature` — `sha256=<hex>` over `${timestamp}.${body}` using `OFFLINESMS_WEBHOOK_SECRET`.

Body shape:

```ts
{
  eventId:             string,
  offlineSmsBatchId:   string,
  offlineSmsMessageId: string,
  status:              'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed',
  recipientUid?:       string,
  timestamp?:          string,
  errorCode?:          string,
  errorMessage?:       string,
}
```

Flow:
1. Verify timestamp freshness + HMAC (constant-time).
2. Look up `smsDeliveryEvents/{eventId}` — return 200 + `result: 'duplicate'` if present.
3. Resolve batch via `smsBatches where gatewayBatchId == offlineSmsBatchId limit 1`.
4. Resolve recipient via the batch's `recipients` sub-collection, preferring `offlineSmsMessageId` match, falling back to `recipientUid`.
5. Apply monotonic status transition (`queued < sent < delivered`; `failed` and `undelivered` are terminal but can overwrite non-terminal previous states).
6. Update aggregate counts on the batch in the same transaction.
7. If every recipient is terminal (`delivered` / `failed` / `undelivered` / `skipped`), flip batch status to `completed` (any failures → `partial` if some delivered, `failed` if none delivered).
8. Write `smsDeliveryEvents/{eventId}` with `result: 'processed'`.
9. Return 200.

Phone numbers, message body, and SMS body are **never** logged. Error
messages from the provider are clamped at 200 chars and run through the
audit-log sanitiser before persisting.

#### `retryFailedSmsRecipients` (callable, hardened)

Existing callable from Phase 8. Phase 11 changes:
- Cross-batch dedupe: refuse to enqueue a recipient who already has
  `smsStatus ∈ { 'sent', 'delivered', 'queued' }` on any prior batch
  for the same `messageId`.
- Sets the retry batch's `attemptNumber = previous + 1`.
- Audit: `sms.retry.created` / `sms.retry.failed` (replaces the
  generic `sms.escalation.retry_failed` event).

#### `reapStuckBatches` (scheduled callable)

`functions/src/sms/reapStuckBatches.ts` — `onSchedule` every 30 min.

Flow:
1. Query `smsBatches where status in ['sending', 'accepted'] and createdAt <= now - 15m`.
2. For each, read recipient sub-collection counts.
3. If all recipients terminal → flip to `completed` / `partial` / `failed` per the success ratio.
4. Otherwise mark `failed` + write `reservation_release` + `refund` for
   the unspent portion. **Idempotent**: refuses to act on a batch that
   already has `pointsRefunded != null`.
5. Audit: `sms.batch.reaped`.

Same pattern as Phase 6's `sweepExpiredMessages`: the function is
defined as a scheduled job but **not exported from `functions/src/index.ts`**
so deploying doesn't auto-create the schedule. Operators flip it on by
adding the export when they're ready. Documented in the phase log.

#### Cross-batch dedupe in `escalateSms` / `previewSmsEscalation`

Both Phase 8 callables already call `classifyRecipients`. Extend the
recipient classifier to also accept a `prevRecipientUids` set built
from `smsBatches where messageId == X and senderId == auth.uid` whose
recipient sub-collection contains an entry with `smsStatus ∈ {
'queued', 'sent', 'delivered' }`. Excluded recipients get
`skipReason: 'already-sent-for-message'`.

### Rules

- New: `smsDeliveryEvents/{eventId}` — admin-read, server-only write
  (`allow write: if false`).
- Existing rules for `smsBatches`, `smsBatches/{b}/recipients`,
  `smsQuotaUsage`, `flags`, `transactions`, `wallets` are untouched.

### Indexes

- `smsBatches(senderId, messageId, createdAt DESC)` — used by cross-
  batch dedupe and by the retry path's "what did this user already do
  for this message?" lookup.

The existing `smsBatches(senderId, createdAt DESC)` (Phase 0) stays.

### Mobile UI

- `SmsBatchReport.tsx` (new): subscribes to `smsBatches/{batchId}` and
  its `recipients` sub-collection. Renders summary cards, batch
  metadata, recipient list with filter chips (All / Delivered /
  Pending / Failed / Skipped), and a Retry-failed action.
- `TransactionDetail` — the existing "OfflineSMS Delivery Report" link
  for `sms_spend` rows now routes to `SmsBatchReport` instead of
  re-opening `SmsEscalation`.
- `SmsEscalation` — its result step gains a "View OfflineSMS Delivery
  Report" button that pushes `SmsBatchReport`.
- `MessageInfo` — when an `sms_spend` (or `reservation`) transaction
  exists for the message, render a small "OfflineSMS reminders" card
  linking to the latest batch's report. This is a `where` query on
  `smsBatches(senderId, messageId, createdAt DESC) limit 1`.
- `App.tsx` registers `SmsBatchReport` in the root stack.

### i18n

`sms.report.*` keys in both `en.json` and `ar.json`.

### Audit

- `sms.batch.reaped` (new)
- `sms.retry.created`, `sms.retry.failed` (renamed from
  `sms.escalation.retry_failed` — keep both keys live for one phase
  for the audit-log explorer)
- `sms.delivery.received` — once per processed delivery event;
  `metadata: { batchId, recipientUid, status, eventId }`.

Nothing in any audit row contains an SMS body, message body, or
unmasked phone.

---

## Files expected to change

**Create**
- `docs/OFFLINESMS_PHASE_11_PLAN.md`
- `functions/src/sms/gatewayWebhook.ts`
- `functions/src/sms/reapStuckBatches.ts`
- `apps/mobile/src/screens/SmsBatchReport.tsx`

**Edit**
- `functions/src/sms/onSmsBatchAccepted.ts` — drop legacy `type: 'sms'`.
- `functions/src/sms/escalate.ts` and `functions/src/sms/recipients.ts`
  — add `already-sent-for-message` dedupe.
- `functions/src/sms/retryFailed.ts` — cross-batch dedupe, audit,
  attemptNumber stamp.
- `functions/src/sms/previewEscalation.ts` — pass-through to the
  updated classifier so the UI sees dedupe in the preview too.
- `functions/src/index.ts` — export `gatewayWebhook`.
- `apps/mobile/src/screens/{TransactionDetail,SmsEscalation,MessageInfo,Points}.tsx`
- `apps/mobile/App.tsx`
- `apps/mobile/src/i18n/{en,ar}.json`
- `firestore.rules` — add `smsDeliveryEvents` rules.
- `firestore.indexes.json` — `smsBatches(senderId, messageId, createdAt)`.
- Docs: data model, phase log, architecture, risk register, design map.

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Webhook signature bypass | Low | Critical | Constant-time `timingSafeEqual` of `sha256(timestamp.body, secret)` against the supplied header. Timestamp must be within 5 minutes. |
| Duplicate webhook event double-counts | Medium | High | `smsDeliveryEvents/{eventId}` is the dedupe table; the doc id IS the event id. A duplicate request finds the doc and returns 200 without touching anything. |
| Stale "queued" event overwrites "delivered" | Medium | Medium | Server-side monotonic transition: `queued → sent → delivered` only forward. Terminal states (`failed`, `undelivered`) can overwrite non-terminal earlier states. |
| Reaper double-releases a reservation | Low | High | Idempotency guard on `pointsRefunded`; the reaper refuses to act when `pointsRefunded != null`. Same field is set by `onSmsBatchAccepted`. |
| Cross-batch dedupe runs an N+1 read on every escalation | Medium | Low | One single composite query per escalation. Cap of 256 recipients × ≤ 20 batches per message kept by the daily cap. |
| `phoneHash` exposes phone via hash inversion | Low | Medium | Hash is salted with a per-batch random suffix or omitted in Phase 11 — Phase 11 only stores it on the recipient doc, which is already server-only read for outsiders. |
| Webhook accepts payloads larger than expected | Low | Low | Express body parser cap at 32 KB. Anything bigger is rejected. |

---

## Rollback plan

- Each commit is scoped. Reverting `gatewayWebhook` removes the HTTP
  function from the deploy manifest cleanly.
- The legacy-row drop is a single-commit revert.
- The reaper is shipped as code only; no production schedule is
  registered until an operator adds the export.

---

## Test plan

`npm run typecheck` / `lint` / `build` must stay green.

Manual emulator checklist mirrors the spec's.

---

## Acceptance criteria

Per the spec's 39-point list. Highlights:

1. Plan committed.
2. Legacy `type: 'sms'` row removed; canonical rows still emitted.
3. `smsDeliveryEvents` schema + server-only rule.
4. `gatewayWebhook` ships with HMAC + idempotency + monotonic
   transitions.
5. `retryFailedSmsRecipients` enforces cross-batch dedupe and audits.
6. Reaper code exists; deferred from production schedule.
7. `SmsBatchReport.tsx` ships; deep-linked from `TransactionDetail`,
   `SmsEscalation`, and `MessageInfo`.
8. No third-party provider names anywhere. Phone numbers stay masked.
9. typecheck / lint / build green.
10. Phases 1–10 still work.
11. Phase log updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 11 implementation plan`
2. `feat(data): formalize SMS delivery event and report contracts`
3. `security: lock delivery event and SMS report writes`
4. `feat(functions): drop legacy SMS transaction row`
5. `feat(functions): add OfflineSMS delivery webhook ingestion`
6. `feat(functions): add cross-batch dedupe and hardened retry`
7. `feat(functions): add stuck SMS batch reaper`
8. `feat(mobile): add SMS batch report screen`
9. `feat(mobile): link delivery reports from transactions, escalation, info`
10. `docs: update phase log for phase 11`
