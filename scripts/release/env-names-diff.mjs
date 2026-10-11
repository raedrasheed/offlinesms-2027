#!/usr/bin/env node
// Compares two outputs of function-env-names.sh (before and after a deploy) and
// prints, by name, what changed in each function's environment variables and
// secrets. Names only: the inputs never hold values. A secret is compared with
// its version ("PHONE_HASH_PEPPER:1"), so a new version counts as a removal.
//   node scripts/release/env-names-diff.mjs [--forbid NAME,NAME] before.tsv after.tsv
// --forbid: names no function may carry after the deploy, new or existing.
// Platform-managed names (the ones firebase-tools refuses in a .env file, which
// the CLI or Cloud Functions set themselves, and LOG_EXECUTION_ID) are listed
// apart and never fail the check: FUNCTION_SIGNATURE_TYPE, for one, comes and
// goes between deploys of the same callable.
// Exit 0: nothing removed and nothing forbidden (additions and new functions,
//         with all their names, only print).
// Exit 1: a function, a variable name or a secret disappeared, or a forbidden
//         name is present after.
// Exit 2: bad arguments, an empty file, or a row that is not
//         "name<TAB>runtime<TAB>VAR,VAR<TAB>SECRET:version,...".
import { readFileSync } from 'node:fs';

const FN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const VAR = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET = /^[A-Za-z_][A-Za-z0-9_]*:[A-Za-z0-9_?-]+$/;
// firebase-tools 13.35.1 lib/functions/env.js RESERVED_KEYS and RESERVED_PREFIXES,
// plus LOG_EXECUTION_ID, which Cloud Functions adds to every 2nd gen function.
const PLATFORM_KEYS = new Set([
  'CLOUD_RUNTIME_CONFIG', 'EVENTARC_CLOUD_EVENT_SOURCE', 'ENTRY_POINT', 'GCP_PROJECT',
  'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FUNCTION_TRIGGER_TYPE', 'FUNCTION_NAME',
  'FUNCTION_MEMORY_MB', 'FUNCTION_TIMEOUT_SEC', 'FUNCTION_IDENTITY', 'FUNCTION_REGION',
  'FUNCTION_TARGET', 'FUNCTION_SIGNATURE_TYPE', 'K_SERVICE', 'K_REVISION', 'PORT',
  'K_CONFIGURATION', 'LOG_EXECUTION_ID',
]);
const PLATFORM_PREFIXES = ['X_GOOGLE_', 'FIREBASE_', 'EXT_'];
const isPlatform = n => PLATFORM_KEYS.has(n) || PLATFORM_PREFIXES.some(p => n.startsWith(p));

function invalid(msg) {
  console.error(`INVALID: ${msg}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const forbid = [];
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--forbid' || a.startsWith('--forbid=')) {
    const list = a === '--forbid' ? args[++i] : a.slice('--forbid='.length);
    if (!list) invalid('--forbid needs NAME[,NAME]');
    for (const n of list.split(',')) {
      if (!VAR.test(n)) invalid(`--forbid: not a variable name: "${n}"`);
      forbid.push(n);
    }
  } else if (a.startsWith('--')) {
    invalid(`unknown option ${a}`);
  } else {
    files.push(a);
  }
}
if (files.length !== 2) {
  console.error('usage: env-names-diff.mjs [--forbid NAME,NAME] <before.tsv> <after.tsv>');
  process.exit(2);
}

function load(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { invalid(`cannot read ${path}: ${e.message}`); }
  const fns = new Map();
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) return;
    const where = `${path}:${i + 1}`;
    const cols = line.split('\t');
    if (cols.length !== 4) invalid(`${where}: expected 4 tab-separated columns, found ${cols.length}`);
    const [name, runtime, env, secrets] = cols;
    if (!FN.test(name)) invalid(`${where}: not a function name: "${name}"`);
    if (!runtime.trim()) invalid(`${where}: no runtime`);
    if (fns.has(name)) invalid(`${where}: ${name} is listed twice`);
    const vars = env ? env.split(',') : [];
    const secs = secrets ? secrets.split(',') : [];
    for (const v of vars) if (!VAR.test(v)) invalid(`${where}: not a variable name: "${v}"`);
    for (const s of secs) if (!SECRET.test(s)) invalid(`${where}: not a SECRET:version entry: "${s}"`);
    fns.set(name, new Set([...vars, ...secs.map(s => `secret ${s}`)]));
  });
  if (fns.size === 0) invalid(`${path} lists no function`);
  return fns;
}

const before = load(files[0]);
const after = load(files[1]);
const added = new Map();   // name -> existing functions that gained it
const removed = [];        // "fn: name"
const platformAdded = new Map();
const platformRemoved = new Map();
const note = (map, n, fn) => map.set(n, [...(map.get(n) ?? []), fn]);
const newFns = [...after.keys()].filter(f => !before.has(f)).sort();
const goneFns = [...before.keys()].filter(f => !after.has(f)).sort();

for (const [fn, was] of before) {
  const now = after.get(fn);
  if (!now) continue;
  for (const n of was) if (!now.has(n)) isPlatform(n) ? note(platformRemoved, n, fn) : removed.push(`${fn}: ${n}`);
  for (const n of now) if (!was.has(n)) note(isPlatform(n) ? platformAdded : added, n, fn);
}
const forbidden = [];      // "fn: name", new and existing functions alike
for (const [fn, names] of after) for (const n of forbid) if (names.has(n)) forbidden.push(`${fn}: ${n}`);

const list = names => [...names].sort().join(',') || '(none)';
const out = [];
if (newFns.length) {
  out.push(`New functions (${newFns.length}), with all their names:`);
  for (const f of newFns) out.push(`  ${f}: ${list(after.get(f))}`);
}
if (added.size) {
  out.push('Names added to existing functions:');
  for (const [n, fns] of [...added].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`  ${n} on ${fns.length} function${fns.length === 1 ? '' : 's'}`);
  }
}
if (platformAdded.size || platformRemoved.size) {
  out.push('Platform-managed names changed (set by the Firebase CLI or Cloud Functions, not by .env; not counted):');
  for (const [n, fns] of [...platformAdded].sort(([a], [b]) => a.localeCompare(b))) out.push(`  + ${n} on ${fns.length} function${fns.length === 1 ? '' : 's'}`);
  for (const [n, fns] of [...platformRemoved].sort(([a], [b]) => a.localeCompare(b))) out.push(`  - ${n} from ${fns.length}: ${fns.sort().join(', ')}`);
}
if (goneFns.length) out.push(`Functions missing after (${goneFns.length}): ${goneFns.join(', ')}`);
if (removed.length) {
  out.push(`Names removed (${removed.length}):`);
  for (const r of removed.sort()) out.push(`  ${r}`);
}
if (forbid.length) {
  out.push(forbidden.length
    ? `Forbidden names present after (${forbidden.length}):\n${forbidden.sort().map(f => `  ${f}`).join('\n')}`
    : `Forbidden names (${forbid.join(', ')}): on no function`);
}
const ok = !goneFns.length && !removed.length && !forbidden.length;
out.push(ok
  ? `OK: no function, variable name or secret removed${forbid.length ? ', no forbidden name' : ''} (${before.size} before, ${after.size} after)`
  : 'FAIL: a function, variable name or secret is gone, or a forbidden name is present. Stop and send this output; change nothing.');
console.log(out.join('\n'));
process.exit(ok ? 0 : 1);
