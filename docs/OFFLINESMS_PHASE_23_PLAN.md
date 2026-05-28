# OfflineSMS — Phase 23 Plan: Media Messages (Images & Voice Notes)

Status: in progress
Base branch: `claude/gracious-heisenberg-so2eH`
Scope: **images and voice messages only**. No video, no documents/files,
no payments/SMS/points changes, no dashboard media moderation, no Phase 22C,
no enabling local-first flags by default.

---

## 1. Objective

Implement two media-message journeys exactly per the supplied designs:

1. **Send an image** — Chat → Attach → Photos → Preview+caption → Uploading →
   Sent → Read.
2. **Voice message** — Idle composer → hold mic to record → swipe up to lock →
   send → played.

Media binary lives in Firebase Storage; Firestore holds **metadata only**.
Sending is optimistic and offline-tolerant via the existing local-first outbox.

---

## 2. Current chat / composer inventory

- `apps/mobile/src/screens/Conversation.tsx` — composer renders a single action
  button that shows `arrow-up` when there's draft text and `mic` when empty
  (the `mic` glyph currently has **no handler**). There is **no attach button**
  yet. Messages render through `MessageBubble`.
- `apps/mobile/src/components/MessageBubble.tsx` — renders text bubbles, reply
  preview, reactions, receipts, long-press `ChatActionSheet`. Type is currently
  `'text'` only.
- `apps/mobile/src/components/ChatActionSheet.tsx`, `ReactionsSheet.tsx` —
  long-press actions and reaction breakdown.
- Receipts: `ReceiptIndicator`, `MessageInfo` screen, `markReceipt`/`markRead`
  callables; aggregate counts (`deliveredCount`/`readCount`/`viewedCount`/
  `playedCount`) already exist on the message model — **`playedCount` is already
  modelled**, so voice "played" receipts are supported by the existing schema.

## 3. Existing message data model

`apps/mobile/src/lib/conversations.ts` `Message`:
- `type: 'text'` (to be widened to `'text' | 'image' | 'voice'`).
- `text?`, `status?`, `replyTo?`, `forwarded?`, `reactions?`, receipt counts,
  `senderDisplayName?`/`senderPhotoURL?` (group snapshots), `createdAt`.

Firestore message doc (written by `functions/src/chats/sendTextMessage.ts`):
`conversationId, senderUid, senderId, type, text, status, deletedForEveryone,
editedAt, replyTo, forwarded, forwardedFrom, reactions, pinnedAt, pinnedBy,
expiresAt, createdAt, updatedAt, clientLocalId, idempotencyKey`, plus group
sender snapshots. Idempotency is by `clientLocalId` (single-field lookup).

Local DB (`apps/mobile/src/localdb`): `messages` table + outbox. `OutboxType`
union in `types.ts`; `firebasePush.ts` maps each outbox type to a callable.
`queueSendMessage` writes an optimistic local row + an outbox item.

## 4. Existing send callable inventory

`functions/src/chats/`: `sendTextMessage` (membership/lock/admin-only checks +
idempotency + audit), `editMessage`, `deleteMessage`, `reactToMessage`,
`forwardMessages`, `markReceipt`, `markRead`, `getMessageInfo`,
`onMessageCreate` (trigger: builds conversation `lastMessage`/preview +
recipient unread fan-out + receipt baseline). `onMessageCreate.buildPreview`
currently handles only `type==='text'`.

## 5. Firebase Storage / media upload strategy

- Reuse **Firebase Storage** (already used for avatars/status/conversation
  media). Existing rule: `conversations/{convoId}/{senderId}/{file}` —
  authed + `request.auth.uid == senderId` + size < 30 MB.
- **New, tighter media path** to match the spec and bind objects to a message:
  `chatMedia/{conversationId}/{messageId}/image-original.jpg`,
  `…/image-thumb.jpg`, `…/voice.m4a`.
- Upload uses the Firebase Web SDK (`firebase/storage`) `uploadBytesResumable`
  to surface progress (% → the inline "Uploading 62%" UI). The client reads the
  local file via `expo-file-system`/`fetch(localUri).blob()`.
- Flow (optimistic, idempotent):
  1. Client writes a **local pending** media message (status `pending`,
     `uploadStatus: pending`) and enqueues a media outbox item; bubble shows
     immediately with progress 0%.
  2. Outbox worker calls **`createMediaMessage`** → server creates the Firestore
     message doc (`uploadStatus: pending`) and returns `{ messageId,
     storagePath, thumbnailPath? }`. Idempotent by `clientLocalId`.
  3. Client uploads binary to the returned `storagePath` (and thumb for images)
     with progress.
  4. Client calls **`finalizeMediaMessage`** → sets `uploadStatus: uploaded`,
     stores final metadata + (optional) downloadURL, updates conversation
     preview. Idempotent.
  5. Local row reconciled to remote id; bubble flips to sent/delivered/read.

## 6. Image message UX flow (per design)

1. **Composer** — add an attach (paperclip/＋) button left of the input.
2. **Attachment sheet** (`AttachmentSheet`) — bottom sheet, 8 tiles: **Photos**
   and **Camera** enabled; File/Location/Contact/Poll/Audio/GIF rendered as
   **"coming soon"** disabled tiles (visual parity with the design).
3. **Photo picker** — `expo-image-picker` (library) / `expo-camera`-backed
   capture. Single image first; **multi-select deferred** (documented).
   Permission denial → friendly `PermissionState`.
