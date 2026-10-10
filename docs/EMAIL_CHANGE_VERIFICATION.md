# Email change: operational verification and production activation

Covers the email add/change flow of PR #30 (`functions/src/emailChange/*`) and what protects
a replaced address:
- `guardEmailSignIn` (beforeSignIn): email + password and email-link sign-in;
- `guardEmailSent` (beforeSendEmail): password-reset and sign-in-link emails;
- the check inside `verifyEmailOtp`: the app's email-code sign-in.

Production (`offlinesms-prod-2027`) stays undeployed until §3 and §4 pass on a
non-production project **and** the owner approves §5. Nothing here touches the SMS
verification suspension, the phone functions or `smsConfig`.

**Blocking functions never run for the app's own sign-in.** Firebase: "Anonymous and
custom authentication do not trigger blocking functions." The app signs in with custom
tokens (email code and phone). So a code sign-in after a deploy proves nothing about the
guards. The email-code route is protected by `verifyEmailOtp` itself, and is checked
separately (§4).

## 0. Already verified without a real project

- Unit, rules and emulator integration suites run in CI on every push. The handoff file
  records the counts per review round.
- **Real requests on the local emulators.** `scripts/verifyEmailSignInGuards.ts` creates
  the replaced-address state, then calls Identity Toolkit over REST the way the SDKs do,
  and the `verifyEmailOtp` callable the way the app does:

  ```
  PASS  an account that never changed its email signs in with its password (the key reaches this project) — accepted (1744 ms)
  PASS  password sign-in with the replaced address is refused (address-replaced) — refused: BLOCKING_FUNCTION_ERROR_RESPONSE … HTTP error 403 … (219 ms)
  PASS  the refusal repaired the Auth record to the settled address
  SKIP  password reset to the replaced address — the Auth emulator does not run beforeSendEmail; run against a test project
  PASS  password sign-in with the settled address is accepted — accepted (22 ms)
  PASS  email-code sign-in (verifyEmailOtp) with the replaced address is refused (address-replaced) — refused: address-replaced (1679 ms)
  PASS  …and the Auth record was repaired again
  PASS  email-code sign-in (verifyEmailOtp) with the settled address is accepted — accepted (87 ms)
  GO: all checks passed
  ```

  **Negative control:** the same run with no guard loaded ends in NO-GO. The replaced
  address signs in with its password, so the check is not vacuous.
- **Emulator limits** (firebase-tools 13.35.1). Neither applies to a deployed project; §2
  and §4 check the real registration.
  1. The Auth emulator never calls `beforeSendEmail`, so the reset guard needs a real
     project.
  2. The Functions emulator registers every non-create blocking trigger as `beforeSignIn`.
     With both guards loaded, the last one wins. The emulator run therefore loads a wrapper
     that exports only `guardEmailSignIn` and the `verifyEmailOtp` callable. Build
     `functions/lib` first, then:

     ```sh
     # W: scratch dir with firebase.json (auth 9099, firestore 8080, functions 5001; source "src"),
     #    src/node_modules -> <repo>/node_modules, and src/index.js:
     #    require('firebase-admin/app').initializeApp();
     #    exports.guardEmailSignIn = require('<repo>/functions/lib/emailChange/emailSignInBlocking.js').guardEmailSignIn;
     #    exports.verifyEmailOtp = require('<repo>/functions/lib/auth/verifyEmailOtp.js').verifyEmailOtp;
     cd $W && npx --prefix $REPO firebase emulators:exec --config $W/firebase.json \
       --project demo-offlinesms --only auth,firestore,functions \
       "cd $REPO && npx tsx scripts/verifyEmailSignInGuards.ts --project demo-offlinesms"
     ```
- **Not provable on emulators:**
  - Identity Platform registration;
  - `beforeSendEmail`;
  - the 7-second blocking deadline with a cold start;
  - real session revocation seen by a real device.

## 1. Who needs which access

Setup, deploy and test are separate. None of them needs Owner except setup, which the
project owner does with their own login.

**1. Setup** — the project owner, in the console or Cloud Shell, with their own login. No
key. Covers everything in §1.1 below: creating the project, Identity Platform, providers,
APIs, the secret, the switches, and creating the two identities that follow.

**2. Deploy identity**, in the staging project only. Used for `firebase deploy` in §2.

