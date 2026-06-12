# OfflineSMS Dashboard — User Manual & API Reference

**Audience:** platform administrators (super admins), organization administrators, and programmers integrating with the Organization Messaging API.
**Scope:** the OfflineSMS admin **Dashboard** and the **Organization Messaging API**. This manual does not cover the mobile app.
**Companion document:** `docs/organization-messaging-api-mvp-report.md` (engineering/verification report).

> **Important — what “send” means today.** The Organization Messaging feature **records** message requests, enforces a monthly quota, and creates auditable logs. It does **not** perform real device delivery yet. A message marked **`queued`** means *accepted for future delivery*, **not** delivered. The statuses `sent`, `delivered`, and `seen` are intentionally not used. See [§9 Message statuses](#9-message-statuses).

---

## Table of contents

1. [Roles & access overview](#1-roles--access-overview)
2. [Signing in](#2-signing-in)
3. [Dashboard layout](#3-dashboard-layout)
4. [Platform admin: create an organization account](#4-platform-admin-create-an-organization-account)
5. [Organization admin: getting started](#5-organization-admin-getting-started)
6. [The Organization Messaging page](#6-the-organization-messaging-page)
7. [Managing the API key](#7-managing-the-api-key)
8. [Sending a message from the dashboard](#8-sending-a-message-from-the-dashboard)
9. [Message statuses](#9-message-statuses)
10. [Usage & quota](#10-usage--quota)
11. [Viewing logs and batch details](#11-viewing-logs-and-batch-details)
12. [API reference (for programmers)](#12-api-reference-for-programmers)
13. [Code examples](#13-code-examples)
14. [Security model](#14-security-model)
15. [Limits & quick reference](#15-limits--quick-reference)
16. [Troubleshooting](#16-troubleshooting)
17. [Known limitations](#17-known-limitations)

---

## 1. Roles & access overview

The dashboard uses a **capability-based** permission system. Each signed-in user has a **role** (stored as a Firebase Auth custom claim), and each role grants a fixed set of capabilities.

| Role | Who it is | Organization Messaging access |
|---|---|---|
| **super_admin** | Platform operator (OfflineSMS staff) | Full. Can create organization accounts, and view/manage messaging for **any** organization. |
| **organization_admin** | A customer organization’s administrator | Scoped. Can view/manage messaging for **their own organization only**. Cannot create organizations or see other organizations’ data. |
| support_agent / finance_admin / auditor | Other internal roles | **No** access to Organization Messaging. |

Two capabilities govern this feature:

- `view:organization_messaging` — see the page, usage, logs.
- `manage:organization_messaging` — generate/revoke API keys, send messages, create organization accounts (super admin only).

**Organization scoping** is enforced on every server action and API call — not just in the UI. An `organization_admin`’s identity carries an `organizationId` claim; the server ignores any organization id supplied by the browser and uses the claim. Super admins have no `organizationId` claim, so they are “unrestricted” and select an organization explicitly.

---

## 2. Signing in

1. Open the dashboard URL (e.g. `https://dash.offlinesms.com`).
2. Enter the **email** and **password** for your account.
   - Super admins use their platform admin credentials.
   - Organization admins use the email/password that the super admin set when creating the organization account (see [§4](#4-platform-admin-create-an-organization-account)).
3. After login you land on the **Overview** page. The left sidebar shows only the sections your role can access.

> Organization admins see a reduced sidebar. The relevant entry for this feature is **Org Messaging**.

---

## 3. Dashboard layout

- **Left sidebar** — grouped navigation. Items appear only if your role has the matching capability.
- **Messaging group → “Org Messaging”** — the Organization Messaging page (`/admin/organization-messaging`).
- **Main panel** — the content for the selected section.

---

## 4. Platform admin: create an organization account

*Super admin only.*

This creates three things at once: the **organization record**, a **login** for that organization’s admin, and the **org‑scoping** on that login.

1. Go to **Org Messaging** in the sidebar.
2. If you have no organization selected, you’ll see an organization picker and a **New organization account** button (top-right). Click it, or navigate to `/admin/organization-messaging/new`.
3. Fill in the form:

   | Field | Rules |
   |---|---|
   | **Organization name** | Required, ≤ 120 characters. |
   | **Admin email** | Required, valid email. Becomes the org admin’s login. Must not already be in use. |
   | **Admin password** | Required, ≥ 8 characters, containing **at least one letter and one number**. |
   | **Monthly message limit** | Required, positive whole number (≤ 1,000,000). The monthly quota. |
   | **Status** | `Active` or `Suspended`. Suspended organizations cannot send. |

4. Click **Create organization account**.

On success the system:
- Creates the Firebase Auth user (the org admin login).
- Creates the organization document with the monthly limit and status.
- Assigns the `organization_admin` role + `organizationId` claim to that login, scoping them to this organization only.
- Writes an audit entry (`organization.account.created`).

> If the organization write fails after the login is created, the login is rolled back automatically — you won’t be left with an orphan account.

You can then share the email/password with the organization’s administrator. They should change the password after first login if your environment supports it.

---

## 5. Organization admin: getting started

As an organization admin:

1. Sign in with the email/password the platform admin gave you.
2. Click **Org Messaging** in the sidebar. You are taken **directly** to your organization’s messaging page — there is no organization picker, and you cannot view any other organization.
3. From here you can: generate an API key, send a message, and view usage and logs.

---

## 6. The Organization Messaging page

Path: `/admin/organization-messaging`

The page has four sections:

1. **Usage summary** — monthly limit, used this month, remaining, used %, and the current month (`YYYY-MM`). Plus the organization status badge (active/suspended).
2. **API key** — generate/regenerate/revoke, and the current key’s status and timestamps.
3. **Send message** — title, body, recipients.
4. **Recent batches** — a log table; each row links to a detail page.

**Super admins** additionally see a **Switch organization** control and the **New organization account** button. Super admins reach a specific organization via `?org=<organizationId>` (selected through the picker).

---

## 7. Managing the API key

Each organization has **one active API key** at a time. The key authenticates programmatic calls to the messaging API.

### Generate a key
1. In the **API key** section, click **Generate API key** (or **Regenerate API key** if one already exists).
2. Confirm the prompt. **Regenerating immediately revokes the current key** — any integration using it stops working until you update it.
3. The raw key is displayed **once**, in a highlighted banner:

   > **Copy this key now. It will not be shown again.**

4. Click **Copy** and store the key in your secrets manager.

**The raw key is shown exactly once.** It is not stored anywhere in plaintext — only a SHA‑256 hash is kept — so it cannot be retrieved later. If you lose it, generate a new one (which revokes the old one).

### Key format
```
offmsg_live_<43 url-safe characters>
```
Example shape (not a real key): `offmsg_live_Nq8s...` (256 bits of entropy).

### Revoke a key
Click **Revoke API key** and confirm. Programmatic sending stops immediately. The revoked key remains in history (with its `revokedAt` timestamp) but can never be used again.

### What the page shows
- **Status** — `active` or `revoked`.
- **Created** — when it was generated.
- **Last used** — last successful API authentication (blank if never used).
- **Revoked** — when it was revoked (if applicable).

The dashboard never displays the stored hash.

---

## 8. Sending a message from the dashboard

In the **Send message** section:

1. **Title** — required, ≤ 80 characters.
2. **Body** — required, ≤ 500 characters.
3. **Recipients** — one per line, up to **500** recipients. Each line is either:
   - a **phone number** in `+E.164` format, e.g. `+970591234567`, or
   - an **OfflineSMS user ID**.

   > Digits-only lines without a leading `+` are rejected (a phone number must include the country code with `+`).

4. Click **Send message**.

The result appears immediately, e.g.:

> Batch `aB3xY9…` recorded — status: **partial**. 2/4 accepted (queued) · 1 failed · 1 unsupported recipient.

The usage summary and the Recent batches table refresh automatically.

**How recipients are resolved** (no real delivery is performed — see [§9](#9-message-statuses)):

| Recipient | Outcome |
|---|---|
| `userId` that exists | `queued` |
| `userId` that does not exist | `failed` (`user_not_found`) |
| phone linked to an existing OfflineSMS user | `queued` |
| phone not linked to any user | `unsupported_recipient` (`phone_not_linked_to_user`) |

The dashboard send and the API use the **same** backend logic; the only differences are the recorded **source** (`dashboard` vs `api`) and who created it.

---

## 9. Message statuses

This MVP uses **only** these statuses. They are honest about what actually happened — nothing is marked delivered, because delivery is not yet implemented.

| Status | Meaning |
|---|---|
| **accepted** | Synonym used at the **batch** level for the count of messages that were queued. |
| **queued** | The recipient resolved to a valid in-app target and the message was **recorded for future delivery**. **It does NOT mean delivered.** |
| **failed** | The message could not be accepted for this recipient (e.g. unknown user id). See `failureReason`. |
| **unsupported_recipient** | The recipient cannot be targeted in this MVP (e.g. a phone number not linked to any OfflineSMS user). |

**Batch status** is derived: `accepted` (all queued), `partial` (some queued), or `failed` (none queued).

> The statuses **`sent`, `delivered`, and `seen` are intentionally not used** and will never appear. They are reserved for a future phase that performs real delivery.

---

## 10. Usage & quota

- Each organization has a **monthly message limit** (set at creation, editable by a super admin).
- Usage is tracked per **calendar month in UTC**, keyed `YYYY-MM` (e.g. `2026-06`). It resets automatically at the start of each month (a new counter document is used).
- **Only `accepted`/`queued` messages count against the quota.** `failed` and `unsupported_recipient` recipients consume **zero** quota.
- A send (dashboard or API) is accepted only if the **entire request** fits within the remaining quota. If it would exceed the remaining balance, the **whole request is rejected** and nothing is recorded.
- Quota is enforced inside a database **transaction**, so concurrent sends cannot oversubscribe the monthly limit.

The usage summary shows: monthly limit, used this month, remaining, and used %.

---

## 11. Viewing logs and batch details

### Recent batches table
On the Organization Messaging page, the **Recent batches** table lists recent sends with: batch id (link), source (`dashboard`/`api`), created by, status, total, accepted, queued, failed, unsupported, and created time.

### Batch detail page
Path: `/admin/organization-messaging/batches/<batchId>`

Click any batch id to open it. It shows:

- **Summary** — organization name, source, created by (admin uid for dashboard, API key id for API), created/completed timestamps, status badge, and counts (total/accepted/failed/unsupported).
- **Messages** — one row per recipient: recipient type (`phone`/`userId`), recipient value, title, body preview, status, failure reason, created time.

> The detail view shows the **latest 500** message rows per batch (no pagination in this MVP). For larger batches a note indicates rows are truncated.

**Access control:** organization admins can open detail pages only for **their own** organization’s batches; a cross-organization batch id returns “Not available”. Super admins can open any batch. This is re-checked on the server using the batch’s own organization id — the URL alone is never trusted.

---

## 12. API reference (for programmers)

### Endpoint

```
POST /api/v1/org/messages/send
```

Base URL = your deployed dashboard origin, e.g. `https://dash.offlinesms.com`.
Full URL example: `https://dash.offlinesms.com/api/v1/org/messages/send`.

### Authentication

Send your organization’s API key as a Bearer token:

```
Authorization: Bearer offmsg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

- The key is validated server-side by hash. Invalid, malformed, or revoked keys are rejected.
- The organization is resolved from the key — you do **not** send an organization id.
- Successful authentication updates the key’s `lastUsedAt`.

### Request body — two supported shapes

You must provide **exactly one** of `recipients` (Shape A) or `messages` (Shape B).

**Shape A — same message to all recipients**

```json
{
  "title": "Important Notice",
  "body": "Please review student affairs.",
  "recipients": [
    { "phone": "+970591234567" },
    { "userId": "abc123" }
  ]
}
```

**Shape B — a different message per recipient**

```json
{
  "messages": [
    { "phone": "+970591111111", "title": "Financial Notice", "body": "Dear Ahmad, you have 120 NIS due." },
    { "phone": "+970592222222", "title": "Financial Notice", "body": "Dear Sara, you have 85 NIS due." }
  ]
}
```

**Field rules**

| Field | Rule |
|---|---|
| `title` | Required, 1–80 characters. |
| `body` | Required, 1–500 characters. |
| recipient | Each entry must contain **exactly one** of `phone` or `userId`. |
| `phone` | `+E.164` format (leading `+`, 7–15 digits). Digits without `+` are rejected. |
| `userId` | A valid OfflineSMS user id. |
| count | 1–500 recipients/messages per request. |

### Success response — `200 OK`

```json
{
  "ok": true,
  "batchId": "9f3a2c7b1e8d4a5f6072",
  "total": 2,
  "accepted": 2,
  "failed": 0,
  "unsupported": 0,
  "status": "accepted"
}
```

`status` is the batch status: `accepted`, `partial`, or `failed`. `accepted` is the count of `queued` messages.

### Failure response

```json
{
  "ok": false,
  "error": {
    "code": "quota_exceeded",
    "message": "Monthly message quota exceeded."
  }
}
```

### Error codes

| HTTP | `error.code` | When |
|---|---|---|
| 401 | `missing_authorization` | No/!malformed `Authorization` header. |
| 401 | `invalid_key_format` | Bearer value is not a well-formed `offmsg_live_…` key. |
| 401 | `invalid_key` | Key not recognized. |
| 401 | `revoked_key` | Key exists but is revoked. |
| 403 | `organization_not_found` | No organization associated with the key. |
| 403 | `organization_suspended` | The organization’s status is not `active`. |
| 400 | `invalid_payload` | Missing/oversized/conflicting fields, or a bad recipient entry (the message points to the offending index). |
| 400 | `too_many_recipients` | More than 500 recipients/messages. |
| 429 | `quota_exceeded` | The request would exceed the remaining monthly quota. Nothing is recorded. |
| 500 | `internal_error` | Unexpected server error. |

### Per-recipient outcome

The endpoint returns aggregate counts, not per-recipient rows. To see per-recipient statuses (`queued` / `failed` / `unsupported_recipient`) and failure reasons, open the **batch detail page** in the dashboard using the returned `batchId`.

> **Delivery note:** a `200` with `status: "accepted"` means the messages were **recorded and queued**, not delivered. Delivery is not implemented in this MVP.

---

## 13. Code examples

### cURL — Shape A

```bash
curl -X POST "https://dash.offlinesms.com/api/v1/org/messages/send" \
  -H "Authorization: Bearer offmsg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Important Notice",
    "body": "Please review student affairs.",
    "recipients": [
      { "phone": "+970591234567" },
      { "userId": "abc123" }
    ]
  }'
```

### JavaScript / Node (fetch)

```js
const res = await fetch("https://dash.offlinesms.com/api/v1/org/messages/send", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.OFFMSG_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messages: [
      { phone: "+970591111111", title: "Financial Notice", body: "Dear Ahmad, you have 120 NIS due." },
      { phone: "+970592222222", title: "Financial Notice", body: "Dear Sara, you have 85 NIS due." },
    ],
  }),
});

const data = await res.json();
if (!data.ok) {
  console.error(`Send failed: ${data.error.code} — ${data.error.message}`);
} else {
  console.log(`Batch ${data.batchId}: ${data.accepted}/${data.total} accepted, status ${data.status}`);
}
```

### PHP (cURL)

```php
<?php
$ch = curl_init("https://dash.offlinesms.com/api/v1/org/messages/send");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer " . getenv("OFFMSG_API_KEY"),
    "Content-Type: application/json",
  ],
  CURLOPT_POSTFIELDS => json_encode([
    "title" => "Important Notice",
    "body" => "Please review student affairs.",
    "recipients" => [
      ["phone" => "+970591234567"],
      ["userId" => "abc123"],
    ],
  ]),
]);
$response = curl_exec($ch);
$http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$data = json_decode($response, true);
if ($http !== 200 || empty($data["ok"])) {
  fwrite(STDERR, "Send failed: " . ($data["error"]["code"] ?? "unknown") . "\n");
} else {
  echo "Batch {$data['batchId']}: {$data['accepted']}/{$data['total']} accepted\n";
}
```

### Python (requests)

```python
import os, requests

resp = requests.post(
    "https://dash.offlinesms.com/api/v1/org/messages/send",
    headers={
        "Authorization": f"Bearer {os.environ['OFFMSG_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "title": "Important Notice",
        "body": "Please review student affairs.",
        "recipients": [{"phone": "+970591234567"}, {"userId": "abc123"}],
    },
    timeout=30,
)
data = resp.json()
if not data.get("ok"):
    print("Send failed:", data["error"]["code"], data["error"]["message"])
else:
    print(f"Batch {data['batchId']}: {data['accepted']}/{data['total']} accepted, status {data['status']}")
```

### Integration tips
- Store the API key in a secrets manager / environment variable — never in source control.
- Treat **429 `quota_exceeded`** as “try next month / raise the limit” — the request was **not** partially applied; resend after the limit resets or is increased.
- Treat **401 `revoked_key`** as “the key was rotated” — fetch the new key from your org admin and update your secret.
- Keep requests ≤ 500 recipients; split larger campaigns into multiple requests (each is quota-checked independently).

---

## 14. Security model

| Decision | Detail |
|---|---|
| **One-time key reveal** | The raw API key is returned exactly once, at generation, and held only in the browser at that moment. A page refresh loses it permanently. |
| **No plaintext keys** | Only a **SHA-256 hash** of the key is stored. The raw key is never written to the database, logs, audit metadata, or API responses. |
| **Hash never exposed** | Dashboard read models copy a fixed allow-list of fields; the stored hash cannot surface in any page or response. |
| **API key docs are server-only** | Firestore rules deny **all** client read/write of the API key collection (even for admins). Validation happens only on the server. |
| **Explicit server authorization** | The backend uses the Admin SDK, which **bypasses** Firestore rules. Therefore every server action/route re-checks capability + organization scope explicitly; rules are defense-in-depth, not the primary gate. |
| **Organization scoping** | `organization_admin` is locked to their `organizationId` claim; a client-supplied organization id is never trusted. `super_admin` is unrestricted and selects an organization explicitly. |
| **Write protection** | Clients cannot directly write message batches, message logs, or usage counters — all are server-written. Quota cannot be reset from a browser. |
| **No token leakage** | Audit entries reference the **API key id** (e.g. `apikey:<keyId>`), never the raw bearer token. |
| **Audited actions** | `organization.account.created`, `organization_api_key_created`, `organization_api_key_revoked`, `organization_message_batch_created`, `organization_message_batch_failed`. |

---

## 15. Limits & quick reference

| Item | Value |
|---|---|
| Title max length | 80 characters |
| Body max length | 500 characters |
| Recipients per request | 500 |
| Password minimum | 8 chars, ≥1 letter + ≥1 number |
| Monthly limit max | 1,000,000 |
| Batch detail rows shown | latest 500 |
| API key format | `offmsg_live_` + 43 url-safe chars |
| Active keys per organization | 1 |
| Quota window | Calendar month, UTC (`YYYY-MM`) |
| Endpoint | `POST /api/v1/org/messages/send` |
| Statuses | `accepted`, `queued`, `failed`, `unsupported_recipient` |

---

## 16. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 missing_authorization` | No `Authorization: Bearer …` header. Add it. |
| `401 invalid_key_format` | The token isn’t a valid `offmsg_live_…` key. Check for truncation/whitespace. |
| `401 invalid_key` / `revoked_key` | Key not recognized or revoked. Generate a new key in the dashboard and update your secret. |
| `403 organization_suspended` | A super admin set the org to **Suspended**. Re-activate it to resume. |
| `400 invalid_payload` (recipient pointer) | One recipient entry is malformed. The message names the index (e.g. `recipients[1]`). Ensure exactly one of `phone`/`userId`, and `+E.164` phones. |
| `429 quota_exceeded` | The request exceeds the remaining monthly quota. Raise the limit (super admin) or wait for the month reset. Nothing was recorded. |
| Dashboard send shows many `unsupported_recipient` | Those phone numbers aren’t linked to existing OfflineSMS users. This is expected in the MVP (see limitations). |
| “Not available” opening a batch | You’re an org admin trying to open another organization’s batch. This is blocked by design. |
| Logs/usage look empty right after deploy | The Firestore indexes may still be building. The page falls back to a slower path meanwhile; data appears once indexes are `READY`. |

---

## 17. Known limitations

This MVP intentionally excludes the following. They are candidates for future phases.

- **No real delivery.** Messages are recorded and queued, not delivered. `queued` ≠ delivered.
- **Phone recipients only resolve if already linked to an existing OfflineSMS user.** Unlinked numbers become `unsupported_recipient`.
- No message **templates**.
- No **webhooks** / delivery callbacks.
- No **CSV upload**.
- No **SDK**.
- No **fallback SMS** and **no SMS relay** integration.
- No **approval workflows**.
- No **advanced delivery states** (`sent`/`delivered`/`seen`) — these arrive only when real delivery exists.
- **One** API key per organization (no multiple keys / per-key scopes).
- Batch detail shows the latest **500** message rows (no pagination).

---

## Appendix — deployment & verification (operators)

**Deploy Firestore rules and indexes** (run from an authenticated environment):

```bash
firebase deploy --only firestore
# or individually:
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

Deploy rules/indexes **before** the dashboard. The two composite indexes
(`organizationMessageBatches`, `organizationMessages`) take a few minutes to build; the log pages fall back to a slower client-side sort until they are `READY`.

**Deploy the dashboard** via your existing dashboard pipeline.

**Automated test coverage** (see the engineering report for details): dashboard unit suite and Firestore emulator rules tests both pass. Manual end-to-end verification (login, one-time key reveal, live API call, batch creation, usage update, status outcomes) must be performed against the deployed environment.

---

*This manual covers the dashboard and Organization Messaging API only. It does not describe, and the feature does not modify, the OfflineSMS mobile application.*
