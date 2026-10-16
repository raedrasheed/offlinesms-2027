# OfflineSMS attachments — 2.4.2 (19)

## Delivered

The chat attachment sheet now offers Photos, Camera, Video, File, Location, Contact, Poll, Audio and GIF. Existing stickers and voice recording remain available through their existing composer controls.

| Attachment | Behaviour | Limit |
| --- | --- | --- |
| Photos / camera / GIF | Preview, caption, local optimistic bubble, persistent outgoing copy; GIF picked from device files without recompression | 10 MiB |
| Video | Device picker, preview, caption; download and native controls on demand | 25 MiB |
| Documents | PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV and ZIP; filename/size card; system Open/Share/Save dialog | 25 MiB |
| Audio file | M4A/AAC, MP3, WAV and OGG; on-demand download and shared single-instance audio player | 25 MiB |
| Location | One foreground position fix or manually entered coordinates; optional place label; opens maps | Static location only |
| Contact | Native picker or manual entry; review/edit fields before send; call/email and system save-contact form | 5 phone numbers and 5 email addresses |
| Poll / voice note | Existing poll and recording features retained | Existing limits |

ZIP files are transferred as files and never extracted. Codec support for video/audio depends on the device. GIF search through external providers and continuous live location are not included.

## Delivery and performance

- Contact/location payloads use the existing local SQLite outbox and server send-permission checks.
- Media metadata and filenames survive realtime sync, historical paging and app restart.
- New photos/files are copied out of the picker cache before being queued.
- Text/control messages and binary uploads have separate, single-flight outbox lanes; large uploads do not block the text-send worker. Physical network bandwidth remains shared.
- New document/audio/video cards do not prefetch their binaries or mount video decoders on conversation open.
- Media reservations use deterministic, sender-scoped IDs, so concurrent retries return the same reservation. Interrupted sends attempt finalization before another upload. Explicit retry handles pending/failed/dead outbox entries and resolves remote IDs back to the local queue entry.
- Forwarded binaries receive their own object and token in the target conversation, so source retention does not remove the forwarded copy. Retention recognizes file/audio/video types.

## Server checks

Reservation checks membership, active group membership, blocked direct chats, disabled/locked groups and admin-only send settings. Finalization rechecks permission, actual object size/MIME and a format signature before publishing a server-generated download URL. File signatures are a format check, **not malware scanning**. Binary objects cannot be overwritten through client Storage rules. Rules tie the path, sender, MIME and size to the message reservation; raw SDK reads require active membership and completed upload (the sender can inspect a pending upload).

The app retains the existing Firebase token URL download model. Anyone holding a download token URL can use it; this change is not end-to-end encryption or token revocation on group removal.

## Deployment order

Deploy backend functions and Storage rules before installing the new mobile build. The source change does not deploy Firebase or publish a store build by itself.

```powershell
cd D:\sms-production
npm ci
npm --workspace functions run build
npx firebase-tools deploy --project offlinesms-prod-2027 --only "functions:sendTextMessage,functions:deleteMessage,functions:createMediaMessage,functions:finalizeMediaMessage,functions:forwardMessages,functions:onMessageCreate,functions:onMessageCreateNotify,functions:onMessageMediaReadyNotify,functions:purgeRetainedMessages,storage"
```

The retention policy is unchanged; only recognition of the new binary types changes.

Then rebuild the existing Android native project; no clean prebuild is required:

```powershell
cd D:\sms-production\apps\mobile
npm ci
cd android
.\gradlew.bat assembleRelease
```

APK output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
Expo app version and checked-in Android Gradle version both read **2.4.2**, build **19**. iOS requires a new native build because DocumentPicker, Location and Sharing were added; the foreground location usage description is included in app.json. The project remains on Expo SDK 53.

## Verification

Validation completed locally: 1,118 unit tests, 6 Firebase handler integration tests, 3 Storage rules tests; functions build, mobile TypeScript, Arabic/English key parity, and Android/iOS Metro-Hermes exports. No signed APK/IPA was produced in this environment.

Automated coverage includes payload validation, invalid coordinates, bounded contact fields, MIME/extension/signature mismatches, local SQLite roundtrips and reconciliation, media retry, independent text queue selection, concurrent server reservation retries, finalization, forwarding copies, and Storage membership/path/size/overwrite rules.

Before store distribution, run on a physical Android/iOS device: select and cancel each picker; deny permissions; send each type in a direct chat and group; send while offline then reconnect; restart during a transfer; open cached files offline; forward a file; verify Arabic/English, keyboard layout and RTL. Native pickers, location fixes, codecs and OS contact/share screens require device testing.

## References

- Expo DocumentPicker: https://docs.expo.dev/versions/latest/sdk/document-picker/
- Expo Contacts: https://docs.expo.dev/versions/latest/sdk/contacts/
- Expo Location: https://docs.expo.dev/versions/latest/sdk/location/
- Expo Sharing: https://docs.expo.dev/versions/latest/sdk/sharing/
- Firebase Storage rules reference: https://firebase.google.com/docs/reference/security/storage/
- OWASP file-upload checks: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

Native API signatures and compatible dependency versions were checked against the installed Expo SDK 53 packages, rather than applying the latest SDK's APIs to this older project.
