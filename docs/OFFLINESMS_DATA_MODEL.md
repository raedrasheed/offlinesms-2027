# OfflineSMS — Firestore data model (Phase 3 contracts)

Single source of truth for the new collections introduced in Phase 3.
**Schema only** — no UI mounts these yet. Rules in `firestore.rules` enforce
every read/write boundary stated here.

Cross-reference: `docs/DATA_MODEL.md` still holds the original Phase 0
collections (`users`, `conversations`, `messages`, `receipts`, `wallets`,
`transactions`, `smsBatches`, `statuses`, `settings`). Phase 3 extends that
catalogue.

Conventions:

- Document IDs are deterministic where it removes the need for a composite
  index (`gatewayHealth/{yyyymmdd}`, `smsQuotaUsage/{uid}/{yyyymmdd}`).
- All timestamps use `serverTimestamp()` from `firebase-admin`.
- Server-only writes always go through a Cloud Function using the Admin SDK
  (which bypasses Firestore rules). Direct client writes to those paths are
  blocked at the rules layer.

---

## organizations/{organizationId}

```ts
{
  name:        string,
  slug:        string,                      // unique, lowercase
  status:      'active' | 'suspended' | 'disabled',
  ownerUid:    string,
  createdAt:   serverTimestamp,
  updatedAt:   serverTimestamp,
  settings: {
    smsEscalationEnabled: boolean,
    pointsEnabled:        boolean,
    defaultLanguage:      'en' | 'ar' | string,
    timezone:             string,           // IANA, e.g. 'Europe/London'
  },
}
```

**Rules.**

- Read: admin (Phase 3). Once a membership sub-collection is wired, members
  of the org can read.
- Write: admin via callable / Admin SDK only.

**Sub-collection (placeholder schema, not enforced yet):**

```ts
organizations/{organizationId}/members/{uid} = {
  role:     'owner' | 'admin' | 'member',
  joinedAt: serverTimestamp,
}
```

Membership rules ship when the first admin org-management screen is built
(Phase 13).

---

## roles/{roleId}

```ts
{
  name:        string,                      // 'super_admin', 'support_agent', ...
  scope:       'system' | 'organization' | 'group',
  permissions: { [action: string]: boolean },
  createdAt:   serverTimestamp,
  updatedAt:   serverTimestamp,
}
```

**Rules.** Admin read/write only. Custom claims are written by callables —
`roles` is a catalogue, not the source of truth for live permission
checks (those use `request.auth.token.role` / `roles`).

---

## auditLogs/{auditLogId}

```ts
{
  action:       string,                     // dotted namespace, e.g. 'auth.username.claimed'
  actorUid:     string,
  actorEmail?:  string | null,              // masked when source isn't a known admin
  targetType?:  string | null,              // 'user', 'organization', 'payment', ...
  targetId?:    string | null,
  result:       'success' | 'failure',
  metadata?:    { [k: string]: unknown },   // sanitised — no secrets, OTPs, phones
  createdAt:    serverTimestamp,
}
```

**Rules.**

- Read: admin only.
- Write: **server only.** Clients (including admins via the web SDK) cannot
  write here directly. Writes always go through `functions/src/lib/auditLog.ts`.

**What never goes in `metadata`:** OTP codes, raw phone numbers (use
`redactPhone()`), private message text, points balances, service-account
keys, anything from `customClaims` other than `role`.

---

## tickets/{ticketId}

```ts
{
  createdBy:   string,                      // uid of the requester
  assignedTo?: string | null,               // uid of an admin / support agent
  status:      'open' | 'pending' | 'resolved' | 'closed',
  category:    string,                      // 'billing', 'abuse', 'feature', ...
  subject:     string,                      // <= 200 chars
  createdAt:   serverTimestamp,
  updatedAt:   serverTimestamp,
}
```

Optional future sub-collection: `tickets/{id}/messages/{n}` with
`{ authorUid, body, createdAt }`. Not enforced in Phase 3.

**Rules.**

- Create: signed-in user, only with `createdBy == self`, status pinned to
  `'open'`, no `assignedTo`.
- Read: requester (`createdBy == self`) or admin.
- Update / delete: admin only (status transitions, assignment).

---

## flags/{flagId}

