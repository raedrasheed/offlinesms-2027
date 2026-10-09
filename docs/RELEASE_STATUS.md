# Release status: implemented vs. available in production

*As of 2026-10-09.* Production = Firebase project `offlinesms-prod-2027` plus the store app **2.3.18** (built from `main`). Sources: [`PHONE_LINKING_SECURITY.md` §12.4](PHONE_LINKING_SECURITY.md) (deployment record) and the PR history.

| Area | Implemented (branch / PR) | Tested | **In production** |
|---|---|---|---|
| Phone sign-up/sign-in protection, relay enforcement, phone-link backend | PR #28 | CI, emulators, Robolectric | **Partly deployed, stopped** (2026-10-08): 20 functions, rules and indexes deployed. Verification SMS **disabled** (`enabled:false`, `emergencyStop:true`, `signin`/`link` off). Phone sign-in returns `phone-auth-unavailable`; `getPhoneLinkStatus` reports linking unavailable. |
| "Add phone number" in Settings (always visible, "Not available yet") | PR #29 | unit | **No.** The store app 2.3.18 hides the row. Once a new app ships, the row will read "Not available yet" while linking stays disabled. |
| Phone linking for users | PR #28 + #29 | emulators | **Disabled. Stays disabled** until the open gates in PHONE_LINKING_SECURITY.md §12 are closed. |
| Notification → message fixes, sync banner | PR #29 (app) | unit, real SQLite | **No** (needs an app release) |
| Responsiveness (v6 indexes, mapper, listeners) | PR #29 (app) | in-process harness | **No** |
| Local DB v7 + atomic, self-healing upgrades | PR #29 (app) | real SQLite, upgrades from v1–v5 | **No.** Production 2.3.18 still has the non-atomic upgrade bug, which this fixes. |
| Emoji picker | PR #29 (app) | unit, web gallery | **No** |
| Stickers | PR #29 (app + `sendTextMessage` `kind`) | unit, emulators | **No.** The server is not deployed. A new app talking to the current server sends a sticker as its emoji text. |
| Polls | PR #29 (app + `sendTextMessage` `kind`, `votePoll`, `closePoll`) | unit, emulators (incl. concurrency) | **No.** Without the deployed functions, a new app sends the poll as text "📊 question" and votes fail. |
| Test APK | PR #29 CI job `mobile app · installable APK` | builds | Not a store build; placeholder backend unless a test project is configured |

## Release order (when approved)
1. Merge PR #28, then PR #29.
2. Deploy to a **non-production** project first and run `docs/DEVICE_VALIDATION.md` §3–§6 on physical devices.
3. Deploy the functions to production: `sendTextMessage`, `votePoll`, `closePoll`, `deleteMessage`, `onMessageCreate`, `onMessageCreateNotify`.
4. Release the app, with the version bumped from 2.3.18 / versionCode 15. Older apps keep working: they show stickers as emoji and polls as text.
5. Phone linking and verification SMS stay disabled throughout. Enabling them is a separate, gated decision.
