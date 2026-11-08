# Posts retired independently of Clips

Posts are disabled by product decision. This is not a change to the Clips, Status or chat features. Existing data is retained; account erasure and removal-media cleanup remain operational.

## Runtime changes

- Remove the Posts button and its callback from the Clips feed header. Unregister PostsFeed, PostComposer and PostViewer from mobile navigation.
- All nine mobile Posts API wrappers reject locally without RPC calls. Filter legacy post activity responses and ignore their navigation targets, including when an older backend still returns them.
- All nine backend Posts callables reject with `failed-precondition / posts-disabled` before account/business reads, writes, media upload or signed URL generation. The backend switch is hard disabled; Clips settings and environment variables cannot re-enable it.
- Hide old post events from the social activity endpoint and suppress new post activity writes. Clip, follow and status activity continue through their existing access checks.
- Remove dashboard Posts links, return 404 for its route tree, and guard every post data read/server action, including image leasing and approval. A previously open browser tab cannot bypass these guards after dashboard deployment.
- Firestore rules already deny direct reads/writes to posts and reports, and Storage rules already deny direct postMedia access. No rules deployment is needed for this change. Previously issued image leases expire normally; no new ones can be issued after the respective backend/dashboard deployments.

Archived Posts implementations remain in source for retained-data handling and regression coverage. Their behavior tests explicitly mock an enabled policy; separate default-policy tests prove that shipped entry points are disabled.

## Deployment

Installing the new mobile APK removes Posts from that installation. Server changes must also be deployed to stop older app versions. From an updated checkout of this branch (which contains the earlier fixes), in PowerShell:

```powershell
Set-Location D:\sms-production
git fetch origin
git switch fix/disable-posts
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
$only = node scripts/release/deploy-only.mjs social
firebase deploy --only "$only" --project offlinesms-prod-2027
node scripts/release/check-posts-disabled.mjs --project offlinesms-prod-2027
```

The existing `social` deployment group contains the nine callables, the activity read/read-marker functions and the retained-data cleanup trigger. The check sends unauthenticated empty requests, so it cannot create or modify a post on an older deployment. It succeeds only when every Posts callable explicitly returns the disabled response.

Deploy the updated dashboard through its existing hosting pipeline as well, so the administration links, routes and server actions are disabled there. The usual dashboard production build is covered by CI. This branch does not deploy production services automatically.

## Verification

- Mobile tests: no Posts header action even from a stale callback prop; clip controls still work; nine wrappers make no network calls; old post notifications and destinations are filtered while clip/status/follow navigation remains available.
- Dashboard tests: all six reads/actions refuse an authorized platform administrator without touching the database, transactions or signing APIs.
- Emulator tests: every Posts callable refuses while Clips is enabled and retained data remains unchanged; legacy post activity is hidden and valid clip activity continues; new post activity is suppressed.
- Full repository typecheck, unit suites, rules/integration/callable tests, dashboard build and Android test builds run in CI. Production deployment and physical device checks are separate and must be reported as such.

Stacked on PR #65, which depends on #64 and #63. The updated test APK retains the preceding profile startup, SMS contact and video fixes.
