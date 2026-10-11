#!/usr/bin/env bash
# 16 KB page size checks for an Android build (Codex R6-2;
# https://developer.android.com/guide/practices/page-sizes). Zip alignment of
# one APK alone does not prove compatibility, so every layer is checked:
#   1. APK: every LOAD segment of every 64-bit library is 16 KB aligned (ELF),
#      and the uncompressed libraries are 16 KB zip-aligned (zipalign -P 16).
#   2. AAB (what Play receives): the same ELF check on the bundle's libraries;
#      its BundleConfig keeps native libraries uncompressed with
#      PAGE_ALIGNMENT_16K (or 64K); and the split APKs bundletool generates
#      from it for arm64-v8a and x86_64 devices are 16 KB zip-aligned and pass
#      the ELF check. Locally built splits came out 16 KB aligned even from a
#      bundle without the setting, so the BundleConfig check is what shows
#      Play will align them; the split check is a second line.
#
#   scripts/release/check-16kb.sh <apk> [<aab>]
#
# Needs: $ANDROID_HOME/build-tools/$BT/zipalign (35+ for -P), java, unzip, node.
# bundletool is downloaded at a pinned version and SHA-256 (or BUNDLETOOL_JAR).
set -euo pipefail
APK=${1:?apk}; AAB=${2-}
: "${BT:?build-tools version}"
ZIPALIGN="$ANDROID_HOME/build-tools/$BT/zipalign"
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fail() { echo "::error::$*"; exit 1; }
libs64() { unzip -Z1 "$1" | grep -E '(^|/)lib/(arm64-v8a|x86_64)/[^/]+\.so$' || true; }

# 1. The APK
node "$HERE/check-elf-alignment.mjs" "$APK"
if [ -n "$(libs64 "$APK")" ]; then
  "$ZIPALIGN" -c -P 16 -v 4 "$APK" > "$WORK/zipalign.txt" || { tail -20 "$WORK/zipalign.txt"; fail "$(basename "$APK"): native libraries are not 16 KB zip-aligned"; }
  echo "$(basename "$APK"): 16 KB zip alignment verified"
fi
[ -n "$AAB" ] || exit 0

# 2a. The bundle's libraries
node "$HERE/check-elf-alignment.mjs" "$AAB"
if [ -z "$(libs64 "$AAB")" ]; then echo "$(basename "$AAB"): no 64-bit native libraries"; exit 0; fi

# 2b. Bundle configuration
BUNDLETOOL_VERSION=1.17.2
BUNDLETOOL_SHA256=2d4ad908faea64047c1cc9cb747e6aa667c6ab192e09607bd16b67246a8cd6ae
JAR=${BUNDLETOOL_JAR:-"$WORK/bundletool.jar"}
if [ -z "${BUNDLETOOL_JAR:-}" ]; then
  curl -fsSL -o "$JAR" "https://github.com/google/bundletool/releases/download/$BUNDLETOOL_VERSION/bundletool-all-$BUNDLETOOL_VERSION.jar"
fi
echo "$BUNDLETOOL_SHA256  $JAR" | sha256sum -c --quiet - || fail "bundletool checksum mismatch"
java -jar "$JAR" dump config --bundle "$AAB" > "$WORK/config.json"
node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const u = c.optimizations?.uncompressNativeLibraries ?? {};
  if (u.enabled !== true) { console.error("::error::BundleConfig: native libraries are not kept uncompressed"); process.exit(1); }
  if (!["PAGE_ALIGNMENT_16K", "PAGE_ALIGNMENT_64K"].includes(u.alignment)) {
    console.error(`::error::BundleConfig: native library alignment is ${u.alignment ?? "unspecified (4 KB)"}, needs PAGE_ALIGNMENT_16K`); process.exit(1);
  }
  console.log(`BundleConfig: uncompressed native libraries, ${u.alignment}`);
' "$WORK/config.json"

# 2c. The split APKs Play serves to 64-bit devices
for ABI in arm64-v8a x86_64; do
  printf '{"supportedAbis":["%s"],"supportedLocales":["en"],"screenDensity":420,"sdkVersion":35}' "$ABI" > "$WORK/$ABI.json"
  java -jar "$JAR" build-apks --bundle "$AAB" --output "$WORK/$ABI.apks" --device-spec "$WORK/$ABI.json" > "$WORK/$ABI.log" 2>&1 \
    || { tail -20 "$WORK/$ABI.log"; fail "bundletool could not build the $ABI APKs"; }
  mkdir -p "$WORK/$ABI"
  unzip -q -o "$WORK/$ABI.apks" -d "$WORK/$ABI"
  found=0
  while IFS= read -r split; do
    [ -n "$(libs64 "$split")" ] || continue
    found=1
    "$ZIPALIGN" -c -P 16 -v 4 "$split" > "$WORK/zipalign.txt" || { tail -20 "$WORK/zipalign.txt"; fail "$ABI split $(basename "$split") is not 16 KB zip-aligned"; }
    node "$HERE/check-elf-alignment.mjs" "$split" > /dev/null
  done < <(find "$WORK/$ABI" -name '*.apk')
  if [ "$found" = 1 ]; then
    echo "Play split APKs for $ABI: 16 KB zip alignment and ELF segments verified"
  elif [ -n "$(libs64 "$AAB" | grep "/lib/$ABI/" || true)" ]; then
    fail "bundletool produced no $ABI APK with the bundle's $ABI libraries"
  else
    echo "Play split APKs for $ABI: the bundle has no $ABI libraries"
  fi
done
