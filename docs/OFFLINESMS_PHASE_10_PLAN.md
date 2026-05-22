# OfflineSMS Phase 10 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 9 complete (`fa54c98`).

---

## Objective

Replace the Phase 0 free-points exploit with a **webhook-driven payment
flow**, ship a **transfer flow** with daily cap and fraud-flag emission,
and canonicalise transaction lifecycle rows so the Phase 9 wallet shows
the full reservation / release / settle path.

No production provider lock-in, no admin operations, no media, no calls.

---

## Existing inventory

- `functions/src/points/buy.ts` — **unsafe.** Phase 0 callable that
  credits the wallet directly. Replace.
- `functions/src/points/transfer.ts` — works but no daily cap, no fraud
  flag, legacy type strings (`'transfer-in'`, `'transfer-out'`). Refactor.
- `functions/src/sms/onSmsBatchAccepted.ts` — emits `type: 'sms'`; Phase 8
  also stamps `pointsDeducted`/`pointsRefunded` on the batch. Canonicalise
  the transaction type string.
- `functions/src/sms/escalate.ts` — reserves balance into `reserved` field
  on the wallet, but doesn't emit a `reservation` transaction row. Add
  emission of `reservation` + `reservation_release` events.
- `wallets/{uid}` — `{ balance, reserved, createdAt }`. Phase 10 adds
  `status` (defaults to `'active'`).
- `transactions/{txId}` — already locked admin-write.
- `payments/{paymentId}` — Phase 3 collection, **rules already
  `allow write: if false`** for clients. Used here for the first time.
- `flags/{flagId}` — Phase 3 collection. `transferPoints` will emit
  fraud flags through it.
- `pointsPackages/{packageId}` — **new** lightweight catalogue.
- `pointsTransfers/{transferId}` — **new** authoritative transfer record
  for retry idempotency.
- `transferQuotaUsage/{uid}/days/{yyyymmdd}` — **new** per-user
  per-day usage. Mirrors the Phase 8 `smsQuotaUsage` shape.

---

## Exact scope

### Data model (new + extended)

```ts
pointsPackages/{packageId} {
  name:         string,
  points:       number,
  bonusPoints:  number,
  price:        number,        // smallest currency unit, e.g. cents
  currency:     string,        // ISO 4217 e.g. 'EUR'
  status:       'active' | 'disabled',
  sortOrder:    number,
  createdAt:    timestamp,
  updatedAt:    timestamp,
}

payments/{paymentId} {              // already has rules from Phase 3
  userId:           string,
  packageId:        string,
  points:           number,
  bonusPoints:      number,
  totalPoints:      number,
  amount:           number,        // smallest currency unit
  currency:         string,
  status:           'pending' | 'processing' | 'completed' | 'failed'
                  | 'cancelled' | 'refunded',
  idempotencyKey:   string,        // unique; the doc id is generated from it
  checkoutUrl:      string | null, // optional, no provider branding in copy
  providerReference: string | null,
  createdAt:        timestamp,
  updatedAt:        timestamp,
  completedAt:      timestamp | null,
  failureReason:    string | null,
}

pointsTransfers/{transferId} {
  fromUserId:       string,
  toUserId:         string,
  amount:           number,
  fee:              number,        // always 0 in Phase 10
  status:           'pending' | 'completed' | 'failed' | 'reversed',
  idempotencyKey:   string,
  flagged:          boolean,       // true when a fraud flag was emitted
  createdAt:        timestamp,
  completedAt:      timestamp | null,
  failureReason:    string | null,
}

transferQuotaUsage/{uid}/days/{yyyymmdd} {
  uid:                string,
  date:               string,        // 'yyyy-mm-dd'
  transferCount:      number,
  pointsTransferred:  number,
  updatedAt:          timestamp,
}

wallets/{uid}  // extended
  status?: 'active' | 'frozen' | 'closed'   // defaults to 'active'

transactions/{txId}  // canonical write below
  type: 'purchase' | 'transfer_in' | 'transfer_out' | 'sms_spend'
      | 'reservation' | 'reservation_release' | 'refund' | 'admin_adjustment'
  direction: 'credit' | 'debit'
  status:    'pending' | 'completed' | 'failed' | 'reversed' | 'refunded'
  relatedPaymentId?: string | null
  relatedTransferId?: string | null
```

The Phase 9 mobile lib's `canonicaliseType` already accepts both legacy
(`'sms'`, `'buy'`, `'transfer-in/out'`, `'admin-adjust'`) and canonical
strings, so Phase 10's switchover doesn't break old docs.

### Callables (`functions/src/points/`)

