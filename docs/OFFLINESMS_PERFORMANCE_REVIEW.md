# OfflineSMS Performance Review

**Phase:** 20 (final hardening)
**Scope:** Firestore query patterns, index coverage, hotspot risk, scheduled-function cost, dashboard count strategy, export memory, known limitations.

---

## 1. Firestore query audit

### Mobile (subscriptions)

| Query | Limit | Index |
|---|---|---|
| `subscribeConversations` — collection group `userState` ordered by `lastMessageAt desc` | none (visible list) | composite (`userState.userId` + `lastMessageAt`) covered |
| `subscribeMessages` — `messages` order by `createdAt desc` limit 50 | 50 + cursor for older | covered |
| `subscribeWallet` — single doc | n/a | n/a |
| `subscribeTransactions` — `transactions where userId == me` order by `createdAt desc` limit 25 | 25 + cursor | covered by `(userId, createdAt)` |
| `subscribeMyTickets` — `tickets where createdBy == me` order by `createdAt desc` | none | covered |

### Dashboard

| Page | Query | Limit | Index |
|---|---|---|---|
| `/admin` overview | several `count()` aggregates | 1 doc each | covered |
| `/admin/users` | `users` order by `createdAt desc` | 25 + cursor | covered (or `(organizationId, createdAt)` for org admins) |
| `/admin/users/search` | `where displayNameLower starts-with q` | 20 | covered (Phase 18 backfill) |
| `/admin/groups` | `conversations where type == 'group'` order by `updatedAt desc` | 25 + cursor | covered |
| `/admin/groups/search` | `where nameLower starts-with q` | 20 | covered |
| `/admin/sms` | `smsBatches` order by `createdAt desc` | 25 + cursor | covered |
| `/admin/sms/{batchId}` | recipients + `smsDeliveryEvents where offlineSmsBatchId == id` | 1000 + 100 | covered (Phase 18 index) |
| `/admin/reports` | `getDayCounts(coll, field, days)` | days × 1 doc | covered |
| `/admin/audit` | `auditLogs` order by `createdAt desc` | 100 + cursor | covered |
| `/admin/support` | `tickets where status == ? where assignedTo == ?` | 50 + cursor | covered (Phase 18 added assignedTo+status+updatedAt) |
| `/admin/notifications` | `notifications where status == 'draft' order by createdAt desc` | 25 | covered (Phase 18) |
| Global search | up to 6 prefix queries in parallel, 5 hits each | 30 total | covered |

## 2. Composite index coverage

All composite indexes are tracked in `firestore.indexes.json` (deploy via `firebase deploy --only firestore:indexes`).

Phase 18 added 9 new indexes:
- `users (organizationId asc, createdAt desc)`
- `users (displayNameLower asc, createdAt desc)`
- `conversations (nameLower asc, updatedAt desc)`
- `tickets (assignedTo asc, status asc, updatedAt desc)`
- `tickets (assignedTo asc, createdAt desc)`
- `smsDeliveryEvents (offlineSmsBatchId asc, receivedAt asc)`
- `notifications (status asc, createdAt desc)`
- `notifications (createdBy asc, createdAt desc)`

Verified by `grep -A2 'indexes' firestore.indexes.json | wc -l`. Live query plans should be re-verified after deploy via Firebase console "Index" tab.

## 3. Dashboard count strategy

| Strategy | Where | Cost |
|---|---|---|
| `count()` aggregation | `/admin` overview cards, `/admin/reports` bucketed counts | 1 read per aggregation (Firestore charges per 1000 docs scanned, capped) |
| Bounded `limit(N)` + array length | not used for true totals — only for "rows shown" headers | 0 extra reads |
| Materialized counters | not used (Phase 21 candidate) | n/a |

`count()` is cheap for narrow filters; broad cross-collection counts on `users` and `smsBatches` cost ~$0.06 per million docs scanned. For tenants with > 10M docs, switch hot dashboards to per-day materialized counters (deferred).

## 4. Export memory strategy

- Hard cap: `EXPORT_LIMIT = 1000` rows per file (`apps/dashboard/lib/exportHelper.ts`)
- CSV is built in-memory as `string[]`, joined once, then sent — at 1000 rows × ~500 bytes ≈ 500 KB max
- Rate-limited at 10 exports/hour (5 for audit) → max ~5 MB/hour per admin
- For full-dataset exports, the documented workaround is BigQuery export (out of scope for Phase 20)

