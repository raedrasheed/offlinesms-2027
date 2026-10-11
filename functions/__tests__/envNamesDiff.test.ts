// scripts/release/env-names-diff.mjs compares two function-env-names.sh outputs
// and fails only when a function, a variable name or a secret disappeared.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../scripts/release/env-names-diff.mjs');
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'env-names-diff-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// One row per function, as function-env-names.sh prints it: name, runtime,
// variable names, secrets with their versions.
type Row = [name: string, runtime: string, env: string, secrets?: string];
function run(before: Row[], after: Row[]) {
  const tsv = (rows: Row[]) => rows.map(r => [r[0], r[1], r[2], r[3] ?? ''].join('\t')).join('\n') + '\n';
  writeFileSync(join(dir, 'before.tsv'), tsv(before));
  writeFileSync(join(dir, 'after.tsv'), tsv(after));
  const r = spawnSync('node', [SCRIPT, join(dir, 'before.tsv'), join(dir, 'after.tsv')], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

const BASE = 'EMAIL_FROM,FUNCTION_TARGET,LOG_EXECUTION_ID';

describe('env-names-diff.mjs', () => {
  it('passes when names are only added, as on staging after the Node 22 deploy', () => {
    const r = run(
      [['addMembers', 'nodejs20', BASE], ['claimRelayJobs', 'nodejs20', `${BASE},PHONE_AUTH_ENABLED`, 'PHONE_HASH_PEPPER:1']],
      [['addMembers', 'nodejs22', `${BASE},FUNCTION_SIGNATURE_TYPE,PHONE_AUTH_ENABLED`], ['claimRelayJobs', 'nodejs22', `${BASE},FUNCTION_SIGNATURE_TYPE,PHONE_AUTH_ENABLED`, 'PHONE_HASH_PEPPER:1']],
    );
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('Names added to existing functions:\n  FUNCTION_SIGNATURE_TYPE on 2 functions\n  PHONE_AUTH_ENABLED on 1 function\n');
    expect(r.out).toContain('OK: no function, variable name or secret removed (2 before, 2 after)');
  });

  it('ignores the runtime column and passes with no change at all', () => {
    const r = run([['votePoll', 'nodejs20', BASE]], [['votePoll', 'nodejs22', BASE]]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('added');
  });

  it('lists new functions without failing', () => {
    const r = run([['votePoll', 'nodejs20', BASE]], [['votePoll', 'nodejs22', BASE], ['guardEmailSent', 'nodejs22', BASE]]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('New functions (1): guardEmailSent');
  });

  it('fails when a variable name disappears', () => {
    const r = run([['sendTextMessage', 'nodejs20', `${BASE},RESEND_API_KEY`]], [['sendTextMessage', 'nodejs22', BASE]]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('Names removed (1):\n  sendTextMessage: RESEND_API_KEY');
    expect(r.out).toContain('FAIL:');
  });

  it('fails when a secret disappears or moves to another version', () => {
    const r = run(
      [['verifyPhoneOtp', 'nodejs20', BASE, 'PHONE_HASH_PEPPER:1'], ['requestPhoneOtp', 'nodejs20', BASE, 'PHONE_HASH_PEPPER:1']],
      [['verifyPhoneOtp', 'nodejs22', BASE, 'PHONE_HASH_PEPPER:2'], ['requestPhoneOtp', 'nodejs22', BASE]],
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain('  requestPhoneOtp: secret PHONE_HASH_PEPPER:1');
    expect(r.out).toContain('  verifyPhoneOtp: secret PHONE_HASH_PEPPER:1');
    expect(r.out).toContain('secret PHONE_HASH_PEPPER:2 on 1 function');
  });

  it('fails when a function is missing after', () => {
    const r = run([['votePoll', 'nodejs20', BASE], ['closePoll', 'nodejs20', BASE]], [['votePoll', 'nodejs22', BASE]]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('Functions missing after (1): closePoll');
  });

  it('refuses to run without two files', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });
});
