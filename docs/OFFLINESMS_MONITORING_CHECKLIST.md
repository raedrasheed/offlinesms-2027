# Monitoring & Incident Checklist

---

## Severity Definitions

| Severity | Definition | Response target |
|---|---|---|
| **SEV1** | Complete service outage; users cannot sign in, send messages, or access the dashboard | Immediate — respond within 15 min |
| **SEV2** | Core feature broken for a significant portion of users (e.g., SMS escalation down, points purchase failing, dashboard inaccessible) | Respond within 1 hour |
| **SEV3** | Non-critical feature degraded (e.g., export slow, search results delayed, audit log entries late) | Respond within 1 business day |

---

## 48-Hour Observation Checklist

Run these checks at the following intervals after go-live:
**T+1 h, T+4 h, T+12 h, T+24 h, T+48 h**

### Authentication

- [ ] Firebase Auth → sign-in success rate > 99%
- [ ] OTP delivery success rate > 95% (check SMS gateway dashboard)
- [ ] No unusual spike in failed OTP attempts (potential abuse indicator)

### Firestore

- [ ] Firestore → Usage: read/write/delete operations within normal range
- [ ] No sustained "quota exceeded" alerts
- [ ] No "permission-denied" spikes (check Cloud Logging `firestoreSecurityRules`)

### Cloud Functions

- [ ] All functions execution success rate > 99% (Cloud Functions → Dashboard)
- [ ] No function execution timeout spikes
- [ ] Cold-start latency within acceptable range (< 5 s for HTTP functions)
- [ ] `reapStuckBatches` ran on schedule (every 30 min) — check Logs for `sms.batch.reaped` entries
- [ ] No `sweepExpiredMessages` errors (deferred / not exported; confirm it does not appear in deployed functions list)

### SMS Gateway

- [ ] SMS delivery rate for test batch > 95%
- [ ] No spike in "undelivered" statuses
- [ ] Cool-down and audience-cap limits are being respected (no batches exceeding `MAX_RECIPIENTS_PER_BATCH`)
- [ ] No raw phone numbers in Cloud Logs

### Points / Payments

- [ ] Webhook delivery success rate > 99%
- [ ] Duplicate webhook idempotency confirmed (check for anomalous balance credits)
- [ ] No negative wallet balances

### Dashboard

- [ ] Dashboard page load time < 2 s (check Vercel / Hosting analytics or RUM)
- [ ] Search returning results within 500 ms
- [ ] Export completing within 3 s
- [ ] Audit log entries appearing within 5 s of each privileged action

### Security

- [ ] No unusual export volume (> 5 exports/user/hour)
- [ ] No unusual search volume (> 60 req/user/min)
- [ ] No access attempts to cross-org or cross-user resources in Firestore logs
- [ ] App Check rejection rate within expected range (low = good)

---

## Incident Response Steps

### SEV1 — Full Outage

1. **Identify scope**: Is it Auth, Firestore, Functions, DNS, or the hosting provider?
2. **Check Firebase Status**: https://status.firebase.google.com
3. **Check Cloud Functions logs**: `gcloud logging read "resource.type=cloud_function" --limit=50`
4. **If a bad deploy**: begin rollback immediately — see `OFFLINESMS_ROLLBACK_RUNBOOK.md`.
5. **Communicate** to affected users/stakeholders within 30 min of confirmed SEV1.
6. **Post-incident review** within 48 hours.

### SEV2 — Core Feature Down

1. Identify which feature is failing and which layer (rules, function, client).
2. Check recent deploys — did a deploy precede the failure?
3. If rules-related: redeploy previous rules version.
4. If functions-related: redeploy previous functions version.
5. If client-related: push a hotfix and tag `v1.0.1`.
6. Verify fix via smoke test for the affected feature only.

### SEV3 — Degraded Feature

1. Log the issue in the issue tracker with evidence (logs, screenshots).
2. No immediate rollback required.
3. Fix in the next patch release.

---

## Monitoring Tooling

| Tool | Purpose |
|---|---|
| Firebase Console → Functions → Dashboard | Function error rates, execution counts, latency |
| Firebase Console → Firestore → Usage | Read/write/delete volume |
| Firebase Console → Authentication | Sign-in rates, failed attempts |
| Google Cloud Logging | Full log search across all Firebase services |
| SMS gateway dashboard | Delivery rates, error codes per batch |
| Vercel / Firebase Hosting analytics | Dashboard page performance |

---

## Escalation Contacts

Document contacts here before go-live (not stored in this file — use a secure runbook):

- On-call engineer: `<name> <contact>`
- Firebase support plan: `<plan-tier and support URL>`
- SMS gateway support: `<support URL>` (no provider name in UI copy)
- Payments webhook support: `<support URL>`
