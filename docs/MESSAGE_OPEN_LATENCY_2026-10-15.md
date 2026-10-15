# Foreground message latency follow-up — 2026-10-15

The user measured approximately six seconds between opening a conversation and
seeing new messages after the previous recovery fixes. That is a device report,
not a latency reproduced in this environment. PR #36 addressed failed local
writes and retry recovery; it did not remove WebChannel connection wait time.

## Findings in the shipped path

- `getDocsFromServer` / `getDocFromServer` in the installed full Firestore SDK
  perform a temporary snapshot listen. A one-shot read and the persistent
  listener therefore share the realtime transport's connection/backoff.
- Conversation open started network work after awaiting the initial SQLite
  read. Local and network latency accumulated instead of overlapping.
- On an existing installation, targeted catch-up followed the oldest missing
  timestamp cursor. Recent messages could wait behind multiple gap pages.
- The initial live snapshot committed up to 100 messages as one transaction.
  Its post-commit refresh could not display the newest rows until that whole
  transaction completed.

These are verified code paths, not proof that any single one accounts for all
six seconds on the user's network. Backend region, transport conditions and
device timings have not been measured here.

## Change

1. Use the installed Firebase **Lite** SDK for the short foreground reads. It
   makes authenticated REST `runQuery` / `batchGet` requests using the same
   Firebase app, Auth and App Check providers. Security Rules still apply.
   Realtime listeners keep the existing full SDK and native long-poll setting;
   SQLite remains the offline source of truth. No new dependency or server
   endpoint is introduced. Emulator mode routes both clients to the emulator.
2. On open/retry, fetch the newest **25** messages independently of a stalled
   background pull. Coalesce concurrent requests for the same session/chat.
   Do not advance the forward/history cursors: background catch-up must still
   repair the entire gap. A late bootstrap only fills missing rows, preserving
   existing live edits/deletion tombstones and deleted-for-me state. Regular
   realtime updates continue to reconcile existing rows.
3. Notification document reads use the direct REST path too. They still update
   incomplete local image/voice rows when the upload finishes.
4. Read the clear-chat watermark, queue the saved-message read first, then
   start network work without awaiting that read. Keep maintenance behind the
   initial read, and tear down listeners on navigation or local read failure.
5. Commit a live window in **20-message** chunks, newest first on the initial
   snapshot. Notify only after each commit and yield between chunks so the
   list can display early. Keep ordered delivery, bounded write retries and
   full-window recovery after failed applies.
6. Do not let a slow members fetch hold the next foreground read. Check account
   and database identity before applying delayed foreground/member responses.

This costs up to 25 foreground query document reads per open/retry in addition
to the live window (empty queries can still have a minimum charge). It replaces
the open-time ascending catch-up, rather than adding another history traversal.
No recurring REST polling or per-chat permanent listener is added.

## Verification

- Mobile tests cover actual SQLite persistence, newest-first bootstrap with a
  1000-message backlog, preserved gap cursors, stale bootstrap vs live edits and
  deletions, early chunk publication, request deduplication, retry after error,
  stalled background reads, logout/account changes and same-user DB reopening.
- A transport test imports the **actual installed React Native Lite entry**,
  intercepts HTTP locally, and verifies authenticated `runQuery` / `batchGet`,
  the 25-document bound, timestamp/media mapping and permission-error handling.
  This is not a production-network benchmark or an emulator security-rules test.
- Existing notification/recovery, schema upgrade and message UI tests continue
  to run. TypeScript checks the application and the new tests.
- Android/iOS Metro + Hermes export checks the bundled JS. GitHub CI separately
  builds the Android test app. Neither constitutes a physical-phone latency test.

Version stays **2.4.1 (18)**. This client-only change requires a new app binary;
no Firebase functions/rules deployment is required for this change. Earlier
server-side retention work has its own deployment requirements.

## Device measurement

Build with `EXPO_PUBLIC_PERF_LOG=1` to include existing diagnostic logs, and
force the JS bundle task to run when changing environment values. Logs contain
timings/counts, not message text, phone numbers or auth tokens.

| Marker | Meaning |
| --- | --- |
| `sync:recent:network` | Direct recent request, including obtaining credentials |
| `sync:recent:commit` | Local queue wait plus committing the recent result |
| `sync:target:network` | Direct notification-document request |
| `sync:live:first-server` | Listener attach to first server snapshot, before local writes |
| `sync:local:read` | Local queue wait plus reading the visible message window |
| `conversation_first_viewable` | Open to first actually viewable saved/new row |
| `push_to_viewable` | Notification tap to that target actually becoming viewable |

The first-row span can end on a saved message. It must **not** be reported as
the latency of a newly received message. For new-message measurement, use an
exact notification target or record opening-to-arrival on screen together with
the network/commit markers. The six-second report remains the baseline until
the user measures the new APK on the same device/network.

PowerShell build from the user's checkout (one line):

```powershell
Set-Location "D:\sms-production" -ErrorAction Stop; git pull --ff-only origin main; if ($LASTEXITCODE -eq 0) { Set-Location ".\apps\mobile\android" -ErrorAction Stop; $env:EXPO_PUBLIC_PERF_LOG='1'; .\gradlew.bat assembleRelease --rerun-tasks; if ($LASTEXITCODE -eq 0) { Copy-Item ".\app\build\outputs\apk\release\app-release.apk" "D:\sms-production\OfflineSMS-2.4.1-18-fast-open.apk" -Force } }
```

With one connected Android device and `adb` on PATH, start this before opening
the conversation, repeat several opens and notification taps, then Ctrl+C:

```powershell
adb logcat -v time ReactNativeJS:V '*:S' | Select-String '\[perf\]' | Tee-Object -FilePath "D:\sms-production\message-load-timing.txt"
```

Disable `EXPO_PUBLIC_PERF_LOG` for the normal store build. The performance flag
does not disable authentication, change the backend or enable test faults.

## Primary references

- https://firebase.google.com/docs/firestore/solutions/firestore-lite
- https://firebase.google.com/docs/firestore/real-time_queries_at_scale
- Installed `@firebase/firestore` native full and Lite entry files (version
  10.14.1 in this checkout) were inspected for the actual request paths.