| Callable | Notes |
|---|---|
| `createPurchase({ packageId })` | Creates `payments/{id}` with `status: 'pending'`. **Never credits.** Returns `{ paymentId, checkoutUrl }`. Audited `payment.created`. |
| `confirmPayment({ paymentId, idempotencyKey, status, signature })` | Webhook stand-in. Verifies `PAYMENT_WEBHOOK_SECRET`. Idempotent. On `'completed'` credits wallet + writes `purchase` transaction. Audited `payment.confirmed` / `payment.failed`. |
| `confirmPaymentMock({ paymentId, status })` | **Emulator-only.** Refuses to run when `process.env.FUNCTIONS_EMULATOR !== 'true'`. Lets devs and CI exercise the success path without a real provider. Audited just like `confirmPayment`. |
| `transferPoints({ recipientUid, amount, note? })` (refactor) | Daily cap, frozen-wallet check, canonical transactions, fraud-flag emission to `flags/{id}` when amount > threshold. Idempotent via `pointsTransfers/{id}`. Audited `points.transfer.created` / `…completed` / `…failed`. |
| (removed) `buyPoints` | The Phase 0 callable is removed from the functions barrel. Replacing it with the two-step purchase flow closes the free-points exploit. |

### Trigger updates

- `functions/src/sms/escalate.ts` — when reserving, also writes a
  `reservation` transaction row (`direction: 'debit'`, `status:
  'completed'`, `relatedSmsBatchId`). When the batch finalises, the
  trigger writes `reservation_release` and `sms_spend` rows below.
- `functions/src/sms/onSmsBatchAccepted.ts` — emits canonical
  `reservation_release`, `sms_spend`, and (when refund > 0) `refund`
  transactions, in addition to the existing legacy `'sms'` row. Both
  legacy and canonical writes happen for one phase so any pre-Phase-10
  client still parses; Phase 11 will drop the legacy row.

### Rules

- `pointsPackages/{packageId}` — any signed-in user may read; writes
  are admin-only.
- `pointsTransfers/{transferId}` — sender or recipient may read their
  own; writes are server-only.
- `transferQuotaUsage/{uid}/days/{yyyymmdd}` — sender reads own; writes
  server-only. Mirrors Phase 3 `smsQuotaUsage`.
- `wallets/{uid}` — no rule change. Phase 0+3 already make writes
  admin-only.
- `payments/{paymentId}` — no rule change. Phase 3 already locks writes
  off.

No previous rule is loosened.

### Indexes

- `payments(userId, createdAt DESC)` — Phase 3 (kept).
- `pointsTransfers(fromUserId, createdAt DESC)` — new.
- `pointsTransfers(toUserId,   createdAt DESC)` — new.
- `pointsPackages(status, sortOrder ASC)` — new (Firestore can serve
  this with the automatic single-field index, but documenting).

### Mobile UI

