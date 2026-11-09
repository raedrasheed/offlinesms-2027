# Live analytics console

`/admin/reports` replaces the old report tables. It uses verified administrator
sessions and server-side Firestore aggregates. No mobile release, new SDK,
third-party analytics account, map key or Cloud Function deployment is required.

## What is measured

| Area | Values and charts | Source / definition |
| --- | --- | --- |
| Presence | Active now, active 24h/7d/30d, presence coverage, live session chart | `users.online` and `users.lastSeen`. Active now requires online=true and a non-future heartbeat within **45 seconds**, matching the existing mobile `ONLINE_WINDOW_MS`. Other windows count distinct user documents by current lastSeen, irrespective of online flag. These are app-reported presence indicators, not authenticated session or historic DAU counts. |
| Growth | Registered accounts, new accounts, explicitly completed profiles, explicitly disabled accounts, registration chart | `users`, `createdAt`, `profileCompleted=true`, `disabled=true`. Organization administrators see organization memberships and their joinedAt chart instead. |
| Groups | Stored groups, groups created during the period, conversations | `conversations`, type=group, createdAt. Missing legacy status fields do not remove groups. Counts describe stored records, not necessarily active conversations. |
| Community inventory | Organizations and communities | Current stored root documents. Organization admins do not get global community totals. |
| Chat | Created message documents and message-type breakdown | `collectionGroup(messages)`, createdAt, type. Counts reflect retained documents under the existing chat schema. No message text or sender data is fetched. Purged/deleted records cannot be reconstructed. |
| OfflineSMS | Batch counts, failures, status breakdown, batch chart | `smsBatches`, createdAt, status; organizationId scoped where applicable. Batch status is **not** a recipient delivery rate. |
| Points | Settled SMS spending and chart, current balance/reserved sums, payment record count | Completed `transactions` of type `sms_spend`, sum(amount). Reservations/transfers/refunds are not counted again. Wallet sums are points. Payment records count all statuses; no mixed-currency revenue is claimed. |
| Clips | Published, pending review, failed processing, views/likes/comments, upload chart and current status breakdown | `clips`. Engagement counters sum currently published records, across their lifetime; views are not unique users. Upload chart includes all statuses by createdAt. |
| Stories | Stories created during the period, currently unexpired stored records, creation chart | `statuses`, createdAt, expiresAt. Retained expired records can remain until cleanup; the unexpired count is not an audience-access check. |
| Support | Open/pending and all current ticket states | `tickets`. No organization filtering on an unproven ownership field. |
| Operations | Open clip reports, notification broadcast job records | `clipReports`, `notificationBroadcasts`. Broadcast records are not delivered-device counts. |
| Relay | Fresh devices, queue, in flight, failures, job states | `relayDevices`, `relayJobs`, businessId for organization scope. Active devices need a heartbeat within 90 seconds. |

All chart windows use UTC, include the current day through the snapshot instant,
and exclude future creation dates. 7/30-day reports use daily buckets. 90-day
reports contain 13 successive buckets starting exactly 89 calendar days before
today: twelve seven-day buckets and a final six-day calendar bucket (today may
be partial). Adjacent boundaries are exclusive; the last boundary includes the
snapshot instant. Current totals/queues are not restricted to the date filter.

## Country map and its limits

The map shows **registration phone-number country, not physical location**.
There is no verified GPS/city telemetry in the available schema. Country comes
only from `users/{uid}/userPrivate/profile.phoneNumber`, parsed and validated with
the existing libphonenumber-js dependency. Shared dialing prefixes are resolved
by complete number metadata, not by guessing that +1 always means the US.
Missing, invalid, ambiguous and unsupported numbers are explicitly unknown.
Public user phone fields are deliberately ignored.

Only aggregate country rows reach the browser/CSV. The server reads public
lastSeen and private phoneNumber with field masks; it does not read private email,
address, names, message bodies or precise coordinates. Temporary UID→country
lookups remain process-local and expire with the directory.

The directory is fully paginated in 500-user pages and 100-profile reads. Its
registered and 24-hour country counts are cached five minutes. Current online
IDs are matched against that directory on each live refresh; new users not yet
in the directory appear in online-unknown. The API exposes separate presence
and directory timestamps, total coverage and unknown counts. A timed-out,
failed, or >100,000-user directory is unavailable, never a truncated global map.
At larger scale, replace directory scans with server-maintained country rollups.

The map supports registered/active-now/active-24h layers, country selection,
keyboard selection, searchable/sortable country rows, zoom, reset and mouse pan.
All countries in data remain in the table, including small territories omitted
from the 1:110m map outlines. No user data is sent to a map provider; the 157KB
outline asset is served by the dashboard itself.