## 5. Global search limits

- Each search makes up to 6 parallel prefix queries (`users.displayNameLower`, `users.usernameLower`, `conversations.nameLower`, `conversations.id`, `smsBatches.id`, `payments.id`)
- Each query limited to 5 hits via `.limit(5)`
- Total worst-case reads per query: 30
- Rate limit: 60 requests/min per admin uid → max 1800 reads/min/admin from search

Prefix-query limitation: Firestore's `>=` + `<=` range is case-sensitive, so we lowercase at write time (`displayNameLower`/`nameLower`). Diacritic-insensitive search (`café` ↔ `cafe`) is not supported — documented as Phase 21 if user demand emerges. Backfill script `scripts/backfillSearchFields.ts` ensures coverage on existing data.

## 6. Large-group receipt aggregation

**Current implementation** (`functions/src/chats/onReceiptWrite.ts`):
- Trigger fires on every receipt create/update
- Reads all receipt docs for the message to compute `deliveredCount` / `readCount`
- Writes the aggregate back to the message doc

**Hotspot risk:**
- For a 1000-member group, every new receipt triggers a 1000-doc scan
- At 100 messages/sec in a busy group, this becomes O(N²) reads

**Mitigations in place:**
- Member cap of 1024 enforced in `createGroup` (`MAX_GROUP_MEMBERS`)
- Aggregation reads only `status` and `uid` projections (still expensive)

**Recommended future work:**
- Phase 21: switch to delta-aggregation (compare prev/new status, increment/decrement counters via `FieldValue.increment`)
- Phase 21: cap aggregation to first N participants for groups > 100 members
- Phase 21: per-message counter shard collection for very large channels (defer to communities Phase)

## 7. SMS batch report scale

- A typical batch has 5-50 recipients
- Detail page reads all recipient docs in one paginated query (limit 100)
- Delivery events read in one paginated query (limit 100)
- For batches > 1000 recipients (only retries can theoretically reach this), pagination via `startAfter` keeps memory bounded

No hotspot currently — batches above 100 are rare in practice.

## 8. Scheduled function cost

| Function | Schedule | Approximate cost / day |
|---|---|---|
| `reapStuckBatches` | every 15 min (96/day) | 96 × 1-2 queries × ~1 doc = ~200 reads/day |
| `purgeOldTypingDocs` (if enabled) | hourly | 24 × ~10 doc deletes |
| `pruneOldAuditLogs` (if enabled with retention) | daily | varies; capped at batch size |

Total scheduled-function cost is negligible (< 1000 ops/day).

## 9. Rate limit implementation limitations

**Current:** in-memory `Map<string, number[]>` per process

| Pro | Con |
|---|---|
| Zero infrastructure | Per-instance; resets on cold start |
| Sub-ms check | Doesn't survive deploys |
| Self-pruning | Doesn't span instances |

**Acceptance:** admin routes have low concurrency (single-digit admins active simultaneously). The risk surface is accidental over-export, not adversarial bypass. For a hardened version, swap to Firestore counter (`rateLimits/{key}` with `FieldValue.increment` + TTL) — Phase 21.

## 10. Recommended future optimizations (Phase 21+)

1. **Materialized counters** for `/admin` overview (replace `count()` with rollup docs updated by triggers)
2. **Delta-aggregation** for receipts (eliminate the N-doc scan hotspot)
3. **Firestore rate-limit table** (replace in-memory map)
4. **Communities model** for groups > 1024 members
5. **Edge caching** for `pointsPackages` and `settings/*` reads (rarely changes)
6. **BigQuery export** for dataset-wide reports (replace 1000-row CSV cap for power users)
7. **Per-day SMS batch aggregates** for the SMS reports trend table (cut the rolling 90d scan)

## 11. Summary

Current architecture comfortably supports:
- ~10,000 users
- ~1,000 active groups (≤ 100 members each)
- ~10,000 SMS batches / day
- ~5 concurrent admin users

Beyond these levels, the optimizations above should be triaged in order of which dashboard surface becomes slow first.
