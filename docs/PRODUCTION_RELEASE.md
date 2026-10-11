# Production release: phone and email sign-in, display names, chat features

Owner approval: Raed, 2026-10-11 09:04 UTC, to move to production with every change
(user app, Relay, Dashboard). **Order:** Codex reviews this package first; only stages that
pass review are executed. Verification SMS stays suspended in production until stage 7.

Project `offlinesms-prod-2027`. Every Firebase command names it with `--project`, because
`.firebaserc` defaults to it and a typo must not land anywhere else. **Never run a bare
`firebase deploy` or `--only functions`.** Every function deploy names its functions through
`scripts/release/deploy-only.mjs`.

**Contents**
- §0 What ships, and what stays off
- §1 Final commit and merge order
- §2 Before any change: backups and inventory (stage 0)
- §3 Stage 1: rules and indexes
- §4 Stage 2: functions, in groups, phone flags unset
- §5 Stage 3: Dashboard
- §6 Stage 4: user app 2.4.0
- §7 Stage 5: email change on
- §8 Stage 6: Relay 0.2.1 on the production phones
- §9 Stage 7: verification SMS, small limits, monitored test
- §10 Stage 8: expansion
- §11 Rollback
- §12 Remaining security limits
- §13 Who does what

---

## 0. What ships, and what stays off

| Part | Today in production | After this release |
|---|---|---|
| Functions | 20 phone/relay functions at `d3cafc76` (2026-10-08), 65 at older source; 85 in total. Node.js 20 | All 94 at the release commit; 9 are new. Still Node.js 20 (see §11.4) |
| Rules | ruleset `0b9413c8…` from `d3cafc76` | `+20` lines: admin-read rules for the email-change records. Nothing else changes |
| Indexes | 50 composite indexes | Unchanged (`firestore.indexes.json` equals `d3cafc76`) |
| Dashboard | `dash.offlinesms.com` (DigitalOcean, Next.js server) | Display names, SMS policy switches and limits, Relay caps. The login no longer follows `?next=` to other sites |
| User app | 2.3.18 (versionCode 15) | 2.4.0 (16): phone/email sign-in on one account, add and edit both methods, real names, emoji, stickers, polls, responsiveness and notification fixes |
| Relay | Older build on the production phones | 0.2.1 (3), same signing key as the installed relay |
| Verification SMS | Suspended (`enabled:false`, `emergencyStop:true`) | Suspended until stage 7 opens it with small limits |
| Email change | Not deployed | Deployed switched off; turned on in stage 5 |

`functions/src`, the rules and the indexes are unchanged since `925b812`, the commit whose
functions ran on staging for the phone test. Check before stage 1:
`git diff --stat 925b812 <final> -- functions/src firestore.rules firestore.indexes.json`
must print nothing.

---

## 1. Final commit and merge order

PR #30 is stacked on PR #29, which is stacked on PR #28. Main was merged into the PR #30
branch (`e4b3b72`) with no conflicts, so the release tree is the PR #30 head.

1. **Codex reviews** this document, the PR #30 head, and §12.
2. **DigitalOcean autodeploy.** Before merging, open the Dashboard app on DigitalOcean →
   Settings → the component's Source. If **Autodeploy** is on, turn it off. Otherwise a
   merge to `main` would publish the new Dashboard before stage 3. Turn it back on after
   stage 3 if you want it.
3. Mark #28, #29 and #30 ready for review, then merge them with merge commits, not squash,
   in this order:
   - #28 into `main`;
   - retarget #29 to `main`, then merge it;
   - retarget #30 to `main`, then merge it.
4. **Final commit** = `main` after #30's merge. Check that it equals the reviewed tree:
   `git diff <PR #30 head> <final>` prints nothing.
5. CI runs on the push to `main`. Every job must be green on the final commit before
   stage 1.

Merging deploys nothing: Firebase deploys and the Dashboard are manual, and Play gets only
what stage 4 uploads.

---

## 2. Before any change: backups and inventory (stage 0)

In Cloud Shell, signed in as the project owner:

```sh
git clone https://github.com/raedrasheed/offlinesms-2027.git release && cd release
git checkout <final>            # the exact final commit
npm ci && npm --prefix functions ci
mkdir -p ~/release-backup && B=~/release-backup
```

