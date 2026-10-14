# Message loading, push synchronization and cloud retention

Implementation review dated 2026-10-14. Base: `38475753616f643b10e8535d36fff33796408664` (`main`). Branch: `fix/message-sync-performance-retention`.

## Scope and evidence

The reported release is 2.4.0 build 17 on Android and iOS. The original checkout declared version 2.4.0 with Android versionCode 16 and iOS buildNumber 15. The installed build 17 has **not** been matched to its EAS build/source commit. On 2026-10-14, the owner requested merging this work into `main` as **2.4.1 build 18**. Expo configuration and the checked-in Android Gradle configuration now agree on those release values; EAS uses local version numbers without automatic increment. Dependencies are unchanged. This is a source fix with automated validation, not a measured performance result on the installed binaries.

| Confirmed source behavior | Change | Validation |
| --- | --- | --- |
| An online notification read failure was not retried on reconnect | Bounded exponential retry, reconnect recovery, per-user persisted pending targets, reset on account transition; permission failures stop | Transient errors, reconnect, retry cap, logout, restored queue tests |
| Direct notification fetch committed SQLite without notifying the normal open screen | Publish conversation changes after the transaction commits; use server reads to distinguish missing documents from an empty cache | Real SQLite targeted-fetch/notification test |
| Earliest forward page + newest live window could leave a middle gap; the oldest local row incorrectly implied complete history | Independent server-page history frontier; versioned cursor ignores old incorrect completion flags; full timestamp + document-id cursors | Repair 150 disconnected cached rows into all 1000 messages; 237 equal timestamps; failed commit cannot advance cursor |
| A fresh device started at the oldest remote messages | Fetch recent page immediately, then independently backfill older history | Newest 50 of 1000 appear first; next new message catches up |
| Conversation pagination could stall on a shared timestamp | Tuple pagination and bounded user-state reads | 123 conversations with the same update timestamp |
| Every new message changed the jump callback passed to every bubble | Stable callback reading the latest rows through a ref | Type checks; physical render profiling remains required |
| Mounted/history media started many original-file downloads | Viewport prefetch, thumbnails, cache subscriptions, max three original-cache downloads, atomic `.part` rename | Concurrency, deduplication, no offscreen transfer, publish-after-rename tests |
| Reading all loaded history queued read and delivered separately | Read receipts only for viewable rows; read already implies delivery; latest-chat read marker deduplicated | Existing receipt semantics retained; physical scroll/receipt check required |
| Every receipt event scanned every receipt and could race another event | One-time legacy bootstrap, then transactional per-recipient contributions based on current receipt state | Duplicate/concurrent/out-of-order event tests; parent absence does not resurrect data |
| Message-create fan-out could overwrite a read receipt with pending or increment unread twice | Transactional fan-out marker, preserve existing receipts, avoid regressing newer summaries | Late/duplicate create trigger tests |
| Media notification was sent while the upload reservation had no file URL | Keep text-create trigger; notify media on ready transition, with per-recipient dispatch journal | Readiness tests; real FCM/APNs device delivery remains required |

Push transport acknowledgement cannot provide exactly-once delivery. Dispatch completion suppresses ordinary duplicate trigger retries; a crash between transport acceptance and recording completion can still duplicate a push. Message reconciliation remains idempotent.

Existing `*_to_visible` performance spans retain their legacy data-array meaning. New `conversation_first_viewable` and `push_to_viewable` spans finish from FlatList's native viewability callback. They should be used for device comparisons; no P95 or percentage speedup has been claimed from in-process SQLite tests.

## Retention policy

Platform dashboard: **Admin → Settings → Message retention / الاحتفاظ بالرسائل**.

- `systemSettings/general.messageRetentionDays`: integer 1–3650, default **14**.
- `messageRetentionEnabled`: default **false** for the first deployment. Enabling is an explicit dashboard action after preview. Only platform super/legacy admins can change it; organization admins cannot.
- Expiration is based on the original server `createdAt`, independent of edits or receipt updates. Changing days applies to existing and future cloud chat messages. Raising it never restores deleted data.
- `purgeRetainedMessages` runs every **15 minutes**, up to 8 pages of 100 candidates within its run budget. Large existing backlogs take multiple runs. This is not an exact-to-the-second 14-day deletion guarantee.
- A durable cleanup journal and lease cover Storage, nested message documents, parent deletion, stale summary/pin cleanup and unread adjustment. Storage failures preserve the job for retry. Policy changes are rechecked before admitting each new deletion. Jobs already admitted are irreversible cleanup work; pausing stops new admissions, and remaining jobs resume on the next enabled run.
- The worker only accepts `conversations/{id}/messages/{id}` paths. It removes the message's owned `chatMedia/{conversation}/{sender}/{message}/` files and message subcollections (receipts, contribution/dispatch records, etc.). Accounts, wallets, billing/SMS audit records, groups and unrelated Storage paths are not retention targets. Quotes/forwards contained in newer messages follow those messages' own age; there is no cascade deletion of newer messages.
- This is **cloud retention**, separate from the dormant disappearing-message sweeper. It does not set `deletedForEveryone` and does not prune SQLite or downloaded phone files. Files never fully downloaded cannot remain available after their server copy is removed. A new device, or a device offline beyond the retention period, cannot recover the expired cloud history.
- Firestore receipt rules and Storage upload rules reject new writes after retention begins or the parent is removed. Storage rules now read the message reservation in Firestore. First deployment requires the documented cross-service Rules permission; validate it on staging before activation.
- Preview reads only timestamps and document paths, counts chat paths, and caps scanning at 10,000 documents. When capped the UI says **At least**. Preview is an estimate at that instant, not a snapshot lock.
- `systemJobs/messageRetention` records last run, deleted/failed counts and duration. Monitor failed counts, cleanup job backlog, scheduled execution failures and Firestore/Storage costs. Retention entails reads, deletes and function execution; it is not cost-free.

