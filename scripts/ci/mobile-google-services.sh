#!/usr/bin/env bash
# Writes the NON-PRODUCTION placeholder google-services.json the main mobile
# app's Android build needs (the real file is gitignored), unless a real one
# is supplied via $MOBILE_GOOGLE_SERVICES_JSON (e.g. a staging project's file
# from a CI secret). The placeholder points at a fake project: the APK builds,
# installs and opens, but cannot reach any backend (no sign-in, no push).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)/apps/mobile"
for OUT in "$ROOT/google-services.json" "$ROOT/android/app/google-services.json"; do
  if [ -f "$OUT" ] && ! grep -q '"demo-offlinesms-ci"' "$OUT"; then
    echo "Refusing to overwrite an existing non-placeholder $OUT" >&2; exit 1
  fi
  if [ -n "${MOBILE_GOOGLE_SERVICES_JSON:-}" ]; then
    if grep -q '"offlinesms-prod-2027"' <<<"$MOBILE_GOOGLE_SERVICES_JSON"; then
      echo "Refusing to build a test APK against the production project" >&2; exit 1
    fi
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
  }],
  "configuration_version": "1"
}
JSON
  echo "wrote placeholder $OUT"
done