| Role | Why |
| --- | --- |
| Cloud Functions Admin `roles/cloudfunctions.admin` | Create and update the functions, and let anyone invoke the callables. Firebase documents this role, with the next one, for deploying functions. |
| Service Account User `roles/iam.serviceAccountUser`, granted **on the functions' runtime account only** (`<project-number>-compute@developer.gserviceaccount.com`) | Deploy functions that run as that account. |
| Firebase Rules Admin `roles/firebaserules.admin` | `firestore:rules` |
| Cloud Datastore Index Admin `roles/datastore.indexAdmin` | `firestore:indexes` |
| Firebase Authentication Admin `roles/firebaseauth.admin` | Register beforeSignIn and beforeSendEmail in the Identity Platform config during deploy. |
| Cloud Scheduler Admin `roles/cloudscheduler.admin` | Scheduled functions: `reconcileEmailChangeWrites` and the existing sweeps. |
| Secret Manager Viewer `roles/secretmanager.viewer` | The deploy checks that `PHONE_HASH_PEPPER` exists. Setup grants the runtime account access to it once, so deploy never changes secret IAM. |
| Service Usage Consumer `roles/serviceusage.serviceUsageConsumer` | The CLI checks that the APIs are on. Setup turns them on. |

If a deploy still stops on a missing permission, add only the role that grants the
permission it names, and record it here. Examples: Cloud Run Admin for
`run.services.setIamPolicy`, or Eventarc Admin for the Firestore-triggered functions.

**3. Verify identity**, in the staging project only. Used for the checks in §2.6 and §4,
and for the drain check.

| Role | Why |
| --- | --- |
| Firebase Authentication Admin `roles/firebaseauth.admin` | Create, repair and delete the throwaway users; read the Identity Platform config for the registration check. |
| Cloud Datastore User `roles/datastore.user` | Write and delete the throwaway ledger, code and profile documents; read them for the drain check. |

It has no deploy rights and no token signing: the script mints no custom tokens.

**Production checks (§5)** run with the owner's own login in Cloud Shell. No production
key is created or stored anywhere.

**Temporary credentials:**
- **Preferred: no key.** Run §2 and §4 yourself in Cloud Shell with your own login. Its
  tokens are short-lived and there is nothing to revoke.
- **If Claude runs them.** This cloud environment stores credentials only as fixed values
  (environment variables or network secrets); it cannot impersonate an account or use
  federation. So:
  1. Create a key for each staging-only identity right before the run.
  2. Add the keys in Project settings → Cloud environment → the gear by the environment:
     - `STAGING_DEPLOY_SA_JSON` and `STAGING_VERIFY_SA_JSON` (the key files);
     - `STAGING_FIREBASE_PROJECT_ID`;
     - `STAGING_FIREBASE_WEB_API_KEY`;
     - `STAGING_RESEND_API_KEY`;
     - `STAGING_EMAIL_FROM`.

     A new session picks them up. Keys never go in chat.
  3. Delete both keys as soon as the run is reported. A deleted key stops working at once:
     `gcloud iam service-accounts keys delete <key-id> --iam-account <account> --project $STAGING`.

### 1.1 Staging project setup (owner, once)

Any project id other than `offlinesms-prod-2027` works, for example `offlinesms-staging`.
Below, `$STAGING` stands for that id and `$NUM` for its project number.

1. **Project.** Firebase console → Add project.
   - Plan: **Blaze**.
   - Authentication → Settings: **upgrade to Firebase Authentication with Identity
     Platform**. Blocking functions need it; production already has it, since
     `onUserCreate` is a blocking function.
   - Sign-in method: enable **Email/Password**, needed for the password and reset checks.
     Leave Phone off.
   - **Firestore** (Native mode), in the same location as production.
2. **Apps** (Project settings → Your apps):
   - **Android**, package `app.offlinesms.mobile.test`. Download its `google-services.json`.
   - **Web**. Copy `apiKey`, `authDomain`, `projectId`, `storageBucket`, `appId` and
     `messagingSenderId`.
   - The CI check (step 7) asks Identity Toolkit which project each API key belongs to.
     Keep Firebase's default key settings; a key restricted to Android apps cannot be
     checked, and the build stops.
