# OfflineSMS Risk Register

Risks ranked across the surfaces present today and planned for later phases. Likelihood/impact are qualitative.

## Phase 8 mitigation snapshot

- **Risk #3 (SMS escalation abuse)** — major progress. Per-uid daily cap (20 batches), per-batch recipient cap (200), per-message cooldown (60 s), eligibility classification (no-phone / opt-out / duplicate / unverified). `previewSmsEscalation` is read-only and surfaces the same eligibility breakdown so the UI can warn before submit. `smsQuotaUsage` now has a writer.
- **Risk #4 / #5 (points double-spending, stuck reservations)** — escalation still uses the Phase 0 wallet transaction; `onSmsBatchAccepted` settles per-recipient outcomes and now also stamps `pointsDeducted` / `pointsRefunded` on the batch for visibility. Phase 11 will add a reaper for batches stuck in `sending`.
- **Risk #10 (phone privacy)** — preview and result UIs only ever show masked phones. The unmasked phone never leaves `functions/src/sms/recipients.ts` and `gateway.ts`. Audit logs carry counts only.
- **Risk #15 (audit log gaps)** — `sms.escalation.*` namespace lands; metadata sanitiser still strips body/content/messageText/text keys defensively.
- **Risk #21 (third-party brand bleed)** — Phase 8 reaffirms the policy: only OfflineSMS branding in UI, copy, and audit logs. `gateway.ts` remains the single isolation point.

---

## Phase 7 mitigation snapshot

- **Risk #1 (Firebase security rules gaps)** — receipt reads are now scoped to the receipt owner, the message sender, or admins; the Phase 4 "any participant" read is closed. `statuses/{id}/views/{uid}` writes are server-only via `markStatusViewed`, which re-runs Phase 3's audience check.
- **Risk #6 (delivery/read receipt scalability)** — Phase 7 ships the consumer side. `onReceiptWrite` recomputes aggregates by full scan; correct and simple at the 256-member cap. Client batches via dedupe + 300 ms debounce. Phase 20 may swap to incremental counters if throughput demands.
- **Risk #15 (audit log gaps)** — receipt writes deliberately unaudited (too noisy). Audit-metadata sanitiser still strips body/content/messageText/text keys defensively.
- **Risk #18 (real-time listener cost)** — receipts already live in the existing per-message receipt sub-collection; aggregate counts piggy-back on the message doc that's already streamed.
- **Risk #19 (offline sync conflicts)** — server-side monotonic guard makes receipt writes idempotent and safe to retry. Even a lost client dedupe state can't downgrade a `read` back to `delivered`.

---

## Phase 6 mitigation snapshot

- **Risk #1 (Firebase security rules gaps)** — `messages.update` and `messages.delete` are now admin-only at the rules layer; every legitimate mutation flows through a callable + Admin SDK. Two unused shape validators (`isValidReplyTo`, `isValidForwardedFrom`) are available for future direct-create paths.
- **Risk #15 (audit log gaps)** — `message.*` namespace lands (`edited`, `deleted.for_me`, `deleted.for_everyone`, `pinned`, `unpinned`, `forwarded`). Reactions and stars deliberately unaudited. Audit-metadata sanitiser keeps stripping `body`/`content`/`messageText`/`text` keys.
- **Risk #18 (real-time listener cost)** — per-message starred / deletedForMe state piggy-backs on the existing `userState` doc; no new listener per conversation. Reactions live on the message doc, brought by the existing listener.
- **Risk #19 (offline sync conflicts)** — `editMessage` is server-authoritative (15-min window checked against server clock); stale offline edits fail with `edit-window-closed`.
- **Risk #22 (stuck status uploads)** — adjacent: `expiresAt` field + `sweepExpiredMessages` cron-stub exist as code; activation queued for Phase 11.

---

## Phase 5 mitigation snapshot

