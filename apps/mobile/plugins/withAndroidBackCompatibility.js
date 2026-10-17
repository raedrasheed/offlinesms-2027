const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

// Preserve the checked-in native fix if Expo prebuild regenerates Android.
// RN 0.79's ReactActivity and Modal still use onBackPressed / KEYCODE_BACK.
// Revisit this opt-out when upgrading to a predictive-back-compatible RN.
module.exports = function withAndroidBackCompatibility(config) {
  return withAndroidManifest(config, mod => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:enableOnBackInvokedCallback'] = 'false';
    return mod;
  });
};