3. **APIs:**

   ```sh
   gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com eventarc.googleapis.com pubsub.googleapis.com cloudscheduler.googleapis.com \
     secretmanager.googleapis.com identitytoolkit.googleapis.com firestore.googleapis.com \
     firebaserules.googleapis.com --project $STAGING
   ```
4. **Secret.** Use a fresh random value, never production's, and give the runtime
   account read access:

   ```sh
   openssl rand -base64 32 | gcloud secrets create PHONE_HASH_PEPPER --data-file=- --project $STAGING
   gcloud secrets add-iam-policy-binding PHONE_HASH_PEPPER --project $STAGING \
     --member serviceAccount:$NUM-compute@developer.gserviceaccount.com --role roles/secretmanager.secretAccessor
   ```
5. **Switches.** In Firestore, create `systemSettings/general` with both booleans:
   - `emailSignInEnabled: true`;
   - `emailChangeEnabled: true`.

   Leave every phone or SMS setting unset.
6. **Identities**, only if Claude runs §2 and §4. Create `staging-deploy` and
   `staging-verify` with the roles in the tables above:

   ```sh
   for r in cloudfunctions.admin firebaserules.admin datastore.indexAdmin firebaseauth.admin \
            cloudscheduler.admin secretmanager.viewer serviceusage.serviceUsageConsumer; do
     gcloud projects add-iam-policy-binding $STAGING --role roles/$r \
       --member serviceAccount:staging-deploy@$STAGING.iam.gserviceaccount.com; done
   gcloud iam service-accounts add-iam-policy-binding $NUM-compute@developer.gserviceaccount.com --project $STAGING \
     --role roles/iam.serviceAccountUser --member serviceAccount:staging-deploy@$STAGING.iam.gserviceaccount.com
   for r in firebaseauth.admin datastore.user; do
     gcloud projects add-iam-policy-binding $STAGING --role roles/$r \
       --member serviceAccount:staging-verify@$STAGING.iam.gserviceaccount.com; done
   ```

   Create the two accounts first with
   `gcloud iam service-accounts create staging-deploy --project $STAGING`, and the same for
   `staging-verify`.
7. **Staging test APK.** In GitHub → Settings → Secrets and variables → Actions:
   - **Secret** `MOBILE_STAGING_GOOGLE_SERVICES_JSON`: the file from step 2.
   - **Variables** from the staging Web app: `MOBILE_STAGING_FIREBASE_API_KEY`,
     `MOBILE_STAGING_FIREBASE_AUTH_DOMAIN`, `MOBILE_STAGING_FIREBASE_PROJECT_ID`,
     `MOBILE_STAGING_FIREBASE_STORAGE_BUCKET`, `MOBILE_STAGING_FIREBASE_APP_ID` and
     `MOBILE_STAGING_FIREBASE_MESSAGING_SENDER_ID`.

   Then Actions → CI → **Run workflow** on `claude/phone-email-login-display-names-pu9nez`,
   with `test_backend` = **staging**. Before building, CI
   (`scripts/ci/check-backend-config.mjs`) stops if:
   - any value is missing;
   - the Android config and the web config name different projects;
   - the sender id, an app id or the bucket belongs to another project;
   - either API key resolves (via Identity Toolkit) to another project, or cannot be
     resolved;
   - the auth domain is not authorized for that project;
   - anything points at production.

   The same run builds the private relay against staging. The secret must therefore
   also contain the Android app `app.offlinesms.business`. The relay build uses only
   the `MOBILE_STAGING_*` settings and fails if any is missing; it never falls back to
   the default settings. It also fails if its app id or API key belongs to another
   project (`scripts/ci/relay-test-backend.mjs`), or if the settings point at
   production.

   After building, CI reads the Firebase config each APK actually carries
   (`scripts/ci/check-apk-backend.mjs`) and compares every value exactly:
   - native resources: `project_id`, `google_app_id`, `google_api_key`,
     `gcm_defaultSenderId` and `google_storage_bucket` must equal `$STAGING` and
     that app's entry in the staging google-services.json;
   - the user app's JS bundle: the six web config values must be strings of the
     bundle, and no other API key, app id, auth domain, bucket, or the production
     project id may be.

   A project name merely appearing in the file is not accepted. Artifacts (a
   staging run builds no baseline; artifacts of Run workflow builds are kept 30
   days, pull request builds 7):
   - `offlinesms-test-updated`: `offlinesms-test-updated-<sha>-$STAGING.apk`;
   - `offlinesms-relay-test`: `offlinesms-relay-0.2.0-test-$STAGING.apk`.

   Each artifact has a `BUILD-INFO.txt` with the project, commit, package and
   version, sha256 and signing certificate.

   Test APKs compile in the test switches (`EXPO_PUBLIC_TEST_FAULTS=1`); store builds
   never do.

   The staging relay has the production relay's package (`app.offlinesms.business`).
   Install it only on a phone without the production relay, so no enrollment or
   pending job of the production relay is replaced.