Firestore TTL was not used as the sole mechanism: Firebase documents asynchronous deletion and the fact that deleting a parent does not delete its subcollections. A journaled worker is needed for the requested coordinated cleanup.

## Validation performed

- 1068 unit/repository tests across 98 files passed (including sql.js SQLite regression cases).
- 10 targeted Firestore/Auth/Storage emulator integration tests passed, including real emulator Storage object deletion and preserved unrelated files.
- 19 targeted rules tests passed: conversation permissions, orphan/expiring receipts, and live versus expired upload reservations.
- Dashboard, Functions and mobile TypeScript checks passed.
- Production Dashboard and Functions builds passed. Expo Android and iOS JavaScript/Hermes exports passed; these are **not signed APK/AAB/IPA builds**.
- CI now starts the Storage emulator for its rules and integration gates, so storage retention checks are not silently skipped.
- Tests ran on the available Node 24 environment. Functions deployment remains configured for Node 22; confirm CI/deployed-runtime checks as part of release.

Reproduce from repository root:

```bash
npm ci
npm --prefix apps/mobile ci
npm test -- --maxWorkers=2 --minWorkers=1
npm run typecheck
npm --prefix apps/mobile run typecheck
npm run build
npx firebase emulators:exec --project demo-offlinesms --only firestore,auth,storage 'npx vitest run --config vitest.integration.config.ts functions/__integration__/messageRetention.int.test.ts'
npx firebase emulators:exec --project demo-offlinesms --only firestore,storage 'npx vitest run --config vitest.rules.config.ts tests/rules/conversations.rules.test.ts tests/rules/retention.rules.test.ts tests/rules/retentionStorage.rules.test.ts'
```

From `apps/mobile`:

```bash
EXPO_NO_TELEMETRY=1 npx expo export --platform android --platform ios --max-workers 2 --output-dir dist/sync-retention
```

## Release gates and rollback

1. The owner selected **2.4.1 (18)** for Android and iOS. Build from the merged commit, verify the actual artifact versions and signatures, and match installed build 17 to its source for device comparisons. Before submission, confirm build 18 has not already been uploaded to the relevant store. Production Android builds use the manual `Production Android release` workflow with `target=user-app`; iOS uses `eas build --profile production --platform ios` from `apps/mobile` with the existing EAS project and signing credentials. A merge triggers CI, not a production store submission.
2. Deploy indexes and both rules sets to staging; verify the new `messages.createdAt` collection-group index is ready and Storage-to-Firestore Rules access works. Then deploy the chat function group and dashboard, keeping retention disabled initially. The release function inventory includes the new media-ready trigger and retention worker.
3. Test text, photo and voice notification arrival/tap with Android and iPhone in foreground, background and terminated states; network loss/recovery; auth cold start; existing large history; same-time messages; paging gaps; account switch; and a pending media upload. Never rely on a background/silent push as the only synchronization mechanism.
4. Compare physical-device first-viewable and notification-to-viewable P50/P95 against the verified build 17, with the same data/network and at least 30 opens/taps per scenario. Record device/OS/build and errors; do not substitute synthetic timings. Inspect list frame drops and network transfer counts while scrolling a media-heavy chat.
5. Preview staging retention, confirm the 14-day default, test paused/resumed cleanup and storage permission failure, and verify local messages/files survive cloud cleanup. Preserve required production data before the first irreversible activation. Roll out mobile changes gradually and monitor failures before broadening.
6. Rollback: disable `messageRetentionEnabled` to stop new admissions, drain/inspect already-admitted cleanup jobs deliberately, and revert mobile/function/dashboard changes as needed. Deleted cloud content cannot be restored by merely reverting code or increasing retention days. No production deployment or deletion was performed by this implementation task.

## Primary references

- [Android: offline-first data layer](https://developer.android.com/topic/architecture/data-layer/offline-first)
- [Firebase: query cursors and pagination](https://firebase.google.com/docs/firestore/query-data/query-cursors)
- [Firebase: Firestore events and trigger delivery](https://firebase.google.com/docs/functions/firestore-events)
- [Firebase: TTL behavior and subcollections](https://firebase.google.com/docs/firestore/ttl)
- [Firebase: cross-service Storage Rules](https://firebase.google.com/docs/storage/security/rules-conditions)
- [React Native: optimizing FlatList](https://reactnative.dev/docs/optimizing-flatlist-configuration)
- [Expo: push notification delivery and application states](https://docs.expo.dev/push-notifications/what-you-need-to-know/)
- [Stream: offline support](https://getstream.io/chat/docs/sdk/react-native/basics/offline-support/)
- [Sendbird: message collections and gap recovery](https://docs.sendbird.com/docs/chat/sdk/v4/javascript/local-caching/using-message-collection/message-collection)
