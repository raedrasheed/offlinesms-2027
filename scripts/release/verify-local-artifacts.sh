#!/usr/bin/env bash
# Runs the production build checks (verify-build.sh: package, versions against
# this checkout, not debuggable, exactly one signer equal to the expected
# certificate and never the test key, the Firebase values inside the APK, 16 KB
# pages) on Android files built OUTSIDE GitHub Actions, e.g. on the owner's
# computer with his own signing files. Only the signed files and public
# fingerprints come here; no keystore or password is needed.
#
#   scripts/release/verify-local-artifacts.sh user-app <apk> <aab> <google-services.json> <expected-cert-sha256>
#   scripts/release/verify-local-artifacts.sh relay    <apk>       <google-services.json> <expected-cert-sha256>
#
# Run from a clean checkout of the commit the files were built from: versions
# are compared with this checkout's source. user-app also needs the production
# web config in EXPO_PUBLIC_FIREBASE_* (checked against the app's JS bundle).
# Needs ANDROID_HOME with build-tools $BT (default 36.0.0), java, unzip, node.
# Writes dist/ and dist/BUILD-INFO.txt.
set -euo pipefail
TARGET=${1:?user-app|relay}; shift
case "$TARGET" in
  user-app) APK=${1:?apk}; AAB=${2:?aab}; GS=${3:?google-services.json}; CERT=${4:?expected certificate}
            export PKG=app.offlinesms.mobile; WEB=--web-config-env ;;
  relay)    APK=${1:?apk}; AAB=""; GS=${2:?google-services.json}; CERT=${3:?expected certificate}
            export PKG=app.offlinesms.business; WEB="" ;;
  *) echo "target must be user-app or relay" >&2; exit 2 ;;
esac
export PROD=offlinesms-prod-2027
export TEST_CERT=fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
export BT=${BT:-36.0.0}
: "${ANDROID_HOME:?}"

HEX=$(printf '%s' "$CERT" | tr -d ': \n' | tr 'A-F' 'a-f')
[[ "$HEX" =~ ^[0-9a-f]{64}$ ]] || { echo "the expected certificate is not a SHA-256 fingerprint" >&2; exit 1; }
[ "$HEX" != "$TEST_CERT" ] || { echo "the expected certificate is the repository's public test key" >&2; exit 1; }
export EXPECTED_CERT_HEX=$HEX

[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "the checkout has local changes; verify from a clean checkout" >&2; exit 1; }
export GITHUB_SHA; GITHUB_SHA=$(git rev-parse HEAD)
export RUNNER_TEMP; RUNNER_TEMP=$(mktemp -d)
trap 'rm -rf "$RUNNER_TEMP"' EXIT
if [ "$TARGET" = user-app ]; then
  [ "${EXPO_PUBLIC_FIREBASE_PROJECT_ID:-}" = "$PROD" ] || { echo "export the production web config (EXPO_PUBLIC_FIREBASE_*) first" >&2; exit 1; }
fi

mkdir -p dist
bash "$(dirname "$0")/verify-build.sh" "$APK" "$AAB" "$GS" $WEB
