const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

// Ask Play services to install the on-device cutout model with the app.
module.exports = function withSubjectSegmentation(config) {
  return withAndroidManifest(config, mod => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const metadata = app['meta-data'] || (app['meta-data'] = []);
    let entry = metadata.find(item => item.$['android:name'] === 'com.google.mlkit.vision.DEPENDENCIES');
    if (!entry) {
      entry = { $: { 'android:name': 'com.google.mlkit.vision.DEPENDENCIES' } };
      metadata.push(entry);
    }
    const models = new Set((entry.$['android:value'] || '').split(',').filter(Boolean));
    models.add('subject_segment');
    entry.$['android:value'] = [...models].join(',');
    return mod;
  });
};
