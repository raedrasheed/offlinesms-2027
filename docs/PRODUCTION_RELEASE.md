# Production release: phone and email sign-in, display names, chat features

Owner approval: Raed, 2026-10-11 09:04 UTC, to move to production with every change
(user app, Relay, Dashboard). **Order:** Codex reviews this package first; only stages that
pass review are executed. Verification SMS stays suspended in production until stage 7.

Raed, 2026-10-11 12:16 UTC: the functions move to **Node.js 22 before** the release
continues (`NODE22_UPGRADE.md`: its own commit, reviewed by Codex, deployed and checked on
staging first). Raed builds the Android apps on his own computer with his signing files;
no signing key goes to GitHub (§6, §8).

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
| Functions | 20 phone/relay functions at `d3cafc76` (2026-10-08), 65 at older source; 85 in total. Node.js 20 | All 94 at the release commit; 9 are new. Node.js 22 (§4, §11.4) |
| Rules | ruleset `0b9413c8…` from `d3cafc76` | `+20` lines: admin-read rules for the email-change records. Nothing else changes |
| Indexes | 50 composite indexes | 51: one added, `smsBatches` (`status`, `createdAt` ascending), which `reapStuckBatches` needs (§3) |
| Dashboard | `dash.offlinesms.com` (DigitalOcean, Next.js server) | Display names, SMS policy switches and limits, Relay caps. The login no longer follows `?next=` to other sites |
| User app | 2.3.18 (versionCode 15) | 2.4.0 (16): phone/email sign-in on one account, add and edit both methods, real names, emoji, stickers, polls, responsiveness and notification fixes |
| Relay | Older build on the production phones | 0.2.1 (3), same signing key as the installed relay |
| Verification SMS | Suspended (`enabled:false`, `emergencyStop:true`) | Suspended until stage 7 opens it with small limits |
| Email change | Not deployed | Deployed switched off; turned on in stage 5 |

The rules are unchanged since `925b812`, the commit whose functions ran on staging for the
phone test. `functions/src` changed in one place only: `votePoll` retries its transaction up
to 15 times instead of Firestore's default 5. Fifty simultaneous votes on one poll had
failed with "Transaction lock timeout". The indexes gained one entry (§3). Check before
stage 1: `git diff --stat 925b812 <final> -- functions/src firestore.rules firestore.indexes.json`
must list only `functions/src/chats/votePoll.ts` and `firestore.indexes.json` (the two index
changes in §3).

---

## 1. Final commit and merge order

PR #30 is stacked on PR #29, which is stacked on PR #28. Main was merged into the PR #30
branch (`e4b3b72`) with no conflicts, so the release tree is the PR #30 head.

1. **Codex reviews** this document, the PR #30 head, and §12. The Node.js 22 staging checks
   (`NODE22_UPGRADE.md` §6) are recorded before stage 2.
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

In Cloud Shell, signed in as the project owner. Cloud Shell's default Node is 24; use 22,
the version CI tests. After a reconnect run `nvm install 22 && nvm use 22` again: a new
Cloud Shell session keeps only the home directory, and nvm's Node versions are outside it.

