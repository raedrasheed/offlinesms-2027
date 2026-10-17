# Account contacts and substring search — 2.4.5 (22)

New chat, New contact and the Contact attachment now use one picker. An empty
search shows the signed-in account's saved registered contacts and direct-chat
peers. It does not list the entire public user directory or another account's
contacts, and it does not open the device address book.

Saved phone contacts are resolved against current registrations, including
contacts whose stored link is stale. Missing, suspended and self accounts are
excluded. Existing direct conversations supply contacts even when a phone number
is unavailable. Group membership alone does not add someone to this list.

Typing searches active OfflineSMS accounts by a contained part of the public
name or username, including middle/end fragments. `@` restricts matching to the
username. Matching ignores letter case, combining diacritics and Arabic tatweel.
The empty-list and typed-search headings explain the two scopes.

The previous New chat query used identical lower and upper bounds (effectively
exact username equality), and both new-chat screens deliberately returned an
empty list before typing. Those paths now use the shared authenticated callable.
Sparse result pages continue automatically; transient errors have a Retry action
and do not masquerade as a completed search with no matches.

## Search implementation and privacy

`syncAppContactSearch` maintains a server-only `appContactSearch/{uid}` collection
containing public name, username and bounded 1–3-character search grams. Search
uses an indexed candidate query and verifies the entire substring against live
public profiles. Each request reads at most 100 index candidates; continuation
cursors prevent hidden truncation. Renamed, deleted or suspended profiles cannot
be returned merely because an old index record remains. Late trigger deliveries
and the backfill re-read the current profile transactionally.

The search index never stores phones, email addresses, PIN fields or private
contact aliases. Default-list reads are scoped to the caller's phoneContacts and
conversations. The callable returns only public account cards with empty legacy
phone/email arrays. Clients cannot read/write the index or forge its readiness
marker under the existing Firestore rules. No rules change is required.

Find Friends' explicit Sync contacts action now saves only its matched active
accounts to the caller's saved contacts, preserving existing aliases. It does
not save unmatched device entries. Older read-only matchContacts callers retain
their behavior. Matches from a sync performed on an older app were temporary;
sync once again if those accounts are not already saved or direct-chat peers.

## Required rollout

Deploy the functions and backfill existing public profiles **before** installing
the new APK. A missing/old function or incomplete index is shown as a service
error, not an empty directory. The new index requires no third-party search
service and no manually configured composite index.

In the existing authenticated Cloud Shell checkout:

```bash
cd ~/offlinesms-production-release
git fetch origin main
git switch --detach FETCH_HEAD
nvm install 22
nvm use 22
export GOOGLE_CLOUD_QUOTA_PROJECT=offlinesms-prod-2027
npm ci
npx firebase deploy --project offlinesms-prod-2027 --only "functions:listAppContacts,functions:syncAppContactSearch,functions:matchContacts,functions:sendTextMessage,functions:getOrCreateDirectConversation"
node scripts/backfillAppContactSearch.mjs --project offlinesms-prod-2027 --write
```

Run each step only after the preceding step succeeds. Firebase's predeploy builds
Functions, which the backfill imports. The backfill uses Cloud Shell's application
default credentials and the explicit project argument. It logs counts, not user
details. Without `--write` it performs a dry run; rerunning `--write` is safe. It
marks search ready only after completing the traversal. Keep the trigger deployed
so later registrations and profile changes stay searchable.

The last two deployed callables are the prerequisites from 2.4.3; including them
also handles a production project that did not receive that earlier update.
Production function inventory increases from 97 to 98 exports.

Then build on Windows:

```powershell
cd D:\sms-production
git switch main
if ($LASTEXITCODE -ne 0) { throw "Switch failed" }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "Pull failed" }
cd apps\mobile
npm ci
if ($LASTEXITCODE -ne 0) { throw "Install failed" }
cd android
.\gradlew.bat assembleRelease
```

APK: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
Version: **2.4.5 (22)** in Expo and the checked-in Android project.

## Verification

Tests cover account ownership, saved-contact/direct-chat deduplication, stale
phone links, suspended/deleted/self profiles, partial-name and username matching,
Arabic normalization, pagination beyond 30 matches, sparse candidate pages,
out-of-order profile events, private-field exclusion, server-only index access,
the actual backfill script (dry run/write/rerun), explicit contact sync, screen
entry without typing, stale searches, retry and direct-chat opening.

After deployment, test with two accounts with different contact lists. Open
New chat and Contact attachment without typing, search a known username's middle
letters and an Arabic last name, open the selected conversation, and share a
contact card. The production database and a physical phone are not available in
the development environment; this device/deployment check must be done there.
