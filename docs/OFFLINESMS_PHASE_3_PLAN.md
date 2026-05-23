# OfflineSMS Phase 3 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 2 complete (`0fe11a1`).

---

## Objective

Lock in the **core Firestore data model and security rules** that later phases will rely on. No new UI, no new product behaviour beyond what's already wired. Every privileged write becomes auditable; every system-owned collection becomes inaccessible to clients; statuses move toward server-enforced audience; receipts gain enum validation.

---

## Exact scope

### Collections introduced or formalised

All ship as **rules + documented schema only**. No UI mounts these in Phase 3.

| Collection | Owner | Reader | Writer |
|---|---|---|---|
| `organizations/{id}` | server / admin | admin | admin |
| `organizations/{id}/members/{uid}` | server / admin | member or admin | admin |
| `roles/{roleId}` | server / admin | admin | admin |
| `auditLogs/{id}` | server only | admin | server (via Admin SDK) |
| `tickets/{id}` | requester / support | requester or admin | requester (create), admin (update) |
| `flags/{id}` | reporter | admin | reporter (create), admin (update) |
| `payments/{id}` | server only | requester or admin | server (via Admin SDK / webhook) |
| `gatewayHealth/{yyyymmdd}` | server only | admin | server |
| `smsQuotaUsage/{uid}/{yyyymmdd}` | server only | requester or admin | server |
| `usernames/{lower}` (already added Phase 2) | server (via callable) | any authed | server |

The existing `users`, `conversations`, `messages`, `receipts`, `wallets`, `transactions`, `smsBatches`, `statuses`, `settings` are not redefined — only tightened.

### Rules hardening

- **`statuses` audience enforcement.** Move audience filtering out of the client into rules. New schema fields (`audienceType`, `allowedViewerUids`, `excludedViewerUids`, `expiresAt`) gate `read`. Existing `statuses` clients that don't write these new fields get the default `audienceType: 'all_contacts'` semantics, but **expired statuses are read-blocked**.
- **Receipts.** Validate `status ∈ {pending, delivered, read, viewed, played, failed}` on every client write. Force the receipt path's `uid` to equal `request.auth.uid` (already enforced; now with enum guard).
- **System-owned collections.** `auditLogs`, `gatewayHealth`, `smsQuotaUsage`, `payments` allow no client writes at all (admins keep an escape hatch where reasonable; payments stay server-only even for admins).
- **Helpers added:** `isSignedIn()`, `hasAdminRole()` (alias), `isValidReceiptStatus()`, `isStatusExpired()`, `isStatusAudienceMember()`, `isServerOwnedDoc()`.
- **No loosening of any existing rule.** Phase 1 admin guard and Phase 2 user field allow-list stay intact.

### Audit log helper

- New `functions/src/lib/auditLog.ts` exporting:
  - `writeAuditLog({ action, actor, target, result, metadata })`
  - Helpers `redactPhone(...)`, `redactEmail(...)` for sanitised metadata.
  - Soft-failing: a write failure on `auditLogs` **must not** roll back the primary action — it logs to `console.error` and returns.
- Used from:
  - `claimUsername` — action `auth.username.claimed` (or `auth.username.changed` when releasing a prior name).
  - `setAdminClaim` — action `admin.claim.set`.

### Welcome credit refactor

**Deferred.** The existing `onUserCreate` trigger is idempotent in practice (it uses `set({...}, { merge: true })` so re-running it is safe) and Phase 3 has no consumer that needs to re-grant credits. A dedicated callable + audit lands when Phase 10 wires real payments. Documented in this plan.

### Indexes

Add only what current rules + planned queries actually need:

| New index | Reason |
|---|---|
| `auditLogs (createdAt DESC)` | admin "recent activity" view (Phase 18). |
| `auditLogs (actorUid ASC, createdAt DESC)` | "what did X do" view. |
| `auditLogs (targetType ASC, targetId ASC, createdAt DESC)` | "what happened to X" view. |
| `payments (userId ASC, createdAt DESC)` | user's own payment history. |
| `flags (status ASC, createdAt DESC)` | moderation queue. |
| `tickets (createdBy ASC, status ASC, updatedAt DESC)` | user's own tickets sorted by activity. |
| `statuses (ownerUid ASC, createdAt DESC)` | own status list. |
| `statuses (expiresAt ASC)` | scheduled purge of expired statuses (Phase 7). |

Skipped on purpose: `gatewayHealth` and `smsQuotaUsage` use deterministic doc IDs (`yyyymmdd` and `{uid}/{yyyymmdd}`), no composite index needed.

