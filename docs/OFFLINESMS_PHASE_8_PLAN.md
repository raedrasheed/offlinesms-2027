# OfflineSMS Phase 8 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 7 complete (`5d73ac1`).

---

## Objective

Wire **OfflineSMS SMS Escalation** end-to-end. Phase 0 already shipped the
backend skeleton (`escalateSms`, `onSmsBatchAccepted`, the mock
`gateway.sendBatch`); Phase 8 hardens that backend, exposes a preview
callable, and builds the mobile UX that lets a sender reach recipients who
haven't read or received the message — using OfflineSMS Points only.

No payments, no points purchase, no media, no admin SMS dashboard,
no third-party provider names.

---

## Existing SMS callable inventory

- `escalateSms` (`functions/src/sms/escalate.ts`) — text-only escalation
  callable. Audience values today: `'unread' | 'undelivered' | 'everyone'`.
  Reserves points → writes `smsBatches/{batchId}` → dispatches via the
  mock gateway → writes per-recipient docs → flips batch status to
  `accepted`/`partial`.
- `onSmsBatchAccepted` (Firestore trigger) — settles the wallet
  reservation: refunds delta to balance, writes a `transactions` doc.
- `gateway.sendBatch` — mock provider behind a typed interface. No
  third-party name surfaces anywhere.
- `wallets/{uid}` — `{ balance, reserved }` server-owned.
- `transactions/{txId}` — server-owned audit of point movements.
- `smsBatches/{batchId}` + `smsBatches/{b}/recipients/{uid}` — existing
  collections. Rules already pin client writes off.
- `smsQuotaUsage/{uid}/days/{yyyymmdd}` — Phase 3 rules already lock it
  server-only. No writer yet — Phase 8 adds one.

Phase 8 names the existing `smsBatches` as the canonical
`smsEscalationBatches` referenced in the spec — it's the same collection
under the original name. Rather than rename and break the Phase 0 trigger,
extend the schema in place and document the alias.

---

## Exact scope

### Backend hardening (`escalateSms`)

- Accept audience as either the new wire values (`'everyone'`,
  `'unread_only'`, `'undelivered_only'`) or the legacy ones
  (`'unread'`, `'undelivered'`) so an emulator session against the
  Phase 0 callable still works.
- Resolve recipients from the Phase 7 receipts collection (not the
  legacy `senderId`-only check):
  - **unread_only:** recipients whose receipt status isn't `read` /
    `viewed` / `played`.
  - **undelivered_only:** receipt status `pending` or `failed`, or
    missing `deliveredAt`.
  - **everyone:** every conversation participant other than the sender.
- Per-recipient eligibility check — return a structured `skipReason` for
  every excluded recipient. Phase 8 reasons: `no-phone`,
  `unverified-phone` (alias of `no-phone` for users marked
  `phoneVerified: false`), `opt-out`, `duplicate-phone`,
  `already-sent-for-message`, `rate-limited`, `policy-blocked`.
- **Caps & cooldown:**
  - `MAX_BATCHES_PER_DAY = 20` per uid.
  - `MAX_RECIPIENTS_PER_BATCH = 200`.
  - `COOLDOWN_MS = 60 * 1000` — refuse another batch for the same
    `(messageId, senderUid)` pair within 60 s of the previous batch.
- **Quota persistence:** every successful escalation increments
  `smsQuotaUsage/{uid}/days/{yyyymmdd}` (`batchCount`, `recipientCount`,
  `pointsSpent`).
- **Audit:** emit `sms.escalation.created`, `sms.escalation.accepted` /
  `sms.escalation.partial` / `sms.escalation.failed`. Metadata is
  counts-only — never the SMS body, never the message body, never full
  phone numbers.
- **Branding:** `gateway_id` field on the batch is captured (already
  exists in Phase 0) but the mobile UI only ever refers to it as the
  "OfflineSMS batch ID".

### New backend pieces

- `previewSmsEscalation({ conversationId, messageId, audience })` —
  returns `{ eligibleRecipients: [{ uid, displayName, maskedPhone,
  appReceiptStatus }], excludedRecipients: [{ uid, displayName,
  skipReason }], pointsCost, walletBalance, walletReserved,
  recipientCount }`. Read-only; does not mutate. Same audience/cap
  validation as `escalateSms` (without persistence).
