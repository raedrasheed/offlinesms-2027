import { describe, expect, it } from 'vitest';
// AAPT2 XmlPrinter uses namespace URIs and PrettyPrint boolean literals.
// Also cover the legacy AAPT prefix/TYPE_INT_BOOLEAN representation.
import { checkAndroidBackManifestDump } from '../../../scripts/ci/check-android-back.mjs';

const manifest = (flag = 'false', override = '', namespace = 'http://schemas.android.com/apk/res/android') => `N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=1)
    E: application (line=20)
      A: ${namespace}:enableOnBackInvokedCallback(0x0101066c)=${flag}
      E: meta-data (line=22)
        A: ${namespace}:name(0x01010003)="unrelated"
      E: activity (line=30)
        A: ${namespace}:name(0x01010003)="app.offlinesms.mobile.MainActivity" (Raw: "app.offlinesms.mobile.MainActivity")
${override ? `        A: ${namespace}:enableOnBackInvokedCallback(0x0101066c)=${override}` : ''}
        E: intent-filter (line=31)
          E: action (line=32)
            A: ${namespace}:name(0x01010003)="android.intent.action.MAIN"`;

describe('packaged Android system Back compatibility', () => {
  it('accepts application opt-out inherited by MainActivity and an explicit false override', () => {
    expect(() => checkAndroidBackManifestDump(manifest())).not.toThrow();
    for (const flag of ['false', 'false (Raw: "false")']) expect(() => checkAndroidBackManifestDump(manifest(flag, 'false'))).not.toThrow();
    expect(() => checkAndroidBackManifestDump(manifest('(type 0x12)0x00000000', '(type 0x12)0x0', 'android'))).not.toThrow();
  });
  it('rejects default/true or untyped app settings, including a flag on the wrong element', () => {
    for (const flag of ['', 'true', 'true (Raw: "false")', '(type 0x12)0xffffffff', '"false"', '@bool/back_flag']) expect(() => checkAndroidBackManifestDump(manifest(flag))).toThrow(/application/);
    expect(() => checkAndroidBackManifestDump(manifest().replace('E: application', 'E: activity'))).toThrow(/application/);
  });
  it('rejects an activity override that would bypass JS Back handlers and an unreadable manifest', () => {
    expect(() => checkAndroidBackManifestDump(manifest(undefined, '(type 0x12)0xffffffff'))).toThrow(/overrides/);
    expect(() => checkAndroidBackManifestDump(manifest(undefined, 'true'))).toThrow(/overrides/);
    expect(() => checkAndroidBackManifestDump(manifest().replaceAll('MainActivity', 'OtherActivity'))).toThrow(/missing/);
    expect(() => checkAndroidBackManifestDump(manifest().replace('="app.offlinesms.mobile.MainActivity"', '="app.offlinesms.mobile.OtherActivity"'))).toThrow(/missing/);
    expect(() => checkAndroidBackManifestDump('')).toThrow(/application/);
  });
});
