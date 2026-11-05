# Chat WebP support — 2026-11-05

Chat image selection now preserves WebP and determines its MIME type and size from the actual output. Chat bubbles, attachment previews, image previews and the full-screen viewer use Expo Image 2.4.1, compatible with Expo SDK 53, including the bundled WebP decoder on iOS.

The previous Android photo picker used `quality: 0.8`. SDK 53's compression exporter writes JPEG for non-PNG output, while the media handler can retain the original WebP MIME and extension. This produces JPEG bytes declared as WebP, which the existing server signature validation correctly rejects. Android photo-library selection now uses `quality: 1` with editing disabled, preserving transparency and animation. iOS retains `quality: 0.8`: its WebP branch already returns original bytes, while other image formats retain their existing JPEG conversion behavior.

A bounded 12-byte signature read identifies JPEG, PNG, GIF and WebP. It does not replace server validation. Provider MIME, extension and reported size are no longer authoritative. Android content-provider URIs are copied to cache for stable preview and queued upload access. Browser blob/data URLs use the same signature classification. Unsupported formats continue to fail validation.

Existing React Native Android configuration already enabled static WebP but disabled animated WebP. The scoped Expo Image renderer supports both static and animated WebP across Android and iOS. It retains containment, natural dimensions, remote fallback, upload/download overlays, captions and message actions. Recycling keys and source-scoped state prevent a reused message cell from retaining another image's error or dimensions.

A fresh native build is required for the added Expo Image module. Install the updated test APK on Android and create a new native iOS build for TestFlight/device validation. Firebase functions, rules and stored messages need no deployment for this change. A previously rejected upload should be selected and sent again.

Automated validation covers byte/MIME mismatches, actual file size, Android content URIs, browser URLs, image dimensions, remote fallback, retry and recycled cells. These JavaScript tests do not exercise native image decoding. The existing Android CI additionally builds APK/AAB artifacts and checks 16 KB binary alignment.

Device checks before release:

| Sample / action | Check in direct chat and group |
| --- | --- |
| Static WebP | Sender preview, receiver bubble and full-screen image display |
| Transparent WebP | Alpha remains intact without an opaque replacement background |
| Animated WebP | Animation plays in preview, received bubble and full-screen view |
| JPEG, PNG and animated GIF | Existing formats continue to display |
| Share WebP from another app | Preview and upload use the actual format and size |
| Scroll away and return / reopen app | Cached images display without another message's error or dimensions |
| Image over 10 MB / unsupported format | Existing upload restrictions remain enforced |

Primary implementation references:

- [SDK 53 picker exporter selection and MIME handling](https://github.com/expo/expo/blob/sdk-53/packages/expo-image-picker/android/src/main/java/expo/modules/imagepicker/MediaHandler.kt)
- [SDK 53 compression format selection](https://github.com/expo/expo/blob/sdk-53/packages/expo-image-picker/android/src/main/java/expo/modules/imagepicker/ImagePickerUtils.kt)
- [SDK 53 compatible native module versions](https://github.com/expo/expo/blob/sdk-53/packages/expo/bundledNativeModules.json)
- [Expo Image API and WebP codec option](https://github.com/expo/expo/blob/sdk-53/packages/expo-image/src/Image.types.ts)