Map source: [Natural Earth admin-0 1:110m dataset](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson),
[public domain terms](https://www.naturalearthdata.com/about/terms-of-use/).
The reviewed source SHA256 is
`6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`.
`scripts/analytics/build_world_map.py` reproduces the shipped SVG paths from that
exact GeoJSON; it rejects changed upstream data until explicitly reviewed.

## Refresh, cost and failure behavior

`GET /api/admin/analytics?range=7d|30d|90d&kind=live|report|all`
returns private, no-store, cookie-varying responses. The server checks the session
and reports capability before every read; role/org come only from verified
claims. Ambiguous stale legacy admin claims cannot expand explicit restricted
roles. Org admins without an org are refused. Platform geography/chat/media are
not exposed to finance/auditor/org roles. Organization-owned SMS/groups and
business-owned relays are scoped in the queries, never by a client filter.

Presence polls every 5 seconds, with a 3-second process cache. Reports poll every
60 seconds, with a 60-second role/org/range cache. The country directory is
cached five minutes. These are **near-real-time polls**, not Firestore realtime
listeners. [Firestore aggregates do not support realtime listeners](https://firebase.google.com/docs/firestore/query-data/aggregation-queries).
Requests are coalesced, report RPC concurrency is limited to eight, caches are
bounded, and reads have an 18-second result deadline. Query failures produce
null plus named issue labels. Empty successful queries produce zero. Partial
reports retry after a short cache window. Failed initial requests do not invent
data; transient failures preserve dated values with a stale indicator. No raw
SDK/credential error is returned. A per-user process rate limit caps accidental
refresh abuse at 60 requests/minute; it is not a distributed security boundary.

Client requests time out after 25 seconds. Hidden/offline tabs pause and abort;
reconnection resumes. Obsolete responses cannot overwrite a new range. A
401/403 clears all report/map/sample data and stops polling. The live sample
chart holds at most 120 samples in browser memory for this open console; gaps
are null, not fabricated zeros. It is not persisted online-session history.
CSV exports aggregate rows, exact values/timestamps, unavailable sources,
definitions and geographic coverage, with spreadsheet-formula escaping.

At ~766 users, one warm process reads the country directory approximately once
per five minutes (one public and one masked private profile read per account),
not every five seconds. Aggregate queries incur index-read costs as documented
by [Firestore pricing](https://firebase.google.com/docs/firestore/pricing).
Multiple server instances maintain separate caches. This implementation does
not claim zero read cost, zero latency, a transactional global snapshot,
historical retention/funnel telemetry, precise city/GPS positions, network/device
analytics, SMS carrier delivery percentages or combined-currency revenue.

## Deployment

1. Apply the dashboard analytics patch to the current main checkout (compatible
   with the separate Docker/build fix). Existing local environment/configuration
   changes and the mobile application are not patch targets.
2. Deploy `firebase deploy --only firestore:indexes --project offlinesms-prod-2027`.
   Wait for new indexes to be **Enabled**. There are eight new composite indexes;
   existing collection-group createdAt indexing is retained. Client rules are not
   loosened and no new Firestore collection is created.
3. Build/deploy the dashboard from the updated commit through the existing
   DigitalOcean pipeline. Retain all existing Firebase build/runtime variables
   and whichever Docker/build fix is already applied. No Functions deployment
   or mobile store release is required.
4. Open `/admin/reports`: verify freshness timestamps, new registration counts,
   online changes, country coverage, filters and CSV. Compare active count with
   foreground/background on a test account, allowing 45 seconds for crash expiry.
   Check a scoped org admin and a finance admin; they must not receive platform
   users/geography through page source or the API.

## Validation performed

- Dashboard TypeScript check passed.
- Dashboard production build passed; new /admin/reports and /api/admin/analytics routes registered.
- 263 dashboard tests passed, including 36 new endpoint/calendar/cache/presence,
  refresh lifecycle, interactive map and CSV tests.
- 14 real Firestore-emulator tests passed (6 new analytics, 8 existing overview).
  These cover UTC boundaries, actual charges rather than reservation counts,
  missing values, organization isolation, role denial, fresh/stale/future
  presence, public-phone rejection, private data exclusion and full pagination
  beyond 500 users.
- Production HTTP smoke checks passed: login 200, unauthenticated reports redirect
  307, both analytics modes 401 with private/no-store and Vary: Cookie, map JSON
  200 with Palestine included, and eight referenced static assets 200.
- The map generator reproduced the checked-in asset exactly. The patch applied
  over the separately supplied Docker/build fix and all 18 target files matched
  the tested source without modifying the existing Docker configuration.
- Browser screenshot testing was attempted but Chromium cannot launch in this
  executor (`socket() failed: Operation not permitted`, process_singleton_posix).
  Interactive component tests passed; no browser visual signoff is claimed.
- No production database access, production telemetry, production load test,
  deployment, or mobile device validation was performed in this environment.