```ts
{
  createdBy:   string,                      // uid of the reporter
  targetType:  'user' | 'conversation' | 'message' | 'status' | 'organization',
  targetId:    string,
  reason:      string,                      // <= 500 chars
  status:      'open' | 'reviewed' | 'dismissed' | 'actioned',
  createdAt:   serverTimestamp,
  updatedAt:   serverTimestamp,
}
```

**Rules.**

- Create: signed-in user with `createdBy == self`, status `'open'`.
- Read: admin only (so reporters can't enumerate other reporters' flags).
- Update / delete: admin only.

---

## payments/{paymentId}

```ts
{
  userId:        string,
  amount:        number,                    // smallest currency unit
  currency:      string,                    // ISO 4217, e.g. 'EUR'
  status:        'pending' | 'completed' | 'failed' | 'refunded',
  pointsAmount?: number | null,             // populated on completion
  provider?:     string | null,             // free-form; never references a
                                            //   real SMS provider name
  externalId?:   string | null,             // provider's reference (no PII)
  createdAt:     serverTimestamp,
  updatedAt:     serverTimestamp,
}
```

**Rules.**

- Read: requester (`userId == self`) or admin.
- Write: **server only.** Even admin-side writes must go through the
  payment webhook / callable (Phase 10) so idempotency is centralised.

Clients **cannot** mark a payment `completed` — that's the entire reason
this collection exists separately from `transactions`.

---

## gatewayHealth/{yyyymmdd}

```ts
{
  status:                'active' | 'degraded' | 'maintenance' | 'disabled',
  queueSize:             number,
  lastSuccessfulSendAt?: serverTimestamp | null,
  errorRate:             number,            // 0..1
  successCount?:         number,
  failureCount?:         number,
  p95LatencyMs?:         number | null,
  updatedAt:             serverTimestamp,
}
```

Deterministic doc ID = UTC `yyyymmdd`. Scheduled rollup function in
Phase 16 maintains this.

**Rules.** Admin read; server-only write.

---

## smsQuotaUsage/{uid}/{yyyymmdd}

> Actual path: `smsQuotaUsage/{uid}/days/{yyyymmdd}` (a sub-collection under
> per-user roots so listing-by-user is cheap without an index).

```ts
{
  scopeType:    'user' | 'group' | 'organization',
  scopeId:      string,                    // == uid for the user scope
  date:         string,                    // 'yyyy-mm-dd' for readability
  smsCount:     number,
  pointsSpent:  number,
  updatedAt:    serverTimestamp,
}
```

**Rules.** Requester reads own (`uid` segment in path matches
`request.auth.uid`); admin reads anyone. Server-only writes.

---

## Status audience model (Phase 3 hardening of existing `statuses/`)

Existing `statuses/{statusId}` documents gain the following fields. The
mobile status feature is still a placeholder, so existing data has none
of these — the new rules default to the safest interpretation.

```ts
{
  // existing
  authorId:        string,
  type:            'text' | 'image' | 'video',
  body?:           string,
  mediaUrl?:       string,
  backgroundColor?:string,

  // new (Phase 3)
  audienceType:        'all_contacts'      // legacy default — all authed
                     | 'contacts_except'
                     | 'only_share_with',
  allowedViewerUids?:  string[],           // for 'only_share_with'
  excludedViewerUids?: string[],           // for 'contacts_except'

  expiresAt:           serverTimestamp,    // hard cap, enforced server-side
  createdAt:           serverTimestamp,
}
```

**Rules.**

- Author can always read, update, delete their own.
- Other readers must pass `isStatusAudienceMember(resource.data)` AND
  `!isStatusExpired(resource.data)`.
- Default for documents that lack `audienceType` is
  `'all_contacts'` (= every authed reader) but **expired** statuses are
  blocked regardless.

**Limitation.** Contacts graph isn't stored anywhere yet. "All contacts"
is therefore approximated by "any signed-in user not in
`excludedViewerUids`". When a real contacts model lands, the rule
becomes `request.auth.uid in resource.data.contactsOfAuthor`. Documented
in Phase 13.

---

## Receipt enum (existing `conversations/{c}/messages/{m}/receipts/{uid}`)

The receipts sub-collection adds a server-validated enum.

```ts
status: 'pending' | 'delivered' | 'read' | 'viewed' | 'played' | 'failed'
```

Rules now reject writes whose `status` isn't in that set. Phase 7 wires
the client to mark `delivered` / `read` / `played` / `viewed`.

---

---

