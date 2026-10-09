# Release status: implemented vs. available in production

*As of 2026-10-09.* Production = Firebase project `offlinesms-prod-2027` plus the store app **2.3.18** (built from `main`). Sources: [`PHONE_LINKING_SECURITY.md` §12.4](PHONE_LINKING_SECURITY.md) (deployment record) and the PR history.

| Area | Implemented (branch / PR) | Tested | **In production** |
|---|---|---|---|
| Phone sign-up/sign-in protection, relay enforcement, phone-link backend | PR #28 | CI, emulators, Robolectric | **Partly deployed, stopped** (2026-10-08): 20 functions, rules and indexes deployed. Verification SMS **disabled** (`enabled:false`, `emergencyStop:true`, `signin`/`link` off). Phone sign-in returns `phone-auth-unavailable`; `getPhoneLinkStatus` reports linking unavailable. |
| "Add phone number" in Settings (always visible, "Not available yet") | PR #29 | unit | **No.** The store app 2.3.18 hides the row. Once a new app ships, the row will read "Not available yet" while linking stays disabled. |
| Phone linking for users | PR #28 + #29 | emulators | **Not activated.** Owner requested activation on 2026-10-09. Deployment access and real relay readiness remain unresolved; see PHONE_TEST_ACTIVATION.md. |
| Notification → message fixes, sync banner | PR #29 (app) | unit, real SQLite | **No** (needs an app release) |
| Responsiveness (v6 indexes, mapper, listeners) | PR #29 (app) | in-process harness | **No** |
| Local DB v7 + atomic, self-healing upgrades | PR #29 (app) | real SQLite, upgrades from v1–v5 | **No.** Production 2.3.18 still has the non-atomic upgrade bug, which this fixes. |
| Emoji picker and full searchable reactions | PR #29 (app + reaction validation) | catalog/search and full-catalog admission unit tests; web gallery | **No store release.** Deploy `reactToMessage` for flags/keycaps/information emoji |
| Stickers | PR #29 (app + `sendTextMessage` `kind`) | unit, emulators | **No.** The server is not deployed. Updated test builds keep the full sticker locally and fail the send against the old server instead of silently publishing emoji text. |
| Polls | PR #29 (app + `sendTextMessage` `kind`, `votePoll`, `closePoll`) | unit, emulators (incl. concurrency) | **No.** Updated test builds retain the full question/options locally and refuse the send against the old server. Deploy the functions for delivery and voting; polls already published as text need to be recreated. |
| Test APK pair | PR #29 CI jobs, package `app.offlinesms.mobile.test` | both passed run #448 before the current additions | Production backend configured with owner approval; installs alongside the store app. New feature backend still needs deployment |

The current additions also queue poll closing offline, persist its pending/failure state and mount the reaction picker only when opened. The routine Connecting banner is hidden, the poll form resizes and scrolls above the keyboard, and queued/failed polls retain their full card with explicit retry. Keyboard behavior still needs a physical-device check. Local regression tests passed; physical-device performance remains to be measured. The owner reported that notification taps now reveal the message immediately, but conversation/group opening was still slow.

## Release order (store release not requested)
1. Merge PR #28, then PR #29.
2. Use the owner-approved production backend with controlled test accounts and run `docs/DEVICE_VALIDATION.md` §3–§6 on physical devices.
3. Deploy the functions to production: `sendTextMessage`, `votePoll`, `closePoll`, `deleteMessage`, `onMessageCreate`, `onMessageCreateNotify`, `reactToMessage`.
4. Release the app, with the version bumped from 2.3.18 / versionCode 15. Older apps keep working: they show stickers as emoji and polls as text.
5. Complete the already-authorized phone activation from `PHONE_TEST_ACTIVATION.md`, verifying the physical relay and protected policy before claiming availability. This session could not deploy functions or activate sending.

