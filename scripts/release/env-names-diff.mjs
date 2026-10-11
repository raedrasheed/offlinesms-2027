#!/usr/bin/env node
// Compares two outputs of function-env-names.sh (before and after a deploy) and
// prints, by name, what changed in each function's environment variables and
// secrets. Names only: the inputs never hold values. A secret is compared with
// its version ("PHONE_HASH_PEPPER:1"), so a new version counts as a removal.
//   node scripts/release/env-names-diff.mjs before.tsv after.tsv
// Exit 0 when nothing was removed (additions and new functions only print).
// Exit 1 when a function, a variable name or a secret disappeared.
import { readFileSync } from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('usage: env-names-diff.mjs <before.tsv> <after.tsv>');
  process.exit(2);
}

function load(path) {
  const fns = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const [name, , env = '', secrets = ''] = line.split('\t');
    const names = new Set([
      ...env.split(',').filter(Boolean),
      ...secrets.split(',').filter(Boolean).map(s => `secret ${s}`),
    ]);
    fns.set(name, names);
  }
  return fns;
}

const before = load(beforePath);
const after = load(afterPath);
const added = new Map();   // name -> functions that gained it
const removed = [];        // "fn: name"
const newFns = [...after.keys()].filter(f => !before.has(f)).sort();
const goneFns = [...before.keys()].filter(f => !after.has(f)).sort();

for (const [fn, was] of before) {
  const now = after.get(fn);
  if (!now) continue;
  for (const n of was) if (!now.has(n)) removed.push(`${fn}: ${n}`);
  for (const n of now) if (!was.has(n)) added.set(n, [...(added.get(n) ?? []), fn]);
}

const out = [];
if (newFns.length) out.push(`New functions (${newFns.length}): ${newFns.join(', ')}`);
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
const ok = !goneFns.length && !removed.length;
out.push(ok
  ? `OK: no function, variable name or secret removed (${before.size} before, ${after.size} after)`
  : 'FAIL: a function, variable name or secret is gone. Stop and send this output; change nothing.');
console.log(out.join('\n'));
process.exit(ok ? 0 : 1);
