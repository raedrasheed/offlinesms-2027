# OfflineSMS account cards — 2.4.3 (20)

The chat attachment **Contact** now selects a registered OfflineSMS user. It opens
a searchable, paginated in-app directory, then a preview and explicit Send action.
It does not invoke the phone address book or request contacts permission.

Received cards have a **Message** action that opens the shared user's direct chat
using the existing getOrCreateDirectConversation callable. Existing chats are
reused; the source conversation stays on the back stack. A card for the signed-in
user is labelled as their own profile and does not create a self-chat.

Cards store the stable account uid, public display-name/username snapshot and
empty legacy phone/email arrays. The server verifies that the selected profile
exists and is active, resolves the real public name, and discards caller-supplied
phone/email details. The card uid survives the SQLite outbox, reconciliation and
forwarding. Old phone/email cards remain readable. Older app versions need an
update to use the in-app Message action on new cards.

The authenticated directory callable uses a field-limited server query, so even
legacy user documents with phone/email/PIN fields cannot expose those fields to
the picker. The card renders the verified name snapshot without reading a full
profile document. Opening a card also checks the target account is still active.

Search uses existing public Firestore indexes: display-name prefixes (entered,
lower-case and title-case variants) and normalized username prefixes. It is not
full-text or arbitrary case-insensitive name search. Empty search pages through
all public profiles in bounded batches; loaded results are sorted by name. No
private profiles, phone numbers or emails are queried.

## Deployment

Deploy the three affected callables **before** installing the new mobile build. The old
callable rejects account cards that have no phone/email. No Storage/Firestore
rule change or database migration is needed.

From the updated checkout in Cloud Shell, using Node.js 22 and the existing
production environment file:

```sh
npm ci
npm --workspace functions run build
npx firebase deploy --project offlinesms-prod-2027 --only "functions:listAppContacts,functions:sendTextMessage,functions:getOrCreateDirectConversation"
```

Then, from an updated Windows checkout:

```powershell
cd D:\sms-production\apps\mobile
npm ci
cd android
.\gradlew.bat assembleRelease
```

APK: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
Version: **2.4.3 (20)** in Expo and the checked-in Android project.

## Verification

Regression coverage checks explicit selection/preview/send without address-book
access, stale search-response isolation, repeated taps, self-cards and missing
accounts. SQLite tests cover queued and reconciled account identity. Emulator
tests cover canonical server names, no private-field sharing, missing/suspended
accounts, send permissions, forwarding, direct-chat reuse and idempotent retries.

On a phone, send a third user's card between two updated accounts, tap Message,
and verify the correct direct conversation opens. Also check Arabic/English,
search pagination, cancellation and sending while offline after selecting a user.
