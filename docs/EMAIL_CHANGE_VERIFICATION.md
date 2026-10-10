# Email change: operational verification and production activation

Covers the email add/change flow of PR #30 (`functions/src/emailChange/*`) and its two
sign-in guards, `guardEmailSignIn` (beforeSignIn) and `guardEmailSent` (beforeSendEmail).

- Production (`offlinesms-prod-2027`) stays undeployed until §2 and §3 pass on a
  non-production project **and** the owner approves §4.
- Nothing here touches the SMS verification suspension, the phone functions or
  `smsConfig`.

## 0. Already verified without a real project

- Unit, rules and emulator integration suites run in CI on every push. The handoff file
  records the counts per review round.
- **Password sign-in guard, through real Identity Toolkit requests on the local
  emulators.** `scripts/verifyEmailSignInGuards.ts` creates the replaced-address state, then
  signs in over REST the way the SDKs do:

  ```
  PASS  password sign-in with the replaced address is refused (address-replaced) — refused: BLOCKING_FUNCTION_ERROR_RESPONSE … HTTP error 403 … (1661 ms)
  PASS  the refusal repaired the Auth record to the settled address
  SKIP  password reset to the replaced address — the Auth emulator does not run beforeSendEmail; run against a test project
  PASS  password sign-in with the settled address is accepted — accepted (25 ms)
  PASS  custom-token sign-in (the app's own path) is accepted — accepted (6 ms)
  PASS  an account that never changed its email signs in with its password — accepted (22 ms)
  GO: all checks passed
  ```

- **Emulator limits** (firebase-tools 13.35.1). Neither applies to a deployed project; §3
  checks the real registration.
  1. The Auth emulator never calls `beforeSendEmail`, so the reset guard needs a real
     project.
  2. The Functions emulator registers every non-create blocking trigger as `beforeSignIn`.
     With both guards loaded, the last one wins. The emulator run therefore loads a wrapper
     that exports only `guardEmailSignIn`. Build `functions/lib` first, then:

     ```sh
     # W: scratch dir with firebase.json (auth 9099, firestore 8080, functions 5001; source "src")
     #    and src/index.js: initializeApp(); exports.guardEmailSignIn =
     #    require('<repo>/functions/lib/emailChange/emailSignInBlocking.js').guardEmailSignIn;
     #    src/node_modules -> <repo>/node_modules
     cd $W && npx --prefix $REPO firebase emulators:exec --config $W/firebase.json \
       --project demo-offlinesms --only auth,firestore,functions \
       "cd $REPO && npx tsx scripts/verifyEmailSignInGuards.ts --project demo-offlinesms"
     ```
- **Not provable on emulators:**
  - Identity Platform registration of the guards;
  - `beforeSendEmail`;
  - the 7-second blocking deadline with a cold start;
  - real session revocation seen by a real device.

  §1–§3 cover these.

## 1. Staging project (one time)

Any project id other than `offlinesms-prod-2027` works, for example `offlinesms-staging`.
Below, `$STAGING` stands for that id.

1. **Project.** Firebase console → Add project.
   - Plan: **Blaze**. Functions v2, Cloud Scheduler and blocking functions need it.
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
   - If the web API key has Android *Application restrictions*, also add the test signing
     SHA-1 (CI prints it in `signing-cert.txt`).
3. **Functions configuration.** Create `functions/.env.$STAGING`; git ignores it:

   ```
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=<a Resend API key>
   EMAIL_FROM=OfflineSMS <noreply@your-verified-domain>
   EMAIL_CHANGE_TEST_FAULTS=on
   ```

   `EMAIL_CHANGE_TEST_FAULTS=on` enables the "stop the server" switch of §2b on this
   project only. The code ignores it on `offlinesms-prod-2027`.

   Then set the phone-hash secret to a fresh random value, never production's:

   ```sh
   openssl rand -base64 32 | firebase functions:secrets:set PHONE_HASH_PEPPER --project $STAGING --data-file -
   ```
4. **Deploy the reviewed commit** to staging. The predeploy step builds the functions.

   ```sh
   git fetch origin claude/phone-email-login-display-names-pu9nez && git checkout <reviewed sha>
   npm ci
   firebase deploy --project $STAGING --only functions,firestore:rules,firestore:indexes
   ```
5. **Turn email sign-in on.** In Firestore, create `systemSettings/general` with
   `emailSignInEnabled: true` (boolean). Leave every phone or SMS setting unset.
