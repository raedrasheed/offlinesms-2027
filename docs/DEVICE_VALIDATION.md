# Device validation — notifications, stickers/polls, performance, migrations

This document records **what has actually been validated and where**. Results from a physical device are recorded separately from emulator and in-process results, and an empty cell means "not run". Do not fill a device cell from an emulator run.

## 0. What this environment could and could not do

| Capability | Status here |
|---|---|
| Android SDK 36, NDK 27, Gradle release build of the main app | ✅ (installable APK, §1) |
| Android emulator | ❌ no KVM / CPU virtualization in the build container |
| Physical devices | ❌ none attached |
| Non-production Firebase project (Auth, Firestore, Functions, FCM) | ❌ none configured; `.firebaserc` has only `offlinesms-prod-2027` |
| Firestore + Auth emulators, real SQLite (sql.js) | ✅ all server and local-DB tests below |

As a result, **every row marked "device" in §3–§5 is still open**. The build, scripts and steps for running them are below.

## 1. Installable builds

See **[TEST_BUILDS.md](TEST_BUILDS.md)**. CI builds a matched pair, `offlinesms-test-updated` and `offlinesms-test-baseline`:
- package `app.offlinesms.mobile.test`, named "OfflineSMS Test";
- it installs **next to** the store app, so there's no need to uninstall anything;
- both have the same signing and identical timing instrumentation.

They are functional once the backend configuration in TEST_BUILDS.md §3 is set. Until then they use a placeholder backend: they install and open, but cannot sign in.

## 2. Recording results

Record every run as one row:

| Field | Example |
|---|---|
| Date | 2026-10-09 |
| Tested commit | `11c2113…` |
| APK SHA-256 | from the artifact |
| Where | **device** (model, Android version) / emulator / in-process |
| Network | Wi-Fi, LTE, "Slow 3G" via a throttling proxy, airplane mode on/off |
| Result | pass / fail + notes |

## 3. Notification tap → message visible

**Preconditions:** two accounts, A and B, on two **physical** devices (FCM). The test APK is on both. Messages are sent from A to B.

| # | B's app state | Network on B | Steps | Expected | Device | Emulator | In-process tests |
|---|---|---|---|---|---|---|---|
| N1 | Foreground, other chat open | Wi-Fi | A sends; tap the banner | The chat opens at the message, highlighted; no restart needed | — | — | ✅ routing with `messageId`, targeted fetch |
| N2 | Background (home screen) | Wi-Fi | Tap the system notification | Same as N1; "Loading this message…" for at most a moment | — | — | ✅ |
| N3 | Killed (swipe away) | Wi-Fi | Tap the notification | Cold start; the request is queued until the DB opens; the message appears without a second tap | — | — | ✅ `pending` → `onDbOpened` |
| N4 | Background | Slow 3G (throttled) | Tap | "Loading this message…", then the message; no duplicate | — | — | ✅ coalescing, deduplication |
| N5 | Background | Offline when tapped, then online | Airplane mode → tap → airplane off | "Waiting for connection…", then the message appears on reconnect | — | — | ✅ `waiting-network` → retry on reconnect |
| N6 | Any | Wi-Fi | A deletes the message for everyone before B taps | "This message is no longer available" | — | — | ✅ `missing` |
| N7 | Foreground, **same** chat open | Wi-Fi | A sends 10 messages quickly | All appear in order, none dropped or duplicated; read state updates | — | — | ✅ feeder + coalescing |

## 4. Stickers and polls between two devices

| # | Scenario | Expected | Device | Emulator | Server / in-process tests |
|---|---|---|---|---|---|
| S1 | A sends a sticker; B is online | B sees the image with no network fetch for the image itself | — | — | ✅ catalog-only ids, bundled assets |
| S2 | A sends a sticker while offline, then reconnects | Queued → sent once; B receives one | — | — | ✅ outbox + idempotent send |
| S3 | B is on an **older** app version | B sees the sticker's emoji | — | — | ✅ text fallback |
| P1 | Single-choice poll; A and B vote at the same moment | Each vote counted once; both see 2 voters | — | — | ✅ 25 concurrent voters with duplicate retries |
| P2 | Multiple-choice poll; B picks 2 options, then removes 1 | Counts move live on A | — | — | ✅ |
| P3 | B votes while offline, changes the vote, then reconnects | Only the **last** choice counts | — | — | ✅ `seq` rejects stale retries |
| P4 | The creator ends the poll; B taps an option | Refused; results stay visible | — | — | ✅ |
| P5 | B is removed from the group, then tries to vote | Refused | — | — | ✅ |

## 5. Performance (same device, same network)

1. Install `offlinesms-test-baseline`, sign in, open the same chats, then run:
   ```
   scripts/device/perf-capture.sh coldstart baseline 10
   scripts/device/perf-capture.sh session baseline 240   # open 5 chats, load older twice, send 5, tap 3 notifications
   ```
2. Install `offlinesms-test-updated` **over it**, without uninstalling, and repeat with the label `updated`.
3. Compare the medians:
   - cold start `TotalTime`;
   - `auth:resolved` and `chatList:shown`;
   - the spans `conversation_open`, `push_to_visible`, `send_to_visible` and `older_to_visible`.

The `baseline` build carries the same timing points as `updated` (byte-identical `src/lib/perf.ts`), so every span compares like-for-like.

| Metric | Before (device) | After (device) | In-process harness (same machine, before → after) |
|---|---|---|---|
| Cold start TotalTime | — | — | n/a |
| Open conversation (20k messages) | — | — | 59 ms → 2.5 ms |
| New message visible | — | — | 72 ms (201 statements) → 2.7 ms (4 statements) |
| Load older (10th page) | — | — | 87 ms → 25 ms |
| Notification tap → visible | — | — | n/a |

## 6. Existing-user database migrations

| Check | Real SQLite (sql.js), real `openForUser` | Device |
|---|---|---|
| Upgrade from each shipped schema v1–v5 (built from that release's own code) → v7, identical to a fresh install | ✅ | — |
| Every message, conversation, cursor and device id preserved; the old version's pending outbox item delivered once | ✅ | — |
| New indexes used after the upgrade | ✅ | — |
| Upgrade interrupted at **any** statement → full rollback; the next launch succeeds | ✅ (fixed in `353d2d6`; it failed before) | — |
| Devices left half-upgraded by the old runner open again | ✅ (fixed in `353d2d6`) | — |

**Device check:** install `offlinesms-test-baseline` (schema v5, same code as production 2.3.18), use it, then install `offlinesms-test-updated` **over it**. Same package and same key, so this is a real in-place upgrade to v7. See TEST_BUILDS.md §4.