1. **Functions environment.** Copy `functions/.env.offlinesms-prod-2027` from the checkout
   that deployed `requestEmailOtp` into this checkout, and keep a copy in `$B`. It must:
   - provide `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_PROVIDER`, as today;
   - **not** set `PHONE_AUTH_ENABLED` or `PHONE_LINK_ENABLED` (they come in stage 7);
   - **not** set `EMAIL_CHANGE_TEST_FAULTS` (production ignores it in any case,
     `functions/src/emailChange/logic.ts:125`);
   - keep `APPCHECK_ENFORCE` / `APPCHECK_CONSUME` as they are (unset today).

   `PHONE_HASH_PEPPER` stays in Secret Manager at version 1. It is not rotated; rotating it
   would orphan every phone number already claimed.
2. **Function inventory, names only:**
   `bash scripts/release/function-env-names.sh offlinesms-prod-2027 > $B/functions-before.tsv`.
   It lists each function's runtime and the *names* of its variables and secrets, never
   their values. Expect 85 rows.
3. **Settings snapshot:**
   `npx tsx scripts/release/snapshotConfig.ts --project offlinesms-prod-2027 --out $B/config-before.json`.
   It saves `smsConfig/*`, `systemSettings/*`, the relay devices' routing settings, open
   relay jobs and email changes mid-way, with credentials redacted. Expect
   `enabled=false emergencyStop=true` and 0 email changes.
4. **Indexes:** `npx firebase firestore:indexes --project offlinesms-prod-2027 > $B/indexes-before.json`.
5. **Rules:** the live ruleset is `d3cafc76`'s file
   (`git show d3cafc76:firestore.rules > $B/firestore.rules.before`; SHA-256 `9de733f9…`).
6. **Data export (managed backup).** Find the database location, create a bucket there once,
   then export:
   ```sh
   LOC=$(gcloud firestore databases describe --database='(default)' --project offlinesms-prod-2027 --format='value(locationId)')
   gcloud storage buckets create gs://offlinesms-prod-2027-backups --project offlinesms-prod-2027 --location="$LOC" --uniform-bucket-level-access   # first time only
   gcloud firestore export gs://offlinesms-prod-2027-backups/$(date -u +%Y%m%dT%H%MZ)-before-2.4.0 --project offlinesms-prod-2027
   ```
   Wait for `SUCCESSFUL` (`gcloud firestore operations list --project offlinesms-prod-2027`).
   Restoring from it is a last resort: an import overwrites documents with the same IDs.
7. **App and Relay versions:** note the current Play production versionCode (expected 15),
   and each production relay's app version in Dashboard → Relay.

---

## 3. Stage 1: rules and indexes

```sh
npx firebase deploy --project offlinesms-prod-2027 --only firestore:rules,firestore:indexes
```

- Rules: four additive `match` blocks (`emailChangeChallenges` closed;
  `emailChangeOps`, `emailChangeAuthWrites`, `emailChangeLimits` admin read-only).
- Indexes: the file equals the live set. If the CLI offers to **delete** an index that is
  not in the file, answer **No**.
- **Check:** `firebase firestore:indexes` matches `$B/indexes-before.json`; the app still
  opens chats.
- **Rollback:** `cp $B/firestore.rules.before firestore.rules` in a scratch checkout and
  deploy `--only firestore:rules`.

---

## 4. Stage 2: functions, in groups, phone flags unset

`scripts/release/function-groups.json` puts all 94 exported functions in exactly one group
(a test enforces it). Deploy one group at a time, in this order, and check each before the
next. A deploy that stops on a quota error is re-run with the same command; deploys are
idempotent.

```sh
D() { npx firebase deploy --project offlinesms-prod-2027 --only "$(node scripts/release/deploy-only.mjs "$1")"; }
```

| Step | Command | Check before the next step |
|---|---|---|
| 2a | `D email-guards` | **Check A** of `EMAIL_CHANGE_VERIFICATION.md` §5: registration GO, the three refused routes GO (`--allow-production`), email-code sign-in on the store app, clean logs |
| 2b | `D chat`, then `D groups` | In the 2.3.18 store app: send text and an image, react, open a group, add a member. Stickers and polls from 2.4.0 reach old apps as emoji and text |
| 2c | `D accounts-admin`, then `D business-sms-points` | A new account by email code is created normally (`onUserCreate`); the Dashboard user list loads; `confirmPaymentMock` refuses (`permission-denied`) |
| 2d | `D relay`, then `D phone` | Policy still stopped: the phone screen offers no countries; `getPhoneLinkStatus` reports linking unavailable; Dashboard → Relay shows the devices as before |
| 2e | `D email-change` | **Check B** of `EMAIL_CHANGE_VERIFICATION.md` §5: switch off, zero changes |

