// scripts/ci/check-apk-backend.mjs — reads the Firebase config an APK actually
// carries (string resources in resources.arsc, the Hermes bundle's string table)
// and compares each value exactly with the project the APK was built for. A
// project name merely appearing somewhere in the APK is not accepted.
// The APK parts below are built byte by byte in the formats aapt2 and Hermes write.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { arscStringResources, checkApk, hermesStrings, nativeExpectation } from '../../../scripts/ci/check-apk-backend.mjs';

const SCRIPT = resolve(__dirname, '../../../scripts/ci/check-apk-backend.mjs');
const PROD = 'offlinesms-prod-2027';
const STAGING = 'offlinesms-staging-2027';
const PKG = 'app.offlinesms.mobile.test';
const key = (tag: string) => `AIza${tag.padEnd(35, 'x').slice(0, 35)}`;

// ── resources.arsc ────────────────────────────────────────────────────────────
function u16(n: number) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
const pad4 = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);

function stringPool(strings: string[], utf16 = false) {
  const len = (n: number) => (utf16 ? (n > 0x7fff ? [u16(0x8000 | (n >>> 16)), u16(n & 0xffff)] : [u16(n)])
    : n > 0x7f ? [Buffer.from([0x80 | (n >> 8), n & 0xff])] : [Buffer.from([n])]);
  const data: Buffer[] = [];
  const offsets: number[] = [];
  let at = 0;
  for (const s of strings) {
    offsets.push(at);
    const bytes = utf16 ? Buffer.from(s, 'utf16le') : Buffer.from(s, 'utf8');
    const parts = utf16 ? [...len(s.length), bytes, u16(0)] : [...len(s.length), ...len(bytes.length), bytes, Buffer.from([0])];
    const b = Buffer.concat(parts);
    data.push(b);
    at += b.length;
  }
  const body = pad4(Buffer.concat(data));
  const header = 28, stringsStart = header + strings.length * 4;
  return Buffer.concat([
    u16(0x0001), u16(header), u32(stringsStart + body.length), u32(strings.length), u32(0),
    u32(utf16 ? 0 : 0x100), u32(stringsStart), u32(0), ...offsets.map(u32), body,
  ]);
}

type Value = string | { color: number };
type Config = Record<string, Value>;

/**
 * A resource table with one package. `configs` are the configurations of the
 * `string` type (default, values-ar, …); `other` is a `color` type whose names
 * may repeat string resource names (it must be ignored).
 */
function arsc(configs: Config[], opts: { utf16?: boolean; compact?: boolean; other?: Config } = {}) {
  const names = [...new Set([...configs.flatMap(Object.keys), ...Object.keys(opts.other ?? {})])];
  const values: string[] = [];
  const valueIndex = (s: string) => { const i = values.indexOf(s); return i >= 0 ? i : values.push(s) - 1; };

  const typeChunk = (typeId: number, config: Config) => {
    const entries: Buffer[] = [], offsets: number[] = [];
    let at = 0;
    for (const name of names) {
      if (!(name in config)) { offsets.push(0xffffffff); continue; }
      const v = config[name];
      const [dataType, data] = typeof v === 'string' ? [0x03, valueIndex(v)] : [0x1c, v.color];
      const e = opts.compact
        ? Buffer.concat([u16(names.indexOf(name)), u16((dataType << 8) | 0x08), u32(data)])
        : Buffer.concat([u16(8), u16(0), u32(names.indexOf(name)), u16(8), Buffer.from([0, dataType]), u32(data)]);
      offsets.push(at);
      entries.push(e);
      at += e.length;
    }
    const header = 84, entriesStart = header + names.length * 4;
    const resConfig = Buffer.concat([u32(64), Buffer.alloc(60)]);
    const body = Buffer.concat(entries);
    return Buffer.concat([
      u16(0x0201), u16(header), u32(entriesStart + body.length), Buffer.from([typeId, 0]), u16(0),
      u32(names.length), u32(entriesStart), resConfig, ...offsets.map(u32), body,
    ]);
  };

  const types = [
    ...configs.map(c => typeChunk(1, c)),
    ...(opts.other ? [typeChunk(2, opts.other)] : []),
  ];
  const typeStrings = stringPool(['string', 'color'], opts.utf16);
  const keyStrings = stringPool(names, opts.utf16);
  const pkgHeader = 288;
  const pkgBody = Buffer.concat([typeStrings, keyStrings, ...types]);
  const pkg = Buffer.concat([
    u16(0x0200), u16(pkgHeader), u32(pkgHeader + pkgBody.length), u32(0x7f), Buffer.alloc(256),
    u32(pkgHeader), u32(2), u32(pkgHeader + typeStrings.length), u32(names.length), u32(0), pkgBody,
  ]);
  const globals = stringPool(values, opts.utf16);
  return Buffer.concat([u16(0x0002), u16(12), u32(12 + globals.length + pkg.length), u32(1), globals, pkg]);
}