---

## Files expected to change

**Create**
- `docs/OFFLINESMS_PHASE_3_PLAN.md` (this file)
- `docs/OFFLINESMS_DATA_MODEL.md` — single source of truth for new collections
- `functions/src/lib/auditLog.ts`

**Edit**
- `firestore.rules`
- `firestore.indexes.json`
- `functions/src/auth/claimUsername.ts` — call `writeAuditLog`
- `functions/src/auth/setAdminClaim.ts` — call `writeAuditLog`
- `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md`
- `docs/OFFLINESMS_RISK_REGISTER.md`
- `docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md`
- `docs/OFFLINESMS_PHASE_LOG.md`

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tightened `statuses` read rules break the (currently empty) status feature | Low | Low | Status UI is a placeholder; only seed data uses the collection. Default semantics remain "all signed-in users" for docs without the new fields. |
| New collections that some legacy client code accidentally writes get denied | Low | Medium | Audited every workspace; no client code reads/writes these collections today. |
| Audit-log writes inside a transaction roll back the primary action on failure | Medium | High | `writeAuditLog` is invoked **after** the transaction commits (or at top level for non-transactional callables) and never throws — failures log to `console.error` only. |
| Adding many composite indexes raises cost | Low | Low | Eight new indexes, each documented and traceable to a real query. No fan-out. |
| Receipt enum guard regresses the existing fan-out trigger | Low | Medium | The trigger writes only `status: 'pending'` which is in the allow-list. Validated. |
| `payments` deny-all-client locks out admin write paths | Low | Low | Webhook (Phase 10) writes via Admin SDK; admins reading is permitted. |

---

## Rollback plan

- All changes live on the working branch; no production deploys.
- Each commit is scoped — `git revert <hash>` undoes one piece at a time.
- The rules change lands as a single commit so it reverts cleanly.
- New collections aren't referenced anywhere outside Phase 3 docs; reverting the rules file removes all references.

---

## Test plan

The repo still has no test harness. Phase 3 follows manual validation:

- `npm run typecheck --workspaces --if-present` — must be green.
- `npm run lint --workspaces --if-present` — must be green.
- `npm run build --workspaces --if-present` — must be green.

**Manual emulator checklist (Phase 20 will automate):**
1. Authed user attempts to write `auditLogs/{x}` → denied.
2. Authed user attempts to write `gatewayHealth/{today}` → denied.
3. Authed user attempts to write `smsQuotaUsage/{self}/{today}` → denied.
4. Authed user attempts to create `payments/{x}` → denied.
5. User creates `tickets/{x}` with `createdBy == self` → allowed; reads it → allowed; another user reads it → denied.
6. User creates `flags/{x}` → allowed; non-admin tries to list flags → denied.
7. Owner writes a status with `audienceType: 'only_share_with'` and `allowedViewerUids: ['B']` → user `A` cannot read it; user `B` can.
8. Same status with `expiresAt` in the past → nobody but the owner / admin can read.
9. Receipt write with `status: 'banana'` → denied.
10. `claimUsername` call → an `auditLogs` doc with `action: 'auth.username.claimed'` appears.
11. `setAdminClaim` call → audit doc with `action: 'admin.claim.set'` appears.
12. Existing Phase 1 admin guard still allows admins through; non-admins still see `PermissionState`.
13. Existing Phase 2 profile completion still works.

---

## Acceptance criteria

1. Plan committed.
2. New collection contracts documented in `docs/OFFLINESMS_DATA_MODEL.md` (or `docs/DATA_MODEL.md` if that's where it should live).
3. `auditLogs`, `gatewayHealth`, `smsQuotaUsage` deny all client writes.
4. `payments` denies all client writes.
5. `flags`, `tickets` have safe owner-aware rules.
6. `statuses` enforces audience and expiry server-side.
7. Receipt `status` enum validated.
8. `writeAuditLog` helper exists; used by `claimUsername` and `setAdminClaim`.
9. No chat/SMS/points UI added.
10. No third-party SMS provider names introduced.
11. Phase 1 admin guard and Phase 2 profile completion unaffected.
12. `typecheck`, `lint`, `build` all green.
13. Phase log + architecture + risk register updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 3 implementation plan`
2. `feat(data): add core Firestore collection contracts and indexes`
3. `security: enforce status audience and receipt enums, lock system collections`
4. `feat(functions): add audit log helper`
5. `feat(functions): audit auth and admin bootstrap actions`
6. `docs: update phase log for phase 3`