After 2e:
`bash scripts/release/function-env-names.sh offlinesms-prod-2027 > $B/functions-after.tsv`
and `diff $B/functions-before.tsv $B/functions-after.tsv`. Expect 9 new rows and no
variable or secret name removed from an existing function. The six pepper-bound functions
must still show `PHONE_HASH_PEPPER:1`.

**Rollback:** see §11.2.

---

## 5. Stage 3: Dashboard

**URL:** `https://dash.offlinesms.com`. It is a Next.js 14 server app on DigitalOcean, not
Firebase Hosting.

**Build:** from the repository root, `npm ci && npm --prefix apps/dashboard run build`;
start with `npm --prefix apps/dashboard start`. Use the build and run commands the
DigitalOcean app already has; only the source commit changes.

**Settings** (DigitalOcean → App → Settings → Environment variables; values are not
written here):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (secure session cookie) |
| `NEXT_PUBLIC_FIREBASE_*` (6) | the production web config (`offlinesms-prod-2027`) |
| `FIREBASE_ADMIN_PROJECT_ID` | `offlinesms-prod-2027` |
| `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY` | unchanged |
| `BOOTSTRAP_ADMIN_EMAILS` | **empty**, after confirming your account has the admin claim (below) |

**Access:**
- Settings → Verification SMS (switches, limits, emergency stop) needs a platform admin:
  `super_admin`, or the legacy `admin` claim.
- Relay caps also need a platform admin. Pairing, pause, resume, revoke and countries need
  `manage:relay`.
- Confirm your own claim before emptying the bootstrap list. Sign in and check the role:
  it must be `super_admin` or `admin`, not `bootstrap_admin`. If it is the bootstrap role,
  first run `npm run promote:admin -- <your email>` (`docs/admin-bootstrap.md`).
- Firebase Auth → Settings → Authorized domains must list `dash.offlinesms.com`, for the
  Google sign-in popup.

**Deploy:** in DigitalOcean, deploy the final commit; or `doctl apps create-deployment <app-id>`
when the app tracks `main`.

**Check:**
- Sign in and confirm the role.
- Users and chats show names, not UIDs.
- Settings → Verification SMS shows `Emergency stop` and the limits with their defaults as
  placeholders. **Do not change anything yet.**
- Relay lists each device with its caps (minute/hour/day).
- `/login?next=https://example.com` lands on `/admin` after sign-in.

**Rollback:** redeploy the previous deployment in DigitalOcean (Activity → previous →
Redeploy). The Dashboard writes only through Firestore, so an older Dashboard keeps working.

---

## 6. Stage 4: user app 2.4.0

**Build:** Actions → *Production Android release* → Run workflow on `main`, with
`commit = <final>` and `target = user-app`. Settings: §13.2.

**What the workflow refuses:**
- any commit other than the input;
- any branch other than `main`;
- a missing setting;
- a project other than `offlinesms-prod-2027`;
- an upload key whose certificate is not `MOBILE_UPLOAD_CERT_SHA256`, or that is the
  repository's test key;
- an APK or AAB signed by anything else;
- Firebase values inside the APK that differ from production;
- a package other than `app.offlinesms.mobile`;
- versions that differ from the source;
- a debuggable build;
- native libraries not aligned to 16 KB.

**Artifact `offlinesms-production-user-app`:** the AAB, an APK of the same build, and
`BUILD-INFO.txt`. BUILD-INFO records the package, version, project, commit, run, both
signatures, the expected fingerprint, the signature schemes, the alignment and SHA-256 of
each file. **Codex reviews BUILD-INFO before anything is uploaded.**

**Release:**
1. Play Console → Internal testing → upload the AAB.
2. Play re-signs it with the app signing key. Check that the Play-delivered app's
   certificate is `CC:B6:5F:82:…:99:D1`, the fingerprint in
   `apps/website/.well-known/assetlinks.json` (App integrity → App signing key certificate).
   If it differs, stop: app links would break.
3. On two phones, install from the internal track over 2.3.18 and run
   `docs/DEVICE_VALIDATION.md` §3–§6. Then: email sign-in into an existing account, the
   chats still present (local DB upgrade), a sticker, a poll, a reaction from the full
   emoji set, a notification tap opening the message, and real names.
   - Phone rows show "Not available yet" while SMS is suspended.
4. Production track → staged rollout at 10%. Watch Play Console → Android vitals (crashes,
   ANRs) for 24 hours, then 50%, then 100%.