## Phase 4 — Direct conversations

### `conversations/{conversationId}` (extended)

```ts
{
  // canonical Phase 4 fields
  type:            'direct' | 'group' | 'channel',
  participantUids: string[],                // canonical; direct = exactly 2
  participantKey:  string,                  // sorted-uid join, e.g. 'A_B' (direct only)
  createdBy:       string,                  // uid that opened the conversation
  status:          'active' | 'archived' | 'disabled',
  createdAt:       serverTimestamp,
  updatedAt:       serverTimestamp,
  lastMessage: {
    messageId: string,
    senderUid: string,
    type:      'text',
    preview:   string,                      // <= 80 chars, sanitised
    createdAt: serverTimestamp,
  } | null,

  // back-compat aliases written alongside the new fields so the existing
  // receipt-fanout trigger, dashboard list page, and seed data keep working.
  memberIds:       string[],                // == participantUids
  lastMessageText: string,
  lastMessageAt:   serverTimestamp,
  lastSenderId:    string,
}
```

### `conversations/{c}/messages/{messageId}` (extended)

```ts
{
  conversationId:     string,
  senderUid:          string,               // canonical Phase 4
  senderId:           string,               // back-compat alias of senderUid
  type:               'text',               // Phase 4 only
  text:               string,               // 1..4000 chars after trim
  createdAt:          serverTimestamp,
  updatedAt:          serverTimestamp,
  status:             'sent',               // 'sending'|'delivered'|'read'|'failed' come later
  deletedForEveryone: false,
  editedAt:           null,
  replyTo:            null,
}
```

### `conversations/{c}/userState/{uid}` (new)

```ts
{
  uid:                string,
  pinned:             boolean,
  muted:              boolean,
  archived:           boolean,
  favorite:           boolean,
  lastReadAt:         serverTimestamp,
  unreadCount:        number,               // server-owned
  lastMessagePreview: string,               // server-owned, <= 80 chars
  lastMessageAt:      serverTimestamp,      // server-owned
  updatedAt:          serverTimestamp,
}
```

**Rules.** Clients can only touch `{ pinned, muted, archived, favorite, updatedAt }` on their own `userState`. `unreadCount`, `lastMessagePreview`, `lastMessageAt`, and `lastReadAt` are server-owned (callable / trigger).

### `conversations/{c}/typing/{uid}` (new)

```ts
{
  uid:       string,
  isTyping:  boolean,
  updatedAt: serverTimestamp,
  expiresAt: timestamp,                     // now + 3000ms
}
```

**Rules.** Owner-write, participant-read. No content stored.

---

## Phase 11 — SMS delivery reports, retry, reaper

### `smsDeliveryEvents/{eventId}` (new)

```ts
{
  eventId:             string,           // == doc id
  offlineSmsBatchId:   string,           // provider batch reference
  offlineSmsMessageId: string | null,    // provider per-recipient reference
  batchId:             string | null,    // resolved internal smsBatches/{batchId}
  recipientUid:        string | null,    // resolved recipient
  status:              'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed',
  receivedAt:          timestamp,
  processedAt:         timestamp | null,
  rawHash:             string,           // SHA-256 of the signed payload
  result:              'processed' | 'duplicate' | 'ignored' | 'failed',
  errorCode:           string | null,
  errorMessage:        string | null,    // sanitised
}
```

**Rules.** Admin read; `allow write: if false`. Only the
`gatewayWebhook` HTTP function (Admin SDK) writes.

### `smsBatches/{batchId}` and recipients (extended in Phase 11)

Adds (batch): `attemptNumber`, `acceptedAt`, `failedAt`, `completedAt`,
`lastDeliveryReportAt`, `queuedCount`, `sentCount`, `deliveredCount`,
`failedCount`, `skippedCount`.

Adds (recipient): `attemptNumber`, `offlineSmsMessageId`, `phoneHash`
(server-only, not surfaced to clients), `gatewayErrorCode`,
`gatewayErrorMessage` (sanitised, ≤200 chars), `deliveryReportEventId`.

### Delivery webhook signature

`POST https://…/gatewayWebhook` requires:

- `x-offlinesms-timestamp: <unix seconds>` (within 5 min of server clock).
- `x-offlinesms-signature: sha256=<hex>` over `${timestamp}.${rawBody}` using `OFFLINESMS_WEBHOOK_SECRET`.