// ── Hermes bytecode: header, small string table, overflow table, storage ──────
function hermes(strings: string[]) {
  const small: Buffer[] = [], overflow: Buffer[] = [], storage: Buffer[] = [];
  let at = 0;
  for (const s of strings) {
    const utf16 = /[^\x00-\xff]/.test(s);
    const bytes = Buffer.from(s, utf16 ? 'utf16le' : 'latin1');
    if (s.length >= 255 || at >= 0x800000) {
      small.push(u32((((overflow.length & 0x7fffff) << 1) | 0xff000000 | (utf16 ? 1 : 0)) >>> 0));
      overflow.push(Buffer.concat([u32(at), u32(s.length)]));
    } else {
      small.push(u32(((s.length << 24) | (at << 1) | (utf16 ? 1 : 0)) >>> 0));
    }
    storage.push(bytes);
    at += bytes.length;
  }
  const header = Buffer.alloc(128);
  header.writeBigUInt64LE(0x1f1903c103bc1fc6n, 0);
  header.writeUInt32LE(96, 8);
  header.writeUInt32LE(strings.length, 52);
  header.writeUInt32LE(overflow.length, 56);
  header.writeUInt32LE(at, 60);
  const file = Buffer.concat([header, ...small, ...overflow, ...storage, Buffer.alloc(16)]);
  file.writeUInt32LE(file.length, 32);
  return file;
}

// ── A Firebase project and the APK parts built for it ─────────────────────────
type Project = { id: string; number: string; bucket?: string; tag: string };
const staging: Project = { id: STAGING, number: '111111111111', tag: 'staging' };

const googleServices = (p: Project) => ({
  project_info: { project_id: p.id, project_number: p.number, storage_bucket: p.bucket ?? `${p.id}.firebasestorage.app` },
  client: [
    { client_info: { mobilesdk_app_id: `1:${p.number}:android:aa11`, android_client_info: { package_name: PKG } }, api_key: [{ current_key: key(`${p.tag}android`) }] },
  ],
});
const nativeValues = (p: Project): Config => ({
  app_name: 'OfflineSMS',
  project_id: p.id,
  google_app_id: `1:${p.number}:android:aa11`,
  google_api_key: key(`${p.tag}android`),
  google_crash_reporting_api_key: key(`${p.tag}android`),
  gcm_defaultSenderId: p.number,
  google_storage_bucket: p.bucket ?? `${p.id}.firebasestorage.app`,
});
const webConfig = (p: Project) => ({
  apiKey: key(`${p.tag}web`),
  authDomain: `${p.id}.firebaseapp.com`,
  projectId: p.id,
  storageBucket: p.bucket ?? `${p.id}.firebasestorage.app`,
  appId: `1:${p.number}:web:cc33`,
  messagingSenderId: p.number,
});
const FILLER = ['firebase', 'useState', 'تم الإرسال', 'https://offlinesms.app/privacy', 'x'.repeat(300)];
const bundleFor = (p: Project, extra: string[] = []) => hermes([...FILLER, ...Object.values(webConfig(p)), ...extra]);

/** Check APK parts against what a staging build must carry. */
const checkStaging = (parts: { arsc: Buffer; bundle?: Buffer | null }) => checkApk({
  arsc: parts.arsc, bundle: parts.bundle ?? null, project: STAGING,
  native: nativeExpectation(googleServices(staging), PKG), web: webConfig(staging),
});

