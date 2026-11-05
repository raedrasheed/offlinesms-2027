# Group phone contacts and OfflineSMS readiness

A phone-only contact could appear in the optimistic group roster without a new server add request. The old lifetime `addExternal:<group>:<phone>` outbox key returned a previously completed or dead job. Re-adding the same phone then reported success locally, although the server roster used by SMS preview was unchanged. The device logs supplied on November 5 showed only a November 4 invocation; they are consistent with this defect but do not establish every failure on that device.

The client now saves the local contact and its outbox request in one transaction. Pending duplicates coalesce, explicit retries reset failed requests, and a new add/remove cycle creates a new intent. Contact changes for the same group and phone retain their order across backoff. Other contacts and messages remain independent. A successful callable response confirms only the latest intent, and account changes suppress stale acknowledgements and UI notifications.

The group roster shows waiting/failed sync states in English and Arabic, with an administrator retry action. It refreshes when a worker persists a result. Add screens check local queue failures instead of reporting success. Remote roster entries use the group document ID, not the owner's private contact ID, so reconciliation and removal address the same entity.

## Validation

- SQLite regression tests cover legacy dead requests, completed requests, duplicate taps, add/remove/add ordering, backoff, independent groups/phones/messages, stale confirmation and atomic rollback.
- Component tests cover pending/failed labels, retry, account-scoped refresh and canonical remote reconciliation.
- Push tests cover successful/rejected requests and account switching during a response.
- Subscription test covers canonical document IDs.
- Emulator integration adds an unregistered number through `addExternalContactToGroup`, verifies the authoritative roster, previews the number as `ext:<digits>`, reserves the quoted price and creates its relay job. No real SMS is sent by the test.

## Device verification

Install the updated test APK over the existing OfflineSMS Test app to retain its local queue. As group owner/admin, open the group's phone contacts while connected. For an existing waiting or failed contact choose Retry sync; the sync label should disappear after the server confirms it. Open OfflineSMS on a fresh message, select Everyone, refresh preview and confirm that the phone contact appears among recipients. Also test add while offline followed by reconnect, and remove then re-add.

This change is in the mobile client; no new function deployment is required for it. The already-deployed `addExternalContactToGroup`, `previewSmsEscalation`, `escalateSms` and relay dispatch functions remain authoritative. Coverage, duplicate, previously-sent and balance checks still apply. A contact excluded by an explicit preview reason must be diagnosed using that reason.

This branch builds on PR #63's video fixes; merge that dependency before this PR.
