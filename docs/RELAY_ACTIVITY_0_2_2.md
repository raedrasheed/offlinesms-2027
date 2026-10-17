# OfflineSMS Business — readable activity (0.2.2 / 4)

The supplied screenshot is the **Business relay** dashboard (`apps/mobile-relay`),
not the consumer chat app. Its activity area previously joined raw event/detail
strings in a small terminal without timestamps and refreshed only on resume.

## Changes

- Recycled cards show a plain-language event, local date/time including seconds,
  explanation, attempt where available and a short message reference.
- Full references and known diagnostic codes are in a selectable details dialog.
  Arbitrary exception text and message bodies are not surfaced. Phone suffixes
  remain masked. Existing database records need no migration.
- All activity / Needs attention filters include old `failed` events logged at
  `info` level. Unknown events get a neutral explanation and keep their code.
- The latest 100 events update through Room Flow while the activity is started.
  Equal timestamps are ordered by row ID. The list preserves the visible event
  as new entries arrive, and recycles rows instead of rendering all records.
- The header scrolls with the list, so large fonts and the battery warning cannot
  squeeze the activity area to zero height. Text uses scalable sizes and day/night
  colors; labels communicate status without relying on color alone.
- English and Arabic resources follow the phone language, including RTL layout.
  Report callbacks now retain a safe reason code and Android result code, which
  were previously omitted from the log. No SMS body or full phone is added.

## Meanings

| Event | User-facing meaning |
| --- | --- |
| `send` | Handed to the SIM; awaiting the send result. |
| `sent` | Android confirmed sending; receipt by the recipient is not yet confirmed. |
| `delivered` | Delivery report received; this is not a read receipt. |
| `claim n=…` | A processing cycle completed; the count is not a delivery total. |
| `report retry later` | Status reports await sync; retrying these does not resend SMS. |
| `report dropped` | The server refused a report permanently; the SMS may already have been sent. |
| ambiguous send/handoff | Sending may have happened; local resend remains blocked to avoid duplicates. |
| old failure without reason | Generic sending problem; do not invent a specific cause. |

No send/authorization/retry/receipt policy, Firebase function, permission or Room
schema changes are required. This does not change consumer version 2.4.9.

## Verification

`RelayActivityTest` covers EN/AR meanings, legacy records, masked phone numbers,
uncertain sends, report sync, filtering/recycled rows and live Room invalidation.
Native Robolectric rendering produces actual Android row previews in English,
Arabic and Arabic dark mode with 1.6× fonts. CI builds the Business APK, runs its
existing send-pipeline integration tests and checks backend/signing configuration.
These are not physical-phone or real-carrier tests; no SMS is sent by the tests.

## Windows build

Use the existing consumer Gradle wrapper to build the separate Business project.
Keep the existing Business `google-services.json` and release signing setup.

```powershell
& {
    $ErrorActionPreference = "Stop"
    Set-Location D:\sms-production
    git switch main
    if ($LASTEXITCODE -ne 0) { throw "Switch failed" }
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw "Pull failed" }
    .\apps\mobile\android\gradlew.bat -p .\apps\mobile-relay :app:assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
}
```

APK: `D:\sms-production\apps\mobile-relay\app\build\outputs\apk\release\app-release.apk`.
Install over the existing Business app with its same signing key to retain enrollment
and records. This UI update needs no Functions deployment.

## Android references

- [SmsManager send and delivery callbacks](https://developer.android.com/reference/android/telephony/SmsManager)
- [Room observable queries](https://developer.android.com/training/data-storage/room/async-queries)
- [Lifecycle-aware coroutine collection](https://developer.android.com/topic/libraries/architecture/coroutines#restart)
