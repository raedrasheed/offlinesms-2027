#!/usr/bin/env bash
# Writes google-services.json for an Android build of the main mobile app.
#
#   scripts/ci/mobile-google-services.sh [repo-root-of-the-build]   (default: this repo)
#
# • $MOBILE_GOOGLE_SERVICES_JSON set → that file is used (a Firebase project's
#   google-services.json). It MUST contain an Android client for the TEST
#   package app.offlinesms.mobile.test — test builds install next to the store
#   app under that id. A file for the production project is accepted only
#   when MOBILE_TEST_ALLOW_PRODUCTION_BACKEND=true (explicit owner decision,
#   see docs/TEST_BUILDS.md §2): technically it works, but test devices then
#   use real production accounts and data.
# • otherwise → a NON-PRODUCTION placeholder (fake project): the APK builds,
#   installs and opens, but cannot sign in or receive push.
# Never overwrites a real file it did not write.
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}/apps/mobile"
PROD=offlinesms-prod-2027
TEST_PKG=app.offlinesms.mobile.test

if [ -n "${MOBILE_GOOGLE_SERVICES_JSON:-}" ]; then
  if ! grep -q "\"$TEST_PKG\"" <<<"$MOBILE_GOOGLE_SERVICES_JSON"; then
    echo "google-services.json has no Android client for $TEST_PKG." >&2
    echo "Firebase console → Project settings → Your apps → Add app → Android → package $TEST_PKG," >&2
    echo "then download google-services.json again and update the MOBILE_GOOGLE_SERVICES_JSON secret." >&2
    exit 1
  fi
  if grep -q "\"$PROD\"" <<<"$MOBILE_GOOGLE_SERVICES_JSON" && [ "${MOBILE_TEST_ALLOW_PRODUCTION_BACKEND:-}" != "true" ]; then
    echo "Refusing the production project ($PROD) without MOBILE_TEST_ALLOW_PRODUCTION_BACKEND=true." >&2
    exit 1
  fi
fi

for OUT in "$ROOT/google-services.json" "$ROOT/android/app/google-services.json"; do
  if [ -f "$OUT" ] && ! grep -q '"demo-offlinesms-ci"' "$OUT" && [ -z "${MOBILE_GOOGLE_SERVICES_JSON:-}" ]; then
    echo "Refusing to overwrite an existing non-placeholder $OUT" >&2; exit 1
  fi
  if [ -n "${MOBILE_GOOGLE_SERVICES_JSON:-}" ]; then
    printf '%s' "$MOBILE_GOOGLE_SERVICES_JSON" > "$OUT"
    echo "wrote supplied google-services.json → $OUT"
    continue
  fi
  cat > "$OUT" <<'JSON'
{
  "project_info": { "project_number": "000000000000", "project_id": "demo-offlinesms-ci", "storage_bucket": "demo-offlinesms-ci.appspot.com" },
  "client": [{
    "client_info": { "mobilesdk_app_id": "1:000000000000:android:0000000000000001", "android_client_info": { "package_name": "app.offlinesms.mobile" } },
    "oauth_client": [],
    "api_key": [{ "current_key": "AIzaSyDUMMY-NOT-A-REAL-KEY-000000000000" }],
    "services": { "appinvite_service": { "other_platform_oauth_client": [] } }
  }, {
    "client_info": { "mobilesdk_app_id": "1:000000000000:android:0000000000000002", "android_client_info": { "package_name": "app.offlinesms.mobile.test" } },
    "oauth_client": [],
    "api_key": [{ "current_key": "AIzaSyDUMMY-NOT-A-REAL-KEY-000000000000" }],
    "services": { "appinvite_service": { "other_platform_oauth_client": [] } }
  }],
  "configuration_version": "1"
}
JSON
  echo "wrote placeholder $OUT"
done
