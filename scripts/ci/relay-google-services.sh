#!/usr/bin/env bash
# Writes a NON-PRODUCTION placeholder google-services.json for CI/local builds
# of the relay app (the real file is gitignored). It points at a fake project:
# the build compiles and packages, but the app cannot reach any real backend.
set -euo pipefail
OUT="$(cd "$(dirname "$0")/../.." && pwd)/apps/mobile-relay/app/google-services.json"
if [ -f "$OUT" ] && ! grep -q '"demo-offlinesms-ci"' "$OUT"; then
  echo "Refusing to overwrite an existing non-placeholder google-services.json" >&2; exit 1
fi
cat > "$OUT" <<'JSON'
{
  "project_info": { "project_number": "000000000000", "project_id": "demo-offlinesms-ci", "storage_bucket": "demo-offlinesms-ci.appspot.com" },
  "client": [{
    "client_info": { "mobilesdk_app_id": "1:000000000000:android:0000000000000000", "android_client_info": { "package_name": "app.offlinesms.business" } },
    "oauth_client": [],
    "api_key": [{ "current_key": "AIzaSyDUMMY-NOT-A-REAL-KEY-000000000000" }],
    "services": { "appinvite_service": { "other_platform_oauth_client": [] } }
  }],
  "configuration_version": "1"
}
JSON
echo "wrote placeholder $OUT"
