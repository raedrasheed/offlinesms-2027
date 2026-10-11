#!/usr/bin/env bash
# Lists every deployed function of a project with its runtime and the NAMES of
# its environment variables and secrets — never their values — so the
# configuration before and after each deploy stage can be compared
# (docs/PRODUCTION_RELEASE.md §2):
#   bash scripts/release/function-env-names.sh offlinesms-prod-2027 > functions-before.tsv
set -euo pipefail
PROJECT=${1:?project id}
gcloud functions list --project "$PROJECT" --format=json | jq -r '
  .[] | [
    (.name | split("/") | last),
    (.buildConfig.runtime // .runtime // "?"),
    ((.serviceConfig.environmentVariables // .environmentVariables // {}) | keys | sort | join(",")),
    ((.serviceConfig.secretEnvironmentVariables // .secretEnvironmentVariables // []) | map(.key + ":" + (.version // "?")) | sort | join(","))
  ] | @tsv' | sort
