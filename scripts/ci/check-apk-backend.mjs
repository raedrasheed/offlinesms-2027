#!/usr/bin/env node
// Reads the Firebase configuration a built APK actually carries and compares
// it, value by value and exactly, with the configuration it was built for.
// The mere presence of a project name somewhere in the file proves nothing.
//
//   node scripts/ci/check-apk-backend.mjs --apk <file> --project <id>
//        --google-services <google-services.json> --package <applicationId>
//        [--web-config-env]
//
// Native config (resources.arsc, written by the google-services plugin, used
// by the native Firebase SDK: FCM, the relay's callables): the string
// resources project_id, google_app_id, google_api_key, gcm_defaultSenderId and
// google_storage_bucket must each have exactly one value, equal to the
// project and to that package's client in the given google-services.json.
//
// JS config (assets/index.android.bundle, Hermes bytecode; the user app's
// Firebase JS SDK: Auth, Firestore, callables): with --web-config-env, the
// six EXPO_PUBLIC_FIREBASE_* values must each be a string of the bundle, and
// no other string of the bundle may look like a Firebase config value (an
// API key, app id, *.firebaseapp.com auth domain or storage bucket), or be
// the production or CI placeholder project id. An APK with a JS bundle and no
// --web-config-env fails: its JS config would go unchecked.
//
// Prints the project and which parts were checked; never prints key values.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROD = 'offlinesms-prod-2027';
const PLACEHOLDER = 'demo-offlinesms-ci';

// ── resources.arsc (AOSP ResourceTypes.h) ─────────────────────────────────────
const RES_STRING_POOL = 0x0001, RES_TABLE = 0x0002, RES_TABLE_PACKAGE = 0x0200, RES_TABLE_TYPE = 0x0201;
const TYPE_STRING = 0x03;
const FLAG_SPARSE = 0x01, FLAG_OFFSET16 = 0x02;
const ENTRY_COMPLEX = 0x0001, ENTRY_COMPACT = 0x0008;

function need(cond, what) { if (!cond) throw new Error(`unreadable resources.arsc: ${what}`); }

function readStringPool(buf, start) {
  need(start + 28 <= buf.length && buf.readUInt16LE(start) === RES_STRING_POOL, 'string pool expected');
  const headerSize = buf.readUInt16LE(start + 2);
  const end = start + buf.readUInt32LE(start + 4);
  const count = buf.readUInt32LE(start + 8);
  const utf8 = (buf.readUInt32LE(start + 16) & 0x100) !== 0;
  const stringsStart = start + buf.readUInt32LE(start + 20);
  need(end <= buf.length && start + headerSize + count * 4 <= end, 'string pool bounds');
  const out = [];
  for (let i = 0; i < count; i++) {
    let p = stringsStart + buf.readUInt32LE(start + headerSize + i * 4);
    let s;
    if (utf8) {
      if (buf[p++] & 0x80) p++; // UTF-16 length, unused
      let len = buf[p++];
      if (len & 0x80) len = ((len & 0x7f) << 8) | buf[p++];
      need(p + len <= end, 'string bounds');
      s = buf.toString('utf8', p, p + len);
    } else {
      let len = buf.readUInt16LE(p); p += 2;
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p); p += 2; }
      need(p + len * 2 <= end, 'string bounds');
      s = buf.toString('utf16le', p, p + len * 2);
    }
    out.push(s);
  }
  return out;
}

/** Every string-typed value of every `string` resource, by name, across all configurations. */
export function arscStringResources(buf) {
  need(buf.length >= 12 && buf.readUInt16LE(0) === RES_TABLE, 'resource table expected');
  const result = new Map();
  const tableEnd = Math.min(buf.readUInt32LE(4), buf.length);
  let globals = null;
  for (let p = buf.readUInt16LE(2); p < tableEnd;) {
    const type = buf.readUInt16LE(p), size = buf.readUInt32LE(p + 4);
    need(size >= 8 && p + size <= tableEnd, 'chunk bounds');
    if (type === RES_STRING_POOL && !globals) globals = readStringPool(buf, p);
    else if (type === RES_TABLE_PACKAGE) { need(globals, 'global strings before package'); readPackage(buf, p, globals, result); }
    p += size;
  }
  return result;
}

