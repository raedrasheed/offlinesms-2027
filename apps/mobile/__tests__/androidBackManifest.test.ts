import { describe, expect, it } from 'vitest';
// The output format comes from aapt2 dump xmltree, including typed booleans.
import { checkAndroidBackManifestDump } from '../../../scripts/ci/check-android-back.mjs';

const manifest = (flag = '(type 0x12)0x0', override = '') => `N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=1)
    E: application (line=20)
      A: android:enableOnBackInvokedCallback(0x0101066c)=${flag}
      E: meta-data (line=22)
        A: android:name(0x01010003)="unrelated"
      E: activity (line=30)
        A: android:name(0x01010003)="app.offlinesms.mobile.MainActivity" (Raw: "app.offlinesms.mobile.MainActivity")
${override ? `        A: android:enableOnBackInvokedCallback(0x0101066c)=${override}` : ''}
        E: intent-filter (line=31)
          E: action (line=32)
            A: android:name(0x01010003)="android.intent.action.MAIN"`;

describe('packaged Android system Back compatibility', () => {
  it('accepts application opt-out inherited by MainActivity and an explicit false override', () => {
    expect(() => checkAndroidBackManifestDump(manifest())).not.toThrow();
    expect(() => checkAndroidBackManifestDump(manifest('(type 0x12)0x00000000', '(type 0x12)0x0'))).not.toThrow();
  });
  it('rejects default/true or untyped app settings, including a flag on the wrong element', () => {
    for (const flag of ['', '(type 0x12)0xffffffff', '"false"']) expect(() => checkAndroidBackManifestDump(manifest(flag))).toThrow(/application/);
    expect(() => checkAndroidBackManifestDump(manifest().replace('E: application', 'E: activity'))).toThrow(/application/);
  });
  it('rejects an activity override that would bypass JS Back handlers and an unreadable manifest', () => {
    expect(() => checkAndroidBackManifestDump(manifest(undefined, '(type 0x12)0xffffffff'))).toThrow(/overrides/);
    expect(() => checkAndroidBackManifestDump(manifest().replaceAll('MainActivity', 'OtherActivity'))).toThrow(/missing/);
    expect(() => checkAndroidBackManifestDump('')).toThrow(/application/);
  });
});
