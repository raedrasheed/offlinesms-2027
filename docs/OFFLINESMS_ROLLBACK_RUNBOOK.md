# Rollback Runbook

Use this guide when a deploy needs to be reversed.
Always prefer the most targeted rollback (functions only, rules only) before
doing a full rollback.

Record the previous stable tag before every deploy:
```bash
git describe --tags --abbrev=0   # e.g. v0.9.2
```

---

## §1 — Cloud Functions Rollback

Cloud Functions are versioned by Firebase. To redeploy a previous version:

```bash
# Check out the previous stable tag
git checkout v0.9.2

# Redeploy all functions from that tag
firebase deploy --only functions

# Or redeploy a specific function
firebase deploy --only functions:functionName
```

**Verification:**
```bash
firebase functions:list
# Confirm last-updated timestamp reflects the rollback deploy
```

Check Cloud Logging for errors in the 5 min after rollback.

---

## §2 — Firestore Rules Rollback

Firebase stores a history of deployed rules versions.

### Option A — Redeploy from the previous tag (preferred)

```bash
git checkout v0.9.2
firebase deploy --only firestore:rules
```

### Option B — Restore from Firebase console

1. Open Firebase console → Firestore → Rules.
2. Click "Rules history" (top right of the Rules editor).
3. Select the previous published version.
4. Click "Restore this version".
5. Click "Publish".

**Verification:**
- Confirm the "Last updated" timestamp and rules content match the restored version.
- Run the security negative tests from `OFFLINESMS_PRODUCTION_SMOKE_TEST.md` (S1–S6).

---

## §3 — Firestore Indexes Rollback

> **Important:** Firestore indexes cannot be rolled back atomically.
> Index operations are append-only in the console; you can only add or delete indexes.

If a new index was added and needs to be removed:
1. Open Firebase console → Firestore → Indexes.
2. Find the newly created index.
3. Delete it (deletion takes several minutes).

If an existing index was deleted and needs to be restored:
1. Add the index back via `firebase deploy --only firestore:indexes` from the previous tag.
2. Wait for the index status to change from "Building" to "Enabled" (may take several minutes for large collections).

---

## §4 — Dashboard Rollback

### Vercel

```bash
# From the Vercel dashboard, promote the previous deployment to production
# Or redeploy from the previous tag:
git checkout v0.9.2
cd apps/dashboard
vercel --prod
```

### Firebase Hosting

```bash
# List recent releases
firebase hosting:releases:list

# Roll back to a previous release
firebase hosting:rollback
```

---

## §5 — Emergency Feature Disables

If a specific feature is causing harm but full rollback is too risky, use these
targeted emergency stops. Each requires a Cloud Functions config change followed
by a functions redeploy.

### Disable SMS escalation

```bash
firebase functions:config:set feature.sms_enabled=false
firebase deploy --only functions
```

The `sendSmsBatch` callable should check `feature.sms_enabled` and return
`functions/unavailable` when false.

### Disable points purchase / transfer

```bash
firebase functions:config:set feature.points_purchase_enabled=false
firebase functions:config:set feature.points_transfer_enabled=false
firebase deploy --only functions
```

### Disable dashboard CSV exports

```bash
firebase functions:config:set feature.exports_enabled=false
firebase deploy --only functions
```

### Re-enable a disabled feature

```bash
firebase functions:config:set feature.<key>=true
firebase deploy --only functions
```

---

## §6 — Full Rollback Sequence

If the entire release needs to be reversed (SEV1):

1. **Functions**: Redeploy from previous tag (`firebase deploy --only functions`).
2. **Rules**: Redeploy from previous tag (`firebase deploy --only firestore:rules`).
3. **Dashboard**: Redeploy from previous tag (Vercel or Firebase Hosting).
4. **Indexes**: Do NOT attempt to roll back indexes during a live incident unless an index is actively causing errors. Document for post-incident cleanup.
5. **Verify**: Run the mobile smoke tests M1–M4 and dashboard smoke tests D1–D3 as a minimum to confirm rollback is stable.
6. **Communicate**: Update the incident channel with rollback status.

---

## §7 — Data Rollback Limitations

Firestore does not support point-in-time restore on the Spark plan.
On Blaze plan, Firestore PITR is available for up to 7 days.

If data was corrupted by a bad deploy:
- Use Firestore PITR (if enabled) to restore affected documents.
- If PITR is not available, restore from the most recent Firestore export (schedule daily exports in production).

> Ensure daily Firestore exports are configured before go-live.
> See Firebase Console → Firestore → Import/Export → Schedule export.

---

## Post-Rollback Checklist

- [ ] All smoke-test items for affected features pass.
- [ ] Audit log shows rollback deploy action.
- [ ] Cloud Logging shows no new errors for 5 min after rollback.
- [ ] Incident ticket updated with rollback timestamp and verified-stable status.
- [ ] Root-cause analysis (RCA) document started for SEV1 and SEV2 incidents.
