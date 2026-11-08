# Clips API contract (2.5.0)

All endpoints are authenticated callable functions in us-central1, except asynchronous processing. IDs below are strings. Times use epoch milliseconds. Collections are server-written; clients never receive permanent Storage download tokens. Media agent owns init/publish/playback. Global config is `systemSettings/clips`, default disabled and prepublication review required.

## Shared data

`ClipItem`: `{id, ownerUid, caption, hashtags:string[], audience:'public'|'followers'|'group'|'private', groupId:string|null, status:'uploading'|'processing'|'failed'|'pending_review'|'published'|'rejected'|'removed', allowComments, allowDownload, durationMs, width, height, createdAtMs, publishedAtMs, likeCount, commentCount, viewCount, shareCount, likedByMe, savedByMe, followStatus:'none'|'pending'|'accepted', author:{uid,displayName,username,photoURL,privateAccount}, thumbnailUrl?:string}`. Raw storage paths and original metadata never leave core serialization. Get playback separately; shared cards resolve getClip again rather than embed title/cover privately.

`ClipProfile`: `{uid,displayName,username,photoURL,bio,privateAccount,followerCount,followingCount,clipCount,likeCount,followStatus:'none'|'pending'|'accepted',isOwner,blocked}`.

`ClipsConfig`: `{enabled, moderationRequired, maxDurationSeconds, maxUploadMB, maxDailyUploads, termsVersion, supportEmail}`. Config defaults false/true/60/80/10/`clips-v1`/empty.

## Callables

- `getClipsConfig({})` → `{config,termsAccepted:boolean}`.
- `acceptClipsTerms({version,expectedUid?})` → `{ok:true}`.
- `getClipsFeed({mode:'forYou'|'following'|'saved'|'profile',ownerUid?,query?,cursor?:string,limit?:number})` → `{items:ClipItem[],nextCursor:string|null}`. Results preserve descending `createdAt` and document-ID order across pages. The For You feed no longer reorders older clips by engagement. Saved mode uses the save record's creation time. Clients must keep paging through an empty filtered page when nextCursor exists. Search matches caption/hashtags/author within each scanned page, not a global full-text index.
- `getClip({clipId})` → `{clip:ClipItem}`.
- `getClipProfile({uid})` → `{profile:ClipProfile}`.
- `updateClipProfile({bio?:string,privateAccount?:boolean})` → `{profile:ClipProfile}`. Name/photo/username remain in existing app profile.
- `followClipCreator({uid,following:boolean})` → `{status:'none'|'pending'|'accepted'}`. Private account creates approval request; public account accepts immediately.
- `listClipFollowRequests({cursor?,limit?})` → `{items:{uid,displayName,username,photoURL,createdAtMs}[],nextCursor}`.
- `listClipFollowers({cursor?,limit?})` → same response as follow requests, for the caller’s accepted followers.
- `respondClipFollowRequest({uid,accept:boolean})` → `{ok:true}`; `removeClipFollower({uid})` → `{ok:true}`.
- `setClipInteraction({clipId,type:'like'|'save'|'hide',active:boolean})` → `{ok:true,likeCount:number}`.
- `recordClipView({clipId})` → `{ok:true}`. Server deduplicates one viewer per clip; app sends after meaningful playback threshold.
- `reportClip({clipId,commentId?,reason:'spam'|'abuse'|'sexual'|'violence'|'copyright'|'other',details?:string})` → `{ok:true,reportId}`.
- `listClipComments({clipId,parentId?:string,cursor?:string,limit?:number})` → `{items:{id,authorUid,author:{uid,displayName,username,photoURL},text,parentId,createdAtMs,likeCount,likedByMe,replyCount,deleted,canDelete}[],nextCursor}`.
- `addClipComment({clipId,text,parentId?,clientId})` → `{commentId}`. clientId unique per send, replay idempotent.
- `deleteClipComment({clipId,commentId})` → `{ok:true}`; clip owner or comment author can delete, with tombstone to preserve replies.
- `setClipCommentLike({clipId,commentId,active:boolean})` → `{ok:true,likeCount}`.
- `updateClip({clipId,caption?,audience?,groupId?,allowComments?,allowDownload?})` → `{clip:ClipItem}`. Content/audience changes reset published item to review when review is enabled.
- `deleteClip({clipId})` → `{ok:true}` soft-remove; media cleanup background service removes files.
- `shareClip({clipId,conversationId,clientId})` → `{messageId}`. Creates `type:'clip'` message with generic text plus `clipId`. Never embeds private caption/owner/cover or URL. Viewer resolves current permissions when opening.

## Media API

- `initClipUpload({draftId})` → `{clipId,storagePath,maxUploadBytes,maxDurationSeconds}`.
- `publishClip({clipId,caption,audience,groupId?,allowComments,allowDownload,trimStartMs,trimEndMs,overlayText,mute,coverTimeMs,termsVersion})` → processing response.
- `getClipPlayback({clipId,quality:'standard'|'dataSaver',download?:boolean})` → `{url,thumbnailUrl,expiresAtMs}`; short-lived signed URLs after authorization. Read URL lease can remain valid until expiry; sharing an app link never grants audience membership.
- `getClipThumbnails({clipIds:string[]})` → `{items:{clipId,thumbnailUrl,expiresAtMs}[]}` (up to 30 IDs; inaccessible items omitted).
- `onClipProcessing` trigger validates duration and content, produces standard/dataSaver/cover, then pending_review or published according to policy.

## Access and counts

`clipProfiles/{uid}.suspended` or `.deleting` restricts the whole Clips account and hides its content. Private account approval gates every clip audience, including public posts. Owners may view their unpublished clips; other viewers require published status, no mutual block, and the current audience membership. Profile clip/like totals are aggregate queries: owners see all their published posts; others see eligible public/follower posts, excluding group/private totals. Direct clients cannot read these collections.