function readPackage(buf, start, globals, result) {
  const headerSize = buf.readUInt16LE(start + 2), end = start + buf.readUInt32LE(start + 4);
  const typeNames = readStringPool(buf, start + buf.readUInt32LE(start + 268));
  const keys = readStringPool(buf, start + buf.readUInt32LE(start + 276));
  for (let p = start + headerSize; p < end;) {
    const type = buf.readUInt16LE(p), size = buf.readUInt32LE(p + 4);
    need(size >= 8 && p + size <= end, 'package chunk bounds');
    if (type === RES_TABLE_TYPE && typeNames[buf[p + 8] - 1] === 'string') readType(buf, p, globals, keys, result);
    p += size;
  }
}

function readType(buf, start, globals, keys, result) {
  const headerSize = buf.readUInt16LE(start + 2), end = start + buf.readUInt32LE(start + 4);
  const flags = buf[start + 9];
  const count = buf.readUInt32LE(start + 12);
  const entries = start + buf.readUInt32LE(start + 16);
  for (let i = 0; i < count; i++) {
    let off;
    if (flags & FLAG_SPARSE) off = buf.readUInt16LE(start + headerSize + i * 4 + 2) * 4;
    else if (flags & FLAG_OFFSET16) { const o = buf.readUInt16LE(start + headerSize + i * 2); if (o === 0xffff) continue; off = o * 4; }
    else { const o = buf.readUInt32LE(start + headerSize + i * 4); if (o === 0xffffffff) continue; off = o; }
    const e = entries + off;
    need(e + 8 <= end, 'entry bounds');
    const eflags = buf.readUInt16LE(e + 2);
    let key, dataType, data;
    if (eflags & ENTRY_COMPACT) {
      key = buf.readUInt16LE(e); dataType = eflags >> 8; data = buf.readUInt32LE(e + 4);
    } else {
      if (eflags & ENTRY_COMPLEX) continue;
      const v = e + buf.readUInt16LE(e);
      need(v + 8 <= end, 'value bounds');
      key = buf.readUInt32LE(e + 4); dataType = buf[v + 3]; data = buf.readUInt32LE(v + 4);
    }
    if (dataType !== TYPE_STRING) continue;
    need(key < keys.length && data < globals.length, 'string reference');
    if (!result.has(keys[key])) result.set(keys[key], new Set());
    result.get(keys[key]).add(globals[data]);
  }
}

// ── Hermes bytecode string table (hermes BytecodeFileFormat.h) ────────────────
const HBC_MAGIC = 0x1f1903c103bc1fc6n;
const HBC_HEADER_SIZE = 128;
const HBC_FUNC_HEADER_SIZE = 16;

/** All strings of a Hermes bytecode bundle, exactly as stored. */
export function hermesStrings(buf) {
  const bad = what => new Error(`unreadable JS bundle: ${what}`);
  if (buf.length < HBC_HEADER_SIZE || buf.readBigUInt64LE(0) !== HBC_MAGIC) throw bad('not Hermes bytecode');
  const version = buf.readUInt32LE(8);
  if (version < 84 || version > 99) throw bad(`Hermes bytecode version ${version} not supported`);
  if (buf.readUInt32LE(32) !== buf.length) throw bad('length mismatch');
  const [functionCount, stringKindCount, identifierCount, stringCount, overflowCount, storageSize] =
    [40, 44, 48, 52, 56, 60].map(o => buf.readUInt32LE(o));
  const small = HBC_HEADER_SIZE + functionCount * HBC_FUNC_HEADER_SIZE + stringKindCount * 4 + identifierCount * 4;
  const overflow = small + stringCount * 4;
  const storage = overflow + overflowCount * 8;
  if (storage + storageSize > buf.length) throw bad('string storage bounds');
  const out = [];
  for (let i = 0; i < stringCount; i++) {
    const v = buf.readUInt32LE(small + i * 4);
    const utf16 = v & 1;
    let off = (v >>> 1) & 0x7fffff, len = v >>> 24;
    if (len === 0xff) {
      if (off >= overflowCount) throw bad('overflow string index');
      len = buf.readUInt32LE(overflow + off * 8 + 4); off = buf.readUInt32LE(overflow + off * 8);
    }
    const bytes = utf16 ? len * 2 : len;
    if (off + bytes > storageSize) throw bad('string bounds');
    out.push(buf.toString(utf16 ? 'utf16le' : 'latin1', storage + off, storage + off + bytes));
  }
  return out;
}