## 2. Deploy to staging (deploy identity, or your own login)

1. **Functions configuration.** Create `functions/.env.$STAGING`; git ignores it:

   ```
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=<a Resend API key>
   EMAIL_FROM=OfflineSMS <noreply@your-verified-domain>
   EMAIL_CHANGE_TEST_FAULTS=on
   ```

   `EMAIL_CHANGE_TEST_FAULTS=on` enables the "stop the server" switch of §3b on this
   project only. The code ignores it on `offlinesms-prod-2027`.
2. **Deploy the reviewed commit.** The predeploy step builds the functions.

   ```sh
   git fetch origin claude/phone-email-login-display-names-pu9nez && git checkout <reviewed sha>
   npm ci
   firebase deploy --project $STAGING --only functions,firestore:rules,firestore:indexes
   ```
3. **Check registration** (verify identity):

   ```sh
   npx tsx scripts/verifyEmailSignInGuards.ts --project $STAGING --registration-only
   ```

   Expect GO, with three routes registered:
   - beforeSignIn → guardEmailSignIn;
   - beforeSendEmail → guardEmailSent;
   - beforeCreate → onUserCreate.

## 3. Device check: the reply is lost, then sign in with the new email and finish in the app

You need:
- the staging APK from §1.1 step 7;
- one Android phone;
- two inboxes you can read, A and B.

Uninstall "OfflineSMS Test" first. It has the same package as the production-backed test
build, so this keeps no production session or local data. Code emails share a 60-second
per-address cooldown: if the app says "Please wait a moment", wait and send again.

The test switches appear under the code field of the change-email screen. Each switch
applies to the next code entry only.

### 3a. The server finished; only the reply was lost

1. Sign in by email code with **A**. Finish the profile with a name.
2. Settings → Email → **Edit**. Enter **B** → Send code.
3. Tap **"Test build: lose the reply to the next code"** until it shows ✓.
4. Enter the code from B's inbox.
   - Expect "Network problem…".
   - The server has completed the change, which signed every session out.
5. Go back, then open Settings → Email again.
   - Expect the "confirm it's you" panel, sending the code to **B**, not A.
6. Send the code and enter it.
   - Expect the screen to show "Current email: B".
   - The name, chats and groups are unchanged.

### 3b. The server stopped after writing the new address; the reply was lost

This is the reviewed path. A device whose reply was lost signs in again to the same
account with the new address, then finishes the change by its challenge id.

1. Continue from 3a, on the same account, now on B. Settings → Email → **Edit**. Confirm
   it's you if asked. Enter **A** → Send code. A is free again after 3a.
2. Arm **both** switches:
   - "lose the reply to the next code" ✓;
   - "stop the server right after it writes the new address" ✓.
3. Enter the code from A's inbox.
   - Expect "Network problem…".
   - On the server the change is mid-way: the Auth record carries A, the stage is
     `auth-updated`, every session is revoked and no token was issued.
4. Go back, then open Settings → Email again.
   - Expect "Please confirm it's you again to continue", with the code going to **A**.
5. Send the code and enter it.
   - Expect "Changing your email was interrupted after the code was confirmed…" and
     **"Finish changing my email"**.
6. Tap **Finish changing my email**.
   - Expect "Done! You now sign in with A…"
   - Settings shows A; the name and chats are unchanged.

**Variant (sign in from the start screen):** repeat 3b with B as the target. Use a second
account or wait an hour, since an account gets 3 change codes per hour. After step 3, sign
out.
- On the start screen, sign in by email code with **B**. Expect the same account, with the
  same name.
- Open Settings → Email. Expect **Finish changing my email**. Tap it; expect "Done! You now
  sign in with B…"