- `retryFailedSmsRecipients({ batchId })` — re-attempts the gateway for
  recipients whose `smsStatus` is `failed`. Creates a new batch (so audit
  lineage stays clean). Sender or admin only.

### Batch schema extensions (`smsBatches/{batchId}`)

Phase 0 set: `messageId`, `conversationId`, `senderId`, `audience`,
`smsBody`, `recipientCount`, `estimatedCost`, `status`, `createdAt`,
`gatewayBatchId`. Phase 8 adds:

```ts
{
  // already in Phase 0
  …,

  // Phase 8 additions
  audienceCanonical:   'everyone' | 'unread_only' | 'undelivered_only',
  eligibleCount:       number,
  excludedCount:       number,
  pointsCost:          number,                 // alias of estimatedCost
  pointsReserved:      number,
  pointsDeducted:      number | null,          // populated by onSmsBatchAccepted
  pointsRefunded:      number | null,
  offlineSmsBatchId:   string | null,          // == gatewayBatchId for UI
  updatedAt:           timestamp,
  retryOfBatchId:      string | null,
}
```

Recipient docs (`smsBatches/{b}/recipients/{uid}`) gain `appReceiptStatus`,
`skipReason`, and a `status` value `'skipped'` for excluded recipients.

### Firestore rules

The existing Phase 0 rules already make `smsBatches` and its recipients
server-owned writes. Phase 8 keeps that intact and adds:

- Sender (`resource.data.senderId == auth.uid`) can read their own batches
  — already in Phase 0. **Phase 8 confirms this is still correct** and
  documents that admin reads from elsewhere (Phase 14) go via Admin SDK.
- `smsQuotaUsage/{uid}/days/{yyyymmdd}` — read by owner / admin, write
  `if false` (already in Phase 3). Confirms.

No rule loosening anywhere.

### Mobile

- `apps/mobile/src/lib/sms.ts` (new): typed wrappers for `escalateSms`,
  `previewSmsEscalation`, `retryFailedSmsRecipients`. Maps Firebase
  callable error codes to friendly strings.
