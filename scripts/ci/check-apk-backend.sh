#!/usr/bin/env bash
# Checks, from a built APK itself, which Firebase project it talks to:
#   - resources.arsc holds google-services.json's values (project id, bucket,
#     app id), which the native Firebase SDK uses (FCM; the relay's callables);
#   - assets/index.android.bundle (main app only) holds the inlined
#     EXPO_PUBLIC_FIREBASE_* web config the JS SDK uses (Auth, Firestore,
#     callables).
# Each part present must name the expected project, and must name neither the
# CI placeholder project nor, unless production is expected, production.
#
#   scripts/ci/check-apk-backend.sh <apk> <expected-project-id>
set -euo pipefail
APK="${1:?apk}"; EXPECTED="${2:?expected project id}"
PROD=offlinesms-prod-2027
PLACEHOLDER=demo-offlinesms-ci
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

fail=0; checked=()
check_part() { # <zip entry> <label>
  local entry="$1" label="$2" f="$TMP/part"
  unzip -p "$APK" "$entry" > "$f" 2>/dev/null || return 1
  if ! grep -a -q -F "$EXPECTED" "$f"; then echo "$label does not name $EXPECTED" >&2; fail=1; fi
  if grep -a -q -F "$PLACEHOLDER" "$f"; then echo "$label names the placeholder project $PLACEHOLDER" >&2; fail=1; fi
  if [ "$EXPECTED" != "$PROD" ] && grep -a -q -F "$PROD" "$f"; then echo "$label names the production project" >&2; fail=1; fi
  checked+=("$label")
}

check_part resources.arsc "Android resources (google-services.json)" || { echo "$APK has no resources.arsc" >&2; exit 1; }
if unzip -l "$APK" assets/index.android.bundle > /dev/null 2>&1; then
  check_part assets/index.android.bundle "JS bundle (EXPO_PUBLIC_FIREBASE_*)"
fi
[ "$fail" = 0 ] || exit 1
( IFS=';'; echo "$(basename "$APK") talks to $EXPECTED: checked ${checked[*]}" )
