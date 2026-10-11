// scripts/release/env-names-diff.mjs compares two function-env-names.sh outputs.
// It fails (1) when a function, a variable name or a secret disappeared, or a
// --forbid name is on any function after; it refuses (2) empty or malformed input.
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
const tsv = (rows: Row[]) => rows.map(r => [r[0], r[1], r[2], r[3] ?? ''].join('\t')).join('\n') + '\n';
function runRaw(before: string, after: string, opts: string[] = []) {
  writeFileSync(join(dir, 'before.tsv'), before);
  writeFileSync(join(dir, 'after.tsv'), after);
  const r = spawnSync('node', [SCRIPT, ...opts, join(dir, 'before.tsv'), join(dir, 'after.tsv')], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}
const run = (before: Row[], after: Row[], opts: string[] = []) => runRaw(tsv(before), tsv(after), opts);
const FLAGS = ['--forbid', 'PHONE_AUTH_ENABLED,PHONE_LINK_ENABLED'];

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

  it('lists new functions with all their names, without failing', () => {
    const r = run(
      [['votePoll', 'nodejs20', BASE]],
      [['votePoll', 'nodejs22', BASE], ['guardEmailSent', 'nodejs22', `${BASE},PHONE_AUTH_ENABLED`, 'PHONE_HASH_PEPPER:1']],
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain('New functions (1), with all their names:\n  guardEmailSent: EMAIL_FROM,FUNCTION_TARGET,LOG_EXECUTION_ID,PHONE_AUTH_ENABLED,secret PHONE_HASH_PEPPER:1\n');
  });

  it('--forbid fails when a new function carries a phone flag', () => {
    const r = run(
      [['votePoll', 'nodejs20', BASE]],
      [['votePoll', 'nodejs22', BASE], ['guardEmailSent', 'nodejs22', `${BASE},PHONE_AUTH_ENABLED,PHONE_LINK_ENABLED`]],
      FLAGS,
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain('Forbidden names present after (2):\n  guardEmailSent: PHONE_AUTH_ENABLED\n  guardEmailSent: PHONE_LINK_ENABLED');
    expect(r.out).not.toContain('OK:');
  });

  it('--forbid fails when an existing function gains a flag or already had it', () => {
    const r = run(
      [['votePoll', 'nodejs20', BASE], ['verifyPhoneOtp', 'nodejs20', `${BASE},PHONE_LINK_ENABLED`]],
      [['votePoll', 'nodejs22', `${BASE},PHONE_AUTH_ENABLED`], ['verifyPhoneOtp', 'nodejs22', `${BASE},PHONE_LINK_ENABLED`]],
      FLAGS,
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain('  verifyPhoneOtp: PHONE_LINK_ENABLED');
    expect(r.out).toContain('  votePoll: PHONE_AUTH_ENABLED');
  });

  it('--forbid passes, and says so, when no function carries the flags', () => {
    const r = run([['votePoll', 'nodejs20', BASE]], [['votePoll', 'nodejs22', BASE], ['guardEmailSent', 'nodejs22', BASE]], FLAGS);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('Forbidden names (PHONE_AUTH_ENABLED, PHONE_LINK_ENABLED): on no function');
    expect(r.out).toContain('OK: no function, variable name or secret removed, no forbidden name (1 before, 2 after)');
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

  it.each([
    ['both files empty', '', ''],
    ['the before file empty', '', tsv([['votePoll', 'nodejs22', BASE]])],
    ['the after file empty', tsv([['votePoll', 'nodejs20', BASE]]), ''],
    ['a file of blank lines', '\n\n', tsv([['votePoll', 'nodejs22', BASE]])],
  ])('refuses %s', (_case, before, after) => {
    const r = runRaw(before, after);
    expect(r.status).toBe(2);
    expect(r.out).toContain('lists no function');
    expect(r.out).not.toContain('OK:');
  });

  it.each([
    ['too few columns', 'votePoll\tnodejs22\tEMAIL_FROM\n', '4 tab-separated columns, found 3'],
    ['too many columns', 'votePoll\tnodejs22\tEMAIL_FROM\t\textra\n', '4 tab-separated columns, found 5'],
    ['a value instead of a name', 'votePoll\tnodejs22\tEMAIL_FROM=a@b.c\t\n', 'not a variable name: "EMAIL_FROM=a@b.c"'],
    ['an empty name in the list', 'votePoll\tnodejs22\tEMAIL_FROM,,LOG_EXECUTION_ID\t\n', 'not a variable name: ""'],
    ['a secret without a version', 'votePoll\tnodejs22\tEMAIL_FROM\tPHONE_HASH_PEPPER\n', 'not a SECRET:version entry'],
    ['no runtime', 'votePoll\t\tEMAIL_FROM\t\n', 'no runtime'],
    ['a bad function name', 'vote poll\tnodejs22\tEMAIL_FROM\t\n', 'not a function name'],
    ['a function listed twice', 'votePoll\tnodejs22\tEMAIL_FROM\t\nvotePoll\tnodejs22\tEMAIL_FROM\t\n', 'votePoll is listed twice'],
  ])('refuses a row with %s, naming file and line', (_case, after, message) => {
    const r = runRaw(tsv([['votePoll', 'nodejs20', 'EMAIL_FROM']]), after);
    expect(r.status).toBe(2);
    expect(r.out).toContain('INVALID: ');
    expect(r.out).toMatch(/after\.tsv:\d+: /);
    expect(r.out).toContain(message);
    expect(r.out).not.toContain('OK:');
  });

  it('refuses a malformed before file too', () => {
    const r = runRaw('votePoll nodejs20 EMAIL_FROM\n', tsv([['votePoll', 'nodejs22', BASE]]));
    expect(r.status).toBe(2);
    expect(r.out).toContain('before.tsv:1: expected 4 tab-separated columns, found 1');
  });

  it('refuses an unknown option or a bad --forbid list', () => {
    expect(run([['votePoll', 'nodejs20', BASE]], [['votePoll', 'nodejs22', BASE]], ['--forbit', 'X']).status).toBe(2);
    expect(run([['votePoll', 'nodejs20', BASE]], [['votePoll', 'nodejs22', BASE]], ['--forbid', 'PHONE AUTH']).status).toBe(2);
  });

  it('reads the real script output shape: empty variable and secret columns, CRLF line ends', () => {
    const r = runRaw('onUserCreate\tnodejs20\t\t\r\n', 'onUserCreate\tnodejs22\tFUNCTION_SIGNATURE_TYPE\t\r\n');
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('FUNCTION_SIGNATURE_TYPE on 1 function');
  });
});
