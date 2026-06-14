# OfflineSMS — 16 KB Page Size Upgrade (Expo SDK 51 → 53)

> **Goal:** clear the Google Play "Your app does not support 16 KB memory page
> sizes" error for the consumer app (`apps/mobile`, package
> `app.offlinesms.mobile`).
>
> **Owner:** mobile release lead · **Estimated effort:** 1–2 focused days plus
> at least one EAS build cycle to verify.

---

## 0. Status — DONE (upgrade executed on branch `claude/laughing-knuth-lx1kr9`)

The upgrade in sections 1–9 has been **implemented**. Summary of what changed and
how it was verified:

**Versions:** `expo@53.0.27`, `react-native@0.79.6`, `react@19.0.0`,
`react-dom@19.0.0`, `@types/react@~19.0.10`, `typescript@~5.8.3`, plus all
`expo-*` / `react-native-*` deps realigned to SDK 53 via `expo install --fix`.
New Architecture is **disabled** (`newArchEnabled=false` in both `app.json` and
`android/gradle.properties`).

**Monorepo / React-major isolation (the key decision):** the dashboard is on
React 18 (Next 14) and mobile is now on React 19. npm's single-root hoisting
cannot host two React majors without cross-contaminating one app's hoisted deps
(e.g. `recharts` binding to the wrong React types, or `@expo/cli` failing to
resolve `expo`). To resolve this cleanly **`apps/mobile` was removed from the npm
workspaces and is installed standalone** (it has its own `package-lock.json`), so
its Expo/React 19 tree is fully self-contained. The dashboard and the rest of the
monorepo keep React 18 and were not modified. Consequences:
- `apps/mobile/package.json` references `@offlinesms/design-tokens` via
  `file:../../packages/design-tokens` (it can no longer be a workspace symlink).
- `metro.config.js` adds `packages/design-tokens` to `watchFolders` and pins
  `resolver.nodeModulesPaths` to the app's own `node_modules`.
- CI installs and typechecks the mobile app in a separate step.

**Code fixes for RN 0.79 / React 19 / SDK 53:**
- `@expo/vector-icons`, `expo-font`, `expo-asset` added as direct deps (they were
  previously relied on transitively; the standalone tree needs them declared —
  `expo-av` has an undeclared `expo-asset` import).
- `src/lib/notifications.ts`: `setNotificationHandler` migrated from the removed
  `shouldShowAlert` to `shouldShowBanner` / `shouldShowList`.

**Native project:** `android/` was regenerated with `expo prebuild` for SDK 53
(Gradle 8.13, NDK r27, `com.android.tools.build:gradle` 8.8.2, `expo.useLegacyPackaging=false`).
The production keystore signing block (`keystore.properties` with debug fallback)
and `keystore.properties.example` were re-applied after the regenerate.

**Verification performed locally:**
- `apps/mobile` typecheck: **pass** · `apps/dashboard` typecheck: **pass**
- `expo-doctor`: 17/18 (only the expected "committed native folders + app.json"
  advisory, inherent to this non-CNG project).
- **Production AAB built** (`./gradlew :app:bundleRelease`, arm64-v8a) → `BUILD SUCCESSFUL`.
- **16 KB alignment verified**: every 64-bit `.so` (arm64-v8a + x86_64; 36 libs
  incl. `libhermes`, `libreactnative`, `libreanimated`, `libworklets`,
  `libexpo-modules-core`, `librnscreens`) has LOAD-segment alignment `0x4000`
  (16384), checked with the NDK's `llvm-readelf -l` (the same check
  `check_elf_alignment.sh` performs).

**Still required to fully close the Play error (cannot be done from this repo):**
build the production AAB on EAS with the real keystore + `google-services.json`,
upload to the Play Console internal track, and confirm the 16 KB error is gone
before promoting (requirement: do not merge to `main` until Play accepts it).

---

## 1. Why this is required

Since **1 November 2025**, every app/update on Google Play that targets Android
15 (API 35) or higher must support **16 KB memory page sizes** on 64-bit
devices. The check fails when any bundled native library (`.so`) has its ELF
`LOAD` segments aligned to the old **4 KB** boundary instead of **16 KB**.

