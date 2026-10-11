#!/usr/bin/env bash
# Checks one production build and writes it to dist/ with BUILD-INFO.txt
# (.github/workflows/release-android.yml):
#   - package name exactly $PKG, versionCode/versionName equal to the source, not debuggable;
#   - APK (and AAB) signed by exactly the expected certificate, never the test key;
#   - the Firebase values inside the APK are exactly offlinesms-prod-2027's
#     (scripts/ci/check-apk-backend.mjs; with --web-config-env also the JS config);
#   - 16 KB page size: ELF segments of the 64-bit libraries, APK zip alignment,
#     and the AAB's BundleConfig and generated splits (scripts/release/check-16kb.sh).
#   scripts/release/verify-build.sh <apk> <aab or ""> <google-services.json> [--web-config-env]
set -euo pipefail
APK=${1:?apk}; AAB=${2-}; GS=${3:?google-services.json}; WEB=${4:-}
: "${PKG:?}" "${PROD:?}" "${BT:?}" "${EXPECTED_CERT_HEX:?}" "${TEST_CERT:?}" "${GITHUB_SHA:?}"
TOOLS="$ANDROID_HOME/build-tools/$BT"
fail() { echo "::error::$*"; exit 1; }

BADGING=$("$TOOLS/aapt2" dump badging "$APK")
LINE=$(head -1 <<<"$BADGING")
NAME=$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"$LINE")
VCODE=$(sed -n "s/.* versionCode='\([0-9]*\)'.*/\1/p" <<<"$LINE")
VNAME=$(sed -n "s/.* versionName='\([^']*\)'.*/\1/p" <<<"$LINE")
[ "$NAME" = "$PKG" ] || fail "package is $NAME, not $PKG"
grep -q "application-debuggable" <<<"$BADGING" && fail "the APK is debuggable"
case "$PKG" in
  app.offlinesms.mobile)
    SRC_CODE=$(sed -n 's/^ *versionCode \([0-9]*\)$/\1/p' apps/mobile/android/app/build.gradle)
    SRC_NAME=$(sed -n 's/^ *versionName "\(.*\)"$/\1/p' apps/mobile/android/app/build.gradle) ;;
  app.offlinesms.business)
    SRC_CODE=$(sed -n 's/^ *versionCode = \([0-9]*\)$/\1/p' apps/mobile-relay/app/build.gradle.kts)
    SRC_NAME=$(sed -n 's/^ *versionName = "\(.*\)"$/\1/p' apps/mobile-relay/app/build.gradle.kts) ;;
  *) fail "unknown package $PKG" ;;
esac
[ "$VCODE" = "$SRC_CODE" ] && [ "$VNAME" = "$SRC_NAME" ] || fail "version $VNAME ($VCODE) differs from the source $SRC_NAME ($SRC_CODE)"

"$TOOLS/apksigner" verify --verbose --print-certs "$APK" > "$RUNNER_TEMP/apk-certs.txt" || fail "apksigner refused the APK"
SIGNERS=$(grep -c "certificate SHA-256 digest" "$RUNNER_TEMP/apk-certs.txt" || true)
[ "$SIGNERS" = 1 ] || fail "the APK has $SIGNERS signers, expected exactly 1"
APK_CERT=$(sed -n 's/.*certificate SHA-256 digest: \([0-9a-f]*\).*/\1/p' "$RUNNER_TEMP/apk-certs.txt")
[ "$APK_CERT" != "$TEST_CERT" ] || fail "the APK is signed with the repository's test key"
[ "$APK_CERT" = "$EXPECTED_CERT_HEX" ] || fail "the APK is signed by $APK_CERT, not the expected $EXPECTED_CERT_HEX"
SCHEMES=$(grep -E "^Verified using v[0-9.]+ scheme.*: true" "$RUNNER_TEMP/apk-certs.txt" | sed 's/^Verified using //' | tr '\n' ' ')

AAB_CERT=""
if [ -n "$AAB" ]; then
  AAB_CERT=$(keytool -printcert -jarfile "$AAB" | sed -n 's/^[[:space:]]*SHA256: //p' | tr -d ':' | tr 'A-F' 'a-f')
  [ "$(wc -l <<<"$AAB_CERT")" = 1 ] && [ -n "$AAB_CERT" ] || fail "the AAB must have exactly one signer"
  [ "$AAB_CERT" = "$EXPECTED_CERT_HEX" ] || fail "the AAB is signed by $AAB_CERT, not the expected $EXPECTED_CERT_HEX"
fi

ARGS=(--apk "$APK" --project "$PROD" --google-services "$GS" --package "$PKG")
[ "$WEB" = --web-config-env ] && ARGS+=(--web-config-env)
node scripts/ci/check-apk-backend.mjs "${ARGS[@]}"

bash scripts/release/check-16kb.sh "$APK" ${AAB:+"$AAB"} | tee "$RUNNER_TEMP/16kb.txt" || fail "16 KB page size check failed"

BASE="offlinesms-${PKG##*.}-$VNAME-$VCODE-prod-${GITHUB_SHA:0:7}"
[ "$PKG" = app.offlinesms.mobile ] && BASE="offlinesms-$VNAME-$VCODE-prod-${GITHUB_SHA:0:7}"
cp "$APK" "dist/$BASE.apk"
[ -n "$AAB" ] && cp "$AAB" "dist/$BASE.aab"
{
  echo "Package: $PKG"
  echo "Version: $VNAME (versionCode $VCODE)"
  echo "Firebase project: $PROD ($([ "$WEB" = --web-config-env ] && echo 'native and JS config' || echo 'native config') checked inside the APK)"
  echo "Commit: $GITHUB_SHA"
  if [ -n "${GITHUB_RUN_ID:-}" ]; then
    echo "Run: ${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/$GITHUB_RUN_ID (attempt ${GITHUB_RUN_ATTEMPT:-1})"
  else
    echo "Built outside GitHub Actions; checked by scripts/release/verify-local-artifacts.sh against this commit's source"
  fi
  echo "Signing certificate SHA-256 (APK): $APK_CERT"
  [ -n "$AAB_CERT" ] && echo "Signing certificate SHA-256 (AAB): $AAB_CERT"
  echo "Expected certificate SHA-256: $EXPECTED_CERT_HEX"
  echo "Signature schemes: $SCHEMES"
  echo "16 KB page size (scripts/release/check-16kb.sh):"
  sed 's/^/  /' "$RUNNER_TEMP/16kb.txt"
  echo "$LINE"
  ( cd dist && sha256sum "$BASE".* )
} | tee "dist/$BASE-BUILD-INFO.txt"
cp "dist/$BASE-BUILD-INFO.txt" dist/BUILD-INFO.txt
