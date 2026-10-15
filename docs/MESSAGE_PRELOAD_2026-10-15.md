# Prepare recent messages before opening a conversation

## Report and finding

The user reports a reduction from about six seconds to about three seconds after
the direct foreground reads in PR #37. These are user observations, not measured
device traces available to this change. The remaining latency has not been
attributed to a particular network or native-render stage by a phone trace.

The chat-list feeder previously updated the conversation preview and unread
state, but did not populate the conversation's message rows. Entering a chat
could therefore still be the first opportunity to fetch its new messages. A
faster request on navigation cannot eliminate that network dependency.

## Change

The local chat-list hook now owns a foreground message preloader. SQLite remains
the source of truth for rendering; no second message cache or receipt path is
introduced.

- On list availability, prepare the latest 25 messages for up to eight chats,
  prioritizing unread chats, then recent message time. Limit REST requests to two
  concurrently and coalesce them with existing conversation-open requests.
- Keep at most three prioritized chats updated through 25-message live windows
  while the app is foregrounded. The open conversation's existing 100-message
  listener remains unchanged. A ready preload listener avoids a new REST page
  request for every summary update in that chat.
- Within the 50 tracked summaries, a changed message ID/time can also trigger a
  preload outside the initial eight. Persist the server's nested last-message ID
  and timestamp in the list feeder so this is based on messages rather than
  unrelated conversation metadata.
- Coalesce a newer revision arriving during an in-flight read; cap failed read
  attempts at three until a changed revision, reconnect, or foreground resume.
- Stop preload listeners and queued reads in background/offline state; revalidate
  on return. Already submitted requests may finish into the same account's DB.
  Unmounting/logging out prevents further work; late reads/listeners are guarded
  by account and DB identity. Chat-list reads also have a lifecycle guard.
- Preloading does not mark messages read, send receipts, or bypass the local
  clear-history watermark. Opening a prepared conversation continues to display
  local rows before waiting for network results.

This trades bounded extra Firestore reads and local writes for readiness before
navigation. Up to 200 documents may be returned by the initial eight REST pages,
plus the initial three live windows (up to 75); this is not a zero-cost cache.
Foreground resumes can repeat bootstrap reads. The existing conversation-list
and open-conversation subscriptions are additional to these preload limits.
No timers poll all message histories, and no OS background execution is assumed.

## Verification

- Mobile unit/SQLite suite: 512 tests passed before adding two more boundary
  cases; all 14 preload tests passed after those additions.
- Mobile TypeScript check passed after the final source changes.
- Mounted-hook tests use real SQLite (sql.js), the real chat/message feeders and
  repository/mapping code, with a fake Firestore transport and app lifecycle.
  They demonstrate that new messages are stored with only the chat list mounted,
  and then appear on a local-only open without a network result. They also cover
  the 25-row window, unchanged unread/outbox state, background/resume, cleared
  history, changed account, and replacement DB for the same account.
- Scheduler tests cover eight-chat/two-request/three-listener bounds, unread
  priority, metadata-only updates, changed older chats, live-feed reuse,
  in-flight revision changes, retries, and stop behavior.

These are correctness and scheduling tests, not an Android/iPhone latency
benchmark. Native rendering and Firestore production latency must be measured on
devices. A prepared conversation should not wait for a fresh network result;
there is no guarantee of literal zero time to render or receive a remote message.

## Device acceptance

Build the merged code as 2.4.1 (18); this change does not alter version numbers,
dependencies, Firebase rules, dashboard settings, or backend deployment.

Test separately on Android and iPhone:

1. Keep the receiving app on the chat list, send a new message from another
   account, then open that conversation. Measure until **that new message** is
   visible, not just the first previously saved bubble.
2. Repeat after returning from background, immediately after a cold start, and
   after reconnecting. Report these separately because readiness differs.
3. Open an already prepared chat offline and verify local messages appear.
4. Confirm merely staying on the list does not send read receipts. Verify
   cleared messages remain hidden and changing accounts shows only that account.

With `EXPO_PUBLIC_PERF_LOG=1`, `sync:preload:ready` records completed direct
preloads (duration and count only). Existing `sync:recent:network`,
`sync:recent:commit`, `sync:live:first-server`, and `sync:local:read` help separate
network and local stages. A generic first-visible span can finish on an old
cached message; an exact notification target or a recorded screen test is needed
to measure a specific new message. No message content is logged.

## Primary reference

[Firebase: Understand real-time queries at scale](https://firebase.google.com/docs/firestore/real-time_queries_at_scale)
recommends efficient small bootstrap queries and long-lived listeners for
responsive applications. The bounded counts above are application choices,
not Firebase-prescribed constants. Keeping data ready before navigation is the
implementation decision derived from this app's observed data flow.
