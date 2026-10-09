// Pass-through of app.json, except for the web feature-gallery build
// (EXPO_PUBLIC_FEATURE_GALLERY=1, see gallery/FeatureGallery.tsx), which is a
// single-page export: static rendering needs expo-router, which the app
// doesn't use. Normal builds get app.json unchanged.
module.exports = ({ config }) =>
  process.env.EXPO_PUBLIC_FEATURE_GALLERY === '1'
    ? { ...config, web: { ...config.web, output: 'single' } }
    : config;
