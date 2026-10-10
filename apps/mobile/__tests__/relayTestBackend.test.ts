// scripts/ci/relay-test-backend.mjs — with test_backend=staging the private relay
// APK is configured from the MOBILE_STAGING_* settings only: anything missing or
// pointing elsewhere fails the job, and it never falls back to the default
// settings. Identity Toolkit is stubbed: key "K-<owner>" belongs to <owner>.
// scripts/ci/check-apk-backend.sh — reads the project back from a built APK.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/ci/relay-test-backend.mjs');
const APK_CHECK = resolve(__dirname, '../../../scripts/ci/check-apk-backend.sh');
let dir = '';
let stub = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-backend-'));
  stub = join(dir, 'stub.mjs');
  writeFileSync(stub, `globalThis.fetch = async (url) => {
  const key = new URL(url).searchParams.get('key') ?? '';
  if (!key.startsWith('K-')) return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 });
  return new Response(JSON.stringify({ projectId: key.slice(2), authorizedDomains: [] }), { status: 200 });
};\n`);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const gs = (project: string, number: string, relay: { appNumber?: string; key?: string } | null = {}) => JSON.stringify({
  project_info: { project_id: project, project_number: number, storage_bucket: `${project}.firebasestorage.app` },
  client: [
    { client_info: { mobilesdk_app_id: `1:${number}:android:aa11`, android_client_info: { package_name: 'app.offlinesms.mobile.test' } }, api_key: [{ current_key: `K-${project}` }] },
    ...(relay ? [{
      client_info: { mobilesdk_app_id: `1:${relay.appNumber ?? number}:android:bb22`, android_client_info: { package_name: 'app.offlinesms.business' } },
      api_key: [{ current_key: relay.key ?? `K-${project}` }],
    }] : []),
  ],
});

const PROD_FILE = gs('offlinesms-prod-2027', '999');
const STAGING = { MOBILE_STAGING_GOOGLE_SERVICES_JSON: gs('stg', '111'), MOBILE_STAGING_FIREBASE_PROJECT_ID: 'stg' };
// What CI passes in staging mode: the default settings are blanked, but even if
// they were present they must never be used.
const DEFAULTS_PRESENT = { MOBILE_GOOGLE_SERVICES_JSON: PROD_FILE, MOBILE_TEST_FIREBASE_PROJECT_ID: 'offlinesms-prod-2027', MOBILE_TEST_ALLOW_PRODUCTION_BACKEND: 'true' };

function run(env: Record<string, string>) {
  const cwd = mkdtempSync(join(dir, 'run-'));
  mkdirSync(join(cwd, 'apps/mobile-relay/app'), { recursive: true });
  const output = join(cwd, 'github-output');
  writeFileSync(output, '');
  const r = spawnSync(process.execPath, ['--import', stub, SCRIPT], {
    cwd, env: { PATH: process.env.PATH, NODE_ENV: 'test' as const, GITHUB_OUTPUT: output, ...env }, encoding: 'utf8',
  });
  const file = join(cwd, 'apps/mobile-relay/app/google-services.json');
  return {
    code: r.status, out: `${r.stdout}${r.stderr}`, outputs: readFileSync(output, 'utf8'),
    written: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null,
  };
}

