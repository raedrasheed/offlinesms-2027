# Conversation sync recovery — 14 October 2026

## Reproduced defects

The reported screen showed saved messages and a retry banner. That banner was
shared by notification-target errors and general listener errors; a screenshot
alone could not identify which operation failed on the device.

The production SQLite adapter called `withTransactionAsync` independently for
chat-list snapshots, message snapshots, catch-up pages and notification reads.
Expo SQLite 15.2.x implements this as BEGIN/task/COMMIT (ROLLBACK on rejection)
on a shared connection. Simultaneous transactions therefore collided. An
unrelated standalone write could also join a transaction and disappear when
that transaction rolled back. Concurrent screen opens could create two handles.

A regression using real SQLite (sql.js) and the actual connection adapter,
with the native BEGIN/COMMIT/ROLLBACK semantics preserved, reproduced all three
defects before the fix: three overlapping transactions all rejected, an unrelated
write disappeared on rollback, and two concurrent opens created two handles.
The previous repository test helper silently joined overlapping transactions,
so those tests did not expose this native-adapter behavior.

Two additional recovery defects were found: a failed snapshot write was dropped
until another Firestore document change arrived, and the UI's Retry only fetched
a notification target. It did nothing for a conversation listener error without
a target. A late direct-read failure could also replace the ready state of a
message that another sync path had already saved.

## Changes

- Serialize each connection's transactions and standalone SQL operations. A
  transaction receives an explicit scoped handle; all its queries use that
  handle. Rejected work does not block subsequent work. Reads observe completed
  transactions instead of partially written batches.
- Serialize open/close operations, drain outstanding SQL before close, and close
  a handle whose initialization fails. Existing schema and saved messages stay
  intact.
- Retry a rejected snapshot write twice locally (150/300 ms); do not wait for
  another server change. After exhausted retries, the next snapshot reconciles
  its complete window. Stopped listeners cannot apply queued snapshots.
- Subscribe to metadata changes so a server confirmation can update connection
  status even when the documents themselves did not change.
- Let a committed local target settle a pending notification immediately. Ignore
  late results from superseded direct reads and release waiting callers on logout.
- Retry restarts the conversation listener as well as its notification target,
  preserving visible messages. General sync errors now have a separate label.

## Validation and rollout

- 488 mobile tests passed across 48 files, including 34 existing-user database
  upgrade tests, 4 native-adapter concurrency tests, and 2 mounted hook retry tests.
- Mobile TypeScript and EN/AR translation parity passed.
- No Android/iOS version number changes: the requested release remains 2.4.1 (18).
- This correction needs a rebuilt and installed mobile binary. It has no server
  schema, security-rule or function changes and does not enable cloud deletion.
- Production Firebase deployment state could not be read: the local Firebase CLI
  had no authenticated session. This does not establish whether earlier server
  changes have been deployed by the owner.
- Device latency is still to be measured. The tests reproduce and fix concrete
  lost-write/recovery cases; they do not establish an end-to-end speedup on the
  user's network. Verify repeated group opens, notification taps, a burst of new
  messages, and reconnection after airplane mode on Android and iOS.

References: [Expo SQLite transactions](https://docs.expo.dev/versions/latest/sdk/sqlite/#executing-queries-within-an-async-transaction),
[Firestore listener metadata](https://firebase.google.com/docs/firestore/query-data/listen#events-metadata-changes).