Our app is **Expo SDK 51 / React Native 0.74.5**. The offending `.so` files
(Hermes, Fresco, React Native core, Reanimated, the `expo-*` modules, etc.) are
**prebuilt** and shipped inside those package versions with 4 KB alignment.

> **There is no config-only fix on SDK 51.** Gradle / AGP / NDK flags only
> change alignment for code *we* compile — they cannot re-align prebuilt `.so`
> files. The alignment is fixed when the upstream packages are rebuilt, which
> happened in **React Native 0.76+ / 0.77+** and is fully settled in **RN 0.79
> (Expo SDK 53)**. The fix is therefore an SDK upgrade.

**Decision (this plan):** upgrade to **Expo SDK 53** and keep the **New
Architecture disabled** (lowest-risk path; still fully 16 KB-compliant).

---

## 2. Target version matrix

Expo SDK 53 ships **React Native 0.79** and **React 19**. Do **not** hand-pin
every patch version below — let `expo install --fix` resolve the exact patches
for SDK 53. The table is a reference for the major jumps to expect.

| Package | Now (SDK 51) | Target (SDK 53) |
| --- | --- | --- |
| `expo` | `~51.0.0` | `~53.0.0` |
| `react-native` | `0.74.5` | `0.79.x` |
| `react` / `react-dom` | `18.2.0` | `19.0.0` |
| `react-native-reanimated` | `~3.10.1` | `~3.17.x` |
| `react-native-gesture-handler` | `~2.16.1` | `~2.24.x` |
| `react-native-screens` | `3.34.0` | `~4.11.x` |
| `react-native-safe-area-context` | `4.10.5` | `~5.4.x` |
| `react-native-svg` | `15.2.0` | `~15.11.x` |
| `@react-native-async-storage/async-storage` | `1.23.1` | `~2.1.x` |
| `@react-native-community/netinfo` | `11.3.1` | `~11.4.x` |
| `react-native-web` | `~0.19.10` | `~0.20.x` |
| `expo-*` modules (av, camera, contacts, crypto, file-system, haptics, image-picker, linking, localization, notifications, secure-store, sqlite, status-bar) | SDK 51 lines | SDK 53 lines (via `expo install --fix`) |
| `@react-navigation/*` | v6 | v6 should run on RN 0.79/React 19; if you hit React-19 peer/runtime issues, move to v7 |
| `typescript` (dev) | `~5.3.3` | `~5.8.x` |
| `@types/react` (dev) | `~18.2.79` | `~19.0.x` |

> Two intermediate SDKs (52) are being skipped. Expo's upgrade tooling supports
> this, but read **both** the SDK 52 and SDK 53 changelogs for breaking changes
> that land across the jump.

---

## 3. Pre-flight

