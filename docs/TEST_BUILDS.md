# Functional test builds (sign-in, sync, notifications)

## 1. What a functional build technically needs

A test APK works when its two pieces of Firebase configuration point at **one** Firebase project that runs the backend:

| Capability | Client needs | Server needs | Production `offlinesms-prod-2027` today |
|---|---|---|---|
| Sign in (emailed code) | Web config `EXPO_PUBLIC_FIREBASE_*` of that project | `requestEmailOtp` / `verifyEmailOtp` deployed; Resend configured (`RESEND_API_KEY`, `EMAIL_FROM`); email sign-in enabled (`systemSettings/general.emailSignInEnabled`); the functions' service account can mint custom tokens | ✅ in use by the store app |
| Sync (chats, messages, read state) | Same web config | Rules, indexes and chat callables deployed | ✅ (PR #28 rules and indexes deployed 2026-10-08) |
| Push notifications (Android) | `google-services.json` of **the same project**, containing an Android app for the **test package** `app.offlinesms.mobile.test`; the device's FCM token is issued for that project | `onMessageCreateNotify` sends through firebase-admin FCM in that project, with `messageId` in the data | ✅ test package registered; CI config and production opt-in completed. |
| Notification tap → that message; sync banner; performance; DB upgrade | Nothing beyond the above (client-only changes) | Nothing new | ✅ |
| Stickers, polls | Same | **Deploy from this branch:** `sendTextMessage`, `votePoll`, `closePoll`, `deleteMessage`, `onMessageCreate`, `onMessageCreateNotify`, `reactToMessage`. No rules or index change. | ❌ not deployed. New rich sends are refused and retain their local draft; an older server cannot store poll options. |
| Phone registration / linking | Existing protected phone flow | Ready relay 0.2.0, deployed purpose env and runtime policy | Owner authorized activation on 2026-10-09; **not activated yet**. See `PHONE_TEST_ACTIVATION.md`. |

## 2. Technical requirement vs. current CI policy

- **Technical:** the production project already provides everything for sign-in, sync, notifications, tap-to-message, performance and upgrade testing. The test-package registration and CI configuration are now complete. A **separate project** would need *everything* recreated:
  - Blaze billing;
  - all functions, rules, indexes and storage rules;
  - the `PHONE_HASH_PEPPER` secret, which the phone functions bind even while disabled;
  - Resend credentials with a verified sender domain;
  - the custom-token signing permission;
  - `systemSettings` and `smsConfig/otp` documents, with SMS kept disabled.
- **Policy (this repository's CI, not a technical limit):** the build refuses the production project unless `MOBILE_TEST_ALLOW_PRODUCTION_BACKEND=true` is set. Opting in means:
  - test phones sign into **real accounts** and read and write **real data**;
  - test messages notify real recipients;
  - stickers and polls additionally need the seven functions above deployed **to production**, which changes behavior for every user, because `sendTextMessage` handles all sends.

  Use test accounts that message only each other.

## 3. Backend setup and deployment

**Current choice: production backend.** Steps 1–4 below are completed, including explicit production opt-in; they are retained for reproducibility. Both matched APKs passed CI run #448. The feature deployment in step 5 remains pending; the current session could not access Google Cloud/Cloud Shell. See `PHONE_TEST_ACTIVATION.md` for phone activation and the private relay APK.
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
5. **Pending, authorized: stickers and polls.** Run from the exact reviewed commit in an authenticated deployment environment:
   `firebase deploy --project offlinesms-prod-2027 --only functions:sendTextMessage,functions:votePoll,functions:closePoll,functions:deleteMessage,functions:onMessageCreate,functions:onMessageCreateNotify,functions:reactToMessage`
   - This touches no phone or SMS function, no rule and no `smsConfig`.
   - This session has Firebase console access, but no usable deployment shell or authenticated CLI.

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

Open a conversation/group with a slow connection: the routine "Connecting…" chip must never appear. Notification-target and actual offline/error notices remain.

Record pass/fail per row, with the APK SHA-256 and the phone models. Phone results only; see `docs/DEVICE_VALIDATION.md` for the full matrix.

| # | Do | Expect |
|---|---|---|
| 1 | B in the **foreground** in another chat; A sends text | B shows the banner; tapping opens A's chat **at that message**, highlighted |
| 2 | B on the **home screen**; A sends | Tapping the system notification opens the chat at the message, with at most a brief "Loading this message…" |
| 3 | B **swiped away** (killed); A sends | Tapping cold-starts the app and shows the message without a second tap |
| 4 | B in **airplane mode**; A sends; B turns airplane off, then taps | "Waiting for connection…" → the message appears; no duplicate |
| 5 | A **offline**, sends 3 texts; A goes online | Each arrives exactly once at B, in order |
| 6 | A sends a **sticker** (needs §3 step 5) | B shows the sticker image; the chat list shows "👋 Sticker" |
| 7 | A creates a **single-choice** poll with the keyboard open: edit the question, first and last options, then send; A and B vote at the same moment | Focused inputs and Send stay reachable above the keyboard; the message shows the question and selectable options, including while queued (disabled until delivery). Both votes count once |
| 8 | A creates a **multiple-choice** poll; B selects 2 options, then removes 1 | A's counts update live |
| 9 | B votes while **offline**, changes the vote, then goes online | Only the last choice counts |
| 10 | A goes offline, ends the poll, restarts the app, then reconnects; B taps an option after the close arrives | A shows pending confirmation across restart; closes after reconnect; B cannot vote after server confirmation; results stay visible. A server refusal offers retry |
| 11 | A opens the **emoji panel** in the composer, searches "heart" and then "قلب", inserts two emoji mid-sentence | Both searches find results; emoji land at the caret; the panel's Recents shows them next time |
| 12 | B long-presses A's message, opens +, searches "قلب" and "heart", and reacts from a non-default category | Full shared emoji catalog and recents; A sees the reaction; the push says who reacted |
| 13 | The **store app** (2.3.18) on a third phone, in the same group, receives a sticker and a poll | Shows the fallback text ("👋", "📊 question"); no crash; cannot vote |
| 14 | After phone activation, an **email** account opens Settings → "Add phone number" and completes verification on its test number | Code arrives through the ready relay; number links; cooldown and incorrect-code handling work. Until activation, "Not available yet" is expected |
| 15 | Performance, same phone and account: §4 with `baseline`, then `updated` installed over it | `updated` cold start and conversation open no slower than `baseline`; chat list and history intact after the upgrade |

Rows 1–5, 11, 13 and 15 use the existing backend (row 13 receives the fallback for new content). Rows 6–10 and full reaction support in row 12 need §3 step 5. Row 14 and new phone registration need `PHONE_TEST_ACTIVATION.md`; do not report them working from a successful APK build alone.

