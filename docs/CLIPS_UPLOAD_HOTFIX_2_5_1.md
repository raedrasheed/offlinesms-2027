# Clips upload hotfix — 2.5.1 / build 32

## Production evidence

On 2026-11-03 the Android composer displayed a generic upload confirmation failure. Production logs showed successful `acceptClipsTerms` and `initClipUpload` calls, with no `publishClip` request in the inspected window. A listing of `clipUploads/*/*/source` returned no objects. This establishes that no completed source object was visible at inspection time; it does not establish the precise native exception or exclude partially transmitted bytes.

The uploader used `fetch(file://).blob()` and Firebase JavaScript `uploadBytesResumable`. Firebase's supported-environments table explicitly excludes Storage uploads on React Native. The existing chat uploader had already moved native file transfer to Expo FileSystem for the same runtime boundary.

## Change

- Upload source bytes using Expo FileSystem's native binary upload task and Firebase's resumable protocol. Only a bounded 1 MiB file range is read into JavaScript at a time.
- After an interrupted request, query the server's acknowledged offset before sending more data. Pause, resume, cancellation, manual pause across network recovery, and account changes remain supported.
- Keep upload session URLs in memory. Retry a killed process from its durable draft and the existing idempotent reservation; do not claim cross-process byte resumption.
- Publish only after the source upload is finalized. Retrying a lost publication response recognizes an already-processing server reservation without creating another clip.
- Preserve only allowlisted diagnostic codes. Show actionable Arabic/English messages for permission, authentication, file, quota, terms, connection, and publication-confirmation failures; never expose bearer tokens or resumable session URLs.
- Bump Expo and native Android version to 2.5.1 / 32. No dependency, backend, rules, indexes, bucket permissions, or signing-key changes are required.

## Release verification

Local validation passed on 2026-11-03: 127 clip tests across 15 files (including 20 native-transport scenarios), mobile TypeScript, four native-protocol Storage rules tests, and `git diff --check`. Existing CI remains required. Node mocks and emulator results do not establish real Android/iOS native transport behavior; the Storage emulator does not enforce resumable offsets or chunk granularity.

Build and install a production-configured APK signed with the certificate compatible with the currently installed application. Test the saved draft on a real device, including a small upload, manual pause/resume, a network interruption, cancellation, processing, review, and playback. Confirm `publishClip` succeeds and the clip reaches `pending_review` or `published` before store rollout. If certificates differ, use the matching Play-signed release/testing route; do not uninstall to discard local drafts.

Only the mobile app needs rebuilding for this hotfix. Preserve local `.firebaserc`, `eas.json`, app-link certificate configuration, and signing files. Do not redeploy unrelated deferred SMS, invitation or phone-auth functions as part of this fix.

## Sources

- [Firebase JavaScript SDK supported environments](https://firebase.google.com/docs/web/environments-js-sdk)
- [Firebase 10.14.1 resumable request implementation](https://github.com/firebase/firebase-js-sdk/blob/firebase%4010.14.1/packages/storage/src/implementation/requests.ts)
- [Expo SDK 53 FileSystem implementation](https://github.com/expo/expo/blob/sdk-53/packages/expo-file-system/src/FileSystem.ts)
- [Android app signing and update certificates](https://developer.android.com/studio/publish/app-signing)
