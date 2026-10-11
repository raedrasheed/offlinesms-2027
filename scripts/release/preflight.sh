#!/usr/bin/env bash
# Production release preflight (.github/workflows/release-android.yml). Refuses
# to build unless the run is on the default branch at the reviewed commit, every
# production setting is present, the web config is the production project's, and
# the expected certificate is a real SHA-256 that is not the repository's test key.
# Prints setting names only, never values.
set -euo pipefail
: "${PROD:?}" "${TEST_CERT:?}" "${GITHUB_SHA:?}" "${GITHUB_REF:?}" "${GITHUB_EVENT_PATH:?}"

COMMIT=$(printf '%s' "${COMMIT:-}" | tr 'A-F' 'a-f')
[[ "$COMMIT" =~ ^[0-9a-f]{7,40}$ ]] || { echo "::error::input commit must be 7-40 hex characters"; exit 1; }
[[ "$GITHUB_SHA" == "$COMMIT"* ]] || { echo "::error::this run is at $GITHUB_SHA, not the reviewed commit $COMMIT"; exit 1; }

DEFAULT=$(node -e 'console.log(require(process.argv[1]).repository?.default_branch ?? "")' "$GITHUB_EVENT_PATH")
[ -n "$DEFAULT" ] && [ "$GITHUB_REF" = "refs/heads/$DEFAULT" ] || {
  echo "::error::production builds run only from the default branch ($DEFAULT), not $GITHUB_REF"; exit 1; }

missing=()
for n in MOBILE_GOOGLE_SERVICES_JSON EXPO_PUBLIC_FIREBASE_API_KEY EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN \
         EXPO_PUBLIC_FIREBASE_PROJECT_ID EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET EXPO_PUBLIC_FIREBASE_APP_ID \
         EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID EXPECTED_CERT KS_BASE64 KS_PASSWORD KS_ALIAS KEY_PASSWORD; do
  [ -n "${!n:-}" ] || missing+=("$n")
done
if [ ${#missing[@]} -gt 0 ]; then
  # Name the GitHub settings, not the job's variable names.
  case "${PKG:-}" in app.offlinesms.business) KEY=RELAY_RELEASE ;; *) KEY=MOBILE_UPLOAD ;; esac
  names=()
  for n in "${missing[@]}"; do
    case "$n" in
      MOBILE_GOOGLE_SERVICES_JSON) names+=("secret PROD_GOOGLE_SERVICES_JSON") ;;
      EXPO_PUBLIC_FIREBASE_*) names+=("variable PROD_${n#EXPO_PUBLIC_}") ;;
      EXPECTED_CERT) names+=("variable ${KEY}_CERT_SHA256") ;;
      KS_BASE64) names+=("secret ${KEY}_KEYSTORE_BASE64") ;;
      KS_PASSWORD) names+=("secret ${KEY}_KEYSTORE_PASSWORD") ;;
      KS_ALIAS) names+=("secret ${KEY}_KEY_ALIAS") ;;
      KEY_PASSWORD) names+=("secret ${KEY}_KEY_PASSWORD") ;;
    esac
  done
  printf '::error::missing in the GitHub environment "production": %s\n' "$(IFS=,; echo "${names[*]}" | sed 's/,/, /g')"
  exit 1
fi
[ "$EXPO_PUBLIC_FIREBASE_PROJECT_ID" = "$PROD" ] || { echo "::error::PROD_FIREBASE_PROJECT_ID is not $PROD"; exit 1; }

HEX=$(printf '%s' "$EXPECTED_CERT" | tr -d ': \n' | tr 'A-F' 'a-f')
[[ "$HEX" =~ ^[0-9a-f]{64}$ ]] || { echo "::error::the expected certificate is not a SHA-256 fingerprint"; exit 1; }
[ "$HEX" != "$TEST_CERT" ] || { echo "::error::the expected certificate is the repository's public test key"; exit 1; }
echo "EXPECTED_CERT_HEX=$HEX" >> "$GITHUB_ENV"
echo "preflight: $GITHUB_SHA on $DEFAULT, production settings present, expected certificate $HEX"
