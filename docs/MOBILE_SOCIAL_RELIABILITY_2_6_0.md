# Mobile reliability and social features — 2.6.0 (34)

This release fixes chat lifecycle, notification cleanup, story playback and interactions,
sticker saving, theme contrast and group-invite recovery. It also adds text/photo posts
and a private social activity inbox beside the existing Clips feature.

## User-visible changes

- Opening a person's profile or an empty direct conversation does not add an empty row
  to either inbox. Concurrent opens and retried sends share the same conversation/message.
- **Delete chat from this device** hides its row and clears local history through the
  deletion boundary. New messages make it visible again. **Clear history** remains a
  separate action. This is local deletion, not deletion from the other person's account.
- Opening/reading a conversation dismisses its read phone notifications. Other chats and
  later arrivals remain. Cold-start notification taps are consumed once; cached history
  remains available. Browsing older messages is preserved across background/resume.
- Holding a story pauses it. The next image waits for its own load instead of showing
  the previous story. Stories show author avatars, mentions, likes, private replies and
  owner-only paginated viewers. Inbox/header story rings open the author's current stories.
- Received custom stickers can be saved to **My stickers** and appear in the picker.
- Light/dark themes use paired pinned-message and navigation colors. Group invite links
  explain a missing username, preserve the invite through profile completion, and resume.
- **Posts** supports text or a photo, audience selection, likes, comments, reporting and
  deletion. Failed publishing keeps the editor content. The bell opens activity for
  stories, clips, follows and posts; access is rechecked before returning activity.
- Dashboard **Posts** lists pending/published/rejected/removed posts and reports. Moderation
  checks administrator claims and versions and records decisions in the audit log.

Posts use the existing Clips enable/review/terms settings at
`https://dash.offlinesms.com/admin/clips/settings`. Post moderation is at
`https://dash.offlinesms.com/admin/posts`. Disabling publishing does not disable moderation.
Photo posts are sanitized on the server and returned through short-lived signed URLs;
raw `postMedia` and post/activity documents are not directly accessible to clients.

## Deployment order

Firebase deployment and signed Android production builds are performed from the owner's
configured checkout. Keep its `.firebaserc`, `apps/mobile/eas.json`, signing configuration
and Android app-link certificate configuration. No signing keys are added to the repository.

1. Pull the merged release with `git pull --ff-only origin main`. No dependency or lockfile
   changes are required by this release. Run `npm --workspace functions run build`.
2. Deploy Firestore/Storage rules and indexes:

   ```powershell
   firebase deploy --project offlinesms-prod-2027 --only "firestore:rules,firestore:indexes,storage"
   ```

   Wait until the new posts/report indexes are ready before exercising feeds/moderation.
   Status creation and view tracking now go through their existing server callables;
   direct client status/view writes are denied.
3. Deploy the affected functions in the batches below. Set
   `$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"` in that PowerShell session. Each row is the
   exact `--only` argument for
   `firebase deploy --project offlinesms-prod-2027 --only "<argument>"`.

   | Batch | `--only` argument |
   |---|---|
   | Chats and invites | `functions:getOrCreateDirectConversation,functions:sendTextMessage,functions:sendPollMessage,functions:joinGroupByInviteLink` |
   | Stories | `functions:createStatus,functions:getStatusFeed,functions:markStatusViewed,functions:getStatus,functions:setStatusLike,functions:listStatusViewers,functions:replyToStatus` |
   | Posts/activity 1 | `functions:listSocialActivity,functions:markSocialActivityRead,functions:createPost,functions:getPost,functions:listPosts,functions:deletePost` |
   | Posts/activity 2 | `functions:setPostLike,functions:listPostComments,functions:addPostComment,functions:deletePostComment,functions:reportPost,functions:onPostRemoved` |
   | Existing social interactions | `functions:setClipInteraction,functions:addClipComment,functions:setClipCommentLike,functions:followClipCreator,functions:respondClipFollowRequest,functions:removeClipFollower` |
   | Account cleanup | `functions:onClipAccountErasure,functions:retryClipAccountErasure,functions:onClipUserDeleted,functions:onClipAuthUserDeleted` |

   New `onPostRemoved` retries cleanup after failures. Its handler only removes the owned
   post image and is safe to repeat. Keep existing function environment/secrets unchanged.
   All exports remain covered by `scripts/release/function-groups.json`; `social` contains
   the twelve new post/activity exports. Four additional exports extend stories.
4. Confirm the dashboard deployment for the merged commit is healthy on DigitalOcean.
   Review settings at **Clips → Settings**, then review a pending post at **Posts**.
5. Build/install Android **2.6.0 / versionCode 34** with the same production signing key.
   A Firebase deployment alone cannot update the mobile interface.

   ```powershell
   Set-Location D:\sms-production\apps\mobile\android
   $env:NODE_ENV = "production"
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   $env:Path = "$env:JAVA_HOME\bin;$env:Path"
   .\gradlew.bat :app:assembleRelease :app:bundleRelease
   ```

   APK: `app/build/outputs/apk/release/app-release.apk`.
   Play bundle: `app/build/outputs/bundle/release/app-release.aab`.

## Validation and device acceptance

Automated coverage includes chat deletion/re-entry and concurrent sends, notification
selection and foreground visibility, story hold/load/expiry/access transitions, viewer and
interaction permissions, stickers, invite recovery, photo decoding and upload races,
moderation/claims/audit, private media rules, and account-erasure cleanup. The pull request
records the final suite totals and CI results. Unit tests do not substitute for phone/OEM
notification-tray, audio routing or touch-gesture verification.

Before the Play rollout, use two accounts on the signed app:

1. Open a new direct chat without sending; neither inbox gains a row. Send, delete locally,
   restart, and send a new message from the other account; only the new traffic restores it.
2. Receive messages from two chats. Open one notification cold and warm; the correct message
   opens and that chat's read notifications disappear without clearing the other chat.
3. Hold image/video stories; move between distinct images on a slow connection. Check avatar,
   ring, like, mention, reply and owner viewer list. Verify expired/blocked content is hidden.
4. Save a received sticker, reopen the picker and send it. Confirm image/sticker taps and
   long-press message actions still work.
5. Check a pinned message and navigation in both themes. Join a group link without a
   username, complete the profile, and confirm the same invite resumes.
6. Publish text/photo posts, retry a failed request, approve a pending post, like/comment,
   inspect the bell, remove a post, and verify it no longer opens for another account.

## Existing limits

This release does not migrate the historical story contact-audience model or revoke
previously issued story media download URLs. Story display rechecks current access, blocks
and expiry; new post media uses short-lived leases. Existing stories retain their prior
audience semantics. Phone notification behavior still requires the device checks above.
