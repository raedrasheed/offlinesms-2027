const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

// Ask Play services to install the cutout and expo-camera scanner models.
// Both libraries declare the same metadata key; the app must combine their
// model list before overriding that one value during Android manifest merge.
module.exports = function withSubjectSegmentation(config) {
  return withAndroidManifest(config, mod => {
    AndroidConfig.Manifest.ensureToolsAvailable(mod.modResults);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const metadata = app['meta-data'] || (app['meta-data'] = []);
    let entry = metadata.find(item => item.$['android:name'] === 'com.google.mlkit.vision.DEPENDENCIES');
    if (!entry) {
      entry = { $: { 'android:name': 'com.google.mlkit.vision.DEPENDENCIES' } };
      metadata.push(entry);
    }
    const models = new Set((entry.$['android:value'] || '').split(',').map(value => value.trim()).filter(Boolean));
    models.add('subject_segment');
    models.add('barcode_ui');
    entry.$['android:value'] = [...models].join(',');
    const replacements = new Set((entry.$['tools:replace'] || '').split(',').map(value => value.trim()).filter(Boolean));
    replacements.add('android:value');
    entry.$['tools:replace'] = [...replacements].join(',');
    return mod;
  });
};
