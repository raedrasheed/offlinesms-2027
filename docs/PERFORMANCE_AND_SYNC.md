# Responsiveness and notification → message sync

This document covers what was measured, what was slow, what changed, and what is still unproven. It also traces a message from the moment it is saved until it is visible after a notification tap.

## 1. Notification → visible message: the full trace

| Step | Where | Before | After |
|---|---|---|---|
| 1. Save | `sendTextMessage` / `createMediaMessage` (callable) writes `conversations/{c}/messages/{m}`. The write includes `clientLocalId`. | — | unchanged |
| 2. Notify | `onMessageCreateNotify` (Firestore trigger) sends FCM data `{type:'chat_message', conversationId, messageId, …}`. | — | unchanged |
| 3. Receive (foreground) | `addNotificationReceivedListener` → `prefetchFromData` | Called `syncNow('active-change')`. That call was **skipped** whenever another sync was running, for example the boot pull or the history backfill (up to 800 messages). | `notificationTargets.request(c, m)` reads **exactly that one document** (`pullMessageById`). It does not depend on any other sync. |
| 4. Tap (background / killed) | `getLastNotificationResponseAsync` + `addNotificationResponseReceivedListener` → prefetch + navigate | On a cold start the prefetch ran **before the local DB was open**, failed silently, and was lost. Navigation dropped `messageId`. | The request is queued (`pending`) and runs from `onDbOpened()`. Navigation passes `{id, messageId}`. |
| 5. Open conversation | `useLocalConversation(id, uid, messageId)` | Read the newest 100 rows (temp B-tree sort: 59 ms at 20k messages in the harness). | Index-ordered read (2.5 ms). Then **reveal the focus message**: if it is local, the window grows to include it; if not, it is fetched directly. |
| 6. Sync | `startConversationFeeder` (realtime listener) | Re-upserted the **whole 100-message window** on every snapshot (201 statements) before `onChange`. | Applies only `docChanges()` (≈4 statements per message), in one transaction, then fires `onChange` **after commit**. |
| 7. Render | `refresh()` → `setMessages` → FlatList | A refresh requested **while another refresh was running was dropped** (`if (refreshing) return`). This was the main cause of a notified message staying invisible until some later change. All 100 `Message` objects were recreated each time, so every bubble re-rendered. | `coalescing()` never drops a request; a burst collapses into one extra pass. The structural-sharing mapper keeps unchanged objects, so **one** bubble re-renders. The screen scrolls to the focus message and highlights it. |

### States shown while the message is not on screen yet (`SyncStatusBanner`)

| Focus state | Banner (en / ar) |
|---|---|
| `locating` / `pending` / `fetching` | "Loading this message…" / «جارٍ تحميل هذه الرسالة…» (or *waiting for connection* when offline) |
| `waiting-network` | "Waiting for connection…": retried automatically on reconnect |
| `missing` | "This message is no longer available" (deleted, or no longer a member) |
| `error` | "Couldn't load this message" plus a **Retry** button |
| no focus, offline | "Offline — showing saved messages" |
| no focus, first sync > 1.5 s | "Connecting…" (never shown on a fast open) |

### Duplicates, order and read status

- Every inbound path goes through one mapper (`remoteMessageInput`) and one upsert keyed by `remote_id`: realtime feeder, catch-up pull, history backfill and notification fetch. The same message from several paths is therefore stored once (tested).
- **Own-message flash fixed.** The realtime feed can deliver your own message before the send callable returns. Previously the canonical row was inserted next to the optimistic one, and both showed until the outbox reconciled. The upsert now adopts the optimistic row using the server's `clientLocalId`. The adoption is limited to the same conversation and to rows not yet synced.
- Order: `compareRows` sorts by server time, then local creation time, then id. Ties are therefore deterministic.
- Read and delivered counts are updated in place, never as a new row. Unread state is unchanged: the conversation still marks read on open, as before.
- **Found and fixed while testing:** a message deleted for everyone kept its `media_download_url` and `media_thumb_url` locally, because of `COALESCE` in the upsert. Those URLs are now cleared too.

### Scenarios

| Scenario | Path | Covered by |
|---|---|---|
| Foreground, message for another chat | received listener → targeted fetch → tap opens the chat with the message already local | unit (targets, routing) + SQLite (fetch) |
| Foreground, the open chat | feeder change → coalesced refresh | SQLite feeder tests, coalescing tests |
| Background → tap | response listener → fetch + navigate with `messageId` → reveal / scroll / highlight | unit + SQLite |
| Killed → tap | `getLastNotificationResponseAsync` → request queued until DB open → fetch | unit (`pending` → `onDbOpened`) |
| Slow / lost network | `waiting-network` → automatic retry on reconnect; `error` → Retry | unit |
| Message deleted before the tap | `missing` banner | unit |

**Not done here:** foreground, background and killed runs on a physical device with real FCM, and real throttled-network runs. These need a device build signed into a non-production project; see §4.

