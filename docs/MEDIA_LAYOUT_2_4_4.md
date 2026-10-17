# Photo and video layout — 2.4.4 (21)

Photos and videos now share the same light-gray message card, rounded frame,
caption typography and time/receipt placement. Captionless messages overlay the
receipt pill; captions put the usual message footer below the text. Video no
longer appears as a filename/size document card.

The frame preserves the original width-to-height ratio for portrait, landscape,
square and panoramic media. Both axes scale together within the available chat
width (up to 230 points) and a viewport-aware height bound (up to 420 points).
The media uses `contain`, with no stretching or cropping. Missing legacy image
dimensions are learned when the image loads; video dimensions and rotation are
corrected when the decoder reports its natural size. Until dimensions are
available, both use a 4:3 fallback.

Video cards show a play button. If a thumbnail URL is present, it is used as the
poster; otherwise the card has a neutral placeholder. This release does not
generate or upload video thumbnails. Merely scrolling through messages does not
download videos or mount video decoders. A tap downloads/caches the video and
opens a full-screen viewer with native playback controls and Share or save.
Closing the viewer unmounts the decoder. Upload and download retry states and
long-press message actions remain available.

The attachment send preview also preserves the aspect ratio. Dimensions learned
from the local preview are passed to the existing send pipeline, including GIFs
without picker dimensions and rotated videos.

## Build and deployment

This change is mobile-only: no Functions deployment, rules change, new native
dependency or database migration is required. Install an updated APK to see it.
The account-contact feature from 2.4.3 still requires its three callables to have
been deployed; see [APP_CONTACTS_2_4_3.md](APP_CONTACTS_2_4_3.md).

```powershell
cd D:\sms-production
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "Git pull failed." }
cd apps\mobile
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
cd android
.\gradlew.bat assembleRelease
if ($LASTEXITCODE -ne 0) { throw "Android build failed." }
```

APK: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
Expo and checked-in Android versions: **2.4.4 (21)**.

## Verification

Native-host-mocked component tests exercise identical photo/video card styles,
portrait/landscape/square/panorama ratios, viewport resizing, captions and receipt
placement for sent/received messages, unknown dimensions, rotated videos,
explicit playback, repeated taps, download/upload retries, stale asynchronous
downloads, viewer cleanup, sharing and preview-to-send dimensions.

On a physical phone, check a portrait and landscape video/photo pair with and
without Arabic captions, scroll through older messages, open a downloaded video
offline, close playback with both the close button and Android Back, and verify
Share or save. Unit tests do not validate the native decoder or platform controls
on a real device.
