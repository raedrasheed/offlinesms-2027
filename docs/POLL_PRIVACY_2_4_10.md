# Poll voters and anonymous voting — 2.4.10 (27)

## What changes

- Public polls have **View voters**: each participant's display name and all
  selected answers. Results remain visible after the creator closes the poll.
- The composer has an **Anonymous poll** switch, off by default. Both modes
  explain who can see votes before sending; the privacy mode cannot be edited.
- Anonymous polls show counts/percentages, the number of voters, and the current
  user's own selection. Other participants, including the creator, cannot read
  individual ballots. Names are never requested for the anonymous results sheet.
- Arabic/English labels, theme-aware results, scrolling, and Android Back dismissal.
- Legacy polls remain public. No backfill or conversion of existing votes.

## Data and compatibility

Public polls retain their existing `poll.votes` UID → option IDs map. Anonymous
messages have an empty map and aggregate counts only. The private ballot is in
`conversations/{cid}/messages/{mid}/pollVoters/{uid}`. A transaction reads that
ballot and applies its selection delta to the aggregate counts, then updates
both together. Retries and stale sequences do not count twice. Changing answers,
multiple answers and retracting the complete selection are supported.

Rules permit only a current active participant to **get their own** anonymous
ballot. Collection queries, reading another ballot, and client writes are denied,
including clients with the admin claim. Deleted polls/disabled conversations
deny ballot reads. Poll payload updates are callable-only. Trusted backend Admin
SDK/service operators can still access ballots; this is participant anonymity,
not a cryptographic secret ballot. Live totals can also allow inference in tiny
groups, so do not describe this as protection against statistical inference.

`sendPollMessage` is a new capability boundary. Anonymous clients never fall back
to `sendTextMessage`; an undeployed endpoint fails instead of silently discarding
the privacy flag. The existing `sendTextMessage` rejects anonymous creation.

**Wire compatibility guard:** an anonymous Firestore poll keeps `closed: true`
and has a separate `votingClosed: false` while open. Upgraded handlers and clients
use `votingClosed`; old `votePoll` code rejects on `closed` before it can write a
public UID map. Closing sets both true. Preserve this guard in rollback plans.
Older APKs show anonymous polls as closed/unsupported; install 2.4.10 or newer for
voting and correct results. This also protects a partially completed deployment.

The mobile sanitizer maps the wire close state into the normal UI `closed`
property. Private selections are stored separately in the per-account SQLite
`sync_state` cache and durable outbox, never inside the shared message payload.
Pending selections survive remote message snapshots and app restart. Counts stay
server-confirmed while an anonymous vote is queued. Rejected changes restore the
last confirmed choice. Unknown private ballots require a first online read;
cached choices can subsequently be changed offline. Account changes clear the
listener and never copy a late response into another user's database.

## Deploy from Cloud Shell

Run the backend/rules first, then install the new APK. This release needs both.
The commands stop on the first failure. They do not reset modified files.

```bash
(
set -e
cd ~/offlinesms-production-release
git fetch origin main
git switch --detach FETCH_HEAD
nvm install 22
nvm use 22
export GOOGLE_CLOUD_QUOTA_PROJECT=offlinesms-prod-2027
npm ci

npx firebase deploy --project offlinesms-prod-2027 \
  --only "firestore:rules,functions:votePoll,functions:closePoll"

npx firebase deploy --project offlinesms-prod-2027 \
  --only "functions:sendTextMessage,functions:sendPollMessage"
)
```

There is no migration/backfill command. The release groups include the new
`sendPollMessage` function; the full source now exports 99 functions.

## Build the consumer app locally (Windows PowerShell)

```powershell
& {
  $ErrorActionPreference = "Stop"
  Set-Location D:\sms-production
  git switch main
  if ($LASTEXITCODE -ne 0) { throw "Switch failed" }
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw "Pull failed" }
  Set-Location apps\mobile
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "Install failed" }
  Set-Location android
  .\gradlew.bat assembleRelease
  if ($LASTEXITCODE -ne 0) { throw "Build failed" }
}
```

APK: `D:\sms-production\apps\mobile\android\app\build\outputs\apk\release\app-release.apk`.
Consumer version **2.4.10 (27)**. Business/relay version is unchanged.

## Verification

- Mobile TypeScript and Functions TypeScript build; EN/AR parity (737 keys).
- Android Hermes/Metro export succeeds. Native APK compilation runs in CI; no
  physical-device or production Firebase tests were performed locally.
- Full unit run: 127 suites / 1260 tests, plus 3 direct-feed/routing tests. Release inventory assertions were
  updated for the new callable and their 12 tests rerun successfully.
- Real Firestore emulator: 20 poll/sticker callable integration tests, including
  concurrent anonymous/public votes, retries, changing/retracting votes, closing,
  membership gates and identity-free aggregate payloads.
- Firestore rules emulator: 14 privacy tests (own read, no enumeration/other
  ballot access, admin/creator restrictions, deletion/disabled/removed members).
- SQLite tests cover restart, incoming snapshots, stale responses, offline and
  permanent failures, account switching, anonymous endpoint routing and closing.
- Mounted React tests cover public names/all selections, anonymous aggregates,
  own checks, unknown state, closed results, Arabic/English layout direction,
  composer privacy disclosure/reset, and system Back dismissal.

After deployment, use two updated accounts to create each mode, cast/change/
retract votes, close/reopen the app, disconnect/reconnect, and close the poll.
Verify public choices are visible and anonymous identities are absent for both
creator and other participant. Repeat with multiple answers enabled.

References: [Firestore field access](https://firebase.google.com/docs/firestore/security/rules-fields),
[get/list rules and trusted server access](https://firebase.google.com/docs/firestore/security/rules-structure).