**The APK is not for installing over the store app:** it carries the upload signature, not
Play's.

**Rollback:** Play cannot downgrade installed apps.
- Halt the staged rollout (Release → Halt).
- Ship 2.4.1 with the fix, or with the previous code at a higher versionCode.
- The server stays compatible with 2.3.18 and 2.4.0 alike.

---

## 7. Stage 5: email change on

After 2.4.0 is on the internal track and stage 2e passed:
**Stage C** of `EMAIL_CHANGE_VERIFICATION.md` §5. Set
`systemSettings/general.emailChangeEnabled = true`, optionally change a test account's
email once, then run the stage-A route check again.

**Rollback:** §11.3.

---

## 8. Stage 6: Relay 0.2.1 on the production phones

**Signing key:**
- 0.2.1 must be signed with the key of the relay installed on the production phones,
  otherwise Android refuses the update.
- Read that certificate from a phone (Android SDK platform-tools in Cloud Shell or on a
  computer):
  ```sh
  adb shell pm path app.offlinesms.business        # → package:/data/app/…/base.apk
  adb pull <that path> installed-relay.apk
  apksigner verify --print-certs installed-relay.apk | grep 'certificate SHA-256'
  ```
- Put that fingerprint in `RELAY_RELEASE_CERT_SHA256` and the matching keystore in the
  `RELAY_RELEASE_*` secrets.
- **If that keystore no longer exists**, an update in place is impossible. Re-enrollment is
  a separate decision:
  1. drain;
  2. pause;
  3. uninstall;
  4. install a build signed with a new production key;
  5. pair with a new code;
  6. revoke the old device.

  The repository test key is never used in production; the workflow refuses it.

**Build:** Run workflow with `target = relay`. Artifact `offlinesms-production-relay`
(APK + BUILD-INFO). Codex reviews it before installation.

**Install, one phone at a time:**
1. Dashboard → Relay → **Pause** the device. A pause stops new claims; heartbeats don't
   undo it.
2. Wait until the queue shows 0 claimed and 0 sending for it.
3. `adb install -r` the APK, or open it on the phone. An update keeps the enrollment.
4. Open the app. It must show Online, and the Dashboard must show app 0.2.1 with a fresh
   heartbeat.
5. Set its caps to **1 / 5 / 20** (Dashboard → Relay → Edit caps) and its countries to
   `PS`.
6. **Leave it paused** until stage 7.

**Rollback:** pause the device in the Dashboard. The relay's code is unchanged since
`d3cafc76`; only its version moved. Android refuses an older version over 0.2.1 on a
production phone, so going back to the old build means uninstalling and pairing again.

---

## 9. Stage 7: verification SMS, small limits, monitored test

### 9.1 Gate (all required)

- Staging completion tests T1–T13 (`STAGING_PHONE_SMS_TEST.md` §5b) recorded in its §7.
  This is not the first-SMS test.
- Codex reviewed those results.
- Stages 1–6 done, 2.4.0 on the test phones, at least one relay at 0.2.1 online (paused).
- Production policy still `enabled:false`, `emergencyStop:true`.

### 9.2 Switches, in this order

1. **Limits (Dashboard → Settings → Verification SMS → Send limits)**, before anything
   is opened:

   | Group | Values |
   |---|---|
   | Sign-in | global 5/h, 20/day · destination 2/h, 3/day · source 3/h, 10/day · install 3/day |
   | Add phone | global 5/h, 20/day · account 2/h, 3/day · destination 2/h, 3/day |
   | Both | 5/h, 20/day |

   Relay caps 1/5/20, from stage 6.
2. **Purpose flags (Cloud Shell).** Add to `functions/.env.offlinesms-prod-2027`:
   `PHONE_AUTH_ENABLED=true` and `PHONE_LINK_ENABLED=true`. Then `D phone-flags`: the 21
   functions whose code reads the flags (a test keeps that list exact). The policy is
   still stopped, so nothing is sent.
3. **Check:** the phone screen still offers nothing (`service-paused`).
4. **Open sign-in only:**
   - Dashboard → lift the emergency stop;
   - Verification SMS enabled;
   - Phone sign-in on;
   - Add phone off;
   - resume the relay.

### 9.3 Monitored test (at most 6 SMS, Raed's own numbers only)

Keep Dashboard → Relay (queue) and
`npx firebase functions:log --project offlinesms-prod-2027 --only requestPhoneAuthCode,verifyPhoneAuthCode,requestPhoneLinkOtp,verifyPhoneLinkOtp,claimRelayJobs,authorizeRelaySend,reportRelayDelivery`
open throughout.

