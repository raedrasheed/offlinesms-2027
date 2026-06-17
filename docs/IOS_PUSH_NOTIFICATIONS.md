# iOS Push Notifications — Setup, Operations & QA

End-to-end push for iOS via APNs, added alongside the existing Android FCM path
**without changing Android delivery**. iOS notifications only work on a **real
device** with the APNs key configured — never in the iOS Simulator or Expo Go.

## Architecture (why two transports)

The app uses the Firebase **web JS SDK** (not react-native-firebase), so it can't
mint a native FCM token on iOS. Transport is therefore provider-aware:

| Platform | Mobile token source | `provider` | Backend transport |
| --- | --- | --- | --- |
| Android | `getDevicePushTokenAsync()` → native FCM token | `fcm` | firebase-admin FCM (**unchanged**) |
| iOS | `getExpoPushTokenAsync({ projectId })` → Expo push token | `expo` | Expo Push API (`exp.host`) → APNs |

One device doc per device at `users/{uid}/devices/{deviceId}`:

```
deviceId, pushToken, provider ('fcm'|'expo'), fcmToken (FCM only / legacy),
platform, appVersion, buildVersion, locale, timezone, enabled,
createdAt, updatedAt, lastSeenAt, disabledAt?, disabledReason?
```

Backend resolves the transport per device with `resolveDeviceToken()`
(`functions/src/notifications/deviceToken.ts`): explicit `provider`, else an
Expo-shaped token → Expo, else FCM (covers legacy Android docs that only have
`fcmToken`). Registration is **idempotent** (same `deviceId` → merge, never a
duplicate); token rotation updates the same row; logout disables **only this
device**.

## iOS notification flow

1. After auth + onboarding, `registerForPush(uid)` requests permission
   (`alert + sound + badge`), then acquires an **Expo push token** and writes the
   device doc. Permission denied / undetermined → no-op (Settings offers a path).
   Simulator / non-physical device → token acquisition throws, swallowed with a
   dev-only log; no user-facing error.
2. A new message/reaction/broadcast triggers the backend, which builds the
   payload, sends iOS tokens through the Expo Push API and Android tokens through
   FCM, and disables dead tokens.
3. Foreground: banner suppressed only for the chat currently open; otherwise
   shown. Background/quit: APNs shows the system notification.
4. Tap routing (`App.tsx` + `pushRouting.ts`) handles 1:1 chat, group chat,
   group-join requests, and admin broadcasts (open chat/group/url/app).
   Cold-start taps are de-duplicated by notification identifier so the app never
   double-navigates.

## Backend payload summary

`sendPushToUser(uid, content)` (`send.ts`) — message + reaction triggers:
- **FCM (Android):** `notification.{title,body}` + `data`, `android.priority`
  high/normal, collapse key per conversation, `apns.aps.sound`.
- **Expo (iOS):** `{ to, title, body, data, sound: 'default'|null,
  priority: 'high'|'default', channelId:'messages' }`. Silent (muted / sound-off)
  → `sound: null` but the banner still shows.

`sendNotificationBroadcast` (`broadcasts.ts`) — admin broadcasts: same split,
dedupe by token, per-device delivery records (`status` sent/invalid_token/failed,
`provider`, masked token), live progress counters, and dead-token disabling.

Invalid/expired tokens are disabled (`enabled:false`, `disabledReason`): FCM via
`messaging/registration-token-not-registered` etc.; Expo via the
`DeviceNotRegistered` ticket error. Transient Expo/HTTP errors (429/5xx/network)
are **not** treated as token death, so tokens survive to the next send.

## Credentials & config required OUTSIDE the repo

None of these are committed. Configure them in the respective consoles:

1. **Apple Developer — APNs Auth Key (.p8)**
   - Apple Developer → Certificates, IDs & Profiles → Keys → create a key with
     **Apple Push Notifications service (APNs)** enabled. Download the `.p8`
     (one-time), note the **Key ID** and **Team ID**.
   - App ID `app.offlinesms.mobile` must have the **Push Notifications**
     capability enabled.
2. **EAS credentials (Expo push delivery)**
   - `eas credentials` (iOS) → upload/let EAS manage the APNs key. Expo's push
     service uses it to deliver to APNs for our ExpoPushTokens. EAS also injects
     the `aps-environment` entitlement at build time.
   - The EAS `projectId` is already in `app.json` → `extra.eas.projectId`
     (`getExpoPushTokenAsync` requires it).