- `apps/mobile/src/screens/SmsEscalation.tsx`: replaces the Phase 1
  placeholder with a multi-step flow:
  1. **Audience.** Three cards — Everyone / People who have not read /
     People who did not receive — each showing the eligible count from
     `previewSmsEscalation`.
  2. **Recipient preview.** Masked phones + per-row app receipt status +
     eligibility chip. Excluded rows render with skip reason.
  3. **SMS text.** Editable text area pre-filled with a safe excerpt of
     the original message ("OfflineSMS reminder from
     [conversation name]: [excerpt]. Open OfflineSMS to view the full
     message."). Character + segment + Unicode warning.
  4. **Cost confirmation.** Wallet balance + cost + remaining balance +
     "I confirm these recipients may be contacted by SMS" checkbox.
     Disabled when cost > balance; offers a "Buy points" affordance that
     navigates to the Phase 9/10 placeholder.
  5. **Sending / result.** Spinner during the callable, then
     `SmsDeliveryReport` summary with masked recipient rows and tabbed
     filters (All / Delivered / Pending / Failed / Skipped).
- `apps/mobile/src/screens/MessageInfo.tsx`: adds a **Send via
  OfflineSMS** primary action card for senders when the message has
  unread / undelivered / failed recipients.
- `apps/mobile/src/components/MessageBubble.tsx`: long-press action sheet
  for own messages exposes a **Send via OfflineSMS** entry.
- `apps/mobile/App.tsx`: `SmsEscalation` already registered in the root
  stack from Phase 1; no change needed beyond wiring params.

### i18n

New `sms.*` namespace in both `en.json` and `ar.json` covering every
label listed in the spec ("Send via OfflineSMS", "OfflineSMS Points
cost", "Not enough OfflineSMS Points", "OfflineSMS Delivery Report", …).

### Branding (enforced by lint-of-intent)

- Only `OfflineSMS`, `OfflineSMS SMS Gateway`, `OfflineSMS Points`,
  `OfflineSMS Delivery Report`, `OfflineSMS batch` appear in any
  user-visible string or audit log.
- A short policy line in this plan and the Phase Log: no provider names
  in copy / logs / telemetry. The gateway interface in
  `functions/src/sms/gateway.ts` stays the single isolation point.

---

## Files expected to change

**Create**
- `docs/OFFLINESMS_PHASE_8_PLAN.md`
- `apps/mobile/src/lib/sms.ts`
- `functions/src/sms/previewEscalation.ts`
- `functions/src/sms/retryFailed.ts`
- `functions/src/sms/recipients.ts` — shared audience/eligibility helpers

**Edit**
- `functions/src/sms/escalate.ts` — caps, cooldown, quota persistence,
  audit, audience-canonical, skipReasons.
- `functions/src/sms/onSmsBatchAccepted.ts` — write `pointsDeducted` /
  `pointsRefunded` summary on the batch.
- `functions/src/index.ts` — export the two new callables.
- `apps/mobile/src/screens/SmsEscalation.tsx` — replace placeholder.
- `apps/mobile/src/screens/MessageInfo.tsx` — Send via OfflineSMS CTA.
- `apps/mobile/src/components/MessageBubble.tsx` — sender action.
- `apps/mobile/src/i18n/{en,ar}.json`
- `docs/OFFLINESMS_DATA_MODEL.md`, phase log, architecture, risk
  register, design map.

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `previewSmsEscalation` reveals phone numbers via a buggy mapping | Low | High | Preview only returns masked phones. The unmasked phone never leaves the callable's local scope. |
| Cooldown false-positives a legitimate retry | Low | Medium | `retryFailedSmsRecipients` exists and isn't gated by the conversation cooldown — it creates a new batch with `retryOfBatchId` for audit lineage. |
| Audience cap (200) is too tight or too loose | Medium | Low | 200 is conservative and matches the dashboard's static placeholder "Max SMS/message". Easy to bump server-side. |
| Daily cap (20 batches) underestimates a power user | Low | Low | Cap is per-uid per-day, server-clock UTC. Document it in the phase log. |
| Quota write races on rapid escalations | Low | Low | Quota write is wrapped in the same transaction as the batch write, so concurrent escalations don't double-count. |
| `'unread'` legacy audience semantics drift from `'unread_only'` | Low | Low | The callable normalises legacy → canonical at the boundary. |
| Mobile preview shows stale balance | Low | Low | Preview returns the live `wallets/{uid}` snapshot; confirmation re-reads inside the transaction. |
| User without a wallet doc gets a confusing error | Low | Medium | Treat missing wallet as `balance: 0` consistent with the Phase 0 onboarding default. |
| Sender includes their own phone in recipients | Low | Low | Sender is filtered out at the audience resolution step, not the eligibility step. |

---

## Test plan

`npm run typecheck` / `lint` / `build` must stay green.

Manual emulator checklist mirrors the spec.

---

## Acceptance criteria

1. Plan committed.
2. `smsBatches` schema extended; `smsQuotaUsage` persisted.
3. Rules unchanged (Phase 0 + Phase 3 already protect these).
4. `escalateSms` enforces caps, cooldown, quota, audit; supports
   canonical + legacy audience values.
5. `previewSmsEscalation` and `retryFailedSmsRecipients` exist.
6. Mobile `SmsEscalation` flow: audience → recipients → text → confirm
   → result.
7. `MessageInfo` "Send via OfflineSMS" CTA.
8. `MessageBubble` long-press entry for own messages.
9. All copy uses OfflineSMS branding only. No third-party names.
10. Audit metadata is counts-only.
11. Phone numbers are masked everywhere visible.
12. typecheck / lint / build green.
13. Phases 1–7 still work.
14. Phase log updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 8 implementation plan`
2. `feat(data): add SMS escalation batch and quota contracts`
3. `feat(functions): harden OfflineSMS escalation with caps, cooldown, quota`
4. `feat(functions): add OfflineSMS escalation preview and retry`
5. `feat(mobile): add SMS escalation audience and recipient preview`
6. `feat(mobile): add SMS cost confirmation and result report`
7. `feat(mobile): wire Send via OfflineSMS entry points`
8. `docs: update phase log for phase 8`
