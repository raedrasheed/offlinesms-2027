# Location preview and consistent message checks — 2.4.7 (24)

The user's Android screenshot confirmed that the 2.4.6 raster-map fallback was
also appearing on the phone. The standard OSM tile endpoint had already denied
the development environment. A loading placeholder does not solve that problem.

## Location fix

Location messages now use [OpenFreeMap](https://openfreemap.org/) vector data,
obtained through the provider's published TileJSON source. This is an independent
hosting service using OpenStreetMap data, with app/commercial use permitted and
no API key required. There are no requests to the previous blocked raster host.

The small, static preview draws real water/land, buildings, roads and available
place/street labels using the existing React Native SVG dependency. It uses the
OpenMapTiles schema and maintained `@mapbox/vector-tile` / `pbf` readers, not
invented map imagery. Vector source zoom 14 is displayed at zoom 16; longitude
wrapping and exact shared-coordinate positioning are preserved. Geometry is
clipped before reaching the native SVG bridge, and labels are bounded/deduped.
All three provider/data credits remain visible with their own links.

Only a visible location card starts loading. Requests are coalesced, limited to
three tile downloads and have a 15-second network timeout. Cached source versions
and tiles are reused immediately offline; expired source discovery refreshes in
the background. Versioned tile filenames prevent mixing data releases. Invalid
responses are rejected, files live in the OS-purgeable cache directory, and a
Retry map button allows recovery without leaving the conversation. Tapping the
card still opens the shared coordinate in Maps. No live device-location access
is requested merely to display a received location.

The preview is a simplified street map, not navigation guidance or a copy of
Google Maps styling. As with any external provider, availability is not guaranteed;
the unavailable state remains for genuine outages/offline cache misses.

## Shared checkmarks

`CheckmarkIcon`, `MessageStatusIcon` and `MessageReceipt` replace font-rendered
check characters and per-attachment color variants. Text, images, video, audio,
voice messages, contact/location/file cards, polls and stickers share the same
15px Ionicons checks used by the file card:

| State | Glyph | Color |
| --- | --- | --- |
| Sent | One check | #8A9C92 |
| Delivered | Two checks | #8A9C92 |
| Read | Two checks | #34B7F1 |

Group counts remain visible. Message info uses the same status icons. Selection
checks in forwarding, the device-contact picker and SMS confirmation use the
same glyph family while retaining the selection control's white color.

## Validation and rollout

- Mobile TypeScript; English/Arabic parity (684 keys).
- 1,197 unit tests across 116 suites, covering state transitions, map clipping,
  source URL validation, offscreen suppression, request coalescing, offline
  cache reuse after restart, timeouts/retry and component retry behavior.
- Successful Android Hermes export with the new JS dependencies.
- Updated the baseline build overlay with the same pinned map dependencies,
  preserving the existing dependency-parity guard and original baseline UI.
- A live OpenFreeMap tile for a Gaza coordinate returned HTTP 200 and decoded
  successfully. The actual preview component rendered its real streets and
  Arabic labels at 424px and 320px in RN Web. The native filesystem path is
  covered with host mocks; an Android device visual/network test remains needed.

No native SDK, Firebase function, Firestore index or security-rule change is
introduced. Rebuild and install the APK; no additional Firebase deployment is
required for this release. The earlier 2.4.5 search backend rollout still applies
if it has not been completed.

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
Expo and checked-in Android version: **2.4.7 (24)**.

Primary references: [OpenFreeMap quick start](https://openfreemap.org/quick_start/),
[OpenMapTiles schema](https://openmaptiles.org/docs/schema/),
[vector-tile reader](https://github.com/mapbox/vector-tile-js).