- `BuyPoints.tsx` (new): subscribes to `pointsPackages where status ==
  'active' order by sortOrder`, package picker, confirm, calls
  `createPurchase`, then either:
  - navigates to a pending state showing a "Confirm payment (dev)"
    button that calls `confirmPaymentMock` when running against the
    emulator; or
  - shows the production placeholder copy ("Payment confirmation is
    handled securely by OfflineSMS. Your points will be added after
    confirmation.") and polls `payments/{id}` for `completed`.
- `TransferPoints.tsx` (new): username search → amount → confirm.
  Surfaces daily-cap, frozen-wallet, insufficient-balance,
  self-transfer, fraud-blocked failures with friendly copy.
- `Points.tsx`: flip `BUY_ENABLED = true`, `TRANSFER_ENABLED = true`.
  Wire buttons to the new routes.
- `TransactionDetail.tsx`: render `relatedPaymentId` and
  `relatedTransferId` (lib already canonicalises types).

### Mobile lib

- `apps/mobile/src/lib/points.ts` extensions: `subscribePackages`,
  `createPurchase`, `confirmPaymentMock`, `subscribePayment`,
  `transferPoints`. The existing `Transaction` shape gains
  `relatedPaymentId` and `relatedTransferId`.

### i18n

`points.purchase.*`, `points.transfer.*`, error keys.

### Caps & policy

- `DAILY_TRANSFER_CAP_COUNT = 20` per uid.
- `DAILY_TRANSFER_CAP_POINTS = 5000` per uid.
- `FRAUD_FLAG_THRESHOLD_POINTS = 2000` — single transfer above this
  emits a `flags/{id}` doc with `severity: 'medium'`.
- `SELF_TRANSFER`, `FROZEN_WALLET`, `INSUFFICIENT_BALANCE`,
  `DAILY_CAP_REACHED`, `RECIPIENT_NOT_FOUND` — explicit failure codes.

---

## Files expected to change

**Create**
- `docs/OFFLINESMS_PHASE_10_PLAN.md`
- `functions/src/points/createPurchase.ts`
- `functions/src/points/confirmPayment.ts`
- `functions/src/points/confirmPaymentMock.ts`
- `functions/src/points/transferPoints.ts` (replaces Phase 0 `transfer.ts`)
- `functions/src/points/packages.ts` (shared types / helpers)
- `apps/mobile/src/screens/BuyPoints.tsx`
- `apps/mobile/src/screens/TransferPoints.tsx`

**Edit**
- `functions/src/points/buy.ts` → remove the unsafe credit path; either
  delete or repurpose as a no-op that throws `unimplemented`. Cleanest
  is to delete and update `functions/src/index.ts` exports.
- `functions/src/sms/escalate.ts` — emit `reservation` row.
- `functions/src/sms/onSmsBatchAccepted.ts` — emit canonical
  `reservation_release` + `sms_spend` (+ `refund` when refund > 0) rows.
- `functions/src/index.ts` — export new callables.
- `apps/mobile/src/lib/points.ts` — wallet status, packages,
  payments, transfers.
- `apps/mobile/src/screens/Points.tsx` — flip feature flags, route to
  the new screens, load-more pagination.
- `apps/mobile/src/screens/TransactionDetail.tsx` — render payment /
  transfer metadata.
- `apps/mobile/App.tsx` — register `BuyPoints`, `TransferPoints`.
- `apps/mobile/src/i18n/{en,ar}.json`.
- `firestore.rules` — `pointsPackages`, `pointsTransfers`,
  `transferQuotaUsage` rules.
- `firestore.indexes.json` — two new transfer indexes.
- `.env.example` — document `PAYMENT_WEBHOOK_SECRET` (server-side).
- Docs: phase log, architecture, risk register, design map, data model.

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Webhook signature bypass | Low | Critical | Shared-secret comparison via constant-time `crypto.timingSafeEqual`; secret read from env, never the request body. |
| Duplicate webhook double-credits | Medium | High | Payment doc carries `idempotencyKey`; transaction inside `confirmPayment` checks current status and exits early if already `completed`. |
| `confirmPaymentMock` enabled in production | Low | Critical | Callable hard-refuses unless `process.env.FUNCTIONS_EMULATOR === 'true'`. Documented in the phase log. |
| Self-transfer slips past validation | Low | Medium | Server-side `if (fromUid === toUid)` guard; UI also disables the row when the picker resolves to self. |
| Race on transfer balance check | Low | High | Single Firestore transaction reads both wallets, validates `balance >= amount`, then debits and credits atomically. |
| Fraud flag spams `flags/{id}` | Medium | Low | One flag per transfer; `flagged` field on `pointsTransfers/{id}` is a fast dedupe check. |
| Phase 9 client still parses legacy `'sms'` strings — Phase 10 emits both | Low | Low | `canonicaliseType` (Phase 9) accepts both. Phase 11 plans to drop the legacy emission. |
| Wallet status field absent on older docs | Low | Low | `transferPoints` treats missing `status` as `'active'`; only `'frozen'` and `'closed'` block. |

---

## Rollback plan

- Each commit is scoped. The `confirmPayment` and `transferPoints`
  callables sit behind explicit feature flags (the new functions
  barrel exports); reverting the `points.ts` mobile changes alone
  hides the UI without touching the backend.
- The unsafe `buyPoints` is removed in the same commit that lands
  `createPurchase`; reverting that commit restores the exploit, so
  `git revert` should also include the mobile flag flip.

---

## Test plan

`npm run typecheck` / `lint` / `build` must stay green.

Manual emulator checklist mirrors the spec's.

---

## Acceptance criteria

Per the spec's 39-point list. Highlights:

1. Plan committed.
2. Packages / payments / transfers / quota schemas formalised.
3. `createPurchase` never credits the wallet.
4. `confirmPayment` is idempotent and shared-secret-gated.
5. `confirmPaymentMock` refuses to run outside the emulator.
6. `transferPoints` enforces self-transfer, frozen wallet, daily caps,
   sufficient balance, and emits a fraud flag above threshold.
7. SMS lifecycle rows (`reservation`, `reservation_release`,
   `sms_spend`, `refund`) emitted in addition to the existing legacy
   `'sms'` row.
8. BuyPoints and TransferPoints screens land.
9. `BUY_ENABLED` and `TRANSFER_ENABLED` flipped on.
10. No payment / SMS provider names anywhere.
11. Phases 1–9 still work.
12. typecheck / lint / build green.
13. Phase log updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 10 implementation plan`
2. `feat(data): add points packages, payments, and transfer contracts`
3. `security: harden points purchase and transfer rules`
4. `feat(functions): add webhook-driven points purchase flow`
5. `feat(functions): add points transfer flow with quota and fraud flags`
6. `feat(functions): canonicalize points transaction lifecycle`
7. `feat(mobile): add buy points flow`
8. `feat(mobile): add transfer points flow`
9. `feat(mobile): enable wallet actions and link payments/transfers in detail`
10. `docs: update phase log for phase 10`
