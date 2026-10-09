#!/usr/bin/env bash
# Builds one of a MATCHED PAIR of test APKs (docs/TEST_BUILDS.md):
#
#   scripts/test-builds/build.sh baseline <out-dir>   # pre-change code (2a61167) + identical instrumentation
#   scripts/test-builds/build.sh updated  <out-dir>   # this checkout
#
# Both: package app.offlinesms.mobile.test ("OfflineSMS Test", installs next to
# the store app), the same signing key, the same src/lib/perf.ts timing points
# (EXPO_PUBLIC_PERF_LOG=1), the same backend config, arm64-v8a + x86_64.
# versionCode baseline 900000 < updated 900000+N (N = commits since the
# baseline), so "updated" installs OVER "baseline" as an in-place upgrade (real
# local-DB migration v5 → v7), and a newer updated build over an older one.
#
# Backend: the caller exports EXPO_PUBLIC_FIREBASE_* (web config) and
# MOBILE_GOOGLE_SERVICES_JSON for the same Firebase project, or nothing for a
# placeholder (non-functional) build. Signing: android/keystore.properties in
# the checkout if present (CI writes it from secrets), else the debug key.
set -euo pipefail
VARIANT=${1:?baseline|updated}; OUT=${2:?out-dir}
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BASELINE_COMMIT=2a61167
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"

case "$VARIANT" in
  baseline)
    SRC="${BASELINE_DIR:-$REPO/../offlinesms-baseline}"
    if [ ! -d "$SRC/.git" ] && [ ! -f "$SRC/.git" ]; then
      git -C "$REPO" worktree add -f "$SRC" "$BASELINE_COMMIT" >/dev/null
      git -C "$SRC" apply "$REPO/scripts/test-builds/baseline-instrumentation.patch"
    fi
    # Instrumentation must be byte-identical to the updated build's.
    cmp "$SRC/apps/mobile/src/lib/perf.ts" "$REPO/apps/mobile/src/lib/perf.ts"
    # Same shipped dependencies as the updated build: every non-dev package in
    # the two lockfiles must resolve to the same version. Dev-only packages
    # (test tooling) never reach the APK, so they may differ.
    node -e '
      const fs = require("fs");
      const shipped = f => {
        const pk = JSON.parse(fs.readFileSync(f, "utf8")).packages || {};
        return Object.fromEntries(Object.entries(pk)
          .filter(([k, v]) => k && !v.dev && !v.devOptional)
          .map(([k, v]) => [k, v.version || v.resolved || ""]));
      };
      const [a, b] = process.argv.slice(1).map(shipped);
      const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);
      if (diff.length) {
        console.error("baseline and updated ship different dependencies:");
        for (const k of diff.slice(0, 20)) console.error("  " + k + ": " + (a[k] || "-") + " vs " + (b[k] || "-"));
        process.exit(1);
      }' "$SRC/apps/mobile/package-lock.json" "$REPO/apps/mobile/package-lock.json"
    # Install them inside the baseline checkout. A symlink to this checkout's
    # node_modules breaks JS bundling: its @offlinesms/design-tokens link then
    # resolves to THIS checkout's packages/, outside the baseline's Metro
    # watchFolders ("createBundleReleaseJsAndAssets FAILED").
    [ -L "$SRC/apps/mobile/node_modules" ] && rm "$SRC/apps/mobile/node_modules"
    [ -L "$SRC/node_modules" ] && rm "$SRC/node_modules"
    [ -d "$SRC/apps/mobile/node_modules" ] || npm --prefix "$SRC/apps/mobile" ci --no-audit --no-fund
    [ -f "$REPO/apps/mobile/android/keystore.properties" ] && cp "$REPO/apps/mobile/android/keystore.properties" "$SRC/apps/mobile/android/" || true
    VCODE=900000; SHA=$(git -C "$SRC" rev-parse --short=7 HEAD); VNAME="2.3.18-test-baseline-$SHA" ;;
  updated)
    # 900000 + commits since the baseline: always above the baseline, and a
    # later commit installs as an in-place upgrade over an earlier updated build.
    SRC="$REPO"; VCODE=$((900000 + $(git -C "$REPO" rev-list --count "$BASELINE_COMMIT..HEAD")))
    SHA=$(git -C "$REPO" rev-parse --short=7 HEAD); VNAME="2.3.18-test-$SHA" ;;
  *) echo "variant must be baseline or updated" >&2; exit 2 ;;
esac

BACKEND=placeholder
if [ -n "${MOBILE_GOOGLE_SERVICES_JSON:-}" ]; then BACKEND="${EXPO_PUBLIC_FIREBASE_PROJECT_ID:?web config missing}"; fi
if [ "$BACKEND" = placeholder ]; then
  export EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyDUMMY-NOT-A-REAL-KEY-000000000000
  export EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-offlinesms-ci.firebaseapp.com
  export EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-offlinesms-ci
  export EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-offlinesms-ci.appspot.com
  export EXPO_PUBLIC_FIREBASE_APP_ID=1:000000000000:android:0000000000000002
  export EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
fi
bash "$REPO/scripts/ci/mobile-google-services.sh" "$SRC"

cd "$SRC/apps/mobile/android"
# Gradle does not track env vars: drop the JS bundle so EXPO_PUBLIC_* are re-inlined.
rm -rf app/build/generated/assets/createBundleReleaseJsAndAssets app/build/generated/res/createBundleReleaseJsAndAssets
NODE_ENV=production EXPO_PUBLIC_PERF_LOG=1 ./gradlew assembleRelease \
  -Pofflinesms.testApp=true -Pofflinesms.versionCode="$VCODE" -Pofflinesms.versionName="$VNAME" \
  -PreactNativeArchitectures=arm64-v8a,x86_64 --no-daemon --console=plain ${GRADLE_ARGS:-}

NAME="offlinesms-test-$VARIANT-$SHA-$BACKEND.apk"
cp app/build/outputs/apk/release/app-release.apk "$OUT/$NAME"
( cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256" && cat "$NAME.sha256" )
echo "$OUT/$NAME"
