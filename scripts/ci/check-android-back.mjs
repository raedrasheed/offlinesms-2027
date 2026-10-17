#!/usr/bin/env node
// Inspect the packaged manifest, so a manifest merge or prebuild cannot silently
// drop RN 0.79's Android 16 Back compatibility setting.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkAndroidBackManifestDump(dump) {
  const elements = [];
  let element;
  for (const line of dump.split(/\r?\n/)) {
    const tag = line.match(/^\s*E: ([\w-]+)/);
    if (tag) { element = { tag: tag[1], attrs: {} }; elements.push(element); }
    // AAPT2 uses the namespace URI; legacy AAPT uses the android alias.
    const attr = line.match(/^\s*A: (?:android|http:\/\/schemas\.android\.com\/apk\/res\/android):(\w+)(?:\([^)]*\))?=(.*)$/);
    if (element && attr) element.attrs[attr[1]] = attr[2].trim();
  }
  // AAPT2 PrettyPrint emits unquoted false; legacy dumps expose TYPE_INT_BOOLEAN.
  // Only the compiled value counts, never the optional raw-source annotation.
  const isFalse = value => /^(?:false|\(type 0x12\)\s*0x0+)$/i.test((value ?? '').replace(/\s+\(Raw: ".*"\)$/, ''));
  const applications = elements.filter(e => e.tag === 'application');
  if (applications.length !== 1 || !isFalse(applications[0].attrs.enableOnBackInvokedCallback)) {
    throw Error(`Android Back: application must explicitly set enableOnBackInvokedCallback=false for RN 0.79 (found ${applications[0]?.attrs.enableOnBackInvokedCallback ?? 'missing'})`);
  }
  const main = elements.find(e => e.tag === 'activity' && /^(?:[\w.]*\.)?MainActivity$/.test(e.attrs.name?.match(/^"([^"]+)"/)?.[1] ?? ''));
  if (!main) throw Error('Android Back: MainActivity is missing from the APK');
  const override = main.attrs.enableOnBackInvokedCallback;
  if (override !== undefined && !isFalse(override)) throw Error('Android Back: MainActivity overrides the compatibility setting');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--apk') throw Error('Usage: check-android-back.mjs --apk <file.apk>');
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw Error('ANDROID_HOME or ANDROID_SDK_ROOT is required');
  const aapt2 = path.join(sdk, 'build-tools', process.env.BT || '36.0.0', 'aapt2');
  const dump = execFileSync(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', args[1]], { encoding: 'utf8' });
  checkAndroidBackManifestDump(dump);
  console.log('Android Back: packaged application and MainActivity compatibility PASS');
}