### Monotonic status transition

```
queued  →  sent  →  delivered                 (forward only)
queued / sent →  failed / undelivered          (terminal; can overwrite non-terminal)
delivered / failed / undelivered are terminal  (later events ignored)
```

### Cross-batch dedupe

Recipients whose status is `queued`, `sent`, or `delivered` on any
prior batch for the same `(messageId, senderId)` pair are excluded
from new escalations with `skipReason: 'already-sent-for-message'`.

### Reaper

`reapStuckBatches` is a scheduled callable (defined as code; opt-in
export). Flags `sending` / `accepted` batches older than 15 minutes,
releases the reservation, and emits canonical `reservation_release` +
`refund` rows. Idempotent on `pointsRefunded`.

### Canonical SMS transaction lifecycle (Phase 11 final)

Phase 0's `type: 'sms'` row is **dropped**. The full set is:

```
reservation              (debit,  emitted by escalateSms)
reservation_release      (credit, emitted by onSmsBatchAccepted / reaper)
sms_spend                (debit,  emitted by onSmsBatchAccepted)
refund                   (credit, emitted by onSmsBatchAccepted / reaper)
```

### New composite index

| Collection | Fields | Used by |
|---|---|---|
| `smsBatches` | `(senderId ASC, messageId ASC, createdAt DESC)` | cross-batch dedupe + retry's "prior batches for this message" lookup |

---

## Phase 10 — Points purchase, transfer, lifecycle

### `pointsPackages/{packageId}` (new)

```ts
{
  name:        string,
  points:      number,
  bonusPoints: number,
  price:       number,           // smallest currency unit (e.g. cents)
  currency:    string,           // ISO 4217 (e.g. 'EUR')
  status:      'active' | 'disabled',
  sortOrder:   number,
  createdAt:   timestamp,
  updatedAt:   timestamp,
}
```

**Rules.** Any signed-in user may read. Writes admin-only.

### `payments/{paymentId}` (extended; rules already locked Phase 3)

```ts
{
  userId:           string,
  packageId:        string,
  points:           number,
  bonusPoints:      number,
  totalPoints:      number,
  amount:           number,
  currency:         string,
  status:           'pending' | 'processing' | 'completed' | 'failed'
                  | 'cancelled' | 'refunded',
  idempotencyKey:   string,
  checkoutUrl:      string | null,
  providerReference: string | null,
  createdAt:        timestamp,
  updatedAt:        timestamp,
  completedAt:      timestamp | null,
  failureReason:    string | null,
}
```

**Rules.** Owner-read. Writes server-only (Phase 3). `confirmPayment`
and `confirmPaymentMock` are the only paths that flip the status.

### `pointsTransfers/{transferId}` (new)

```ts
{
  fromUserId:     string,
  toUserId:       string,
  amount:         number,
  fee:            number,        // always 0 in Phase 10
  status:         'pending' | 'completed' | 'failed' | 'reversed',
  idempotencyKey: string,
  flagged:        boolean,
  createdAt:      timestamp,
  completedAt:    timestamp | null,
  failureReason:  string | null,
}
```

**Rules.** Sender (`fromUserId == auth.uid`) or recipient
(`toUserId == auth.uid`) may read their own; writes server-only.

### `transferQuotaUsage/{uid}/days/{yyyymmdd}` (new)

```ts
{
  uid:                string,
  date:               string,          // 'yyyy-mm-dd'
  transferCount:      number,
  pointsTransferred:  number,
  updatedAt:          timestamp,
}
```

**Rules.** Owner-read; writes server-only. Mirrors the Phase 3
`smsQuotaUsage` shape.

### `wallets/{uid}` (extended)

```ts
{
  // Phase 0+9
  balance:   number,
  reserved:  number,
  createdAt: timestamp,
  updatedAt: timestamp,
  // Phase 10
  status?:   'active' | 'frozen' | 'closed',   // defaults to 'active'
}
```

Default = `'active'`. `transferPoints` refuses on `'frozen'` /
`'closed'`. Phase 10 doesn't ship a freeze callable; admin freeze is a
Phase 15 deliverable.

### `transactions/{transactionId}` (canonical Phase 10)

Backend writers now emit:

