# Phase 21 — Controlled Production Rollout

## Objective

Prepare OfflineSMS for a controlled production rollout. No new product features.
All deliverables are operational documentation, validation checklists, and runbooks
that the release engineer follows to move from staging to production.

---

## Scope

| Deliverable | File |
|---|---|
| Environment & secrets checklist | `OFFLINESMS_ENVIRONMENT_CHECKLIST.md` |
| Deployment runbook | `OFFLINESMS_DEPLOYMENT_RUNBOOK.md` |
| Admin bootstrap checklist | `OFFLINESMS_ADMIN_BOOTSTRAP_CHECKLIST.md` |
| Production smoke-test guide | `OFFLINESMS_PRODUCTION_SMOKE_TEST.md` |
| Release tagging guide | `OFFLINESMS_RELEASE_TAGGING.md` |
| Monitoring & incident checklist | `OFFLINESMS_MONITORING_CHECKLIST.md` |
| Rollback runbook | `OFFLINESMS_ROLLBACK_RUNBOOK.md` |

---

## Release Gates (all must be green before go-live)

1. **CI** — `npm run validate` passes on the release branch (typecheck + lint + i18n:check + test + build).
2. **Firestore rules** — `npm run test:rules` passes locally against the emulator (all 6 rule suites).
3. **Environment checklist** — every required variable is set in the production Firebase project; no placeholder values remain.
4. **Admin bootstrap** — at least one `super_admin` account exists in the live project.
5. **Smoke tests** — all 36 items in `OFFLINESMS_PRODUCTION_SMOKE_TEST.md` pass in a pre-production staging environment.
6. **Security negative tests** — all 6 security negative tests in the smoke-test guide pass.
7. **Audit log** — at least one privileged action has been performed and the audit log record is verified.
8. **Rate limits** — confirmed active in production (search, export limits respected).
9. **Redaction** — confirmed no raw phones or emails appear in any dashboard table or CSV export.
10. **Points balance** — wallet balance/reserved arithmetic verified correct for at least one test user.

---

## Deployment Sequence

1. Merge release branch into `main`.
2. Tag release (`v1.0.0`) — see `OFFLINESMS_RELEASE_TAGGING.md`.
3. Complete environment checklist — see `OFFLINESMS_ENVIRONMENT_CHECKLIST.md`.
4. Deploy Firestore rules & indexes.
5. Deploy Cloud Functions.
6. Deploy Next.js dashboard (Vercel or Firebase Hosting).
7. Bootstrap admin account — see `OFFLINESMS_ADMIN_BOOTSTRAP_CHECKLIST.md`.
8. Run smoke tests — see `OFFLINESMS_PRODUCTION_SMOKE_TEST.md`.
9. Enable scheduled jobs.
10. Begin 48-hour observation — see `OFFLINESMS_MONITORING_CHECKLIST.md`.

---

## Constraints

- No new product features.
- No new chat features, media messages, calls, payment-provider UI, admin wallet adjustment, moderation workflow.
- No secrets committed to the repository.
- No changes to Firestore rules or SMS/wallet lifecycle unless fixing a release blocker.
- No disabling of tests, guards, rate limits, or redaction.

---

## Acceptance Criteria

- [ ] All eight documentation files created and committed.
- [ ] `npm run validate` still passes.
- [ ] `npm run test:rules` documented as local-only (CI note preserved).
- [ ] Phase 21 entry added to `OFFLINESMS_PHASE_LOG.md`.