describe('relay test APK backend, staging', () => {
  it('configures the relay from the staging settings only, with only the relay client', () => {
    const r = run({ TEST_BACKEND: 'staging', ...STAGING, ...DEFAULTS_PRESENT });
    expect(r.code).toBe(0);
    expect(r.outputs).toBe('ready=true\nproject=stg\n');
    expect(r.written.project_info.project_id).toBe('stg');
    expect(r.written.client.map((c: any) => c.client_info.android_client_info.package_name)).toEqual(['app.offlinesms.business']);
  });

  it('fails without the staging secret or variable, and does not fall back to the default settings', () => {
    const said = { MOBILE_STAGING_GOOGLE_SERVICES_JSON: 'secret', MOBILE_STAGING_FIREBASE_PROJECT_ID: 'variable' } as const;
    for (const [missing, kind] of Object.entries(said)) {
      const r = run({ TEST_BACKEND: 'staging', ...STAGING, [missing]: '', ...DEFAULTS_PRESENT });
      expect(r.code).toBe(1);
      expect(r.out).toContain(`${kind} ${missing} missing; the staging relay is never built from the default settings`);
      expect(r.outputs).toBe('');
      expect(r.written).toBeNull();
    }
  });

  it('refuses the production project, even with the production opt-in set', () => {
    const r = run({ TEST_BACKEND: 'staging', MOBILE_STAGING_GOOGLE_SERVICES_JSON: PROD_FILE, MOBILE_STAGING_FIREBASE_PROJECT_ID: 'offlinesms-prod-2027', MOBILE_TEST_ALLOW_PRODUCTION_BACKEND: 'true' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('production project');
    expect(r.written).toBeNull();
  });

  it('refuses a file of another project than the staging variable', () => {
    const r = run({ TEST_BACKEND: 'staging', ...STAGING, MOBILE_STAGING_FIREBASE_PROJECT_ID: 'other' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('another project than MOBILE_STAGING_FIREBASE_PROJECT_ID');
  });

  it('refuses a file without the relay app', () => {
    const r = run({ TEST_BACKEND: 'staging', ...STAGING, MOBILE_STAGING_GOOGLE_SERVICES_JSON: gs('stg', '111', null) });
    expect(r.code).toBe(1);
    expect(r.out).toContain('must include Android app app.offlinesms.business');
  });

  it('refuses a relay app id or API key of another project', () => {
    const appId = run({ TEST_BACKEND: 'staging', ...STAGING, MOBILE_STAGING_GOOGLE_SERVICES_JSON: gs('stg', '111', { appNumber: '222' }) });
    expect(appId.code).toBe(1);
    expect(appId.out).toContain('app id is not an app of stg');
    const key = run({ TEST_BACKEND: 'staging', ...STAGING, MOBILE_STAGING_GOOGLE_SERVICES_JSON: gs('stg', '111', { key: 'K-offlinesms-prod-2027' }) });
    expect(key.code).toBe(1);
    expect(key.out).toContain('API key belongs to another project');
    const unknown = run({ TEST_BACKEND: 'staging', ...STAGING, MOBILE_STAGING_GOOGLE_SERVICES_JSON: gs('stg', '111', { key: 'not-a-key' }) });
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain('its project cannot be verified');
  });
});

describe('relay test APK backend, default (unchanged)', () => {
  it('skips the functional APK when no config is set', () => {
    const r = run({ TEST_BACKEND: 'default' });
    expect(r.code).toBe(0);
    expect(r.outputs).toBe('');
  });

  it('accepts production only with the explicit opt-in', () => {
    const base = { MOBILE_GOOGLE_SERVICES_JSON: PROD_FILE, MOBILE_TEST_FIREBASE_PROJECT_ID: 'offlinesms-prod-2027' };
    expect(run(base).code).toBe(1);
    const r = run({ ...base, MOBILE_TEST_ALLOW_PRODUCTION_BACKEND: 'true' });
    expect(r.code).toBe(0);
    expect(r.outputs).toBe('ready=true\nproject=offlinesms-prod-2027\n');
  });
});

describe('APK backend check', () => {
  // A minimal "APK": resources.arsc and, for the main app, the JS bundle.
  function apk(arsc: string, bundle?: string) {
    const d = mkdtempSync(join(dir, 'apk-'));
    const py = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('resources.arsc',sys.argv[2])\n` +
      (bundle === undefined ? '' : `z.writestr('assets/index.android.bundle',sys.argv[3])\n`) + 'z.close()\n';
    const file = join(d, 'test.apk');
    const r = spawnSync('python3', ['-c', py, file, `res project_id ${arsc}`, ...(bundle === undefined ? [] : [bundle])]);
    expect(r.status).toBe(0);
    return file;
  }
  const check = (file: string, expected: string) => {
    const r = spawnSync('bash', [APK_CHECK, file, expected], { encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('passes when the resources and the JS bundle name the expected project', () => {
    const r = check(apk('offlinesms-staging-2027', 'projectId:"offlinesms-staging-2027"'), 'offlinesms-staging-2027');
    expect(r.code).toBe(0);
    expect(r.out).toContain('talks to offlinesms-staging-2027');
  });

  it('fails when a staging build carries production or the placeholder anywhere', () => {
    const prodBundle = check(apk('offlinesms-staging-2027', 'projectId:"offlinesms-prod-2027"'), 'offlinesms-staging-2027');
    expect(prodBundle.code).toBe(1);
    expect(prodBundle.out).toContain('JS bundle (EXPO_PUBLIC_FIREBASE_*) does not name offlinesms-staging-2027');
    expect(prodBundle.out).toContain('JS bundle (EXPO_PUBLIC_FIREBASE_*) names the production project');
    const placeholder = check(apk('offlinesms-staging-2027 demo-offlinesms-ci'), 'offlinesms-staging-2027');
    expect(placeholder.code).toBe(1);
    expect(placeholder.out).toContain('placeholder project');
  });

  it('accepts production only when production is the expected project', () => {
    expect(check(apk('offlinesms-prod-2027', 'offlinesms-prod-2027'), 'offlinesms-prod-2027').code).toBe(0);
  });
});