3. **Firebase APNs key (only if Android-style direct FCM-to-iOS is ever added)**
   - Not used today (iOS goes through Expo). If you later switch iOS to direct
     FCM, upload the same `.p8` under Firebase Console → Project Settings →
     Cloud Messaging → Apple app configuration, and add react-native-firebase.
4. **Real device requirement** — APNs tokens are not issued on the Simulator;
   test on a physical iPhone with a development/ad-hoc/TestFlight build.

`app.json` already sets: `ios.bundleIdentifier = app.offlinesms.mobile`,
`ios.entitlements["aps-environment"] = "production"`,
`ios.infoPlist.UIBackgroundModes = ["remote-notification"]`, and the
`expo-notifications` plugin. Keep the bundle id identical across Apple, Firebase,
and EAS.

## Troubleshooting checklist

| Symptom | Likely cause / fix |
| --- | --- |
| **Permission denied** | User declined. `getStatus('notifications')` → `denied`; show the in-app path to iOS Settings → OfflineSMS → Notifications. We never auto-re-prompt. |
| **No APNs entitlement** | Build missing `aps-environment`. Confirm `ios.entitlements` in `app.json` and that EAS credentials include the APNs key; rebuild. |
| **No token on device** | Running on Simulator/Expo Go, or missing `projectId`. Use a real device + dev/TestFlight build; verify `extra.eas.projectId`. Check the dev `[push]` logs. |
| **Invalid token** | Backend disables it (`DeviceNotRegistered` / FCM not-registered). App re-registers on next launch; old row stays `enabled:false`. |
| **Notification received but tap doesn't navigate** | `data` missing a target (`conversationId`/`type`/`actionType`). Verify the trigger's `data` payload and `routeFromNotification` / `dispatchForRoute`. |
| **Works on Android, not iOS** | iOS token not Expo, or APNs key not uploaded to EAS, or testing on Simulator. Confirm device doc `provider:'expo'` + `pushToken` starts with `ExponentPushToken[`, and EAS has the APNs key. |
| **Duplicate navigation on cold start** | Should not happen — taps dedupe by identifier in `App.tsx`. If it recurs, confirm the listener isn't mounted twice. |

## Manual QA checklist (real iOS device)

- [ ] Fresh install → after onboarding, iOS permission prompt shows alert+sound+badge.
- [ ] Grant → `users/{uid}/devices/{deviceId}` has `provider:'expo'`, `pushToken` = `ExponentPushToken[…]`, `enabled:true`.
- [ ] Send a 1:1 message from another account → banner with sound while backgrounded.
- [ ] Tap it (app backgrounded) → opens the right Conversation.
- [ ] Kill the app, send again, tap → cold-starts into the right Conversation (no double-nav).
- [ ] Open the chat (foreground) → no banner for that chat; a different chat's message still banners.
- [ ] Group message → group title + "Sender: preview".
- [ ] Mute a chat → message delivers silently (no sound), banner still appears.
- [ ] Disable notifications in app settings (`notificationSettings.enabled=false`) → no push.
- [ ] Deny OS permission → no crash, no error toast; Settings path works.
- [ ] Two iOS devices, same account → both receive.
- [ ] Android + iOS, same account → both receive; two distinct device docs, correct providers.
- [ ] Log out on one iOS device → that device doc `enabled:false`; other devices still receive.
- [ ] Admin broadcast to a mixed audience → iOS + Android both get it; delivery records show per-device `provider` + status.
- [ ] Uninstall an iOS device → next send disables that token (`DeviceNotRegistered`).

## Verification (this change)

- Unit tests: `npm run test` → **566 passing**, incl. new `deviceToken` (10),
  `expoPushLogic` (6), `expoPush` (5, fetch-mocked transport), mobile
  `pushTokens` (6); existing `notifyLogic`/`broadcastLogic`/`pushRouting` green.
- Typecheck: functions ✅ · mobile ✅. i18n parity ✅.
- No emulator integration harness exists for functions, so `sendPushToUser` /
  broadcast Firestore wiring is covered by pure logic + the mocked Expo
  transport rather than full end-to-end tests (see the manual QA list).

## Security

No secrets in the repo: no `.p8`, no Firebase service account, no provisioning
profiles/keys. Expo push needs no server secret for sending to ExpoPushTokens
(delivery auth is the APNs key held by EAS). Tokens are stored per device and
masked in delivery logs.
