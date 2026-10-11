# Functions on Node.js 22: staging deploy and checks

**Why:** from 2026-10-30, Cloud Functions no longer creates or redeploys functions on
Node.js 20. Functions already deployed are not guaranteed to be switched off on that
date, but none of them could be fixed or rolled back on Node.js 20 after it.

**What changed:** the commit `Functions: run on Node.js 22`.
- `functions/package.json` engines is `"22"`.
- `firebase.json` sets no `runtime`, so engines alone decides the deployed runtime.
  `functions/__tests__/functionsRuntime.test.ts` keeps engines, the lockfile, `firebase.json`
  and every workflow's Node version in step.
- CI and the release workflow run on Node 22.
- No dependency changed: firebase-functions 6.6.0 and firebase-admin 12.7.0 support
  Node 22, and firebase-tools 13.35.1 deploys `nodejs22`.

**Order:**
1. Codex reviews the commit and its CI.
2. Staging: deploy and check, as below.
3. Production continues with `PRODUCTION_RELEASE.md`. Stage 2 there deploys on Node 22.

Production is not touched here: no deploy, no setting, no secret. The production SMS
suspension stays as it is.

---

## 1. Before deploying (Cloud Shell)

```sh
cd ~/release && git fetch origin claude/phone-email-login-display-names-pu9nez
git checkout <reviewed commit>
npm ci
mkdir -p ~/node22 && N=~/node22
```

1. **Environment file.** Keep `functions/.env.offlinesms-staging-2027` exactly as it is
   (`EMAIL_CHANGE_VERIFICATION.md` §2 and `STAGING_PHONE_SMS_TEST.md` §2). The deploy reads
   it; nothing is added or removed.
2. **Staging stays stopped.** In the staging Firestore, `smsConfig/otp` shows
   `emergencyStop: true` and `enabled: false`, and the relay device is `paused`
   (`STAGING_PHONE_SMS_TEST.md` §6).
3. **Inventory, names only:**
   ```sh
   bash scripts/release/function-env-names.sh offlinesms-staging-2027 > $N/staging-before.tsv
   cut -f2 $N/staging-before.tsv | sort | uniq -c        # expect nodejs20 today
   ```

## 2. Deploy, one group at a time

The same groups as production (`scripts/release/function-groups.json`, 94 functions),
always with `--project offlinesms-staging-2027`:

```sh
S() { npx firebase deploy --project offlinesms-staging-2027 --only "$(node scripts/release/deploy-only.mjs "$1")"; }
S email-guards
S chat
S groups
S accounts-admin
S business-sms-points
S relay
S phone
S email-change
```

- Each function is rebuilt on `nodejs22`. A deploy that stops on a quota error is re-run
  with the same command.
- After `S email-guards`, run check 3.1 before the next group: the blocking functions
  decide every password sign-in and reset email.

Then:

```sh
bash scripts/release/check-runtime.sh offlinesms-staging-2027            # expect: all 94 on nodejs22
bash scripts/release/function-env-names.sh offlinesms-staging-2027 > $N/staging-after.tsv
diff <(cut -f1,3,4 $N/staging-before.tsv) <(cut -f1,3,4 $N/staging-after.tsv)   # names of variables and secrets
```

The `diff` must print nothing, except new rows if staging lacked a function before.
No variable or secret name may disappear.

## 3. Checks on staging

| # | Area | How | Expected |
|---|---|---|---|
| 3.1 | Auth guards (blocking functions) | `FIREBASE_WEB_API_KEY=<staging web apiKey> npx tsx scripts/verifyEmailSignInGuards.ts --project offlinesms-staging-2027 --reset-inbox <an inbox you read>` | GO. Registration of beforeSignIn → `guardEmailSignIn`, beforeSendEmail → `guardEmailSent`, beforeCreate → `onUserCreate`; password refused for a replaced address and accepted for the settled one; `verifyEmailOtp` the same; the reset email arrives. Each guarded round trip well under 7 s; run once after 20 minutes idle (cold start) and once right after |
| 3.2 | Sign-in | Staging test app: sign out, sign in by email code to an existing account; create a new account by email code | Code email arrives; same account, chats and name; the new account gets its profile (`onUserCreate`) |
| 3.3 | Email change | On a test account: change the email once, then sign in with the new address | Code to the new address; sign-in with the new address opens the same account; the old address is refused |
| 3.4 | Chat | Send a text, a sticker, a poll; vote; react | Delivered with a notification; the vote counts; the reaction shows |
| 3.5 | Phone, stopped | Open the phone sign-in screen and Settings → Add phone | No countries offered; linking reported unavailable. No job in `relayJobs` |
| 3.6 | Relay | Dashboard → Relay | The staging device shows a fresh heartbeat after `S relay` (`relayHeartbeat` on Node 22) |
| 3.7 | Phone and Relay with one SMS | Open the window as in `STAGING_PHONE_SMS_TEST.md` §4, sign in with number B, then stop as in its §6 | **1 SMS.** The code arrives through the relay (`claimRelayJobs`, `authorizeRelaySend`, `reportRelayDelivery`), sign-in opens B's account. Afterwards: `emergencyStop: true`, relay `paused` |
| 3.8 | Scheduled functions | `gcloud scheduler jobs list --project offlinesms-staging-2027 --location us-central1`, then for each job `gcloud scheduler jobs run <job> --project offlinesms-staging-2027 --location us-central1`, then `npx firebase functions:log --project offlinesms-staging-2027 --only relayReaper,escalateOrgBatches,sweepExpiredMessages,reapStuckBatches,reconcileEmailChangeWrites` | 5 jobs `ENABLED` (`firebase-schedule-<function>-us-central1`); each run logs a start and no error |
| 3.9 | Firestore triggers | During 3.4 and 3.7 | `onMessageCreate` and `onMessageCreateNotify` run for each message; writing the stop in 3.7 runs `onOtpPolicyWritten` with no error |

Logs throughout: `npx firebase functions:log --project offlinesms-staging-2027` must show no
error other than the refusals the checks expect.

**3.7 is the only step that sends an SMS.** Skip it if the relay phone is not at hand;
3.1 to 3.6 then still cover the runtime, and production stage 7 keeps its own monitored
test.

## 4. Rollback (staging)

- **Until 2026-10-29:** redeploy the affected group from the previous commit (engines 20)
  with the same `S <group>` command in that checkout.
- **From 2026-10-30:** Node.js 20 can no longer be deployed. Fix forward on Node 22, or
  redeploy older source with its engines changed to `"22"` in a scratch checkout.

## 5. Next runtime deadline

The runtime table in firebase-tools 13.35.1 lists Node.js 22 as deprecated from
**2027-04-30** and decommissioned on **2027-10-31**. Check Google's runtime support page
before then and plan the next move early.

## 6. Results record

| Check | Result | Notes |
|---|---|---|
| 2 runtime: all 94 on nodejs22 | | |
| 2 names diff empty | | |
| 3.1 Auth guards | GO / NO-GO | cold and warm round trips |
| 3.2 Sign-in | | |
| 3.3 Email change | | |
| 3.4 Chat | | |
| 3.5 Phone, stopped | | |
| 3.6 Relay heartbeat | | |
| 3.7 One SMS (optional) | | |
| 3.8 Scheduled functions | | |
| 3.9 Firestore triggers | | |
