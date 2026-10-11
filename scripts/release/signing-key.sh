#!/usr/bin/env bash
# Writes the production signing key for one app and its keystore.properties
# (.github/workflows/release-android.yml), after checking that the key's
# certificate is exactly the expected one. Gradle signs release builds with
# keystore.properties when it exists; the certificate check here and the
# signature check after the build (verify-build.sh) mean a debug or test key can
# never pass. Prints no passwords.
#   scripts/release/signing-key.sh <path of keystore.properties to write>
set -euo pipefail
OUT=${1:?keystore.properties path}
: "${RUNNER_TEMP:?}" "${KS_BASE64:?}" "${KS_PASSWORD:?}" "${KS_ALIAS:?}" "${KEY_PASSWORD:?}" "${EXPECTED_CERT_HEX:?}" "${TEST_CERT:?}"

KS="$RUNNER_TEMP/release.keystore"
umask 077
printf '%s' "$KS_BASE64" | base64 -d > "$KS"
keytool -list -keystore "$KS" -storepass:env KS_PASSWORD -alias "$KS_ALIAS" > /dev/null 2>&1 || {
  echo "::error::the keystore does not open with its password, or has no key under the alias in the *_KEY_ALIAS secret"; exit 1; }
CERT=$(keytool -exportcert -keystore "$KS" -storepass:env KS_PASSWORD -alias "$KS_ALIAS" | sha256sum | cut -d' ' -f1)
[ "$CERT" != "$TEST_CERT" ] || { echo "::error::the keystore holds the repository's public test key"; exit 1; }
[ "$CERT" = "$EXPECTED_CERT_HEX" ] || { echo "::error::the keystore's certificate is $CERT, not the expected $EXPECTED_CERT_HEX"; exit 1; }

# Java properties: escape backslashes and a leading space so any password survives.
node -e '
  const esc = v => v.replace(/\\/g, "\\\\").replace(/^ /, "\\ ");
  const [out, ks] = process.argv.slice(1);
  const e = process.env;
  require("fs").writeFileSync(out, [
    `RELEASE_STORE_FILE=${esc(ks)}`,
    `RELEASE_STORE_PASSWORD=${esc(e.KS_PASSWORD)}`,
    `RELEASE_KEY_ALIAS=${esc(e.KS_ALIAS)}`,
    `RELEASE_KEY_PASSWORD=${esc(e.KEY_PASSWORD)}`,
  ].join("\n") + "\n", { mode: 0o600 });
' "$OUT" "$KS"
echo "signing key: certificate $CERT (expected), keystore.properties written"
