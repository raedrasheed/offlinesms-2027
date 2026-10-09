# Functional test builds (sign-in, sync, notifications)

## 1. What a functional build technically needs

A test APK works when its two pieces of Firebase configuration point at **one** Firebase project that runs the backend:

| Capability | Client needs | Server needs | Production `offlinesms-prod-2027` today |
|---|---|---|---|
| Sign in (emailed code) | Web config `EXPO_PUBLIC_FIREBASE_*` of that project | `requestEmailOtp` / `verifyEmailOtp` deployed; Resend configured (`RESEND_API_KEY`, `EMAIL_FROM`); email sign-in enabled (`systemSettings/general.emailSignInEnabled`); the functions' service account can mint custom tokens | ✅ in use by the store app |
| Sync (chats, messages, read state) | Same web config | Rules, indexes and chat callables deployed | ✅ (PR #28 rules and indexes deployed 2026-10-08) |
| Push notifications (Android) | `google-services.json` of **the same project**, containing an Android app for the **test package** `app.offlinesms.mobile.test`; the device's FCM token is issued for that project | `onMessageCreateNotify` sends through firebase-admin FCM in that project, with `messageId` in the data | ✅ server side. ❌ **The test package is not registered yet.** |
| Notification tap → that message; sync banner; performance; DB upgrade | Nothing beyond the above (client-only changes) | Nothing new | ✅ |
| Stickers, polls | Same | **Deploy from this branch:** `sendTextMessage`, `votePoll`, `closePoll`, `deleteMessage`, `onMessageCreate`, `onMessageCreateNotify`. No rules or index change. | ❌ not deployed. Stickers arrive as emoji text and votes fail. |
| Phone linking / verification SMS | — | — | Disabled, and **stays disabled**. The test app shows "Not available yet". |

## 2. Technical requirement vs. current CI policy

- **Technical:** the production project already provides everything for sign-in, sync, notifications, tap-to-message, performance and upgrade testing. The only missing piece is the Android app registration for the test package. A **separate project** would need *everything* recreated:
  - Blaze billing;
  - all functions, rules, indexes and storage rules;
  - the `PHONE_HASH_PEPPER` secret, which the phone functions bind even while disabled;
  - Resend credentials with a verified sender domain;
  - the custom-token signing permission;
  - `systemSettings` and `smsConfig/otp` documents, with SMS kept disabled.
- **Policy (this repository's CI, not a technical limit):** the build refuses the production project unless `MOBILE_TEST_ALLOW_PRODUCTION_BACKEND=true` is set. Opting in means:
  - test phones sign into **real accounts** and read and write **real data**;
  - test messages notify real recipients;
  - stickers and polls additionally need the six functions above deployed **to production**, which changes behavior for every user, because `sendTextMessage` handles all sends.

  Use test accounts that message only each other.

## 3. Exact actions needed from you

**Option A: production backend** (fastest; no server change for items 1–4 of the checklist):
1. Firebase console → project `offlinesms-prod-2027` → ⚙ *Project settings* → *General* → *Your apps* → **Add app → Android**:
   - package **`app.offlinesms.mobile.test`**;
   - nickname "OfflineSMS Test";
   - SHA-1 not required.

   Download the new `google-services.json`. It contains both Android apps.
2. In the same page → your **Web app** → *SDK setup and configuration* → *Config*, copy `apiKey`, `authDomain`, `projectId`, `storageBucket`, `appId`, `messagingSenderId`.
3. GitHub → repository → *Settings* → *Secrets and variables* → *Actions*:
   - **Secret** `MOBILE_GOOGLE_SERVICES_JSON`: the whole file from step 1.
   - **Variables** from step 2: `MOBILE_TEST_FIREBASE_API_KEY`, `MOBILE_TEST_FIREBASE_AUTH_DOMAIN`, `MOBILE_TEST_FIREBASE_PROJECT_ID`, `MOBILE_TEST_FIREBASE_STORAGE_BUCKET`, `MOBILE_TEST_FIREBASE_APP_ID`, `MOBILE_TEST_FIREBASE_MESSAGING_SENDER_ID`.
   - **Variable** `MOBILE_TEST_ALLOW_PRODUCTION_BACKEND` = `true`. This is the explicit decision described in §2.
4. *Actions* → *CI* → **Run workflow** on `claude/avatar-visibility-group-chat-r8ahfk`, or push any commit to PR #29. The artifacts `offlinesms-test-updated` and `offlinesms-test-baseline` then contain functional APKs labelled `offlinesms-prod-2027`.
5. **Only for stickers and polls:** approve and run, from this branch:
   `firebase deploy --project offlinesms-prod-2027 --only functions:sendTextMessage,functions:votePoll,functions:closePoll,functions:deleteMessage,functions:onMessageCreate,functions:onMessageCreateNotify`
   - This touches no phone or SMS function, no rule and no `smsConfig`.
   - The deploy needs your Firebase credentials. I don't have them.

**Option B: separate test project:** the same steps 1–4 in that project, with no production opt-in, after deploying the whole backend there (§2).

If your Google Cloud API key has *Application restrictions* set to Android apps, add `app.offlinesms.mobile.test` with the test signing certificate's SHA-1. CI prints the certificate in the job log and in `signing-cert.txt`. Unrestricted keys need nothing.

## 4. The matched pair (performance and in-place upgrade)

| | `baseline` | `updated` |
|---|---|---|
| Code | `2a61167` (before PR #29's changes) + `scripts/test-builds/baseline-instrumentation.patch` | this commit |
| Package / name | `app.offlinesms.mobile.test` / "OfflineSMS Test" | same |
| Signing | same key: repo debug key, or the secrets `MOBILE_TEST_KEYSTORE_*` | same |
| Timing | `src/lib/perf.ts`, **byte-identical** (checked by the build), called at the same screen-level points | same |
| versionCode / name | 900000 / `2.3.18-test-baseline-2a61167` | 900001 / `2.3.18-test-<sha>` |
| Local DB schema | v5 (as production 2.3.18) | v7 |

**Performance:** on one phone, on the same network and account:
1. Install `baseline` and sign in. Run `scripts/device/perf-capture.sh coldstart baseline 10` and `… session baseline`.
2. Install `updated` **over it**, without uninstalling, and repeat with the label `updated`.

**In-place upgrade:** step 2 above *is* the existing-user upgrade, v5 → v7, with real data on a real phone. After it:
- the chat list and messages are all present, without a full re-download;
- an unsent message from the baseline still sends once.

## 5. Two-phone checklist (A and B, both with "OfflineSMS Test", different test accounts)

Record pass/fail per row, with the APK SHA-256 and the phone models. Phone results only; see `docs/DEVICE_VALIDATION.md` for the full matrix.

| # | Do | Expect |
|---|---|---|
| 1 | B in the **foreground** in another chat; A sends text | B shows the banner; tapping opens A's chat **at that message**, highlighted |
| 2 | B on the **home screen**; A sends | Tapping the system notification opens the chat at the message, with at most a brief "Loading this message…" |
| 3 | B **swiped away** (killed); A sends | Tapping cold-starts the app and shows the message without a second tap |
| 4 | B in **airplane mode**; A sends; B turns airplane off, then taps | "Waiting for connection…" → the message appears; no duplicate |
| 5 | A **offline**, sends 3 texts; A goes online | Each arrives exactly once at B, in order |
| 6 | A sends a **sticker** (needs §3 step 5) | B shows the sticker image; the chat list shows "👋 Sticker" |
| 7 | A creates a **single-choice** poll; A and B vote at the same moment | Both count once; each phone shows "2 people voted"; changing a vote moves it |
| 8 | A creates a **multiple-choice** poll; B selects 2 options, then removes 1 | A's counts update live |
| 9 | B votes while **offline**, changes the vote, then goes online | Only the last choice counts |
| 10 | A ends the poll; B taps an option | Refused; results stay visible |