### 3c. The replaced address no longer opens the account

1. Sign out. Sign in by email code with the address replaced last.
2. Expect a **new, empty** account (the profile step), not the original one.
3. Leave it on staging, or delete it from Settings to clean up.

Record, for §7:
- the APK file name and sha256;
- the phone model and Android version;
- the staging commit;
- pass or fail per step, with screenshots of 3a.5–6 and 3b.4–6.

## 4. All three routes through real requests (staging, verify identity)

```sh
FIREBASE_WEB_API_KEY=<staging web apiKey> \
  npx tsx scripts/verifyEmailSignInGuards.ts --project $STAGING --reset-inbox <an inbox you read>
```

Expected, ending in GO:

| Check | Route | Expected |
| --- | --- | --- |
| Registration | | beforeSignIn, beforeSendEmail and beforeCreate PASS |
| Account that never changed its email | password | accepted. This proves the key reaches this project; the run stops otherwise. |
| Replaced address | password (guardEmailSignIn) | refused `address-replaced`; Auth repaired to the settled address |
| Replaced address | reset email (guardEmailSent) | refused `address-replaced`; Auth repaired again |
| Settled address | password | accepted |
| Replaced address | email code (verifyEmailOtp) | refused `address-replaced`; Auth repaired again |
| Settled address | email code (verifyEmailOtp) | accepted, with a token |
| `--reset-inbox` | reset email | accepted, and the email arrives |

The code for the email-code rows is planted as a hashed challenge, as `requestEmailOtp`
stores it, so no email is sent. The callable is called without an App Check token, like
the current app; with `APPCHECK_ENFORCE=on` on that project those rows would be refused
before the check runs (it is off everywhere until the app ships App Check).

**Timing:** every line prints the request's round trip. Run once after at least 20
minutes with no calls (a cold start) and once right after.
- Only password sign-ins and reset or sign-in-link emails wait on a guard. Those must stay
  well under the 7-second limit.
- If the cold run comes near it, decide on `minInstances` for the guards before §5.

The script deletes the users and documents it created. Audit rows of the refusals stay. It
prints no password, token or code.

## 5. Production activation

Only after §3 and §4 pass, and with the owner's explicit go-ahead. Run every command with
the owner's own login, in Cloud Shell.

**What it changes:**
- From stage A on, every password sign-in and every reset or sign-in-link email goes
  through a guard. Code and phone sign-ins do not (custom tokens); their route is
  `verifyEmailOtp`.
- From stage C on, accounts on an app version that has the change screen can add or
  change their email.

**Not part of this activation:**
- phone sign-in and linking;
- the SMS verification policy (the suspension stays);
- display names in the chat functions;
- PR #29's chat functions.

Each is a separate decision. **Never run `firebase deploy --only functions` without
function names from this branch**: it would redeploy every function, phone and SMS
included.

**Pre-checks** (read-only):
1. `npx tsx scripts/verifyEmailSignInGuards.ts --project offlinesms-prod-2027 --registration-only`
   - Expect beforeCreate → onUserCreate PASS, and the two guard lines FAIL: nothing
     else is registered yet.
2. `systemSettings/general.emailChangeEnabled` is absent or false. Absent means off; the
   change stays off through stages A and B.
3. Deploy from the environment and `functions/.env.offlinesms-prod-2027` that deployed
   `requestEmailOtp`.
   - It must provide `RESEND_API_KEY` and `EMAIL_FROM`.
   - It must not set `EMAIL_CHANGE_TEST_FAULTS` (production ignores it anyway).
4. Check out the exact reviewed commit, then run `npm ci`.

**Stage A — protection first:**

```sh
firebase deploy --project offlinesms-prod-2027 --only functions:guardEmailSignIn,functions:guardEmailSent,functions:verifyEmailOtp,functions:deleteMyAccount,functions:reconcileEmailChangeWrites
```

All five are required; none is optional.
- `verifyEmailOtp` protects the email-code route.
- `deleteMyAccount` removes the per-account change documents.
- `reconcileEmailChangeWrites` is the scheduled repair.

`verifyEmailOtp` and `deleteMyAccount` already run in production. This replaces them with
this branch's versions, which also carry the branch's earlier changes to them. Those
changes are part of this PR's review.

