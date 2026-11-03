# OfflineSMS 2.4.12 (build 29)

This release fixes received media rendering/completion, opens phone-only SMS conversations, adds native sticker cutouts, fixes contact input contrast, and requires each invited user to accept group membership.

## Behavior

- New group creation enrolls only the creator. Registered targets get private `users/{uid}/groupInvitations/{conversationId}` records. Adding a member does the same. The recipient sees invitations in Chats and can accept or decline; pushes open that screen without fetching private group messages.
- Acceptance atomically checks the active inviter, blocks and capacity, then creates membership. Repeated acceptance is idempotent. Pending/declined invitations are not resent. Existing memberships remain intact. Joining voluntarily through an invite link still represents consent; admin approval of those user-initiated requests continues to work.
- Phone contacts who register later receive invitations, never automatic membership. Acceptance retires matching external rows to avoid duplicate SMS/counts.
- New Chat → Use a phone number creates a conversation with one external recipient. New Group also accepts phone contacts. No extra registered member is necessary. SMS cost, delivery coverage and sending controls still apply; creating the conversation does not itself send SMS.
- Received photos fall back to the full image when there is no thumbnail/cache. Opening a chat completes cached media placeholders without overwriting live edits. Stale upload snapshots cannot revert finalized media to pending. Video playback can stream if disk caching fails, with retry on playback failure.
- New stickers automatically use on-device subject segmentation, keep the original for reversible editing, and export PNG. Background removal can be toggled. A failure disables saving the supposed cutout; the user can retry or explicitly use the original.

## Rollout

Deploy the rules and backend before distributing the new mobile build. Older apps cannot display recipient invitations; their add-member calls will now send invitations. Recipients need the new app to accept them.

From the repository root, with the correct Firebase production account:

```powershell
npm ci
npm --workspace functions run build
firebase deploy --project offlinesms-prod-2027 --only "firestore:rules,functions:createGroup,functions:addMembers,functions:addExternalContactToGroup,functions:linkPhoneContactsOnUserWrite,functions:respondToGroupInvitation,functions:notifyGroupInvitation"
npm --prefix apps/mobile ci
cd apps/mobile
npx eas build --profile production --platform all
```

This is a native build change: `@six33/react-native-bg-removal@1.3.4` is autolinked into Android/iOS. A JavaScript update alone cannot install it. Native cutouts require a real iOS 17+ device or Android with Google Play services; Android may need to download the segmentation model on first use. Older iOS versions and unsupported devices show the retry/original choice. Images are not uploaded to an external cutout service.

The existing fixed review login is preserved. Its production restoration/configuration remains a separate step described by the review-account restoration script.

## Verification

Validation completed: 1281 unit/component/SQLite tests, 20 emulator integration tests, and 15 Firestore/Storage rules tests passed. Functions build, mobile TypeScript, Arabic/English key parity, Android native autolinking discovery, and Expo Android/iOS JavaScript bundle export passed.

Automated coverage includes recipient-only invitation access, blocked/declined/duplicate acceptance, inactive inviter/capacity checks, phone registration without enrollment, one-external-recipient SMS preview, image URL fallback, finalized media cache reconciliation, group image/video cards, sticker failure recovery, and notification routing.

Before submitting to stores, use two real accounts on iOS/Android to verify: group photo/video send, receive, reopen and playback; SMS to one non-app recipient; contact name entry in light/dark device modes; a cutout's transparent edges over both light and dark chat wallpapers; push → invitation → accept/decline. Native segmentation quality and actual carrier delivery require device/production testing. No production Firebase deployment or signed native build was performed by the coding session.

Native model references: [Google subject segmentation](https://developers.google.com/ml-kit/vision/subject-segmentation/android) and [background-removal module](https://github.com/SIX33-Software/f2-background-remover). The Android manifest requests install-time model download; first-use download may still be necessary.
