#!/usr/bin/env bash
# Checks that every deployed function of a project runs on the expected
# runtime (default nodejs22, the functions/package.json engines), and prints
# each function that does not. Read-only.
#   bash scripts/release/check-runtime.sh offlinesms-staging-2027 [nodejs22]
set -euo pipefail
PROJECT=${1:?project id}; WANT=${2:-nodejs22}
LIST=$(bash "$(dirname "$0")/function-env-names.sh" "$PROJECT" | cut -f1,2)
TOTAL=$(grep -c . <<<"$LIST" || true)
[ "$TOTAL" -gt 0 ] || { echo "No functions listed for $PROJECT"; exit 1; }
BAD=$(awk -F'\t' -v want="$WANT" '$2 != want' <<<"$LIST")
if [ -n "$BAD" ]; then
  echo "Not on $WANT in $PROJECT:"; echo "$BAD"
  echo "$(grep -c . <<<"$BAD") of $TOTAL functions are not on $WANT"; exit 1
fi
echo "All $TOTAL functions in $PROJECT run on $WANT"
