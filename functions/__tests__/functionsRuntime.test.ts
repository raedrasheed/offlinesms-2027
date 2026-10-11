// The Cloud Functions runtime comes from functions/package.json "engines" only:
// firebase.json sets no "runtime" that would override it, the lockfile agrees,
// and CI runs the functions (and their emulator tests) on the same Node major.
// Node.js 20 can no longer be deployed from 2026-10-30.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const RUNTIME_MAJOR = '22';

describe('functions runtime', () => {
  it('is Node.js 22, set by engines alone', () => {
    expect(JSON.parse(read('functions/package.json')).engines).toEqual({ node: RUNTIME_MAJOR });
    const firebase = JSON.parse(read('firebase.json'));
    const codebases = Array.isArray(firebase.functions) ? firebase.functions : [firebase.functions];
    expect(codebases.length).toBeGreaterThan(0);
    for (const c of codebases) expect(c, `codebase ${c.codebase}`).not.toHaveProperty('runtime');
  });

  it('matches the lockfile', () => {
    expect(JSON.parse(read('package-lock.json')).packages.functions.engines).toEqual({ node: RUNTIME_MAJOR });
  });

  it('is the Node version every workflow sets up', () => {
    const dir = join(ROOT, '.github/workflows');
    const versions = readdirSync(dir).filter(f => f.endsWith('.yml'))
      .flatMap(f => [...readFileSync(join(dir, f), 'utf8').matchAll(/node-version:\s*['"]?([^'"\s]+)/g)].map(m => `${f}: ${m[1]}`));
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(v.split(': ')[1], v).toBe(RUNTIME_MAJOR);
  });
});
