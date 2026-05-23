# OfflineSMS Phase 9 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 8 complete (`7508884`).

---

## Objective

Build the **OfflineSMS Points Wallet** user-facing foundation: balance card,
transaction history, transaction detail, and a Settings entry. Surface
`reserved` so users understand in-flight SMS holds. Link `sms` transactions
back to the OfflineSMS Delivery Report from Phase 8.

No purchases, no transfers, no payment integration, no admin operations.

---

## Existing wallet / transaction inventory

- `wallets/{uid}` — `{ balance, reserved, createdAt }`. Server-owned write
  (Phase 0). Phase 9 only reads.
- `transactions/{txId}` — server-owned. Types currently written:
  - `'buy'`           — `functions/src/points/buy.ts`
  - `'transfer-in'`, `'transfer-out'`, `'refund'` — `functions/src/points/transfer.ts`
  - `'sms'`           — `functions/src/sms/onSmsBatchAccepted.ts`
- Composite index `transactions(userId, createdAt DESC)` already exists.
- Phase 8 added `pointsCost`, `pointsReserved`, `pointsDeducted`,
  `pointsRefunded` on `smsBatches/{batchId}` — linkable from a transaction.
- Rules: Phase 3 already locks `wallets` and `transactions` to admin-only
  writes. Owner-read.

Phase 9 names the **canonical Phase 9 transaction types**:

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

The mobile lib maps legacy values to canonical ones at the read boundary so
existing docs render correctly. The Phase 0 writers stay as-is — a backend
migration to canonical names is a Phase 10 / 15 concern.

---

## Exact scope

### Mobile screens

- **`Points.tsx`** rewritten. Sections: header → balance card (Balance,
  Reserved, Available) → action row (Buy points / Transfer — both
  "Coming soon"-disabled) → recent transactions → help card.
- **`PointsHistory.tsx`** (optional — folded into Points.tsx for now via
  inline section + "See all" navigates to `TransactionDetail` per row).
  Filter chips: All / SMS / Refunds / Transfers / Purchases / Admin.
- **`TransactionDetail.tsx`** (new). Shows type, direction, amount,
  status, timestamps, related batch (with a "View OfflineSMS Delivery
  Report" link that navigates straight into `SmsEscalation` in result
  mode — or a lighter `BatchReport` screen if cleaner), and notes.
- **`Settings.tsx`** — add an "OfflineSMS Points" row, an "Allow
  important SMS reminders" toggle backed by `users/{uid}.smsOptOut`,
  and keep the existing Privacy / Linked devices / Sign out rows.

### Mobile lib

- `apps/mobile/src/lib/points.ts` (new) — `subscribeWallet`,
  `subscribeTransactions`, `getTransactionLabel`, `getTransactionIcon`,
  `formatPointsAmount`, plus helpers to canonicalise the legacy
  `type` field.
- `apps/mobile/src/lib/user.ts` (new) — `subscribeMe(uid)` (live profile
  doc) and `setSmsOptOut(uid, value)` for the new Settings toggle.

### Rules

- `firestore.rules` — add `smsOptOut` to the `users.update`
  `allowedProfileFields()` allow-list so the new toggle can write
  through. No other rule changes.

### Indexes

- New composite: `transactions(userId, type, createdAt DESC)` for the
  type filter chip. Single-field `type` index is automatic and used by
  the "see all by type" path.

### Phase 8 alignment

- `SmsEscalation.tsx` confirm step now reads `wallets.{balance, reserved}`
  and shows Balance / Reserved / Cost / Available-after-send. The
  cost guard re-checks `balance >= cost` (same logic as today).

### No backend changes

`functions/` is untouched in Phase 9. Phase 10 will migrate writers to
canonical type names alongside payment integration.

### Coming-soon affordances

- "Buy points" button — disabled, with a "Coming soon" subtitle.
- "Transfer" button — disabled, with a "Coming soon" subtitle.
- Both surfaces explicitly do NOT route anywhere.

