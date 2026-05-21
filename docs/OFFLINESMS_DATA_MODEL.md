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