// ── The check ─────────────────────────────────────────────────────────────────
const SHAPES = {
  'API key': /^AIza[0-9A-Za-z_-]{35}$/,
  'app id': /^1:\d+:(web|android|ios):[0-9a-f]+$/i,
  'auth domain': /^[a-z0-9-]+\.firebaseapp\.com$/,
  'storage bucket': /^[a-z0-9-]+\.(firebasestorage\.app|appspot\.com)$/,
};

/** Expected native values for one package from a google-services.json. */
export function nativeExpectation(googleServices, pkg) {
  const client = (googleServices.client ?? []).find(c => c?.client_info?.android_client_info?.package_name === pkg);
  if (!client) throw new Error(`google-services.json has no Android client for ${pkg}`);
  const info = googleServices.project_info ?? {};
  return {
    project_id: info.project_id,
    google_app_id: client.client_info.mobilesdk_app_id,
    google_api_key: client.api_key?.[0]?.current_key,
    gcm_defaultSenderId: String(info.project_number ?? ''),
    ...(info.storage_bucket ? { google_storage_bucket: info.storage_bucket } : {}),
  };
}

/**
 * Compares an APK's parts with what they must be. Returns a list of problems
 * (empty = pass). `arsc` / `bundle` are the raw entries (bundle may be null).
 */
export function checkApk({ arsc, bundle, project, native, web }) {
  const problems = [];
  if (native.project_id !== project) problems.push(`google-services.json is for ${native.project_id}, not ${project}`);

  const res = arscStringResources(arsc);
  for (const [name, fromFile] of Object.entries(native)) {
    const want = name === 'project_id' ? project : fromFile;
    const got = [...(res.get(name) ?? [])];
    if (got.length !== 1) problems.push(`native ${name}: ${got.length ? `${got.length} different values` : 'missing'}`);
    else if (got[0] !== want) problems.push(`native ${name} is not the expected value${name === 'google_api_key' ? '' : ` (found "${got[0]}")`}`);
  }

  if (bundle) {
    if (!web) problems.push('the APK has a JS bundle but no web config was given to check it against');
    else {
      if (web.projectId !== project) problems.push(`web config projectId is ${web.projectId}, not ${project}`);
      const strings = new Set(hermesStrings(bundle));
      for (const [k, v] of Object.entries(web)) if (!v || !strings.has(v)) problems.push(`JS ${k}: the expected value is not in the bundle`);
      const allowed = new Set(Object.values(web));
      for (const s of strings) {
        if (allowed.has(s)) continue;
        if (s === PROD || s === PLACEHOLDER) problems.push(`JS bundle contains the project id "${s}"`);
        for (const [shape, re] of Object.entries(SHAPES)) {
          if (re.test(s)) problems.push(`JS bundle contains another ${shape}${shape === 'API key' ? '' : ` ("${s}")`}`);
        }
      }
    }
  }
  return problems;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function unzipEntry(apk, entry) {
  try {
    return execFileSync('unzip', ['-p', apk, entry], { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const apk = arg('apk'), project = arg('project'), gsPath = arg('google-services'), pkg = arg('package');
  if (!apk || !project || !gsPath || !pkg) {
    console.error('usage: --apk <file> --project <id> --google-services <file> --package <id> [--web-config-env]');
    process.exit(2);
  }
  let problems;
  try {
    const arsc = unzipEntry(apk, 'resources.arsc');
    if (!arsc?.length) throw new Error(`${apk} has no resources.arsc`);
    const bundle = unzipEntry(apk, 'assets/index.android.bundle');
    const native = nativeExpectation(JSON.parse(fs.readFileSync(gsPath, 'utf8')), pkg);
    const env = n => (process.env[`EXPO_PUBLIC_FIREBASE_${n}`] ?? '').trim();
    const web = process.argv.includes('--web-config-env') ? {
      apiKey: env('API_KEY'), authDomain: env('AUTH_DOMAIN'), projectId: env('PROJECT_ID'),
      storageBucket: env('STORAGE_BUCKET'), appId: env('APP_ID'), messagingSenderId: env('MESSAGING_SENDER_ID'),
    } : null;
    problems = checkApk({ arsc, bundle: bundle?.length ? bundle : null, project, native, web });
    if (!problems.length) {
      console.log(`${apk.split('/').pop()}: native Firebase config${bundle?.length ? ' and JS Firebase config are' : ' is'} exactly ${project}'s (${pkg})`);
      process.exit(0);
    }
  } catch (e) {
    problems = [e.message];
  }
  for (const p of problems) console.error(`APK backend: ${p}`);
  process.exit(1);
}