- [ ] Branch off `main`; do the upgrade in isolation (it touches `package-lock.json` heavily).
- [ ] Record the rollback point: `git rev-parse HEAD` and the current EAS build/version code.
- [ ] Confirm `eas.json` still has `appVersionSource: "remote"` + `autoIncrement: true` (it does) so the next build gets a fresh version code.
- [ ] Make sure `apps/mobile/google-services.json` and `apps/mobile/android/keystore.properties` are present in the EAS build environment (they're gitignored).
- [ ] Note: the native `android/` and `ios/` folders are committed (continuous native generation). If they were `prebuild`-generated, plan to regenerate them in step 5.

---

## 4. Upgrade the JS/native dependencies

Run from `apps/mobile`:

```bash
# 1. Move Expo itself to SDK 53
npx expo install expo@^53.0.0

# 2. Let Expo align every other dependency to the SDK 53 versions
npx expo install --fix

# 3. Bump dev types/tooling that expo install won't touch
npm install -D @types/react@^19 typescript@~5.8
```

Then sanity-check the workspace install from the repo root (this is a monorepo
with `package-lock.json` at the root):

```bash
npm install
npx expo-doctor          # run inside apps/mobile
```

Resolve every `expo-doctor` finding before moving on.

---

## 5. Reconcile native config — **disable New Architecture**

SDK 53 enables the New Architecture **by default**, so we must explicitly opt
out. Today the flags are inconsistent (`app.json` says `true`, gradle says
`false`); make both say **false**.

- [ ] `apps/mobile/app.json` → set `"newArchEnabled": false`.
- [ ] `apps/mobile/android/gradle.properties` → keep `newArchEnabled=false`.
- [ ] If the native projects are CNG/prebuild-generated, regenerate them so the
      SDK 53 templates (AGP, NDK r27, edge-to-edge, DayNight theme) are applied:

  ```bash
  npx expo prebuild --clean --platform android
  ```

  If you intentionally maintain the committed `android/` folder by hand instead,
  manually apply the SDK 53 template changes (don't run `--clean`).

- [ ] Confirm packaging stays uncompressed/aligned: `expo.useLegacyPackaging=false`
      in `gradle.properties` (already set) and no `useLegacyPackaging true`
      override leaks in via `app/build.gradle`.

---

## 6. Code changes to expect (RN 0.79 / React 19)

Search the `apps/mobile/src` tree and fix as needed:

- [ ] **`package.json` exports enforced** — deep imports like
      `react-native/Libraries/...` may break. Use public entry points or the new
      nested paths from the RN 0.79 notes.
- [ ] **React 19** — stricter types, removed legacy APIs (e.g. string refs,
      legacy context, `defaultProps` on function components). Run `npm run typecheck`
      and fix fallout.
- [ ] **Reanimated 3.17** — review any worklet/strict-mode warnings.
- [ ] **react-native-screens 4.x** — major bump; verify navigation transitions
      and any `enableScreens`/header customizations.
- [ ] **Edge-to-edge + DayNight theme** — SDK 53 Android defaults to edge-to-edge
      layout; check that screens respect safe-area insets and that the status/nav
      bar styling still looks right.
- [ ] **Notifications** — re-verify `expo-notifications` on the SDK 53 line
      (Phase 27 FCM path); Android notification behavior changed across SDKs.

Gates that must pass locally before building:

```bash
npm run typecheck        # apps/mobile
npm run i18n:check
```

---

## 7. Build and verify on EAS

The 16 KB alignment can only be confirmed against a real `app-bundle` build — it
cannot be validated in this repo/CI.

```bash
# from apps/mobile
npm run build:android     # eas build --profile production --platform android
```

Then verify the produced artifact is 16 KB-aligned **before** uploading:

1. **From the AAB/APK directly** — extract and check each `.so`:
   ```bash
   # Android NDK ships this helper; -P 16 asserts 16 KB page alignment
   zipalign -c -v -P 16 4 app-release.apk
   ```
   Or use the NDK `check_elf_alignment.sh` script against the extracted
   `lib/arm64-v8a/*.so` files — every file must report `ALIGNED (16384)`.

2. **Android Studio** → *Build > Analyze APK…* → open `lib/arm64-v8a/` and
   confirm there are no 4 KB-aligned warnings.

3. Re-upload to the Play Console **internal** track and confirm the
   "16 KB memory page sizes" error is gone in *Releases > Review*.

> If a stray library is still flagged (early SDK 53 patches had a couple of
> `expo-*` libs unaligned), update to the **latest SDK 53 patch** of that module
> and rebuild.

---

## 8. Rollback

- [ ] The upgrade lives entirely on its branch — abandoning it is `git checkout main`.
- [ ] No Play submission until an EAS build is verified 16 KB-aligned in step 7,
      so production is never exposed to an unverified bundle.
- [ ] Keep the last known-good APK/AAB and its version code noted (pre-flight) in
      case you need to halt and re-promote the previous release.

---

## 9. Cross-references

- Release process: [`OFFLINESMS_RELEASE_CHECKLIST.md`](./OFFLINESMS_RELEASE_CHECKLIST.md)
- Rollback runbook: [`OFFLINESMS_ROLLBACK_RUNBOOK.md`](./OFFLINESMS_ROLLBACK_RUNBOOK.md)
- Android 16 KB guide: <https://developer.android.com/guide/practices/page-sizes>
- Expo SDK 53 changelog: <https://expo.dev/changelog/sdk-53>
</content>
</invoke>