const ALL_KEYS = (ps: Project[]) => ps.flatMap(p => [key(`${p.tag}android`), key(`${p.tag}web`)]);

describe('reading the APK parts', () => {
  it('reads every string resource value across configurations, UTF-8 or UTF-16, full or compact entries', () => {
    for (const opts of [{}, { utf16: true }, { compact: true }, { utf16: true, compact: true }]) {
      const res = arscStringResources(arsc([nativeValues(staging), { app_name: 'أوفلاين' }], opts));
      expect(res.get('project_id')).toEqual(new Set([STAGING]));
      expect(res.get('app_name')).toEqual(new Set(['OfflineSMS', 'أوفلاين']));
    }
  });

  it('ignores resources of other types that share a string resource name', () => {
    const res = arscStringResources(arsc([nativeValues(staging)], { other: { project_id: { color: 0xff00ff00 } } }));
    expect(res.get('project_id')).toEqual(new Set([STAGING]));
  });

  it('reads the Hermes string table, including long and UTF-16 strings', () => {
    expect(hermesStrings(bundleFor(staging))).toEqual([...FILLER, ...Object.values(webConfig(staging))]);
  });

  it('refuses a bundle that is not Hermes bytecode', () => {
    expect(() => hermesStrings(Buffer.from(`var projectId="${STAGING}";`))).toThrow('not Hermes bytecode');
    expect(() => checkStaging({ arsc: arsc([nativeValues(staging)]), bundle: Buffer.from(`"${STAGING}"`) })).toThrow('unreadable JS bundle');
  });
});

