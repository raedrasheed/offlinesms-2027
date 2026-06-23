# Points Request Flow (no payment) — architecture & QA

The mobile app does **not** sell points. A user **requests** a points package;
an admin **approves** (which assigns the points) or **rejects** it. No price,
currency, checkout, invoice, or payment exists anywhere in this flow.

## Pieces
- **Mobile** `RequestPoints` → tap a package → confirm → `createPointsRequest(packageId)`.
  Cards show **name + points only**.
- **Callable** `functions/src/points/createPointsRequest.ts` → creates
  `pointsRequests/{id}` (`status:'pending'`), snapshots **name + points only**,
  one pending request per user, **never credits**.
- **Rules** `pointsRequests`: requester reads own, admin reads all, **server-only
  writes** (mirrors `payments`).
- **Dashboard** `/admin/points/requests` → Approve / Reject (`manage:wallets`).
  - Approve → atomically credit wallet + write an `admin_adjustment` transaction.
  - Reject → mark rejected. Idempotent on terminal states.
  - Decision logic is the pure `decideReview` (`lib/pointsRequestLogic.ts`),
    unit-tested in `__tests__/pointsRequestLogic.test.ts`.

## Data shape — `pointsRequests/{id}`
```
userId, packageId, packageName, points (snapshot),
note|null, status ('pending'|'approved'|'rejected'),
createdAt, updatedAt, reviewedAt|null, reviewedByUid|null, reviewNote|null
```
Note: **no** amount / currency / price / bonus fields are written or read.

## Deploy (required before it works live)
1. `firebase deploy --only functions:createPointsRequest`
2. `firebase deploy --only firestore:rules`
3. Redeploy the dashboard (ships `/admin/points/requests`).
4. New EAS mobile build (tappable packages).

## Automated coverage
- `decideReview` unit tests: approve→credit, reject, idempotent no-op on
  terminal states, unexpected-status error, misconfigured (no user / ≤0 / NaN
  points) error, reject-ignores-points. The shipped action calls `decideReview`,
  so these guard the real approve/reject path.
- The Firestore transaction/credit itself has no emulator harness in this repo
  (same as the legacy `createPurchase`/`confirmPayment`); verify it with the
  manual QA below.

## Manual QA checklist

### Mobile (request)
- [ ] Points → **Request points** lists packages with **name + pts only** (no USD, no bonus).
- [ ] Tap a package → confirm dialog shows the name + points → **Request**.
- [ ] Success alert "Request sent"; a `pointsRequests` doc appears (`status:pending`).
- [ ] Tap another package while one is pending → "You already have a pending request."
- [ ] Arabic locale: all strings localized; layout RTL-correct.
- [ ] Offline / callable error → "Couldn't send request" (no crash).

### Dashboard (review)
- [ ] **Admin → Points → Requests** lists the pending request (user, package, points).
- [ ] **Approve** → request → `approved`; user wallet balance increases by the request points; an `admin_adjustment` credit appears in the user's transaction history.
- [ ] **Reject** → request → `rejected`; wallet unchanged.
- [ ] Re-clicking Approve/Reject on an already-reviewed request is a no-op (no double credit).
- [ ] A non-`manage:wallets` admin sees no action buttons (and the action is denied server-side).
- [ ] Status filter (pending/approved/rejected) works; "Load more" paginates.

### Cross-checks
- [ ] After approval, the user sees the new balance + "Points added"/admin-adjustment row in the app.
- [ ] No "Buy", price, USD, package price, bonus, or payment wording anywhere in the app.
- [ ] One user can't self-credit (rules deny client writes to `pointsRequests`/`wallets`/`transactions`).