---

## Files expected to change

**Create**
- `docs/OFFLINESMS_PHASE_9_PLAN.md`
- `apps/mobile/src/lib/points.ts`
- `apps/mobile/src/lib/user.ts`
- `apps/mobile/src/screens/TransactionDetail.tsx`

**Edit**
- `apps/mobile/src/screens/Points.tsx` — full rewrite.
- `apps/mobile/src/screens/Settings.tsx` — OfflineSMS Points row + SMS reminders toggle.
- `apps/mobile/src/screens/SmsEscalation.tsx` — show Reserved + Available in confirm step.
- `apps/mobile/App.tsx` — register `TransactionDetail`.
- `apps/mobile/src/i18n/{en,ar}.json` — `points.*` namespace.
- `firestore.rules` — add `smsOptOut` to `users.update` allow-list.
- `firestore.indexes.json` — add `(userId, type, createdAt)`.
- `docs/OFFLINESMS_{DATA_MODEL,PHASE_LOG,TECHNICAL_ARCHITECTURE,RISK_REGISTER,DESIGN_IMPLEMENTATION_MAP}.md`.

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Adding `smsOptOut` to the users-update allow-list opens a write path the rule layer never sanitised before | Low | Low | The field is a boolean owner-scoped flag. The allow-list still blocks all the sensitive fields (`role`, `admin`, `wallet`, …). |
| Transaction-type mismatch (legacy `'sms'` vs canonical `'sms_spend'`) confuses the UI | Medium | Low | All UI rendering goes through `getTransactionLabel`/`getTransactionIcon`/`canonicalise`. Tests in Phase 20 will assert both forms render identically. |
| Reserved balance is stale because Phase 8 forgot to clear it on a partial failure | Low | Medium | `onSmsBatchAccepted` (Phase 0 + 8) clears the reservation. Stuck batches are a Phase 11 reaper item. |
| User opts out and Phase 8 still SMSes them | Low | High | Phase 8 already reads `users.smsOptOut` and excludes those users with `skip-reason: opt-out`. No change needed. |
| Buy points button accidentally enabled later | Low | Low | Button is gated on a const `BUY_ENABLED = false`. Phase 10 flips it as part of the same diff that wires the payment webhook. |

---

## Rollback plan

- All commits scoped. Reverting any single commit doesn't break other
  phases — the new screens are additive and the Phase 8 SMS flow doesn't
  depend on Phase 9 lib.
- The `smsOptOut` rule allow-list addition can be reverted standalone;
  Phase 8 just won't see opt-out (defaults to allow, same as today).

---

## Test plan

`npm run typecheck` / `lint` / `build` must stay green.

Manual emulator checklist mirrors the spec's checklist.

---

## Acceptance criteria

1. Plan committed.
2. Wallet + transaction read models documented.
3. `Points.tsx` shows balance, reserved, available, recent transactions.
4. `TransactionDetail.tsx` exists with deep-link to OfflineSMS Delivery
   Report for `sms_spend` transactions.
5. Settings has an "OfflineSMS Points" entry and an "Allow important
   SMS reminders" toggle.
6. Buy points and Transfer points are disabled with "Coming soon"
   affordance.
7. `SmsEscalation` confirm step shows balance / reserved / cost /
   available after send.
8. typecheck / lint / build green.
9. Phases 1–8 still work.
10. Phase log updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 9 implementation plan`
2. `feat(data): formalize wallet and transaction read models`
3. `security: allow user-controlled smsOptOut profile field`
4. `feat(mobile): add points wallet and transaction history lib`
5. `feat(mobile): rewrite OfflineSMS Points wallet screen`
6. `feat(mobile): add transaction detail screen and settings entries`
7. `feat(mobile): show reserved and available balance in SMS confirm`
8. `docs: update phase log for phase 9`