describe('APK backend check, exact values', () => {
  it('passes an APK whose native and JS config are exactly the staging project\'s', () => {
    expect(checkStaging({ arsc: arsc([nativeValues(staging), nativeValues(staging)]), bundle: bundleFor(staging) })).toEqual([]);
    // The relay: native config only.
    expect(checkApk({ arsc: arsc([nativeValues(staging)]), bundle: null, project: STAGING, native: nativeExpectation(googleServices(staging), PKG), web: null })).toEqual([]);
  });

  it('refuses offlinesms-staging-2027-old when offlinesms-staging-2027 is expected', () => {
    const old: Project = { id: `${STAGING}-old`, number: '222222222222', tag: 'old' };
    const problems = checkStaging({ arsc: arsc([nativeValues(old)]), bundle: bundleFor(old) });
    expect(problems).toContain(`native project_id is not the expected value (found "${STAGING}-old")`);
    expect(problems).toContain('native google_app_id is not the expected value (found "1:222222222222:android:aa11")');
    expect(problems).toContain('native google_api_key is not the expected value');
    expect(problems).toContain(`native google_storage_bucket is not the expected value (found "${STAGING}-old.firebasestorage.app")`);
    expect(problems).toContain('JS projectId: the expected value is not in the bundle');
    expect(problems).toContain('JS authDomain: the expected value is not in the bundle');
    expect(problems).toContain(`JS bundle contains another auth domain ("${STAGING}-old.firebaseapp.com")`);

    // Only the project id is "-old", everything else is staging's.
    const onlyId = checkStaging({
      arsc: arsc([{ ...nativeValues(staging), project_id: `${STAGING}-old` }]),
      bundle: hermes([...FILLER, ...Object.values({ ...webConfig(staging), projectId: `${STAGING}-old` })]),
    });
    expect(onlyId).toEqual([
      `native project_id is not the expected value (found "${STAGING}-old")`,
      'JS projectId: the expected value is not in the bundle',
    ]);

    // And a google-services.json or web config of the -old project is refused before any comparison.
    const files = checkApk({
      arsc: arsc([nativeValues(old)]), bundle: bundleFor(old), project: STAGING,
      native: nativeExpectation(googleServices(old), PKG), web: webConfig(old),
    });
    expect(files).toContain(`google-services.json is for ${STAGING}-old, not ${STAGING}`);
    expect(files).toContain(`web config projectId is ${STAGING}-old, not ${STAGING}`);
    expect(files).toContain(`native project_id is not the expected value (found "${STAGING}-old")`);
  });

  it('refuses another project whose storage bucket carries the staging name', () => {
    const other: Project = { id: 'other-proj', number: '333333333333', bucket: `${STAGING}.firebasestorage.app`, tag: 'other' };
    const problems = checkStaging({ arsc: arsc([nativeValues(other)]), bundle: bundleFor(other) });
    // The bucket is the one value that matches; it proves nothing.
    expect(problems.some(p => p.includes('google_storage_bucket'))).toBe(false);
    expect(problems).toContain('native project_id is not the expected value (found "other-proj")');
    expect(problems).toContain('native google_app_id is not the expected value (found "1:333333333333:android:aa11")');
    expect(problems).toContain('native gcm_defaultSenderId is not the expected value (found "333333333333")');
    expect(problems).toContain('native google_api_key is not the expected value');
    for (const k of ['apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId']) {
      expect(problems).toContain(`JS ${k}: the expected value is not in the bundle`);
    }
    expect(problems).toContain('JS bundle contains another API key');
    expect(problems).toContain('JS bundle contains another app id ("1:333333333333:web:cc33")');
    expect(problems).toContain('JS bundle contains another auth domain ("other-proj.firebaseapp.com")');
  });

  it('does not take the staging name appearing elsewhere in the APK as proof', () => {
    const other: Project = { id: 'other-proj', number: '333333333333', tag: 'other' };
    const problems = checkStaging({
      arsc: arsc([{ ...nativeValues(other), app_name: STAGING, default_web_client_id: `${STAGING}.apps` }]),
      bundle: bundleFor(other, [STAGING, `https://${STAGING}.web.app`, `Connected to ${STAGING}`]),
    });
    // The bare id is a string of the bundle, so JS projectId is found; every value
    // that actually connects (key, app id, auth domain) is not staging's.
    expect(problems).toContain('native project_id is not the expected value (found "other-proj")');
    for (const k of ['apiKey', 'authDomain', 'storageBucket', 'appId', 'messagingSenderId']) {
      expect(problems).toContain(`JS ${k}: the expected value is not in the bundle`);
    }
    expect(problems).toContain('JS bundle contains another auth domain ("other-proj.firebaseapp.com")');
  });

  it('refuses a staging build that also carries production or placeholder values', () => {
    const prod: Project = { id: PROD, number: '997465194705', tag: 'prod' };
    const problems = checkStaging({
      arsc: arsc([nativeValues(staging)]),
      bundle: bundleFor(staging, [PROD, 'demo-offlinesms-ci', ...Object.values(webConfig(prod))]),
    });
    expect(problems).toContain(`JS bundle contains the project id "${PROD}"`);
    expect(problems).toContain('JS bundle contains the project id "demo-offlinesms-ci"');
    expect(problems).toContain('JS bundle contains another API key');
    expect(problems).toContain('JS bundle contains another app id ("1:997465194705:web:cc33")');
    expect(problems).toContain(`JS bundle contains another auth domain ("${PROD}.firebaseapp.com")`);
    expect(problems).toContain(`JS bundle contains another storage bucket ("${PROD}.firebasestorage.app")`);
  });

  it('refuses a resource with different values in different configurations, or missing', () => {
    const twoValues = checkStaging({ arsc: arsc([nativeValues(staging), { project_id: PROD }]), bundle: bundleFor(staging) });
    expect(twoValues).toEqual(['native project_id: 2 different values']);
    const { google_api_key: _dropped, ...noKey } = nativeValues(staging);
    expect(checkStaging({ arsc: arsc([noKey]), bundle: bundleFor(staging) })).toEqual(['native google_api_key: missing']);
  });

  it('refuses an APK with a JS bundle when no web config is given to check it against', () => {
    const problems = checkApk({
      arsc: arsc([nativeValues(staging)]), bundle: bundleFor(staging), project: STAGING,
      native: nativeExpectation(googleServices(staging), PKG), web: null,
    });
    expect(problems).toEqual(['the APK has a JS bundle but no web config was given to check it against']);
  });

  it('refuses a web config value that is only a part of a bundle string', () => {
    const problems = checkStaging({
      arsc: arsc([nativeValues(staging)]),
      bundle: hermes([...FILLER, ...Object.values({ ...webConfig(staging), projectId: `"${STAGING}"` })]),
    });
    expect(problems).toEqual(['JS projectId: the expected value is not in the bundle']);
  });

  it('never prints an API key', () => {
    const old: Project = { id: `${STAGING}-old`, number: '222222222222', tag: 'old' };
    const prod: Project = { id: PROD, number: '997465194705', tag: 'prod' };
    const problems = checkStaging({ arsc: arsc([nativeValues(old)]), bundle: bundleFor(old, Object.values(webConfig(prod))) });
    expect(problems.length).toBeGreaterThan(5);
    for (const k of ALL_KEYS([staging, old, prod])) expect(problems.join('\n')).not.toContain(k);
  });
});

