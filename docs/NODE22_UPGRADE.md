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

Deploy from a fresh Git clone on Node 22. The existing folder `~/offlinesms-staging-847ddf0`
is not a Git checkout (no `.git`), so it can't move to the reviewed commit. It is left
untouched; only its `functions/.env.offlinesms-staging-2027`, the file staging runs with, is
copied into the new clone.

Cloud Shell's default Node is 24. Use Node 22, the version CI tests and the functions run
on, through Cloud Shell's `nvm`.

**1a. Check, changing nothing:**

```sh
ls -l ~/offlinesms-staging-847ddf0/functions/.env.offlinesms-staging-2027   # must exist
df -h ~ | tail -1                                                          # free space for npm ci
```

If the `.env` file is missing, stop and send the output.

**1b. Node 22 and a fresh clone of the reviewed commit:**

```sh
nvm install 22 && nvm use 22 && node --version          # v22.x
export GOOGLE_CLOUD_QUOTA_PROJECT=offlinesms-staging-2027  # see below
cd ~ && git clone https://github.com/raedrasheed/offlinesms-2027.git offlinesms-node22
cd ~/offlinesms-node22 && git checkout --detach <reviewed commit>
cp ~/offlinesms-staging-847ddf0/functions/.env.offlinesms-staging-2027 functions/
git log -1 --format='%h %s' && git status --short       # the reviewed commit; no other output
npm ci
mkdir -p ~/node22 && N=~/node22
```

`git status` shows nothing: Git ignores the copied `.env` file. After a Cloud Shell
reconnect, run `nvm install 22 && nvm use 22`, the `export` line, `cd ~/offlinesms-node22`,
and define `N` (and `S` in §2) again. Cloud Shell keeps only the home directory between
sessions, and nvm's Node versions are outside it, so `nvm use 22` alone fails in a new
session (seen twice on 2026-10-11). `nvm install 22` is harmless when 22 is already there.

**Why `GOOGLE_CLOUD_QUOTA_PROJECT`:** without `firebase login`, the Firebase CLI in Cloud Shell
uses Application Default Credentials. The Identity Platform admin API refuses those without a
quota project (HTTP 403, "requires a quota project"). The deploy then updates
`guardEmailSignIn` and `guardEmailSent` but stops at "Failed to register blocking trigger".
The failing request only reads the Auth config, so nothing in it changes. firebase-tools
13.35.1 sends `GOOGLE_CLOUD_QUOTA_PROJECT` as the quota project on every request. Seen on
staging on 2026-10-11.

1. **Environment file.** Keep the copied `functions/.env.offlinesms-staging-2027` exactly as it is
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
- `Error: An unexpected error has occurred.`, with
  `TypeError: Cannot read properties of undefined (reading 'access_token')` in
  `firebase-debug.log`, means the Cloud Shell access token expired during the deploy (an
  HTTP 401). firebase-tools 13.35.1 cannot renew an Application Default Credentials token
  inside a running deploy. The functions updated before the 401 stay updated; the rest of the
  group is not. Run the same group again: a new command starts with a new token. `R` re-runs
  a group once by itself:
  ```sh
  R() { S "$1" && return; echo "=== retry $1"; S "$1"; }
  ```
  Seen on staging on 2026-10-11 at `business-sms-points`, after 8 of its 15 functions.
- After `S email-guards`, run check 3.1 before the next group: the blocking functions
  decide every password sign-in and reset email.

Then:

```sh
bash scripts/release/check-runtime.sh offlinesms-staging-2027            # expect: OK, exactly the 94 functions, all on nodejs22
bash scripts/release/function-env-names.sh offlinesms-staging-2027 > $N/staging-after.tsv
node scripts/release/env-names-diff.mjs $N/staging-before.tsv $N/staging-after.tsv   # names of variables and secrets
```

`check-runtime.sh` compares the deployed names with the 94 functions this source exports
(`scripts/release/expected-functions.mjs`). It fails, listing the names, when a function is
missing, when a deployed function is not in this source, when a name is deployed twice, or
when any function is on another runtime. On a failure, stop and send the output; delete
nothing.

`env-names-diff.mjs` compares the names of each function's variables and secrets (never
their values; a secret with its version). It lists names added, grouped by name, and each new
function with all its names. It fails (exit 1) if a function, a variable name or a secret is
gone, and refuses (exit 2) an empty file or a malformed row. Platform-managed names (those
firebase-tools refuses in a `.env` file, such as `FUNCTION_SIGNATURE_TYPE` or
`FIREBASE_CONFIG`, and `LOG_EXECUTION_ID`) are listed apart and never fail it. Staging runs it
without `--forbid`, because the staging `.env` sets the phone flags; production stage 2
forbids them.

On staging on 2026-10-11 (`1c5a40c` and later):
- `PHONE_AUTH_ENABLED` and `PHONE_LINK_ENABLED` added on 82 functions. They are in the
  staging `.env` since the phone test (`STAGING_PHONE_SMS_TEST.md` §2), and were only on the
  functions deployed then. Every function is now deployed from that file, so each one has
  them. Nothing changes while `smsConfig/otp` stays stopped.
