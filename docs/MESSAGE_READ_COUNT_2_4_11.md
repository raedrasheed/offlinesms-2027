# Message Info reader count — 2.4.11 (28)

The Read card added `readCount + viewedCount + playedCount`, but the server's
`viewedCount` already includes `read` receipts. Seven text readers therefore
appeared as fourteen, while the Read filter correctly showed seven.

The card now uses `viewedCount + playedCount`. These are disjoint contributions
from each recipient's current receipt status, so `read`, `viewed` and `played`
each count once. This also fixes the OfflineSMS action's unread-recipient check.
Delivered, Pending, Failed, the recipient list and server counters are unchanged.
The fix works for both senders and participants who see aggregate counts only.

## Installation

Build and install consumer **2.4.11 (28)**. This fix needs **no Functions deploy,
Firestore rules update or data backfill**. Existing messages display the corrected
number when Message Info is reopened in the updated app. Any pending deployment
for the earlier poll release is separate; see [2.4.10](POLL_PRIVACY_2_4_10.md).

Windows PowerShell:

```powershell
& {
  $ErrorActionPreference = "Stop"
  Set-Location D:\sms-production
  git switch main
  if ($LASTEXITCODE -ne 0) { throw "Switch failed" }
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw "Pull failed" }
  Set-Location apps\mobile
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "Install failed" }
  Set-Location android
  .\gradlew.bat assembleRelease
  if ($LASTEXITCODE -ne 0) { throw "Build failed" }
}
```

APK: `D:\sms-production\apps\mobile\android\app\build\outputs\apk\release\app-release.apk`.

## Regression coverage

Mounted Message Info tests use the server's actual `receiptCounts` contract and
cover the reported 7 delivered / 7 read / 96 pending / 0 failed case, text reads,
media views/plays, mixed statuses, aggregate-only access, zero readers, and the
OfflineSMS action when delivered recipients have or have not all read.

On a device, open the reported message after installing the new APK. The Read
card should agree with the Read tab for the same receipt snapshot; additional
readers since the screenshot will naturally increase both. No physical-device
or production Firebase verification was performed during development.