describe('APK backend check, command line', () => {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'apk-check-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  function apk(name: string, parts: { arsc: Buffer; bundle?: Buffer }) {
    const d = mkdtempSync(join(dir, `${name}-`));
    writeFileSync(join(d, 'resources.arsc'), parts.arsc);
    if (parts.bundle) writeFileSync(join(d, 'index.android.bundle'), parts.bundle);
    const file = join(d, `${name}.apk`);
    const py = 'import os,sys,zipfile\nd=sys.argv[1]\nz=zipfile.ZipFile(sys.argv[2],"w")\n' +
      'z.write(os.path.join(d,"resources.arsc"),"resources.arsc")\n' +
      'b=os.path.join(d,"index.android.bundle")\nif os.path.exists(b): z.write(b,"assets/index.android.bundle")\nz.close()\n';
    expect(spawnSync('python3', ['-c', py, d, file]).status).toBe(0);
    return file;
  }
  function cli(args: string[], web?: ReturnType<typeof webConfig>) {
    const gsFile = join(dir, 'google-services.json');
    writeFileSync(gsFile, JSON.stringify(googleServices(staging)));
    const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
    if (web) {
      Object.assign(env, {
        EXPO_PUBLIC_FIREBASE_API_KEY: web.apiKey, EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: web.authDomain,
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: web.projectId, EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: web.storageBucket,
        EXPO_PUBLIC_FIREBASE_APP_ID: web.appId, EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: web.messagingSenderId,
      });
    }
    const r = spawnSync(process.execPath, [SCRIPT, '--project', STAGING, '--google-services', gsFile, '--package', PKG, ...args], { env: { ...env, NODE_ENV: 'test' as const }, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it('exits 0 for the exact staging APK and 1 for the -old project', () => {
    const good = cli(['--apk', apk('good', { arsc: arsc([nativeValues(staging)]), bundle: bundleFor(staging) }), '--web-config-env'], webConfig(staging));
    expect(good).toEqual({ code: 0, out: `good.apk: native Firebase config and JS Firebase config are exactly ${STAGING}'s (${PKG})\n` });

    const old: Project = { id: `${STAGING}-old`, number: '222222222222', tag: 'old' };
    const bad = cli(['--apk', apk('old', { arsc: arsc([nativeValues(old)]), bundle: bundleFor(old) }), '--web-config-env'], webConfig(staging));
    expect(bad.code).toBe(1);
    expect(bad.out).toContain(`APK backend: native project_id is not the expected value (found "${STAGING}-old")`);
    expect(bad.out).toContain('APK backend: JS projectId: the expected value is not in the bundle');
    for (const k of ALL_KEYS([staging, old])) expect(bad.out).not.toContain(k);
  });

  it('checks a relay APK (no JS bundle) on its native config, and refuses an APK with a bundle but no --web-config-env', () => {
    expect(cli(['--apk', apk('relay', { arsc: arsc([nativeValues(staging)]) })]).code).toBe(0);
    const unchecked = cli(['--apk', apk('user', { arsc: arsc([nativeValues(staging)]), bundle: bundleFor(staging) })]);
    expect(unchecked.code).toBe(1);
    expect(unchecked.out).toContain('no web config was given');
  });

  it('fails on a file that is not an APK, and on missing arguments', () => {
    const notApk = join(dir, 'not.apk');
    writeFileSync(notApk, STAGING);
    expect(cli(['--apk', notApk])).toEqual({ code: 1, out: `APK backend: ${notApk} has no resources.arsc\n` });
    expect(spawnSync(process.execPath, [SCRIPT, '--apk', notApk]).status).toBe(2);
  });
});
