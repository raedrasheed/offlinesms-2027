// scripts/release/function-groups.json — the production deploy groups cover
// every exported function exactly once, so a staged deploy neither misses one
// nor needs a bare "--only functions"; "phone-flags" names exactly the
// functions that read the phone purpose flags.
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const groups = JSON.parse(readFileSync(join(ROOT, 'scripts/release/function-groups.json'), 'utf8')) as Record<string, unknown>;
const index = readFileSync(join(ROOT, 'functions/src/index.ts'), 'utf8');

function exportsOf(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    for (const part of m[1].split(',').map(p => p.trim()).filter(Boolean)) out.set(part.split(/\s+as\s+/).pop()!, m[2]);
  }
  return out;
}

const DEPLOY_ORDER = ['email-guards', 'chat', 'groups', 'accounts-admin', 'business-sms-points', 'relay', 'phone', 'email-change'];

describe('production deploy groups', () => {
  const exported = exportsOf(index);

  it('cover every exported function exactly once', () => {
    const listed = DEPLOY_ORDER.flatMap(g => groups[g] as string[]);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...exported.keys()].sort());
    expect(Object.keys(groups).filter(k => !k.startsWith('_')).sort()).toEqual([...DEPLOY_ORDER, 'phone-flags'].sort());
  });

  it('expected-functions.mjs (check-runtime.sh) lists exactly the exported functions', () => {
    const out = execFileSync('node', [join(ROOT, 'scripts/release/expected-functions.mjs')], { encoding: 'utf8' }).trim().split('\n');
    expect(out).toEqual([...exported.keys()].sort());
  });

  it('phone-flags lists exactly the functions whose code reads PHONE_AUTH_ENABLED / PHONE_LINK_ENABLED', () => {
    const reads = (file: string, seen = new Set<string>()): boolean => {
      if (seen.has(file)) return false;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      if (/PHONE_(AUTH|LINK)_ENABLED/.test(src)) return true;
      for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
        const base = resolve(dirname(file), m[1]);
        const f = [`${base}.ts`, join(base, 'index.ts')].find(p => { try { return statSync(p).isFile(); } catch { return false; } });
        if (f && reads(f, seen)) return true;
      }
      return false;
    };
    const src = join(ROOT, 'functions/src');
    const readers = [...exported].filter(([, mod]) => reads(`${resolve(src, mod)}.ts`)).map(([n]) => n).sort();
    expect([...(groups['phone-flags'] as string[])].sort()).toEqual(readers);
  });
});
