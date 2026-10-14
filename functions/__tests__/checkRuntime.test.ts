// scripts/release/check-runtime.sh passes only when a project runs exactly the
// functions of this source, all on the expected runtime. gcloud is replaced by
// a stub that prints a `gcloud functions list --format=json` result, so the
// script, function-env-names.sh and jq run as they do in Cloud Shell.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts/release/check-runtime.sh');
const groups = JSON.parse(readFileSync(join(ROOT, 'scripts/release/function-groups.json'), 'utf8')) as Record<string, string[]>;
const EXPECTED = execFileSync('node', [join(ROOT, 'scripts/release/expected-functions.mjs')], { encoding: 'utf8' }).trim().split('\n');

type Fn = { name: string; runtime: string; region?: string };
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-runtime-'));
  const gcloud = join(dir, 'gcloud');
  writeFileSync(gcloud, '#!/usr/bin/env bash\n[ -n "${FAKE_GCLOUD_FAIL:-}" ] && { echo "ERROR: gcloud failed" >&2; exit 1; }\ncat "$FAKE_GCLOUD_JSON"\n');
  chmodSync(gcloud, 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(fns: Fn[], extraEnv: Record<string, string> = {}) {
  const json = join(dir, 'functions.json');
  writeFileSync(json, JSON.stringify(fns.map(f => ({
    name: `projects/offlinesms-staging-2027/locations/${f.region ?? 'us-central1'}/functions/${f.name}`,
    buildConfig: { runtime: f.runtime },
    serviceConfig: { environmentVariables: { LOG_EXECUTION_ID: 'true' }, secretEnvironmentVariables: [] },
  }))));
  const r = spawnSync('bash', [SCRIPT, 'offlinesms-staging-2027'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_GCLOUD_JSON: json, ...extraEnv },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const on = (names: string[], runtime: string): Fn[] => names.map(name => ({ name, runtime }));
const without = (names: string[], drop: string[]) => names.filter(n => !drop.includes(n));

describe('check-runtime.sh', () => {
  it('expects the 96 functions of this source', () => {
    expect(EXPECTED).toHaveLength(96);
    expect(EXPECTED).not.toContain('sweepExpiredMessages');
  });

  it('passes when exactly the expected functions run on nodejs22', () => {
    const r = run(on(EXPECTED, 'nodejs22'));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('OK: offlinesms-staging-2027 runs exactly the 96 functions of this source, all on nodejs22');
  });

  it('fails when only one function is deployed, even on nodejs22', () => {
    const r = run(on(['relayHeartbeat'], 'nodejs22'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('Missing in offlinesms-staging-2027 (95):');
    expect(r.out).toContain('FAIL:');
  });

  it('fails part-way through a staged deploy: new functions absent, later groups still on nodejs20', () => {
    const done = ['email-guards', 'chat', 'groups'].flatMap(g => groups[g]);
    const notYet = groups['email-change'];
    const old = without(without(EXPECTED, done), notYet);
    const r = run([...on(done, 'nodejs22'), ...on(old, 'nodejs20')]);
    expect(r.status).toBe(1);
    expect(r.out).toContain(`Missing in offlinesms-staging-2027 (${notYet.length}):`);
    for (const n of notYet) expect(r.out).toContain(`  ${n}\n`);
    expect(r.out).toContain(`Not on nodejs22 (${old.length}):`);
    expect(r.out).toContain('  escalateOrgBatches\tnodejs20');
  });

  it('fails when a single function stayed on nodejs20', () => {
    const r = run([...on(without(EXPECTED, ['relayReaper']), 'nodejs22'), { name: 'relayReaper', runtime: 'nodejs20' }]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('Not on nodejs22 (1):\n  relayReaper\tnodejs20');
    expect(r.out).not.toContain('Missing');
  });

  it('fails when a function this source does not export is deployed', () => {
    const r = run([...on(EXPECTED, 'nodejs22'), { name: 'sweepExpiredMessages', runtime: 'nodejs22' }]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('Deployed in offlinesms-staging-2027 but not exported by this source (1):\n  sweepExpiredMessages');
  });

  it('fails when a name is deployed twice (another region)', () => {
    const r = run([...on(EXPECTED, 'nodejs22'), { name: EXPECTED[0], runtime: 'nodejs22', region: 'europe-west1' }]);
    expect(r.status).toBe(1);
    expect(r.out).toContain(`Deployed more than once (1):\n  ${EXPECTED[0]}`);
  });

  it('fails when nothing is deployed', () => {
    const r = run([]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('Missing in offlinesms-staging-2027 (96):');
  });

  it('fails when gcloud fails', () => {
    const r = run(on(EXPECTED, 'nodejs22'), { FAKE_GCLOUD_FAIL: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain('OK:');
  });
});