## 2. Measurements

Harness: `apps/mobile/__perf__/localData.perf.ts` (run with `npx vitest run --config vitest.perf.config.ts`).

It runs the app's **real** repositories, feeders and view-model code on a real SQLite engine (sql.js, SQLite 3.45). Firestore is replaced by an in-memory fake with real snapshot semantics: `docs` is the whole window and `docChanges()` lists only the changes.

The **same harness file** was run against the pre-change commit `2a61167` (in a worktree) and against this branch, on the same machine in the same session.

Dataset: 200 conversations × 200 messages, plus one conversation with 20,000 messages. Medians come from 15–30 runs; each version was run several times and the numbers below are representative.

| Scenario | Before (median) | After (median) | Statements before → after |
|---|---|---|---|
| Chat list read + map (200 chats) | 2.2 ms | 2.1 ms | 1 → 1 |
| **Open conversation (newest 100 of 20k)** | **59 ms** | **2.5 ms** | 1 → 1 |
| Open conversation (100 of 200) | 2.7 ms | 2.2 ms | 1 → 1 |
| **New message: server write → feeder committed → re-read** | **72 ms** | **2.7 ms** | **201 → 4** |
| **Load older, 10th page (window 1000)** | **87 ms** | **25 ms** | 1 → 1 |
| Send: optimistic insert + outbox | 0.4 ms | 0.6–1.0 ms | 7 → 7 |
| **Chat list: new message in 1 of 50 chats → list re-read** | **6.8 ms** | **2.5 ms** | **102 → 5** |
| **Bubbles re-rendered after one new message** (`Message` objects changed) | **100** | **1** | — |

Query plans (from the same run):

- Messages: before, `idx_messages_conversation_remote_created` + **USE TEMP B-TREE FOR ORDER BY**; after, `idx_messages_conv_visible_order`, with no sort step.
- Chat list: before, `idx_conversations_archived` + **TEMP B-TREE**; after, `idx_conversations_archived_last`, with no sort step.

**Reading the numbers**
- On a phone, every statement is an async native round-trip through expo-sqlite. The statement count is therefore the better predictor of device latency than the in-process milliseconds.
- **Send is slightly slower (+0.2–0.6 ms).** The two new indexes are maintained on every insert. The statement count is unchanged. This is the accepted cost of the read-path gains.
- Raw results: `apps/mobile/__perf__/results/{baseline,after}.json`.

**Listener churn (chat list).** The presence and typing subscription key included the **list order**. Every incoming message moved a chat to the top and recreated about 2 Firestore listeners plus a 5-second timer **for every visible chat** (≈100 listeners for 50 chats). The legacy fallback path did the same with `userState` and peer listeners. Both now update by diff (`createKeyedSubscriptions`), so re-ordering starts and stops **0** listeners (unit-tested). Presence updates that change nothing no longer re-render the list.

**Chat-list repaint follow-up.** Two remaining invalidations defeated `ChatRow` memoization in the local-first path: every SQLite refresh recreated every item and its Timestamp wrapper, and the long-press callback depended on the changing `local` result object. A mapper scoped to the signed-in user now preserves unchanged items and no-op list reads; the callback depends only on the stable `refresh` function. Reordered items keep their identities, removed items are evicted, and all displayed/filter fields still invalidate their item. In a 50-chat regression fixture, one incoming message changes **1 item identity instead of 50**. This is an allocation/memoization check, **not a measured device speedup**. The 25 chat-list model tests cover unchanged reads, reordering, removals, user isolation and visible-field updates; three identity regressions fail with the previous `rows.map(mapConversationRow)` behavior.

**Startup.** The first screen no longer waits for the network `users/{uid}` snapshot to decide whether to show profile setup. A per-uid local flag is shown immediately and the live snapshot corrects it.

## 3. On-device measurement (same device, same network)

`src/lib/perf.ts` records these marks; they are logged in development builds and readable through `perfReport()`:

`auth:resolved`, `profile:fromCache`, `chatList:firstLocalRender`, `conversation:open`, `conversation:firstLocalRender`, `push:tap`, `push:prefetch`, `push:targetVisible`.

To compare builds on one device:
1. Install each build in turn on the same phone, on the same Wi-Fi or with the same throttle profile.
2. Capture `adb logcat | grep '\[perf\]'` over 5 cold starts, 5 chat opens and 5 notification taps.
3. Compare the medians of `auth:resolved → chatList:firstLocalRender`, `conversation:open → conversation:firstLocalRender` and `push:tap → push:targetVisible`.

## 4. Not yet validated

- Physical-device timings (the marks above). This environment has no device or emulator with Google Play services.
- Real FCM delivery in the foreground, background and killed states, plus throttled-network runs.
- The expression index on the bundled SQLite of old Android versions. Expression indexes need SQLite ≥ 3.9, and expo-sqlite bundles a recent SQLite, but this has not been checked on a device.
