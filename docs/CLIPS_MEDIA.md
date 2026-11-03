# Clips media runtime and operations

Clips are disabled by default; moderation is required by default. The mobile client saves a video copy in the signed-in account's document directory, uploads it with Firebase's resumable uploader, then requests server processing. Pausing, resuming and temporary network recovery work within the running app. After an app process is killed, the saved draft restarts the byte upload against the same server reservation. It does not claim to preserve a resumable upload session across process restarts.

## Processing and limits

The default policy permits 80 MiB per source upload, ten new clip reservations per account per UTC day and a selected duration of at most 60 seconds. Source video may be at most ten minutes so the editor can select a shorter segment. Server probing checks the actual container, duration, dimensions and streams; client-declared duration is never trusted. Allowed source containers are MP4/MOV/WebM. A source is frozen by object generation at publish time.

Processing trims the selected range, burns the optional text overlay, optionally removes audio, outputs H.264/AAC MP4 at bounds of 720×1280 and 360×640, and extracts a JPEG cover from the requested source timestamp. Images preserve the video's aspect ratio. Files are neither upscaled nor exposed before processing succeeds. Frame timestamps supplied by the client are milliseconds in the original source timeline, including the cover timestamp.

Initialization is idempotent per account and draft ID. Daily quota and the reservation are written atomically. Initialization and publication each have a separate twelve-per-minute server rate limit. Publication checks current terms, feature state, account suspension/deletion, group membership and configured bounds again inside the final transaction. The renderer holds a ten-minute lease, has three automatic attempts, and is fenced by render version and lease token. Every final publication transaction rechecks current authorization and policy.

## Pinned executable bundle

`functions/scripts/installMediaTools.cjs` runs through the functions package's `postinstall` script. It downloads and verifies a pinned pair of FFmpeg and ffprobe executables and shared libraries:

| Item | Value |
| --- | --- |
| Upstream builder | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) |
| Release | [autobuild-2026-10-31-12-59](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-31-12-59) |
| Actual executable version | `n8.1.3-27-g8dca1586f4-20261031` |
| FFmpeg source | [8dca1586f4](https://github.com/FFmpeg/FFmpeg/tree/8dca1586f4) |
| Archive | `ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-shared-8.1.tar.xz` |
| Archive SHA-256 | `202fe67679a0860b155817a0907ffcc5c1ea82e186acaa21cb87d307f54fd59a` |
| Archive / installed size | 72,031,160 bytes / approximately 223 MiB |
| Runtime | Linux x64, glibc ≥2.28, kernel ≥4.18 |

The installer rejects download failures, checksum mismatches, unexpected versions and missing licenses. A cache is reused only after hashing every executable/shared-library entry against its installation manifest. No old system executable or npm-installed decoder is used as a fallback. The former `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` dependencies were removed: their actual binaries were substantially older than their package versions suggested.

The build and installed executables were checked with `readelf`; their maximum required GLIBC symbol version is 2.28. This is below Node 22 Cloud Functions' Ubuntu 22.04 baseline (glibc 2.35). Shared libraries are loaded from the verified bundle's `lib` directory. The archive's `LICENSE.txt` and build documentation remain installed. The separately bundled DejaVu font retains its license in `functions/assets/fonts/LICENSE.txt`.

The binary cache at `functions/.media-tools` is excluded from git and Firebase source upload. Cloud Build installs it during `npm install`/`npm ci`, using Node's fetch and the Linux `tar` executable with XZ support. GitHub release download access is required during the build, not at media-processing time. Do not use `--ignore-scripts` for a production functions build. Unsupported host architectures skip installation with a clear message; media processing and its integration tests require Linux x64. Type checking and non-media development remain available on other hosts.

The upstream builder retains month-end builds for two years; daily releases last only fourteen days. This release deliberately pins a month-end build. Refresh the pin, expected checksum and fixture tests as FFmpeg receives security updates, and before the retention window expires. For longer archival guarantees, mirror this exact verified archive into an organization-controlled immutable artifact repository and review any URL change together with its checksum.

## Storage and access

| Purpose | Object path |
| --- | --- |
| Original upload | `clipUploads/{ownerUid}/{clipId}/source` |
| Standard playback | `clipMedia/{ownerUid}/{clipId}/standard.mp4` |
| Data saver playback | `clipMedia/{ownerUid}/{clipId}/dataSaver.mp4` |
| Cover image | `clipMedia/{ownerUid}/{clipId}/cover.jpg` |

Client reads of all these paths are denied. Client writes are limited to the owner's live source reservation; processed objects are server-only. Clip documents store canonical paths, never permanent download URLs. Every playback, download and thumbnail request checks access before signing a URL valid for at most 120 seconds. The download request checks `allowDownload`; the owner and an active platform administrator can download their own/reviewed content. A signed URL is a bearer capability until expiry, and downloaded bytes cannot be revoked. Privacy changes apply to subsequent authorization checks immediately, with that maximum existing-URL window.

Firebase's upload SDK may attach a long-lived token to the owner's original bytes. Finalization and metadata-update triggers remove it, and publication requires a successful token-clear request. This removal is asynchronous, so an original-file token may briefly exist after its owner uploads it. The app never obtains, stores or shares that token. Processed files are cleared of tokens before publication. See [CLIPS_SECURITY.md](CLIPS_SECURITY.md) for the Storage emulator limitation: its token implementation only appends tokens and cannot faithfully test GCS's null-metadata deletion. A deployed smoke test must verify that an old original token stops working after the scrubber runs; no production operation was used for local tests.

## Cleanup and recovery

Original bytes are deleted after rendering, and `sourceSizeBytes`, `processedBytes` and `totalStorageBytes` track retained bytes. The hourly cleanup job retries stalled processing, completes missed source deletion, and removes expired uploads/failed jobs after 24 hours. Queries select outstanding work so completed or failed records cannot starve later cleanup.

Removal marks the clip unavailable before deleting its canonical source/output prefixes. Account erasure keeps the minimum `ownerUid` and clip ID needed by this process, removes identifying profile/caption fields, and writes `mediaPurgedAt` when deletion succeeds. A renderer that writes after a concurrent removal cleans those late objects in its `finally` block; event retries also purge removed tombstones if a prior cleanup lost connectivity. Deletion failures reset the purge marker for the removal trigger and scheduled recovery.

## Local validation

Run from the repository root on Linux x64:

```sh
npm install
npm --workspace functions run typecheck
npx vitest run functions/__tests__/clipMediaTools.test.ts apps/mobile/__tests__/clipUploads.test.ts
npm run test:integration
```

The media fixture tests generate synthetic video and audio with the pinned executable. They exercise actual probing, invalid/forged input, trim bounds, Arabic text, mute/audio preservation, both MP4 sizes and JPEG output. Emulator tests cover quota/idempotence, live suspension/feature/group revocation during rendering, signed-URL authorization/TTL/download permission, token-clear requests, late removal cleanup, source deletion, resumed draft leases and publication rate limits. Mobile utility tests cover durable copying, account isolation, pause/resume, network recovery, cancellation and retry without duplicate publication. Real devices, IAM signing and deployed Storage token revocation remain deployment smoke checks.