- **Risk #1 (Firebase security rules gaps)** — group creates now require `ownerUid == auth.uid` + self-inclusion in `participantUids`. Group `/members` writes are server-only (callable + Admin SDK). Direct + legacy conversation paths untouched.
- **Risk #7 (large group performance)** — Phase 5 sets `MAX_GROUP_MEMBERS = 256` server-side. The chat-list listener stays at `limit(50)` conversations. Per-conversation fan-out by `onMessageCreate` scales linearly with `participantUids.length`; acceptable at 256 but worth re-measuring in Phase 20.
- **Risk #14 (admin permission leakage)** — group role transitions go through audited callables (`group.member.added`, `group.member.removed`, `group.member.role_changed`, `group.member.left`, `group.locked`, `group.unlocked`). Owner role is immutable from the standard path; owner-transfer is explicitly deferred.
- **Risk #15 (audit log gaps)** — `group.*` namespace lands; metadata sanitiser still strips body/content/messageText so a mis-used callable contract can't leak content.

---

## Phase 4 mitigation snapshot

- **Risk #1 (Firebase security rules gaps)** — further progress. `conversations` participation, message validation (type, length, sender), and per-user `userState` field allow-list now ship. `typing` is owner-write, participant-read.
- **Risk #2 (private message content exposure in admin dashboard)** — unchanged in Phase 4 (no dashboard chat UI yet). The audit-log helper's sanitiser is the safety net for any callable that accidentally tries to log content.
- **Risk #6 (delivery / read receipt scalability)** — Phase 4 introduces the consumer side (`unreadCount` aggregation on `userState`) without per-message reads. Phase 7 will denormalise `deliveredCount`/`readCount` onto messages and back this with the receipt enum (already enforced in Phase 3).
- **Risk #18 (real-time listener cost)** — Phase 4 takes an explicit hit here: per-conversation listeners for `userState` and `typing`. Mitigations in place: the chat list is capped at 50 conversations, `subscribeTyping` filters expired docs client-side, and `setTyping` is debounced to one start event per 2 s. Listener-cost audit is Phase 20.
- **Risk #19 (offline sync conflicts)** — touched. Message writes use server-generated `messageId`; client doesn't pass an id. Counter increments use `FieldValue.increment(1)`; `markRead` overwrites to `0` (last-writer-wins). Reconciliation lands in Phase 20.

---

## Phase 3 mitigation snapshot

- **Risk #1 (Firebase security rules gaps)** — major progress. Rules for `auditLogs`, `gatewayHealth`, `smsQuotaUsage`, `payments`, `tickets`, `flags`, `organizations`, `roles` shipped (all server-only writes for system-owned collections). Receipt `status` enum validated. `statuses` audience and expiry enforced in rules. Remaining: automated tests + content-validation rules for messages (Phase 20).
- **Risk #3 (statuses audience leak)** — closed for the rules layer. Server-side audience filtering replaces the previous client-only filter. Contacts-graph approximation documented; tightens further when Phase 13 wires real contacts.
- **Risk #15 (audit log gaps)** — partial mitigation. `writeAuditLog` helper is in place, two privileged callables (`claimUsername`, `setAdminClaim`) are audited end-to-end. Every privileged callable added in Phases 4+ MUST use the helper as a matter of policy.
- **Risk #16 (payment / points purchase security)** — partial mitigation. `payments` is now `allow write: if false` for clients at the rules layer, including admins. Webhook-driven crediting still pending in Phase 10.
- **Risk #18 (real-time listener cost) / #7 (large group performance)** — unaffected; indexes added only where strictly needed.

---

## Phase 2 mitigation snapshot

- **Risk #1 (Firebase security rules gaps)** — partially mitigated. `users.update` now enforces a strict field allow-list, with a redundant banned-list as a safety net. `usernames/{lower}` collection has explicit rules: read by signed-in users, writes server-only via `claimUsername`. Still pending: rules for `auditLogs`, `tickets`, `flags`, `roles`, `payments`, `gatewayHealth` (Phase 3); statuses audience enforcement (Phase 3); receipt enum validation (Phase 3); rules unit tests (Phase 20).
- **Risk #14 (admin permission leakage)** — partial mitigation. `scripts/promoteAdmin.ts` provides a documented, controlled path to the first admin; both legacy `admin: true` and forward-compat `role: 'super_admin'` claims are set. RBAC still single-claim until Phase 18.
- **Risk #20 (free admin bootstrap risk)** — first-admin bootstrap is now documented end-to-end (`docs/admin-bootstrap.md`). Service-account handling rules spelled out; script refuses to run without an explicit email argument and never prints the key file.
- **Onboarding-state DoS / spam** — new mitigation lever. Reserved-username list prevents impersonation of system identities; the `claimUsername` callable runs in a single transaction so concurrent claims fail one side cleanly. Full per-user rate limiting comes in Phase 8 / Phase 20.

