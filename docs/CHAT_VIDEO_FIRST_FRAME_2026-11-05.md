# Chat video first-frame previews — 2026-11-05

Video messages already supported a thumbnail URL and native play/pause/seeking after opening the player, but the upload pipeline never generated their thumbnail. The conversation therefore showed an empty preview.

The new `onChatVideoThumbnailWrite` trigger extracts the first actual video frame after an uploaded video becomes ready, including newly forwarded messages. It writes a bounded JPEG in that message's existing Storage prefix and publishes the existing thumbnail fields. Sending/finalizing a video does not wait for extraction. The FFmpeg and ffprobe binaries are already installed by the functions package; no mobile dependency, Storage permission expansion, or database migration is added.

Visible older videos without a thumbnail call `ensureChatVideoThumbnail` to request generation. The callable checks the current viewer's account, conversation membership, active group membership, and direct-chat blocks. Requests coalesce and are capped at two active calls on mobile; foreground, online, and viewport gates prevent requests from hidden cells. A temporary message listener receives old-history previews without polling. Thumbnail-only SQLite hydration preserves existing edits, deletion state, original-media identity, and newer thumbnails.

Processing is restricted to canonical message-owned source paths, generation-pinned objects, verified size/MIME/signature, MP4/MOV/WebM containers, finite dimensions, a bounded runtime, and local-file protocols. Leases and attempt limits fence duplicate work. Deletion/retention races cannot publish a thumbnail to a removed message; unique late outputs are removed.

## Deployment

After updating the local checkout to the merged commit, run in PowerShell from the repository root:

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase deploy --project offlinesms-prod-2027 --only "functions:onChatVideoThumbnailWrite,functions:ensureChatVideoThumbnail"
```

New uploaded video messages receive server-generated previews. Install the updated mobile build for lazy generation of older videos and thumbnail-only local persistence. The original video remains playable while its preview is being generated. No Firebase rules deployment is needed for this feature.

## Verification

1. Send a video whose first frame visibly differs from a later scene in a direct chat and a group. Confirm both participants receive the first-frame preview after processing.
2. Open the video and use its native pause/resume and seek controls.
3. Scroll to an older video with a missing preview. Confirm the preview arrives without opening or downloading the original video on the device.
4. Leave the screen, background the app, or go offline while requests are pending. Hidden cells must stop their listeners and queued work.
5. Delete a message while its preview is processing. It must stay deleted and receive no late thumbnail.

Automated coverage includes actual first-frame JPEG bytes and container handling, bounded decoding, account/membership/block checks, idempotent and concurrent requests, retry limits, deletion/retention races, viewport/account lifecycles, and SQLite hydration preservation. Final playback and visual rendering still need physical-device verification.
