// scripts/ci/check-backend-config.mjs — the staging test build refuses settings
// that are incomplete or point at more than one Firebase project. Identity
// Toolkit is replaced by a stub: key "K-<owner>" belongs to project <owner>.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/ci/check-backend-config.mjs');
let dir = '';
let stub = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'backend-config-'));
  stub = join(dir, 'stub.mjs');
  writeFileSync(stub, `globalThis.fetch = async (url) => {
  const key = new URL(url).searchParams.get('key') ?? '';
  if (!key.startsWith('K-')) return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 });
  const owner = key.slice(2);
  return new Response(JSON.stringify({ projectId: owner, authorizedDomains: ['localhost', owner + '.firebaseapp.com'] }), { status: 200 });
};\n`);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const googleServices = (project: string, number: string, androidKey: string, pkg = 'app.offlinesms.mobile.test') => JSON.stringify({
  project_info: { project_id: project, project_number: number, storage_bucket: `${project}.firebasestorage.app` },
  client: [{
    client_info: { mobilesdk_app_id: `1:${number}:android:abc123`, android_client_info: { package_name: pkg } },
    api_key: [{ current_key: androidKey }],
  }],
});

const staging = {
  MOBILE_GOOGLE_SERVICES_JSON: googleServices('stg', '111', 'K-stg'),
  EXPO_PUBLIC_FIREBASE_API_KEY: 'K-stg',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'stg.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'stg',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'stg.firebasestorage.app',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:111:web:def456',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '111',
};

function check(over: Partial<Record<keyof typeof staging, string>>, args = ['--staging']) {
  const r = spawnSync(process.execPath, ['--import', stub, SCRIPT, ...args], {
    env: { PATH: process.env.PATH, NODE_ENV: 'test' as const, ...staging, ...over }, encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('staging backend config check', () => {
  it('accepts settings that all belong to one non-production project', () => {
    expect(check({})).toMatchObject({ code: 0 });
  });

  it('refuses a missing web API key', () => {
    const r = check({ EXPO_PUBLIC_FIREBASE_API_KEY: '' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('FIREBASE_API_KEY is missing');
  });

  it('refuses an Android config of another project than the web config', () => {
    const r = check({ MOBILE_GOOGLE_SERVICES_JSON: googleServices('other', '222', 'K-other') });
    expect(r.code).toBe(1);
    expect(r.out).toContain('google-services.json belongs to another project');
  });

  it('refuses a web API key that belongs to another project, whatever the project id says', () => {
    const r = check({ EXPO_PUBLIC_FIREBASE_API_KEY: 'K-other' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('web API key (FIREBASE_API_KEY) belongs to another project');
  });

  it('refuses an Android API key that belongs to another project', () => {
    const r = check({ MOBILE_GOOGLE_SERVICES_JSON: googleServices('stg', '111', 'K-other') });
    expect(r.code).toBe(1);
    expect(r.out).toContain('Android API key');
  });

  it('refuses a key whose project cannot be verified', () => {
    const r = check({ EXPO_PUBLIC_FIREBASE_API_KEY: 'not-a-key' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('its project cannot be verified');
  });

  it('refuses sender and app ids of another project, and an unauthorized auth domain', () => {
    const r = check({ EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '222', EXPO_PUBLIC_FIREBASE_APP_ID: '1:222:web:aa', EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'elsewhere.example.com' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('MESSAGING_SENDER_ID');
    expect(r.out).toContain('FIREBASE_APP_ID');
  });

  it('refuses the production project for staging', () => {
    const p = 'offlinesms-prod-2027';
    const r = check({
      MOBILE_GOOGLE_SERVICES_JSON: googleServices(p, '999', `K-${p}`), EXPO_PUBLIC_FIREBASE_API_KEY: `K-${p}`,
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${p}.firebaseapp.com`, EXPO_PUBLIC_FIREBASE_PROJECT_ID: p,
      EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: `${p}.firebasestorage.app`, EXPO_PUBLIC_FIREBASE_APP_ID: '1:999:web:aa',
      EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '999',
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('production project');
  });
});

describe('production release config check', () => {
  const p = 'offlinesms-prod-2027';
  const prod = (pkg: string) => ({
    MOBILE_GOOGLE_SERVICES_JSON: googleServices(p, '999', `K-${p}`, pkg), EXPO_PUBLIC_FIREBASE_API_KEY: `K-${p}`,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${p}.firebaseapp.com`, EXPO_PUBLIC_FIREBASE_PROJECT_ID: p,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: `${p}.firebasestorage.app`, EXPO_PUBLIC_FIREBASE_APP_ID: '1:999:web:aa',
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '999',
  });

  it('accepts the production project for the named store package', () => {
    expect(check(prod('app.offlinesms.mobile'), ['--production', '--package', 'app.offlinesms.mobile'])).toMatchObject({ code: 0 });
    expect(check(prod('app.offlinesms.business'), ['--production', '--package', 'app.offlinesms.business'])).toMatchObject({ code: 0 });
  });

  it('refuses a config without the named package', () => {
    const r = check(prod('app.offlinesms.mobile.test'), ['--production', '--package', 'app.offlinesms.mobile']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('no Android client for app.offlinesms.mobile');
  });

  it('refuses any project other than production', () => {
    const r = check({ MOBILE_GOOGLE_SERVICES_JSON: googleServices('stg', '111', 'K-stg', 'app.offlinesms.mobile') },
      ['--production', '--package', 'app.offlinesms.mobile']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('production settings must point at offlinesms-prod-2027');
  });
});
