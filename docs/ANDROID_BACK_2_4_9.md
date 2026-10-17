# Android system Back — 2.4.9 (26)

## Cause and fix

The app targets Android 16 / API 36 (`android/build.gradle`) but uses React
Native 0.79.6. That version's `ReactActivity.onBackPressed` dispatches the
JavaScript `hardwareBackPress` event, and its native `Modal` listens for
`KEYCODE_BACK`. Android 16 stops dispatching those legacy callbacks by default
for apps targeting API 36. The project's manifest did not opt out. This is a
concrete compatibility defect; the reported phones' Android versions were not
provided, and no physical-phone reproduction was available here.

Set `android:enableOnBackInvokedCallback="false"` on the application, using the
compatibility path documented by Android. This preserves React Navigation 6's
existing Back listener and native Modal `onRequestClose` handlers. It also
preserves keyboard dismissal and the existing root-activity background behavior.
No duplicate global JavaScript listener or manual native key dispatch is added.

The Expo config plugin `plugins/withAndroidBackCompatibility.js` reapplies the
setting after prebuild. Revisit this temporary opt-out when upgrading React
Native to a version that supports the modern system Back APIs throughout its
Activity and Modal implementations. Predictive system animations are disabled;
the Back button and completed back gesture remain usable.

## Expected behavior

- A native modal (attachments, poll, contact picker, sticker preview/editor,
  video viewer) handles Back through its own existing close callback. The
  sticker editor still asks before discarding changes.
- In a conversation, Back closes the inline emoji/sticker panel first, without
  focusing the keyboard. Another press returns to the previous screen.
- Only the focused conversation can consume that panel-dismiss event. Closing,
  blurring or unmounting removes the subscription.
- Ordinary screens use the existing navigator's Back handling. Tabs now use
  visited-tab history (`backBehavior="history"`), then return to the root's
  normal background/exit behavior when history is exhausted.

## Regression checks

- Focus/blur/unmount and platform tests use the installed navigation library's
  real `useFocusEffect`; they check first-press dismissal, subsequent delegation,
  and that an inactive screen cannot swallow Back.
- Native-modal callback tests cover closing a poll without submitting and
  confirming discard of an edited sticker.
- Expo config introspection confirms the generated manifest keeps the opt-out.
- `scripts/ci/check-android-back.mjs` reads the **built APK** using `aapt2`. It
  rejects a missing/true application setting or a MainActivity override. Both
  comparison builds and the production mobile release run this check.
- The baseline comparison overlay carries the same native compatibility flag;
  existing dependency/instrumentation parity guards are retained.

These automated checks do not simulate a physical Android system back gesture.
On Android 16 and an older Android device, test both button and gesture modes:
Settings → Privacy → Back; Chats → Conversation → Back; keyboard dismissal;
emoji panel then conversation; attachment/poll/editor dismissal; visited tabs;
and returning to the app after Back at the root. Use a newly installed APK.

## Build and install (PowerShell)

This fix changes the native manifest and requires a new APK. It does not require
a Firebase Functions deployment. If the preceding sticker release has not been
deployed, its separate backend instructions still apply:
[CUSTOM_STICKERS_2_4_8.md](CUSTOM_STICKERS_2_4_8.md).

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
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
```

APK: `D:\sms-production\apps\mobile\android\app\build\outputs\apk\release\app-release.apk`.
Version: **2.4.9 (26)**.

## Primary references

- [Android 16 behavior changes: predictive Back migration or opt-out](https://developer.android.com/about/versions/16/behavior-changes-16#predictive-back)
- [Android predictive Back compatibility flag](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture#opt-out)
- [React Native 0.79 BackHandler and Modal event precedence](https://reactnative.dev/docs/0.79/backhandler)
- [React Navigation 6 focused Back handlers](https://reactnavigation.org/docs/6.x/custom-android-back-button-handling/)
- [React Navigation 6 bottom-tab Back behavior](https://reactnavigation.org/docs/6.x/bottom-tab-navigator/#backbehavior)
