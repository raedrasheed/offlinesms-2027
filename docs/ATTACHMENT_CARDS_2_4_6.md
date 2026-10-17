# Contact, location and document cards — 2.4.6 (23)

The three attachment cards follow the supplied conversation screenshots:

- Account contact: light-green sent card, circular live account photo (initials
  if unavailable), name, time/receipt row, divider and full-width Message action.
  Opening the card still starts a conversation with that OfflineSMS account UID.
- Location: rounded 16:9 map preview, red coordinate pin, slim green rim and
  time/receipts over a bottom gradient. Tapping opens the exact shared coordinate.
- Document: colored file-type badge, two-line filename, extension and readable
  size, download/open/retry action, and a separate time/receipt strip. Large files
  are still fetched only after an explicit tap; transfer progress remains visible.

Contact/document cards cap at 336 logical pixels; locations at 274. Widths shrink
on narrow screens. Sent cards use #D9FDD3, read checks #34B7F1. Receipt count
changes now invalidate the message memo, and queued contact/location cards keep
their layout with a queue, sending or retry indicator. Photos use the existing
batched public-profile cache and update when the profile changes.

## Map provider and failure behavior

The preview uses OpenStreetMap raster tiles, **not Google Maps imagery**. Its
street rendering therefore differs from the reference. No new native dependency,
Google Maps key or Firebase function is needed. Attribution remains visible and
links to OpenStreetMap copyright information.

Only visible location cards in the focused conversation request viewport tiles.
Native requests identify OfflineSMS, share concurrent requests and limit network
concurrency to three. The on-device cache honors expiry/validators, uses seven
days when expiry headers are absent, revalidates expired images conditionally,
and can reuse previously cached images after a network error. There is no area
download or background prefetch feature. See the provider's
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

Unavailable tiles, unsupported polar coordinates or a loading timeout display
an explicit unavailable-preview message; tapping still opens the location.
The native cache rejects HTML and HTTP error responses, including access-denied
PNG responses marked by the provider's `X-Blocked` header even if HTTP is 200.

The test environment's live tile request was denied by the provider. Successful
live map rendering on an Android device is therefore **not yet verified**.
Component tests verify tile positioning, the pin/preview structure, exact-link
opening and failure handling. No substitute or invented map is shown on failure.

## Build and rollout

This is a mobile UI release: **no additional Functions or rules deployment** is
required for these layouts. The account contact/search backend introduced in
[2.4.5](ACCOUNT_CONTACT_SEARCH_2_4_5.md) still needs its deployment and backfill
if those have not already succeeded in production.

After the change is merged, run in Windows PowerShell:

```powershell
cd D:\sms-production
git switch main
if ($LASTEXITCODE -ne 0) { throw "Switch failed" }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "Pull failed" }
cd apps\mobile
npm ci
if ($LASTEXITCODE -ne 0) { throw "Install failed" }
cd android
.\gradlew.bat assembleRelease
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
```

APK: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
Expo and checked-in Android version: **2.4.6 (23)**.

## Verification

Mobile TypeScript and English/Arabic key parity pass. Tests cover live avatar
fallback/update, visible-only map loading, coordinate changes, exact-coordinate
opening, separate attribution action, download/upload/retry/open states,
dateline/polar math, request coalescing, cache revalidation and rejected responses.
RN Web previews at 424px and 320px were inspected for contact/document wrapping
and the unavailable-map state. These previews use test profiles/icons; they are
not an Android device test. On-device checks still include native fonts/RTL,
actual profile photos, map availability and opening/downloading real documents.
