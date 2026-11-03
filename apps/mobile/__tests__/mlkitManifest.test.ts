import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AndroidConfig, type ExportedConfig } from 'expo/config-plugins';

type Manifest = AndroidConfig.Manifest.AndroidManifest;
// Expo's metadata type omits Android manifest-merger attributes.
type ModelMetadata = AndroidConfig.Manifest.ManifestMetaData & { $: { 'tools:replace'?: string } };
const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const withSubjectSegmentation: (config: ExportedConfig) => ExportedConfig = require('../plugins/withSubjectSegmentation');
const key = 'com.google.mlkit.vision.DEPENDENCIES';
const entry = (manifest: Manifest) => manifest.manifest.application?.[0]?.['meta-data']?.find(item => item.$['android:name'] === key) as ModelMetadata | undefined;
const models = (manifest: Manifest) => entry(manifest)?.$['android:value']?.split(',').map(value => value.trim()) ?? [];

async function applyPlugin(manifest: Manifest) {
  const config = withSubjectSegmentation({ name: 'OfflineSMS', slug: 'offlinesms' });
  const result = await config.mods!.android!.manifest!({
    ...config, modResults: manifest, modRawConfig: config,
    modRequest: { projectRoot: mobileRoot, platformProjectRoot: resolve(mobileRoot, 'android'), modName: 'manifest', platform: 'android', introspect: true },
  });
  return result.modResults;
}

const emptyManifest = (): Manifest => ({ manifest: {
  $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' }, queries: [],
  application: [{ $: { 'android:name': '.MainApplication' } }],
} });

describe('ML Kit model metadata across Expo prebuild and native Gradle builds', () => {
  it('keeps the model declarations from both installed native libraries in the app override', async () => {
    const generated = await applyPlugin(emptyManifest());
    const native = await AndroidConfig.Manifest.readAndroidManifestAsync(resolve(mobileRoot, 'android/app/src/main/AndroidManifest.xml'));
    for (const dependency of ['expo-camera', '@six33/react-native-bg-removal']) {
      const library = await AndroidConfig.Manifest.readAndroidManifestAsync(resolve(mobileRoot, 'node_modules', dependency, 'android/src/main/AndroidManifest.xml'));
      expect(models(library).length).toBeGreaterThan(0);
      for (const model of models(library)) {
        expect(models(generated)).toContain(model);
        expect(models(native)).toContain(model);
      }
    }
    for (const manifest of [generated, native]) {
      expect(entry(manifest)?.$['tools:replace']?.split(',')).toContain('android:value');
      expect(manifest.manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
    }
  });

  it('preserves unrelated models and merge markers, and is stable when prebuild runs again', async () => {
    const manifest = emptyManifest();
    const existing: ModelMetadata = { $: { 'android:name': key, 'android:value': ' face,subject_segment, face ', 'tools:replace': 'android:name' } };
    manifest.manifest.application![0]['meta-data'] = [
      existing,
      { $: { 'android:name': 'unrelated', 'android:value': 'keep-me' } },
    ];
    const first = await applyPlugin(manifest);
    expect(models(first)).toEqual(['face', 'subject_segment', 'barcode_ui']);
    expect(entry(first)?.$['tools:replace']).toBe('android:name,android:value');
    expect(first.manifest.application![0]['meta-data']?.[1]).toEqual({ $: { 'android:name': 'unrelated', 'android:value': 'keep-me' } });
    const snapshot = structuredClone(first);
    expect(await applyPlugin(first)).toEqual(snapshot);
  });
});
