# Personal sticker editor — 2.4.8 (25)

## User flow

Open a conversation → Emoji → Stickers → **Create sticker**. Select a photo,
edit it, then **Save**. Saving adds it to **My stickers**; it does not send it.
Tap a saved sticker to send it. Long-press to preview, edit or delete it.

The editor supports:

- Dragging and pinch/button zoom, with contain or fill/crop framing.
- 90-degree rotation and horizontal/vertical flips.
- Square or circular image crop. Text remains readable outside the circular
  image boundary; the exported canvas is still square and transparent.
- Up to 80 characters of text, six colors, three positions, and text size.
- Undo, reset, a name, and confirmation before discarding edits.

This is a static-image editor for Android and iOS. It preserves transparent
imports and transparent space/circle corners. It does not perform automatic
subject/background removal or create animated stickers. The browser retains
the bundled sticker picker and explains where personal creation is available.

## Storage and editing

The personal library is **per account on this device**, not a cloud-synced
sticker pack. It survives ordinary app restarts, works offline, and is limited
to 100 stickers. Clearing app data or uninstalling removes the library.

The picker imports at most 30 MB / 40 megapixels and normalizes a copy to a
maximum 1024px edge. The source image, edit recipe, and 512×512 PNG output are
stored separately in the app document directory. Editing always uses the
original normalized source. The phone's original photo is not changed.

Per-account writes are serialized. Both revisioned files are copied before
publishing the manifest; a failed write retains the previous revision. Deletion
only removes library files. Sending makes an independent durable outbox copy,
so editing/deleting a library entry does not alter already queued/sent images.

## Delivery and compatibility

Personal stickers use the existing authenticated image upload/outbox/cache and
retention paths with `media.presentation: "sticker"`. Older clients can display
the PNG as an ordinary image. Updated clients render it without bubble chrome
and keep the unified message checks, progress and retry controls.

The presentation survives SQLite payload serialization, remote reconciliation,
history reads and forwarding. The server only accepts this presentation on a
512×512 PNG up to 2 MiB, and finalization checks the actual uploaded PNG header
dimensions as well as size, MIME and ownership. Normal chat membership,
blocking, group restrictions and Storage rules remain applicable. Forwarding
already copies the media metadata and binary, so it needs no code change.

Conversation previews and push notifications say “Sticker” / “ملصق”. Notification
delivery still waits for upload finalization. No Firestore migration, index,
Storage-rule update or backfill is required.

## Validation

- Mobile TypeScript and Functions build; EN/AR parity (722 keys).
- 1,227 unit tests in 122 suites, including recipe bounds, library rollback and
  account separation, non-destructive editing, editor lifecycle, explicit send,
  SQLite reconciliation and idempotent upload retry.
- Three emulator-backed tests exercise the real create/finalize/forward/delete
  handlers with valid PNG bytes, group restrictions and mismatched dimensions.
- Android Hermes export succeeds with Expo SDK 53's compatible pinned modules:
  `expo-image-manipulator` 13.1.7 and `react-native-view-shot` 4.0.3.
- The actual editor UI was previewed at 400px and 320px in Arabic using RN Web
  and browser adapters for native image/filesystem/capture APIs. A 512×512 RGBA
  export retained text and transparent corners. This does not substitute for
  native-device capture/gesture/keyboard testing on Android and iOS.
- The comparison-build overlay includes the same dependencies; its existing
  dependency and instrumentation parity guards pass on a fresh baseline checkout.

## Deploy backend first (Cloud Shell)

The previous location/checkmark release required no deployment. **This release
does require the five Functions below**, including the media-ready notification
trigger. Deploy from the merged main commit before testing the new client.

```bash
(
set -e
cd ~/offlinesms-production-release
git fetch origin main
git switch --detach FETCH_HEAD
nvm use 22
export GOOGLE_CLOUD_QUOTA_PROJECT=offlinesms-prod-2027
npm ci
npx firebase deploy --project offlinesms-prod-2027 --only "functions:createMediaMessage,functions:finalizeMediaMessage,functions:onMessageCreate,functions:onMessageCreateNotify,functions:onMessageMediaReadyNotify"
)
```

## Rebuild Android (PowerShell)

This release adds native modules; install a newly built APK. A JavaScript-only
OTA update to the previous native app is insufficient.

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
Expo and Android version: **2.4.8 (25)**. iOS also needs a new native build.

On two phones: create a sticker with Arabic text, send it, restart and resend
offline, reconnect, re-edit it, and confirm that earlier sent copies remain
unchanged. Check circular/transparent imports and keyboard scrolling. The
development environment did not deploy production Functions or test a physical
phone; those rollout checks remain with the project owner.

Primary API references: [Expo ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/),
[Expo captureRef](https://docs.expo.dev/versions/latest/sdk/captureRef/),
[react-native-view-shot](https://github.com/gre/react-native-view-shot).
The installed SDK 53 module catalog and package declarations determine the
pinned versions; the latest online documentation may show a newer Expo SDK.