- `FUNCTION_SIGNATURE_TYPE` added on 55 functions and gone from `createPhoneContact`.
  firebase-tools sets it (`cloudevent`) on event-triggered functions only, and a `.env` cannot
  set it. Callables such as `addMembers` gained it and `createPhoneContact` lost it in the same
  deploy, so the platform sets it on callables by a rule we could not find documented. Without
  it the Functions Framework uses `http`, the right type for a callable.

## 3. Checks on staging

| # | Area | How | Expected |
|---|---|---|---|
| 3.1 | Auth guards (blocking functions) | `FIREBASE_WEB_API_KEY=<staging web apiKey> npx tsx scripts/verifyEmailSignInGuards.ts --project offlinesms-staging-2027 --reset-inbox <an inbox you read>` (an address with no account in the project: the check creates a throwaway account with it. A Gmail `+` alias such as `name+guards1@gmail.com` works) | GO. Registration of beforeSignIn → `guardEmailSignIn`, beforeSendEmail → `guardEmailSent`, beforeCreate → `onUserCreate`; password refused for a replaced address and accepted for the settled one; `verifyEmailOtp` the same; the reset email arrives. Each guarded round trip well under 7 s; run once after 20 minutes idle (cold start) and once right after |
| 3.2 | Sign-in | Staging test app: sign out, sign in by email code to an existing account; create a new account by email code | Code email arrives; same account, chats and name; the new account gets its profile (`onUserCreate`) |
| 3.3 | Email change | On a test account: change the email once, then sign in with the new address | Code to the new address; sign-in with the new address opens the same account; the old address is refused |
| 3.4 | Chat | Send a text, a sticker, a poll; vote; react | Delivered with a notification; the vote counts; the reaction shows |
| 3.5 | Phone, stopped | Open the phone sign-in screen and Settings → Add phone | No countries offered; linking reported unavailable. No job in `relayJobs` |
| 3.6 | Relay | Dashboard → Relay | The staging device shows a fresh heartbeat after `S relay` (`relayHeartbeat` on Node 22) |
| 3.7 | Phone and Relay with one SMS | Open the window as in `STAGING_PHONE_SMS_TEST.md` §4, sign in with number B, then stop as in its §6 | **1 SMS.** The code arrives through the relay (`claimRelayJobs`, `authorizeRelaySend`, `reportRelayDelivery`), sign-in opens B's account. Afterwards: `emergencyStop: true`, relay `paused` |
| 3.8 | Scheduled functions | `gcloud scheduler jobs list --project offlinesms-staging-2027 --location us-central1`, then for each of the four jobs `gcloud scheduler jobs run firebase-schedule-<function>-us-central1 --project offlinesms-staging-2027 --location us-central1`, then `npx firebase functions:log --project offlinesms-staging-2027 --only escalateOrgBatches,relayReaper,reapStuckBatches,reconcileEmailChangeWrites` | 4 jobs `ENABLED`: `escalateOrgBatches` (every minute), `relayReaper` (every minute), `reconcileEmailChangeWrites` (every 15 minutes), `reapStuckBatches` (every 30 minutes). Each run logs a start and no error. No job for `sweepExpiredMessages`: it is deliberately not exported (`functions/src/index.ts`) and stays off |
| 3.9 | Firestore triggers | During 3.4 and 3.7 | `onMessageCreate` and `onMessageCreateNotify` run for each message; writing the stop in 3.7 runs `onOtpPolicyWritten` with no error |

Logs throughout: `npx firebase functions:log --project offlinesms-staging-2027` must show no
error other than the refusals the checks expect.

**`reapStuckBatches` needs an index.** On staging every run (Node 20 before the deploy, Node 22
after) failed with `FAILED_PRECONDITION: The query requires an index`: its query
(`status ==`, `createdAt <=`) needs `smsBatches` (`status`, `createdAt` ascending), and only
the descending index existed. `firestore.indexes.json` now has it. Deploy it, wait for
`READY`, then run the job again. The file's `relayJobs` (`kind`, `status`) entry no longer
lists `__name__`; with it, the deploy offered to delete that live index and then stopped with
HTTP 409 "index already exists" (`PRODUCTION_RELEASE.md` §3).
```sh
npx firebase deploy --project offlinesms-staging-2027 --only firestore:indexes   # expect no delete prompt; if one appears, answer No
gcloud firestore indexes composite list --project offlinesms-staging-2027 --filter="name~smsBatches"
gcloud scheduler jobs run firebase-schedule-reapStuckBatches-us-central1 --project offlinesms-staging-2027 --location us-central1
```

**3.8 runs only jobs that already run on their schedule.** Running one by hand brings its
next run forward; it enables nothing. `sweepExpiredMessages` is not deployed, scheduled or
run by this upgrade.

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
| 1 clone, Node 22, `.env` copied | | commit, `node --version` |
| 2 runtime: exactly the 94, all on nodejs22 | | |
| 2 names diff empty | | |
| 3.1 Auth guards | GO / NO-GO | cold and warm round trips |
| 3.2 Sign-in | | |
| 3.3 Email change | | |
| 3.4 Chat | | |
| 3.5 Phone, stopped | | |
| 3.6 Relay heartbeat | | |
| 3.7 One SMS (optional) | | |
| 3.8 Scheduled functions (4 jobs) | | |
| 3.9 Firestore triggers | | |
