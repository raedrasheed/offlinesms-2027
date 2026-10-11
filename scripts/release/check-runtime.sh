#!/usr/bin/env bash
# Checks that a project runs exactly the functions of this source
# (scripts/release/expected-functions.mjs, 94 today), each on the expected
# runtime (default nodejs22, the functions/package.json engines). Read-only.
# Fails, and lists the names, when a function is missing, when a deployed
# function is not exported by this source, when a name is deployed twice, or
# when any function runs on another runtime:
#   bash scripts/release/check-runtime.sh offlinesms-staging-2027 [nodejs22]
set -euo pipefail
PROJECT=${1:?project id}; WANT=${2:-nodejs22}
DIR=$(dirname "$0")
export LC_ALL=C
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

node "$DIR/expected-functions.mjs" | awk 'NF' | sort -u > "$T/expected"
[ -s "$T/expected" ] || { echo "No expected functions"; exit 1; }
bash "$DIR/function-env-names.sh" "$PROJECT" > "$T/listed"
cut -f1,2 "$T/listed" | awk 'NF' | sort > "$T/deployed"
cut -f1 "$T/deployed" > "$T/names"

comm -23 "$T/expected" <(uniq "$T/names") > "$T/missing"
comm -13 "$T/expected" <(uniq "$T/names") > "$T/extra"
uniq -d "$T/names" > "$T/twice"
awk -F'\t' -v want="$WANT" '$2 != want' "$T/deployed" > "$T/runtime"

count() { wc -l < "$1" | tr -d ' '; }
FAIL=0
show() {
  [ -s "$2" ] || return 0
  echo "$1 ($(count "$2")):"; sed 's/^/  /' "$2"; FAIL=1
}
show "Missing in $PROJECT" "$T/missing"
show "Deployed in $PROJECT but not exported by this source" "$T/extra"
show "Deployed more than once" "$T/twice"
show "Not on $WANT" "$T/runtime"

if [ "$FAIL" -ne 0 ]; then
  echo "FAIL: $PROJECT does not run exactly the $(count "$T/expected") functions of this source on $WANT"
  exit 1
fi
echo "OK: $PROJECT runs exactly the $(count "$T/expected") functions of this source, all on $WANT"
