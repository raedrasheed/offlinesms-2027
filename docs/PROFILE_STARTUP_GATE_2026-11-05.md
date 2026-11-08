# Profile setup appears only after confirmed incomplete data

> Superseded: mandatory profile setup was removed entirely in the follow-up change. See [STARTUP_AND_STICKER_PRESENTATION_2026-11-05.md](STARTUP_AND_STICKER_PRESENTATION_2026-11-05.md). The gate described below is historical and no longer ships.

The navigation gate must keep three distinct states: loading/unknown, complete and incomplete. `ProfileCompletion` is mounted only for incomplete. Returning users with a saved completion for their own account continue to open the app offline.

The previous listener ignored an incomplete local cache but accepted any negative snapshot with `fromCache=false` immediately. It did not check `hasPendingWrites`. This allowed an unacknowledged local change or an initial negative result to mount the form before a completed profile arrived. The reported screenshot alone cannot identify which event sequence happened on the device; both sequences are covered by regression tests.

The hook now ignores pending writes and re-reads negative server results with `getDocFromServer` before allowing onboarding. A newer snapshot, account change, retry or unmount invalidates an older response. Positive completed snapshots retain the existing fast path, so a complete profile does not need an additional server read. Persisted incomplete flags cannot open setup during loading. Cache writes are serialized within the subscription so older writes cannot finish after newer ones.

App startup shows a neutral, localized loading state while verification is unknown. If verification fails without a completed offline fallback, it shows a localized error and Retry action. A failed read never means that the user needs profile setup. The authoritative `profileCompleted` flag and the existing username claim flow are unchanged.

## Verification

`apps/mobile/__tests__/accountProfile.test.ts` covers startup render history (no incomplete frame before completed data), real incomplete accounts, pending writes, stale/out-of-order responses, cache timing, account changes, retry, listener/read errors, missing documents and unmount/restart. Test builds also contain the preceding video and group contact fixes. No Firebase function deployment is needed for this client change.

Device check: install the updated APK over OfflineSMS Test, close/reopen it several times with a completed profile, then repeat offline. Setup must not appear. With a genuinely new/incomplete account and a connection, setup should appear after verification; after saving, reopening should go straight to the app. Automated mocks do not replace this physical startup check.

References:
- [Firestore realtime listeners and pending write metadata](https://firebase.google.com/docs/firestore/query-data/listen)
- [Firestore getDocFromServer](https://firebase.google.com/docs/reference/js/firestore#getdocfromserver)

This change is stacked on PR #64 (which depends on #63); merge the dependencies before it.