---

## Phase 1 mitigation snapshot

- **Risk #4 (admin permission leakage at the route boundary)** — partially mitigated. `apps/dashboard/app/admin/layout.tsx` is now a server-rendered guard that verifies a Firebase session cookie and admin role; non-admin traffic gets a `PermissionState` page rather than admin UI. Full RBAC (beyond `admin: true`) still lands in Phase 18.
- **Risk #12 (dark mode inconsistencies)** — token-level groundwork laid. Semantic tokens with paired `lightSemantic` / `darkSemantic` are exported; no provider yet, so visible UI is unchanged. Phase 19 wires the toggle.
- **Risk #11 (RTL layout drift)** — partially mitigated for the mobile state primitives (use `I18nManager.isRTL` for alignment). Dashboard RTL still pending.
- **Risk #13 (incomplete TODO screens)** — replaced ad-hoc TODO copy on 7 dashboard scaffold pages and 5 mobile screens with token-aware `EmptyState` / `LoadingState` primitives. No regressions in product behaviour.

---

| # | Risk | Impact | Likelihood | Mitigation | Phase to handle |
|---|---|---|---|---|---|
| 1 | **Firebase security rules gaps.** `settings` is readable by all authed users; `statuses` audience is enforced only client-side; new collections (audit, tickets, calls, roles) have no rules yet; receipt status enum not validated. | High | High | Add rules for every collection, validate enum and field allow-lists, write a comprehensive rules unit-test suite, and run the suite in CI. | 3 (groundwork), 20 (coverage) |
| 2 | **Private message content exposure in admin dashboard.** `/admin/chats/[id]/messages` will need to render messages for moderation; default exposure leaks user content. | High | Medium | Hide content by default. Render hashed metadata. Require `permissions.canReadMessageContent` + a reveal reason. Every reveal writes an audit entry. | 14 |
| 3 | **SMS escalation abuse.** No per-user or per-day quota, no audience cap, no cool-down, no proof-of-permission to text recipients. A single user could spam an entire group. | High | High | Add quota `smsQuotaUsage/{uid}/{yyyymmdd}`, audience cap, conversation cool-down. Audit every escalation. Confirmation UI shows masked recipients and total cost. | 8 |
| 4 | **Points double-spending.** Two devices could initiate escalations simultaneously and pass the balance check, then over-spend reservation. | High | Medium | Reservation must be performed in a Firestore transaction that re-reads balance + reserved. `escalateSms` already uses a transaction — keep this invariant and add a property-based test. | 8 (verification), 20 (load test) |
| 5 | **Wallet reservation race conditions.** A batch stuck in `sending` never refunds because `onSmsBatchAccepted` only fires on status transitions; if dispatch crashes after reservation but before status write, points stay reserved. | High | Medium | Add a scheduled reaper that finds batches `status='sending' AND createdAt < now-15m` and either retries dispatch or releases reservation with audit entry. | 11 |
| 6 | **Delivery / read receipt scalability.** Fan-out of one receipt per recipient per message becomes expensive on large groups; per-message listeners multiply. | Medium | High | Denormalise `deliveredCount` / `readCount` onto the message via aggregation trigger. Cap aggregation to the first N recipients in very large groups. Audit listener cost. | 7 (denorm), 20 (perf) |
| 7 | **Large group performance.** Member-array array-contains queries degrade past ~10⁴ docs per user. Listener cost balloons with active groups. | Medium | Medium | Cap groups at 1,024 members (server-enforced). Move very large lists to "communities" model with paged channel reads. | 5 (cap), 13 (communities) |
| 8 | **Firestore index explosion.** Each admin filter combination tempts a new composite index; uncontrolled growth raises cost and slows deploys. | Medium | High | Define a curated set of "admin index patterns" in design map. Refuse to add an index that duplicates an existing one with different sort orders without justification. | 13 onward |
| 9 | **SMS delivery report accuracy.** Mock gateway randomises status; real providers send delivery receipts asynchronously via webhook. Without webhook ingestion, statuses are guesses. | Medium | High | Add HMAC-verified `gatewayWebhook` ingesting per-recipient DLRs. Reconcile against batch on a schedule. | 11 |
| 10 | **User phone number privacy.** Admin pages and reports could surface raw numbers. | High | High | Mask phones by default (`+1•••••••42`). Full reveal requires permission and writes audit. CSV exports apply the same redaction. | 14 (UI), 17 (exports) |
| 11 | **RTL layout drift.** Mobile forces RTL via `I18nManager` but no regression suite; dashboard lacks RTL entirely. Components may break in Arabic. | Medium | High | Visual regression tests for both LTR and RTL. Convert dashboard to logical CSS properties; add Tailwind RTL plugin or manual mirroring. | 19 |
| 12 | **Dark mode inconsistencies.** Token placeholders exist (`darkBg`, `darkSurface`) but no semantic tokens or theme provider; partial adoption would look broken. | Medium | Medium | Land semantic role tokens **before** any dark wiring. Theme provider behind a feature flag until fully covered. | 1 (tokens), 19 (rollout) |
| 13 | **Incomplete TODO screens.** Six mobile screens and eight dashboard pages are placeholders. Shipping leaves dead nav. | Medium | Certain | Each placeholder is tracked as its own phase task with a "coming soon" empty state until implemented. CI lint to fail on `TODO` strings in user-visible copy after Phase 19. | per phase |
| 14 | **Admin permission leakage.** Today only `admin: true` exists. Any admin can do anything (read content, refund, change roles). | High | High | Move to role + permission model in Phase 18. Each privileged callable checks `permissions[action]`, not `admin`. Migration script. | 18 |
| 15 | **Audit log gaps.** Privileged actions today have no audit. Even refunds and role changes won't have history. | High | Certain | Build the audit helper in Phase 3 and require every privileged callable to use it. Lint rule (callable name allow-list) enforces. | 3 (helper), 18 (explorer) |
| 16 | **Payment / points-purchase security.** `buyPoints` currently credits on a callable without payment verification — exploitable as a free-points endpoint. | Critical | High | Disable client credit path; introduce webhook-driven `payments/{id}` flow with idempotency; lock down rules; replay tests. | 10 |
| 17 | **Export / report privacy risks.** CSV exports could leak phones, names, content. | High | Medium | Default-redact phones and content. Full-unmask exports gated by permission, with audit and a download expiry. | 17 |
| 18 | **Real-time listener cost.** Multiple unbounded `onSnapshot` listeners per screen (chats, messages, wallet, transactions) multiply on long sessions. | Medium | High | Cap result sizes, paginate history, unsubscribe on blur, share listeners across screens via a small store, monitor cost in Phase 20. | 20 |
| 19 | **Offline sync conflicts.** Firestore offline persistence will resolve last-write-wins; receipt order and edit/delete semantics could regress. | Medium | Medium | Make all client mutations idempotent (`messageId`, `receiptId` keyed). Use server timestamps. Cover offline scenarios with Detox tests. | 6 (semantics), 20 (tests) |
| 20 | **Free admin bootstrap risk.** `setAdminClaim` is gated by an existing admin; the *first* admin must be promoted manually via the Admin SDK script. A leaked service-account file is catastrophic. | Critical | Low | Document the bootstrap path; store the service account in a secret manager only; rotate after first use; restrict IAM. | 3 (script + doc), 20 (review) |
| 21 | **Brand bleed.** A future contributor mentions a third-party SMS provider name in copy or telemetry. | Medium | Medium | Add a CI lint check banning known provider names in `apps/**` and `docs/**`. The provider boundary lives only in `functions/src/sms/gateway.ts`. | 1 (CI lint), 20 (audit) |
| 22 | **Stuck status uploads.** Storage rule promises 24 h auto-expire but no function purges old files. Storage cost grows linearly. | Low | Medium | Add scheduled `purgeExpiredStatuses` function. | 7 (with status feature) |