| # | Action | Expected | SMS |
|---|---|---|---|
| P1 | New account with number B | code arrives on B; account created | 1 |
| P2 | Sign out; sign in with B; enter a wrong code once, then the right one | `code-invalid` with attempts left, then the same account | 1 |
| P3 | Request again for B twice quickly | the third request of the hour is refused `rate-limited` (destination 2/h); no job | 1 |
| P4 | Turn on Add phone. On an email-only account, add number C | code arrives; number linked | 1 |
| P5 | Sign out; sign in with C | the same account as the email (same UID, chats, name) | 1 |
| P6 | Emergency stop in the Dashboard, then request a code | `service-paused`; no job; nothing queued | 0 |

**Stop at once, using the emergency stop, if any of these happens:**
- an SMS goes to a number not in the test;
- a job stays `queued` or `claimed` for more than 2 minutes;
- `failed` rises without a reason;
- an error appears in the logs;
- any expected row does not match.

After P6, lift the stop only if P1–P5 matched.

### 9.4 After the test

- Leave sign-in and add-phone on with the small limits for 48 hours.
- Each day, check:
  - the relay's sent/failed counts;
  - `smsRateLimits` growth;
  - that no unknown destination appears in the jobs.

**Rollback:** Dashboard → Emergency stop. It stops new codes at once and cancels queued
ones. Then turn Verification SMS off. A code already on the relay's modem cannot be
recalled. The env flags may stay; the policy is the switch.

---

## 10. Stage 8: expansion

Raising limits, adding relays or countries is a separate decision: Raed approves it after
the 48 hours, and Codex reviews the numbers. Raise one group at a time, never more than
the bounds the Dashboard enforces.

---

## 11. Rollback

### 11.1 Order and principle

Roll back the most recent stage first:
1. emergency stop (SMS);
2. Play halt (app);
3. DigitalOcean redeploy (Dashboard);
4. functions by group;
5. rules.

Data stays: no stage migrates or deletes documents.

### 11.2 Functions

Prefer a forward fix. If a group must go back, redeploy it from a scratch checkout of the
previous source, with the same `.env` file:
- `d3cafc76` for the `relay` and `phone` groups (flags unset);
- the other 65 functions: their exact source was never recorded (Firebase source hash
  `2656c210…` is not a Git commit). The closest known state is `main` before the release
  merges, `366128a`.

- **Do not remove** the nine new functions while email changes can still land. Stop them
  first with §11.3.
- `onOtpPolicyWritten` and `relayReaper` must stay deployed while any relay job is open.

### 11.3 Email change

The rollback in `EMAIL_CHANGE_VERIFICATION.md` §5 applies unchanged:
1. switch off (`emailChangeEnabled=false`), effective at once;
2. keep the guards, `verifyEmailOtp`, `deleteMyAccount`, the change functions and the
   scheduled repair deployed;
3. run `npx tsx scripts/emailChangeDrainStatus.ts --project offlinesms-prod-2027` until
   DRAINED.

Only then may any of them be removed or rolled back. Rolling back the `email-guards` group
while a change is mid-way would reopen the replaced address. The snapshot's
`emailChangesMidway` and the drain status tell when it is safe.

### 11.4 Node.js 20 deadline

Google decommissions the Node.js 20 runtime for Cloud Functions on **2026-10-30**. After
that date no Node.js 20 function can be deployed: neither this release nor a rollback to
older source. This release stays on Node.js 20 so the runtime does not change together with
the code.

The move to Node.js 22 is the next change. It is its own PR: `functions/package.json`
engines, CI on 22, a staging deploy, then production. It must be in production before
2026-10-30. After it, rollbacks need a Node.js 22 build of the older source.

---

## 12. Remaining security limits (for Codex)

1. **The test signing key is public.** The test builds and the staging Relay use React
   Native's public debug keystore (`apps/mobile/android/app/debug.keystore`, `fac61745…3b9c`).
   - Anyone can sign an APK with it. Test builds therefore have their own package
     (`.test`) or run on staging only.
   - The staging Relay shares the production package `app.offlinesms.business`. A phone
     with the test-signed Relay must never hold a production enrollment.
   - The production workflow refuses this key.
2. **Production certificates are not yet confirmed.**
   - The user app's upload key fingerprint comes from Play Console.
   - The production Relay's fingerprint comes from an installed phone (§8). If its
     keystore is lost, re-enrollment is needed.
