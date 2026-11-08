# Live admin overview

`/admin` now reads production Firestore data through the existing server-side
Firebase Admin credentials. No mobile build or new Cloud Function is required.

## Data definitions

| Display | Authoritative source |
| --- | --- |
| Total users | `users` aggregation count |
| Organization members | `organizations/{verified organizationId}/members` count |
| Groups | `conversations` count with `type == group`, organization scoped when applicable |
| SMS batches today | `smsBatches` count since 00:00 UTC |
| Failed SMS batches | Batches created during the displayed seven UTC calendar days with status `failed` |
| SMS points spent / daily usage | Sum of `transactions.amount` for completed `sms_spend` ledger rows, by settlement creation date |
| Open support tickets | `tickets` count for `open` and `pending`; omitted for org admins because legacy tickets have no canonical organization field |
| Batch status chart | Counts of batch document statuses, including Other; these are not recipient delivery receipts |
| Recent batches | Six latest batch documents by `createdAt`, with recipients, status, settled points where permitted and UTC creation time |
| Relay activity | Counts of relay jobs and devices; online means status active and heartbeat within the last 90 seconds |

All aggregates cover complete matching datasets, not the first page of documents.
The seven-day charts include today and exclude timestamps after the snapshot time.
Reservations, transfers and refunds are not added as extra spending: the settlement
ledger's `sms_spend` amount already represents what was billed after refunds.
An unsettled batch shows Pending settlement, not its estimated charge as spending.
No message bodies, recipient phone numbers or raw user records are returned.

## Updating and access

- Initial data is server rendered. The client refreshes `/api/admin/overview`
  every 15 seconds, with manual refresh and resume on focus/reconnection.
- Hidden tabs and offline browsers pause requests; requests cannot overlap and
  time out after 12 seconds. Navigation cancels obsolete requests.
- Last snapshot time is visible. Network failure keeps the previous snapshot
  with a warning. Section failures show Unavailable, not zero or Healthy.
- A 401/403 clears visible data and stops polling until sign-in.
- Every request verifies the session cookie and overview capability. Each query
  and serialized section also checks its specific role capability.
- Organization scope comes only from verified claims. It applies to counts,
  charts, recent batches and relay queries. Missing org claims fail closed.
- Short server caching (10 seconds, at most 100 role/org entries) coalesces tabs.
  It never replaces session verification. Partial failures are not retained.
- Responses use `private, no-store` and `Vary: Cookie`. Per-user refresh requests
  are limited to 30/minute in each server process, using the existing limiter.
- Workspace labels use the actual organization name, or OfflineSMS platform.
  Navigation search filters real pages, and the notification link opens its page.

## Deployment

Deploy the added composite indexes **before** deploying the dashboard, and wait
until the new indexes are ready in Firestore. Some metrics remain Unavailable
while an index is building.

```powershell
Set-Location D:\sms-production
git fetch origin
git switch feat/live-admin-dashboard
git pull --ff-only
firebase deploy --only firestore:indexes --project offlinesms-prod-2027
```

The production dashboard currently responds as a DigitalOcean App Platform
service. Redeploy that dashboard component from the tested branch/commit, or
merge the change into its configured source branch and deploy that commit.
Keep its existing environment settings and Firebase credentials. Its normal
workspace build is `npm ci` followed by
`npm --workspace apps/dashboard run build`; normal start is
`npm --workspace apps/dashboard run start`.
`firebase deploy --only hosting:website` deploys the public website, not this
Next.js admin service. These changes do not require a Functions deployment.

Confirm the deployed commit, then open `/admin` and check the visible snapshot
time changes after 15 seconds. Check an empty section, a new SMS batch, a settled
charge, and an organization admin account. Existing financial writes are unchanged.

## Verification

- Dashboard typecheck, existing dashboard unit tests, and production Next.js build.
- Unit tests for endpoint authentication, capability rejection, no-store headers,
  rate limiting, safe error handling, UTC boundaries and scoped cache isolation.
- Client lifecycle tests for polling, hidden/offline pauses, reconnection,
  failures, non-overlap, 401/403 clearing, timeout recovery and navigation cleanup.
- `functions/__integration__/dashboardOverview.int.test.ts` runs real count/sum
  queries in the demo Firestore emulator, covering financial exclusions, dates,
  organization isolation, capability redaction, empty/error states and list limits.

```bash
npm run test -- apps/dashboard/__tests__
firebase emulators:exec --project demo-offlinesms --only firestore \
  'npx vitest run --config vitest.integration.config.ts functions/__integration__/dashboardOverview.int.test.ts'
```

Sources: [Firestore aggregation queries](https://firebase.google.com/docs/firestore/query-data/aggregation-queries),
[Firestore indexes](https://firebase.google.com/docs/firestore/query-data/indexing),
[Firebase session cookies](https://firebase.google.com/docs/auth/admin/manage-cookies).
