#!/usr/bin/env node
// Compares two outputs of function-env-names.sh (before and after a deploy) and
// prints, by name, what changed in each function's environment variables and
// secrets. Names only: the inputs never hold values. A secret is compared with
// its version ("PHONE_HASH_PEPPER:1"), so a new version counts as a removal.
//   node scripts/release/env-names-diff.mjs [--forbid NAME,NAME] before.tsv after.tsv
// --forbid: names no function may carry after the deploy, new or existing.
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
const newFns = [...after.keys()].filter(f => !before.has(f)).sort();
const goneFns = [...before.keys()].filter(f => !after.has(f)).sort();

for (const [fn, was] of before) {
  const now = after.get(fn);
  if (!now) continue;
  for (const n of was) if (!now.has(n)) removed.push(`${fn}: ${n}`);
  for (const n of now) if (!was.has(n)) added.set(n, [...(added.get(n) ?? []), fn]);
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