3. **Dashboard rate limiting is in memory** (`apps/dashboard/lib/rateLimit.ts`): per
   process, reset on restart, not shared between instances. It is acceptable only while the
   Dashboard runs as one instance.
4. **`BOOTSTRAP_ADMIN_EMAILS`.** The allow-list grants a bootstrap admin role by email
   without checking that the email is verified (`apps/dashboard/lib/session.ts:85`). It must
   be empty in production once a claim exists (§5).
5. **App Check is not enforced** (`APPCHECK_ENFORCE` unset). The phone flows rely on
   proof-of-work, attestation settings, per-scope budgets and the relay caps instead.
6. **Delivery to the modem is final.** The emergency stop cancels queued codes; a code
   already handed to the relay's modem cannot be recalled.
7. **Documented limit kept:** the request that performs the email change itself still
   returns a token (`pr30` R4 decision).
8. **Relay caps without server bounds.** The functions read `relayDevices.caps` as stored.
   The Dashboard now writes only whole numbers within 0–15/min, 0–1000/h and 0–10000/day,
   but a console edit can still store anything.
9. **The open redirect is closed** in this release (`apps/dashboard/lib/safeNext.ts`).

---

## 13. Who does what

### 13.1 Claude (from this repository)

- Merges #28 → #29 → #30 after Codex approves §1, and confirms CI on the final commit.
- Runs the production build workflow once §13.2 is in place, and checks both BUILD-INFO
  files.
- Keeps this document and the handoff for Codex current.
- Has no Firebase, DigitalOcean or Play access.

### 13.2 Raed: GitHub settings

Settings → Environments → **New environment** `production`. Optionally add yourself as a
required reviewer and limit it to the `main` branch. Then add these to that environment.

**User app upload key.** Download it from wherever production builds are signed today.

| Kind | Name |
|---|---|
| Secret | `MOBILE_UPLOAD_KEYSTORE_BASE64`: `base64 -w0 upload.keystore` |
| Secret | `MOBILE_UPLOAD_KEYSTORE_PASSWORD` |
| Secret | `MOBILE_UPLOAD_KEY_ALIAS` |
| Secret | `MOBILE_UPLOAD_KEY_PASSWORD` |
| Variable | `MOBILE_UPLOAD_CERT_SHA256`: Play Console → App integrity → Upload key certificate |

If the builds were made with EAS, the keystore comes from
`npx eas-cli credentials -p android` → production → Keystore → Download.

**Relay key**

| Kind | Name |
|---|---|
| Secret | `RELAY_RELEASE_KEYSTORE_BASE64` |
| Secret | `RELAY_RELEASE_KEYSTORE_PASSWORD` |
| Secret | `RELAY_RELEASE_KEY_ALIAS` |
| Secret | `RELAY_RELEASE_KEY_PASSWORD` |
| Variable | `RELAY_RELEASE_CERT_SHA256`: from §8 |

**Firebase**

| Kind | Name |
|---|---|
| Secret | `PROD_GOOGLE_SERVICES_JSON`: Firebase console → Project settings → the Android app `app.offlinesms.mobile` → google-services.json. The file must also contain `app.offlinesms.business` |
| Variables | `PROD_FIREBASE_API_KEY`, `PROD_FIREBASE_AUTH_DOMAIN`, `PROD_FIREBASE_PROJECT_ID`, `PROD_FIREBASE_STORAGE_BUCKET`, `PROD_FIREBASE_APP_ID`, `PROD_FIREBASE_MESSAGING_SENDER_ID`: the production web config. These are the same values as today's `MOBILE_TEST_FIREBASE_*` |

Set secrets from files in Cloud Shell, so nothing is pasted into a chat:

```sh
gh secret set MOBILE_UPLOAD_KEYSTORE_BASE64 --env production < <(base64 -w0 upload.keystore)
```

### 13.3 Raed: Cloud Shell

- §2 (backups and inventory);
- §3 (rules and indexes);
- §4 (functions in groups, with checks A and B);
- §7 (switch on);
- §9.2 step 2 (flags).

### 13.4 Raed: DigitalOcean

§1 step 2 (autodeploy) and §5 (variables, deploy).

### 13.5 Raed: Play Console

- §6: upload to internal testing;
- check the app signing key;
- staged rollout.

### 13.6 Raed: phones

- §6 step 3 (2.4.0 checks);
- §8 (certificate, Relay update);
- §9.3 (monitored test);
- staging T1–T13 before stage 7.