4. **Preview + caption** (`ImagePreviewScreen`) — dark screen, image preview,
   caption input ("Add a caption…"), send (paper-plane), back/cancel. Crop/edit
   button only if `expo-image-manipulator` is added; otherwise omitted/deferred.
5. **Sending** — optimistic `ImageMessageBubble` with `MediaUploadProgress`
   ("Uploading 62%"); on success shows image + caption + ticks; on failure shows
   retry/delete.
6. **Read** — existing receipts; full-screen viewer on tap (`ImageViewerScreen`,
   or deferred + documented). Long-press → existing actions.

## 7. Voice message UX flow (per design)

1. **Idle** — mic button when input empty (replaces the current no-op mic).
2. **Hold to record** — press-and-hold starts recording (`expo-av` Audio.
   Recording); show `VoiceRecorderBar`: red dot, elapsed timer, live waveform
   (from metering), "Slide to cancel", lock affordance. Optional haptics.
3. **Slide left → cancel** — stop + delete temp file → idle.
4. **Swipe up → lock** (`LockedVoiceRecorderBar`) — hands-free: timer, waveform,
   trash, send. Trash deletes draft; send uploads.
5. **Sent** — `VoiceMessageBubble`: play/pause, waveform, duration, time, ticks.
   One voice plays at a time. On playback start/threshold → mark `played`
   receipt (schema supports `playedCount`).

Constraints: max 5 min, min 1 s, m4a/aac, ≤ 10 MB, no background recording.

## 8. Offline / outbox strategy

- Extend the **existing local-first outbox** (do not build a parallel queue):
  add `OutboxType` values `send_image_message`, `send_voice_message`.
- Outbox payload: `conversationId, localMessageId, localUri, thumbLocalUri?,
  mediaType, mimeType, sizeBytes, width?, height?, durationMs?, waveform?,
  caption?, replyTo?, idempotencyKey`.
- `firebasePush` handles the media types by running the 3-step
  create→upload→finalize sequence. Each step is idempotent and resumable:
  - create deduped by `clientLocalId`;
  - upload re-targets the same `storagePath`;
  - finalize is idempotent (safe to re-run).
- Retry on reconnect via the existing sync scheduler; never duplicate; never
  delete the local file until finalize succeeds.
- Offline pick/record → message shows pending; upload waits for reconnect.

## 9. Security & privacy strategy

- **No base64 media in Firestore** — metadata only; binary in Storage.
- **No captions / media URLs / audio in audit logs** — audit safe metadata only
  (`conversationId`, `type`, `sizeBytes`, `mimeType`, `durationMs`). Captions are
  message content → never logged.
- Storage rules restrict read/write to the **sender** (write) and authed
  conversation members (read); enforce **size** and **MIME allow-list**.
- Deleted-for-everyone hides media in UI; storage object cleanup deferred to a
  later sweep (documented).
- Local temp files cleaned after successful upload; on logout, warn about unsent
  media and wipe temp files after confirmation.
- Never expose full storage paths in the UI.

## 10. Firestore rules / Storage rules strategy

- **Storage**: add a `chatMedia/{conversationId}/{messageId}/{file}` match —
  write requires authed + membership (looked up via Firestore `get()` on the
  conversation), `request.resource.size < 10 * 1024 * 1024`, and a MIME
  allow-list (`image/jpeg|png|webp`, `audio/m4a|aac|mp4|x-m4a`). Read requires
  authed membership. Keep the legacy `conversations/...` match for back-compat.
- **Firestore**: messages are written by callables (admin SDK bypasses rules),
  so no message-rule loosening is required. No client direct-writes to media
  messages.

## 11. Tests

Pure (vitest, `tests/`): media `type`/MIME allow-list validation, size limits,
duration bounds + `formatDuration`, waveform normalization (≤ N bars), upload
state reducer, idempotency-key generation, attachment-option mapping.
Functions (if harness supports): `createMediaMessage` rejects non-member /
invalid MIME / oversize / returns existing on duplicate; `finalizeMediaMessage`
sender-only.

## 12. Rollback plan

- All new UI is additive and gated behind the attach button / mic handler; no
  existing text path is modified destructively.
- If media proves unstable, the attach button and mic-record handler can be
  feature-flagged off (`MEDIA_MESSAGES_ENABLED`, default decided at rollout)
  to restore the text-only composer without reverting data-model changes.
- Storage rules are additive; the new callables are independent of existing
  callables.

## 13. Acceptance criteria

Tracks the 28 criteria in the task brief: plan exists; attachment sheet; image
pick/preview/caption/upload-progress/bubble/viewer(or deferred)/retry; voice
hold-record/slide-cancel/swipe-lock/locked-send-delete/upload/bubble/playback/
waveform+duration; metadata in Firestore + binary outside; restricted storage;
i18n EN/AR parity; RTL/dark/accessibility; text + receipts unchanged; SMS/points
unchanged; no private logging; CI; phase log updated.

## 14. Deviations from brief (justified)

- **`expo-av` instead of `expo-audio`** — the app is Expo SDK 51; `expo-audio`
  is SDK 52+. `expo-av` is already a dependency and provides Audio.Recording /
  Audio.Sound with metering for the waveform.
- **Single image first**, multi-select deferred (brief permits this).
- **Crop/edit** only if `expo-image-manipulator` is added; otherwise deferred.
- Local-first flags are **left at their current branch default**; this phase
  does not flip any flag.