| Canonical | Emitter |
|---|---|
| `purchase` | `confirmPayment(Mock)` (on `'completed'`) |
| `transfer_in` / `transfer_out` | `transferPoints` |
| `reservation` | `escalateSms` (at reservation time) |
| `reservation_release` | `onSmsBatchAccepted` (settlement) |
| `sms_spend` | `onSmsBatchAccepted` (per-recipient cost) |
| `refund` | `onSmsBatchAccepted` (when actual cost < reserved) |
| `admin_adjustment` | reserved for Phase 15 |

Each row carries:

```ts
{
  userId:              string,
  type:                CanonicalType,
  direction:           'credit' | 'debit',
  amount:              number,            // absolute, ≥ 0
  status:              'pending' | 'completed' | 'failed' | 'reversed' | 'refunded',
  relatedPaymentId?:   string | null,
  relatedTransferId?:  string | null,
  relatedSmsBatchId?:  string | null,
  relatedUserId?:      string | null,
  relatedMessageId?:   string | null,
  relatedConversationId?: string | null,
  note?:               string | null,
  createdAt:           timestamp,
  completedAt?:        timestamp,
}
```

Legacy Phase 0 emitters (`'sms'`, `'buy'`, `'transfer-in/out'`,
`'refund'`) are migrated one phase at a time. `onSmsBatchAccepted`
emits **both** the legacy `'sms'` row and the canonical
`reservation_release` + `sms_spend` (+ `refund`) rows for one phase so
older clients keep parsing; Phase 11 will drop the legacy row.

### Caps and policy

```
DAILY_TRANSFER_CAP_COUNT     = 20
DAILY_TRANSFER_CAP_POINTS    = 5000
FRAUD_FLAG_THRESHOLD_POINTS  = 2000
```

### Indexes

| Collection | Fields | Used by |
|---|---|---|
| `pointsTransfers` | `(fromUserId, createdAt DESC)` | sender history |
| `pointsTransfers` | `(toUserId, createdAt DESC)` | recipient history |

`payments(userId, createdAt DESC)` already exists from Phase 3.
`pointsPackages` is served by automatic single-field indexes.

---

## Phase 9 — Wallet and transaction read models

### `wallets/{uid}` (read formalised)

```ts
{
  balance:   number,            // server-owned
  reserved:  number,            // server-owned (in-flight SMS holds)
  createdAt: timestamp,
  updatedAt?: timestamp,
}
```

UI computes `available = balance - reserved` client-side. Phase 0 +
Phase 3 rules: read by self or admin, write by admin only (callables /
trigger use Admin SDK). Phase 9 makes no rule change here.

### `transactions/{transactionId}` (read formalised)

```ts
{
  userId:                 string,
  type:                   string,   // see canonical/legacy mapping below
  amount:                 number,   // positive integer; direction implied by type
  direction?:             'credit' | 'debit',
  status?:                'pending' | 'completed' | 'failed' | 'reversed' | 'refunded',
  package?:               string | null,
  batchId?:               string | null,       // == relatedSmsBatchId
  peerId?:                string | null,       // == relatedUserId
  relatedMessageId?:      string | null,
  relatedConversationId?: string | null,
  note?:                  string | null,
  refund?:                number,
  sent?:                  number,
  failed?:                number,
  priceCents?:            number,
  createdAt:              timestamp,
  completedAt?:           timestamp | null,
}
```

Phase 0 writers stay; Phase 9 only reads. The UI maps legacy type
strings to canonical names at the boundary:

| Canonical | Legacy in code | UI label |
|---|---|---|
| `sms_spend` | `'sms'` | SMS spending |
| `reservation` | — | Reservation |
| `reservation_release` | — | Reservation released |
| `refund` | `'refund'` | Refund |
| `purchase` | `'buy'` | Purchase |
| `transfer_in` | `'transfer-in'` | Transfer in |
| `transfer_out` | `'transfer-out'` | Transfer out |
| `admin_adjustment` | `'admin-adjust'` | Admin adjustment |

### Indexes added

| Collection | Fields | Used by |
|---|---|---|
| `transactions` | `(userId ASC, type ASC, createdAt DESC)` | Phase 9 history filter chips |

The existing `transactions(userId, createdAt DESC)` (Phase 0) covers
the unfiltered list.

### `users/{uid}.smsOptOut` (Phase 9 allow-list addition)

```ts
{
  smsOptOut?: boolean,   // owner-write, allow-listed in firestore.rules
}
```

