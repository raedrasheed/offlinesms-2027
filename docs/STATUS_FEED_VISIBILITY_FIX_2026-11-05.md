# Status feed visibility — 2026-11-05

An author receives live updates for their own statuses. Other users load an audience-filtered feed through getStatusFeed. Previously, opening the Status tab within the shared cache's 15-second window could reuse an empty list after somebody else had published a story. The screen then had no refresh while it remained visible. Request errors also looked like a successful empty feed.

The Status screen now requests fresh data when focused or when the app returns to the foreground. While the screen is focused and the app is active, it refreshes every 30 seconds. It stops background/hidden refreshes, shares the existing in-flight request/cache, subscribes to cache changes, and removes expired stories. Loading, successful empty results and retryable fetch failures have distinct UI states. Cached visible stories remain usable with an error notice after a failed refresh.

Account and lifecycle guards prevent an older request from restoring another account's stories. The status audience, block/expiry rules, media upload and playback remain unchanged.

Regression checks cover a recipient's cached empty list followed by another author's new status, refocusing before the cache TTL, refresh while the tab stays open, foreground resume, no hidden/background polling, account changes, expiry and retryable fetch failures.

This addresses the confirmed mobile freshness and error-reporting defects. Production responses were not available during implementation, so a persistent empty result after a successful forced refresh still requires checking the deployed getStatusFeed callable and its filtering. The existing server scans at most 300 newest active documents before filtering; that separate limitation is unchanged.

Device verification:

1. Install the updated app on the recipient device. Publish a fresh text status from another active, unblocked account.
2. Open Status on the recipient: the new story should be fetched even if the tab was opened less than 15 seconds earlier.
3. Keep Status open and publish another story: it should appear on the next refresh within approximately 30 seconds, plus request time.
4. Background and reopen the recipient app: Status should refresh immediately.
5. Disconnect the recipient, pull to refresh, then reconnect and retry: failure must not be presented as a successful empty feed.
6. Confirm image/video stories still open using the existing playback path.

For production diagnosis, after reproducing the issue on the recipient, use the read-only CLI command:

```powershell
firebase functions:log --project offlinesms-prod-2027 --only getStatusFeed --lines 80
```

A successful HTTP request does not prove that it returned the expected story. Check audience/exclusions, blocks, active accounts and expiry before changing any access rules.

[Firebase logging documentation](https://firebase.google.com/docs/functions/writing-and-viewing-logs)
