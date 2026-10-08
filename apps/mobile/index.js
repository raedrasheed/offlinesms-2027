import { registerRootComponent } from 'expo';

// EXPO_PUBLIC_FEATURE_GALLERY=1 builds a static showcase of the composer /
// sync UI for screenshots (gallery/FeatureGallery.tsx). The variable is
// inlined at build time and the unused branch is folded away, so normal
// builds never include the gallery.
if (process.env.EXPO_PUBLIC_FEATURE_GALLERY === '1') {
  registerRootComponent(require('./gallery/FeatureGallery').default);
} else {
  registerRootComponent(require('./App').default);
}