6. **Check registration:**

   ```sh
   GOOGLE_APPLICATION_CREDENTIALS=<staging service-account.json> \
     npx tsx scripts/verifyEmailSignInGuards.ts --project $STAGING --registration-only
   ```

   Expect GO, with three routes registered:
   - beforeSignIn → guardEmailSignIn;
   - beforeSendEmail → guardEmailSent;
   - beforeCreate → onUserCreate.
7. **Staging test APK.** In GitHub → Settings → Secrets and variables → Actions:
   - **Secret** `MOBILE_STAGING_GOOGLE_SERVICES_JSON`: the file from step 2.
   - **Variables** from the staging Web app: `MOBILE_STAGING_FIREBASE_API_KEY`,
     `MOBILE_STAGING_FIREBASE_AUTH_DOMAIN`, `MOBILE_STAGING_FIREBASE_PROJECT_ID`,
     `MOBILE_STAGING_FIREBASE_STORAGE_BUCKET`, `MOBILE_STAGING_FIREBASE_APP_ID` and
     `MOBILE_STAGING_FIREBASE_MESSAGING_SENDER_ID`.

   Then Actions → CI → **Run workflow** on `claude/phone-email-login-display-names-pu9nez`,
   with `test_backend` = **staging**.
   - The job fails if a staging setting is missing or points at production.
   - Artifact `offlinesms-test-updated` holds `offlinesms-test-updated-<sha>-$STAGING.apk`.
   - Test APKs compile in the test switches (`EXPO_PUBLIC_TEST_FAULTS=1`); store builds
     never do.

**To have Claude run §1.3–§1.6 and §3 itself**, the session needs a staging-only
credential:
- a service account in `$STAGING` (Owner on that project only, **never** on production);
- its JSON key, the staging web `apiKey` and a Resend key, stored as environment
  variables of the cloud environment (Project settings → Cloud environment → the gear by
  the environment):
  - `STAGING_FIREBASE_SA_JSON` (the whole key file);
  - `STAGING_FIREBASE_PROJECT_ID`;
  - `STAGING_FIREBASE_WEB_API_KEY`;
  - `STAGING_RESEND_API_KEY`;
  - `STAGING_EMAIL_FROM`.

A new session picks them up. Keys never go in chat. Step 7 (GitHub secret and variables)
stays with the repository owner.

## 2. Device check: the reply is lost, then sign in with the new email and finish in the app

You need:
- the staging APK from §1.7;
- one Android phone;
- two inboxes you can read, A and B.

Uninstall "OfflineSMS Test" first. It has the same package as the production-backed test
build, so this keeps no production session or local data. Code emails share a 60-second
per-address cooldown: if the app says "Please wait a moment", wait and send again.

The test switches appear under the code field of the change-email screen. Each switch
applies to the next code entry only.

### 2a. The server finished; only the reply was lost

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

### 2b. The server stopped after writing the new address; the reply was lost

This is the reviewed path. A device whose reply was lost signs in again to the same
account with the new address, then finishes the change by its challenge id.

1. Continue from 2a, on the same account, now on B. Settings → Email → **Edit**. Confirm
   it's you if asked. Enter **A** → Send code. A is free again after 2a.
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

**Variant (sign in from the start screen):** repeat 2b with B as the target. Use a second
account or wait an hour, since an account gets 3 change codes per hour. After step 3, sign
out.
- On the start screen, sign in by email code with **B**. Expect the same account, with the
  same name.
- Open Settings → Email. Expect **Finish changing my email**. Tap it; expect "Done! You now
  sign in with B…"

### 2c. The replaced address no longer opens the account

1. Sign out. Sign in by email code with the address replaced last.
2. Expect a **new, empty** account (the profile step), not the original one.
3. Leave it on staging, or delete it from Settings to clean up.

Record, for §6:
- the APK file name and sha256;
- the phone model and Android version;
- the staging commit;
- pass or fail per step, with screenshots of 2a.5–6 and 2b.4–6.

## 3. Both guards through real Firebase requests (staging)

```sh
GOOGLE_APPLICATION_CREDENTIALS=<staging service-account.json> FIREBASE_WEB_API_KEY=<staging web apiKey> \
  npx tsx scripts/verifyEmailSignInGuards.ts --project $STAGING --reset-inbox <an inbox you read>
```

Expected, ending in GO:

| Check | Expected |
| --- | --- |
| Registration | beforeSignIn, beforeSendEmail and beforeCreate PASS |
| Password sign-in with the replaced address | refused `address-replaced`; Auth repaired to the settled address |
| Password-reset email to the replaced address | refused `address-replaced`; Auth repaired again |
| Password sign-in with the settled address | accepted |
| Custom-token sign-in (the app's path) | accepted |
| Account that never changed its email | accepted |
| `--reset-inbox` | accepted, and the reset email arrives |

Timing: every line prints the request's round trip. Run once after at least 20 minutes
with no calls (a cold start) and once right after.
- Accepted sign-ins must stay well under Identity Platform's 7-second limit for blocking
  functions.
- If the cold run comes near that limit, decide on `minInstances` for `guardEmailSignIn`
  before §4. It runs on every sign-in, and custom tokens pass straight through it.

The script deletes the users and ledger documents it created, and prints no password,
token or code.

## 4. Production activation

Only after §2 and §3 pass, and with the owner's explicit go-ahead.

**What it changes:**
- Accounts on an app version that has the change screen can add or change their email.
- From stage B on, every password sign-in, every custom-token sign-in (passed straight
  through) and every reset or sign-in-link email goes through the guards.

**Not part of this activation:**
- phone sign-in and linking;
- the SMS verification policy (the suspension stays);
- display names in the chat functions;
- PR #29's chat functions.

Each is a separate decision. **Never run `firebase deploy --only functions` without
function names from this branch**: it would redeploy every function, phone and SMS
included.

**Pre-checks** (read-only):
1. Authentication → Settings → Blocking functions shows only beforeCreate → onUserCreate.
   - Or run `--registration-only` on production. Before stage B it should show the two
     guard lines FAIL and beforeCreate PASS.
2. Deploy from the environment and `functions/.env.offlinesms-prod-2027` that deployed
   `requestEmailOtp`. It must provide `RESEND_API_KEY` and `EMAIL_FROM`, and must not
   set `EMAIL_CHANGE_TEST_FAULTS` (production ignores it anyway).
3. Note `systemSettings/general.emailSignInEnabled`. The change flow follows the same
   switch as email sign-in.
4. Check out the exact reviewed commit, then run `npm ci`.
5. `verifyEmailOtp` and `deleteMyAccount` already run in production. Stage A replaces them
   with this branch's version, which also carries this branch's earlier changes to them.
   Confirm that is intended, or drop them from stage A and accept the narrower guarantee
   noted there.

**Stage A — the change flow and its scheduled repair:**

```sh
firebase deploy --project offlinesms-prod-2027 --only functions:requestEmailChangeCode,functions:verifyEmailChangeCode,functions:resumeEmailChange,functions:getSignInMethods,functions:reconcileEmailChangeWrites,functions:verifyEmailOtp,functions:deleteMyAccount
```

- `verifyEmailOtp` refuses a replaced address on the email-code route.
- `deleteMyAccount` removes the new per-account documents.

Without these two:
- a replaced address could sign in by code during a stale-write window, until the
  scheduled repair;
- deleted accounts would leave their change ledger behind.

**Stage B — the guards, last** (they sit on every sign-in):

```sh
firebase deploy --project offlinesms-prod-2027 --only functions:guardEmailSignIn,functions:guardEmailSent
```

Right after stage B:
1. Run `--registration-only` on production. Expect GO.
2. Sign in on a phone with the store app by email code. Expect normal entry.
3. Check `firebase functions:log --only guardEmailSignIn`. Expect no errors and no
   `signin-unavailable`.

**Rules and indexes:**
- The new collections need no rule to work. Unmatched paths are already denied to
  clients, and the functions use the Admin SDK.
- The admin-read rules for them ship with the PR #29/#30 rules review, not here.
- No new index.

**Rollback:**
- **Guards:** run
  `firebase functions:delete guardEmailSignIn guardEmailSent --project offlinesms-prod-2027 --region us-central1 --force`.
  Then confirm that Blocking functions lists no beforeSignIn or beforeSendEmail. Remove a
  leftover there: a registration pointing at a deleted function blocks every sign-in.
- **Change flow:** delete its five functions. The app then shows the change as
  unavailable.
- `verifyEmailOtp` and `deleteMyAccount`: redeploy them from the previously deployed
  commit.

The store app release is separate. Until a store version has the change screen, only test
builds call these functions.

## 5. Documented limit (kept)

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

## 6. Results record

| Item | Value |
| --- | --- |
| Staging project / commit | |
| APK file / sha256 | |
| Phone / Android | |
| 2a lost reply, server finished | pass / fail |
| 2b lost reply, server stopped, finish in app | pass / fail |
| 2b variant, start screen | pass / fail |
| 2c replaced address opens a new account only | pass / fail |
| §3 script result (cold / warm ms) | GO / NO-GO |
| Reset email received (`--reset-inbox`) | yes / no |
| Owner go-ahead for §4 | date |