Already consumed by `escalateSms` (Phase 8) — when `true` the recipient
is excluded with `skipReason: 'opt-out'`. Phase 9 adds the
client-write path through the Settings toggle by extending the
`users.update` allow-list.

---

## Phase 8 — OfflineSMS escalation

### `smsBatches/{batchId}` (extended in place — same collection as Phase 0)

Phase 0 created the collection; Phase 8 fills out the schema and keeps
the original name. The data model spec's `smsEscalationBatches` and our
`smsBatches` refer to the same documents.

```ts
{
  // Phase 0
  messageId:           string,
  conversationId:      string,
  senderId:            string,                  // alias of senderUid
  audience:            'unread' | 'undelivered' | 'everyone'
                     | 'unread_only' | 'undelivered_only',
  smsBody:             string,                  // never logged
  recipientCount:      number,
  estimatedCost:       number,
  status:              'sending' | 'accepted' | 'partial' | 'completed' | 'failed',
  createdAt:           timestamp,
  gatewayBatchId:      string | null,           // surfaced as 'OfflineSMS batch ID'

  // Phase 8 additions
  audienceCanonical:   'everyone' | 'unread_only' | 'undelivered_only',
  eligibleCount:       number,
  excludedCount:       number,
  pointsCost:          number,                  // == estimatedCost
  pointsReserved:      number,
  pointsDeducted:      number | null,           // set by onSmsBatchAccepted
  pointsRefunded:      number | null,
  offlineSmsBatchId:   string | null,           // == gatewayBatchId
  retryOfBatchId:      string | null,
  updatedAt:           timestamp,
}
```

### `smsBatches/{b}/recipients/{uid}` (extended)

```ts
{
  // Phase 0
  userId:              string,                  // == uid (doc id)
  maskedPhone:         string,                  // e.g. '+970 *** *** 123'
  smsStatus:           'queued' | 'delivered' | 'failed' | 'undelivered' | 'sent' | 'skipped',
  reason:              string | null,
  updatedAt:           timestamp,

  // Phase 8 additions
  appReceiptStatus:    'pending' | 'delivered' | 'read' | 'viewed' | 'played' | 'failed' | null,
  skipReason:          'no-phone' | 'unverified-phone' | 'opt-out'
                     | 'duplicate-phone' | 'already-sent-for-message'
                     | 'rate-limited' | 'policy-blocked'
                     | null,
}
```

### `smsQuotaUsage/{uid}/days/{yyyymmdd}` (writer added in Phase 8)

Schema and rules from Phase 3 are unchanged; Phase 8 wires the writer.

```ts
{
  uid:              string,                     // matches parent path
  date:             string,                     // 'yyyy-mm-dd'
  batchCount:       number,
  recipientCount:   number,
  pointsSpent:      number,
  updatedAt:        timestamp,
}
```

### Caps

- `MAX_BATCHES_PER_DAY = 20` per uid.
- `MAX_RECIPIENTS_PER_BATCH = 200`.
- `COOLDOWN_MS = 60 * 1000` — refuses another escalation for the same
  `(messageId, senderUid)` pair within 60 s. `retryFailedSmsRecipients`
  bypasses the cooldown (it creates a `retryOfBatchId`-linked batch).

### Cost model

- `COST_PER_SMS = 28` points (Phase 0 default).
- `pointsCost = eligibleCount * COST_PER_SMS`.
- Refund settled by `onSmsBatchAccepted` based on per-recipient delivery
  outcomes (Phase 0 already wires this).

---

## Phase 7 — Receipts, message views, status views

### `conversations/{c}/messages/{m}/receipts/{uid}` (extended)

