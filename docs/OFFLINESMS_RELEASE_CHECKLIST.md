# OfflineSMS Release Checklist

Use this checklist for every controlled release. Tick each item; do not skip steps without an explicit waiver from the on-call lead.

---

## A. Environment variables

### Firebase
- [ ] `FIREBASE_PROJECT_ID` — points to the **production** project (not staging)
- [ ] `FIREBASE_API_KEY` (mobile + dashboard client)
- [ ] `FIREBASE_AUTH_DOMAIN`
- [ ] `FIREBASE_STORAGE_BUCKET`
- [ ] `FIREBASE_MESSAGING_SENDER_ID`
- [ ] `FIREBASE_APP_ID`
- [ ] Service account JSON mounted via secret manager for the Functions runtime; never committed

### Webhooks (server-side only)
- [ ] `PAYMENT_WEBHOOK_SECRET` — present and rotated since last known incident
- [ ] `OFFLINESMS_WEBHOOK_SECRET` — present and rotated since last known incident

### Dashboard
- [ ] `NEXT_PUBLIC_FIREBASE_*` (public client config — same project as above)
- [ ] `DASHBOARD_BASE_URL` — production hostname (e.g. `https://admin.offlinesms.app`)
- [ ] `BOOTSTRAP_ADMIN_EMAILS` — **unset or empty** in production

### Mobile
- [ ] `expo-localization` permissions configured (Android+iOS)
- [ ] Production Firebase config bundled at build time, not bundled at dev time

## B. Firebase deployment (in this order)

1. [ ] `firebase deploy --only firestore:rules` — push `firestore.rules`
2. [ ] `firebase deploy --only firestore:indexes` — push `firestore.indexes.json` and **wait for "ready" state in console** before continuing
3. [ ] `firebase deploy --only storage` — storage rules
4. [ ] `firebase deploy --only functions` — Cloud Functions (re-build first via `npm run build` in `functions/`)
5. [ ] Verify scheduled functions are registered: `firebase functions:list | grep schedule`
6. [ ] `firebase deploy --only hosting:dashboard` — dashboard (if hosting on Firebase)

## C. Admin bootstrap

- [ ] At least one `super_admin` exists. Verify with `node scripts/promoteAdmin.ts --list` (or via Firebase console claim inspection)
- [ ] If creating the first admin: `npm run promote:admin -- --email founder@example.com --role super_admin`
- [ ] Sign in to `/admin` as that user and confirm role-aware UI renders
- [ ] Verify the route guard redirects non-admin emails to `/login` (test with a second account)

## D. Data setup

- [ ] `pointsPackages` seeded — at least one active package, plus inactive legacy entries archived
- [ ] `settings/feature-flags` seeded with safe defaults
- [ ] No test users with `BOOTSTRAP_ADMIN_EMAILS` claim in production
- [ ] No mock payment data leaked from staging

## E. Smoke tests (manual, on production)

Use a real test account, not an admin account, unless the step says "admin".

- [ ] **Login** — phone OTP flow completes and returns to home tab
- [ ] **Profile completion** — username claim succeeds; display name persists
- [ ] **Direct chat** — send a text to another test user; both see it
- [ ] **Group chat** — create a group; add member; send a message
- [ ] **Receipts** — second device shows the message; sender sees delivered/read
- [ ] **SMS escalation preview** — preview shows expected eligible/excluded counts; masked phones only
- [ ] **Points wallet** — balance and reserved render; transaction history shows recent activity
- [ ] **Buy points (dev/sandbox)** — purchase succeeds via webhook path; transaction recorded
- [ ] **Transfer points** — outgoing transfer recorded; recipient credited; daily cap enforced on attempted second transfer
- [ ] **Admin dashboard** (admin account) — overview, users, groups, SMS, support, audit, settings all load without errors
- [ ] **Admin search** — query returns results in redacted form (no raw phones / emails)
- [ ] **Admin export** — CSV downloads, rate-limit kicks in after 10 attempts within an hour
- [ ] **Audit export** — CSV downloads; rate-limit kicks in after 5 attempts within an hour
- [ ] **Support ticket** (test user) — create ticket; admin can see it; admin assigns it; user sees the status change

## F. Rollback

Document the rollback plan **before** deploying:

- [ ] Note the current production git tag / commit hash: `git rev-parse HEAD`
- [ ] Note the current Firebase Functions version: `firebase functions:list`
- [ ] Pre-stage the previous version's compiled functions if functions are deploying
- [ ] If rules need rollback: keep a copy of the deployed `firestore.rules` so it can be re-pushed
- [ ] Index removals require a separate `firebase firestore:indexes:delete` and can take minutes — never roll back indexes as the first action
- [ ] Feature flags in `settings/feature-flags` are the fastest rollback for individual surfaces; toggle them first before considering a full deploy rollback

## G. Post-deploy

- [ ] Watch `firebase functions:log` for 15 minutes after deploy; investigate any unexpected error spike
- [ ] Verify scheduled functions ran on schedule by checking the Cloud Console "Scheduler" tab the next day
- [ ] Check `/admin/audit` for any expected post-deploy activity (e.g., the bootstrap admin's first login)
- [ ] Confirm error budget is not consumed: check Crashlytics / Sentry / equivalent
- [ ] Update the release notes in the team channel with the deployed commit hash and any deviations from this checklist