```sh
nvm install 22 && nvm use 22 && node --version     # v22.x
export GOOGLE_CLOUD_QUOTA_PROJECT=offlinesms-prod-2027   # NODE22_UPGRADE.md §1: blocking-trigger registration
cd ~ && git clone https://github.com/raedrasheed/offlinesms-2027.git release && cd release
git checkout <final>            # the exact final commit
npm ci                          # installs every workspace, functions included
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
   their values. Expect 85 rows, all `nodejs20`.
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
- Indexes: the file is the live set plus one index, `smsBatches` (`status` ascending,
  `createdAt` ascending). `reapStuckBatches` queries `status ==` with `createdAt <=` every
  30 minutes. The live index orders `createdAt` descending, so the query fails with
  `FAILED_PRECONDITION: The query requires an index` and stuck batches are never settled.
  Staging logged this on Node 20 and on Node 22 (2026-10-11). The Dashboard's failed-batch
  count uses the same query shape.
- The `relayJobs` (`kind`, `status`) entry no longer lists `__name__`. Firestore ends every
  index with `__name__`, and the CLI drops it from the live list before comparing. The
  three-field entry therefore never matched the live index: each redeploy offered to delete
  that index, then tried to create it again and failed with HTTP 409 "index already exists".
  A failed index step also stops the rules release. Seen on staging on 2026-10-11. The live
  index is unchanged.
- If the CLI still offers to **delete** an index that is not in the file, answer **No**.
- **Check:** `firebase firestore:indexes` matches `$B/indexes-before.json` plus that index,
  and `gcloud firestore indexes composite list --project offlinesms-prod-2027 --filter="name~smsBatches"`
  shows it `READY` (it builds in the background; the rest of the release does not wait on
  it). The app still opens chats.
- **Rollback:** `cp $B/firestore.rules.before firestore.rules` in a scratch checkout and
  deploy `--only firestore:rules`.

---

## 4. Stage 2: functions, in groups, phone flags unset

`scripts/release/function-groups.json` puts all 94 exported functions in exactly one group
(a test enforces it). Deploy one group at a time, in this order, and check each before the
next. A deploy that stops on a quota error is re-run with the same command; deploys are
idempotent.

**Runtime:** every function deploys on Node.js 22 (`functions/package.json` engines;
`firebase.json` sets no runtime). In production the runtime changes together with the
code: the source of 65 of today's functions was never recorded, so today's code cannot be
redeployed alone on Node.js 22. Staging ran this exact commit on Node.js 22 first
(`NODE22_UPGRADE.md`). Until 2e is done, production runs a mix of Node.js 20 and 22; each
group works on either.

```sh
D() { npx firebase deploy --project offlinesms-prod-2027 --only "$(node scripts/release/deploy-only.mjs "$1")"; }
```

Each step must end with `Deploy complete!`. If 2a reports "Failed to register blocking
trigger function", `GOOGLE_CLOUD_QUOTA_PROJECT` (§2) is not set in this shell. Set it and
run `D email-guards` again before Check A; the guards are not registered until then.
If a step stops with `Error: An unexpected error has occurred.` and `firebase-debug.log`
shows `TypeError: Cannot read properties of undefined (reading 'access_token')`, the access
token expired during the deploy (`NODE22_UPGRADE.md` §2). The functions before the failure
are updated and the rest of that group is not. Run the same `D` again at once, then do the
step's check.

| Step | Command | Check before the next step |
|---|---|---|
| 2a | `D email-guards` | **Check A** of `EMAIL_CHANGE_VERIFICATION.md` §5: registration GO, the three refused routes GO (`--allow-production`), email-code sign-in on the store app, clean logs |
| 2b | `D chat`, then `D groups` | In the 2.3.18 store app: send text and an image, react, open a group, add a member. Stickers and polls from 2.4.0 reach old apps as emoji and text |
| 2c | `D accounts-admin`, then `D business-sms-points` | A new account by email code is created normally (`onUserCreate`); the Dashboard user list loads; `confirmPaymentMock` refuses (`permission-denied`) |
| 2d | `D relay`, then `D phone` | Policy still stopped: the phone screen offers no countries; `getPhoneLinkStatus` reports linking unavailable; Dashboard → Relay shows the devices as before |
| 2e | `D email-change` | **Check B** of `EMAIL_CHANGE_VERIFICATION.md` §5: switch off, zero changes |

After 2e:
```sh
bash scripts/release/check-runtime.sh offlinesms-prod-2027      # OK: exactly the 94 functions, all on nodejs22
bash scripts/release/function-env-names.sh offlinesms-prod-2027 > $B/functions-after.tsv
node scripts/release/env-names-diff.mjs --forbid PHONE_AUTH_ENABLED,PHONE_LINK_ENABLED $B/functions-before.tsv $B/functions-after.tsv
```
`check-runtime.sh` compares the deployed names with the functions this source exports and
fails on a missing function, a deployed function this source does not have, a name deployed
twice, or another runtime (`NODE22_UPGRADE.md` §2). On a failure, stop; delete nothing.

`env-names-diff.mjs` compares names only, never values, and ignores the runtime. It must
end `OK`. It fails (exit 1) if a function, a variable name or a secret (with its version) is
gone, so the six pepper-bound functions keep `PHONE_HASH_PEPPER:1`. `--forbid` also fails it
if any function after the deploy, new or existing, carries `PHONE_AUTH_ENABLED` or
`PHONE_LINK_ENABLED`: the flags stay unset until stage 7 (§2). It refuses (exit 2) an empty
file or a row that is not a `function-env-names.sh` row. Expect `New functions (9), with all
their names`, each listed with its variables and secrets. Among the added names,
`FUNCTION_SIGNATURE_TYPE` is set by Cloud Functions.

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
  `super_admin`, or the legacy `admin` claim. The check names these two roles explicitly
  (`isPlatformAdmin`, `apps/dashboard/lib/adminScope.ts`); every other role is refused.
  Creating an organization account uses the same check.
- Relay caps also need a platform admin. Pairing, pause, resume, revoke and countries need
  `manage:relay`.
- An `organization_admin` must carry a non-empty `organizationId` claim. Without one the
  session is refused at sign-in (`apps/dashboard/lib/session.ts`), and the org scope throws
  rather than falling back to unrestricted.
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

**Build (Raed, on his own computer, with his upload key; no key leaves it):**
1. A clean checkout of `<final>` (`git status` shows nothing), Node.js 22, JDK 21 and the
   Android SDK with NDK 27.1.12297006.
2. Production config only:
   - the production `google-services.json` (it lists `app.offlinesms.mobile`) in both
     `apps/mobile/` and `apps/mobile/android/app/`;
   - the production web config exported as the six `EXPO_PUBLIC_FIREBASE_*` variables;
   - no `apps/mobile/.env*` file other than `.env.example`, and `EXPO_PUBLIC_TEST_FAULTS` and
     `EXPO_PUBLIC_PERF_LOG` unset. Test builds set these; a store build never does.
3. Signing: `apps/mobile/android/keystore.properties` pointing at the upload keystore
   (`RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`,
   `RELEASE_KEY_PASSWORD`). Without it Gradle falls back to the public debug key, and the
   check below refuses the build.
4. From the repository root:
   ```sh
   npm --prefix apps/mobile ci
   cd apps/mobile/android && NODE_ENV=production ./gradlew bundleRelease assembleRelease
   ```
   The files are `app/build/outputs/bundle/release/app-release.aab` and
   `app/build/outputs/apk/release/app-release.apk`.

**Check before anything is uploaded:** Raed puts in the project the AAB, the APK, the
production `google-services.json` and the upload certificate's SHA-256 (Play Console → App
integrity → Upload key certificate). None of these is a secret. Claude runs, from a clean
checkout of `<final>`:

```sh
scripts/release/verify-local-artifacts.sh user-app app-release.apk app-release.aab google-services.json <upload cert SHA-256>
```

It runs the same checks as the release workflow (`verify-build.sh`) and refuses:
- a checkout with local changes;
- an expected certificate that is the repository's test key;
- an APK or AAB not signed by exactly the expected certificate;
- Firebase values inside the APK (native and JS) that differ from production;
- a package other than `app.offlinesms.mobile`;
- versions that differ from the source;
- a debuggable build;
- a build that is not 16 KB page compatible (`scripts/release/check-16kb.sh`):
  - any LOAD segment of an arm64-v8a or x86_64 library below 16 KB alignment, in the APK
    or the AAB;
  - APK libraries not 16 KB zip-aligned;
  - an AAB whose BundleConfig does not keep native libraries uncompressed with
    `PAGE_ALIGNMENT_16K` (what Play uses to build the APKs it serves);
  - the arm64-v8a or x86_64 APKs that bundletool 1.17.2 (pinned SHA-256) builds from the
    AAB failing either check.

`dist/BUILD-INFO.txt` records the package, version, project, the commit checked against,
both signatures, the expected fingerprint, the signature schemes, each 16 KB check and the
SHA-256 of each file. **Codex reviews BUILD-INFO before anything is uploaded**, and the
file uploaded to Play must have the AAB's SHA-256 from BUILD-INFO.

The GitHub workflow *Production Android release* stays in the repository, unused: it would
need the signing keys in GitHub.

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
- That fingerprint is the expected certificate for the check below. It is not a secret.
- **The fingerprint and the installed APK cannot sign anything.** Signing needs the
  matching keystore file (`.jks` or `.keystore`), its store password, the key alias and the
  key password. Raed has them and signs on his own computer; they never leave it (no
  project upload, no chat, no GitHub).
- Before building, Raed can confirm the keystore is the right one:
  `keytool -list -v -keystore <relay keystore> -alias <alias>` must show the same SHA-256
  as the installed relay.
- **If that keystore no longer exists**, an update in place is impossible. Re-enrollment is
  a separate decision:
  1. drain;
  2. pause;
  3. uninstall;
  4. install a build signed with a new production key;
  5. pair with a new code;
  6. revoke the old device.

  The repository test key is never used in production; the check refuses it.

**Build (Raed, on his own computer):** a clean checkout of `<final>`, the production
`google-services.json` in `apps/mobile-relay/app/`, and `apps/mobile-relay/keystore.properties`
pointing at the relay keystore (`keystore.properties.example` lists the four entries). Then
`gradle -p apps/mobile-relay :app:assembleRelease` (Gradle 8.14.3, as CI uses) →
`apps/mobile-relay/app/build/outputs/apk/release/app-release.apk`. Without
`keystore.properties`, Gradle signs with the debug key and the check refuses it.

**Check:** Raed puts the APK and the installed relay's SHA-256 in the project. Claude runs
`scripts/release/verify-local-artifacts.sh relay app-release.apk google-services.json <installed relay SHA-256>`
from a clean checkout of `<final>`: package `app.offlinesms.business`, version 0.2.1 (3),
one signer equal to the installed relay's certificate, production Firebase values, not
debuggable. Codex reviews BUILD-INFO before installation.

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

### 9.3 Monitored test (4 SMS, Raed's own numbers only)

Keep Dashboard → Relay (queue) and
`npx firebase functions:log --project offlinesms-prod-2027 --only requestPhoneAuthCode,verifyPhoneAuthCode,requestPhoneLinkOtp,verifyPhoneLinkOtp,claimRelayJobs,authorizeRelaySend,reportRelayDelivery`
open throughout.

**Setup:**
- Phone 1 on Wi-Fi; phone 2 on **mobile data**. They are separate installations and
  separate request sources, so each has its own install and source budget.
- Number B and number C: Raed's own, neither linked to any account yet.
- An email-only account for P4 (no phone number).

**How the budgets count:**
- Only a code that is sent counts. A refused request writes no counter and creates no
  job (`requestPhoneAuthCode.ts` and `requestPhoneLinkOtp.ts` update the counters only on
  the admit path).
- The destination counter is shared by sign-in and add-phone: P4 and P5 both count on C.
- A second request for the same number within 60 s is refused `cooldown` (session and
  destination cooldowns). Each row below waits at least 60 s after the previous code.

| # | Where | Action | Expected | SMS |
|---|---|---|---|---|
| P1 | Phone 1 | New account with number B | code arrives on B; account created | 1 |
| P2 | Phone 1 | Sign out; sign in with B; enter a wrong code once, then the right one | `code-invalid` with attempts left, then the same account as P1 | 1 |
| P3 | Phone 1 | Sign out; request a code for B | refused: the log shows `rate-limited`, scope `destination` (B has had 2 codes this hour, the limit). No job, nothing queued. **This refusal is the pass** | 0 |
| P4 | Phone 2 | Turn on Add phone in the Dashboard. Sign in to the email-only account and add number C | code arrives on C; number linked | 1 |
| P5 | Phone 2 | Sign out; sign in with C | the same account as the email (same UID, chats, name) | 1 |
| P6 | Phone 2 | Emergency stop in the Dashboard; reopen the phone screen and request a code | no countries offered, or `service-paused`; no job; nothing queued | 0 |

**Budget after each row** (limits from §9.2; "h" = this hour):

| After | Destination B | Destination C | Install, phone 1 | Install, phone 2 | Sign-in source, phone 1 | Sign-in source, phone 2 | Sign-in global | Add-phone account | Shared |
|---|---|---|---|---|---|---|---|---|---|
| P1 | 1/2 h | 0 | 1/3 day | 0 | 1/3 h | 0 | 1/5 h | — | 1/5 h |
| P2 | 2/2 h | 0 | 2/3 day | 0 | 2/3 h | 0 | 2/5 h | — | 2/5 h |
| P3 | 2/2 h (refused, unchanged) | 0 | 2/3 day | 0 | 2/3 h | 0 | 2/5 h | — | 2/5 h |
| P4 | 2/2 h | 1/2 h | 2/3 day | 0 | 2/3 h | 0 | 2/5 h | 1/2 h | 3/5 h |
| P5 | 2/2 h | 2/2 h | 2/3 day | 1/3 day | 2/3 h | 1/3 h | 3/5 h | 1/2 h | 4/5 h |
| P6 | unchanged: the stop is checked before any limit | | | | | | | | |

Every send stays under every limit, and the only refusals are the expected ones in P3 and
P6. The relay sends 4 of its 5 per hour (caps 1/5/20); the 60 s wait also keeps it at 1 per
minute.

**If a code does not arrive, do not request another.** A resend takes the budget of a
later row (B and C have 2 codes per hour each). Stop, check the relay queue and the logs,
and continue only after the cause is known. To repeat a row, wait an hour.

Expired codes, too many wrong attempts, the global and shared budgets, a paused relay and
the stop with a queued job are covered on staging (T3–T13), where the limits can be set to
0 without spending SMS. Production repeats only what needs the real relay and real
numbers.

**Stop at once, using the emergency stop, if any of these happens:**
- an SMS goes to a number not in the test;
- a job stays `queued` or `claimed` for more than 2 minutes;
- `failed` rises without a reason;
- an error appears in the logs, other than the expected refusals in P3 and P6;
- any expected row does not match.

After P6, lift the stop only if P1–P5 matched, P3 included.

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

Prefer a forward fix on Node.js 22. If a group must go back, redeploy it from a scratch
checkout of the previous source, with the same `.env` file, **on Node.js 22**:
- `d3cafc76` for the `relay` and `phone` groups (flags unset);
- the other 65 functions: their exact source was never recorded (Firebase source hash
  `2656c210…` is not a Git commit). The closest known state is `main` before the release
  merges, `366128a`.

Both commits say `"node": "20"` in `functions/package.json`. In the scratch checkout, set it
to `"22"` before deploying. Afterwards run `check-runtime.sh` from the release checkout
(`<final>`), which keeps the full list of 94: the older source has no such list. Node.js 20 can't
be deployed from 2026-10-30; before then, going back to it would only bring the deadline
back. That older source has not run on Node.js 22: deploy it to staging first when there
is time.

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

### 11.4 Node.js runtime

From **2026-10-30**, Cloud Functions no longer lets anyone create or redeploy a function
on Node.js 20. Functions already deployed are not guaranteed to be switched off on that
date, but none of them could be fixed or rolled back on Node.js 20 after it.

So the release deploys on **Node.js 22** (`NODE22_UPGRADE.md`): its own commit, CI on 22,
the staging deploy and checks, then stage 2 here. Stage 2 must be done before 2026-10-30.

The runtime table in firebase-tools 13.35.1 lists Node.js 22 as deprecated from
2027-04-30 and decommissioned on 2027-10-31. Plan the next runtime move well before then.

---

## 12. Remaining security limits (for Codex)

1. **The test signing key is public.** The test builds and the staging Relay use React
   Native's public debug keystore (`apps/mobile/android/app/debug.keystore`, `fac61745…3b9c`).
   - Anyone can sign an APK with it. Test builds therefore have their own package
     (`.test`) or run on staging only.
   - The staging Relay shares the production package `app.offlinesms.business`. A phone
     with the test-signed Relay must never hold a production enrollment.
   - The production checks (`verify-build.sh`, `verify-local-artifacts.sh`) refuse this key.
2. **Production certificates are not yet confirmed.**
   - The user app's upload key fingerprint comes from Play Console.
   - The production Relay's fingerprint comes from an installed phone (§8). Raed keeps
     the signing files and signs on his computer; the check compares the signed APK with
     that fingerprint. If the keystore turns out not to match, re-enrollment is needed.
   - **Local builds are not attested.** The checks prove what the signed files contain
     (package, versions, signer, backend, 16 KB), not which commit they were built from.
     That rests on Raed building from a clean checkout of `<final>`.
3. **Dashboard rate limiting is in memory** (`apps/dashboard/lib/rateLimit.ts`): per
   process, reset on restart, not shared between instances. It is acceptable only while the
   Dashboard runs as one instance.
4. **`BOOTSTRAP_ADMIN_EMAILS`.** The allow-list grants a bootstrap admin role by email
   without checking that the email is verified (`apps/dashboard/lib/session.ts:91`). It must
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
- Runs `verify-local-artifacts.sh` on the files Raed builds (§6, §8) and hands both
  BUILD-INFO files to Codex.
- Keeps this document, `NODE22_UPGRADE.md` and the handoff for Codex current.
- Has no Firebase, DigitalOcean or Play access.

### 13.2 Raed: Android builds on his computer

- §6: the user app AAB and APK, signed with the upload key; then the files, the
  production `google-services.json` and the upload certificate's SHA-256 into the project.
- §8: the Relay APK, signed with the installed relay's key; then the APK and the installed
  relay's SHA-256 into the project.
- Keystores and passwords stay on his computer. Nothing needs to be set in GitHub for the
  release.

### 13.3 Raed: Cloud Shell

- `NODE22_UPGRADE.md` §1–§3 (staging on Node.js 22), before stage 2;
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