```ts
{
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

- Doc id is **always the recipient uid** — pinned by the path matcher.
- Status enum is Phase 3's; transitions are server-enforced monotonic
  (`pending → delivered → read/viewed/played`, with `failed` reachable
  from anywhere).
- Read rule (Phase 7): only the receipt owner, the message sender, or
  an admin can read. (Phase 4's "any participant" read is closed.)
- Write rule: owner only at the rules layer; every legitimate write
  goes through `markReceipt` (Admin SDK).

### `messages/{messageId}` — aggregate counts (server-owned)

```ts
{
  deliveredCount:   number,
  readCount:        number,
  viewedCount:      number,
  playedCount:      number,
  failedCount:      number,
  pendingCount:     number,
  receiptUpdatedAt: timestamp,
}
```

Maintained by `onReceiptWrite`. Clients cannot write (the Phase 6
`messages.update` admin-only rule stays in force).

### `statuses/{statusId}/views/{viewerUid}` (new)

```ts
{
  statusId:  string,
  ownerUid:  string,
  viewerUid: string,
  viewedAt:  timestamp,
}
```

- Doc id = viewer's uid → no duplicate-view growth.
- Read: status owner (sees viewer list) OR the viewer (their own row).
- Write: server-only via `markStatusViewed`. The callable re-runs
  Phase 3's audience rules (`isStatusAudienceMember`,
  `!isStatusExpired`) before recording.

### "Viewed" vs separate views collection

Phase 7 folds "viewed" into the receipts enum for text messages
(`read` and `viewed` are interchangeable). A dedicated
`messages/{m}/views/{uid}` sub-collection is reserved for media-
specific events (e.g. fullscreen-open) when media support lands.

---

## Phase 6 — Message actions and Message Info

Existing `messages/{id}` placeholders (`editedAt`, `deletedForEveryone`, `replyTo`) become real fields, plus new ones:

```ts
messages/{messageId} {
  // existing Phase 4/5 …
  editedAt:           timestamp | null,
  deletedForEveryone: boolean,
  deletedAt:          timestamp | null,
  deletedBy:          string  | null,
  deleteReason:       string  | null,     // 'expired' for the disappearing-message sweeper

  replyTo: {                              // present when the sender quoted another message
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

  // One emoji per user per message; the callable rewrites the map on each toggle.
  reactions:    { [emoji: string]: string[] } | null,

  pinnedAt:     timestamp | null,
  pinnedBy:     string  | null,

  // Disappearing-message TTL. Sweeper flips matching messages to
  // deletedForEveryone:true with deleteReason:'expired'. No client UI yet.
  expiresAt:    timestamp | null,
}
```

### Per-user message state — lives on `conversations/{c}/userState/{uid}`

Rather than introduce a new collection, Phase 6 piggybacks on the Phase 4 `userState` doc to keep listener cost flat:

```ts
userState/{uid} {
  // existing Phase 4 fields …
  starredMessageIds:      string[],   // capped at 500
  deletedForMeMessageIds: string[],   // capped at 500
}
```

Both arrays are bounded by the `starMessage` and `deleteMessage` callables: FIFO eviction when the cap is hit. Phase 20 will reconsider if the cap proves too tight.

### Conversation-level pin

```ts
conversations/{c} {
  pinnedMessage: {
    messageId:        string,
    senderUid:        string,
    senderDisplayName?: string,
    preview:          string,          // <= 80 chars, sanitised
    pinnedAt:         timestamp,
    pinnedBy:         string,
  } | null,
}
```

Single pinned message per conversation in Phase 6. Multi-pin can land later as a sub-collection.

### Pin policy

- Direct conversations: any participant may pin/unpin.
- Group conversations: owner or admin only.

### Delete-for-everyone policy

- The sender may always delete-for-everyone.
- In groups, owner / admin may additionally delete other members' messages (a `byRole` field on the audit log captures who exercised it).
- The deleted message keeps its `senderUid`, `createdAt`, and audit lineage; `text` is cleared, `deletedForEveryone` flips to `true`.

### Edit window

`EDIT_WINDOW_MS = 15 * 60 * 1000`. After 15 minutes, `editMessage` rejects with `failed-precondition: 'edit-window-closed'`.

### Disappearing-message TTL (foundation only)

- Field `messages.expiresAt` is honoured by a scheduled callable `sweepExpiredMessages` (hourly).
- Code is shipped in `functions/src/chats/sweepExpiredMessages.ts` but **not wired into `firebase.json`** as a scheduled function in Phase 6 — explicit activation is queued for Phase 11.

### Indexes

No new composite indexes in Phase 6. The existing `messages(conversationId, createdAt DESC)` covers all listing reads; the sweeper reads via a `where('expiresAt', '<=', now)` which Firestore can serve with the automatic single-field index.

---

## Phase 5 — Group conversations

`conversations/{id}` gains group-only fields (direct conversations leave them unset):

```ts
{
  // existing Phase 4 fields
  type:        'direct' | 'group' | 'channel',
  status:      'active' | 'archived' | 'disabled' | 'locked',   // Phase 5 adds 'locked'
  ...

  // Phase 5 (group only)
  name:        string,                  // 1..80 chars
  avatarUrl:   string | null,           // upload deferred — null in Phase 5
  ownerUid:    string,                  // single owner, always in participantUids
  memberCount: number,                  // == participantUids.length (server-owned)
  settings: {
    onlyAdminsCanSend:       boolean,   // default false
    onlyAdminsCanEditInfo:   boolean,   // default true
    onlyAdminsCanAddMembers: boolean,   // default false
  },
}
```

### `conversations/{c}/members/{uid}` (canonical Phase 5)

```ts
{
  uid:                 string,
  role:                'owner' | 'admin' | 'member',
  displayNameSnapshot: string,          // captured at add time
  photoURLSnapshot?:   string | null,
  status:              'active' | 'removed' | 'left',
  addedBy:             string,
  joinedAt:            serverTimestamp,
  updatedAt:           serverTimestamp,
}
```

Existing Phase 0/4 `members/{uid}` docs (`{ role }` only) keep working: rules read `role` only, and callables `merge: true` on subsequent updates.

### `conversations/{c}/messages/{messageId}` — group fields

For group messages, `sendTextMessage` adds:

```ts
{
  senderDisplayName: string,            // snapshot at send time
  senderPhotoURL?:   string | null,
}
```

The chat UI uses these to render sender headers without joining `users`. Direct messages omit them.

### Phase 5 indexes

- `conversations (participantUids array-contains, type ASC, updatedAt DESC)` — the "Groups" filter chip without a client-side filter pass.

### Member-count cap

`MAX_GROUP_MEMBERS = 256`. Enforced in `createGroup` and `addMembers`. Rules don't enforce (would cost an extra `get()` per write); Phase 20 will reconsider.

---

### Phase 4 indexes

| Collection | Fields | Used by |
|---|---|---|
| `conversations` | `(participantUids array-contains, updatedAt DESC)` | chat list, default filter |
| `conversations` | `(participantUids array-contains, status ASC, updatedAt DESC)` | "Archived" filter without client-side filtering |
| `conversations` | `(memberIds array-contains, lastMessageAt DESC)` (already in Phase 0) | back-compat for legacy callers / seed |

`messages` is unchanged — the existing `(conversationId, createdAt DESC)` collection-group index covers in-conversation reads.

---

## Phase 17 — Search foundation and new indexes

### `users/{uid}.usernameLower` — prefix search field

The `usernameLower` field (written by `claimUsername` since Phase 2) is the basis for the Phase 17 global admin search. The `/admin/search` route queries:

```ts
usersRef
  .where('usernameLower', '>=', query)
  .where('usernameLower', '<=', query + '')
  .limit(5)
```

This is the standard Firestore prefix-search pattern. Because `usernameLower` is already lowercase-normalised at write time, the search is effectively case-insensitive for username lookups. The equivalent `nameLower` field does not yet exist on `conversations` (groups) — group name search is therefore case-sensitive in Phase 17 and requires a future `nameLower` field to match the username pattern.

### New composite indexes (Phase 17)

| Collection | Fields | Used by |
|---|---|---|
| `users` | `(status ASC, createdAt DESC)` | users list status filter, users export |
| `conversations` | `(type ASC, createdAt DESC)` | groups list, SMS batches list |
| `conversations` | `(type ASC, status ASC, createdAt DESC)` | groups list status filter, groups export |
| `transactions` | `(type ASC, createdAt DESC)` | transactions type filter, transactions export |
| `payments` | `(status ASC, createdAt DESC)` | payments status filter, payments export |

---

## Index plan (mirrors `firestore.indexes.json`)

| Collection | Fields | Used by |
|---|---|---|
| `auditLogs` | `(createdAt DESC)` | admin recent activity |
| `auditLogs` | `(actorUid ASC, createdAt DESC)` | "what did X do" |
| `auditLogs` | `(targetType ASC, targetId ASC, createdAt DESC)` | "what happened to X" |
| `payments` | `(userId ASC, createdAt DESC)` | own payment history |
| `flags` | `(status ASC, createdAt DESC)` | moderation queue |
| `tickets` | `(createdBy ASC, status ASC, updatedAt DESC)` | own tickets list |
| `statuses` | `(authorId ASC, createdAt DESC)` | own statuses |
| `statuses` | `(expiresAt ASC)` | scheduled purge |
