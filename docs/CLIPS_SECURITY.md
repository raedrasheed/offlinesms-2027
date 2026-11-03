# Clips security and erasure

Clips documents, nested interactions, profiles, reports, erasure jobs and the Clips settings document are not readable or writable through the client Firestore SDK. Mobile calls authenticated server functions. Dashboard operations verify a platform administrator session and write an audit record. Organization administrators cannot administer platform Clips policy.

Every playback grant rechecks the current viewer and owner accounts, deletion/suspension state, both directions of blocking, publication state, accepted followers, private-account policy and group membership where applicable. Shares contain a clip ID and generic text; they do not copy captions, thumbnails or media URLs into a conversation. A recipient resolves access again. Generated playback and cover URLs expire after 120 seconds. Revocation prevents new grants; already issued bearer URLs remain valid until expiration, and bytes already downloaded cannot be revoked.

## Uploads and derived media

`clipUploads/{uid}/{clipId}/source` accepts only the authenticated reservation owner while its server-created clip is `uploading` or `failed`, before the reservation expires, within the reserved byte limit and hard 200 MB cap, and with an allowed video MIME type. The source path must match the reserved path. A suspended or deleting publisher cannot upload. Direct client reads, listing and deletes are denied. All client access to `clipMedia/**` is denied.

[Cloud Storage rules can access at most two Firestore documents](https://firebase.google.com/docs/storage/security/rules-conditions). These rules read the clip reservation and publisher profile. An existing private source-upload lease can therefore remain valid after the global feature switch or the general user account is disabled; init, publish, processing and playback enforce those live states. A source lease does not grant publication. Processing probes actual video bytes, trims/transcodes locally with restricted protocols and rechecks current policy and actor/group state transactionally before publishing the result.

Firebase reserves `firebaseStorageDownloadTokens` and the emulator removes that field from custom metadata before evaluating rules. An empty custom-metadata allowlist cannot guarantee rejection of an upload-time token. The uploader already possesses those original bytes. Source finalize/metadata triggers strip tokens; publishing freezes client writes and synchronously requests token removal. The worker strips again and physically deletes the original after processing. Derived video/cover objects are server-created, have no Firebase download token and are not made available until mandatory token-clearing calls succeed.

The current Storage emulator does not implement token removal through GCS null custom-metadata updates. Tests assert the exact null-clear API request and real source deletion; they also verify derived outputs have no tokens. Token revocation itself still requires a deployed smoke check against the configured bucket.

## Account erasure

Before `deleteMyAccount` removes identity data, it transactionally writes a private publisher tombstone (`suspended`, `deleting`, `deletedAccount`) and a durable erasure job. Failure to queue prevents account deletion so the request remains retryable. Actor state is read inside mutation transactions, preventing requests that began before deletion from adding late social data after cleanup passed that collection.

The worker handles 25 records per checkpoint with an expiring lease. Retries preserve progress. It marks every owned clip removed and clears personal captions, overlays, name/photo snapshots and group association. The existing removed-clip worker purges source and derived objects. The internal owner UID remains on the inaccessible clip tombstone so file cleanup can be retried.

The job removes follow mirrors with current counters, likes and saves, view/share identity records, private saved/hidden/rate/quota data, and report details/reporter identity. Authored comments become anonymous empty thread nodes so other people's replies remain reachable; active comment/reply/like counts are adjusted once. Views and shares remain anonymous historical aggregate totals. Moderation reports retain their status and resolution record without the erased reporter's details. The private minimal publisher tombstone remains to prevent stale tokens or a moderator restore action from reviving the account.

Firestore user deletion and individual Firebase Auth deletion also queue erasure. A periodic recovery job resumes pending work and expired leases. [Firebase Auth bulk `deleteUsers()` does not emit individual Auth deletion events](https://firebase.google.com/docs/auth/admin/manage-users#delete_multiple_users); administrative bulk deletion must also delete the corresponding Firestore user documents or explicitly queue Clips erasure.