**Check A** — all of these must pass before stage B:
1. Registration: run the command from pre-check 1. Expect GO.
2. **The three routes, through real requests on production:**

   ```sh
   FIREBASE_WEB_API_KEY=<production web apiKey> \
     npx tsx scripts/verifyEmailSignInGuards.ts --project offlinesms-prod-2027 --allow-production
   ```

   - Expect GO, with the same rows as §4 (no `--reset-inbox` needed).
   - It creates throwaway users at `example.com`, refuses them on the password, reset
     and email-code routes, and deletes them.
3. On a phone with the store app, sign in by email code. Expect normal entry. This checks
   `verifyEmailOtp`'s normal path only; no guard runs for it.
4. Check `firebase functions:log --only guardEmailSignIn,guardEmailSent,verifyEmailOtp`.
   Expect no errors and no `signin-unavailable` or `email-unavailable`.

**Stage B — the change functions, still switched off:**

```sh
firebase deploy --project offlinesms-prod-2027 --only functions:requestEmailChangeCode,functions:verifyEmailChangeCode,functions:resumeEmailChange,functions:getSignInMethods
```

**Check B:**
- `npx tsx scripts/emailChangeDrainStatus.ts --project offlinesms-prod-2027` shows the
  switch off and zero changes.
- In the production-backed test app, Settings → Email → Edit says the change is
  unavailable.

**Stage C — turn the change on:**
1. Set `systemSettings/general.emailChangeEnabled = true` in the Firestore console.
2. Optional, your call: change the email of a test account once, with the
   production-backed test app.
3. Run the stage-A route check again. Expect GO.

**Rules and indexes:**
- The new collections need no rule to work. Unmatched paths are already denied to
  clients, and the functions use the Admin SDK.
- The admin-read rules for them ship with the PR #29/#30 rules review, not here.
- No new index.

**Rollback** — in this order:
1. **Turn the change off:** set `emailChangeEnabled = false`. This needs no deploy and
   takes effect at once.
   - No new change starts, and no new code is accepted.
   - Changes already accepted can still finish, so no account is stranded mid-way.
   - The scheduled repair keeps running.
2. **Keep everything else deployed**: the guards, `verifyEmailOtp`, `deleteMyAccount`,
   the change functions and the scheduled repair. Removing any of them while a change or
   an Auth write can still land would reopen the replaced-address window, or strand an
   account mid-way.
3. **Drain.** Run `npx tsx scripts/emailChangeDrainStatus.ts --project offlinesms-prod-2027`
   until it reports DRAINED: switch off, nothing mid-way, no pending or uncertain write,
   nothing scheduled. It is read-only and prints counts only.
4. **A faulty guard** (for example, refusing valid password sign-ins):
   - Code and phone sign-ins are unaffected.
   - Fix it forward by redeploying a corrected guard.
   - Delete a guard only after DRAINED. Then confirm that Authentication → Settings →
     Blocking functions no longer names it: a registration pointing at a deleted function
     blocks every password sign-in or email on that route.
5. `verifyEmailOtp` is never rolled back to a version without its check.

The store app release is separate. Until a store version has the change screen, only test
builds call the change functions.

## 6. Documented limit (kept)

The one token issued without a new sign-in is the reply of the request that performed the
Auth write.
- That request was authorized with an unrevoked, recent session before its own write.
- Account standing is re-checked right before the token is minted.
- A revocation that lands while that same request is still running, such as "sign out
  everywhere", does not stop that reply's token. Firebase keeps only a one-second marker of
  the latest revocation and cannot tell it apart from the change's own.
- That token is for the same account. It grants nothing beyond what the verified new
  address already allows: its holder can sign in with that address.

Every other step (verify retry, resume) refuses a revoked session with `reauth-required`
and no token.

## 7. Results record

| Item | Value |
| --- | --- |
| Staging project / commit | |
| APK file / sha256 | |
| Phone / Android | |
| 3a lost reply, server finished | pass / fail |
| 3b lost reply, server stopped, finish in app | pass / fail |
| 3b variant, start screen | pass / fail |
| 3c replaced address opens a new account only | pass / fail |
| §4 result (cold / warm ms) | GO / NO-GO |
| Reset email received (`--reset-inbox`) | yes / no |
| Owner go-ahead for §5 | date |
| Check A (production routes) | GO / NO-GO |
| Stage C switch on | date |
