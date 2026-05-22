# Deployment Runbook

Step-by-step commands for a first-time or routine deployment.
Follow sections in order. Each section has a rollback note — for full rollback
procedures see `OFFLINESMS_ROLLBACK_RUNBOOK.md`.

---

## Prerequisites

```bash
# Verify toolchain
node --version        # >= 18
npm --version         # >= 9
firebase --version    # >= 13
```

```bash
# Verify Firebase login and project
firebase login
firebase projects:list
firebase use <project-id>
```

---

## 1. Pre-deploy validation

```bash
# From repo root
npm run validate
# Runs: typecheck + lint + i18n:check + test + build
# Must exit 0 before proceeding
```

If any step fails, stop and fix the issue. Do not deploy a build that fails validation.

---

## 2. Firestore Security Rules

```bash
# Dry-run (no changes applied)
firebase deploy --only firestore:rules --dry-run

# Deploy rules
firebase deploy --only firestore:rules
```

**Verification:**
- Open Firebase console → Firestore → Rules.
- Confirm the "Last updated" timestamp matches your deploy time.
- Confirm version string in the rules file header matches the deployed content.

**Rollback note:** Previous rules version is stored in Firebase console under Rules History.
See `OFFLINESMS_ROLLBACK_RUNBOOK.md` §2.

---

## 3. Firestore Indexes

```bash
# Deploy indexes only
firebase deploy --only firestore:indexes
```

> Index builds can take several minutes after deploy. Watch the Firebase console
> Indexes page for "Building…" → "Enabled" transitions before running smoke tests.

**Verification:**
- All indexes in `firestore.indexes.json` show "Enabled" in the console.

**Rollback note:** Indexes can only be added or deleted, not rolled back atomically.
See `OFFLINESMS_ROLLBACK_RUNBOOK.md` §3.

---

## 4. Cloud Functions

```bash
# Deploy all functions
firebase deploy --only functions

# Or deploy a specific function by name
firebase deploy --only functions:functionName
```

**Verification:**
```bash
# List deployed functions and their last-updated times
firebase functions:list
```

Check that:
- All expected functions are listed.
- No functions are in "FAILED" state.
- Confirm `runtime` is the expected Node version.

**Common failure — billing not enabled:**
```
Error: HTTP Error: 403, Billing account not configured
```
Resolution: Enable billing in the Firebase / Google Cloud console.

**Rollback note:** See `OFFLINESMS_ROLLBACK_RUNBOOK.md` §1.

---

## 5. Dashboard (Next.js)

> **Important:** The dashboard uses SSR dynamic routes (no `output: 'export'` in `next.config.js`).
> Firebase Hosting static deployment (`firebase deploy --only hosting`) requires a static export
> which this app does not produce. Use **Option A (Vercel)** as the primary deployment path.
> Firebase Hosting is only viable if the Next.js on Firebase framework integration is configured
> (add `"frameworksBackend"` to `firebase.json`) — this is not currently set up.

### Option A — Vercel (recommended)

```bash
# From apps/dashboard
vercel --prod
```

### Option B — Firebase Hosting with Next.js framework adapter

Enable the experimental Firebase Hosting + Next.js integration:
```bash
firebase experiments:enable webframeworks
firebase deploy --only hosting
```

This requires adding `"frameworksBackend": { "region": "us-central1" }` to `firebase.json`.

**Verification:**
- Navigate to the dashboard URL.
- `/admin` redirects to `/login` (unauthenticated).
- Sign in as `super_admin` → full nav visible.
- Sign in as `support_agent` → restricted nav visible.

---

## 6. Admin Bootstrap

Follow `OFFLINESMS_ADMIN_BOOTSTRAP_CHECKLIST.md` to create the first `super_admin`
account if this is a first-time deployment.

---

## 7. Scheduled Jobs

Cloud Functions scheduled via Firebase Functions `schedule` triggers activate
automatically on deploy. Verify in the Firebase console under:

**Functions → Scheduled**

Expected jobs:

| Job | Schedule | Purpose |
|---|---|---|
| `pruneExpiredReservations` | Every 5 min | Release stale point reservations |
| `aggregateDailyStats` | Daily 00:05 UTC | Roll up daily stats for reports |
| `cleanupExpiredSessions` | Hourly | Prune expired admin session records |

**Verification:**
- Each job appears in the Scheduled Functions list.
- Run "trigger now" once per job to confirm it completes without error.
- Check Cloud Logging for the function name within 2 minutes of trigger.

---

## 8. Smoke Tests

Run the full production smoke-test guide:
`OFFLINESMS_PRODUCTION_SMOKE_TEST.md`

Minimum: all 36 items pass before enabling end-user access.

---

## 9. Post-deploy checks

- [ ] Firebase console → Firestore → Usage: reads/writes trending normal (not spiking unexpectedly)
- [ ] Cloud Functions → Logs: no unhandled exceptions in the first 5 minutes
- [ ] Dashboard → Audit log page: audit entries from bootstrap and smoke-test actions are present
- [ ] SMS gateway account: test batch delivered successfully with masked phone display in the dashboard
- [ ] Points wallet: test purchase webhook processed; balance updated; duplicate webhook rejected (idempotency check)
- [ ] Rate limits: search and export 429s confirmed active (use the security negative test for rate limit bypass)

---

## Common Failure Recovery

### Functions deployment stuck

```bash
# Check for ongoing deployment
firebase deploy --only functions 2>&1 | tail -40

# If stuck, wait 5 min then retry
firebase deploy --only functions
```

### Rules deployment rejected (parse error)

```bash
# Validate rules syntax locally
firebase firestore:rules:validate firestore.rules
```

Fix syntax errors, re-run `npm run validate`, then redeploy.

### Index build conflict

If a new index conflicts with an existing one:
- Delete the old index in the Firebase console.
- Wait for deletion to complete (may take several minutes).
- Re-run `firebase deploy --only firestore:indexes`.

### Functions timeout on cold start

If smoke tests fail immediately after functions deploy:
- Wait 2 minutes for cold-start initialization to complete.
- Re-run the failing smoke test.

### Missing environment variable (function throws at runtime)

```bash
firebase functions:config:get
# Verify all keys listed in OFFLINESMS_ENVIRONMENT_CHECKLIST.md are present
firebase functions:config:set key=value
firebase deploy --only functions
```
