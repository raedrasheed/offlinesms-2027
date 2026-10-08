#!/usr/bin/env bash
# Wire-level callable tests: real HTTP requests to the functions running in the
# Functions emulator (framework token verification included), backed by the
# Firestore + Auth emulators. Test-only env/secret files are written for the
# run and removed afterwards; they never contain production values.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
npm --prefix functions run build >/dev/null
ENV_FILE=functions/.env.local
SECRET_FILE=functions/.secret.local
cleanup() { rm -f "$ENV_FILE" "$SECRET_FILE"; }
trap cleanup EXIT
printf 'PHONE_AUTH_ENABLED=true\nPHONE_LINK_ENABLED=true\nEMAIL_PROVIDER=console\n' > "$ENV_FILE"
printf 'PHONE_HASH_PEPPER=callable-test-pepper-0123456789abcdef0123456789\n' > "$SECRET_FILE"
npx firebase emulators:exec --project demo-offlinesms --only functions,firestore,auth \
  "npx vitest run --config vitest.callable.config.ts"
